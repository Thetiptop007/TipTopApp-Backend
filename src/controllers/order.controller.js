const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const APIFeatures = require('../utils/APIFeatures');
const logger = require('../utils/logger');
const { emitOrderUpdate, emitUserNotification, emitNewOrder } = require('../utils/socket');
const emailService = require('../services/email.service');
const notificationService = require('../services/notification.service');

/**
 * Create new order
 * POST /api/v1/orders
 * Customer only
 */
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
  logger.info('\n========== BACKEND RECEIVED ORDER ==========');
  logger.info('Items from frontend:');
  items.forEach((item, idx) => {
    logger.info(`\n  Item ${idx + 1}:`);
    logger.info(`    - ID: ${item.menuItem}`);
    logger.info(`    - Quantity: ${item.quantity}`);
    logger.info(`    - Price: ${item.price || 'NOT PROVIDED'}`);
    logger.info(`    - PORTION: ${item.portion || 'NOT PROVIDED'}`);
    logger.info(`    - Full item:`, JSON.stringify(item, null, 2));
  });
  logger.info('==========================================\n');
  
  const menuItemIds = items.map((item) => item.menuItem);
  logger.info(`Received ${menuItemIds.length} menu item IDs: ${menuItemIds.join(', ')}`);
  
  // Convert to ObjectIds and remove duplicates
  const mongoose = require('mongoose');
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
      logger.info(`  ⚠️  Using fallback price from priceVariants[0]: ${itemPrice}`);
    } else if (item.price) {
      logger.info(`  ✓ Using price from frontend: ${item.price}`);
    }
    
    logger.info(`Item: ${menuItem.name}, Final Price: ${itemPrice}, Quantity: ${item.quantity}, Subtotal: ${itemPrice * item.quantity}`);

    const customizationPrice = item.customizations
      ? item.customizations.reduce((sum, c) => sum + (c.price || 0), 0)
      : 0;
    const itemTotal = (itemPrice + customizationPrice) * item.quantity;

    subtotal += itemTotal;

    const orderItem = {
      menuItemId: menuItem._id,
      name: menuItem.name,
      image: menuItem.image,
      description: menuItem.description,
      portion: item.portion || '', // Store portion/variant from frontend
      quantity: item.quantity,
      price: itemPrice,
      customizations: item.customizations || [],
      subtotal: itemTotal,
    };

    logger.info('\n📦 Order Item being saved to DB:');
    logger.info(`  - Name: ${orderItem.name}`);
    logger.info(`  - PORTION: "${orderItem.portion}"`);
    logger.info(`  - Price: ${orderItem.price}`);
    logger.info(`  - Quantity: ${orderItem.quantity}`);
    logger.info(`  - Full orderItem:`, JSON.stringify(orderItem, null, 2));

    return orderItem;
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

  // Generate unique order number (format: ORDDDHHMMSSXXX)
  // DD = day, HH = hour, MM = minute, SS = second, XXX = 3-digit counter
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  const orderCount = await Order.countDocuments();
  const counter = String((orderCount + 1) % 1000).padStart(3, '0'); // Keep last 3 digits
  const orderNumber = `ORD${day}${hour}${minute}${second}${counter}`;

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

  // Update menu item stats for popularity tracking
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

  logger.info(
    `✅ Order created: ${order.orderNumber} by ${req.user.email.address} - Amount: ₹${finalAmount}`
  );

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATION FLOW DEBUGGING
  // ═══════════════════════════════════════════════════════════════
  
  logger.info('\n🔔 ===== STARTING NOTIFICATION PROCESS =====');
  logger.info(`📦 Order: ${order.orderNumber}`);
  logger.info(`👤 Customer: ${req.user.email.address} (ID: ${req.user._id})`);
  logger.info(`💰 Amount: ₹${finalAmount}`);

  // Emit real-time notification to customer
  try {
    logger.info('\n📡 [WEBSOCKET] Emitting to customer...');
    emitUserNotification(req.user._id.toString(), {
      type: 'order_placed',
      title: 'Order Placed Successfully',
      message: `Your order ${order.orderNumber} has been placed successfully`,
      orderId: order._id,
    });
    logger.info('✅ [WEBSOCKET] Customer notification emitted');
  } catch (err) {
    logger.error('❌ [WEBSOCKET] Failed to emit customer notification:', err.message);
  }

  // Emit new order event to all admins (for web notifications)
  try {
    logger.info('\n📡 [WEBSOCKET] Emitting to admins...');
    emitNewOrder(order);
    logger.info('✅ [WEBSOCKET] Admin notification emitted');
  } catch (err) {
    logger.error('❌ [WEBSOCKET] Failed to emit new order event:', err.message);
  }

  // Send push notification to customer (iOS & Android)
  try {
    logger.info('\n📱 [PUSH NOTIFICATION] Checking customer device tokens...');
    const deviceTokens = req.user.getActiveDeviceTokens();
    logger.info(`📱 [PUSH] Customer has ${deviceTokens ? deviceTokens.length : 0} active device token(s)`);
    
    if (deviceTokens && deviceTokens.length > 0) {
      logger.info(`📱 [PUSH] Device tokens:`, deviceTokens.map((t, i) => `Token ${i + 1}: ${t.substring(0, 30)}...`));
      logger.info(`📱 [PUSH] Sending notification to ${deviceTokens.length} device(s) for order ${order.orderNumber}`);
      
      for (let i = 0; i < deviceTokens.length; i++) {
        const token = deviceTokens[i];
        logger.info(`📱 [PUSH] Sending to device ${i + 1}/${deviceTokens.length}...`);
        const result = await notificationService.sendOrderNotification(order, token);
        if (result) {
          logger.info(`✅ [PUSH] Successfully sent to device ${i + 1}`);
        } else {
          logger.error(`❌ [PUSH] Failed to send to device ${i + 1}`);
        }
      }
    } else {
      logger.warn(`⚠️  [PUSH] No active device tokens found for user ${req.user._id}`);
      logger.warn(`⚠️  [PUSH] User needs to login to mobile app to register device token`);
    }
  } catch (err) {
    logger.error('❌ [PUSH] Failed to send push notification:', err.message);
    logger.error('❌ [PUSH] Stack trace:', err.stack);
  }

  // Send notification to all admins
  try {
    logger.info('\n👨‍💼 [ADMIN PUSH] Checking admin users...');
    const admins = await User.find({ role: 'admin', isActive: true });
    logger.info(`👨‍💼 [ADMIN PUSH] Found ${admins.length} active admin(s)`);
    
    for (const admin of admins) {
      const adminTokens = admin.getActiveDeviceTokens();
      logger.info(`👨‍💼 [ADMIN PUSH] Admin ${admin.email.address} has ${adminTokens ? adminTokens.length : 0} device token(s)`);
      
      if (adminTokens && adminTokens.length > 0) {
        for (const token of adminTokens) {
          const result = await notificationService.sendCustomNotification(
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
          if (result) {
            logger.info(`✅ [ADMIN PUSH] Notification sent to ${admin.email.address}`);
          } else {
            logger.error(`❌ [ADMIN PUSH] Failed to send to ${admin.email.address}`);
          }
        }
      }
    }
  } catch (err) {
    logger.error('❌ [ADMIN PUSH] Failed to send push notification:', err.message);
  }

  // Send email notification to configured emails
  try {
    logger.info('\n📧 [EMAIL ADMIN] Checking notification emails...');
    if (settings.notificationEmails && settings.notificationEmails.length > 0) {
      logger.info(`📧 [EMAIL ADMIN] Sending to: ${settings.notificationEmails.join(', ')}`);
      // Admin emails can be sent using sendEmail method with custom content
      for (const email of settings.notificationEmails) {
        await emailService.sendOrderConfirmation(orderDetails, email);
      }
      logger.info(`✅ [EMAIL ADMIN] Order notification emails sent to: ${settings.notificationEmails.join(', ')}`);
    } else {
      logger.info(`ℹ️  [EMAIL ADMIN] No notification emails configured`);
    }
  } catch (err) {
    logger.error('❌ [EMAIL ADMIN] Failed to send order notification email:', err.message);
    // Don't fail the order creation if email fails
  }

  // Send order confirmation email to customer
  try {
    logger.info('\n📧 [EMAIL CUSTOMER] Sending order confirmation...');
    const customerEmail = req.user.email.address;
    logger.info(`📧 [EMAIL CUSTOMER] Recipient: ${customerEmail}`);
    
    const result = await emailService.sendOrderConfirmation(customerEmail, {
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
    
    if (result) {
      logger.info(`✅ [EMAIL CUSTOMER] Order confirmation email sent to: ${customerEmail}`);
    } else {
      logger.error(`❌ [EMAIL CUSTOMER] Failed to send email to: ${customerEmail}`);
    }
  } catch (err) {
    logger.error('❌ [EMAIL CUSTOMER] Failed to send order confirmation email:', err.message);
    logger.error('❌ [EMAIL CUSTOMER] Stack trace:', err.stack);
    // Don't fail the order creation if email fails
  }

  logger.info('\n🔔 ===== NOTIFICATION PROCESS COMPLETE =====\n');

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully',
    data: {
      order,
    },
  });
});

