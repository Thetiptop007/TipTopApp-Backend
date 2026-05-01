const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth');
const authValidator = require('../validators/auth.validator');
const { requireCsrf } = require('../middlewares/csrf');

const router = express.Router();

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
  authValidator.validate(authValidator.adminLoginSchema),
  authController.login
);

router.post(
  '/admin/refresh',
  refreshLimiter,
  requireCsrf('admin'),
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
  '/admin/change-password',
  authMiddleware.protect('admin'),
  authValidator.validate(authValidator.changePasswordSchema),
  authController.changePassword
);

mountDeviceTokenRoutes('admin');

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
  authValidator.validate(authValidator.customerLoginSchema),
  authController.login
);

router.post(
  '/customer/refresh',
  refreshLimiter,
  requireCsrf('customer'),
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

/* =====================================================
   LEGACY COMPATIBILITY ROUTES
===================================================== */
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/send-verification-email', authMiddleware.protect('customer'), authController.sendVerificationEmail);

module.exports = router;
