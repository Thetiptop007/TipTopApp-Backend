const Joi = require('joi');

/**
 * Validation schema for adding/updating address
 * Must match frontend validation in AddAddressScreen.tsx
 */
const addressSchema = Joi.object({
  type: Joi.string().valid('home', 'work', 'other').required().messages({
    'any.only': 'Address type must be home, work, or other',
    'any.required': 'Address type is required',
  }),
  label: Joi.string().trim().max(50).allow('').optional().messages({
    'string.max': 'Label is too long (max 50 characters)',
  }),
  area: Joi.string().trim().required().messages({
    'string.empty': 'Area is required',
  }),
  addressLine: Joi.string().trim().min(5).max(300).required().messages({
    'string.empty': 'Address details are required',
    'string.min': 'Address details must be at least 5 characters',
    'string.max': 'Address details are too long (max 300 characters)',
  }),
  isDefault: Joi.boolean().optional(),
});

/**
 * Validation middleware for add address
 */
exports.validateAddAddress = (req, res, next) => {
  const { error } = addressSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validation middleware for update address
 * All fields are optional for updates
 */
exports.validateUpdateAddress = (req, res, next) => {
  const updateSchema = Joi.object({
    type: Joi.string().valid('home', 'work', 'other').optional().messages({
      'any.only': 'Address type must be home, work, or other',
    }),
    label: Joi.string().trim().max(50).allow('').optional().messages({
      'string.max': 'Label is too long (max 50 characters)',
    }),
    area: Joi.string().trim().optional().messages({
      'string.base': 'Area must be a string',
    }),
    addressLine: Joi.string().trim().min(5).max(300).optional().messages({
      'string.min': 'Address details must be at least 5 characters',
      'string.max': 'Address details are too long (max 300 characters)',
    }),
    isDefault: Joi.boolean().optional(),
  });

  const { error } = updateSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors,
    });
  }

  next();
};