/**
 * Get all orders for current user
 * GET /api/v1/orders/my-orders
 * Customer only
 */
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

/**
 * Get all orders (admin/delivery)
 * GET /api/v1/orders
 * Admin & Delivery partners
 */
exports.getAllOrders = catchAsync(async (req, res, next) => {
  let query = Order.find();

  // If delivery partner, show only assigned orders
  if (req.user.role === 'delivery') {
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

/**
 * Get order by ID
 * GET /api/v1/orders/:id
 * Customer (own orders), Admin, Delivery (assigned orders)
 */
exports.getOrderById = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check authorization
  const isCustomer = order.customer.id.toString() === req.user._id.toString();
  const isDeliveryPartner =
    order.deliveryPartner &&
    order.deliveryPartner.id &&
    order.deliveryPartner.id.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isCustomer && !isDeliveryPartner && !isAdmin) {
    return next(
      new AppError('You do not have permission to view this order', 403)
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      order,
    },
  });
});

/**
 * Update order status
 * PATCH /api/v1/orders/:id/status
 * Admin & Delivery partners
 */
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

/**
 * Cancel order
 * PATCH /api/v1/orders/:id/cancel
 * Customer (own orders), Admin
 */
exports.cancelOrder = catchAsync(async (req, res, next) => {
  const { reason } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check authorization
  const isCustomer = order.customer.id.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isCustomer && !isAdmin) {
    return next(
      new AppError('You do not have permission to cancel this order', 403)
    );
  }

  // Check if order can be cancelled
  if (['delivered', 'cancelled'].includes(order.status)) {
    return next(
      new AppError(`Cannot cancel order that is already ${order.status}`, 400)
    );
  }

  // Update status to cancelled
  await order.updateStatus('cancelled', reason || 'Cancelled by customer');

  logger.info(
    `Order ${order.orderNumber} cancelled by ${req.user.email.address} - Reason: ${reason}`
  );

  // Send push notification to customer
  try {
    const customer = await User.findById(order.customer.id);
    if (customer) {
      const customerTokens = customer.getActiveDeviceTokens();
      
      if (customerTokens && customerTokens.length > 0) {
        logger.info(`[CANCEL NOTIFICATION] Sending to customer on ${customerTokens.length} device(s)`);
        
        for (const token of customerTokens) {
          await notificationService.sendCustomNotification(
            token,
            '❌ Order Cancelled',
            `Your order #${order.orderNumber} has been cancelled. ${reason ? 'Reason: ' + reason : ''}`,
            {
              type: 'ORDER_CANCELLED',
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              reason: reason || '',
              timestamp: new Date().toISOString(),
            }
          );
        }
      }
    }
  } catch (err) {
    logger.warn('[CANCEL NOTIFICATION] Failed to send push notification:', err.message);
  }

  res.status(200).json({
    status: 'success',
    message: 'Order cancelled successfully',
    data: {
      order,
    },
  });
});

