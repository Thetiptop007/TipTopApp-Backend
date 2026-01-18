const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const { emitOrderUpdate, emitUserNotification } = require('../utils/socket');

/**
 * Admin creates order for walk-in customer
 * POST /api/v1/admin/orders/create
 * Admin only
 */
exports.createOrderForCustomer = catchAsync(async (req, res, next) => {
  const {
    customerName,
    customerPhone,
    customerEmail,
    items,
    orderType, // 'DELIVERY' or 'TAKEAWAY'
    deliveryAddress,
    paymentMethod,
    specialInstructions,
  } = req.body;

  // Validation
  if (!customerName || !customerPhone) {
    return next(new AppError('Customer name and phone are required', 400));
  }

  if (!items || items.length === 0) {
    return next(new AppError('Order must contain at least one item', 400));
  }

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    return next(new AppError('Delivery address is required for delivery orders', 400));
  }

  // Validate menu items
  const menuItemIds = items.map((item) => item.menuItemId);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });

  // Check if all items exist
  if (menuItems.length !== menuItemIds.length) {
    return next(new AppError('Some menu items do not exist', 400));
  }

  // Check if all items are available
  const unavailableItems = menuItems.filter(item => !item.isAvailable);
  if (unavailableItems.length > 0) {
    return next(new AppError(`Some menu items are not available: ${unavailableItems.map(i => i.name).join(', ')}`, 400));
  }

  // Get settings for tax and delivery charges
  const settings = await Settings.getSettings();

  // Create or find customer user
  let customer = await User.findOne({ 'phone.number': customerPhone });

  if (!customer) {
    // Create a basic customer profile for walk-in/phone orders
    const nameParts = customerName.trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'Guest';
    
    // Generate a temporary email if not provided
    const email = customerEmail || `${customerPhone}@walkin.thetiptop.com`;
    
    // Generate a random password (user can reset it later if they want to use the app)
    const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
    
    customer = await User.create({
      name: {
        first: firstName,
        last: lastName,
      },
      phone: {
        number: customerPhone,
        isVerified: false,
      },
      email: {
        address: email,
        isVerified: customerEmail ? false : true, // Auto-verify temp emails
      },
      password: randomPassword,
      role: 'customer',
      isActive: true,
    });
    logger.info(`Created new customer: ${customerName} (${customerPhone}) with temp email: ${email}`);
  }

  // Calculate pricing
  let itemsTotal = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find((mi) => mi._id.toString() === item.menuItemId);
    const portion = item.portion || 'Full';
    
    // Try to find price from priceVariants first, then fall back to portions
    let price;
    if (menuItem.priceVariants && menuItem.priceVariants.length > 0) {
      const variant = menuItem.priceVariants.find((v) => v.quantity === portion);
      price = variant?.price || menuItem.priceVariants[0]?.price || menuItem.basePrice || 0;
    } else if (menuItem.portions && menuItem.portions.length > 0) {
      const portionObj = menuItem.portions.find((p) => p.name === portion);
      price = portionObj?.price || menuItem.basePrice || 0;
    } else {
      price = menuItem.basePrice || 0;
    }
    
    const subtotal = price * item.quantity;
    itemsTotal += subtotal;

    return {
      menuItemId: menuItem._id,
      name: menuItem.name,
      image: menuItem.images?.[0] || menuItem.image,
      description: menuItem.description,
      portion,
      price,
      quantity: item.quantity,
      customizations: item.customizations || [],
      subtotal,
    };
  });

  // Calculate fees based on order type using settings from database
  const deliveryFee = orderType === 'DELIVERY' ? (settings.deliveryCharge || 0) : 0;
  const taxRate = settings.taxRate || 0;
  const taxAmount = Math.round((itemsTotal + deliveryFee) * (taxRate / 100));
  const finalAmount = itemsTotal + deliveryFee + taxAmount;

  // Generate order number
  const orderCount = await Order.countDocuments();
  const orderNumber = `ORD-${String(orderCount + 1).padStart(6, '0')}`;

  // Create order
  const order = await Order.create({
    orderNumber,
    customer: {
      id: customer._id,
      name: customerName,
      phone: customerPhone,
      email: customerEmail || '',
    },
    items: orderItems,
    pricing: {
      itemsTotal,
      deliveryFee,
      taxRate,
      taxAmount,
      finalAmount,
    },
    orderType,
    placedBy: 'ADMIN',
    deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : undefined,
    paymentMethod: paymentMethod || 'COD',
    paymentStatus: paymentMethod === 'ONLINE' ? 'PAID' : 'PENDING',
    status: 'PENDING',
    statusHistory: [
      {
        status: 'PENDING',
        timestamp: new Date(),
        updatedBy: req.user._id,
        notes: `Order created by admin for ${orderType === 'TAKEAWAY' ? 'takeaway' : 'delivery'}`,
      },
    ],
    estimatedPrepTime: 20, // 20 minutes default
    specialInstructions,
  });

  logger.info(`Admin ${req.user.email.address} created ${orderType} order ${orderNumber} for ${customerName}`);

  // Emit real-time notification (don't let this block response)
  try {
    emitOrderUpdate({
      type: 'new_order',
      order,
    });
  } catch (error) {
    logger.error('Failed to emit order update:', error);
  }

  // Notify customer if they have the app (don't let this block response)
  try {
    if (customer.fcmTokens && customer.fcmTokens.length > 0) {
      emitUserNotification(customer._id.toString(), {
        type: 'order_placed',
        title: 'Order Placed',
        message: `Your ${orderType.toLowerCase()} order ${orderNumber} has been placed`,
        orderId: order._id,
      });
    }
  } catch (error) {
    logger.error('Failed to send customer notification:', error);
  }

  res.status(201).json({
    status: 'success',
    message: `${orderType} order created successfully`,
    data: { order },
  });
});

/**
 * Mark takeaway order as completed
 * PATCH /api/v1/admin/orders/:id/complete-takeaway
 * Admin only
 */
exports.completeTakeawayOrder = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (order.orderType !== 'TAKEAWAY') {
    return next(new AppError('This endpoint is only for takeaway orders', 400));
  }

  if (order.status === 'COMPLETED' || order.status === 'DELIVERED') {
    return next(new AppError('Order already completed', 400));
  }

  order.status = 'COMPLETED';
  order.paymentStatus = 'PAID';
  order.statusHistory.push({
    status: 'COMPLETED',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Takeaway order completed - customer picked up',
  });

  await order.save();

  logger.info(`Takeaway order ${order.orderNumber} completed by admin`);

  res.status(200).json({
    status: 'success',
    message: 'Takeaway order marked as completed',
    data: { order },
  });
});

module.exports = exports;
