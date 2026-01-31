const express = require('express');
const { logFrontendError, testErrorNotification } = require('../controllers/error.controller');
const { protect, restrictTo } = require('../middlewares/auth');

const router = express.Router();

// Public route - log frontend errors (no auth required)
router.post('/log', logFrontendError);

// Protected route - test error notification (admin only)
router.post('/test', protect, restrictTo('admin', 'superadmin'), testErrorNotification);

module.exports = router;
