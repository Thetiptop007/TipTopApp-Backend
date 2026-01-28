const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const {
  getTodayOrders,
  getAllOrders,
  getOrderDetails,
  updateOrderStatus,
  getPOSMenuItems,
  createAdminOrder
} = require('../controllers/admin-order-management.controller');

// Protect all routes - only admin can access
router.use(protect);
router.use(restrictTo('admin'));

// POS - Get minimal menu items for order creation (fast & light)
router.get('/pos-menu', getPOSMenuItems);

// Create order from admin panel
router.post('/', createAdminOrder);

// Get today's orders grouped by status
router.get('/today', getTodayOrders);

// Get all orders with pagination
router.get('/all', getAllOrders);

// Get single order details
router.get('/:id/details', getOrderDetails);

// Update order status
router.patch('/:id/status', updateOrderStatus);

module.exports = router;
