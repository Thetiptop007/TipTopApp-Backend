const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const notificationService = require('../services/notification.service');

/**
 * Generate JWT tokens and send response
 */
const createSendToken = async (user, statusCode, res, message = 'Success') => {
  const accessToken = user.generateAuthToken();
  const refreshToken = user.generateRefreshToken();

  // Update last login
  await user.updateLastLogin();

  // Remove password from output
  user.password = undefined;
  user.refreshToken = undefined;

  res.status(statusCode).json({
    status: 'success',
    message,
    data: {
      user,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      },
    },
  });
};

/**
 * Register device token for push notifications
 * POST /api/v1/auth/device-token
 * Protected route
 */
exports.registerDeviceToken = catchAsync(async (req, res, next) => {
  const { token, platform, deviceId } = req.body;

  if (!token || !platform) {
    return next(new AppError('Token and platform are required', 400));
  }

  // Validate platform
  if (!['ios', 'android', 'web'].includes(platform)) {
    return next(new AppError('Platform must be ios, android, or web', 400));
  }

  // Add device token to user
  await req.user.addDeviceToken(token, platform, deviceId);

  logger.info(`Device token registered for user ${req.user.email.address} on ${platform}`);

  res.status(200).json({
    status: 'success',
    message: 'Device token registered successfully',
    data: {
      tokenCount: req.user.deviceTokens.length,
    },
  });
});

/**
 * Remove device token (on logout)
 * DELETE /api/v1/auth/device-token
 * Protected route
 */
