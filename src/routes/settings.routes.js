const express = require('express');
const router = express.Router();
const { getSettings, updateSettings, toggleShopStatus, getShopStatus } = require('../controllers/settings.controller');
const authMiddleware = require('../middlewares/auth');

// Public routes
router.get('/', getSettings);
router.get('/shop-status', getShopStatus);

// Admin only routes
router.put('/', authMiddleware.protect, authMiddleware.restrictTo('admin'), updateSettings);
router.patch('/shop-status', authMiddleware.protect, authMiddleware.restrictTo('admin'), toggleShopStatus);

module.exports = router;
