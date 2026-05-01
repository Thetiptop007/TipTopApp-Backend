const express = require('express');
const router = express.Router();
const { getSettings, initializeSettings, updateSettings, toggleShopStatus, getShopStatus } = require('../controllers/settings.controller');
const authMiddleware = require('../middlewares/auth');
const { cacheMiddleware } = require('../middlewares/cache');

// Public routes
router.get('/init', initializeSettings);
router.get('/', cacheMiddleware(30, 'settings'), getSettings);
router.get('/shop-status', cacheMiddleware(15, 'settings'), getShopStatus);

// Admin only routes
router.put('/', authMiddleware.protect('admin'), authMiddleware.restrictTo('admin'), updateSettings);
router.patch('/shop-status', authMiddleware.protect('admin'), authMiddleware.restrictTo('admin'), toggleShopStatus);

module.exports = router;