exports.removeDeviceToken = catchAsync(async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    return next(new AppError('Token is required', 400));
  }

  // Remove device token from user
  await req.user.removeDeviceToken(token);

  logger.info(`Device token removed for user ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Device token removed successfully',
  });
});

/**
 * Register a new user
 * POST /api/v1/auth/register
 */
exports.register = catchAsync(async (req, res, next) => {
  const {
    name,
    email,
    password,
    phone,
    role = 'customer',
    addresses,
    preferences,
  } = req.body;

  logger.info(`[REGISTER] Attempt for email: ${email}, phone: ${phone}`);

  // Generate email from phone if not provided
  const userEmail = email || `${phone.replace(/[^\d]/g, '')}@tiptop.app`;

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ 'email.address': userEmail }, { 'phone.number': phone }],
  });

  if (existingUser) {
    if (existingUser.email.address === userEmail && email) {
      logger.warn(`[REGISTER] Failed - Email already exists: ${userEmail}`);
      return next(new AppError('Email is already registered.', 400));
    }
    if (existingUser.phone.number === phone) {
      logger.warn(`[REGISTER] Failed - Phone already exists: ${phone}`);
      return next(new AppError('Phone number is already registered.', 400));
    }
  }

  // Validate role - only certain roles can self-register
  const allowedRoles = ['customer'];
  if (!allowedRoles.includes(role)) {
    return next(
      new AppError(
        'Invalid role. You can only register as a customer. Contact admin for other roles.',
        400
      )
    );
  }

  // Parse name into first and last name
  let firstName, lastName;
  if (typeof name === 'string') {
    const nameParts = name.trim().split(' ');
    firstName = nameParts[0];
    lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  } else {
    // name is already an object with first and last
    firstName = name.first;
    lastName = name.last;
  }

  // Create new user
  const userData = {
    name: {
      first: firstName,
      last: lastName,
    },
    email: {
      address: userEmail,
      isVerified: false,
    },
    password,
    phone: {
      number: phone,
      isVerified: false,
    },
    roles: [role],
    role,
  };

  // Add optional fields
  if (addresses && addresses.length > 0) {
    userData.addresses = addresses;
  }

  if (preferences) {
    userData.preferences = preferences;
  }

  const user = await User.create(userData);

  logger.info(`[REGISTER] SUCCESS - New user created: ${user.email.address} (ID: ${user._id}, Role: ${user.role})`);

  // Set user as verified by default (OTP disabled for now)
  user.email.isVerified = true;
  user.phone.isVerified = true;
  await user.save({ validateBeforeSave: false });

  // Authenticate user immediately after registration
  await createSendToken(user, 201, res, 'Account created successfully! You are now logged in.');
});

/**
 * Login user
 * POST /api/v1/auth/login
 */
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  logger.info(`\n========== LOGIN ATTEMPT ==========`);
  logger.info(`[LOGIN] Identifier provided: ${email}`);
  logger.info(`[LOGIN] Password length: ${password ? password.length : 0}`);

  // 1) Check if email/phone and password exist
  if (!email || !password) {
    logger.warn('[LOGIN] Failed - Missing credentials');
    return next(new AppError('Please provide email/phone and password.', 400));
  }

  // 2) Normalize phone number - use 10 digit format only
  let searchIdentifier = email;
  
  // If it looks like a phone number, use only 10 digits
  if (/^(\+91)?[6-9]\d{9}$/.test(email)) {
    // Remove +91 if present to get 10 digit number
    searchIdentifier = email.replace(/^\+91/, '');
    logger.info(`[LOGIN] Phone number detected: ${searchIdentifier}`);
  }
  
  logger.info(`[LOGIN] Searching for user with email OR phone: ${searchIdentifier}`);
  
  const user = await User.findOne({
    $or: [
      { 'email.address': email },
      { 'phone.number': searchIdentifier },
    ],
  }).select('+password +isActive');

  logger.info(`[LOGIN] User found: ${user ? 'YES' : 'NO'}`);
  
  if (user) {
    logger.info(`[LOGIN] User details:`);
    logger.info(`  - ID: ${user._id}`);
    logger.info(`  - Name: ${user.name.first} ${user.name.last}`);
    logger.info(`  - Email: ${user.email.address}`);
    logger.info(`  - Phone: ${user.phone.number}`);
    logger.info(`  - Role: ${user.role}`);
    logger.info(`  - Active: ${user.isActive}`);
    logger.info(`  - Has Password: ${user.password ? 'YES' : 'NO'}`);
    
    // Test password comparison
    const passwordMatch = await user.comparePassword(password);
    logger.info(`  - Password Match: ${passwordMatch ? 'YES' : 'NO'}`);
  } else {
    logger.warn(`[LOGIN] No user found with identifier: ${email}`);
    logger.warn(`[LOGIN] Tried to match:`);
    logger.warn(`  - email.address: ${email}`);
    logger.warn(`  - phone.number: ${searchIdentifier}`);
  }

  // 3) Check if user exists and password is correct
  if (!user || !(await user.comparePassword(password))) {
    logger.warn(`[LOGIN] Failed - Incorrect credentials for: ${email}`);
    logger.info(`========================================\n`);
    return next(new AppError('Incorrect email/phone or password.', 401));
  }

  if (user.isBlocked) {
    logger.warn(`[LOGIN] Failed - Blocked user attempted login: ${user.email.address}`);
    logger.info(`========================================\n`);
    return next(new AppError('Your account has been blocked. Please contact support.', 403));
  }

  logger.info(`[LOGIN] SUCCESS - User logged in: ${user.email.address} (ID: ${user._id}, Role: ${user.role})`);
  logger.info(`========================================\n`);

  // Send token (verification check and isActive check removed)
  createSendToken(user, 200, res, 'Login successful!');
});

/**
 * Get current user profile
 * GET /api/v1/auth/me
 */
exports.getMe = catchAsync(async (req, res, next) => {
  // req.user is set by the protect middleware
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    user,
  });
});

/**
 * Update current user profile
 * PATCH /api/v1/auth/me
 */
exports.logout = catchAsync(async (req, res, next) => {
  // TODO: Implement token blacklisting if needed
  // For now, client-side will remove the token

  logger.info(`User logged out: ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully.',
  });
});

/**
 * Refresh access token
 * POST /api/v1/auth/refresh-token
 */
exports.refreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return next(new AppError('Please provide a refresh token.', 400));
  }

  // Verify refresh token
  let decoded;
  try {
    decoded = await promisify(jwt.verify)(
      refreshToken,
      process.env.JWT_REFRESH_SECRET
    );
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid refresh token.', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(
        new AppError('Refresh token has expired. Please log in again.', 401)
      );
    }
    return next(error);
  }

  // Check if user still exists
  const user = await User.findById(decoded.id).select('+isActive');
  if (!user) {
    return next(new AppError('User no longer exists.', 401));
  }

  // Check if user is active
  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated.', 401));
  }

  // Generate new access token
  const newAccessToken = user.generateAuthToken();

  logger.info(`Access token refreshed for user: ${user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Token refreshed successfully.',
    data: {
      accessToken: newAccessToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },
  });
});

/**
 * Forgot password - Generate reset token
 * POST /api/v1/auth/forgot-password
 */
exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new AppError('Please provide your email address.', 400));
  }

  // Find user
  const user = await User.findOne({ 'email.address': email });
  if (!user) {
    // Don't reveal if user exists or not for security
    return res.status(200).json({
      status: 'success',
      message:
        'If your email is registered, you will receive a password reset link.',
    });
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Save to user
  user.passwordResetToken = hashedToken;
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save({ validateBeforeSave: false });

  logger.info(`Password reset requested for: ${user.email.address}`);

  // TODO: Send email with reset link
  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/auth/reset-password/${resetToken}`;
  logger.info(`Reset URL (TODO: send via email): ${resetURL}`);

  res.status(200).json({
    status: 'success',
    message:
      'If your email is registered, you will receive a password reset link.',
    // Remove in production - only for development
    ...(process.env.NODE_ENV === 'development' && { resetToken }),
  });
});

