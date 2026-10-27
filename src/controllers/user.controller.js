const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const APIFeatures = require('../utils/APIFeatures');
const logger = require('../utils/logger');
const { rejectPrivilegePayload } = require('../utils/privilege-guard');
const { changeUserRoleWithAudit } = require('../utils/privilege-guard');

/**
 * Get all users
 * GET /api/v1/users
 * Admin only
 */
exports.getAllUsers = catchAsync(async (req, res, next) => {

  
  // Don't use limitFields for users - we need all user data except sensitive fields
  // Filter to only return active users
  const features = new APIFeatures(User.find({ isActive: { $ne: false } }).select('-password -passwordResetToken -passwordResetExpires'), req.query)
    .filter()
    .search() // Add search functionality
    .sort()
    .paginate();

  const result = await features.execute(User);



  res.status(200).json({
    status: 'success',
    results: result.data.length,
    pagination: result.pagination,
    data: {
      users: result.data,
    },
  });
});

/**
 * Get user by ID
 * GET /api/v1/users/:id
 * Admin only
 */
exports.getUserById = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user,
    },
  });
});

/**
 * Update user
 * PATCH /api/v1/users/:id
 * Admin only
 */
exports.updateUser = catchAsync(async (req, res, next) => {
  await rejectPrivilegePayload({
    req,
    actorId: req.user._id,
    actorRole: req.user.role,
    targetId: req.params?.id || null,
    reason: 'admin user update attempted privilege mutation',
    payload: req.body,
  });

  // Prevent password update through this route
  delete req.body.password;
  delete req.body.passwordChangedAt;
  delete req.body.passwordResetToken;
  delete req.body.passwordResetExpires;

  const filteredBody = {};
  Object.keys(req.body || {}).forEach(key => {
    // Map nested email/phone if provided
    if (key === 'email') {
      filteredBody['email.address'] = req.body[key];
    } else if (key === 'phone') {
      filteredBody['phone.number'] = req.body[key];
    } else {
      filteredBody[key] = req.body[key];
    }
  });

  const user = await User.findByIdAndUpdate(req.params.id, filteredBody, {
    returnDocument: 'after',
    runValidators: true,
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  logger.info(`User updated: ${user.email.address} by ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'User updated successfully',
    data: {
      user,
    },
  });
});

/**
 * Delete user (soft delete)
 * DELETE /api/v1/users/:id
 * Admin only
 */
exports.deleteUser = catchAsync(async (req, res, next) => {
  const existingUser = await User.findById(req.params.id);

  if (!existingUser) {
    return next(new AppError('User not found', 404));
  }

  // Anonymize and release unique phone/email credentials so that the customer
  // can re-register with their phone number or email if needed.
  const timestamp = Date.now();
  const updatePayload = {
    isActive: false,
    deletedAt: new Date(),
  };

  if (existingUser.phone?.number && !existingUser.phone.number.startsWith('deleted_')) {
    updatePayload['phone.number'] = 'deleted_' + timestamp + '_' + existingUser.phone.number;
  }

  if (existingUser.email?.address && !existingUser.email.address.startsWith('deleted_')) {
    updatePayload['email.address'] = 'deleted_' + timestamp + '_' + existingUser.email.address;
  }

  await User.findByIdAndUpdate(
    req.params.id,
    updatePayload,
    { returnDocument: 'after' }
  );

  logger.info('User deactivated and credentials released: ' + (existingUser.email?.address || '') + ' by ' + (req.user?.email?.address || 'admin'));

  res.status(200).json({
    status: 'success',
    message: 'User deleted and credentials released successfully',
  });
});

/**
 * Permanently delete user
 * DELETE /api/v1/users/:id/permanent
 * Admin only
 */
exports.permanentlyDeleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  logger.warn(`User permanently deleted: ${user.email.address} by ${req.user.email.address}`);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

/**
 * Restore user
 * PATCH /api/v1/users/:id/restore
 * Admin only
 */
exports.restoreUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: true },
    { returnDocument: 'after' }
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  logger.info(`User restored: ${user.email.address} by ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'User restored successfully',
    data: {
      user,
    },
  });
});

/**
 * Block/Unblock user
 * PATCH /api/v1/users/:id/block
 * Admin only
 */
exports.toggleBlockUser = catchAsync(async (req, res, next) => {
  const { isBlocked, blockReason } = req.body;

  if (typeof isBlocked !== 'boolean') {
    return next(new AppError('isBlocked must be a boolean value', 400));
  }

  const existingUser = await User.findById(req.params.id);

  if (!existingUser) {
    return next(new AppError('User not found', 404));
  }

  if (existingUser.role === 'admin') {
    return next(new AppError('Admin users cannot be blocked from this endpoint', 400));
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    {
      isBlocked,
      blockReason: isBlocked ? (blockReason || 'Blocked by admin') : '',
    },
    { returnDocument: 'after' }
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  logger.info(
    `User ${isBlocked ? 'blocked' : 'unblocked'}: ${user.email.address} by ${req.user.email.address}`
  );

  res.status(200).json({
    status: 'success',
    message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully`,
    data: {
      user,
    },
  });
});

/**
 * Get users by role
 * GET /api/v1/users/role/:role
 * Admin only
 */
exports.getUsersByRole = catchAsync(async (req, res, next) => {
  const { role } = req.params;

  if (!['customer', 'delivery', 'admin'].includes(role)) {
    return next(new AppError('Invalid role', 400));
  }

  // Don't use limitFields for users - we need all customer data
  const features = new APIFeatures(User.find({ role, isActive: { $ne: false } }).select('-password -passwordResetToken -passwordResetExpires'), req.query)
    .search()
    .sort()
    .paginate();

  const result = await features.execute(User);

  res.status(200).json({
    status: 'success',
    results: result.data.length,
    pagination: result.pagination,
    data: {
      users: result.data,
    },
  });
});

/**
 * Get user statistics
 * GET /api/v1/users/stats/overview
 * Admin only
 */
exports.getUserStats = catchAsync(async (req, res, next) => {
  const stats = await User.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        activeCount: {
          $sum: { $cond: ['$isActive', 1, 0] },
        },
        blockedCount: {
          $sum: { $cond: ['$isBlocked', 1, 0] },
        },
      },
    },
  ]);

  const customerStats = await User.aggregate([
    {
      $match: { role: 'customer' },
    },
    {
      $group: {
        _id: null,
        totalCustomers: { $sum: 1 },
        totalOrders: { $sum: '$customerData.totalOrders' },
        totalSpent: { $sum: '$customerData.totalSpent' },
        avgOrdersPerCustomer: { $avg: '$customerData.totalOrders' },
        avgSpentPerCustomer: { $avg: '$customerData.totalSpent' },
      },
    },
  ]);

  const deliveryStats = await User.aggregate([
    {
      $match: { role: 'delivery' },
    },
    {
      $group: {
        _id: null,
        totalDeliveryPartners: { $sum: 1 },
        availablePartners: {
          $sum: { $cond: ['$deliveryData.availability', 1, 0] },
        },
        totalDeliveries: { $sum: '$deliveryData.totalDeliveries' },
        totalEarnings: { $sum: '$deliveryData.totalEarnings' },
        avgRating: { $avg: '$deliveryData.rating' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      roleStats: stats,
      customerStats: customerStats[0] || {},
      deliveryStats: deliveryStats[0] || {},
    },
  });
});

/**
 * Create new user (admin)
 * POST /api/v1/users
 * Admin only
 */
exports.createUser = catchAsync(async (req, res, next) => {
  await rejectPrivilegePayload({
    req,
    actorId: req.user._id,
    actorRole: req.user.role,
    reason: 'admin create user attempted privilege-bearing payload',
    payload: req.body,
  });

  // Allow admin to create users but only as least-privilege accounts.
  const allowedFields = ['name', 'email', 'phone', 'password', 'addresses', 'customerData', 'deliveryData', 'preferences', 'avatar', 'dateOfBirth'];
  const createBody = {};
  Object.keys(req.body || {}).forEach(key => {
    if (allowedFields.includes(key)) {
      if (key === 'email') {
        createBody['email.address'] = req.body[key];
      } else if (key === 'phone') {
        createBody['phone.number'] = req.body[key];
      } else {
        createBody[key] = req.body[key];
      }
    }
  });

  const user = await User.create(createBody);

  logger.info(`User created: ${user.email.address} (${user.role}) by ${req.user.email.address}`);

  res.status(201).json({
    status: 'success',
    message: 'User created successfully',
    data: {
      user,
    },
  });
});

/**
 * Update user role
 * PATCH /api/v1/users/:id/role
 * Admin only
 */
exports.updateUserRole = catchAsync(async (req, res, next) => {
  const { role } = req.body;

  if (!['customer', 'delivery', 'admin'].includes(role)) {
    return next(new AppError('Invalid role', 400));
  }

  const targetUser = await User.findById(req.params.id);

  if (!targetUser) {
    return next(new AppError('User not found', 404));
  }

  const user = await changeUserRoleWithAudit({
    req,
    actor: req.user,
    targetUser,
    newRole: role,
    reason: 'canonical admin role change endpoint',
  });

  logger.info(
    `User role updated: ${user.email.address} to ${role} by ${req.user.email.address}`
  );

  res.status(200).json({
    status: 'success',
    message: 'User role updated successfully',
    data: {
      user,
    },
  });
});

/**
 * Get user's frequently ordered items
 * GET /api/v1/users/me/frequently-ordered
 * Customer only (authenticated)
 */
exports.getFrequentlyOrderedItems = catchAsync(async (req, res, next) => {
  const Order = require('../models/Order');
  const MenuItem = require('../models/MenuItem');
  const limit = parseInt(req.query.limit) || 10;

  // Aggregate user's orders to find most frequently ordered items
  const frequentItems = await Order.aggregate([
    // Match orders for this user that are delivered
    { 
      $match: { 
        customerId: req.user._id,
        status: { $in: ['DELIVERED', 'COMPLETED'] }
      } 
    },
    // Unwind the items array to process each item separately
    { $unwind: '$items' },
    // Group by menu item and count occurrences
    {
      $group: {
        _id: '$items.menuItemId',
        orderCount: { $sum: '$items.quantity' },
        lastOrdered: { $max: '$createdAt' }
      }
    },
    // Sort by order count (descending) and then by last ordered date
    { $sort: { orderCount: -1, lastOrdered: -1 } },
    // Limit to top items
    { $limit: limit }
  ]);

  // Get the actual menu item details
  const menuItemIds = frequentItems.map(item => item._id);
  const menuItems = await MenuItem.find({ 
    _id: { $in: menuItemIds },
    isAvailable: true,
    isActive: true
  });

  // Create a map for quick lookup
  const menuItemMap = new Map(menuItems.map(item => [item._id.toString(), item]));

  // Combine the data
  const result = frequentItems
    .map(item => {
      const menuItem = menuItemMap.get(item._id.toString());
      if (!menuItem) return null;
      
      return {
        ...menuItem.toObject(),
        orderCount: item.orderCount,
        lastOrdered: item.lastOrdered
      };
    })
    .filter(item => item !== null);

  res.status(200).json({
    status: 'success',
    results: result.length,
    data: {
      items: result
    }
  });
});

/**
 * Get user's favorite items
 * GET /api/v1/auth/me/favorites
 * Customer only (authenticated)
 */
exports.getFavoriteItems = catchAsync(async (req, res, next) => {
  const MenuItem = require('../models/MenuItem');
  
  // Populate favorite items
  const user = await User.findById(req.user._id).populate({
    path: 'customerData.favoriteItems',
    match: { isAvailable: true, isActive: true }
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const favorites = user.customerData?.favoriteItems || [];

  res.status(200).json({
    status: 'success',
    results: favorites.length,
    data: {
      items: favorites
    }
  });
});

/**
 * Add item to favorites
 * POST /api/v1/auth/me/favorites/:menuItemId
 * Customer only (authenticated)
 */
exports.addFavoriteItem = catchAsync(async (req, res, next) => {
  const MenuItem = require('../models/MenuItem');
  const { menuItemId } = req.params;

  // Check if menu item exists
  const menuItem = await MenuItem.findById(menuItemId);
  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  // Check if already in favorites
  const user = await User.findById(req.user._id);
  const favorites = user.customerData?.favoriteItems || [];
  
  if (favorites.some(id => id.toString() === menuItemId)) {
    return next(new AppError('Item already in favorites', 400));
  }

  // Add to favorites
  user.customerData = user.customerData || {};
  user.customerData.favoriteItems = user.customerData.favoriteItems || [];
  user.customerData.favoriteItems.push(menuItemId);
  await user.save();

  logger.info(`User ${user.email.address} added ${menuItem.name} to favorites`);

  res.status(200).json({
    status: 'success',
    message: 'Item added to favorites',
    data: {
      menuItem
    }
  });
});

/**
 * Remove item from favorites
 * DELETE /api/v1/auth/me/favorites/:menuItemId
 * Customer only (authenticated)
 */
exports.removeFavoriteItem = catchAsync(async (req, res, next) => {
  const { menuItemId } = req.params;

  const user = await User.findById(req.user._id);
  const favorites = user.customerData?.favoriteItems || [];
  
  if (!favorites.some(id => id.toString() === menuItemId)) {
    return next(new AppError('Item not in favorites', 404));
  }

  // Remove from favorites
  user.customerData.favoriteItems = favorites.filter(
    id => id.toString() !== menuItemId
  );
  await user.save();

  logger.info(`User ${user.email.address} removed item from favorites`);

  res.status(200).json({
    status: 'success',
    message: 'Item removed from favorites'
  });
});
