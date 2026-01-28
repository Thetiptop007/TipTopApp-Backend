const MenuItem = require('../models/MenuItem');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const APIFeatures = require('../utils/APIFeatures');
const logger = require('../utils/logger');
const { invalidateCache } = require('../middlewares/cache');

/**
 * Get all menu items with filtering, sorting, and pagination
 * GET /api/v1/menu
 * Public access
 */
exports.getAllMenuItems = catchAsync(async (req, res, next) => {
  console.log('🔍 Menu API called with query:', req.query);
  
  // First, get all matching items without pagination
  const allFeatures = new APIFeatures(MenuItem.find(), req.query)
    .filter()
    .search()
    .sort()
    .limitFields();

  // Log the actual MongoDB query
  console.log('🔎 MongoDB Query:', JSON.stringify(allFeatures.query.getQuery()));
  console.log('🔎 MongoDB Options:', allFeatures.query.getOptions());

  // Execute to get all matching items
  const allItems = await allFeatures.query;
  const totalResults = allItems.length;
  
  console.log(`📊 Menu items found: ${totalResults} items`);
  if (totalResults > 0) {
    console.log('📝 First item sample:', {
      name: allItems[0].name,
      isActive: allItems[0].isActive,
      isAvailable: allItems[0].isAvailable,
      categories: allItems[0].categories
    });
  } else {
    // Check total count in database
    const totalCount = await MenuItem.countDocuments();
    console.log(`⚠️ Total items in database: ${totalCount}`);
    if (totalCount > 0) {
      const sampleItem = await MenuItem.findOne();
      console.log('📝 Sample item from DB:', {
        name: sampleItem?.name,
        isActive: sampleItem?.isActive,
        isAvailable: sampleItem?.isAvailable,
        categories: sampleItem?.categories
      });
    }
  }

  // Now apply manual pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 100;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  const paginatedItems = allItems.slice(startIndex, endIndex);
  
  console.log(`✅ Returning ${paginatedItems.length} paginated items (page ${page}, limit ${limit})`);

  res.status(200).json({
    status: 'success',
    results: paginatedItems.length,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalResults / limit),
      totalResults: totalResults,
      limit: limit
    },
    data: {
      menuItems: paginatedItems,
    },
  });
});

/**
 * Get menu item by ID
 * GET /api/v1/menu/:id
 * Public access
 */
exports.getMenuItem = catchAsync(async (req, res, next) => {
  const menuItem = await MenuItem.findById(req.params.id);

  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      menuItem,
    },
  });
});

/**
 * Get menu item by slug
 * GET /api/v1/menu/slug/:slug
 * Public access
 */
exports.getMenuItemBySlug = catchAsync(async (req, res, next) => {
  const menuItem = await MenuItem.findOne({ slug: req.params.slug });

  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      menuItem,
    },
  });
});

/**
 * Get popular menu items
 * GET /api/v1/menu/popular/items
 * Public access
 */
exports.getPopularItems = catchAsync(async (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  const menuItems = await MenuItem.findPopular(limit);

  res.status(200).json({
    status: 'success',
    results: menuItems.length,
    data: {
      menuItems,
    },
  });
});

/**
 * Get menu items by category
 * GET /api/v1/menu/category/:category
 * Public access
 */
exports.getMenuItemsByCategory = catchAsync(async (req, res, next) => {
  const { category } = req.params;
  const limit = parseInt(req.query.limit, 10) || 20;

  const menuItems = await MenuItem.findByCategory(category, limit);

  res.status(200).json({
    status: 'success',
    results: menuItems.length,
    data: {
      menuItems,
    },
  });
});

/**
 * Get all categories
 * GET /api/v1/menu/categories/all
 * Public access
 */
exports.getAllCategories = catchAsync(async (req, res, next) => {
  // Get all unique categories from the categories array field
  const categories = await MenuItem.distinct('categories');
  
  // Filter out null, undefined, empty strings, and 'All', then sort alphabetically
  const filteredCategories = categories
    .filter(cat => cat && cat.trim() !== '' && cat !== 'All')
    .sort();

  logger.info(`Fetched ${filteredCategories.length} categories: ${filteredCategories.join(', ')}`);

  res.status(200).json({
    status: 'success',
    results: filteredCategories.length,
    data: {
      categories: filteredCategories,
    },
  });
});

/**
 * Create new menu item
 * POST /api/v1/menu
 * Admin only
 */
