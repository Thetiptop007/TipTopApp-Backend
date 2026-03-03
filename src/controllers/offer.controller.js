/**
 * =====================================================
 * OFFER CONTROLLER
 * Controller for promotional offers management
 * =====================================================
 */

const Offer = require('../models/Offer');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/category.model');
const APIFeatures = require('../utils/APIFeatures');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

/* =====================================================
   ADMIN OFFER CONTROLLERS
===================================================== */

/**
 * Get all offers (with filters)
 * GET /api/admin/offers?status=active&sort=-createdAt
 */
exports.getAllOffers = catchAsync(async (req, res, next) => {
  const features = new APIFeatures(Offer.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const result = await features.execute(Offer);

  // Populate references
  const populatedOffers = await Offer.populate(result.data, [
    { path: 'createdBy', select: 'firstName lastName email' },
    { path: 'applicableItems', select: 'name image' },
    { path: 'applicableCategories', select: 'name' },
  ]);

  res.status(200).json({
    success: true,
    results: result.pagination.currentResults,
    pagination: result.pagination,
    data: populatedOffers,
  });
});

/**
 * Get single offer by ID
 * GET /api/admin/offers/:id
 */
exports.getOffer = catchAsync(async (req, res, next) => {
  const offer = await Offer.findById(req.params.id)
    .populate('createdBy', 'firstName lastName email')
    .populate('applicableItems', 'name image priceVariants')
    .populate('applicableCategories', 'name');

  if (!offer) {
    return next(new AppError('Offer not found', 404));
  }

  res.status(200).json({
    success: true,
    data: offer,
  });
});

/**
 * Create new offer
 * POST /api/admin/offers
 */
exports.createOffer = catchAsync(async (req, res, next) => {
  // Validate applicable items/categories if specified
  if (req.body.applicableTo === 'items' && req.body.applicableItems) {
    const items = await MenuItem.find({ _id: { $in: req.body.applicableItems } });
    if (items.length !== req.body.applicableItems.length) {
      return next(new AppError('Some menu items not found', 400));
    }
  }

  if (req.body.applicableTo === 'categories' && req.body.applicableCategories) {
    const categories = await Category.find({ _id: { $in: req.body.applicableCategories } });
    if (categories.length !== req.body.applicableCategories.length) {
      return next(new AppError('Some categories not found', 400));
    }
  }

  // Add createdBy from authenticated user
  const offerData = {
    ...req.body,
    createdBy: req.user._id,
  };

  const offer = await Offer.create(offerData);

  // Populate references for response
  await offer.populate([
    { path: 'createdBy', select: 'firstName lastName email' },
    { path: 'applicableItems', select: 'name image' },
    { path: 'applicableCategories', select: 'name' },
  ]);

  logger.info(`Offer created: ${offer.name} by ${req.user.email}`);

  res.status(201).json({
    success: true,
    message: 'Offer created successfully',
    data: offer,
  });
});

/**
 * Update offer
 * PATCH /api/admin/offers/:id
 */
exports.updateOffer = catchAsync(async (req, res, next) => {
  // Don't allow updating createdBy
  delete req.body.createdBy;
  
  // Don't allow updating statistics directly
  delete req.body.totalOrders;
  delete req.body.totalDiscountGiven;
  delete req.body.totalRevenue;

  // Validate applicable items/categories if being updated
  if (req.body.applicableTo === 'items' && req.body.applicableItems) {
    const items = await MenuItem.find({ _id: { $in: req.body.applicableItems } });
    if (items.length !== req.body.applicableItems.length) {
      return next(new AppError('Some menu items not found', 400));
    }
  }

  if (req.body.applicableTo === 'categories' && req.body.applicableCategories) {
    const categories = await Category.find({ _id: { $in: req.body.applicableCategories } });
    if (categories.length !== req.body.applicableCategories.length) {
      return next(new AppError('Some categories not found', 400));
    }
  }

  const offer = await Offer.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true,
    }
  ).populate([
    { path: 'createdBy', select: 'firstName lastName email' },
    { path: 'applicableItems', select: 'name image' },
    { path: 'applicableCategories', select: 'name' },
  ]);

  if (!offer) {
    return next(new AppError('Offer not found', 404));
  }

  logger.info(`Offer updated: ${offer.name} by ${req.user.email}`);

  res.status(200).json({
    success: true,
    message: 'Offer updated successfully',
    data: offer,
  });
});

/**
 * Deactivate offer (soft delete)
 * PATCH /api/admin/offers/:id/deactivate
 */
exports.deactivateOffer = catchAsync(async (req, res, next) => {
  const offer = await Offer.findByIdAndUpdate(
    req.params.id,
    { status: 'deactivated' },
    { new: true }
  );

  if (!offer) {
    return next(new AppError('Offer not found', 404));
  }

  logger.info(`Offer deactivated: ${offer.name} by ${req.user.email}`);

  res.status(200).json({
    success: true,
    message: 'Offer deactivated successfully',
    data: offer,
  });
});

/**
 * Delete offer permanently
 * DELETE /api/admin/offers/:id
 */
exports.deleteOffer = catchAsync(async (req, res, next) => {
  const offer = await Offer.findByIdAndDelete(req.params.id);

  if (!offer) {
    return next(new AppError('Offer not found', 404));
  }

  logger.info(`Offer deleted: ${offer.name} by ${req.user.email}`);

  res.status(204).json({
    success: true,
    message: 'Offer deleted successfully',
    data: null,
  });
});

