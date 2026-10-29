const express = require('express');
const userController = require('../controllers/user.controller');
const userValidator = require('../validators/user.validator');
const authMiddleware = require('../middlewares/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * All user routes require authentication and admin role
 */
router.use(authMiddleware.protect('admin'));
router.use(authMiddleware.restrictTo('admin'));



// Get user statistics
router.get('/stats/overview', userController.getUserStats);

// Get users by role
router.get('/role/:role', userController.getUsersByRole);

// Bulk Block/Unblock users (placed before /:id routes to avoid route collision)
router.patch(
  '/bulk/block',
  userValidator.validate(userValidator.bulkBlockUsersSchema),
  userController.bulkToggleBlockUsers
);

// Bulk Delete users (placed before /:id routes to avoid route collision)
router.post(
  '/bulk/delete',
  userValidator.validate(userValidator.bulkDeleteUsersSchema),
  userController.bulkDeleteUsers
);

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