/**
 * Reset password with token
 * PATCH /api/v1/auth/reset-password/:token
 */
exports.resetPassword = catchAsync(async (req, res, next) => {
  const { password } = req.body;
  const { token } = req.params;

  if (!password) {
    return next(new AppError('Please provide a new password.', 400));
  }

  // Hash the token from params
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with valid token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(
      new AppError('Token is invalid or has expired. Please try again.', 400)
    );
  }

  // Update password
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordChangedAt = Date.now();
  await user.save();

  logger.info(`Password reset successful for: ${user.email.address}`);

  // Log user in with new password
  createSendToken(user, 200, res, 'Password reset successful!');
});

/**
 * Change password (for logged-in users)
 * PATCH /api/v1/auth/change-password
 */
exports.changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return next(
      new AppError('Please provide current password and new password.', 400)
    );
  }

  // Get user with password
  const user = await User.findById(req.user._id).select('+password');

  // Check if current password is correct
  if (!(await user.comparePassword(currentPassword))) {
    return next(new AppError('Current password is incorrect.', 401));
  }

  // Update password
  user.password = newPassword;
  user.passwordChangedAt = Date.now();
  await user.save();

  logger.info(`Password changed for: ${user.email.address}`);

  // Log user in with new password
  createSendToken(user, 200, res, 'Password changed successfully!');
});

/**
 * Verify email with token
 * GET /api/v1/auth/verify-email/:token
 */
exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.params;

  // Hash token
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with token
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
  });

  if (!user) {
    return next(new AppError('Invalid verification token.', 400));
  }

  // Mark email as verified
  user.email.isVerified = true;
  user.emailVerificationToken = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`Email verified for: ${user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Email verified successfully!',
  });
});

/**
 * Send email verification link
 * POST /api/v1/auth/send-verification-email
 */
exports.sendVerificationEmail = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (user.email.isVerified) {
    return next(new AppError('Email is already verified.', 400));
  }

  // Generate verification token
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  user.emailVerificationToken = hashedToken;
  await user.save({ validateBeforeSave: false });

  // TODO: Send verification email
  const verificationURL = `${req.protocol}://${req.get('host')}/api/v1/auth/verify-email/${verificationToken}`;
  logger.info(`Verification URL (TODO: send via email): ${verificationURL}`);

  res.status(200).json({
    status: 'success',
    message: 'Verification email sent!',
    // Remove in production - only for development
    ...(process.env.NODE_ENV === 'development' && { verificationToken }),
  });
});

/**
 * Verify phone with OTP
 * POST /api/v1/auth/verify-phone
 */