/**
 * Duplicate offer
 * POST /api/admin/offers/:id/duplicate
 */
exports.duplicateOffer = catchAsync(async (req, res, next) => {
  const originalOffer = await Offer.findById(req.params.id);

  if (!originalOffer) {
    return next(new AppError('Offer not found', 404));
  }

  // Create new offer with same details but new dates
  const offerData = originalOffer.toObject();
  delete offerData._id;
  delete offerData.createdAt;
  delete offerData.updatedAt;
  delete offerData.__v;
  
  // Reset statistics
  offerData.totalOrders = 0;
  offerData.totalDiscountGiven = 0;
  offerData.totalRevenue = 0;
  
  // Set as draft and update creator
  offerData.status = 'draft';
  offerData.createdBy = req.user._id;
  offerData.name = `${offerData.name} (Copy)`;

  const duplicatedOffer = await Offer.create(offerData);

  await duplicatedOffer.populate([
    { path: 'createdBy', select: 'firstName lastName email' },
    { path: 'applicableItems', select: 'name image' },
    { path: 'applicableCategories', select: 'name' },
  ]);

  logger.info(`Offer duplicated: ${duplicatedOffer.name} by ${req.user.email}`);

  res.status(201).json({
    success: true,
    message: 'Offer duplicated successfully',
    data: duplicatedOffer,
  });
});

/**
 * Get offer statistics
 * GET /api/admin/offers/:id/stats
 */
exports.getOfferStats = catchAsync(async (req, res, next) => {
  const offer = await Offer.findById(req.params.id);

  if (!offer) {
    return next(new AppError('Offer not found', 404));
  }

  // Get detailed statistics from orders
  const Order = require('../models/Order');
  const orders = await Order.find({ 'appliedOffer.offerId': offer._id });

  const stats = {
    totalOrders: orders.length,
    totalDiscountGiven: orders.reduce((sum, order) => sum + (order.appliedOffer?.discountAmount || 0), 0),
    totalRevenue: orders.reduce((sum, order) => sum + order.totalAmount, 0),
    averageOrderValue: orders.length > 0 ? orders.reduce((sum, order) => sum + order.totalAmount, 0) / orders.length : 0,
    averageDiscount: orders.length > 0 ? orders.reduce((sum, order) => sum + (order.appliedOffer?.discountAmount || 0), 0) / orders.length : 0,
  };

  res.status(200).json({
    success: true,
    data: {
      offer: {
        id: offer._id,
        name: offer.name,
        status: offer.status,
        startDate: offer.startDate,
        endDate: offer.endDate,
      },
      stats,
    },
  });
});

/* =====================================================
   CUSTOMER OFFER CONTROLLERS
===================================================== */

/**
 * Get active offers for customers
 * GET /api/offers/active
 */
exports.getActiveOffers = catchAsync(async (req, res, next) => {
  const offers = await Offer.getActiveOffers();

  // Populate item and category details
  await Offer.populate(offers, [
    { path: 'applicableItems', select: 'name image priceVariants' },
    { path: 'applicableCategories', select: 'name' },
  ]);

  res.status(200).json({
    success: true,
    results: offers.length,
    data: offers,
  });
});

/**
 * Get teaser offers (upcoming offers)
 * GET /api/offers/teasers
 */
exports.getTeaserOffers = catchAsync(async (req, res, next) => {
  const offers = await Offer.getTeaserOffers();

  res.status(200).json({
    success: true,
    results: offers.length,
    data: offers,
  });
});

/**
 * Get applicable offers for specific items
 * POST /api/offers/check
 * Body: { items: [itemId1, itemId2], totalAmount: 500 }
 */
exports.checkApplicableOffers = catchAsync(async (req, res, next) => {
  const { items, totalAmount } = req.body;

  if (!items || !Array.isArray(items)) {
    return next(new AppError('Items array is required', 400));
  }

  if (typeof totalAmount !== 'number') {
    return next(new AppError('Total amount is required', 400));
  }

  // Get all active offers
  const activeOffers = await Offer.getActiveOffers();

  // Filter offers that apply to these items
  const applicableOffers = activeOffers.filter(offer => {
    // Check minimum order amount
    if (totalAmount < offer.minOrderAmount) {
      return false;
    }

    // Check if items match
    if (offer.applicableTo === 'all') {
      return true;
    }

    if (offer.applicableTo === 'items') {
      return items.some(itemId =>
        offer.applicableItems.some(applicableItem =>
          applicableItem._id.toString() === itemId.toString()
        )
      );
    }

    // For categories, we'd need to check item categories
    // This would require fetching items - skipping for now
    return true;
  });

  // Calculate discount for each applicable offer
  const offersWithDiscount = applicableOffers.map(offer => {
    const orderItems = items.map(itemId => ({ menuItem: itemId }));
    const discount = offer.calculateDiscount(totalAmount, orderItems);
    
    return {
      id: offer._id,
      name: offer.name,
      description: offer.description,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      calculatedDiscount: discount,
      minOrderAmount: offer.minOrderAmount,
      bannerImage: offer.bannerImage,
    };
  });

  // Sort by discount amount (highest first)
  offersWithDiscount.sort((a, b) => b.calculatedDiscount - a.calculatedDiscount);

  res.status(200).json({
    success: true,
    results: offersWithDiscount.length,
    data: offersWithDiscount,
  });
});

module.exports = exports;
