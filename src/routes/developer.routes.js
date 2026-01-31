const express = require('express');
const developerController = require('../controllers/developer.controller');
const authMiddleware = require('../middlewares/auth');

const router = express.Router();

/**
 * All routes require authentication and admin role
 */
router.use(authMiddleware.protect);
router.use(authMiddleware.restrictTo('admin'));

/**
 * System Health & Performance
 */
router.get('/health', developerController.getSystemHealth);
router.get('/performance', developerController.getPerformanceMetrics);
router.get('/config', developerController.getConfig);

/**
 * Database Statistics
 */
router.get('/database-stats', developerController.getDatabaseStats);

/**
 * API Statistics
 */
router.get('/api-stats', developerController.getApiStats);

/**
 * Logs Management
 */
router.get('/logs', developerController.getLogs);
router.delete('/logs', developerController.clearLogs);

/**
 * Error Logs
 */
router.get('/errors', developerController.getErrorLogs);

/**
 * Testing
 */
router.post('/test-error-email', developerController.testErrorEmail);

module.exports = router;
