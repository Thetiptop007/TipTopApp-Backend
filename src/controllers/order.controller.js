/**
 * =====================================================
 * ORDER CONTROLLER
 * Domain-based controller for all order-related operations
 * =====================================================
 */

const APIFeatures = require('../utils/APIFeatures');
const AppError = require('../utils/AppError');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const Settings = require('../models/Settings');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const notificationService = require('../services/notification.service');
const { emitOrderUpdate, emitUserNotification, emitNewOrder } = require('../utils/socket');

/* =====================================================
   ADMIN RELATED ORDER CONTROLLERS
===================================================== */

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

  // Separate regular menu items from custom items
  const regularItems = items.filter(item => item.menuItemId !== 'custom');
  const customItems = items.filter(item => item.menuItemId === 'custom');

  // Validate regular menu items
  const menuItemIds = regularItems.map((item) => item.menuItemId);
  let menuItems = [];
  
  if (menuItemIds.length > 0) {
    menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });

    // Check if all items exist
    if (menuItems.length !== menuItemIds.length) {
      return next(new AppError('Some menu items do not exist', 400));
    }

    // Check if all items are available
    const unavailableItems = menuItems.filter(item => !item.isAvailable);
    if (unavailableItems.length > 0) {
      return next(new AppError(`Some menu items are not available: ${unavailableItems.map(i => i.name).join(', ')}`, 400));
    }
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
  const orderItems = [];
  
  // Process regular menu items
  regularItems.forEach((item) => {
    const menuItem = menuItems.find((mi) => mi._id.toString() === item.menuItemId);
    const portion = item.portion || 'Full';
    
    // Try to find price from priceVariants first, then fall back to portions
    let price;
    if (item.price) {
      price = item.price; // Use provided price if available
    } else if (menuItem.priceVariants && menuItem.priceVariants.length > 0) {
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

    orderItems.push({
      menuItemId: menuItem._id,
      name: menuItem.name,
      image: menuItem.images?.[0] || menuItem.image,
      description: menuItem.description,
      portion,
      price,
      quantity: item.quantity,
      customizations: item.customizations || [],
      subtotal,
    });
  });
  
  // Process custom items
  customItems.forEach((item) => {
    if (!item.name || !item.price) {
      throw new AppError('Custom items must have name and price', 400);
    }
    
    const price = parseFloat(item.price);
    const subtotal = price * item.quantity;
    itemsTotal += subtotal;

    orderItems.push({
      menuItemId: null, // No menu item reference for custom items
      name: item.name,
      image: '/images/product/custom-item.jpg',
      description: 'Custom item',
      portion: item.portion || 'Custom',
      price,
      quantity: item.quantity,
      customizations: [],
      subtotal,
      isCustom: true
    });
    
    logger.info(`Added custom item: ${item.name} @ ₹${price} x ${item.quantity}`);
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

  order.status = 'DELIVERED';
  order.paymentStatus = 'PAID';
  order.statusHistory.push({
    status: 'DELIVERED',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Takeaway order delivered - customer picked up order',
  });

  await order.save();

  logger.info(`Takeaway order ${order.orderNumber} marked as delivered by admin`);

  // Emit socket notification if customer exists
  if (order.customer && order.customer.id) {
    emitUserNotification(order.customer.id.toString(), {
      type: 'ORDER_DELIVERED',
      orderId: order._id,
      orderNumber: order.orderNumber,
      message: 'Your order has been delivered',
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'Takeaway order marked as delivered',
    data: { order },
  });
});

exports.acceptOrder = catchAsync(async (req, res, next) => {
  logger.info('\n===== ACCEPT ORDER REQUEST =====');
  logger.info(`📦 Order ID: ${req.params.id}`);
  logger.info(`👤 Admin: ${req.user.email}`);

  // Start a session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Use findOneAndUpdate with atomic operation to prevent race conditions
    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        status: 'PENDING', // Only update if status is PENDING
      },
      {
        $set: { status: 'ACCEPTED' },
        $push: {
          statusHistory: {
            status: 'ACCEPTED',
            timestamp: new Date(),
            updatedBy: req.user._id,
            notes: 'Order accepted by admin',
          },
        },
      },
      {
        new: true, // Return updated document
        runValidators: true,
        session, // Use transaction session
      }
    );

    if (!order) {
      await session.abortTransaction();
      session.endSession();
      
      // Check if order exists
      const existingOrder = await Order.findById(req.params.id);
      if (!existingOrder) {
        logger.error(`❌ Order not found: ${req.params.id}`);
        return next(new AppError('Order not found', 404));
      }
      
      // Order exists but status is not PENDING
      logger.warn(`⚠️ Cannot accept - Order ${existingOrder.orderNumber} status is ${existingOrder.status}, expected PENDING`);
      return next(new AppError(`Order is already ${existingOrder.status.toLowerCase()}. Only pending orders can be accepted.`, 400));
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info(`✅ Order ${order.orderNumber} status changed: PENDING → ACCEPTED`);

    // Emit socket event to customer (only if customer.id exists)
    // Do this after transaction to avoid rollback issues
    try {
      if (order.customer && order.customer.id) {
        emitUserNotification(order.customer.id.toString(), {
          type: 'ORDER_ACCEPTED',
          orderId: order._id,
          orderNumber: order.orderNumber,
          message: 'Your order has been accepted and is being prepared',
        });
        logger.info(`📤 Socket notification sent to customer: ${order.customer.id}`);
      } else {
        logger.info(`📤 No customer ID - skipping socket notification (admin-created order)`);
      }
    } catch (notifError) {
      logger.error('Failed to send notification (non-critical):', notifError);
    }

    logger.info('================================\n');

    res.status(200).json({
      status: 'success',
      message: 'Order accepted successfully',
      data: { order },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

exports.markOrderPreparing = catchAsync(async (req, res, next) => {
  logger.info('\n===== MARK PREPARING REQUEST =====');
  logger.info(`📦 Order ID: ${req.params.id}`);
  logger.info(`👤 Admin: ${req.user.email}`);

  const order = await Order.findById(req.params.id);

  if (!order) {
    logger.error(`❌ Order not found: ${req.params.id}`);
    return next(new AppError('Order not found', 404));
  }

  logger.info(`📋 Order Number: ${order.orderNumber}`);
  logger.info(`📊 Current Status: ${order.status}`);

  if (order.status !== 'ACCEPTED') {
    logger.warn(`⚠️  Cannot mark preparing - Order status is ${order.status}, expected ACCEPTED`);
    return next(new AppError('Only accepted orders can be marked as preparing', 400));
  }

  order.status = 'PREPARING';
  order.statusHistory.push({
    status: 'PREPARING',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Kitchen started preparing the order',
  });

  await order.save();

  logger.info(`✅ Order ${order.orderNumber} status changed: ACCEPTED → PREPARING`);

  // Emit socket event to customer (only if customer.id exists)
  if (order.customer && order.customer.id) {
    emitUserNotification(order.customer.id.toString(), {
      type: 'ORDER_PREPARING',
      orderId: order._id,
      orderNumber: order.orderNumber,
      message: 'Your order is being prepared',
    });
    logger.info(`📤 Socket notification sent to customer`);
  } else {
    logger.info(`📤 No customer ID - skipping socket notification`);
  }

  logger.info('================================\n');

  res.status(200).json({
    status: 'success',
    message: 'Order marked as preparing',
    data: { order },
  });
});

exports.markOrderReady = catchAsync(async (req, res, next) => {
  logger.info('\n===== MARK READY REQUEST =====');
  logger.info(`📦 Order ID: ${req.params.id}`);
  logger.info(`👤 Admin: ${req.user.email}`);

  const order = await Order.findById(req.params.id);

  if (!order) {
    logger.error(`❌ Order not found: ${req.params.id}`);
    return next(new AppError('Order not found', 404));
  }

  logger.info(`📋 Order Number: ${order.orderNumber}`);
  logger.info(`📊 Current Status: ${order.status}`);
  logger.info(`📦 Order Type: ${order.orderType}`);

  if (order.status !== 'ACCEPTED') {
    logger.warn(`⚠️  Cannot mark ready - Order status is ${order.status}, expected ACCEPTED`);
    return next(new AppError('Only accepted orders can be marked as ready', 400));
  }

  // For TAKEAWAY orders, mark as READY_FOR_PICKUP instead of READY
  if (order.orderType === 'TAKEAWAY') {
    order.status = 'READY_FOR_PICKUP';
    order.statusHistory.push({
      status: 'READY_FOR_PICKUP',
      timestamp: new Date(),
      updatedBy: req.user._id,
      notes: 'Takeaway order ready for customer pickup',
    });

    await order.save();

    logger.info(`✅ Takeaway order ${order.orderNumber} status changed: ACCEPTED → READY_FOR_PICKUP`);

    // Emit socket event to customer (only if customer.id exists)
    if (order.customer && order.customer.id) {
      emitUserNotification(order.customer.id.toString(), {
        type: 'ORDER_READY_FOR_PICKUP',
        orderId: order._id,
        orderNumber: order.orderNumber,
        message: 'Your order is ready for pickup',
      });
      logger.info(`📤 Socket notification sent to customer`);
    } else {
      logger.info(`📤 No customer ID - skipping socket notification`);
    }

    logger.info('================================\n');

    return res.status(200).json({
      status: 'success',
      message: 'Takeaway order marked as ready for pickup',
      data: { order },
    });
  }

  order.status = 'READY';
  order.statusHistory.push({
    status: 'READY',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Order prepared and ready for pickup by delivery agent',
  });

  await order.save();

  logger.info(`✅ Order ${order.orderNumber} status changed: ACCEPTED → READY`);

  // Emit socket event to customer (only if customer.id exists)
  if (order.customer && order.customer.id) {
    emitUserNotification(order.customer.id.toString(), {
      type: 'ORDER_READY',
      orderId: order._id,
      orderNumber: order.orderNumber,
      message: 'Your order is ready and will be picked up soon',
    });
  }

  // Emit event to all delivery agents that a new order is available
  emitOrderUpdate(order._id.toString(), {
    type: 'ORDER_AVAILABLE',
    status: 'READY',
    orderNumber: order.orderNumber,
    message: 'New order available for pickup',
  });

  logger.info(`📤 Socket notifications sent to customer and delivery agents`);
  logger.info(`🚚 Order now available for delivery agents to claim`);
  logger.info('================================\n');

  res.status(200).json({
    status: 'success',
    message: 'Order marked as ready',
    data: { order },
  });
});

exports.cancelOrder = catchAsync(async (req, res, next) => {
  const { reason } = req.body;
  
  logger.info(`
================================
===== CANCEL ORDER REQUEST =====
================================
📦 Order ID: ${req.params.id}
👤 Admin: ${req.user.email}
📝 Reason: ${reason || 'Not provided'}
================================`);
  
  const order = await Order.findById(req.params.id);

  if (!order) {
    logger.error(`❌ Order not found: ${req.params.id}`);
    return next(new AppError('Order not found', 404));
  }

  logger.info(`📋 Current Status: ${order.status}`);
  logger.info(`📋 Order Number: ${order.orderNumber}`);

  if (['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status)) {
    logger.warn(`⚠️  Cannot cancel order - already ${order.status}`);
    return next(new AppError('Cannot cancel this order', 400));
  }

  order.status = 'CANCELLED';
  order.statusHistory.push({
    status: 'CANCELLED',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: reason || 'Order cancelled by admin',
  });

  await order.save();

  logger.info(`✅ Order ${order.orderNumber} status changed: ${order.statusHistory[order.statusHistory.length - 2]?.status || 'UNKNOWN'} → CANCELLED`);

  // Emit socket event to customer (only if customer.id exists)
  if (order.customer && order.customer.id) {
    logger.info(`📤 Emitting socket notification to customer: ${order.customer.id}`);
    emitUserNotification(order.customer.id.toString(), {
      type: 'ORDER_CANCELLED',
      orderId: order._id,
      orderNumber: order.orderNumber,
      message: 'Your order has been cancelled',
    });
  } else {
    logger.info(`📤 No customer ID - skipping socket notification`);
  }

  // If order was assigned to delivery agent, notify them
  if (order.deliveryPartner && order.deliveryPartner.id) {
    logger.info(`📤 Emitting socket notification to delivery agent: ${order.deliveryPartner.id}`);
    emitUserNotification(order.deliveryPartner.id.toString(), {
      type: 'ORDER_CANCELLED',
      orderId: order._id,
      orderNumber: order.orderNumber,
      message: 'Order has been cancelled',
    });
  }

  logger.info('================================\n');

  res.status(200).json({
    status: 'success',
    message: 'Order cancelled successfully',
    data: { order },
  });
});

exports.createGuestOrder = catchAsync(async (req, res, next) => {
  const {
    customer,
    items,
    orderType = 'DELIVERY',
    deliveryAddress,
    paymentMethod = 'COD',
    specialInstructions,
  } = req.body;

  // Validation handled by validator middleware, but double-check critical fields
  if (!customer || !customer.name || !customer.phone) {
    return next(new AppError('Customer name and phone are required', 400));
  }

  if (!items || items.length === 0) {
    return next(new AppError('Order must contain at least one item', 400));
  }

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    return next(new AppError('Delivery address is required for delivery orders', 400));
  }

  // Validate menu items exist and are available
  const menuItemIds = items.map((item) => item.menuItem);
  
  // Get unique menu item IDs to avoid duplicate queries
  const uniqueMenuItemIds = [...new Set(menuItemIds)];
  const menuItems = await MenuItem.find({ _id: { $in: uniqueMenuItemIds }, isActive: true });

  // Check if all unique menu items were found
  if (menuItems.length !== uniqueMenuItemIds.length) {
    const foundIds = menuItems.map(mi => mi._id.toString());
    const missingIds = uniqueMenuItemIds.filter(id => !foundIds.includes(id));
    logger.warn(`Missing menu items: ${missingIds.join(', ')}`);
    return next(new AppError('Some menu items do not exist or are not available', 400));
  }

  // Check if all items are available
  const unavailableItems = menuItems.filter(item => !item.isAvailable);
  if (unavailableItems.length > 0) {
    return next(new AppError(`Some menu items are not available: ${unavailableItems.map(i => i.name).join(', ')}`, 400));
  }

  // Get settings for tax and delivery charges
  const settings = await Settings.getSettings();

  // Create or find customer user (for guest orders, we create a basic user record)
  let customerUser = await User.findOne({ 'phone.number': customer.phone });

  if (!customerUser) {
    const nameParts = customer.name.trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'Guest';
    
    const email = customer.email || `${customer.phone}@guest.thetiptop.com`;
    const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
    
    customerUser = await User.create({
      name: {
        first: firstName,
        last: lastName,
      },
      phone: {
        number: customer.phone,
        isVerified: false,
      },
      email: {
        address: email,
        isVerified: customer.email ? false : true, // Auto-verify temp emails
      },
      password: randomPassword,
      role: 'customer',
      isActive: true,
    });
    logger.info(`✨ Created new guest customer: ${customer.name} (${customer.phone})`);
  }

  // Calculate pricing
  let itemsTotal = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find((mi) => mi._id.toString() === item.menuItem);
    if (!menuItem) {
      throw new AppError(`Menu item not found: ${item.menuItem}`, 400);
    }
    
    const portion = item.portion || 'Full';
    
    // Get price from item or calculate from menu item variants
    let price;
    if (item.price) {
      price = item.price;
    } else {
      const variant = menuItem.priceVariants?.find(v => v.quantity === portion);
      price = variant?.price || menuItem.portions?.[portion] || menuItem.basePrice;
    }

    const itemSubtotal = price * item.quantity;
    itemsTotal += itemSubtotal;

    return {
      menuItemId: menuItem._id,
      name: menuItem.name,
      image: menuItem.images?.[0] || '',
      description: menuItem.description || '',
      portion: portion,
      price: price,
      quantity: item.quantity,
      customizations: [],
      subtotal: itemSubtotal,
      isCustom: false,
    };
  });

  // Calculate tax and delivery fee based on settings
  const gst = settings.taxRate ? (itemsTotal * settings.taxRate) / 100 : 0;
  const deliveryFee = orderType === 'DELIVERY' ? (settings.deliveryCharge || 0) : 0;
  const platformFee = settings.platformFee || 0;
  const packagingFee = settings.packagingFee || 0;
  
  const finalAmount = itemsTotal + gst + deliveryFee + platformFee + packagingFee;

  // Prepare delivery address with coordinates
  let formattedDeliveryAddress = undefined;
  if (orderType === 'DELIVERY' && deliveryAddress) {
    formattedDeliveryAddress = {
      street: deliveryAddress.street,
      apartment: deliveryAddress.apartment || '',
      city: deliveryAddress.city,
      state: deliveryAddress.state,
      zipCode: deliveryAddress.zipCode,
      landmark: deliveryAddress.landmark || '',
      coordinates: {
        type: 'Point',
        coordinates: [0, 0], // Guest orders won't have GPS coordinates from website
      },
      deliveryInstructions: specialInstructions || '',
    };
  }

  // Create order with proper schema structure
  const order = await Order.create({
    customer: {
      id: customerUser._id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email || '',
    },
    items: orderItems,
    pricing: {
      itemsTotal: itemsTotal,
      deliveryFee: deliveryFee,
      platformFee: platformFee,
      packagingFee: packagingFee,
      gst: gst,
      discount: 0,
      promoDiscount: 0,
      loyaltyPointsUsed: 0,
      loyaltyDiscount: 0,
      finalAmount: finalAmount,
      roundOff: 0,
    },
    deliveryAddress: formattedDeliveryAddress,
    orderType: orderType,
    placedBy: 'CUSTOMER', // Guest orders are still customer-placed
    status: 'PENDING',
    statusHistory: [
      {
        status: 'PENDING',
        timestamp: new Date(),
        notes: 'Guest order placed from website',
      },
    ],
    paymentMethod: paymentMethod,
    paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PENDING',
    specialInstructions: specialInstructions || '',
    contactlessDelivery: false,
    metadata: {
      orderSource: 'web',
      deviceType: 'web-guest',
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || '',
    },
  });

  // Verify order was saved with a valid order number
  logger.info(`📝 Order created with ID: ${order._id}, OrderNumber: ${order.orderNumber}`);
  
  if (!order._id || !order.orderNumber) {
    logger.error('❌ Order creation failed - missing _id or orderNumber');
    return next(new AppError('Failed to create order - please try again', 500));
  }

  // Validate order number format
  const orderNumberPattern = /^ORD-\d{6,}$/;
  const isValidFormat = orderNumberPattern.test(order.orderNumber);
  logger.info(`🔍 Validating order number: ${order.orderNumber}, Pattern match: ${isValidFormat}`);
  
  if (!isValidFormat) {
    logger.error(`❌ Invalid order number format: ${order.orderNumber}`);
    return next(new AppError('Order created but validation failed - please contact support', 500));
  }

  logger.info(`✅ Guest order created successfully: ${order.orderNumber} for ${customer.name} (${customer.phone})`);

  // Emit socket event for real-time admin panel updates
  try {
    emitNewOrder(order);
  } catch (err) {
    logger.error('⚠️ Failed to emit socket event:', err.message);
    // Don't fail the request if socket emit fails
  }

  // Populate order for response
  await order.populate('items.menuItemId');

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully',
    data: { order },
  });
});

exports.getTodayOrders = catchAsync(async (req, res, next) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Define active and inactive statuses (UPPERCASE to match DB)
  const activeStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];
  const inactiveStatuses = ['DELIVERED', 'CANCELLED', 'REJECTED'];

  // Fetch ALL active/in-progress orders WITH full details (regardless of date)
  // This prevents orders from disappearing after midnight before being completed
  const activeOrders = await Order.find({
    status: { $in: activeStatuses }
  })
    .select('orderNumber customer items pricing status orderType deliveryPartner createdAt deliveryAddress')
    .lean()
    .sort({ createdAt: -1 });

  // Fetch only TODAY'S inactive orders (completed/cancelled) WITHOUT details (summary only)
  const inactiveOrders = await Order.find({
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: inactiveStatuses }
  })
    .select('orderNumber customer.name customer.phone pricing.finalAmount status orderType createdAt items deliveryAddress')
    .lean()
    .sort({ createdAt: -1 });

  // Transform active orders
  const transformedActiveOrders = activeOrders.map(order => {
    // Transform status to match UI (capitalize first letter)
    const statusMap = {
      'PENDING': 'New',
      'pending': 'New',
      'ACCEPTED': 'Accepted',
      'accepted': 'Accepted',
      'PREPARING': 'Preparing',
      'preparing': 'Preparing',
      'READY': 'Ready',
      'ready': 'Ready',
      'READY_FOR_PICKUP': 'Ready for Pickup',
      'ready_for_pickup': 'Ready for Pickup',
      'OUT_FOR_DELIVERY': 'Out for Delivery',
      'out_for_delivery': 'Out for Delivery',
      'DELIVERED': 'Delivered',
      'delivered': 'Delivered',
      'CANCELLED': 'Canceled',
      'cancelled': 'Canceled',
      'REJECTED': 'Canceled',
      'rejected': 'Canceled'
    };

    const transformedItems = order.items?.map(item => ({
      name: item.name,
      portion: item.portion || '',
      quantity: item.quantity,
      price: item.subtotal
    })) || [];

    return {
      id: order._id.toString(),
      orderId: order.orderNumber,
      customer: `${order.customer?.name || 'N/A'}`,
      phone: order.customer?.phone || 'N/A',
      orderType: order.orderType || 'DELIVERY', // Include orderType - critical for UI logic
      items: transformedItems,
      itemCount: order.items?.length || 0,
      total: order.pricing?.finalAmount || 0,
      pricing: {
        itemsTotal: order.pricing?.itemsTotal || 0,
        deliveryFee: order.pricing?.deliveryFee || 0,
        gst: order.pricing?.gst || 0,
        gstRate: order.pricing?.gstRate || 0,
        discount: order.pricing?.discount || 0,
        finalAmount: order.pricing?.finalAmount || 0
      },
      status: statusMap[order.status] || order.status,
      deliveryPartner: order.deliveryPartner ? {
        id: order.deliveryPartner._id?.toString() || order.deliveryPartner.id,
        name: order.deliveryPartner.name,
        phone: order.deliveryPartner.phone,
        vehicleNumber: order.deliveryPartner.vehicleNumber
      } : null,
      date: order.createdAt.toISOString().split('T')[0],
      time: order.createdAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
      address: {
        street: order.deliveryAddress?.street || '',
        city: order.deliveryAddress?.city || '',
        state: order.deliveryAddress?.state || '',
        zip: order.deliveryAddress?.zip || order.deliveryAddress?.postalCode || ''
      },
      image: order.items?.[0]?.image || ''
    };
  });

  // Transform inactive orders (summary only)
  const transformedInactiveOrders = inactiveOrders.map(order => {
    const statusMap = {
      'PENDING': 'New',
      'pending': 'New',
      'ACCEPTED': 'Accepted',
      'accepted': 'Accepted',
      'PREPARING': 'Preparing',
      'preparing': 'Preparing',
      'READY': 'Ready',
      'ready': 'Ready',
      'OUT_FOR_DELIVERY': 'Out for Delivery',
      'out_for_delivery': 'Out for Delivery',
      'DELIVERED': 'Delivered',
      'delivered': 'Delivered',
      'CANCELLED': 'Canceled',
      'cancelled': 'Canceled',
      'REJECTED': 'Canceled',
      'rejected': 'Canceled'
    };

    return {
      id: order._id.toString(),
      orderId: order.orderNumber,
      customer: `${order.customer?.name || 'N/A'}`,
      phone: order.customer?.phone || 'N/A',
      orderType: order.orderType || 'DELIVERY',
      items: [], // Empty for performance - will be populated on expand
      itemCount: order.items?.length || 0,
      total: order.pricing?.finalAmount || 0,
      status: statusMap[order.status] || order.status,
      date: order.createdAt.toISOString().split('T')[0],
      time: order.createdAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
      address: {
        street: order.deliveryAddress?.street || '',
        city: order.deliveryAddress?.city || '',
        state: order.deliveryAddress?.state || '',
        zip: order.deliveryAddress?.zip || order.deliveryAddress?.postalCode || ''
      }
    };
  });

  // Group by status (using transformed status names)
  const groupedOrders = {
    pending: transformedActiveOrders.filter(o => o.status === 'New'),
    accepted: transformedActiveOrders.filter(o => o.status === 'Accepted'),
    preparing: transformedActiveOrders.filter(o => o.status === 'Preparing'),
    ready: transformedActiveOrders.filter(o => o.status === 'Ready'),
    ready_for_pickup: transformedActiveOrders.filter(o => o.status === 'Ready for Pickup'),
    out_for_delivery: transformedActiveOrders.filter(o => o.status === 'Out for Delivery'),
    delivered: transformedInactiveOrders.filter(o => o.status === 'Delivered'),
    cancelled: transformedInactiveOrders.filter(o => o.status === 'Canceled')
  };

  // Log for debugging - include count of orders from previous days
  const ordersFromPreviousDays = activeOrders.filter(order => {
    const orderDate = new Date(order.createdAt);
    orderDate.setHours(0, 0, 0, 0);
    return orderDate < startOfDay;
  }).length;
  
  logger.info(`📊 Today's Orders Summary: Pending=${groupedOrders.pending.length}, Accepted=${groupedOrders.accepted.length}, Ready=${groupedOrders.ready.length}, ReadyForPickup=${groupedOrders.ready_for_pickup.length}, OutForDelivery=${groupedOrders.out_for_delivery.length}, Delivered=${groupedOrders.delivered.length}`);
  
  if (ordersFromPreviousDays > 0) {
    logger.info(`⚠️  Including ${ordersFromPreviousDays} in-progress order(s) from previous day(s) to prevent midnight loss`);
  }

  res.status(200).json({
    status: 'success',
    data: groupedOrders
  });
});

