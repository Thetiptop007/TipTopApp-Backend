/**
 * =====================================================
 * ADMIN MENU ITEMS ROUTES (LEGACY COMPATIBILITY)
 * Maps old /admin/menu-items/* to new menu controller
 * =====================================================
 */

const express = require('express');
const menuController = require('../controllers/menu.controller');
const authMiddleware = require('../middlewares/auth');
const menuValidator = require('../validators/menu.validator');

const router = express.Router();

// All admin menu-items routes require authentication and admin role
router.use(authMiddleware.protect('admin'));
router.use(authMiddleware.restrictTo('admin'));

// Get all categories (admin)
router.get('/categories', menuController.getCategories);

// Get all menu items (admin) with filtering and pagination
router.get('/', menuController.getMenuItems);

// Create new menu item
router.post(
  '/',
  menuValidator.validate(menuValidator.createMenuItemSchema),
  menuController.createMenuItem
);

// Get single menu item details (admin)
router.get('/:id', menuController.getMenuItem);

// Update menu item
router.put(
  '/:id',
  menuValidator.validate(menuValidator.updateMenuItemSchema),
  menuController.updateMenuItem
);

// Update menu item availability
router.patch('/:id/availability', menuController.updateAvailability);

// Restore deleted menu item
router.patch('/:id/restore', menuController.restoreMenuItem);

// Permanently delete menu item
router.delete('/:id/permanent', menuController.permanentlyDeleteMenuItem);

// Delete menu item
router.delete('/:id', menuController.deleteMenuItem);

module.exports = router;
