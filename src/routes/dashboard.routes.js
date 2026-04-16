const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { getDashboardStats, getBusinessInsights, getDashboardFull } = require('../controllers/dashboard.controller');

// Protect all routes - only authenticated admins can access
router.use(protect);
router.use(restrictTo('admin'));

// Get dashboard stats in single optimized call
router.get('/stats', getDashboardStats);

// Get business insights (summary + yearly/monthly trends)
router.get('/business-insights', getBusinessInsights);

// Get complete dashboard payload in single call
router.get('/full', getDashboardFull);

module.exports = router;
