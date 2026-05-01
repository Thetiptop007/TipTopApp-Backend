const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { getDashboardStats, getBusinessInsights, getDashboardFull } = require('../controllers/dashboard.controller');
const { buildDashboardBundle } = require('../services/dashboard.service');
const logger = require('../utils/logger');

if (process.env.NODE_ENV === 'development') {
	router.use((req, res, next) => {
		const startedAt = Date.now();
		logger.info(`[DASHBOARD_DEBUG] router entry ${JSON.stringify({
			method: req.method,
			path: req.originalUrl,
			hasAuthorization: !!req.headers.authorization,
		})}`);

		res.on('finish', () => {
			logger.info(`[DASHBOARD_DEBUG] router finish ${JSON.stringify({
				method: req.method,
				path: req.originalUrl,
				statusCode: res.statusCode,
				durationMs: Date.now() - startedAt,
			})}`);
		});

		next();
	});
}

// Development-only quick debug route to build the bundle without auth
if (process.env.NODE_ENV === 'development') {
	router.get('/stats-debug', async (req, res, next) => {
		try {
			const started = Date.now();
			const bundle = await buildDashboardBundle();
			logger.info(`[DASHBOARD_DEBUG] stats-debug built durationMs=${Date.now() - started}`);
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

