/**
 * =====================================================
 * MENU ROUTES
 * Domain-based routes for all menu-related operations
 * =====================================================
 */

const express = require('express');
const menuController = require('../controllers/menu.controller');
const authMiddleware = require('../middlewares/auth');
const menuValidator = require('../validators/menu.validator');
const { cacheMiddleware } = require('../middlewares/cache');

const router = express.Router();

/* =====================================================
   PUBLIC / CUSTOMER MENU ROUTES
===================================================== */

// Get popular items (must be before /:id) - Cache for 10 minutes
router.get('/popular/items', cacheMiddleware(600, 'menu'), menuController.getPopularItems);

// Get full menu snapshot for shared frontend filtering - Cache for 60 seconds
router.get('/all', cacheMiddleware(60, 'menu'), menuController.getAllMenuForCache);

// Get all categories (must be before /:id) - Cache for 15 minutes
router.get('/categories/all', cacheMiddleware(900, 'menu'), menuController.getAllCategories);

// Get menu items by category (must be before /:id) - Cache for 5 minutes
router.get('/category/:category', cacheMiddleware(300, 'menu'), menuController.getMenuItemsByCategory);

// Get menu item by slug (must be before /:id) - Cache for 10 minutes
router.get('/slug/:slug', cacheMiddleware(600, 'menu'), menuController.getMenuItemBySlug);

// Get all menu items with filtering, sorting, pagination - Cache for 5 minutes
router.get(
  '/',
  cacheMiddleware(300, 'menu'),
  menuValidator.validateQuery(menuValidator.menuQuerySchema),
  menuController.getAllMenuItems
);

// Get menu statistics - Cache for 5 minutes (public for admin dashboard)
router.get('/stats/overview', cacheMiddleware(300, 'menu'), menuController.getMenuStats);

// Get menu item by ID - Cache for 10 minutes
router.get('/:id', cacheMiddleware(600, 'menu'), menuController.getMenuItem);

/* =====================================================
   ADMIN MENU ROUTES
===================================================== */

// All routes below require authentication and admin role
router.use(authMiddleware.protect('admin'));
router.use(authMiddleware.restrictTo('admin'));

// Get all categories (admin)
router.get('/admin/categories', menuController.getCategories);

// Get all menu items (admin) with filtering and pagination
router.get('/admin', menuController.getMenuItems);

// Create new menu item
router.post(
  '/admin',
  menuValidator.validate(menuValidator.createMenuItemSchema),
  menuController.createMenuItem
);

// Get single menu item details (admin)
router.get('/admin/:id', menuController.getMenuItem);

// Update menu item
router.put(
  '/admin/:id',
  menuValidator.validate(menuValidator.updateMenuItemSchema),
  menuController.updateMenuItem
);

// Update menu item availability
router.patch('/admin/:id/availability', menuController.updateAvailability);

// Restore deleted menu item
router.patch('/admin/:id/restore', menuController.restoreMenuItem);

// Permanently delete menu item
router.delete('/admin/:id/permanent', menuController.permanentlyDeleteMenuItem);

// Delete menu item
router.delete('/admin/:id', menuController.deleteMenuItem);

module.exports = router;