/**
 * Assign delivery partner to order
 * PATCH /api/v1/orders/:id/assign
 * Admin only
 */
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
  await order.assignDeliveryPartner(deliveryPartnerId);

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

/**
 * Get pending orders (not assigned)
 * GET /api/v1/orders/pending/all
 * Admin only
 */
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

/**
 * Get orders by status
 * GET /api/v1/orders/status/:status
 * Admin & Delivery partners
 */
exports.getOrdersByStatus = catchAsync(async (req, res, next) => {
  const { status } = req.params;

  let query = { status };

  // If delivery partner, filter by assigned orders
  if (req.user.role === 'delivery') {
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

/**
 * Track order (real-time location and status)
 * GET /api/v1/orders/:id/track
 * Customer (own orders), Admin, Delivery (assigned orders)
 */
exports.trackOrder = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check authorization
  const isCustomer = order.customer.id.toString() === req.user._id.toString();
  const isDeliveryPartner =
    order.deliveryPartner &&
    order.deliveryPartner.id &&
    order.deliveryPartner.id.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isCustomer && !isDeliveryPartner && !isAdmin) {
    return next(
      new AppError('You do not have permission to track this order', 403)
    );
  }

  // Get delivery partner current location if available
  let deliveryPartnerLocation = null;
  if (order.deliveryPartner && order.deliveryPartner.id) {
    const dp = await User.findById(order.deliveryPartner.id).select(
      'deliveryData.currentLocation'
    );
    if (dp && dp.deliveryData && dp.deliveryData.currentLocation) {
      deliveryPartnerLocation = dp.deliveryData.currentLocation;
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        statusHistory: order.statusHistory,
        estimatedDeliveryTime: order.estimatedDeliveryTime,
        deliveryAddress: order.deliveryAddress,
        deliveryPartner: order.deliveryPartner,
        deliveryPartnerLocation,
      },
    },
  });
});