exports.getAllOrders = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Get total count
  const totalOrders = await Order.countDocuments();

  // Fetch orders (summary only but include items for count)
  const orders = await Order.find()
    .select('orderNumber customer.name customer.phone pricing.finalAmount status orderType createdAt items')
    .lean()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  // Transform orders
  const statusMap = {
    'PENDING': 'New',
    'pending': 'New',
    'ACCEPTED': 'Accepted',
    'accepted': 'Accepted',
    'PREPARING': 'Preparing',
    'preparing': 'Preparing',
    'READY': 'Ready',
    'ready': 'Ready',
    'READY_FOR_PICKUP': 'Ready for Pickup',
    'ready_for_pickup': 'Ready for Pickup',
    'OUT_FOR_DELIVERY': 'Ready',
    'out_for_delivery': 'Ready',
    'DELIVERED': 'Delivered',
    'delivered': 'Delivered',
    'CANCELLED': 'Canceled',
    'cancelled': 'Canceled',
    'REJECTED': 'Canceled',
    'rejected': 'Canceled'
  };

  const transformedOrders = orders.map(order => ({
    id: order._id.toString(),
    orderId: order.orderNumber,
    customer: `${order.customer?.name || 'N/A'}`,
    phone: order.customer?.phone || 'N/A',
    orderType: order.orderType || 'DELIVERY',
    items: [], // Will be populated on expand
    itemCount: order.items?.length || 0,
    total: order.pricing?.finalAmount || 0,
    status: statusMap[order.status] || order.status,
    date: order.createdAt.toISOString().split('T')[0],
    time: order.createdAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  }));

  // Add no-cache headers to prevent browser caching
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.status(200).json({
    status: 'success',
    data: {
      orders: transformedOrders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        limit
      }
    }
  });
});

