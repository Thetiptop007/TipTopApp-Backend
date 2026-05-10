const { logSecurityAudit, SECURITY_EVENTS } = require('../services/logging/securityAudit.logger');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

/**
 * Helper to get the first non-empty value from a cookie that might be an array
 */
const getFirstNonEmpty = (val) => {
  if (typeof val === 'string') return val.trim().length > 0 ? val : null;
  if (Array.isArray(val)) return val.find(v => typeof v === 'string' && v.trim().length > 0) || null;
  return null;
};

/**
 * Middleware to prevent simultaneous admin and customer sessions
 *
 * Enforces strict session exclusivity:
 * - Only ONE active auth role per browser session
 * - Rejects requests if both admin and customer cookies exist
 * - Logs all mixed session violations for security auditing
 */
exports.preventMixedSessions = catchAsync(async (req, res, next) => {
  const hasAdminRefresh = !!getFirstNonEmpty(req.cookies.adminRefreshToken);
  const hasCustomerRefresh = !!getFirstNonEmpty(req.cookies.customerRefreshToken);

  // If both tokens exist, this is a security violation
  if (hasAdminRefresh && hasCustomerRefresh) {
    logSecurityAudit(SECURITY_EVENTS.MIXED_SESSIONS_DETECTED, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      path: req.originalUrl,
      method: req.method,
    }, { level: 'error', severity: 'critical' });

    // Clear both sessions immediately on root path
    res.clearCookie('adminRefreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
    });

    res.clearCookie('customerRefreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
    });

    return res.status(403).json({
      status: 'error',
      code: 'MIXED_SESSIONS',
      message: 'Multiple concurrent sessions detected. Please log in again.',
    });
  }

  next();
});

/**
 * Validate that only the expected role's tokens exist
 */
exports.validateSingleSessionScope = (expectedScope) => catchAsync(async (req, res, next) => {
  const hasAdminRefresh = !!getFirstNonEmpty(req.cookies.adminRefreshToken);
  const hasCustomerRefresh = !!getFirstNonEmpty(req.cookies.customerRefreshToken);

  // If trying to use admin scope but customer token exists
  if (expectedScope === 'admin' && hasCustomerRefresh) {
    logSecurityAudit(SECURITY_EVENTS.SCOPE_VIOLATION, {
      expectedScope: 'admin',
      foundScope: 'customer',
      ip: req.ip,
      path: req.originalUrl,
    }, { level: 'warn', severity: 'high' });

    return res.status(403).json({
      status: 'error',
      code: 'SCOPE_VIOLATION',
      message: 'Invalid session scope. Please log in again.',
    });
  }

  // If trying to use customer scope but admin token exists
  if (expectedScope === 'customer' && hasAdminRefresh) {
    logSecurityAudit(SECURITY_EVENTS.SCOPE_VIOLATION, {
      expectedScope: 'customer',
      foundScope: 'admin',
      ip: req.ip,
      path: req.originalUrl,
    }, { level: 'warn', severity: 'high' });

    return res.status(403).json({
      status: 'error',
      code: 'SCOPE_VIOLATION',
      message: 'Invalid session scope. Please log in again.',
    });
  }

  next();
});
