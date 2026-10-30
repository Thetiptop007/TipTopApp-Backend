const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const { logSecurityAudit, SECURITY_EVENTS } = require('../services/logging/securityAudit.logger');
const { incrementRoleMismatch, incrementTokenMismatch } = require('../services/metrics.service');
const sessionCache = require('../services/sessionCache');

const getTokenType = (decoded = {}) => decoded.type || decoded.tokenType || null;
const getTokenSubject = (decoded = {}) => decoded.sub || decoded.id || null;
const getTokenSessionId = (decoded = {}) => decoded.sid || decoded.sessionId || null;
const getScopeFromRole = (role) => (role === 'admin' ? 'admin' : role === 'customer' ? 'customer' : null);

exports.optionalProtect = () => catchAsync(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    const userId = getTokenSubject(decoded);
    if (userId) {
      const user = await User.findById(userId).select('+isActive +sessionVersion +passwordChangedAt');
      if (user && user.isActive) {
        req.user = user;
      }
    }
  } catch (e) {
    // Ignore invalid token for optional auth
  }

  next();
});

/**
 * Protect middleware - Verifies JWT token and authenticates user
 * Checks:
 * 1. Token exists in Authorization header
 * 2. Token is valid and not expired
 * 3. User still exists in database
 * 4. User is active
 * 5. User hasn't changed password after token was issued
 */
