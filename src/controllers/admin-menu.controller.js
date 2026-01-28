const MenuItem = require('../models/MenuItem');
const Category = require('../models/category.model');
const catchAsync = require('../utils/catchAsync');
const APIFeatures = require('../utils/APIFeatures');

/**
 * @desc    Get all menu items with filtering, search, and pagination (Admin)
 * @route   GET /api/v1/admin/menu-items
 * @access  Private/Admin
 * @query   ?page=1&limit=12&category=burger&search=cheese
 */
exports.getMenuItems = catchAsync(async (req, res, next) => {
  // Use APIFeatures for advanced search with relevance sorting
  const features = new APIFeatures(MenuItem.find(), req.query)
    .filter()
    .search()
    .sort()
    .limitFields()
    .paginate();

  // Execute query with pagination metadata
  const result = await features.execute(MenuItem);

  // Transform items to frontend format
  const transformedItems = result.data.map(item => {
    const itemObj = item.toObject ? item.toObject() : item;
    
    // Get the first price variant or lowest price
    const lowestPrice = itemObj.priceVariants && itemObj.priceVariants.length > 0
      ? Math.min(...itemObj.priceVariants.map(v => v.price))
      : 0;

    return {
      id: itemObj._id.toString(),
      name: itemObj.name,
      description: itemObj.description || '',
      image: itemObj.image || '',
      category: itemObj.categories && itemObj.categories.length > 0 ? itemObj.categories[0] : 'Other',
      categories: itemObj.categories || [],
      price: lowestPrice,
      priceVariants: itemObj.priceVariants || [],
      rating: itemObj.rating || 0,
      reviews: itemObj.reviews || 0,
      availability: itemObj.isAvailable && itemObj.isActive ? 'Available' : 'Out of Stock',
      isAvailable: itemObj.isAvailable || false,
      isActive: itemObj.isActive || false,
      totalOrders: itemObj.stats?.totalOrders || 0,
      totalRevenue: itemObj.stats?.totalRevenue || 0
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      items: transformedItems,
      pagination: result.pagination
    }
  });
});

/**
 * @desc    Get all unique categories from menu items
 * @route   GET /api/v1/admin/menu-items/categories
 * @access  Private/Admin
 */
exports.getCategories = catchAsync(async (req, res, next) => {
  // Get all active categories from Category collection
  const categories = await Category.find({ isActive: true })
    .select('name')
    .sort('name')
    .lean();

  // Extract category names
  const categoryNames = categories.map(cat => cat.name);

  res.status(200).json({
    status: 'success',
    data: {
      categories: categoryNames,
      count: categoryNames.length
    }
  });
});

/**
 * @desc    Get single menu item details
 * @route   GET /api/v1/admin/menu-items/:id
 * @access  Private/Admin
 */
exports.getMenuItem = catchAsync(async (req, res, next) => {
  const item = await MenuItem.findById(req.params.id).lean();

  if (!item) {
    return res.status(404).json({
      status: 'error',
      message: 'Menu item not found'
    });
  }

  // Get the lowest price
  const lowestPrice = item.priceVariants && item.priceVariants.length > 0
    ? Math.min(...item.priceVariants.map(v => v.price))
    : 0;

  const transformedItem = {
    id: item._id.toString(),
    name: item.name,
    description: item.description || '',
    image: item.image || '',
    category: item.categories && item.categories.length > 0 ? item.categories[0] : 'Other',
    categories: item.categories || [],
    price: lowestPrice,
    priceVariants: item.priceVariants || [],
    rating: item.rating || 0,
    reviews: item.reviews || 0,
    availability: item.isAvailable && item.isActive ? 'Available' : 'Out of Stock',
    isAvailable: item.isAvailable || false,
    isActive: item.isActive || false,
    totalOrders: item.stats?.totalOrders || 0,
    totalRevenue: item.stats?.totalRevenue || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };

  res.status(200).json({
    status: 'success',
    data: transformedItem
  });
});

/**
 * @desc    Update menu item availability
 * @route   PATCH /api/v1/admin/menu-items/:id/availability
 * @access  Private/Admin
 */
exports.updateAvailability = catchAsync(async (req, res, next) => {
  const { isAvailable } = req.body;

  const item = await MenuItem.findByIdAndUpdate(
    req.params.id,
    { isAvailable },
    { new: true, runValidators: true }
  );

  if (!item) {
    return res.status(404).json({
      status: 'error',
      message: 'Menu item not found'
    });
  }

  res.status(200).json({
    status: 'success',
    message: `Item ${isAvailable ? 'marked as available' : 'marked as out of stock'}`,
    data: {
      id: item._id.toString(),
      isAvailable: item.isAvailable
    }
  });
});