exports.getOrderDetails = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .select('orderNumber customer items pricing status orderType createdAt deliveryAddress')
    .lean();

  if (!order) {
    return res.status(404).json({
      status: 'error',
      message: 'Order not found'
    });
  }

  // Transform to match UI format
  const statusMap = {
    'PENDING': 'New',
    'pending': 'New',
    'ACCEPTED': 'Accepted',
    'accepted': 'Accepted',
    'PREPARING': 'Preparing',
    'preparing': 'Preparing',
    'READY': 'Ready',
    'ready': 'Ready',
    'READY_FOR_PICKUP': 'Ready for Pickup',
    'ready_for_pickup': 'Ready for Pickup',
    'OUT_FOR_DELIVERY': 'Ready',
    'out_for_delivery': 'Ready',
    'DELIVERED': 'Delivered',
    'delivered': 'Delivered',
    'CANCELLED': 'Canceled',
    'cancelled': 'Canceled',
    'REJECTED': 'Canceled',
    'rejected': 'Canceled'
  };

  const transformedOrder = {
    id: order._id.toString(),
    orderId: order.orderNumber,
    customer: `${order.customer?.name || 'N/A'}`,
    phone: order.customer?.phone || 'N/A',
    orderType: order.orderType || 'DELIVERY',
    items: order.items?.map(item => ({
      name: item.name,
      portion: item.portion || '',
      quantity: item.quantity,
      price: item.subtotal
    })) || [],
    itemCount: order.items?.length || 0,
    total: order.pricing?.finalAmount || 0,
    pricing: {
      itemsTotal: order.pricing?.itemsTotal || 0,
      deliveryFee: order.pricing?.deliveryFee || 0,
      gst: order.pricing?.gst || 0,
      gstRate: order.pricing?.gstRate || 0,
      discount: order.pricing?.discount || 0,
      finalAmount: order.pricing?.finalAmount || 0
    },
    status: statusMap[order.status] || order.status,
    date: order.createdAt.toISOString().split('T')[0],
    time: order.createdAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
    address: {
      street: order.deliveryAddress?.street || '',
      city: order.deliveryAddress?.city || '',
      state: order.deliveryAddress?.state || '',
      zip: order.deliveryAddress?.zip || order.deliveryAddress?.postalCode || ''
    },
    image: order.items?.[0]?.image || ''
  };

  res.status(200).json({
    status: 'success',
    data: transformedOrder
  });
});

