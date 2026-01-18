const express = require('express');
const orderController = require('../controllers/order.controller');
const adminOrderController = require('../controllers/admin-order.controller');
const authMiddleware = require('../middlewares/auth');
const orderValidator = require('../validators/order.validator');

const router = express.Router();

/**
 * All order routes require authentication
 */
router.use(authMiddleware.protect);

/**
 * Customer routes
 */

// Create new order
router.post(
  '/',
  authMiddleware.restrictTo('customer'),
  orderValidator.validate(orderValidator.createOrderSchema),
  orderController.createOrder
);

// Get my orders
router.get(
  '/my-orders',
  authMiddleware.restrictTo('customer'),
  orderValidator.validateQuery(orderValidator.orderQuerySchema),
  orderController.getMyOrders
);

// Rate order
router.patch(
  '/:id/rate',
  authMiddleware.restrictTo('customer'),
  orderValidator.validate(orderValidator.rateOrderSchema),
  orderController.rateOrder
);

// Cancel order (customer)
router.patch(
  '/:id/cancel',
  authMiddleware.restrictTo('customer'),
  orderController.customerCancelOrder
);

/**
 * Admin & Delivery Partner routes
 */

// Get pending orders (admin only)
router.get(
  '/pending/all',
  authMiddleware.restrictTo('admin'),
  orderController.getPendingOrders
);

// Get order statistics (admin only)
router.get(
  '/stats/overview',
  authMiddleware.restrictTo('admin'),
  orderController.getOrderStats
);

// Get orders by status
router.get(
  '/status/:status',
  authMiddleware.restrictTo('admin', 'delivery'),
  orderController.getOrdersByStatus
);

// Get all orders (admin sees all, delivery sees assigned)
router.get(
  '/',
  authMiddleware.restrictTo('admin', 'delivery'),
  orderValidator.validateQuery(orderValidator.orderQuerySchema),
  orderController.getAllOrders
);

/**
 * Admin-specific order management routes
 */

// Admin create order for walk-in customer
router.post(
  '/admin/create',
  authMiddleware.restrictTo('admin'),
  adminOrderController.createOrderForCustomer
);

// Complete takeaway order
router.patch(
  '/:id/complete-takeaway',
  authMiddleware.restrictTo('admin'),
  adminOrderController.completeTakeawayOrder
);

// Mark order as ready (admin only)
router.patch(
  '/:id/ready',
  authMiddleware.restrictTo('admin'),
  orderController.markOrderReady
);

// Assign delivery partner (admin only)
router.patch(
  '/:id/assign',
  authMiddleware.restrictTo('admin'),
  orderController.assignDeliveryPartner
);

// Cancel order (admin only)
router.patch(
  '/:id/admin-cancel',
  authMiddleware.restrictTo('admin'),
  orderController.cancelOrder
);

/**
 * Delivery partner routes
 */

// Get assigned orders
router.get(
  '/delivery/assigned',
  authMiddleware.restrictTo('delivery'),
  orderController.getAssignedOrders
);

// Mark order picked up
router.patch(
  '/:id/pickup',
  authMiddleware.restrictTo('delivery'),
  orderController.markOrderPickedUp
);

// Mark order delivered
router.patch(
  '/:id/deliver',
  authMiddleware.restrictTo('delivery'),
  orderController.markOrderDelivered
);

// Track order (customer for own orders, admin, assigned delivery partner)
router.get('/:id/track', orderController.trackOrder);

// Get order by ID (customer for own orders, admin, assigned delivery partner)
router.get('/:id', orderController.getOrderById);

module.exports = router;
