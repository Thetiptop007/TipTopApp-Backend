/**
 * =====================================================
 * ORDER ROUTES
 * Domain-based routes for all order-related operations
 * =====================================================
 */

const express = require('express');
const orderController = require('../controllers/order.controller');
const authMiddleware = require('../middlewares/auth');
const orderValidator = require('../validators/order.validator');
const { checkIdempotency } = require('../middlewares/idempotency.middleware');
const { deduplicateRequest } = require('../middlewares/deduplication.middleware');
const { checkShopOpen } = require('../middlewares/shopStatus.middleware');

const router = express.Router();

/* =====================================================
   PUBLIC ORDER ROUTES (Guest Orders)
===================================================== */

// Guest order creation (no authentication) - Check if shop is open
router.post('/guest/create', checkShopOpen, orderController.createGuestOrder);

/* =====================================================
   THERMAL PRINTER SERVICE ROUTES (No Auth Required)
===================================================== */

// Middleware to check printer service header
const checkPrinterService = (req, res, next) => {
  if (req.headers['x-printer-service'] === 'true') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied. This endpoint is only accessible to the printer service.',
  });
};

// Get pending orders for printing
router.get('/pending-print', checkPrinterService, orderController.getPendingPrintOrders);

// Mark order as printed
router.post('/:orderId/printed', checkPrinterService, orderController.markOrderAsPrinted);

/* =====================================================
   CUSTOMER ORDER ROUTES
===================================================== */

// All routes below require authentication
router.use(authMiddleware.protect);

// Create new order (customer) - Check if shop is open
router.post(
  '/',
  authMiddleware.restrictTo('customer'),
  checkShopOpen,
  checkIdempotency(86400), // 24 hours
  deduplicateRequest(5), // 5 second window
  orderValidator.validate(orderValidator.createOrderSchema),
  orderController.createOrder
);

// Get my orders (customer)
router.get(
  '/my-orders',
  authMiddleware.restrictTo('customer'),
  orderValidator.validateQuery(orderValidator.orderQuerySchema),
  orderController.getMyOrders
);

// Rate order (customer)
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

/* =====================================================
   ADMIN ORDER WORKFLOW ROUTES (Before Admin Middleware)
   These routes need to be accessible by admin but are at root level for compatibility
===================================================== */

// Admin accept order (PENDING → ACCEPTED)
router.patch('/:id/accept', authMiddleware.restrictTo('admin'), deduplicateRequest(3), orderController.acceptOrder);

// Admin mark order as preparing (ACCEPTED → PREPARING)
router.patch('/:id/preparing', authMiddleware.restrictTo('admin'), deduplicateRequest(3), orderController.markOrderPreparing);

// Admin mark order as ready (ACCEPTED → READY or READY_FOR_PICKUP)
router.patch('/:id/ready', authMiddleware.restrictTo('admin'), deduplicateRequest(3), orderController.markOrderReady);

// Admin complete takeaway order (READY_FOR_PICKUP → DELIVERED)
router.patch('/:id/complete-takeaway', authMiddleware.restrictTo('admin'), deduplicateRequest(3), orderController.completeTakeawayOrder);

/* =====================================================
   DELIVERY PARTNER ORDER ROUTES
===================================================== */

// Get assigned orders (delivery partner)
router.get(
  '/delivery/assigned',
  authMiddleware.restrictTo('delivery'),
  orderController.getAssignedOrders
);

// Mark order picked up (delivery partner)
router.patch(
  '/delivery/:id/pickup',
  authMiddleware.restrictTo('delivery'),
  orderController.markOrderPickedUp
);

// Mark order delivered (delivery partner)
router.patch(
  '/delivery/:id/deliver',
  authMiddleware.restrictTo('delivery'),
  orderController.markOrderDelivered
);

/* =====================================================
   ADMIN ORDER ROUTES
===================================================== */

// All admin routes require admin role
router.use(authMiddleware.restrictTo('admin'));

// POS - Get minimal menu items for order creation (fast & light)
router.get('/admin/pos-menu', orderController.getPOSMenuItems);

// Create order from admin panel - Check if shop is open
router.post('/admin', checkShopOpen, checkIdempotency(86400), deduplicateRequest(5), orderController.createAdminOrder);

// Get today's orders grouped by status
router.get('/admin/today', orderController.getTodayOrders);

// Get all orders with pagination
router.get('/admin/all', orderController.getAllOrders);

// Get single order details
router.get('/admin/:id/details', orderController.getOrderDetails);

// Update order status
router.patch('/admin/:id/status', orderController.updateOrderStatus);

// Assign delivery partner
router.patch('/admin/:id/assign-delivery', orderController.assignDeliveryPartner);

// Admin cancel order (uses the same cancelOrder function from admin section)
router.patch('/admin/:id/cancel', orderController.cancelOrder);

// Mark order for thermal printing (admin)
router.post('/admin/:orderId/mark-for-print', orderController.markOrderForPrint);

// Create order for customer (admin)
router.post('/admin/for-customer', orderController.createOrderForCustomer);

module.exports = router;
