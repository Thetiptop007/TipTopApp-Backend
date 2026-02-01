const Settings = require('../models/Settings');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * @desc    Get settings
 * @route   GET /api/v1/settings
 * @access  Public (or Admin if you want to restrict)
 */
exports.getSettings = catchAsync(async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();

    res.status(200).json({
      success: true,
      data: {
        settings,
      },
    });
  } catch (error) {
    logger.error('Error in getSettings:', error);
    return next(new AppError('Failed to fetch settings', 500));
  }
});

/**
 * @desc    Update settings
 * @route   PUT /api/v1/settings
 * @access  Admin only
 */
exports.updateSettings = catchAsync(async (req, res, next) => {
  const {
    siteName,
    contactEmail,
    contactPhone,
    businessAddress,
    website,
    notificationEmails,
    minimumOrderAmount,
    taxRate,
    deliveryCharge,
    discountAmount,
    appUpdateAvailable,
    appUpdateMessage,
    appUpdateUrl,
    upiId,
    apkDownloadUrl,
    indusAppStoreUrl,
    adminProfile,
  } = req.body;

  // Get the singleton settings document
  const settings = await Settings.getSettings();

  // Update fields if provided
  if (siteName !== undefined) settings.siteName = siteName;
  if (contactEmail !== undefined) settings.contactEmail = contactEmail;
  if (contactPhone !== undefined) settings.contactPhone = contactPhone;
  if (businessAddress !== undefined) settings.businessAddress = businessAddress;
  if (website !== undefined) settings.website = website;
  if (notificationEmails !== undefined) settings.notificationEmails = notificationEmails;
  if (minimumOrderAmount !== undefined) settings.minimumOrderAmount = minimumOrderAmount;
  if (taxRate !== undefined) settings.taxRate = taxRate;
  if (deliveryCharge !== undefined) settings.deliveryCharge = deliveryCharge;
  if (discountAmount !== undefined) settings.discountAmount = discountAmount;
  if (appUpdateAvailable !== undefined) settings.appUpdateAvailable = appUpdateAvailable;
  if (appUpdateMessage !== undefined) settings.appUpdateMessage = appUpdateMessage;
  if (appUpdateUrl !== undefined) settings.appUpdateUrl = appUpdateUrl;
  if (upiId !== undefined) settings.upiId = upiId;
  if (apkDownloadUrl !== undefined) settings.apkDownloadUrl = apkDownloadUrl;
  if (indusAppStoreUrl !== undefined) settings.indusAppStoreUrl = indusAppStoreUrl;
  
  // Update admin profile
  if (adminProfile !== undefined) {
    if (adminProfile.firstName !== undefined) settings.adminProfile.firstName = adminProfile.firstName;
    if (adminProfile.lastName !== undefined) settings.adminProfile.lastName = adminProfile.lastName;
  }

  await settings.save();

  res.status(200).json({
    success: true,
    message: 'Settings updated successfully',
    data: {
      settings,
    },
  });
});

/**
 * @desc    Toggle shop status (open/closed)
 * @route   PATCH /api/v1/settings/shop-status
 * @access  Admin only
 */
exports.toggleShopStatus = catchAsync(async (req, res, next) => {
  const { isOpen, closureReason } = req.body;

  // Validate input
  if (typeof isOpen !== 'boolean') {
    return next(new AppError('Please provide a valid shop status (true for open, false for closed)', 400));
  }

  // Get the singleton settings document
  const settings = await Settings.getSettings();

  // Update shop status
  settings.shopStatus.isOpen = isOpen;
  settings.shopStatus.lastUpdatedBy = req.user.email || req.user.name?.first || 'Admin';
  settings.shopStatus.lastUpdatedAt = new Date();
  settings.shopStatus.closureReason = !isOpen ? (closureReason || '') : '';

  await settings.save();

  logger.info(`🏪 Shop status changed to ${isOpen ? 'OPEN' : 'CLOSED'} by ${settings.shopStatus.lastUpdatedBy}${!isOpen && closureReason ? ` - Reason: ${closureReason}` : ''}`);

  res.status(200).json({
    success: true,
    message: `Shop is now ${isOpen ? 'open' : 'closed'}`,
    data: {
      shopStatus: settings.shopStatus,
    },
  });
});

/**
 * @desc    Get current shop status
 * @route   GET /api/v1/settings/shop-status
 * @access  Public
 */
exports.getShopStatus = catchAsync(async (req, res, next) => {
  const settings = await Settings.getSettings();

  res.status(200).json({
    success: true,
    data: {
      shopStatus: settings.shopStatus,
    },
  });
});
