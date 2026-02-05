const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

/**
 * Protect middleware - Verifies JWT token and authenticates user
 * Checks:
 * 1. Token exists in Authorization header
 * 2. Token is valid and not expired
 * 3. User still exists in database
 * 4. User is active
 * 5. User hasn't changed password after token was issued
 */
exports.protect = catchAsync(async (req, res, next) => {
  // 1) Get token from header
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError('You are not logged in. Please log in to get access.', 401)
    );
  }

  // 2) Verify token
  let decoded;
  try {
    decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token. Please log in again.', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(
        new AppError('Your token has expired. Please log in again.', 401)
      );
    }
    return next(error);
  }

  // 3) Check if user still exists
  const user = await User.findById(decoded.id).select('+isActive');
  if (!user) {
    return next(
      new AppError('The user belonging to this token no longer exists.', 401)
    );
  }

  // 4) Check if user is active
  if (!user.isActive) {
    return next(
      new AppError('Your account has been deactivated. Please contact support.', 401)
    );
  }

  // 5) Check if user changed password after token was issued
  if (user.passwordChangedAt) {
    const changedTimestamp = parseInt(
      user.passwordChangedAt.getTime() / 1000,
      10
    );
    if (decoded.iat < changedTimestamp) {
      return next(
        new AppError('User recently changed password. Please log in again.', 401)
      );
    }
  }

  // Grant access to protected route
  req.user = user;
  logger.info(`User authenticated: ${user.email} (${user.role})`);
  next();
});

/**
 * Restrict to middleware - Restricts access based on user roles
 * Usage: restrictTo('admin', 'manager')
 * Checks if user has ANY of the required roles
 */
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // req.user is set by protect middleware
    if (!req.user) {
      return next(
        new AppError('User not authenticated. Please use protect middleware first.', 500)
      );
    }

    // Check if user has any of the required roles
    const userRoles = req.user.roles || [req.user.role];
    const hasRequiredRole = roles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      logger.warn(
        `Access denied for user ${req.user.email} (roles: ${userRoles.join(', ')}) - Required roles: ${roles.join(', ')}`
      );
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }

    logger.info(
      `Access granted for user ${req.user.email} (roles: ${userRoles.join(', ')})`
    );
    next();
  };
};

/**
 * Optional authentication middleware
 * Attaches user to request if token is valid, but doesn't require authentication
 * Useful for routes that show different content for logged-in vs non-logged-in users
 */
exports.optionalAuth = catchAsync(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+isActive');
    
    if (user && user.isActive) {
      req.user = user;
    }
  } catch (error) {
    // Silently fail for optional auth
    logger.debug(`Optional auth failed: ${error.message}`);
  }

  next();
});

/**
 * Check if user owns the resource or is admin
 * Usage: After protect middleware, to ensure user can only access their own resources
 */
exports.checkOwnership = (resourceUserIdField = 'user') => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('User not authenticated.', 500));
    }

    // Admin can access any resource
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user owns the resource
    const resourceUserId = req[resourceUserIdField] || req.body[resourceUserIdField];
    
    if (!resourceUserId) {
      return next(
        new AppError('Resource ownership cannot be verified.', 500)
      );
    }

    if (resourceUserId.toString() !== req.user._id.toString()) {
      logger.warn(
        `Ownership check failed for user ${req.user.email} - Resource: ${resourceUserId}`
      );
      return next(
        new AppError('You do not have permission to access this resource.', 403)
      );
    }

    next();
  };
};

/**
 * Verify phone middleware
 * Ensures user has verified their phone number before accessing certain routes
 */
exports.requirePhoneVerification = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('User not authenticated.', 500));
  }

  if (!req.user.phone.isVerified) {
    return next(
      new AppError('Please verify your phone number to access this feature.', 403)
    );
  }

  next();
};

/**
 * Verify email middleware
 * Ensures user has verified their email before accessing certain routes
 */
exports.requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('User not authenticated.', 500));
  }

  if (!req.user.email.isVerified) {
    return next(
      new AppError('Please verify your email address to access this feature.', 403)
    );
  }

  next();
};

/**
 * Rate limit by user
 * More sophisticated rate limiting based on user ID (already authenticated)
 * Can be used for per-user API quotas
 */
exports.rateLimitByUser = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const userRequests = new Map();

  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('User not authenticated.', 500));
    }

    const userId = req.user._id.toString();
    const now = Date.now();
    
    if (!userRequests.has(userId)) {
      userRequests.set(userId, []);
    }

    const requests = userRequests.get(userId);
    
    // Remove old requests outside the window
    const validRequests = requests.filter(
      timestamp => now - timestamp < windowMs
    );
    
    if (validRequests.length >= maxRequests) {
      return next(
        new AppError(
          `Too many requests. Please try again in ${Math.ceil(windowMs / 60000)} minutes.`,
          429
        )
      );
    }

    validRequests.push(now);
    userRequests.set(userId, validRequests);

    next();
  };
};