/**
 * @desc    Delete menu item
 * @route   DELETE /api/v1/admin/menu-items/:id
 * @access  Private/Admin
 */
exports.deleteMenuItem = catchAsync(async (req, res, next) => {
  const item = await MenuItem.findByIdAndDelete(req.params.id);

  if (!item) {
    return res.status(404).json({
      status: 'error',
      message: 'Menu item not found'
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'Menu item deleted successfully'
  });
});

/**
 * @desc    Create new menu item
 * @route   POST /api/v1/admin/menu-items
 * @access  Private/Admin
 */
exports.createMenuItem = catchAsync(async (req, res, next) => {
  const {
    name,
    description,
    image,
    priceVariants,
    category, // Changed from categories to category (single value)
    preparationTime,
    isVegetarian,
    isSpicy,
    isAvailable
  } = req.body;

  // Validate required fields
  if (!name || !priceVariants || priceVariants.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Name and at least one price variant are required'
    });
  }

  // Validate category
  if (!category || category === 'All') {
    return res.status(400).json({
      status: 'error',
      message: 'A valid category is required (cannot be "All")'
    });
  }

  // Create menu item - store category as single-element array
  const menuItem = await MenuItem.create({
    name,
    description: description || '',
    image: image || '/images/product/placeholder.jpg',
    priceVariants,
    categories: [category], // Store as array with single element
    preparationTime: preparationTime || 15,
    isVegetarian: isVegetarian || false,
    isSpicy: isSpicy || false,
    isAvailable: isAvailable !== undefined ? isAvailable : true,
    isActive: true,
    rating: 4.0,
    reviews: 0
  });

  res.status(201).json({
    status: 'success',
    message: 'Menu item created successfully',
    data: {
      item: {
        id: menuItem._id.toString(),
        name: menuItem.name,
        description: menuItem.description,
        image: menuItem.image,
        priceVariants: menuItem.priceVariants,
        categories: menuItem.categories,
        preparationTime: menuItem.preparationTime,
        isVegetarian: menuItem.isVegetarian,
        isSpicy: menuItem.isSpicy,
        isAvailable: menuItem.isAvailable,
        isActive: menuItem.isActive,
        rating: menuItem.rating,
        reviews: menuItem.reviews
      }
    }
  });
});

/**
 * @desc    Update menu item
 * @route   PUT /api/v1/admin/menu-items/:id
 * @access  Private/Admin
 */
exports.updateMenuItem = catchAsync(async (req, res, next) => {
  const {
    name,
    description,
    image,
    priceVariants,
    category, // Changed from categories to category (single value)
    preparationTime,
    isVegetarian,
    isSpicy,
    isAvailable,
    isActive
  } = req.body;

  // Find menu item
  const menuItem = await MenuItem.findById(req.params.id);

  if (!menuItem) {
    return res.status(404).json({
      status: 'error',
      message: 'Menu item not found'
    });
  }

  // Validate required fields if provided
  if (priceVariants && priceVariants.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'At least one price variant is required'
    });
  }

  // Validate category if provided
  if (category && category === 'All') {
    return res.status(400).json({
      status: 'error',
      message: 'Category cannot be "All"'
    });
  }

  // Update fields
  if (name !== undefined) menuItem.name = name;
  if (description !== undefined) menuItem.description = description;
  if (image !== undefined) menuItem.image = image;
  if (priceVariants !== undefined) menuItem.priceVariants = priceVariants;
  if (category !== undefined) menuItem.categories = [category]; // Store as single-element array
  if (preparationTime !== undefined) menuItem.preparationTime = preparationTime;
  if (isVegetarian !== undefined) menuItem.isVegetarian = isVegetarian;
  if (isSpicy !== undefined) menuItem.isSpicy = isSpicy;
  if (isAvailable !== undefined) menuItem.isAvailable = isAvailable;
  if (isActive !== undefined) menuItem.isActive = isActive;

  await menuItem.save();

  res.status(200).json({
    status: 'success',
    message: 'Menu item updated successfully',
    data: {
      item: {
        id: menuItem._id.toString(),
        name: menuItem.name,
        description: menuItem.description,
        image: menuItem.image,
        priceVariants: menuItem.priceVariants,
        categories: menuItem.categories,
        preparationTime: menuItem.preparationTime,
        isVegetarian: menuItem.isVegetarian,
        isSpicy: menuItem.isSpicy,
        isAvailable: menuItem.isAvailable,
        isActive: menuItem.isActive,
        rating: menuItem.rating,
        reviews: menuItem.reviews
      }
    }
  });
});