/**
 * Rate order
 * PATCH /api/v1/orders/:id/rate
 * Customer only (own orders)
 */
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

/**
 * Get order statistics
 * GET /api/v1/orders/stats/overview
 * Admin only
 */
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

/**
 * Mark order as ready
 * PATCH /api/v1/admin/orders/:id/ready
 * Admin only
 */
exports.markOrderReady = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (order.status !== 'PENDING') {
    return next(new AppError(`Cannot mark order as ready. Current status: ${order.status}`, 400));
  }

  // Update status
  order.status = 'READY';
  order.statusHistory.push({
    status: 'READY',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: 'Order marked as ready by admin',
  });

  await order.save();

  logger.info(`Order ${order.orderNumber} marked as READY by admin ${req.user.email.address}`);

  // Emit real-time update to customer
  emitUserNotification(order.customer.id.toString(), {
    type: 'order_ready',
    title: 'Order Ready',
    message: `Your order ${order.orderNumber} is ready for pickup`,
    orderId: order._id,
  });

  res.status(200).json({
    status: 'success',
    message: 'Order marked as ready',
    data: { order },
  });
});

/**
 * Assign delivery partner to order
 * PATCH /api/v1/admin/orders/:id/assign
 * Admin only
 */
exports.assignDeliveryPartner = catchAsync(async (req, res, next) => {
  const { partnerId } = req.body;

  if (!partnerId) {
    return next(new AppError('Delivery partner ID is required', 400));
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (order.status !== 'READY') {
    return next(new AppError(`Cannot assign partner. Order must be READY. Current status: ${order.status}`, 400));
  }

  // Get delivery partner details
  const partner = await User.findById(partnerId);
  if (!partner || partner.role !== 'delivery') {
    return next(new AppError('Invalid delivery partner', 400));
  }

  // Assign partner
  order.deliveryPartner = {
    id: partner._id,
    name: `${partner.name.first} ${partner.name.last}`,
    phone: partner.phone.number,
    vehicleNumber: partner.deliveryProfile?.vehicleNumber || 'N/A',
    assignedAt: new Date(),
  };

  order.statusHistory.push({
    status: 'READY',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: `Delivery partner assigned: ${partner.name.first} ${partner.name.last}`,
  });

  await order.save();

  logger.info(`Order ${order.orderNumber} assigned to partner ${partner.email.address}`);

  // Emit notification to delivery partner
  emitUserNotification(partnerId, {
    type: 'order_assigned',
    title: 'New Delivery Order',
    message: `Order ${order.orderNumber} has been assigned to you`,
    orderId: order._id,
    orderNumber: order.orderNumber,
  });

  // Emit notification to customer
  emitUserNotification(order.customer.id.toString(), {
    type: 'partner_assigned',
    title: 'Delivery Partner Assigned',
    message: `${partner.name.first} will deliver your order`,
    orderId: order._id,
    partner: {
      name: `${partner.name.first} ${partner.name.last}`,
      phone: partner.phone.number,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Delivery partner assigned successfully',
    data: { order },
  });
});

/**
 * Cancel order (Admin)
 * PATCH /api/v1/admin/orders/:id/cancel
 * Admin only
 */
exports.cancelOrder = catchAsync(async (req, res, next) => {
  const { reason } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
    return next(new AppError(`Cannot cancel order with status: ${order.status}`, 400));
  }

  const previousStatus = order.status;
  order.status = 'CANCELLED';
  order.statusHistory.push({
    status: 'CANCELLED',
    timestamp: new Date(),
    updatedBy: req.user._id,
    notes: reason || 'Cancelled by admin',
  });

  await order.save();

  logger.info(`Order ${order.orderNumber} cancelled by admin. Previous status: ${previousStatus}`);

  // Notify customer
  emitUserNotification(order.customer.id.toString(), {
    type: 'order_cancelled',
    title: 'Order Cancelled',
    message: `Your order ${order.orderNumber} has been cancelled`,
    orderId: order._id,
    reason: reason || 'Cancelled by restaurant',
  });

  // If partner was assigned, notify them
  if (order.deliveryPartner?.id) {
    emitUserNotification(order.deliveryPartner.id.toString(), {
      type: 'order_cancelled',
      title: 'Order Cancelled',
      message: `Order ${order.orderNumber} has been cancelled`,
      orderId: order._id,
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'Order cancelled successfully',
    data: { order },
  });
});

/**
 * Mark order picked up (Delivery Partner)
 * PATCH /api/v1/delivery/orders/:id/pickup
 * Delivery partner only
 */
exports.markOrderPickedUp = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify this order is assigned to current delivery partner
  if (!order.deliveryPartner?.id || order.deliveryPartner.id.toString() !== req.user._id.toString()) {
    return next(new AppError('This order is not assigned to you', 403));
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

  logger.info(`Order ${order.orderNumber} picked up by partner ${req.user.email.address}`);

  // Notify customer
  emitUserNotification(order.customer.id.toString(), {
    type: 'order_picked_up',
    title: 'Order On The Way',
    message: `${order.deliveryPartner.name} is on the way with your order`,
    orderId: order._id,
    partner: {
      name: order.deliveryPartner.name,
      phone: order.deliveryPartner.phone,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Order marked as picked up',
    data: { order },
  });
});

/**
 * Mark order delivered (Delivery Partner)
 * PATCH /api/v1/delivery/orders/:id/deliver
 * Delivery partner only
 */
exports.markOrderDelivered = catchAsync(async (req, res, next) => {
  const { collectedAmount, changeFund } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify this order is assigned to current delivery partner
  if (!order.deliveryPartner?.id || order.deliveryPartner.id.toString() !== req.user._id.toString()) {
    return next(new AppError('This order is not assigned to you', 403));
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

  logger.info(`Order ${order.orderNumber} delivered by partner ${req.user.email.address}`);

  // Notify customer
  emitUserNotification(order.customer.id.toString(), {
    type: 'order_delivered',
    title: 'Order Delivered',
    message: `Your order ${order.orderNumber} has been delivered. Enjoy your meal!`,
    orderId: order._id,
  });

  res.status(200).json({
    status: 'success',
    message: 'Order marked as delivered',
    data: { order },
  });
});

/**
 * Get assigned orders for delivery partner
 * GET /api/v1/delivery/orders/assigned
 * Delivery partner only
 */
exports.getAssignedOrders = catchAsync(async (req, res, next) => {
  const orders = await Order.find({
    'deliveryPartner.id': req.user._id,
    status: { $in: ['READY', 'OUT_FOR_DELIVERY'] },
  })
    .sort('-createdAt')
    .select('-__v');

  res.status(200).json({
    status: 'success',
    results: orders.length,
    data: { orders },
  });
});

/**
 * Customer cancel order
 * PATCH /api/v1/orders/:id/cancel
 * Customer only
 */
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