exports.protect = (requiredScope = null) => catchAsync(async (req, res, next) => {
  // 1) Extract bearer token
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
      reason: 'missing_token',
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'medium' });
    return next(new AppError('You are not logged in. Please log in to get access.', 401));
  }

  // 2) Verify JWT signature
  let decoded;
  try {
    decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
  } catch (error) {
    logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
      reason: error.name || 'token_verification_error',
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token. Please log in again.', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Your token has expired. Please log in again.', 401));
    }
    return next(error);
  }

  // 3) Enforce access token type
  const tokenType = getTokenType(decoded);
  if (tokenType !== 'access') {
    logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
      reason: 'wrong_token_type_for_protected_route',
      tokenType,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Invalid authentication token type.', 401));
  }

  const userId = getTokenSubject(decoded);
  const tokenRole = decoded.role || null;
  const tokenSessionId = getTokenSessionId(decoded);
  const tokenScope = getScopeFromRole(tokenRole);

  if (!userId || !tokenRole || !tokenScope || !tokenSessionId) {
    logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
      reason: 'invalid_token_claims',
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Invalid token claims.', 401));
  }

  if (requiredScope && tokenScope !== requiredScope) {
    logSecurityAudit(SECURITY_EVENTS.FORBIDDEN_ACCESS, {
      reason: 'token_scope_mismatch',
      userId,
      tokenScope,
      requiredScope,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    try { incrementRoleMismatch(requiredScope || tokenScope); } catch (e) {}
    return next(new AppError('Invalid authentication scope.', 403));
  }

  // 4) Check in-memory session cache first (Sliding Trust Window)
  const cacheKey = `${userId}-${tokenScope}`;
  const cachedAuth = sessionCache.get(cacheKey);

  if (cachedAuth && cachedAuth.sessionId === tokenSessionId) {
    req.user = cachedAuth.user;
    req.auth = cachedAuth.auth;
    return next();
  }

  // 5) Load user from DB once per request if cache missed.
  const user = await User.findById(userId).select('+isActive +sessionVersion +passwordChangedAt +authSessions');

  if (!user) {
    logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
      reason: 'user_not_found_for_token',
      userId,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('The user belonging to this token no longer exists.', 401));
  }

  const migration = await user.normalizeRoleFromLegacy();
  if (migration.migrated) {
    logger.auth('AUTH_ROLE_MIGRATED', 'Legacy roles migrated to canonical role', {
      userId: user._id.toString(),
      migratedRole: migration.role,
    });
  }

  // 5.a) Session version check - tokens carry `sv` claim and must match user's sessionVersion
  try {
    const tokenSv = decoded.sv || 0;
    const userSv = user.sessionVersion || 0;
    if (tokenSv !== userSv) {
      logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
        reason: 'session_version_mismatch',
        userId: user._id.toString(),
        tokenSv,
        userSv,
        path: req.originalUrl,
        method: req.method,
        ip: req.ip,
      }, { level: 'warn', severity: 'high' });
      return next(new AppError('Session is no longer valid. Please log in again.', 401));
    }
  } catch (e) {
    // ignore and continue - safety net
  }

  // 5) Validate user state
  if (!user.isActive) {
    logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
      reason: 'inactive_user',
      userId: user._id.toString(),
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  if (user.isBlocked) {
    logSecurityAudit(SECURITY_EVENTS.FORBIDDEN_ACCESS, {
      reason: 'blocked_user',
      userId: user._id.toString(),
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Your account has been blocked. Please contact support.', 403));
  }

  if (requiredScope && user.role !== requiredScope) {
    logSecurityAudit(SECURITY_EVENTS.FORBIDDEN_ACCESS, {
      reason: 'user_scope_mismatch',
      userId: user._id.toString(),
      userRole: user.role,
      requiredScope,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    return next(new AppError('Invalid authentication scope.', 403));
  }

  // 6) Validate role-scoped DB session and token hash
  const scope = requiredScope || tokenScope;
  const sessionCheck = await user.verifyAccessSession(scope, {
    accessToken: token,
    sessionId: tokenSessionId,
  });

  if (!sessionCheck.valid) {
    logSecurityAudit(SECURITY_EVENTS.TOKEN_VALIDATION_FAILURE, {
      reason: sessionCheck.reason || 'session_validation_failed',
      userId: user._id.toString(),
      scope,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    }, { level: 'warn', severity: 'high' });
    try { incrementTokenMismatch(scope, sessionCheck.reason || 'session_validation_failed'); } catch (e) {}
    return next(new AppError('Session is no longer valid. Please log in again.', 401));
  }

  // 7) Password rotation invalidates old tokens
  if (user.passwordChangedAt) {
    const changedTimestamp = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
    if (decoded.iat < changedTimestamp) {
      return next(new AppError('User recently changed password. Please log in again.', 401));
    }
  }

  // 8) Attach normalized auth context
  req.user = user;
  req.auth = {
    authenticated: true,
    role: user.role,
    scope,
    sessionId: tokenSessionId,
    expiresAt: sessionCheck.session?.expiresAt || null,
    authVersion: 'v2',
  };

  // 9) Store in cache for subsequent parallel requests (15s window)
  sessionCache.set(cacheKey, {
    user,
    auth: req.auth,
    sessionId: tokenSessionId,
  });

  // 10) allow request
  next();
});

/**
 * Restrict to middleware - Restricts access based on user role
 * Usage: restrictTo('admin', 'manager')
 * Checks if user has the required role
 */
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // req.user is set by protect middleware
    if (!req.user) {
      return next(
        new AppError('User not authenticated. Please use protect middleware first.', 500)
      );
    }

    // Check if user's role matches one of the required roles
    const hasRequiredRole = roles.includes(req.user.role);

    if (!hasRequiredRole) {
      logger.auth('AUTH_ACCESS_DENIED', 'Access denied due to insufficient role', {
        userId: req.user._id.toString(),
        userRole: req.user.role,
        requiredRoles: roles,
      });
      logSecurityAudit(SECURITY_EVENTS.FORBIDDEN_ACCESS, {
        reason: 'role_restriction_denied',
        userId: req.user._id.toString(),
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.originalUrl,
        method: req.method,
        ip: req.ip,
      }, { level: 'warn', severity: 'high' });
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }

    logger.auth('AUTH_ACCESS_GRANTED', 'User authorized successfully', {
      userId: req.user._id.toString(),
      userRole: req.user.role,
      requiredRoles: roles,
    });
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
    // Silently fail for optional auth (no security log needed)
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
      logger.auth('AUTH_ACCESS_DENIED', 'Ownership check failed', {
        userId: req.user._id.toString(),
        resourceUserId: resourceUserId.toString(),
      });
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
