/**
 * =====================================================
 * OFFER ROUTES
 * Routes for promotional offers management
 * =====================================================
 */

const express = require('express');
const offerController = require('../controllers/offer.controller');
const authMiddleware = require('../middlewares/auth');
const { cacheMiddleware } = require('../middlewares/cache');

const router = express.Router();

/* =====================================================
   CUSTOMER OFFER ROUTES (Public)
===================================================== */

// Get active offers
router.get('/active', cacheMiddleware(30, 'offers'), offerController.getActiveOffers);

// Get teaser offers (upcoming)
router.get('/teasers', cacheMiddleware(30, 'offers'), offerController.getTeaserOffers);

// Check applicable offers for cart items
router.post('/check', offerController.checkApplicableOffers);

/* =====================================================
   ADMIN OFFER ROUTES (Protected)
===================================================== */

// Protect all admin routes
router.use('/admin', authMiddleware.protect);
router.use('/admin', authMiddleware.restrictTo('admin', 'owner'));

// Get all offers (with filters)
router.get('/admin', offerController.getAllOffers);

// Create new offer
router.post('/admin', offerController.createOffer);

// Get offer by ID
router.get('/admin/:id', offerController.getOffer);

// Update offer
router.patch('/admin/:id', offerController.updateOffer);

// Deactivate offer
router.patch('/admin/:id/deactivate', offerController.deactivateOffer);

// Delete offer
router.delete('/admin/:id', offerController.deleteOffer);

// Duplicate offer
router.post('/admin/:id/duplicate', offerController.duplicateOffer);

// Get offer statistics
router.get('/admin/:id/stats', offerController.getOfferStats);

module.exports = router;
