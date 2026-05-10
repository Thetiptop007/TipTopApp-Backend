const { logSecurityAudit, SECURITY_EVENTS } = require('../services/logging/securityAudit.logger');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { sweepCookies } = require('../utils/cookieUtils');

/**
 * Robust cookie parser that handles duplicates and arrays from production environments
 */
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

  // Allow login/logout/register to bypass this check as they are the points of transition
  if (req.path.includes('/login') || req.path.includes('/logout') || req.path.includes('/register')) {
    return next();
  }

  const { getFirstNonEmpty } = require('../utils/cookieUtils');

  const hasAdminRefresh = !!getFirstNonEmpty(req.cookies.adminRefreshToken);
  const hasCustomerRefresh = !!getFirstNonEmpty(req.cookies.customerRefreshToken);

  // If both tokens exist, this is a potential security violation
  if (hasAdminRefresh && hasCustomerRefresh) {
    // Determine the intended scope to decide which token to keep
    const tokenScopeHeader = req.get('x-token-scope');
    const path = req.path.toLowerCase();
    const isExplicitAdminRoute = path.includes('/admin/');
    const isExplicitCustomerRoute = path.includes('/customer/');
    
    const intendedScope = tokenScopeHeader === 'admin' || isExplicitAdminRoute ? 'admin' : 
                         (tokenScopeHeader === 'customer' || isExplicitCustomerRoute ? 'customer' : null);

    if (intendedScope) {
      // Smarter correction: only clear the token that doesn't match the intended scope
      const conflictingScope = intendedScope === 'admin' ? 'customer' : 'admin';
      
      logSecurityAudit(SECURITY_EVENTS.MIXED_SESSIONS_DETECTED, {
        ip: req.ip,
        intendedScope,
        conflictingScope,
        path: req.originalUrl,
        action: 'conflicting_token_cleared',
      }, { level: 'warn', severity: 'medium' });

      sweepCookies(res, `${conflictingScope}RefreshToken`);
      sweepCookies(res, `${conflictingScope}CsrfToken`);
      
      return next();
    }

    // If we can't determine the intended scope, fall back to clearing both (original aggressive behavior)
    logSecurityAudit(SECURITY_EVENTS.MIXED_SESSIONS_DETECTED, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      path: req.originalUrl,
      method: req.method,
      action: 'all_tokens_cleared',
    }, { level: 'error', severity: 'critical' });

    sweepCookies(res, 'adminRefreshToken');
    sweepCookies(res, 'customerRefreshToken');
    sweepCookies(res, 'adminCsrfToken');
    sweepCookies(res, 'customerCsrfToken');

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
  const { getFirstNonEmpty } = require('../utils/cookieUtils');

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

    sweepCookies(res, 'customerRefreshToken');
    sweepCookies(res, 'customerCsrfToken');

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

    sweepCookies(res, 'adminRefreshToken');
    sweepCookies(res, 'adminCsrfToken');

    return res.status(403).json({
      status: 'error',
      code: 'SCOPE_VIOLATION',
      message: 'Invalid session scope. Please log in again.',
    });
  }

  next();
});