exports.getPOSMenuItems = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50, category, search } = req.query;

  // Build query - only available items (isActive not checked, only isAvailable matters for ordering)
  const query = { isAvailable: true };

  if (category && category !== 'All') {
    query.categories = category;
  }

  if (search) {
    query.name = { $regex: search, $options: 'i' };
  }
  
  // Get items with minimal fields for fast loading
  const items = await MenuItem.find(query)
    .select('name image categories priceVariants isAvailable')
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await MenuItem.countDocuments(query);
  
  // Transform to POS format
  const posItems = items.map(item => {
    // Get the first category that's not "All"
    const actualCategory = item.categories?.find(cat => cat !== 'All') || item.categories?.[0] || 'Other';
    
    return {
      id: item._id.toString(),
      name: item.name,
      image: item.image || '/images/product/placeholder.jpg',
      category: actualCategory,
      priceVariants: item.priceVariants || [],
      isAvailable: item.isAvailable
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      items: posItems,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        limit: parseInt(limit)
      }
    }
  });
});

exports.createAdminOrder = catchAsync(async (req, res, next) => {
  const {
    items,
    customer,
    deliveryAddress,
    orderType,
    paymentMethod = 'COD' // Cash On Delivery
  } = req.body;

  // Validate required fields
  if (!items || items.length === 0) {
    return next(new AppError('Please add items to the order', 400));
  }

  if (!customer || !customer.name || !customer.phone) {
    return next(new AppError('Customer name and phone are required', 400));
  }

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    return next(new AppError('Delivery address is required for delivery orders', 400));
  }

  // Separate regular menu items from custom/open menu items
  const regularItems = items.filter(item => item.menuItem && item.menuItem !== 'custom');
  const customItems = items.filter(item => !item.menuItem || item.menuItem === 'custom');

  // Validate regular menu items
  let menuItems = [];
  if (regularItems.length > 0) {
    const menuItemIds = regularItems.map(item => item.menuItem);
    // Get unique menu item IDs for validation (same item with different portions)
    const uniqueMenuItemIds = [...new Set(menuItemIds)];
    menuItems = await MenuItem.find({ _id: { $in: uniqueMenuItemIds } }).lean();

    if (menuItems.length !== uniqueMenuItemIds.length) {
      return next(new AppError('Some menu items not found', 404));
    }
  }

  // Calculate pricing
  let itemsTotal = 0;
  const orderItems = [];
  
  // Process regular menu items
  regularItems.forEach(item => {
    const menuItem = menuItems.find(m => m._id.toString() === item.menuItem);
    
    let itemPrice = item.price;
    // If price not provided, find it from variants or base price
    if (!itemPrice) {
      if (item.portion && menuItem.priceVariants) {
        const variant = menuItem.priceVariants.find(v => v.quantity === item.portion);
        itemPrice = variant ? variant.price : menuItem.price;
      } else {
        itemPrice = menuItem.price;
      }
    }

    const subtotal = itemPrice * item.quantity;
    itemsTotal += subtotal;

    orderItems.push({
      menuItemId: menuItem._id,
      name: menuItem.name,
      image: menuItem.image,
      portion: item.portion || 'Regular',
      quantity: item.quantity,
      price: itemPrice,
      subtotal
    });
  });
  
  // Process custom/open menu items
  customItems.forEach(item => {
    if (!item.name || !item.price) {
      throw new AppError('Custom items must have name and price', 400);
    }
    
    const itemPrice = parseFloat(item.price);
    const subtotal = itemPrice * item.quantity;
    itemsTotal += subtotal;

    orderItems.push({
      menuItemId: null, // No menu item reference for custom items
      name: item.name,
      image: '/images/product/custom-item.jpg',
      portion: item.portion || 'Custom',
      quantity: item.quantity,
      price: itemPrice,
      subtotal,
      isCustom: true
    });
  });

  // Get settings for tax and delivery
  const settings = await Settings.findOne();
  
  // Use taxRate and deliveryCharge from Settings model
  const taxRate = settings?.taxRate || 0;
  const deliveryFee = orderType === 'DELIVERY' ? (settings?.deliveryCharge || 0) : 0;

  const tax = (itemsTotal * taxRate) / 100;
  const finalAmount = itemsTotal + tax + deliveryFee;

  // Generate order number
  const orderCount = await Order.countDocuments();
  const orderNumber = `ORD-${String(orderCount + 1).padStart(6, '0')}`;

  // Create order
  const order = await Order.create({
    orderNumber,
    customer: {
      // No customer.id for admin orders - they're walk-in/phone customers
      name: customer.name,
      phone: customer.phone,
      email: customer.email || ''
    },
    items: orderItems,
    pricing: {
      itemsTotal,
      deliveryFee,
      gst: tax,
      gstRate: taxRate,
      discount: 0,
      finalAmount
    },
    deliveryAddress: orderType === 'DELIVERY' ? {
      street: deliveryAddress.street,
      city: deliveryAddress.city,
      state: deliveryAddress.state,
      zipCode: deliveryAddress.zipCode
    } : undefined,
    orderType: orderType || 'DELIVERY',
    paymentMethod,
    paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PAID',
    status: 'PENDING',
    placedBy: 'ADMIN',
    placedByUser: req.user?._id,
    estimatedDeliveryTime: new Date(Date.now() + 45 * 60000) // 45 minutes
  });

  // Emit socket event for new order
  try {
    emitNewOrder(order);
  } catch (error) {
    logger.error('Socket emit error:', error);
  }

  logger.info(`✅ Admin order created: ${orderNumber}`);

  res.status(201).json({
    status: 'success',
    data: {
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        customer: order.customer,
        items: order.items,
        pricing: order.pricing,
        status: order.status,
        orderType: order.orderType
      }
    }
  });
});

exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  
  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { 
      status,
      $push: {
        statusHistory: {
          status,
          timestamp: new Date(),
          updatedBy: req.user?._id
        }
      }
    },
    { new: true, runValidators: true }
  );

  if (!order) {
    return res.status(404).json({
      status: 'error',
      message: 'Order not found'
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      orderId: order.orderNumber,
      newStatus: order.status
    }
  });
});

/* =====================================================
   CUSTOMER RELATED ORDER CONTROLLERS
===================================================== */

exports.createOrder = catchAsync(async (req, res, next) => {
  const {
    items,
    deliveryAddress,
    paymentMethod,
    paymentDetails,
    contactPhone,
    scheduledFor,
    specialInstructions,
    promoCode,
  } = req.body;

  // Validate menu items exist and are available
  
  const menuItemIds = items.map((item) => item.menuItem);
  logger.info(`Received ${menuItemIds.length} menu item IDs: ${menuItemIds.join(', ')}`);
  
  // Convert to ObjectIds and remove duplicates
  const uniqueIds = [...new Set(menuItemIds)];
  logger.info(`Unique IDs after deduplication: ${uniqueIds.length}`);
  
  // First check if items exist at all
  const allItems = await MenuItem.find({
    _id: { $in: uniqueIds }
  });
  
  logger.info(`Found ${allItems.length} items in database (regardless of availability)`);
  if (allItems.length > 0) {
    allItems.forEach(item => {
      logger.info(`  ✓ Item ${item._id}: "${item.name}", isAvailable=${item.isAvailable}, isActive=${item.isActive}`);
    });
  } else {
    logger.error('❌ No items found in database!');
    logger.info('Checking if IDs are valid ObjectIds...');
    uniqueIds.forEach(id => {
      const isValid = mongoose.Types.ObjectId.isValid(id);
      logger.info(`  ID ${id}: ${isValid ? 'Valid' : 'INVALID'}`);
    });
  }
  
  const menuItems = await MenuItem.find({
    _id: { $in: uniqueIds },
    isAvailable: true,
    isActive: true,
  });
  
  logger.info(`Found ${menuItems.length} available items out of ${uniqueIds.length} unique requested`);
  
  if (menuItems.length !== uniqueIds.length) {
    // Find which items are missing
    const foundIds = menuItems.map(item => item._id.toString());
    const missingIds = uniqueIds.filter(id => !foundIds.includes(id.toString()));
    logger.error(`❌ Missing or unavailable menu items: ${missingIds.join(', ')}`);
    
    return next(
      new AppError('Some menu items are not available or do not exist', 400)
    );
  }

  // Fetch settings for dynamic charges
  const settings = await Settings.getSettings();

  // Calculate order totals
  let subtotal = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find(
      (mi) => mi._id.toString() === item.menuItem.toString()
    );

    if (!menuItem) {
      logger.error(`Menu item not found: ${item.menuItem}`);
      throw new AppError('Menu item not found', 404);
    }

    // Get price - if item.price is provided (from frontend with selected portion), use it
    // Otherwise, get from first priceVariant
    let itemPrice = item.price || 0;
    if (!itemPrice && menuItem.priceVariants && menuItem.priceVariants.length > 0) {
      itemPrice = menuItem.priceVariants[0].price;
    }

    const customizationPrice = item.customizations
      ? item.customizations.reduce((sum, c) => sum + (c.price || 0), 0)
      : 0;
    const itemTotal = (itemPrice + customizationPrice) * item.quantity;

    subtotal += itemTotal;

    return {
      menuItemId: menuItem._id,
      name: menuItem.name,
      image: menuItem.image,
      description: menuItem.description,
      portion: item.portion || '',
      quantity: item.quantity,
      price: itemPrice,
      customizations: item.customizations || [],
      subtotal: itemTotal,
    };
  });

  // Check minimum order amount
  const minimumOrderAmount = settings.minimumOrderAmount || 0;
  if (subtotal < minimumOrderAmount) {
    return next(
      new AppError(`Minimum order amount is ₹${minimumOrderAmount}. Your cart total is ₹${subtotal.toFixed(2)}`, 400)
    );
  }

  // Calculate delivery charges from settings
  const deliveryCharges = settings.deliveryCharge || 0;

  // Calculate taxes from settings
  const taxRate = settings.taxRate || 0;
  const taxAmount = (subtotal + deliveryCharges) * (taxRate / 100);

  // TODO: Apply promo code if provided
  const discountAmount = 0;

  // Calculate final amount
  const finalAmount = subtotal + deliveryCharges + taxAmount - discountAmount;

  // Generate unique order number
  const orderCount = await Order.countDocuments();
  const orderNumber = `ORD-${String(orderCount + 1).padStart(6, '0')}`;

  // Determine payment status based on method
  const paymentStatus = paymentMethod === 'COD' ? 'PENDING' : 
                       paymentDetails?.transactionId ? 'PAID' : 'PENDING';

  // Create order
  const order = await Order.create({
    orderNumber,
    customer: {
      id: req.user._id,
      name: `${req.user.name.first} ${req.user.name.last}`,
      phone: contactPhone || req.user.phone.number,
      email: req.user.email.address,
    },
    items: orderItems,
    pricing: {
      itemsTotal: subtotal,
      deliveryFee: deliveryCharges,
      gst: taxAmount,
      discount: discountAmount,
      finalAmount,
    },
    deliveryAddress,
    paymentMethod,
    paymentStatus,
    paymentDetails: paymentDetails || {},
    scheduledFor: scheduledFor || Date.now(),
    specialInstructions,
    statusHistory: [{
      status: 'PENDING',
      timestamp: new Date(),
      updatedBy: req.user._id,
      notes: 'Order placed',
    }],
    metadata: {
      isFirstOrder: req.user.customerData.totalOrders === 0,
      orderSource: 'mobile',
      deviceType: req.headers['user-agent'] || 'unknown',
    },
  });

  // Update menu item stats
  for (const item of orderItems) {
    await MenuItem.findByIdAndUpdate(
      item.menuItem,
      {
        $inc: {
          'stats.totalOrders': item.quantity,
          'stats.totalRevenue': item.subtotal,
        },
      },
      { new: false }
    );
  }

  // Update customer stats
  req.user.customerData.totalOrders += 1;
  req.user.customerData.totalSpent += finalAmount;
  await req.user.save({ validateBeforeSave: false });

  logger.info(`✅ Order created: ${order.orderNumber} by ${req.user.email.address} - Amount: ₹${finalAmount}`);

  // Send notifications
  try {
    emitUserNotification(req.user._id.toString(), {
      type: 'order_placed',
      title: 'Order Placed Successfully',
      message: `Your order ${order.orderNumber} has been placed successfully`,
      orderId: order._id,
    });
  } catch (err) {
    logger.error('Failed to emit customer notification:', err.message);
  }

  try {
    emitNewOrder(order);
  } catch (err) {
    logger.error('Failed to emit new order event:', err.message);
  }

  try {
    const deviceTokens = req.user.getActiveDeviceTokens();
    if (deviceTokens && deviceTokens.length > 0) {
      for (const token of deviceTokens) {
        await notificationService.sendOrderNotification(order, token);
      }
    }
  } catch (err) {
    logger.error('Failed to send push notification:', err.message);
  }

  try {
    const admins = await User.find({ role: 'admin', isActive: true });
    for (const admin of admins) {
      const adminTokens = admin.getActiveDeviceTokens();
      if (adminTokens && adminTokens.length > 0) {
        for (const token of adminTokens) {
          await notificationService.sendCustomNotification(
            token,
            '🔔 New Order Received!',
            `Order #${order.orderNumber} - ${order.customer.name} - ₹${order.pricing.finalAmount.toFixed(2)}`,
            {
              type: 'NEW_ORDER',
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              customerName: order.customer.name,
              amount: order.pricing.finalAmount.toString(),
              itemCount: order.items.length.toString(),
            }
          );
        }
      }
    }
  } catch (err) {
    logger.error('Failed to send admin push notification:', err.message);
  }

  try {
    if (settings.notificationEmails && settings.notificationEmails.length > 0) {
      for (const email of settings.notificationEmails) {
        await emailService.sendOrderConfirmation(order, email);
      }
    }
  } catch (err) {
    logger.error('Failed to send order notification email:', err.message);
  }

  try {
    const customerEmail = req.user.email.address;
    await emailService.sendOrderConfirmation(customerEmail, {
      orderNumber: order.orderNumber,
      customer: {
        name: `${req.user.name.first} ${req.user.name.last}`,
        phone: req.user.phone,
      },
      items: orderItems.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal,
        portion: item.portion,
      })),
      pricing: order.pricing,
      deliveryAddress: order.deliveryAddress,
      estimatedDeliveryTime: order.estimatedDeliveryTime,
    });
  } catch (err) {
    logger.error('Failed to send order confirmation email:', err.message);
  }

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully',
    data: {
      order,
    },
  });
});