exports.verifyPhone = catchAsync(async (req, res, next) => {
  const { otp } = req.body;

  if (!otp) {
    return next(new AppError('Please provide the OTP.', 400));
  }

  const user = await User.findById(req.user._id);

  // Check if OTP matches and is not expired
  if (
    !user.phone.verificationCode ||
    user.phone.verificationCode !== otp ||
    user.phone.verificationExpires < Date.now()
  ) {
    return next(new AppError('Invalid or expired OTP.', 400));
  }

  // Mark phone as verified
  user.phone.isVerified = true;
  user.phone.verificationCode = undefined;
  user.phone.verificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`Phone verified for: ${user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Phone verified successfully!',
  });
});

/**
 * Send phone verification OTP
 * POST /api/v1/auth/send-verification-sms
 */
exports.sendVerificationSMS = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (user.phone.isVerified) {
    return next(new AppError('Phone is already verified.', 400));
  }

  // Generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  user.phone.verificationCode = otp;
  user.phone.verificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save({ validateBeforeSave: false });

  // TODO: Send OTP via SMS
  logger.info(`OTP for ${user.phone.number}: ${otp}`);

  res.status(200).json({
    status: 'success',
    message: 'Verification OTP sent to your phone!',
    // Remove in production - only for development
    ...(process.env.NODE_ENV === 'development' && { otp }),
  });
});

/**
 * Get current user profile
 * GET /api/v1/auth/me
 */
exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  res.status(200).json({
    status: 'success',
    data: {
      user,
    },
  });
});

/**
 * Update current user profile
 * PATCH /api/v1/auth/me
 */
exports.updateMe = catchAsync(async (req, res, next) => {
  logger.info(`📥 [updateMe-ACTUAL] Received body: ${JSON.stringify(req.body)}`);
  
  // Don't allow password update through this route
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /change-password.',
        400
      )
    );
  }

  // Filter allowed fields
  const allowedFields = ['name', 'preferences', 'addresses', 'email', 'phone'];
  const filteredBody = {};
  Object.keys(req.body).forEach(key => {
    if (allowedFields.includes(key)) {
      // Transform email and phone to nested structure
      if (key === 'email') {
        filteredBody['email.address'] = req.body[key];
      } else if (key === 'phone') {
        filteredBody['phone.number'] = req.body[key];
      } else {
        filteredBody[key] = req.body[key];
      }
    }
  });

  logger.info(`📝 [updateMe-ACTUAL] Filtered updates: ${JSON.stringify(filteredBody)}`);

  // Update user
  const user = await User.findByIdAndUpdate(req.user._id, filteredBody, {
    new: true,
    runValidators: true,
  });

  logger.info(`✅ [updateMe-ACTUAL] Updated - email: ${user.email.address}, phone: ${user.phone.number}`);
  logger.info(`Profile updated for: ${user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Profile updated successfully!',
    data: {
      user,
    },
  });
});

/**
 * Verify Email with OTP
 * POST /api/v1/auth/verify-otp
 * Public access
 */
exports.verifyOTP = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body;

  logger.info(`[VERIFY-OTP] Attempt for email: ${email}`);

  if (!email || !otp) {
    logger.warn('[VERIFY-OTP] Failed - Missing email or OTP');
    return next(new AppError('Please provide email and OTP.', 400));
  }

  // Hash the provided OTP
  const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

  // Find user with matching email, OTP, and non-expired token
  const user = await User.findOne({
    'email.address': email,
    emailVerificationToken: hashedOTP,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    logger.warn(`[VERIFY-OTP] Failed - Invalid or expired OTP for email: ${email}`);
    return next(new AppError('Invalid or expired OTP. Please request a new one.', 400));
  }

  // Mark email as verified
  user.email.isVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`[VERIFY-OTP] SUCCESS - Email verified for: ${user.email.address} (ID: ${user._id})`);

  // Auto-login user after verification
  createSendToken(
    user,
    200,
    res,
    'Email verified successfully! You are now logged in.'
  );
});

/**
 * Resend OTP
 * POST /api/v1/auth/resend-otp
 * Public access
 */
exports.resendOTP = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  logger.info(`[RESEND-OTP] Request for email: ${email}`);

  if (!email) {
    logger.warn('[RESEND-OTP] Failed - Missing email');
    return next(new AppError('Please provide email.', 400));
  }

  // Find user
  const user = await User.findOne({ 'email.address': email });

  if (!user) {
    logger.warn(`[RESEND-OTP] Failed - No account found for email: ${email}`);
    return next(new AppError('No account found with this email.', 404));
  }

  // Check if already verified
  if (user.email.isVerified) {
    logger.warn(`[RESEND-OTP] Failed - Email already verified: ${email}`);
    return next(new AppError('Email is already verified. You can login now.', 400));
  }

  // Generate new 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

  // Update user with new OTP
  user.emailVerificationToken = hashedOTP;
  user.emailVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save({ validateBeforeSave: false });

  logger.info(`[RESEND-OTP] SUCCESS - OTP regenerated for: ${user.email.address} (ID: ${user._id})`);
  logger.info(`[RESEND-OTP] OTP for ${user.email.address}: ${otp} (Emails disabled - check logs)`);

  // Return response immediately
  res.status(200).json({
    status: 'success',
    message: 'New OTP generated! (Check server logs for development)',
    data: {
      otpSent: false,
      expiresIn: '10 minutes',
      ...(process.env.NODE_ENV === 'development' && { otp }), // Only in development
    },
  });
});

/**
 * Get user's frequently ordered items
 * GET /api/v1/auth/me/frequently-ordered
 */
