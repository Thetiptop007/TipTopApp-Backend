const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * @desc    Get all addresses for current user
 * @route   GET /api/v1/addresses
 * @access  Private (Customer)
 */
exports.getAddresses = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('addresses');

  res.status(200).json({
    status: 'success',
    results: user.addresses.length,
    data: {
      addresses: user.addresses,
    },
  });
});

/**
 * @desc    Add new address
 * @route   POST /api/v1/addresses
 * @access  Private (Customer)
 */
exports.addAddress = catchAsync(async (req, res, next) => {
  const { type, label, street, apartment, city, state, zipCode, landmark, isDefault } = req.body;

  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // If this is set as default, unset other defaults
  if (isDefault) {
    user.addresses.forEach((addr) => {
      addr.isDefault = false;
    });
  }

  // If this is the first address, make it default
  const makeDefault = user.addresses.length === 0 || isDefault;

  // Add new address
  user.addresses.push({
    type,
    label,
    street,
    apartment,
    city,
    state,
    zipCode,
    landmark,
    isDefault: makeDefault,
  });

  await user.save();

  const newAddress = user.addresses[user.addresses.length - 1];

  logger.business('USER_ADDRESS_ADDED', 'Address added for user', { userId: user._id.toString(), addressId: newAddress._id.toString() });

  res.status(201).json({
    status: 'success',
    message: 'Address added successfully',
    data: {
      address: newAddress,
    },
  });
});

/**
 * @desc    Update address
 * @route   PATCH /api/v1/addresses/:addressId
 * @access  Private (Customer)
 */
exports.updateAddress = catchAsync(async (req, res, next) => {
  const { addressId } = req.params;
  const { type, label, street, apartment, city, state, zipCode, landmark, isDefault } = req.body;

  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const address = user.addresses.id(addressId);

  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  // If setting as default, unset other defaults
  if (isDefault && !address.isDefault) {
    user.addresses.forEach((addr) => {
      if (addr._id.toString() !== addressId) {
        addr.isDefault = false;
      }
    });
  }

  // Update fields
  if (type !== undefined) address.type = type;
  if (label !== undefined) address.label = label;
  if (street !== undefined) address.street = street;
  if (apartment !== undefined) address.apartment = apartment;
  if (city !== undefined) address.city = city;
  if (state !== undefined) address.state = state;
  if (zipCode !== undefined) address.zipCode = zipCode;
  if (landmark !== undefined) address.landmark = landmark;
  if (isDefault !== undefined) address.isDefault = isDefault;

  await user.save();

  logger.business('USER_ADDRESS_UPDATED', 'Address updated for user', { userId: user._id.toString(), addressId: address._id.toString() });

  res.status(200).json({
    status: 'success',
    message: 'Address updated successfully',
    data: {
      address,
    },
  });
});

/**
 * @desc    Delete address
 * @route   DELETE /api/v1/addresses/:addressId
 * @access  Private (Customer)
 */
exports.deleteAddress = catchAsync(async (req, res, next) => {
  const { addressId } = req.params;

  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const address = user.addresses.id(addressId);

  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  const wasDefault = address.isDefault;

  // Remove address using pull method
  user.addresses.pull(addressId);

  // If deleted address was default, set first remaining address as default
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save();

  logger.business('USER_ADDRESS_DELETED', 'Address deleted for user', { userId: user._id.toString(), addressId });

  res.status(200).json({
    status: 'success',
    message: 'Address deleted successfully',
  });
});

/**
 * @desc    Set default address
 * @route   PATCH /api/v1/addresses/:addressId/default
 * @access  Private (Customer)
 */
exports.setDefaultAddress = catchAsync(async (req, res, next) => {
  const { addressId } = req.params;

  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const address = user.addresses.id(addressId);

  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  // Unset all defaults
  user.addresses.forEach((addr) => {
    addr.isDefault = false;
  });

  // Set this as default
  address.isDefault = true;

  await user.save();

  logger.business('USER_ADDRESS_DEFAULT_SET', 'Default address set for user', { userId: user._id.toString(), addressId });

  res.status(200).json({
    status: 'success',
    message: 'Default address updated successfully',
    data: {
      address,
    },
  });
});
