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

/**
 * Accept order (Admin accepts pending order)
 * PATCH /api/v1/admin/orders/:id/accept
 * Admin only
 */
exports.acceptOrder = catchAsync(async (req, res, next) => {
  logger.info('\n===== ACCEPT ORDER REQUEST =====');
  logger.info(`📦 Order ID: ${req.params.id}`);
  logger.info(`👤 Admin: ${req.user.email}`);

  const order = await Order.findById(req.params.id);

  if (!order) {
    logger.error(`❌ Order not found: ${req.params.id}`);
    return next(new AppError('Order not found', 404));
  }

  logger.info(`📋 Order Number: ${order.orderNumber}`);
  logger.info(`📊 Current Status: ${order.status}`);

  if (order.status !== 'PENDING') {
    logger.warn(`⚠️  Cannot accept - Order status is ${order.status}, expected PENDING`);
    return next(new AppError('Only pending orders can be accepted', 400));
  }

  order.status = 'ACCEPTED';
  order.statusHistory.push({
    status: 'ACCEPTED',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Order accepted by admin',
  });

  await order.save();

  logger.info(`✅ Order ${order.orderNumber} status changed: PENDING → ACCEPTED`);

  // Emit socket event to customer (only if customer.id exists)
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

  logger.info('================================\n');

  res.status(200).json({
    status: 'success',
    message: 'Order accepted successfully',
    data: { order },
  });
});

/**
 * Mark order as preparing (Kitchen started preparing)
 * PATCH /api/v1/admin/orders/:id/preparing
 * Admin only
 */
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

/**
 * Mark order as ready (Order prepared, ready for delivery agent to claim)
 * PATCH /api/v1/admin/orders/:id/ready
 * Admin only
 */
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

/**
 * Cancel order
 * PATCH /api/v1/admin/orders/:id/cancel
 * Admin only
 */
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

/**
 * Create guest order (no authentication required)
 * POST /api/v1/orders/guest/create
 * Public
 */
exports.createGuestOrder = catchAsync(async (req, res, next) => {
  const {
    customer,
    items,
    orderType,
    deliveryAddress,
    paymentMethod = 'COD',
  } = req.body;

  // Validation
  if (!customer || !customer.name || !customer.phone) {
    return next(new AppError('Customer name and phone are required', 400));
  }

  if (!items || items.length === 0) {
    return next(new AppError('Order must contain at least one item', 400));
  }

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    return next(new AppError('Delivery address is required for delivery orders', 400));
  }

  // Validate menu items
  const menuItemIds = items.map((item) => item.menuItem);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });

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
  let customerUser = await User.findOne({ 'phone.number': customer.phone });

  if (!customerUser) {
    const nameParts = customer.name.trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'Guest';
    
    const email = `${customer.phone}@guest.thetiptop.com`;
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
        isVerified: true,
      },
      password: randomPassword,
      role: 'customer',
      isActive: true,
    });
    logger.info(`Created new guest customer: ${customer.name} (${customer.phone})`);
  }

  // Calculate pricing
  let itemsTotal = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find((mi) => mi._id.toString() === item.menuItem);
    const portion = item.portion || 'Full';
    
    let price;
    if (item.price) {
      price = item.price;
    } else {
      const variant = menuItem.priceVariants?.find(v => v.quantity === portion);
      price = variant?.price || menuItem.portions?.[portion] || menuItem.basePrice;
    }

    const itemTotal = price * item.quantity;
    itemsTotal += itemTotal;

    return {
      menuItem: menuItem._id,
      name: menuItem.name,
      portion,
      quantity: item.quantity,
      price,
      total: itemTotal,
    };
  });

  // Calculate tax and delivery
  const taxAmount = settings.taxRate ? (itemsTotal * settings.taxRate) / 100 : 0;
  const deliveryCharge = orderType === 'DELIVERY' ? settings.deliveryCharge || 0 : 0;
  const total = itemsTotal + taxAmount + deliveryCharge;

  // Create order
  const order = await Order.create({
    customer: {
      id: customerUser._id,
      name: customer.name,
      phone: customer.phone,
    },
    items: orderItems,
    pricing: {
      itemsTotal,
      taxRate: settings.taxRate || 0,
      taxAmount,
      deliveryCharge,
      total,
    },
    orderType,
    deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : undefined,
    paymentMethod,
    paymentStatus: 'PENDING',
    status: 'NEW',
    statusHistory: [
      {
        status: 'NEW',
        timestamp: new Date(),
        notes: 'Guest order created',
      },
    ],
  });

  logger.info(`✅ Guest order created: ${order.orderNumber} for ${customer.name}`);

  // Emit socket event for admin
  emitOrderUpdate({
    type: 'NEW_ORDER',
    order: order,
  });

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully',
    data: { order },
  });
});

module.exports = exports;
