const User = require('../models/User');
const Order = require('../models/Order');
const DeliverySession = require('../models/DeliverySession');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

/**
 * Register new delivery partner
 * POST /api/v1/delivery/register
 * Admin only
 */
exports.registerDeliveryPartner = catchAsync(async (req, res, next) => {
  const { name, email, phone, password, vehicleType } = req.body;

  logger.info('\n========== DELIVERY PARTNER REGISTRATION ==========');
  logger.info(`[REGISTER] Received data:`);
  logger.info(`  - Name: ${name}`);
  logger.info(`  - Email: ${email}`);
  logger.info(`  - Phone: ${phone}`);
  logger.info(`  - Password length: ${password ? password.length : 0}`);
  logger.info(`  - Vehicle Type: ${vehicleType}`);

  // Validate required fields
  if (!name || !email || !phone || !password || !vehicleType) {
    return next(new AppError('Please provide all required fields: name, email, phone, password, vehicleType', 400));
  }

  // Normalize phone number - remove +91 prefix for consistent storage
  const normalizedPhone = phone.replace(/^\+91/, '');
  logger.info(`  - Normalized Phone: ${normalizedPhone}`);

  // Check if user already exists
  const existingUser = await User.findOne({ 
    $or: [
      { 'email.address': email },
      { 'phone.number': normalizedPhone },
      { 'phone.number': phone }
    ]
  });

  if (existingUser) {
    logger.warn(`[REGISTER] User already exists - Email: ${existingUser.email.address}, Phone: ${existingUser.phone.number}`);
    return next(new AppError('User with this email or phone already exists', 400));
  }

  // Create delivery partner
  const deliveryPartner = await User.create({
    name: {
      first: name.split(' ')[0] || name,
      last: name.split(' ').slice(1).join(' ') || name.split(' ')[0],
    },
    email: {
      address: email,
      isVerified: true,
    },
    phone: {
      number: normalizedPhone,
      isVerified: true,
    },
    password,
    role: 'delivery',
    isActive: true,
    deliveryData: {
      vehicleInfo: {
        type: vehicleType,
      },
      availability: true,
      rating: 0,
      totalDeliveries: 0,
      totalEarnings: 0,
    },
  });

  logger.info(`[REGISTER] SUCCESS - Delivery partner created:`);
  logger.info(`  - ID: ${deliveryPartner._id}`);
  logger.info(`  - Name: ${deliveryPartner.name.first} ${deliveryPartner.name.last}`);
  logger.info(`  - Email: ${deliveryPartner.email.address}`);
  logger.info(`  - Phone: ${deliveryPartner.phone.number}`);
  logger.info(`  - Role: ${deliveryPartner.role}`);
  logger.info(`  - Vehicle: ${vehicleType}`);
  logger.info(`  - Password saved: ${deliveryPartner.password ? 'YES (hashed)' : 'NO'}`);
  logger.info('====================================================\n');

  res.status(201).json({
    status: 'success',
    message: 'Delivery partner registered successfully',
    data: {
      partner: {
        id: deliveryPartner._id,
        name: `${deliveryPartner.name.first} ${deliveryPartner.name.last}`,
        email: deliveryPartner.email.address,
        phone: deliveryPartner.phone.number,
        vehicleType: deliveryPartner.deliveryData.vehicleInfo.type,
        role: deliveryPartner.role,
      },
    },
  });
});

/**
 * Delete delivery partner
 * DELETE /api/v1/delivery/partner/:id
 * Admin only
 */
