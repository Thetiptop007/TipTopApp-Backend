/**
 * =====================================================
 * ADMIN ORDERS ROUTES (LEGACY COMPATIBILITY)
 * Maps old /admin/orders/* to new order controller
 * =====================================================
 */

const express = require('express');
const orderController = require('../controllers/order.controller');
const authMiddleware = require('../middlewares/auth');
const orderValidator = require('../validators/order.validator');

const router = express.Router();

// All admin orders routes require authentication and admin role
router.use(authMiddleware.protect);
router.use(authMiddleware.restrictTo('admin'));

// POS - Get minimal menu items for order creation (fast & light)
router.get('/pos-menu', orderController.getPOSMenuItems);

// Create order from admin panel
router.post('/', orderController.createAdminOrder);

// Get today's orders grouped by status
router.get('/today', orderController.getTodayOrders);

// Get all orders with pagination
router.get('/all', orderController.getAllOrders);

// Get single order details
router.get('/:id/details', orderController.getOrderDetails);

// Update order status
router.patch('/:id/status', orderController.updateOrderStatus);

// Assign delivery partner
router.patch('/:id/assign-delivery', orderController.assignDeliveryPartner);

// Admin cancel order
router.patch('/:id/cancel', orderController.cancelOrder);

// Create order for customer (admin)
router.post('/for-customer', orderController.createOrderForCustomer);

// Admin accept order (PENDING → ACCEPTED)
router.patch('/:id/accept', orderController.acceptOrder);

// Admin mark order as preparing (ACCEPTED → PREPARING)
router.patch('/:id/preparing', orderController.markOrderPreparing);

// Admin mark order as ready (ACCEPTED → READY or READY_FOR_PICKUP)
router.patch('/:id/ready', orderController.markOrderReady);

// Admin complete takeaway order (READY_FOR_PICKUP → DELIVERED)
router.patch('/:id/complete-takeaway', orderController.completeTakeawayOrder);

module.exports = router;