exports.createMenuItem = catchAsync(async (req, res, next) => {
  const menuItem = await MenuItem.create(req.body);

  logger.info(`Menu item created: ${menuItem.name} by ${req.user.email.address}`);

  // Invalidate menu cache
  await invalidateCache('menu:*');

  res.status(201).json({
    status: 'success',
    message: 'Menu item created successfully',
    data: {
      menuItem,
    },
  });
});

/**
 * Update menu item
 * PATCH /api/v1/menu/:id
 * Admin only
 */
exports.updateMenuItem = catchAsync(async (req, res, next) => {
  // Prevent updating stats directly
  delete req.body.stats;
  delete req.body.slug;

  const menuItem = await MenuItem.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  logger.info(`Menu item updated: ${menuItem.name} by ${req.user.email.address}`);

  // Invalidate menu cache
  await invalidateCache('menu:*');

  res.status(200).json({
    status: 'success',
    message: 'Menu item updated successfully',
    data: {
      menuItem,
    },
  });
});

/**
 * Delete menu item (permanent delete)
 * DELETE /api/v1/menu/:id
 * Admin only
 */
exports.deleteMenuItem = catchAsync(async (req, res, next) => {
  const menuItem = await MenuItem.findByIdAndDelete(req.params.id);

  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  logger.info(`Menu item deleted: ${menuItem.name} by ${req.user.email.address}`);

  // Invalidate menu cache
  await invalidateCache('menu:*');

  res.status(200).json({
    status: 'success',
    message: 'Menu item deleted successfully',
  });
});

/**
 * Permanently delete menu item
 * DELETE /api/v1/menu/:id/permanent
 * Admin only
 */
exports.permanentlyDeleteMenuItem = catchAsync(async (req, res, next) => {
  const menuItem = await MenuItem.findByIdAndDelete(req.params.id);

  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  logger.warn(`Menu item permanently deleted: ${menuItem.name} by ${req.user.email.address}`);

  // Invalidate menu cache
  await invalidateCache('menu:*');

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

/**
 * Restore deleted menu item
 * PATCH /api/v1/menu/:id/restore
 * Admin only
 */
exports.restoreMenuItem = catchAsync(async (req, res, next) => {
  const menuItem = await MenuItem.findByIdAndUpdate(
    req.params.id,
    { isAvailable: true },
    { new: true }
  );

  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  logger.info(`Menu item restored: ${menuItem.name} by ${req.user.email.address}`);

  res.status(200).json({
    status: 'success',
    message: 'Menu item restored successfully',
    data: {
      menuItem,
    },
  });
});

/**
 * Update menu item availability
 * PATCH /api/v1/menu/:id/availability
 * Admin only
 */
exports.updateAvailability = catchAsync(async (req, res, next) => {
  const { isAvailable } = req.body;

  if (typeof isAvailable !== 'boolean') {
    return next(new AppError('Please provide isAvailable as boolean', 400));
  }

  const menuItem = await MenuItem.findByIdAndUpdate(
    req.params.id,
    { isAvailable },
    { new: true }
  );

  if (!menuItem) {
    return next(new AppError('Menu item not found', 404));
  }

  logger.info(
    `Menu item availability updated: ${menuItem.name} - ${isAvailable} by ${req.user.email.address}`
  );

  res.status(200).json({
    status: 'success',
    message: 'Availability updated successfully',
    data: {
      menuItem,
    },
  });
});

/**
 * Get menu statistics
 * GET /api/v1/menu/stats/overview
 * Admin only
 */
exports.getMenuStats = catchAsync(async (req, res, next) => {
  const stats = await MenuItem.aggregate([
    {
      $group: {
        _id: '$category.main',
        count: { $sum: 1 },
        avgPrice: { $avg: '$price' },
        avgRating: { $avg: '$rating' },
        totalOrders: { $sum: '$stats.totalOrders' },
        totalRevenue: { $sum: '$stats.totalRevenue' },
      },
    },
    {
      $sort: { totalRevenue: -1 },
    },
  ]);

  const overview = await MenuItem.aggregate([
    {
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        availableItems: {
          $sum: { $cond: ['$isAvailable', 1, 0] },
        },
        vegetarianItems: {
          $sum: { $cond: ['$isVegetarian', 1, 0] },
        },
        avgPrice: { $avg: '$price' },
        totalOrders: { $sum: '$stats.totalOrders' },
        totalRevenue: { $sum: '$stats.totalRevenue' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      overview: overview[0] || {},
      categoryStats: stats,
    },
  });
});