exports.deleteDeliveryPartner = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Find delivery partner
  const deliveryPartner = await User.findById(id);

  if (!deliveryPartner) {
    return next(new AppError('Delivery partner not found', 404));
  }

  if (deliveryPartner.role !== 'delivery') {
    return next(new AppError('User is not a delivery partner', 400));
  }

  // Check if partner has active orders
  const activeOrders = await Order.countDocuments({
    deliveryPartner: id,
    status: { $in: ['OUT_FOR_DELIVERY'] }
  });

  if (activeOrders > 0) {
    return next(new AppError('Cannot delete delivery partner with active orders', 400));
  }

  // Delete the delivery partner
  await User.findByIdAndDelete(id);

  logger.info(`Delivery partner deleted: ${deliveryPartner.email.address} by admin ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Delivery partner deleted successfully',
  });
});

/**
 * Update delivery partner
 * PATCH /api/v1/delivery/partner/:id
 * Admin only
 */
exports.updateDeliveryPartner = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { name, email, phone, vehicleType, password } = req.body;

  // Find delivery partner
  const deliveryPartner = await User.findById(id);

  if (!deliveryPartner) {
    return next(new AppError('Delivery partner not found', 404));
  }

  if (deliveryPartner.role !== 'delivery') {
    return next(new AppError('User is not a delivery partner', 400));
  }

  // Update fields if provided
  if (name) {
    const nameParts = name.split(' ');
    deliveryPartner.name.first = nameParts[0] || name;
    deliveryPartner.name.last = nameParts.slice(1).join(' ') || nameParts[0];
  }

  if (email) {
    // Check if email is already taken by another user
    const existingUser = await User.findOne({ 
      'email.address': email,
      _id: { $ne: id }
    });
    if (existingUser) {
      return next(new AppError('Email is already taken', 400));
    }
    deliveryPartner.email.address = email;
  }

  if (phone) {
    // Check if phone is already taken by another user
    const existingUser = await User.findOne({ 
      'phone.number': phone,
      _id: { $ne: id }
    });
    if (existingUser) {
      return next(new AppError('Phone number is already taken', 400));
    }
    deliveryPartner.phone.number = phone;
  }

  if (vehicleType) {
    if (!deliveryPartner.deliveryData) {
      deliveryPartner.deliveryData = {};
    }
    if (!deliveryPartner.deliveryData.vehicleInfo) {
      deliveryPartner.deliveryData.vehicleInfo = {};
    }
    deliveryPartner.deliveryData.vehicleInfo.type = vehicleType;
  }

  if (password) {
    if (password.length < 6) {
      return next(new AppError('Password must be at least 6 characters long', 400));
    }
    deliveryPartner.password = password;
  }

  await deliveryPartner.save({ validateBeforeSave: false });

  logger.info(`Delivery partner updated: ${deliveryPartner.email.address} by admin ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Delivery partner updated successfully',
    data: {
      partner: {
        id: deliveryPartner._id,
        name: `${deliveryPartner.name.first} ${deliveryPartner.name.last}`,
        email: deliveryPartner.email.address,
        phone: deliveryPartner.phone.number,
        vehicleType: deliveryPartner.deliveryData?.vehicleInfo?.type,
      },
    },
  });
});

/**
 * Get available delivery partners
 * GET /api/v1/delivery/available
 * Admin only
 */
exports.getAvailableDeliveryPartners = catchAsync(async (req, res, next) => {
  const { latitude, longitude, maxDistance = 10000 } = req.query;

  let deliveryPartners;

  if (latitude && longitude) {
    // Get partners within specified distance
    deliveryPartners = await User.findAvailableDeliveryPartners(
      [parseFloat(longitude), parseFloat(latitude)],
      parseInt(maxDistance, 10)
    );
  } else {
    // Get all available partners
    deliveryPartners = await User.find({
      role: 'delivery',
      isActive: true,
      'deliveryData.availability': true,
    }).select(
      'name email phone deliveryData'
    );
  }

  // Format the response to flatten the structure
  const partners = deliveryPartners.map(partner => ({
    _id: partner._id,
    name: `${partner.name.first} ${partner.name.last}`,
    email: partner.email.address,
    phone: partner.phone.number,
    vehicleType: partner.deliveryData?.vehicleInfo?.type || 'N/A',
    rating: partner.deliveryData?.rating || 0,
    totalDeliveries: partner.deliveryData?.totalDeliveries || 0,
    availability: partner.deliveryData?.availability || false,
  }));

  res.status(200).json({
    status: 'success',
    results: partners.length,
    data: {
      partners,
    },
  });
});

/**
 * Update delivery partner availability
 * PATCH /api/v1/delivery/availability
 * Delivery partner only
 */
exports.updateAvailability = catchAsync(async (req, res, next) => {
  const { availability } = req.body;

  if (typeof availability !== 'boolean') {
    return next(new AppError('Please provide availability as boolean', 400));
  }

  req.user.deliveryData.availability = availability;
  await req.user.save({ validateBeforeSave: false });

  logger.info(
    `Delivery partner ${req.user.email.address} set availability to ${availability}`
  );

  res.status(200).json({
    status: 'success',
    message: 'Availability updated successfully',
    data: {
      availability,
    },
  });
});

/**
 * Update delivery partner location
 * PATCH /api/v1/delivery/location
 * Delivery partner only
 */
exports.updateLocation = catchAsync(async (req, res, next) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return next(new AppError('Please provide latitude and longitude', 400));
  }

  req.user.deliveryData.currentLocation = {
    type: 'Point',
    coordinates: [parseFloat(longitude), parseFloat(latitude)],
  };

  await req.user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Location updated successfully',
  });
});

/**
 * Get delivery partner statistics
 * GET /api/v1/delivery/my-stats
 * Delivery partner only
 */
