const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const notificationService = require('../services/notification.service');
const { logSecurityAudit, SECURITY_EVENTS } = require('../services/logging/securityAudit.logger');
const { logAuthEvent } = require('../services/logging/auth.logger');
const { incrementLoginOutcome } = require('../services/metrics.service');

const getAuthScope = (req, user = null) => {
  const route = String(req.originalUrl || req.baseUrl || req.path || '').toLowerCase();

  if (route.includes('/auth/admin/')) {
    return 'admin';
  }

  if (route.includes('/auth/customer/')) {
    return 'customer';
  }

  if (user) {
    return user.role === 'admin' ? 'admin' : 'customer';
  }

  return 'customer';
};

const getRefreshCookieName = (scope) => (scope === 'admin' ? 'adminRefreshToken' : 'customerRefreshToken');

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
});

const getLegacyRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/v1/auth',
});

const parseRefreshTokenExpiryMs = () => {
  const raw = process.env.JWT_REFRESH_EXPIRE || '7d';
  const match = String(raw).trim().match(/^(\d+)([smhd])$/i);

  if (!match) {
    return 7 * 24 * 60 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * unitMs[unit];
};

const setRefreshCookie = (res, scope, token) => {
  res.clearCookie(getRefreshCookieName(scope), getLegacyRefreshCookieOptions());
  res.cookie(getRefreshCookieName(scope), token, {
    ...getRefreshCookieOptions(),
    maxAge: parseRefreshTokenExpiryMs(),
  });
};

const clearRefreshCookie = (res, scope) => {
  res.clearCookie(getRefreshCookieName(scope), getRefreshCookieOptions());
  res.clearCookie(getRefreshCookieName(scope), getLegacyRefreshCookieOptions());
};

const getCsrfCookieName = (scope) => `${scope}CsrfToken`;

const getCsrfCookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
});

const getLegacyCsrfCookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/v1/auth',
});

const setCsrfCookie = (res, scope) => {
  const token = crypto.randomBytes(32).toString('hex');
  res.clearCookie(getCsrfCookieName(scope), getLegacyCsrfCookieOptions());
  res.cookie(getCsrfCookieName(scope), token, {
    ...getCsrfCookieOptions(),
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
};

const clearCsrfCookie = (res, scope) => {
  res.clearCookie(getCsrfCookieName(scope), getCsrfCookieOptions());
  res.clearCookie(getCsrfCookieName(scope), getLegacyCsrfCookieOptions());
};

const buildAuthResponse = ({ user, message, statusCode, scope, accessToken, res }) => {
  const csrfToken = setCsrfCookie(res, scope);

  return res.status(statusCode).json({
    status: 'success',
    message,
    data: {
      user,
      tokens: {
        accessToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      },
      csrfToken,
    },
  });
};

/**
 * Generate JWT tokens and send response
 */
const createSendToken = async (user, statusCode, res, message = 'Success') => {
  const scope = user.role === 'admin' ? 'admin' : 'customer';
  const accessToken = user.generateAuthToken(scope);
  const refreshToken = user.generateRefreshToken(scope);

  await user.storeRefreshSession(scope, refreshToken);
  // Update last login
  await user.updateLastLogin();
  setRefreshCookie(res, scope, refreshToken);

  // Remove password from output
  user.password = undefined;
  user.refreshToken = undefined;

  buildAuthResponse({
    user,
    message,
    statusCode,
    scope,
    accessToken,
    res,
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

  logger.auth('AUTH_DEVICE_TOKEN_REGISTERED', 'Device token registered', {
    userId: req.user._id.toString(),
    platform,
  });

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

  logger.auth('AUTH_DEVICE_TOKEN_REMOVED', 'Device token removed', {
    userId: req.user._id.toString(),
  });

  res.status(200).json({
    status: 'success',
    message: 'Device token removed successfully',
    data: {
      user: null,
    },
  });
});

/**
 * Register a new user
 * POST /api/v1/auth/register
 */
exports.register = catchAsync(async (req, res, next) => {
  const scope = getAuthScope(req);

  if (scope !== 'customer') {
    return next(new AppError('Registration is only available for customer accounts.', 403));
  }

  const {
    name,
    email,
    password,
    phone,
    addresses,
    preferences,
  } = req.body;

  // Force role to 'customer' for any public registration request.
  // Do NOT trust client-supplied `role` or `roles` fields.
  const role = 'customer';

  logger.auth('AUTH_REGISTRATION_ATTEMPT', 'User registration initiated', {
    scope,
  });

  // Generate email from phone if not provided
  const userEmail = email || `${phone.replace(/[^\d]/g, '')}@tiptop.app`;

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ 'email.address': userEmail }, { 'phone.number': phone }],
  });

  if (existingUser) {
    if (existingUser.email.address === userEmail && email) {
      logger.auth('AUTH_REGISTRATION_FAILED', 'Registration failed: email already registered', {
        email: userEmail,
      });
      return next(new AppError('Email is already registered.', 400));
    }
    if (existingUser.phone.number === phone) {
      logger.auth('AUTH_REGISTRATION_FAILED', 'Registration failed: phone already registered', {
        phone: phone.replace(/\d(?=\d{3})/g, '*'),
      });
      return next(new AppError('Phone number is already registered.', 400));
    }
  }

  // Server-side enforcement: role is forced to 'customer'.

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
      isVerified: true,
    },
    password,
    phone: {
      number: phone,
      isVerified: true,
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

  await user.save({ validateBeforeSave: false });

  logger.auth('AUTH_REGISTRATION_SUCCESS', 'User registered successfully', {
    userId: user._id.toString(),
    userRole: user.role,
  });

  await createSendToken(user, 201, res, 'Account created successfully.');
});

