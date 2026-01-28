const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const {
  getMenuItems,
  getCategories,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  updateAvailability,
  deleteMenuItem
} = require('../controllers/admin-menu.controller');

// Protect all routes - only admin can access
router.use(protect);
router.use(restrictTo('admin'));

// Get all categories
router.get('/categories', getCategories);

// Get all menu items with filtering and pagination
router.get('/', getMenuItems);

// Create new menu item
router.post('/', createMenuItem);

// Get single menu item details
router.get('/:id', getMenuItem);

// Update menu item
router.put('/:id', updateMenuItem);

// Update menu item availability
router.patch('/:id/availability', updateAvailability);

// Delete menu item
router.delete('/:id', deleteMenuItem);

module.exports = router;