exports.getMyStats = catchAsync(async (req, res, next) => {
  const deliveryPartner = await User.findById(req.user._id);

  // Get order stats
  const orderStats = await Order.aggregate([
    {
      $match: { 'deliveryPartner.id': req.user._id },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  // Get earnings this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyEarnings = await Order.aggregate([
    {
      $match: {
        'deliveryPartner.id': req.user._id,
        status: 'delivered',
        createdAt: { $gte: startOfMonth },
      },
    },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: '$pricing.deliveryCharges' },
        totalOrders: { $sum: 1 },
      },
    },
  ]);

  // Get active delivery session if exists
  const activeSession = await DeliverySession.findOne({
    'deliveryPartner.id': req.user._id,
    endTime: null,
  });

  res.status(200).json({
    status: 'success',
    data: {
      profile: {
        name: deliveryPartner.fullName,
        rating: deliveryPartner.deliveryData.rating,
        totalDeliveries: deliveryPartner.deliveryData.totalDeliveries,
        totalEarnings: deliveryPartner.deliveryData.totalEarnings,
        availability: deliveryPartner.deliveryData.availability,
      },
      orderStats,
      monthlyEarnings: monthlyEarnings[0] || { totalEarnings: 0, totalOrders: 0 },
      activeSession,
    },
  });
});

/**
 * Start delivery session
 * POST /api/v1/delivery/session/start
 * Delivery partner only
 */
exports.startDeliverySession = catchAsync(async (req, res, next) => {
  const { openingCash } = req.body;

  // Check if there's already an active session
  const existingSession = await DeliverySession.findOne({
    'deliveryPartner.id': req.user._id,
    endTime: null,
  });

  if (existingSession) {
    return next(
      new AppError('You already have an active delivery session', 400)
    );
  }

  const session = await DeliverySession.create({
    deliveryPartner: {
      id: req.user._id,
      name: req.user.fullName,
    },
    sessionDate: new Date(),
    startTime: new Date(),
    cashCollection: {
      opening: openingCash || 0,
    },
  });

  // Set availability to true
  req.user.deliveryData.availability = true;
  await req.user.save({ validateBeforeSave: false });

  logger.info(`Delivery session started for ${req.user.email.address}`);

  res.status(201).json({
    status: 'success',
    message: 'Delivery session started successfully',
    data: {
      session,
    },
  });
});

/**
 * End delivery session
 * PATCH /api/v1/delivery/session/end
 * Delivery partner only
 */
