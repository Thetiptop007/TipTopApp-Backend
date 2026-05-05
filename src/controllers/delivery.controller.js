const User = require('../models/User');
const Order = require('../models/Order');
const DeliverySession = require('../models/DeliverySession');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

/**
 * Register new delivery partner
 * POST /api/v1/delivery/register
 * Admin only ...
 */
exports.registerDeliveryPartner = catchAsync(async (req, res, next) => {
  const { name, email, phone, password, vehicleType } = req.body;

  logger.auth('AUTH_REGISTRATION_ATTEMPT', 'Delivery partner registration attempted', {
    name,
    email,
    phone,
    vehicleType,
  }, { level: 'debug' });

  // Validate required fields
  if (!name || !email || !phone || !password || !vehicleType) {
    return next(new AppError('Please provide all required fields: name, email, phone, password, vehicleType', 400));
  }

  // Normalize phone number - remove +91 prefix for consistent storage
  const normalizedPhone = phone.replace(/^\+91/, '');
  logger.auth('AUTH_REGISTRATION_ATTEMPT', 'Delivery partner phone normalized', { normalizedPhone }, { level: 'debug' });

  // SECURITY FIX: Check if BOTH email AND phone match to prevent account takeover
  // First, check if exact match exists (same email AND phone)
  const exactMatch = await User.findOne({ 
    'email.address': email,
    $or: [
      { 'phone.number': normalizedPhone },
      { 'phone.number': phone }
    ],
    isActive: true
  }).select('+password');

  // Then check if email OR phone exists separately (potential conflict)
  const emailExists = await User.findOne({ 
    'email.address': email,
    isActive: true
  });
  
  const phoneExists = await User.findOne({ 
    $or: [
      { 'phone.number': normalizedPhone },
      { 'phone.number': phone }
    ],
    isActive: true
  });

  // CRITICAL SECURITY CHECK: Prevent cross-account contamination
  // If email and phone belong to different accounts, reject
  if (emailExists && phoneExists && !emailExists._id.equals(phoneExists._id)) {
    logger.security('UNAUTHORIZED_ACCESS', 'Delivery registration blocked: email and phone belong to different users', {
      email,
      emailUserId: emailExists._id.toString(),
      phone: normalizedPhone,
      phoneUserId: phoneExists._id.toString(),
    }, { level: 'error', severity: 'critical' });
    
    await AuditLog.create({
      userId: phoneExists._id,
      performedBy: req.user._id,
      action: 'SECURITY_VIOLATION',
      resourceType: 'User',
      resourceId: phoneExists._id,
      details: {
        reason: 'delivery_registration_with_mismatched_credentials',
        attemptedEmail: email,
        existingEmail: phoneExists.email.address,
        attemptedPhone: normalizedPhone,
        existingPhone: phoneExists.phone.number,
        blocked: true
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl
      },
      severity: 'CRITICAL',
      status: 'FAILED'
    });
    
    return next(new AppError('Email and phone number belong to different accounts. Please use matching credentials.', 400));
  }

  // ADDITIONAL CHECK: If only phone exists (with different email), require exact match
  if (phoneExists && !exactMatch) {
    logger.security('UNAUTHORIZED_ACCESS', 'Delivery registration blocked: phone already registered', {
      attemptedPhone: normalizedPhone,
      phoneUserId: phoneExists._id.toString(),
      attemptedEmail: email,
    }, { level: 'error', severity: 'critical' });
    
    await AuditLog.create({
      userId: phoneExists._id,
      performedBy: req.user._id,
      action: 'SECURITY_VIOLATION',
      resourceType: 'User',
      resourceId: phoneExists._id,
      details: {
        reason: 'delivery_registration_with_existing_phone',
        attemptedEmail: email,
        existingEmail: phoneExists.email.address,
        attemptedPhone: normalizedPhone,
        blocked: true
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl
      },
      severity: 'CRITICAL',
      status: 'FAILED'
    });
    
    return next(new AppError(`This phone number is already registered. To add delivery role to existing account, use the email: ${phoneExists.email.address}`, 400));
  }

  // ADDITIONAL CHECK: If only email exists (with different phone), require exact match
  if (emailExists && !exactMatch) {
    logger.security('UNAUTHORIZED_ACCESS', 'Delivery registration blocked: email already registered', {
      attemptedEmail: email,
      emailUserId: emailExists._id.toString(),
      attemptedPhone: normalizedPhone,
    }, { level: 'error', severity: 'critical' });
    
    await AuditLog.create({
      userId: emailExists._id,
      performedBy: req.user._id,
      action: 'SECURITY_VIOLATION',
      resourceType: 'User',
      resourceId: emailExists._id,
      details: {
        reason: 'delivery_registration_with_existing_email',
        attemptedPhone: normalizedPhone,
        existingPhone: emailExists.phone.number,
        email: email,
        blocked: true
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl
      },
      severity: 'CRITICAL',
      status: 'FAILED'
    });
    
    return next(new AppError(`This email is already registered. To add delivery role to existing account, use the phone: ${emailExists.phone.number}`, 400));
  }

  let deliveryPartner;

  if (exactMatch) {
    logger.auth('AUTH_REGISTRATION_SUCCESS', 'Delivery partner registration matched existing user', {
      userId: exactMatch._id.toString(),
      email: exactMatch.email.address,
      phone: exactMatch.phone.number,
      vehicleType,
    });
    
    // Check if user already has delivery role
    if (exactMatch.roles && exactMatch.roles.includes('delivery')) {
      logger.auth('AUTH_ACCESS_DENIED', 'Delivery partner already has delivery role', { userId: exactMatch._id.toString() }, { level: 'warn', severity: 'medium' });
      return next(new AppError('User is already registered as a delivery partner', 400));
    }

    // Safe to add delivery role - same person
    logger.auth('AUTH_REGISTRATION_SUCCESS', 'Delivery role added to existing user', { userId: exactMatch._id.toString(), vehicleType });
    exactMatch.addRole('delivery');
    
    // Update delivery data
    exactMatch.deliveryData = {
      vehicleInfo: {
        type: vehicleType,
      },
      availability: true,
      rating: 0,
      totalDeliveries: 0,
      totalEarnings: 0,
    };

    await exactMatch.save();
    deliveryPartner = exactMatch;
    
    // AUDIT LOG: Role addition
    await AuditLog.create({
      userId: exactMatch._id,
      performedBy: req.user._id,
      action: 'ROLE_ADDED',
      resourceType: 'User',
      resourceId: exactMatch._id,
      details: {
        reason: 'Delivery partner registration',
        before: { roles: exactMatch.roles.filter(r => r !== 'delivery') },
        after: { roles: exactMatch.roles },
        roleAdded: 'delivery',
        additionalInfo: { vehicleType: vehicleType }
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl
      },
      severity: 'HIGH',
      status: 'SUCCESS'
    });
    
    logger.auth('AUTH_REGISTRATION_SUCCESS', 'Delivery partner role added to existing user', { userId: exactMatch._id.toString(), vehicleType });
  } else {
    // Create new delivery partner
    logger.auth('AUTH_REGISTRATION_ATTEMPT', 'Creating new delivery partner', { email, phone: normalizedPhone, vehicleType }, { level: 'debug' });
    
    // Parse name properly - avoid duplication
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    
    deliveryPartner = await User.create({
    name: {
      first: firstName,
      last: lastName,
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
      roles: ['delivery'],
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

    logger.auth('AUTH_REGISTRATION_SUCCESS', 'New delivery partner created', { userId: deliveryPartner._id.toString(), vehicleType });
    
    // AUDIT LOG: New delivery partner account
    await AuditLog.create({
      userId: deliveryPartner._id,
      performedBy: req.user._id,
      action: 'ACCOUNT_CREATE',
      resourceType: 'User',
      resourceId: deliveryPartner._id,
      details: {
        reason: 'New delivery partner registration',
        roles: ['delivery'],
        vehicleType: vehicleType
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl
      },
      severity: 'MEDIUM',
      status: 'SUCCESS'
    });
  }
  logger.auth('AUTH_REGISTRATION_SUCCESS', 'Delivery partner registration completed', {
    userId: deliveryPartner._id.toString(),
    name: `${deliveryPartner.name.first} ${deliveryPartner.name.last}`.trim(),
    email: deliveryPartner.email.address,
    phone: deliveryPartner.phone.number,
    userRole: deliveryPartner.role,
    vehicleType,
  });

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

  if (!deliveryPartner.hasRole('delivery')) {
    return next(new AppError('User is not a delivery partner', 400));
  }

  // Check if partner has active orders
  const activeOrders = await Order.countDocuments({
    'deliveryPartner.id': id,
    status: { $in: ['OUT_FOR_DELIVERY', 'CONFIRMED', 'PREPARING'] }
  });

  if (activeOrders > 0) {
    return next(new AppError('Cannot delete delivery partner with active orders', 400));
  }

  // Check if user has multiple roles
  const hasMultipleRoles = deliveryPartner.roles && deliveryPartner.roles.length > 1;

  if (hasMultipleRoles) {
    // Just remove delivery role, keep the user account
    deliveryPartner.removeRole('delivery');
    
    // Clear delivery data
    deliveryPartner.deliveryData = undefined;
    
    // If user only has one role left, set it as primary role
    if (deliveryPartner.roles.length === 1) {
      deliveryPartner.role = deliveryPartner.roles[0];
    }
    
    await deliveryPartner.save({ validateBeforeSave: false });
    
    logger.info(`Delivery role removed from user: ${deliveryPartner.email.address} by admin ${req.user.email.address}`);
    logger.info(`User still has roles: ${deliveryPartner.roles.join(', ')}`);
    
    // Audit log
    await AuditLog.create({
      userId: deliveryPartner._id,
      performedBy: req.user._id,
      action: 'ROLE_REMOVED',
      resourceType: 'User',
      resourceId: deliveryPartner._id,
      details: {
        reason: 'Delivery partner deletion',
        before: { roles: [...deliveryPartner.roles, 'delivery'] },
        after: { roles: deliveryPartner.roles },
        roleRemoved: 'delivery'
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl
      },
      severity: 'HIGH',
      status: 'SUCCESS'
    });
  } else {
    // User only has delivery role - delete entire account
    await User.findByIdAndDelete(id);
    
    logger.info(`Delivery partner account deleted: ${deliveryPartner.email.address} by admin ${req.user.email.address}`);
    
    // Audit log
    await AuditLog.create({
      userId: deliveryPartner._id,
      performedBy: req.user._id,
      action: 'ACCOUNT_DELETE',
      resourceType: 'User',
      resourceId: deliveryPartner._id,
      details: {
        reason: 'Delivery partner deletion - no other roles',
        deletedEmail: deliveryPartner.email.address,
        deletedPhone: deliveryPartner.phone.number
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl
      },
      severity: 'CRITICAL',
      status: 'SUCCESS'
    });
  }

  res.status(200).json({
    status: 'success',
    message: hasMultipleRoles 
      ? 'Delivery role removed successfully' 
      : 'Delivery partner deleted successfully',
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

  if (!deliveryPartner.hasRole('delivery')) {
    return next(new AppError('User is not a delivery partner', 400));
  }

  // Update fields if provided
  if (name) {
    const nameParts = name.trim().split(' ');
    deliveryPartner.name.first = nameParts[0];
    deliveryPartner.name.last = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
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
      roles: 'delivery',
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
  if (req.user.hasRole('delivery') && !req.user.hasRole('admin')) {
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

  const query = { roles: 'delivery' };

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
        vehicleType: partner.deliveryData?.vehicleInfo?.type || 'N/A',
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
  const totalPartners = await User.countDocuments({ roles: 'delivery' });
  const availablePartners = await User.countDocuments({
    roles: 'delivery',
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
      $match: { roles: 'delivery' },
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
  logger.business('DELIVERY_FETCH_AVAILABLE', 'Delivery agent fetching available orders', { agentEmail: req.user.email }, { level: 'debug' });

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

    logger.business('ORDER_AVAILABLE_FOR_DELIVERY', 'Available orders found for delivery agents', { orderCount: availableOrders.length, orderNumbers: availableOrders.map(o => o.orderNumber) });

    res.status(200).json({
      status: 'success',
      results: availableOrders.length,
      data: {
        orders: availableOrders,
      },
    });
  } catch (error) {
    logger.business('ORDER_FETCH_FAILED', 'Error fetching available orders for delivery', { errorMessage: error.message }, { level: 'error', severity: 'high' });
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

  logger.business('DELIVERY_ORDER_CLAIM_ATTEMPT', 'Delivery agent attempting to claim order', {
    orderId,
    agentId: deliveryAgent._id,
    agentEmail: deliveryAgent.email,
    agentName: `${deliveryAgent.name.first} ${deliveryAgent.name.last}`,
    agentPhone: deliveryAgent.phone.number,
    vehicleNumber: deliveryAgent.deliveryData.vehicleInfo.number || 'N/A'
  }, { level: 'debug' });

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
      { returnDocument: 'after', runValidators: true }
    );
  } catch (updateError) {
    logger.business('ORDER_UPDATE_FAILED', 'Error updating order during delivery claim', { errorMessage: updateError.message }, { level: 'error', severity: 'high' });
    logger.error(`Stack: ${updateError.stack}`);
    return next(new AppError('Error claiming order', 500));
  }

  // If order is null, it means another agent claimed it or it's not available
  if (!order) {
    logger.security('RACE_CONDITION_DETECTED', 'Order race condition: already claimed or not available', { orderId }, { severity: 'high' });
    return next(new AppError('Order is no longer available or has already been claimed by another agent', 409));
  }

  logger.business('ORDER_CLAIMED', 'Order successfully claimed by delivery agent', {
    orderId: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    deliveryPartnerId: order.deliveryPartner?.id,
    deliveryPartnerName: order.deliveryPartner?.name,
    deliveryPartnerPhone: order.deliveryPartner?.phone,
    assignedAt: order.deliveryPartner?.assignedAt,
    pickedUpAt: order.deliveryPartner?.pickedUpAt
  });

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
    logger.system('SOCKET_NOTIFICATION_ERROR', 'Socket notification error', { errorMessage: socketError.message }, { level: 'error', severity: 'medium' });
  }

  res.status(200).json({
    status: 'success',
    message: 'Order claimed successfully',
    data: {
      order,
    },
  });
});

