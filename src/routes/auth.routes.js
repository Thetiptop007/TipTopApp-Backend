const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth');
const { preventMixedSessions, validateSingleSessionScope } = require('../middlewares/mixedSessions');
const authValidator = require('../validators/auth.validator');
const { requireCsrf } = require('../middlewares/csrf');
const { authBruteForceLimiter } = require('../middlewares/security/ipRateLimit');
const { refreshTokenRateLimit } = require('../middlewares/security/costBasedThrottle');

const router = express.Router();

// Apply mixed session prevention to ALL auth routes
router.use(preventMixedSessions);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many login attempts. Please try again later.',
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many registration attempts. Please try again later.',
  },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many password reset requests. Please try again later.',
  },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many refresh requests. Please try again later.',
  },
});

const mountDeviceTokenRoutes = (scope) => {
  router.post(
    `/${scope}/device-token`,
    authMiddleware.protect(scope),
    requireCsrf(scope),
    authController.registerDeviceToken
  );

  router.delete(
    `/${scope}/device-token`,
    authMiddleware.protect(scope),
    requireCsrf(scope),
    authController.removeDeviceToken
  );
};

/* =====================================================
   ADMIN AUTH ROUTES
===================================================== */
router.post(
  '/admin/login',
  loginLimiter,
  authBruteForceLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 8 }),
  authValidator.validate(authValidator.adminLoginSchema),
  authController.login
);

// Operational: revoke user sessions (admin-only)
router.post(
  '/admin/ops/revoke/user/:id',
  authMiddleware.protect('admin'),
  authMiddleware.restrictTo('admin'),
  requireCsrf('admin'),
  authController.revokeUserSessions
);

router.post(
  '/admin/refresh',
  validateSingleSessionScope('admin'),
  refreshLimiter,
  refreshTokenRateLimit({ windowMs: 15 * 60000, maxRefreshes: 30 }),
  authController.refreshToken
);

router.post(
  '/admin/logout',
  authMiddleware.protect('admin'),
  requireCsrf('admin'),
  authController.logout
);

router.get('/admin/me', authMiddleware.protect('admin'), authController.getMe);

router.patch(
  '/admin/me',
  authMiddleware.protect('admin'),
  requireCsrf('admin'),
  authController.updateMe
);

router.patch(
  '/admin/change-password',
  authMiddleware.protect('admin'),
  authValidator.validate(authValidator.changePasswordSchema),
  authController.changePassword
);

const mountSessionRoutes = (scope) => {
  router.get(
    `/${scope}/sessions`,
    authMiddleware.protect(scope),
    authController.getSessions
  );

  router.post(
    `/${scope}/sessions/revoke-otp`,
    authMiddleware.protect(scope),
    requireCsrf(scope),
    authController.requestRevocationOtp
  );

  router.delete(
    `/${scope}/sessions/other`,
    authMiddleware.protect(scope),
    requireCsrf(scope),
    authController.revokeAllOtherSessions
  );

  router.delete(
    `/${scope}/sessions/:sessionId`,
    authMiddleware.protect(scope),
    requireCsrf(scope),
    authController.revokeSession
  );
};

mountDeviceTokenRoutes('admin');
mountSessionRoutes('admin');

/* =====================================================
   CUSTOMER AUTH ROUTES
===================================================== */
router.post(
  '/customer/register',
  registerLimiter,
  authValidator.validate(authValidator.registerSchema),
  authController.register
);

router.post(
  '/customer/login',
  loginLimiter,
  authBruteForceLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 8 }),
  authValidator.validate(authValidator.customerLoginSchema),
  authController.login
);

router.post(
  '/customer/google',
  loginLimiter,
  authBruteForceLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 15 }),
  authValidator.validate(authValidator.googleLoginSchema),
  authController.customerGoogleLogin
);

router.post(
  '/customer/refresh',
  validateSingleSessionScope('customer'),
  refreshLimiter,
  refreshTokenRateLimit({ windowMs: 15 * 60000, maxRefreshes: 30 }),
  authController.refreshToken
);

router.post(
  '/customer/logout',
  authMiddleware.protect('customer'),
  requireCsrf('customer'),
  authController.logout
);

router.get('/customer/me', authMiddleware.protect('customer'), authController.getMe);

router.patch(
  '/customer/me',
  authMiddleware.protect('customer'),
  requireCsrf('customer'),
  authController.updateMe
);

router.patch(
  '/customer/change-password',
  authMiddleware.protect('customer'),
  authValidator.validate(authValidator.changePasswordSchema),
  authController.changePassword
);

router.post(
  '/customer/forgot-password',
  forgotPasswordLimiter,
  authValidator.validate(authValidator.forgotPasswordSchema),
  authController.forgotPassword
);

router.patch(
  '/customer/reset-password/:token',
  authValidator.validate(authValidator.resetPasswordSchema),
  authController.resetPassword
);

router.get('/customer/verify-email/:token', authController.verifyEmail);
router.post('/customer/send-verification-email', authMiddleware.protect('customer'), authController.sendVerificationEmail);

mountDeviceTokenRoutes('customer');
mountSessionRoutes('customer');

/* =====================================================
   LEGACY COMPATIBILITY ROUTES
===================================================== */
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/send-verification-email', authMiddleware.protect('customer'), authController.sendVerificationEmail);

module.exports = router;