exports.endDeliverySession = catchAsync(async (req, res, next) => {
  const session = await DeliverySession.findOne({
    'deliveryPartner.id': req.user._id,
    endTime: null,
  });

  if (!session) {
    return next(new AppError('No active delivery session found', 404));
  }

  await session.endSession();

  // Set availability to false
  req.user.deliveryData.availability = false;
  await req.user.save({ validateBeforeSave: false });

  logger.info(`Delivery session ended for ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Delivery session ended successfully',
    data: {
      session,
    },
  });
});

/**
 * Settle delivery session
 * PATCH /api/v1/delivery/session/:id/settle
 * Admin only
 */
exports.settleDeliverySession = catchAsync(async (req, res, next) => {
  const { actualCashDeposited, notes } = req.body;

  const session = await DeliverySession.findById(req.params.id);

  if (!session) {
    return next(new AppError('Delivery session not found', 404));
  }

  if (!session.endTime) {
    return next(new AppError('Session must be ended before settlement', 400));
  }

  await session.settleSession(actualCashDeposited, notes);

  logger.info(
    `Delivery session ${session._id} settled by ${req.user.email.address}`
  );

  res.status(200).json({
    status: 'success',
    message: 'Delivery session settled successfully',
    data: {
      session,
    },
  });
});

/**
 * Get delivery sessions
 * GET /api/v1/delivery/sessions
 * Delivery partner sees own, Admin sees all
 */
exports.getDeliverySessions = catchAsync(async (req, res, next) => {
  let query = {};

  // If delivery partner, show only their sessions
  if (req.user.role === 'delivery') {
    query['deliveryPartner.id'] = req.user._id;
  }

  const sessions = await DeliverySession.find(query)
    .sort('-sessionDate')
    .limit(50);

  res.status(200).json({
    status: 'success',
    results: sessions.length,
    data: {
      sessions,
    },
  });
});

/**
 * Get active delivery sessions
 * GET /api/v1/delivery/sessions/active
 * Admin only
 */
exports.getActiveSessions = catchAsync(async (req, res, next) => {
  const sessions = await DeliverySession.findActiveSessions();

  res.status(200).json({
    status: 'success',
    results: sessions.length,
    data: {
      sessions,
    },
  });
});

/**
 * Get unsettled delivery sessions
 * GET /api/v1/delivery/sessions/unsettled
 * Admin only
 */
exports.getUnsettledSessions = catchAsync(async (req, res, next) => {
  const sessions = await DeliverySession.findUnsettled();

  res.status(200).json({
    status: 'success',
    results: sessions.length,
    data: {
      sessions,
    },
  });
});

/**
 * Get all delivery partners (admin)
 * GET /api/v1/delivery/partners
 * Admin only
 */
exports.getAllDeliveryPartners = catchAsync(async (req, res, next) => {
  const { search, status, page = 1, limit = 10 } = req.query;

  const query = { role: 'delivery' };

  // Search filter
  if (search) {
    query.$or = [
      { 'name.first': { $regex: search, $options: 'i' } },
      { 'name.last': { $regex: search, $options: 'i' } },
      { 'email.address': { $regex: search, $options: 'i' } },
      { 'phone.number': { $regex: search, $options: 'i' } },
    ];
  }

  // Status filter
  if (status === 'active') {
    query.isActive = true;
    query['deliveryData.availability'] = true;
  } else if (status === 'offline') {
    query.$or = [
      { isActive: false },
      { 'deliveryData.availability': false },
    ];
  }

  const skip = (page - 1) * limit;

  const [partners, total] = await Promise.all([
    User.find(query)
      .select('name email phone deliveryData isActive createdAt')
      .sort('-deliveryData.rating')
      .skip(skip)
      .limit(parseInt(limit)),
    User.countDocuments(query),
  ]);

  // Get today's deliveries for each partner
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const partnersWithTodayStats = await Promise.all(
    partners.map(async (partner) => {
      const todayOrders = await Order.countDocuments({
        'deliveryPartner.id': partner._id,
        status: 'delivered',
        updatedAt: { $gte: today },
      });

      const currentOrders = await Order.countDocuments({
        'deliveryPartner.id': partner._id,
        status: { $in: ['confirmed', 'preparing', 'out_for_delivery'] },
      });

      return {
        _id: partner._id,
        name: `${partner.name.first} ${partner.name.last}`,
        email: partner.email.address,
        phone: partner.phone.number,
        status: partner.isActive && partner.deliveryData.availability ? 'Active' : 'Offline',
        currentOrders,
        completedToday: todayOrders,
        totalDeliveries: partner.deliveryData.totalDeliveries || 0,
        rating: partner.deliveryData.rating || 0,
        vehicleType: partner.deliveryData.vehicleType || 'N/A',
        location: partner.deliveryData.currentZone || 'N/A',
      };
    })
  );

  res.status(200).json({
    status: 'success',
    results: partnersWithTodayStats.length,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
    },
    data: {
      partners: partnersWithTodayStats,
    },
  });
});

/**
 * Get delivery statistics (admin)
 * GET /api/v1/delivery/stats/overview
 * Admin only
 */
exports.getDeliveryStats = catchAsync(async (req, res, next) => {
  const totalPartners = await User.countDocuments({ role: 'delivery' });
  const availablePartners = await User.countDocuments({
    role: 'delivery',
    'deliveryData.availability': true,
    isActive: true,
  });

  const activeSessions = await DeliverySession.countDocuments({
    endTime: null,
  });

  const unsettledSessions = await DeliverySession.countDocuments({
    'settlement.isSettled': false,
    endTime: { $ne: null },
  });

  const performanceStats = await User.aggregate([
    {
      $match: { role: 'delivery' },
    },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$deliveryData.rating' },
        totalDeliveries: { $sum: '$deliveryData.totalDeliveries' },
        totalEarnings: { $sum: '$deliveryData.totalEarnings' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      overview: {
        totalPartners,
        availablePartners,
        activeSessions,
        unsettledSessions,
      },
      performance: performanceStats[0] || {},
    },
  });
});

/**
 * Get all available (ready) orders for delivery agents
 * GET /api/v1/delivery/available-orders
 * Delivery agent only
 */
exports.getAvailableOrders = catchAsync(async (req, res, next) => {
  logger.info(`
================================
===== GET AVAILABLE ORDERS =====
================================
🚚 Delivery Agent: ${req.user.email}
🔍 Searching for: status=READY, orderType=DELIVERY, unassigned
================================`);

  try {
    // Get all ready orders that are not assigned yet
    const availableOrders = await Order.find({
      status: 'READY',
      orderType: 'DELIVERY',
      'deliveryPartner.id': null,
    })
      .populate('customer.id', 'name phone email')
      .sort({ createdAt: 1 }) // Older orders first
      .lean(); // Convert to plain JavaScript objects

    logger.info(`✅ Found ${availableOrders.length} available orders for delivery agents`);
    
    if (availableOrders.length > 0) {
      logger.info(`📦 Available Order Numbers: ${availableOrders.map(o => o.orderNumber).join(', ')}`);
    }

    res.status(200).json({
      status: 'success',
      results: availableOrders.length,
      data: {
        orders: availableOrders,
      },
    });
  } catch (error) {
    logger.error(`❌ Error fetching available orders: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    return next(new AppError('Error fetching available orders', 500));
  }
});

