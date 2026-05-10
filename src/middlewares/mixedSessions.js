const { logSecurityAudit, SECURITY_EVENTS } = require('../services/logging/securityAudit.logger');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

/**
 * Middleware to prevent simultaneous admin and customer sessions
 *
 * Enforces strict session exclusivity:
 * - Only ONE active auth role per browser session
 * - Rejects requests if both admin and customer cookies exist
 * - Logs all mixed session violations for security auditing
 */
// Robust cookie parser that handles duplicates and arrays from production environments
const parseRobustCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader) return cookies;
  
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [key, ...rest] = pair.trim().split('=');
    if (!key) continue;
    const val = rest.join('=');
    
    if (cookies[key]) {
      if (Array.isArray(cookies[key])) {
        cookies[key].push(val);
      } else {
        cookies[key] = [cookies[key], val];
      }
    } else {
      cookies[key] = val;
    }
  }
  return cookies;
};

exports.preventMixedSessions = catchAsync(async (req, res, next) => {
  // Re-parse cookies robustly to handle duplicates sent by production browsers
  if (req.headers.cookie) {
    const robustCookies = parseRobustCookies(req.headers.cookie);
    req.cookies = { ...req.cookies, ...robustCookies };
  }

  // Allow login/logout/refresh to bypass this check as they are the points of transition
  // Actually, refresh should STILL check, but LOGIN/LOGOUT must skip
  if (req.path.includes('/login') || req.path.includes('/logout') || req.path.includes('/register')) {
    return next();
  }

  const getFirstNonEmpty = (val) => {
    if (Array.isArray(val)) return val.find(v => typeof v === 'string' && v.trim().length > 0) || null;
    if (typeof val === 'string' && val.trim().length > 0) return val;
    return null;
  };

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
  const getFirstNonEmpty = (val) => {
    if (Array.isArray(val)) return val.find(v => typeof v === 'string' && v.trim().length > 0) || null;
    if (typeof val === 'string' && val.trim().length > 0) return val;
    return null;
  };

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