exports.getFrequentlyOrdered = catchAsync(async (req, res, next) => {
  const Order = require('../models/Order');
  const MenuItem = require('../models/MenuItem');
  
  const limit = parseInt(req.query.limit) || 10;
  const userId = req.user._id;

  // Aggregate orders to find frequently ordered items
  const frequentItems = await Order.aggregate([
    // Match only delivered orders for this user
    {
      $match: {
        'customer.id': userId,
        status: 'DELIVERED',
      },
    },
    // Unwind items array to process each item separately
    { $unwind: '$items' },
    // Group by menu item and count occurrences
    {
      $group: {
        _id: '$items.menuItemId',
        orderCount: { $sum: 1 },
        totalQuantity: { $sum: '$items.quantity' },
      },
    },
    // Sort by order count (most frequent first)
    { $sort: { orderCount: -1 } },
    // Limit to top N items
    { $limit: limit },
  ]);

  // If no orders found, return empty array
  if (!frequentItems || frequentItems.length === 0) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      data: {
        items: [],
      },
    });
  }

  // Fetch full menu item details
  const menuItemIds = frequentItems.map((item) => item._id);
  const menuItems = await MenuItem.find({
    _id: { $in: menuItemIds },
    isAvailable: true,
  }).select('-__v');

  // Map menu items with order count
  const itemsWithStats = menuItems.map((menuItem) => {
    const stats = frequentItems.find(
      (item) => item._id.toString() === menuItem._id.toString()
    );
    return {
      ...menuItem.toObject(),
      orderCount: stats?.orderCount || 0,
      totalQuantity: stats?.totalQuantity || 0,
    };
  });

  // Sort by order count again (in case some items were filtered out)
  itemsWithStats.sort((a, b) => b.orderCount - a.orderCount);

  res.status(200).json({
    status: 'success',
    results: itemsWithStats.length,
    data: {
      items: itemsWithStats,
    },
  });
});

/**
 * Deactivate current user account
 * DELETE /api/v1/auth/me
 */
exports.deleteMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id).select('+password');

  // Verify password before deactivation
  const { password } = req.body;
  if (!password || !(await user.comparePassword(password))) {
    return next(
      new AppError('Please provide your password to deactivate account.', 401)
    );
  }

  user.isActive = false;
  await user.save({ validateBeforeSave: false });

  logger.info(`Account deactivated for: ${user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Account deactivated successfully.',
  });
});

/**
 * Register or update device token for push notifications
 * POST /api/v1/auth/device-token
 */
exports.registerDeviceToken = catchAsync(async (req, res, next) => {
  const { token, platform, deviceId } = req.body;

  if (!token || !platform) {
    return next(new AppError('Device token and platform are required', 400));
  }

  if (!['ios', 'android', 'web'].includes(platform)) {
    return next(new AppError('Invalid platform. Must be ios, android, or web', 400));
  }

  const user = await User.findById(req.user._id);
  await user.addDeviceToken(token, platform, deviceId);

  logger.info(`Device token registered for user ${user.email.address} - Platform: ${platform}`);

  res.status(200).json({
    status: 'success',
    message: 'Device token registered successfully',
    data: {
      tokensCount: user.deviceTokens.length,
    },
  });
});

/**
 * Remove device token
 * DELETE /api/v1/auth/device-token
 */
exports.removeDeviceToken = catchAsync(async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    return next(new AppError('Device token is required', 400));
  }

  const user = await User.findById(req.user._id);
  await user.removeDeviceToken(token);

  logger.info(`Device token removed for user ${user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Device token removed successfully',
  });
});

/**
 * Change password for authenticated user (Admin)
 * PUT /api/v1/auth/change-password
 * Protected route - requires authentication
 */
exports.changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // 1) Validate input
  if (!currentPassword || !newPassword || !confirmPassword) {
    return next(new AppError('Please provide current password, new password, and confirm password', 400));
  }

  if (newPassword !== confirmPassword) {
    return next(new AppError('New password and confirm password do not match', 400));
  }

  if (newPassword.length < 6) {
    return next(new AppError('New password must be at least 6 characters long', 400));
  }

  if (currentPassword === newPassword) {
    return next(new AppError('New password must be different from current password', 400));
  }

  // 2) Get user with password field
  const user = await User.findById(req.user._id).select('+password');

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // 3) Check if current password is correct
  const isPasswordCorrect = await user.comparePassword(currentPassword);

  if (!isPasswordCorrect) {
    logger.warn(`Failed password change attempt for user ${user.email.address} - incorrect current password`);
    return next(new AppError('Current password is incorrect', 401));
  }

  // 4) Update password
  user.password = newPassword;
  await user.save();

  logger.info(`Password changed successfully for user ${user.email.address}`);

  // 5) Send success response
  res.status(200).json({
    status: 'success',
    message: 'Password changed successfully',
  });
});

