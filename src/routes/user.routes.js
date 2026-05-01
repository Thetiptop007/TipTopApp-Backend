const express = require('express');
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * All user routes require authentication and admin role
 */
router.use(authMiddleware.protect('admin'));
router.use(authMiddleware.restrictTo('admin'));

// Add logging middleware for all user routes
router.use((req, res, next) => {
  logger.debug('[User Routes] Request received:', {
    method: req.method,
    path: req.path,
    query: req.query
  });
  next();
});

// Get user statistics
router.get('/stats/overview', userController.getUserStats);

// Get users by role
router.get('/role/:role', userController.getUsersByRole);

// Create new user
router.post('/', userController.createUser);

// Get all users
router.get('/', userController.getAllUsers);

// Get user by ID
router.get('/:id', userController.getUserById);

// Update user
router.patch('/:id', userController.updateUser);

// Update user role
router.patch('/:id/role', userController.updateUserRole);

// Block/Unblock user
router.patch('/:id/block', userController.toggleBlockUser);

// Restore user
router.patch('/:id/restore', userController.restoreUser);

// Soft delete user
router.delete('/:id', userController.deleteUser);

// Permanently delete user
router.delete('/:id/permanent', userController.permanentlyDeleteUser);

module.exports = router;