/**
 * Claim/Select an order (Delivery agent picks which order to deliver)
 * POST /api/v1/delivery/claim-order/:orderId
 * Delivery agent only
 */
exports.claimOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const deliveryAgent = req.user;

  // Check if delivery agent is available
  if (!deliveryAgent.deliveryData.availability) {
    logger.warn(`🚫 Agent ${deliveryAgent.email} tried to claim order but is not available`);
    return next(new AppError('You must be available to claim orders', 400));
  }

  logger.info(`
================================
===== CLAIM ORDER REQUEST =====
================================
📦 Order ID: ${orderId}
🚚 Delivery Agent: ${deliveryAgent.email}
👤 Agent Name: ${deliveryAgent.name.first} ${deliveryAgent.name.last}
📱 Agent Phone: ${deliveryAgent.phone.number}
🏍️  Vehicle: ${deliveryAgent.deliveryData.vehicleInfo.number || 'N/A'}
🔒 Using atomic operation to prevent race conditions
================================`);

  // Find the order with atomic operation to prevent race condition
  let order;
  try {
    order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: 'READY',
        orderType: 'DELIVERY',
        'deliveryPartner.id': null, // Only claim if not already assigned
      },
      {
        $set: {
          status: 'OUT_FOR_DELIVERY',
          'deliveryPartner.id': deliveryAgent._id,
          'deliveryPartner.name': `${deliveryAgent.name.first} ${deliveryAgent.name.last}`,
          'deliveryPartner.phone': deliveryAgent.phone.number,
          'deliveryPartner.vehicleNumber': deliveryAgent.deliveryData.vehicleInfo.number || 'N/A',
          'deliveryPartner.assignedAt': new Date(),
          'deliveryPartner.pickedUpAt': new Date(),
        },
        $push: {
          statusHistory: {
            status: 'OUT_FOR_DELIVERY',
            timestamp: new Date(),
            updatedBy: deliveryAgent._id,
            notes: `Order claimed by delivery agent ${deliveryAgent.name.first} and out for delivery`,
          },
        },
      },
      { new: true, runValidators: true }
    );
  } catch (updateError) {
    logger.error(`❌ Error updating order: ${updateError.message}`);
    logger.error(`Stack: ${updateError.stack}`);
    return next(new AppError('Error claiming order', 500));
  }

  // If order is null, it means another agent claimed it or it's not available
  if (!order) {
    logger.warn(`⚠️  RACE CONDITION DETECTED! Order ${orderId} already claimed or not available`);
    return next(new AppError('Order is no longer available or has already been claimed by another agent', 409));
  }

  logger.info(`✅ Order ${order.orderNumber} successfully claimed!`);
  logger.info(`📋 Status: READY → OUT_FOR_DELIVERY`);

  try {
    logger.info(`📤 Emitting socket notification to customer: ${order.customer.id}`);
    // Emit socket event to customer
    const { emitUserNotification, emitOrderUpdate } = require('../utils/socket');
    emitUserNotification(order.customer.id.toString(), {
      type: 'ORDER_OUT_FOR_DELIVERY',
      orderId: order._id,
      orderNumber: order.orderNumber,
      deliveryAgent: {
        name: order.deliveryPartner.name,
        phone: order.deliveryPartner.phone,
      },
      message: 'Your order is on the way!',
    });

    logger.info(`📤 Emitting socket notification to all delivery agents (order no longer available)`);
    // Notify other delivery agents that order is no longer available
    emitOrderUpdate(order._id.toString(), {
      type: 'ORDER_CLAIMED',
      status: 'OUT_FOR_DELIVERY',
      orderNumber: order.orderNumber,
      message: 'Order has been claimed by another agent',
    });
  } catch (socketError) {
    // Log socket errors but don't fail the request
    logger.error(`⚠️  Socket notification error: ${socketError.message}`);
  }

  res.status(200).json({
    status: 'success',
    message: 'Order claimed successfully',
    data: {
      order,
    },
  });
});

