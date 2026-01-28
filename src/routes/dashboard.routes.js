const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { getDashboardStats } = require('../controllers/dashboard.controller');

// Protect all routes - only authenticated admins can access
router.use(protect);
router.use(restrictTo('admin'));

// Get dashboard stats in single optimized call
router.get('/stats', getDashboardStats);

module.exports = router;