exports.getMyOrders = catchAsync(async (req, res, next) => {
  const features = new APIFeatures(
    Order.find({ 'customer.id': req.user._id }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const result = await features.execute(Order);

  res.status(200).json({
    status: 'success',
    results: result.data.length,
    pagination: result.pagination,
    data: {
      orders: result.data,
    },
  });
});

// OLD FUNCTION - REPLACED BY ADMIN-SPECIFIC VERSION ABOVE (line 874)
// This was for delivery partners to see their orders
exports.getAllOrders_OLD_DELIVERY = catchAsync(async (req, res, next) => {
  let query = Order.find();

  // If delivery partner, show only assigned orders
  if (req.user.hasRole('delivery')) {
    query = Order.find({ 'deliveryPartner.id': req.user._id });
  }

  const features = new APIFeatures(query, req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const result = await features.execute(Order);

  res.status(200).json({
    status: 'success',
    results: result.data.length,
    pagination: result.pagination,
    data: {
      orders: result.data,
    },
  });
});

exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const { status, notes } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check if delivery partner is updating their own order
  if (req.user.role === 'delivery') {
    if (
      !order.deliveryPartner ||
      !order.deliveryPartner.id ||
      order.deliveryPartner.id.toString() !== req.user._id.toString()
    ) {
      return next(
        new AppError('You can only update orders assigned to you', 403)
      );
    }
  }

  // Use model method to update status
  await order.updateStatus(status, notes);

  logger.info(
    `Order ${order.orderNumber} status updated to ${status} by ${req.user.email.address}`
  );

  // Emit real-time order status update
  try {
    emitOrderUpdate(order._id.toString(), {
      status: order.status,
      message: `Order status updated to ${status}`,
      orderNumber: order.orderNumber,
    });

    // Notify customer
    emitUserNotification(order.customer.id.toString(), {
      type: 'order_status_update',
      title: 'Order Status Updated',
      message: `Your order ${order.orderNumber} is now ${status}`,
      orderId: order._id,
      status: order.status,
    });
  } catch (err) {
    logger.warn('Failed to emit status update:', err.message);
  }

  // Send push notifications based on status
  try {
    const customer = await User.findById(order.customer.id);
    if (customer) {
      const customerTokens = customer.getActiveDeviceTokens();
      
      if (customerTokens && customerTokens.length > 0) {
        logger.info(`[STATUS UPDATE NOTIFICATION] Sending to customer on ${customerTokens.length} device(s) - Status: ${status}`);
        
        // Map status to notification messages
        const statusNotifications = {
          'CONFIRMED': {
            title: '✅ Order Confirmed!',
            body: `Your order #${order.orderNumber} has been confirmed and is being prepared.`,
            type: 'ORDER_CONFIRMED'
          },
          'PREPARING': {
            title: '👨‍🍳 Order Preparing',
            body: `Your order #${order.orderNumber} is being prepared by our kitchen.`,
            type: 'ORDER_PREPARING'
          },
          'READY': {
            title: '🎉 Order Ready!',
            body: `Your order #${order.orderNumber} is ready for pickup!`,
            type: 'ORDER_READY'
          },
          'OUT_FOR_DELIVERY': {
            title: '🚚 Out for Delivery!',
            body: `Your order #${order.orderNumber} is on its way to you!`,
            type: 'ORDER_OUT_FOR_DELIVERY'
          },
          'DELIVERED': {
            title: '✅ Order Delivered!',
            body: `Your order #${order.orderNumber} has been delivered. Enjoy your meal!`,
            type: 'ORDER_DELIVERED'
          },
          'CANCELLED': {
            title: '❌ Order Cancelled',
            body: `Your order #${order.orderNumber} has been cancelled.`,
            type: 'ORDER_CANCELLED'
          }
        };
        
        const notification = statusNotifications[status];
        if (notification) {
          for (const token of customerTokens) {
            await notificationService.sendCustomNotification(
              token,
              notification.title,
              notification.body,
              {
                type: notification.type,
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                status: status,
                timestamp: new Date().toISOString(),
              }
            );
          }
        }
      } else {
        logger.info(`[STATUS UPDATE NOTIFICATION] No active device tokens for customer ${customer._id}`);
      }
    }
  } catch (err) {
    logger.warn('[STATUS UPDATE NOTIFICATION] Failed to send push notification:', err.message);
  }

  res.status(200).json({
    status: 'success',
    message: 'Order status updated successfully',
    data: {
      order,
    },
  });
});

exports.assignDeliveryPartner = catchAsync(async (req, res, next) => {
  const { deliveryPartnerId } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check if delivery partner exists and is available
  const deliveryPartner = await User.findOne({
    _id: deliveryPartnerId,
    role: 'delivery',
    isActive: true,
  });

  if (!deliveryPartner) {
    return next(new AppError('Delivery partner not found or not available', 404));
  }

  // Use model method to assign delivery partner
  await order.assignDeliveryPartner(deliveryPartnerId, {
    name: `${deliveryPartner.name.first} ${deliveryPartner.name.last}`,
    phone: deliveryPartner.phone.number,
    vehicleNumber: deliveryPartner.deliveryData?.vehicleNumber || 'N/A'
  });

  logger.info(
    `Order ${order.orderNumber} assigned to ${deliveryPartner.name.first} ${deliveryPartner.name.last} by ${req.user.email.address}`
  );

  // Send push notification to delivery partner
  try {
    const deliveryTokens = deliveryPartner.getActiveDeviceTokens();
    if (deliveryTokens && deliveryTokens.length > 0) {
      logger.info(`[DELIVERY NOTIFICATION] Sending to ${deliveryTokens.length} device(s) for delivery partner ${deliveryPartner.email.address}`);
      
      for (const token of deliveryTokens) {
        await notificationService.sendCustomNotification(
          token,
          '📦 New Delivery Assigned!',
          `Order #${order.orderNumber} - ${order.customer.name} - ₹${order.pricing.finalAmount.toFixed(2)}`,
          {
            type: 'DELIVERY_ASSIGNED',
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            customerName: order.customer.name,
            customerPhone: order.customer.phone,
            deliveryAddress: JSON.stringify(order.deliveryAddress),
            amount: order.pricing.finalAmount.toString(),
          }
        );
      }
    } else {
      logger.info(`[DELIVERY NOTIFICATION] No active device tokens found for delivery partner ${deliveryPartner._id}`);
    }
  } catch (err) {
    logger.warn('[DELIVERY NOTIFICATION] Failed to send push notification:', err.message);
  }

  res.status(200).json({
    status: 'success',
    message: 'Delivery partner assigned successfully',
    data: {
      order,
    },
  });
});

exports.getPendingOrders = catchAsync(async (req, res, next) => {
  const orders = await Order.findPending();

  res.status(200).json({
    status: 'success',
    results: orders.length,
    data: {
      orders,
    },
  });
});

exports.getOrdersByStatus = catchAsync(async (req, res, next) => {
  const { status } = req.params;

  let query = { status };

  // If delivery partner, filter by assigned orders
  if (req.user.hasRole('delivery')) {
    query['deliveryPartner.id'] = req.user._id;
  }

  const orders = await Order.findByStatus(status);

  res.status(200).json({
    status: 'success',
    results: orders.length,
    data: {
      orders,
    },
  });
});

exports.rateOrder = catchAsync(async (req, res, next) => {
  const { foodRating, deliveryRating, packagingRating, comment } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check if customer owns this order
  if (order.customer.id.toString() !== req.user._id.toString()) {
    return next(
      new AppError('You can only rate your own orders', 403)
    );
  }

  // Check if order is delivered
  if (order.status !== 'delivered') {
    return next(
      new AppError('You can only rate delivered orders', 400)
    );
  }

  // Check if already rated
  if (order.rating && order.rating.foodRating) {
    return next(new AppError('Order has already been rated', 400));
  }

  // Update rating
  order.rating = {
    foodRating,
    deliveryRating,
    packagingRating,
    overallRating:
      (foodRating + deliveryRating + packagingRating) / 3,
    comment,
    ratedAt: Date.now(),
  };

  await order.save();

  // Update delivery partner rating if assigned
  if (order.deliveryPartner && order.deliveryPartner.id) {
    const dp = await User.findById(order.deliveryPartner.id);
    if (dp) {
      const totalDeliveries = dp.deliveryData.totalDeliveries || 0;
      const currentRating = dp.deliveryData.rating || 0;
      const newRating =
        (currentRating * totalDeliveries + deliveryRating) /
        (totalDeliveries + 1);
      dp.deliveryData.rating = newRating;
      await dp.save({ validateBeforeSave: false });
    }
  }

  logger.info(
    `Order ${order.orderNumber} rated by ${req.user.email.address} - Overall: ${order.rating.overallRating}`
  );

  res.status(200).json({
    status: 'success',
    message: 'Thank you for your feedback!',
    data: {
      order,
    },
  });
});

exports.customerCancelOrder = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify order belongs to customer
  if (order.customer.id.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only cancel your own orders', 403));
  }

  // Can only cancel if PENDING
  if (order.status !== 'PENDING') {
    return next(new AppError('Order can only be cancelled when in PENDING status', 400));
  }

  order.status = 'CANCELLED';
  order.statusHistory.push({
    status: 'CANCELLED',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Cancelled by customer',
  });

  await order.save();

  logger.info(`Order ${order.orderNumber} cancelled by customer ${req.user.email.address}`);

  // Notify admin
  emitOrderUpdate({
    type: 'order_cancelled',
    orderId: order._id,
    orderNumber: order.orderNumber,
    cancelledBy: 'customer',
  });

  res.status(200).json({
    status: 'success',
    message: 'Order cancelled successfully',
    data: { order },
  });
});

