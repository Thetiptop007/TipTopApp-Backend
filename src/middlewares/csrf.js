const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const getCsrfCookieName = (scope) => `${scope}CsrfToken`;

const getCsrfCookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: '/',
});

const getLegacyCsrfCookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: '/api/v1/auth',
});

const issueCsrfToken = (res, scope) => {
  const token = crypto.randomBytes(32).toString('hex');
  res.clearCookie(getCsrfCookieName(scope), getLegacyCsrfCookieOptions());
  res.cookie(getCsrfCookieName(scope), token, {
    ...getCsrfCookieOptions(),
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
};

const clearCsrfToken = (res, scope) => {
  res.clearCookie(getCsrfCookieName(scope), getCsrfCookieOptions());
  res.clearCookie(getCsrfCookieName(scope), getLegacyCsrfCookieOptions());
};

const requireCsrf = (scope) => (req, res, next) => {
  const cookieToken = req.cookies?.[getCsrfCookieName(scope)];
  const headerToken = req.get('x-csrf-token');

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(
      `[CSRF check] ${JSON.stringify({
        scope,
        method: req.method,
        url: req.originalUrl,
        cookieName: getCsrfCookieName(scope),
        hasCookieToken: !!cookieToken,
        hasHeaderToken: !!headerToken,
        cookieKeys: Object.keys(req.cookies || {}),
        cookieTokenPreview: cookieToken ? `${cookieToken.slice(0, 8)}...` : null,
        headerTokenPreview: headerToken ? `${headerToken.slice(0, 8)}...` : null,
        userAgent: req.get('user-agent') || 'unknown',
        ip: req.ip,
      })}`
    );
  }

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(
        `[CSRF mismatch] ${JSON.stringify({
          scope,
          method: req.method,
          url: req.originalUrl,
          cookieName: getCsrfCookieName(scope),
          cookiePresent: !!cookieToken,
          headerPresent: !!headerToken,
          cookieMatchHeader: !!cookieToken && !!headerToken ? cookieToken === headerToken : false,
          cookieTokenPreview: cookieToken ? `${cookieToken.slice(0, 8)}...` : null,
          headerTokenPreview: headerToken ? `${headerToken.slice(0, 8)}...` : null,
          cookieKeys: Object.keys(req.cookies || {}),
          routeParams: req.params,
          bodyKeys: Object.keys(req.body || {}),
        })}`
      );
    }

    return next(new AppError('Invalid CSRF token.', 403));
  }

  return next();
};

module.exports = {
  getCsrfCookieName,
  issueCsrfToken,
  clearCsrfToken,
  requireCsrf,
};