/**
 * Login user
 * POST /api/v1/auth/login
 */
exports.login = catchAsync(async (req, res, next) => {
  const scope = getAuthScope(req);
  const { email, password } = req.body;

  logger.auth('AUTH_LOGIN_ATTEMPT', 'Login attempt', {
    scope,
  });

  // 1) Check if email/phone and password exist
  if (!email || !password) {
    logger.auth('AUTH_LOGIN_FAILED', 'Login failed: missing credentials', {
      scope,
    });
    incrementLoginOutcome(scope, 'failed');
    logSecurityAudit(SECURITY_EVENTS.LOGIN_FAILURE, {
      reason: 'missing_credentials',
      scope,
      ip: req.ip,
    }, { level: 'warn', severity: 'medium' });
    return next(new AppError('Please provide email/phone and password.', 400));
  }

  // 2) Normalize phone number - use 10 digit format only
  let searchIdentifier = email;
  
  // If it looks like a phone number, use only 10 digits
  if (/^(\+91)?[6-9]\d{9}$/.test(email)) {
    searchIdentifier = email.replace(/^\+91/, '');
  }

  const user = await User.findOne({
    $or: [
      { 'email.address': email },
      { 'phone.number': searchIdentifier },
    ],
  }).select('+password +isActive');

  // 3) Check if user exists and password is correct
  if (!user || !(await user.comparePassword(password))) {
    logger.auth('AUTH_LOGIN_FAILED', 'Login failed: invalid credentials', {
      scope,
    });
    incrementLoginOutcome(scope, 'failed');
    logSecurityAudit(SECURITY_EVENTS.LOGIN_FAILURE, {
      reason: 'invalid_credentials',
      scope,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Incorrect email/phone or password.', 401));
  }

  if (scope === 'admin' && user.role !== 'admin') {
    logSecurityAudit(SECURITY_EVENTS.FORBIDDEN_ACCESS, {
      userId: user._id.toString(),
      role: user.role,
      scope,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Access denied. Admin privileges required.', 403));
  }

  if (scope === 'customer' && user.role !== 'customer') {
    return next(new AppError('Access denied. Customer account required.', 403));
  }

  if (user.isBlocked) {
    logger.auth('AUTH_LOGIN_FAILED', 'Login failed: account blocked', {
      userId: user._id.toString(),
    });
    incrementLoginOutcome(scope, 'failed');
    logSecurityAudit(SECURITY_EVENTS.LOGIN_FAILURE, {
      userId: user._id.toString(),
      reason: 'blocked_account',
      scope,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Your account has been blocked. Please contact support.', 403));
  }

  logger.auth('AUTH_LOGIN_SUCCESS', 'User logged in successfully', {
    userId: user._id.toString(),
    role: user.role,
    scope,
  });
  incrementLoginOutcome(scope, 'success');

  await createSendToken(user, 200, res, 'Login successful!');
});

/**
 * Get current user profile
 * GET /api/v1/auth/me
 */
exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Current user loaded successfully.',
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
  const { name, email, phone } = req.body;

  // Get user
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  // Update name if provided
  if (name) {
    if (name.first !== undefined) {
      user.name.first = name.first;
    }
    if (name.last !== undefined) {
      user.name.last = name.last;
    }
  }

  // Update email if provided (with duplicate check)
  if (email && email !== user.email.address) {
    const existingUser = await User.findOne({ 'email.address': email });
    if (existingUser) {
      return next(
        new AppError('This email address is already in use by another account.', 409)
      );
    }
    user.email.address = email;
    user.email.isVerified = false; // Mark as unverified when email changes
  }

  // Update phone if provided (with duplicate check)
  if (phone && phone !== user.phone?.number) {
    const existingUser = await User.findOne({ 'phone.number': phone });
    if (existingUser) {
      return next(
        new AppError('This phone number is already in use by another account.', 409)
      );
    }
    user.phone = user.phone || {};
    user.phone.number = phone;
    user.phone.isVerified = false; // Mark as unverified when phone changes
  }

  await user.save();

  logger.auth('AUTH_PROFILE_UPDATED', 'User profile updated', { userId: user._id, updatedFields: Object.keys(updateData) });

  res.status(200).json({
    status: 'success',
    message: 'Profile updated successfully.',
    data: {
      user,
    },
  });
});

/**
 * Logout
 * POST /api/v1/auth/logout
 */
exports.logout = catchAsync(async (req, res, next) => {
  const scope = getAuthScope(req, req.user);

  if (req.user) {
    await req.user.revokeRefreshSession(scope);
  }

  clearRefreshCookie(res, scope);
  clearCsrfCookie(res, scope);

  logger.auth('AUTH_LOGOUT', 'User logged out', {
    userId: req.user?._id?.toString(),
    userRole: req.user?.role,
    scope,
  });

  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully.',
    data: {
      user: null,
    },
  });
});

/**
 * Refresh access token
 * POST /api/v1/auth/refresh-token
 */
exports.refreshToken = catchAsync(async (req, res, next) => {
  const scope = getAuthScope(req);
  const cookieName = getRefreshCookieName(scope);
  const refreshToken = req.cookies?.[cookieName] || req.body.refreshToken;

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

  if (decoded.scope && decoded.scope !== scope) {
    clearRefreshCookie(res, scope);
    clearCsrfCookie(res, scope);
    return next(new AppError('Invalid refresh token scope.', 401));
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

  if (scope === 'admin' && user.role !== 'admin') {
    return next(new AppError('Invalid refresh token scope.', 401));
  }

  if (scope === 'customer' && user.role !== 'customer') {
    return next(new AppError('Invalid refresh token scope.', 401));
  }

  const tokenMatchesSession = await user.verifyRefreshSession(scope, refreshToken);
  if (!tokenMatchesSession) {
    clearRefreshCookie(res, scope);
    return next(new AppError('Invalid refresh token.', 401));
  }

  // Generate new access token
  const newAccessToken = user.generateAuthToken(scope);
  const newRefreshToken = user.generateRefreshToken(scope);

  await user.storeRefreshSession(scope, newRefreshToken);
  setRefreshCookie(res, scope, newRefreshToken);
  const csrfToken = setCsrfCookie(res, scope);

  logger.auth('AUTH_TOKEN_REFRESH', 'Access token refreshed', {
    userId: user._id.toString(),
    role: user.role,
    scope,
  });

  res.status(200).json({
    status: 'success',
    message: 'Token refreshed successfully.',
    data: {
      user,
      tokens: {
        accessToken: newAccessToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      },
      csrfToken,
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
      data: {
        user: null,
      },
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

  logger.auth('AUTH_PASSWORD_RESET', 'Password reset initiated', {
    userId: user._id.toString(),
  });

  // TODO: Send email with reset link

  res.status(200).json({
    status: 'success',
    message:
      'If your email is registered, you will receive a password reset link.',
    data: {
      user: null,
    },
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

  logger.auth('AUTH_PASSWORD_CHANGED', 'Password changed via reset token', {
    userId: user._id.toString(),
  });

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

  logger.auth('AUTH_PASSWORD_CHANGED', 'Password changed successfully', { userId: user._id });

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

  logger.auth('AUTH_EMAIL_VERIFIED', 'Email verified for user', { userId: user._id });

  res.status(200).json({
    status: 'success',
    message: 'Email verified successfully!',
    data: {
      user,
    },
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
  logger.auth('AUTH_VERIFICATION_URL_GENERATED', 'Email verification URL generated', { userId: user._id }, { level: 'debug' });

  res.status(200).json({
    status: 'success',
    message: 'Verification email sent!',
    data: {
      user: req.user,
    },
    // Remove in production - only for development
    ...(process.env.NODE_ENV === 'development' && { verificationToken }),
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
  if (process.env.NODE_ENV === 'development') {
    logger.auth('AUTH_PROFILE_UPDATE_ATTEMPT', 'Profile update payload received', {
      payloadKeys: Object.keys(req.body || {}),
    }, { level: 'debug' });
  }
  
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

  if (process.env.NODE_ENV === 'development') {
    logger.auth('AUTH_PROFILE_UPDATE_FILTERED', 'Profile update filtered payload', {
      payloadKeys: Object.keys(filteredBody || {}),
    }, { level: 'debug' });
  }

  // Update user
  const user = await User.findByIdAndUpdate(req.user._id, filteredBody, {
    returnDocument: 'after',
    runValidators: true,
  });

  logger.auth('AUTH_PROFILE_UPDATED', 'User profile updated', {
    userId: user._id,
  });

  res.status(200).json({
    status: 'success',
    message: 'Profile updated successfully!',
    data: {
      user,
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

  logger.auth('AUTH_ACCOUNT_DEACTIVATED', 'User account deactivated', { userId: user._id });

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

  logger.auth('AUTH_DEVICE_TOKEN_REGISTERED', 'Device token registered', { userId: user._id, platform }, { level: 'debug' });

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

  logger.auth('AUTH_DEVICE_TOKEN_REMOVED', 'Device token removed', { userId: user._id });

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
    logger.auth('AUTH_PASSWORD_CHANGE_FAILED', 'Failed password change: incorrect current password', { userId: user._id }, { severity: 'medium' });
    logSecurityAudit(SECURITY_EVENTS.PASSWORD_CHANGE, {
      userId: user._id.toString(),
      outcome: 'failed',
      reason: 'incorrect_current_password',
      ip: req.ip,
    }, { level: 'warn', severity: 'medium' });
    return next(new AppError('Current password is incorrect', 401));
  }

  // 4) Update password
  user.password = newPassword;
  await user.save();

  logger.auth('AUTH_PASSWORD_CHANGED', 'Password changed successfully', { userId: user._id });
  logSecurityAudit(SECURITY_EVENTS.PASSWORD_CHANGE, {
    userId: user._id.toString(),
    outcome: 'success',
    ip: req.ip,
  }, { level: 'info', severity: 'medium' });

  // 5) Send success response
  res.status(200).json({
    status: 'success',
    message: 'Password changed successfully',
  });
});

