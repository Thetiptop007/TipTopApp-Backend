const Category = require('../models/category.model');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const APIFeatures = require('../utils/APIFeatures');
const logger = require('../utils/logger');

/**
 * Get all categories with pagination and filtering
 * GET /api/v1/categories
 */
exports.getAllCategories = catchAsync(async (req, res, next) => {
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 10;
  const search = req.query.search || '';

  // Get all categories with counts first
  const categoriesWithCounts = await Category.getAllWithCounts();
  
  // Apply search filter if provided
  let filteredCategories = categoriesWithCounts;
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    filteredCategories = categoriesWithCounts.filter(cat => 
      searchRegex.test(cat.name) || searchRegex.test(cat.description || '')
    );
  }

  const total = filteredCategories.length;
  const pages = Math.ceil(total / limit);
  
  // Apply pagination manually
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedCategories = filteredCategories.slice(startIndex, endIndex);

  res.status(200).json({
    status: 'success',
    results: paginatedCategories.length,
    pagination: {
      page,
      limit,
      total,
      pages,
    },
    data: {
      categories: paginatedCategories,
    },
  });
});

/**
 * Get category by ID
 * GET /api/v1/categories/:id
 */
exports.getCategoryById = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  const MenuItem = require('../models/MenuItem');
  const itemCount = await MenuItem.countDocuments({ categories: category.name });

  res.status(200).json({
    status: 'success',
    data: {
      category: {
        ...category.toObject(),
        itemCount,
      },
    },
  });
});

/**
 * Create new category
 * POST /api/v1/categories
 * Admin only
 */
exports.createCategory = catchAsync(async (req, res, next) => {
  const { name, description, isActive, color } = req.body;

  // Check if category already exists
  const existingCategory = await Category.findOne({ 
    name: { $regex: new RegExp(`^${name}$`, 'i') } 
  });

  if (existingCategory) {
    return next(new AppError('Category with this name already exists', 400));
  }

  const category = await Category.create({
    name,
    description,
    isActive,
    color: color || ['green', 'blue', 'purple', 'orange', 'pink', 'yellow', 'red'][Math.floor(Math.random() * 7)],
  });

  res.status(201).json({
    status: 'success',
    data: {
      category,
    },
  });
});

/**
 * Update category
 * PATCH /api/v1/categories/:id
 * Admin only
 */
exports.updateCategory = catchAsync(async (req, res, next) => {
  const { name, description, isActive, color } = req.body;

  // [DEBUG] Log incoming update request
  console.log('[DEBUG updateCategory] Searching for ID:', req.params.id);
  const allIds = await Category.find({}, '_id name').lean();
  console.log('[DEBUG updateCategory] All categories in DB:', allIds.map(c => `${c._id} (${c.name})`));

  // If name is being updated, check for duplicates
  if (name) {
    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      _id: { $ne: req.params.id },
    });

    if (existingCategory) {
      return next(new AppError('Category with this name already exists', 400));
    }
  }

  // Fixed: use `new: true` (Mongoose option) instead of `returnDocument: 'after'` (MongoDB driver option)
  const category = await Category.findByIdAndUpdate(
    req.params.id,
    { name, description, isActive, color },
    { new: true, runValidators: true }
  );

  console.log('[DEBUG updateCategory] findByIdAndUpdate result:', category ? category._id : 'null (not found)');

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      category,
    },
  });
});

/**
 * Delete category
 * DELETE /api/v1/categories/:id
 * Admin only
 */
exports.deleteCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  // Check if category has items
  const MenuItem = require('../models/MenuItem');
  const itemCount = await MenuItem.countDocuments({ categories: category.name });

  if (itemCount > 0) {
    logger.business('CATEGORY_DELETE_BLOCKED', 'Category delete blocked because menu items are associated', { categoryId: category._id.toString(), categoryName: category.name, itemCount }, { level: 'warn', severity: 'medium' });
    
    return next(
      new AppError(
        `Cannot delete category "${category.name}" with ${itemCount} menu items. Please reassign or delete the items first.`,
        400
      )
    );
  }
  
  logger.business('CATEGORY_DELETED', 'Category deleted', { categoryId: category._id.toString(), categoryName: category.name, itemCount }, { level: 'info' });

  await category.deleteOne();

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

/**
 * Toggle category status
 * PATCH /api/v1/categories/:id/toggle-status
 * Admin only
 */
exports.toggleCategoryStatus = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  category.isActive = !category.isActive;
  await category.save();

  res.status(200).json({
    status: 'success',
    data: {
      category,
    },
  });
});

/**
 * Get category statistics
 * GET /api/v1/categories/stats
 */
exports.getCategoryStats = catchAsync(async (req, res, next) => {
  const total = await Category.countDocuments();
  const active = await Category.countDocuments({ isActive: true });
  const inactive = await Category.countDocuments({ isActive: false });

  const categoriesWithCounts = await Category.getAllWithCounts();
  const totalItems = categoriesWithCounts.reduce((sum, cat) => sum + cat.itemCount, 0);

  res.status(200).json({
    status: 'success',
    data: {
      stats: {
        total,
        active,
        inactive,
        totalItems,
      },
    },
  });
});
