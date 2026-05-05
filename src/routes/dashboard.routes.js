const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { getDashboardStats, getBusinessInsights, getDashboardFull } = require('../controllers/dashboard.controller');
const { buildDashboardBundle } = require('../services/dashboard.service');
const logger = require('../utils/logger');

// Development-only quick debug route to build the bundle without auth
if (process.env.NODE_ENV === 'development') {
	router.get('/stats-debug', async (req, res, next) => {
		try {
			const started = Date.now();
			const bundle = await buildDashboardBundle();
			logger.business('DASHBOARD_BUNDLE_BUILT', 'Dashboard stats debug bundle built', {
				durationMs: Date.now() - started,
			}, { level: 'debug' });
			return res.status(200).json({ status: 'success', data: bundle.stats });
		} catch (err) {
			return next(err);
		}
	});
}

// Protect all routes - only authenticated admins can access
router.use(protect('admin'));
router.use(restrictTo('admin'));

// Get dashboard stats in single optimized call
router.get('/stats', getDashboardStats);

// Get business insights (summary + yearly/monthly trends)
router.get('/business-insights', getBusinessInsights);

// Get complete dashboard payload in single call
router.get('/full', getDashboardFull);

module.exports = router;

