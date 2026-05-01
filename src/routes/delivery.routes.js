const express = require('express');
const deliveryController = require('../controllers/delivery.controller');
const authMiddleware = require('../middlewares/auth');
const Joi = require('joi');

const router = express.Router();

/**
 * All delivery routes require authentication
 */
router.use(authMiddleware.protect());

/**
 * Delivery Partner routes
 */

// Get my statistics
router.get(
  '/my-stats',
  authMiddleware.restrictTo('delivery', 'admin'),
  deliveryController.getMyStats
);

// Get available orders (ready for pickup)
router.get(
  '/available-orders',
  authMiddleware.restrictTo('delivery', 'admin'),
  deliveryController.getAvailableOrders
);

// Claim/select an order to deliver
router.post(
  '/claim-order/:orderId',
  authMiddleware.restrictTo('delivery', 'admin'),
  deliveryController.claimOrder
);

// Update availability
router.patch(
  '/availability',
  authMiddleware.restrictTo('delivery'),
  deliveryController.updateAvailability
);

// Update location
router.patch(
  '/location',
  authMiddleware.restrictTo('delivery'),
  deliveryController.updateLocation
);

// Start delivery session
router.post(
  '/session/start',
  authMiddleware.restrictTo('delivery'),
  deliveryController.startDeliverySession
);

// End delivery session
router.patch(
  '/session/end',
  authMiddleware.restrictTo('delivery'),
  deliveryController.endDeliverySession
);

/**
 * Admin routes
 */

// Register new delivery partner
router.post(
  '/register',
  authMiddleware.restrictTo('admin'),
  deliveryController.registerDeliveryPartner
);

// Delete delivery partner
router.delete(
  '/partner/:id',
  authMiddleware.restrictTo('admin'),
  deliveryController.deleteDeliveryPartner
);

// Update delivery partner
router.patch(
  '/partner/:id',
  authMiddleware.restrictTo('admin'),
  deliveryController.updateDeliveryPartner
);

// Get delivery statistics
router.get(
  '/stats/overview',
  authMiddleware.restrictTo('admin'),
  deliveryController.getDeliveryStats
);

// Get all delivery partners
router.get(
  '/partners',
  authMiddleware.restrictTo('admin'),
  deliveryController.getAllDeliveryPartners
);

// Get available delivery partners
router.get(
  '/available',
  authMiddleware.restrictTo('admin'),
  deliveryController.getAvailableDeliveryPartners
);

// Get active sessions
router.get(
  '/sessions/active',
  authMiddleware.restrictTo('admin'),
  deliveryController.getActiveSessions
);

// Get unsettled sessions
router.get(
  '/sessions/unsettled',
  authMiddleware.restrictTo('admin'),
  deliveryController.getUnsettledSessions
);

// Settle delivery session
router.patch(
  '/session/:id/settle',
  authMiddleware.restrictTo('admin'),
  deliveryController.settleDeliverySession
);

/**
 * Shared routes (Delivery Partner & Admin)
 */

// Get delivery sessions
router.get(
  '/sessions',
  authMiddleware.restrictTo('admin', 'delivery'),
  deliveryController.getDeliverySessions
);

module.exports = router;