exports.getOrderStats = catchAsync(async (req, res, next) => {
  const stats = await Order.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRevenue: { $sum: '$pricing.finalAmount' },
        avgOrderValue: { $avg: '$pricing.finalAmount' },
      },
    },
  ]);

  const overview = await Order.aggregate([
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$pricing.finalAmount' },
        avgOrderValue: { $avg: '$pricing.finalAmount' },
        avgDeliveryTime: { $avg: '$actualDeliveryTime' },
      },
    },
  ]);

  // Get orders by payment method
  const paymentMethodStats = await Order.aggregate([
    {
      $group: {
        _id: '$paymentMethod',
        count: { $sum: 1 },
        totalAmount: { $sum: '$pricing.finalAmount' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      overview: overview[0] || {},
      statusStats: stats,
      paymentMethodStats,
    },
  });
});

exports.markOrderPickedUp = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify this order is assigned to current delivery partner (skip check for admin)
  if (req.user.role !== 'admin') {
    if (!order.deliveryPartner?.id || order.deliveryPartner.id.toString() !== req.user._id.toString()) {
      return next(new AppError('This order is not assigned to you', 403));
    }
  }

  if (order.status !== 'READY') {
    return next(new AppError(`Cannot pick up order. Current status: ${order.status}`, 400));
  }

  // Update status
  order.status = 'OUT_FOR_DELIVERY';
  order.deliveryPartner.pickedUpAt = new Date();
  order.statusHistory.push({
    status: 'OUT_FOR_DELIVERY',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Order picked up by delivery partner',
  });

  await order.save();

  const userEmail = typeof req.user.email === 'string' ? req.user.email : req.user.email?.address || 'Unknown';
  logger.info(`Order ${order.orderNumber} picked up by partner ${userEmail}`);

  // Notify customer
  const customerId = order.customer?.id || order.customer?._id || order.customer;
  if (customerId) {
    emitUserNotification(customerId.toString(), {
      type: 'order_picked_up',
      title: 'Order On The Way',
      message: `${order.deliveryPartner.name} is on the way with your order`,
      orderId: order._id,
      partner: {
        name: order.deliveryPartner.name,
        phone: order.deliveryPartner.phone,
      },
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'Order marked as picked up',
    data: { order },
  });
});

exports.markOrderDelivered = catchAsync(async (req, res, next) => {
  const { collectedAmount, changeFund } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify this order is assigned to current delivery partner (skip check for admin)
  if (req.user.role !== 'admin') {
    if (!order.deliveryPartner?.id || order.deliveryPartner.id.toString() !== req.user._id.toString()) {
      return next(new AppError('This order is not assigned to you', 403));
    }
  }

  if (order.status !== 'OUT_FOR_DELIVERY') {
    return next(new AppError(`Cannot deliver order. Current status: ${order.status}`, 400));
  }

  // Update status
  order.status = 'DELIVERED';
  order.deliveryPartner.deliveredAt = new Date();
  order.actualDeliveryTime = new Date();
  
  // Handle COD payment
  if (order.paymentMethod === 'COD') {
    order.cashCollection = {
      expectedAmount: order.pricing.finalAmount,
      collectedAmount: collectedAmount || order.pricing.finalAmount,
      changeFund: changeFund || 0,
      collectedAt: new Date(),
      isSettled: false,
    };
    order.paymentStatus = 'PAID';
  }

  order.statusHistory.push({
    status: 'DELIVERED',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Order delivered successfully',
  });

  await order.save();

  const userEmail = typeof req.user.email === 'string' ? req.user.email : req.user.email?.address || 'Unknown';
  logger.info(`Order ${order.orderNumber} delivered by partner ${userEmail}`);

  // Notify customer
  const customerId = order.customer?.id || order.customer?._id || order.customer;
  if (customerId) {
    emitUserNotification(customerId.toString(), {
      type: 'order_delivered',
      title: 'Order Delivered',
      message: `Your order ${order.orderNumber} has been delivered. Enjoy your meal!`,
      orderId: order._id,
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'Order marked as delivered',
    data: { order },
  });
});

exports.getAssignedOrders = catchAsync(async (req, res, next) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Fetch ALL assigned orders regardless of creation date
  // This ensures orders assigned yesterday but not delivered yet remain visible
  const orders = await Order.find({
    'deliveryPartner.id': req.user._id,
    status: { $in: ['READY', 'OUT_FOR_DELIVERY'] },
  })
    .sort('-createdAt')
    .select('-__v');
  
  // Also fetch today's DELIVERED orders for this delivery partner
  const deliveredOrders = await Order.find({
    'deliveryPartner.id': req.user._id,
    status: 'DELIVERED',
    'deliveryPartner.deliveredAt': { 
      $gte: startOfDay,
      $lte: now
    }
  })
    .sort('-deliveryPartner.deliveredAt')
    .select('-__v');
  
  // Combine active and delivered orders
  const allOrders = [...orders, ...deliveredOrders];

  logger.info(`Delivery agent ${req.user._id} - Active: ${orders.length}, Delivered Today: ${deliveredOrders.length}`);

  res.status(200).json({
    status: 'success',
    results: allOrders.length,
    data: { orders: allOrders },
  });
});

/* =====================================================
   THERMAL PRINTER SERVICE ENDPOINTS
===================================================== */

/**
 * Get pending orders that need to be printed
 * Used by the thermal printer desktop application
 */
exports.getPendingPrintOrders = catchAsync(async (req, res, next) => {
  logger.info('🖨️  Thermal printer service requesting pending orders');
  
  // Find accepted orders that haven't been printed yet
  const orders = await Order.find({
    status: 'ACCEPTED',
    isPrinted: { $ne: true },
  })
    .sort({ createdAt: 1 }) // Oldest first
    .limit(10) // Max 10 orders at once to prevent overwhelming
    .populate('customer.id', 'name phone email')
    .populate('items.menuItemId', 'name')
    .select('-__v')
    .lean();

  logger.info(`📥 Found ${orders.length} order(s) pending print`);
  
  if (orders.length > 0) {
    logger.info(`📋 Order numbers: ${orders.map(o => o.orderNumber).join(', ')}`);
  }

  res.status(200).json({
    success: true,
    data: {
      orders: orders.map(order => ({
        _id: order._id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        orderType: order.orderType,
        status: order.status,
        customer: {
          name: order.customer?.name || 'Guest',
          phone: order.customer?.phone || '',
          email: order.customer?.email || '',
        },
        items: order.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          portion: item.portion,
          variant: item.portion, // Backward compatibility
          variantName: item.portion,
          customizations: item.customizations || [],
        })),
        pricing: {
          subtotal: order.pricing?.itemsTotal || 0,
          tax: order.pricing?.gst || 0,
          deliveryFee: order.pricing?.deliveryFee || 0,
          finalAmount: order.pricing?.finalAmount || 0,
        },
        specialInstructions: order.specialInstructions || '',
      })),
    },
  });
});

/**
 * Mark an order as printed
 * Called by thermal printer after successful print
 */
exports.markOrderAsPrinted = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { printedAt } = req.body;

  logger.info(`🖨️  Marking order ${orderId} as printed`);

  // Update order
  const order = await Order.findByIdAndUpdate(
    orderId,
    {
      isPrinted: true,
      printedAt: printedAt || new Date(),
    },
    { new: true, runValidators: false }
  );

  if (!order) {
    logger.error(`❌ Order ${orderId} not found`);
    return next(new AppError('Order not found', 404));
  }

  logger.info(`✅ Order ${order.orderNumber} marked as printed`);

  res.status(200).json({
    success: true,
    message: 'Order marked as printed',
    data: {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        isPrinted: order.isPrinted,
        printedAt: order.printedAt,
      },
    },
  });
});

// Mark order for thermal printing (admin action)
exports.markOrderForPrint = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  logger.info(`📋 Admin marking order ${orderId} for thermal printing`);

  const order = await Order.findByIdAndUpdate(
    orderId,
    {
      isPrinted: false, // Mark as not printed so thermal printer picks it up
      status: 'ACCEPTED', // Ensure status is ACCEPTED (uppercase to match query)
      updatedAt: new Date(),
    },
    { new: true }
  );

  if (!order) {
    logger.error(`❌ Order ${orderId} not found`);
    return next(new AppError('Order not found', 404));
  }

  logger.info(`✅ Order ${order.orderNumber} marked for thermal printing`);

  res.status(200).json({
    success: true,
    message: 'Order will be printed on thermal printer shortly',
    data: {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        isPrinted: order.isPrinted,
        status: order.status,
      },
    },
  });
});

module.exports = exports;
