const Joi = require('joi');
const logger = require('../utils/logger');

/**
 * Validation schema for creating a menu item
 */
exports.createMenuItemSchema = Joi.object({
  name: Joi.string().trim().min(3).max(100).required().messages({
    'string.empty': 'Menu item name is required',
    'string.min': 'Name must be at least 3 characters',
    'string.max': 'Name cannot exceed 100 characters',
  }),

  description: Joi.string().trim().allow('').max(1000).messages({
    'string.max': 'Description cannot exceed 1000 characters',
  }),

  // Allow both full URLs and relative paths (for placeholder images)
  image: Joi.string().trim().required().messages({
    'string.empty': 'Image URL is required',
  }),

  // Price Variants - required
  priceVariants: Joi.array()
    .items(
      Joi.object({
        quantity: Joi.string()
          .trim()
          .max(12)
          .pattern(/^(?:(?:\d+\s*(?:pc|pcs))|quarter|half|full)$/i)
          .required()
          .messages({
            'string.pattern.base': 'Quantity must be a valid plate/pc value (e.g. 1PC, 3 PC, Quarter, Half, Full)',
            'any.required': 'Quantity is required for price variant'
          }),
        price: Joi.number().min(0).required().messages({
          'number.base': 'Price must be a number',
          'number.min': 'Price cannot be negative',
          'any.required': 'Price is required for price variant',
        }),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one price variant is required',
      'any.required': 'Price variants are required',
    }),

  // Categories - optional if category is provided (for backward compatibility)
  categories: Joi.array()
    .items(Joi.string())
    .min(1)
    .messages({
      'array.min': 'At least one category is required',
    }),

  rating: Joi.number().min(0).max(5).default(4.0).messages({
    'number.min': 'Rating must be between 0 and 5',
    'number.max': 'Rating must be between 0 and 5',
  }),

  reviews: Joi.number().integer().min(0).default(0),

  isAvailable: Joi.boolean().default(true),

  isActive: Joi.boolean().default(true),

  // Legacy fields for backward compatibility (optional)
  price: Joi.number().min(0).messages({
    'number.base': 'Price must be a number',
    'number.min': 'Price cannot be negative',
  }),

  images: Joi.array().items(Joi.string().uri()).max(5).messages({
    'array.max': 'Maximum 5 images allowed',
  }),

  // Allow category as either string (category name/ID) or object (detailed structure)
  category: Joi.alternatives().try(
    Joi.string().trim(),
    Joi.object({
      main: Joi.string(),
      sub: Joi.array().items(Joi.string()),
      tags: Joi.array().items(Joi.string()).max(10),
    })
  ),

  plateQuantity: Joi.string()
    .valid('Full', 'Half', 'Quarter')
    .messages({
      'any.only': 'Plate quantity must be Full, Half, or Quarter',
    }),

  spiceLevel: Joi.string()
    .valid('mild', 'medium', 'hot', 'extra-hot')
    .messages({
      'any.only': 'Spice level must be mild, medium, hot, or extra-hot',
    }),

  servingSize: Joi.string().trim().max(50).messages({
    'string.max': 'Serving size cannot exceed 50 characters',
  }),

  calories: Joi.number().integer().min(0).messages({
    'number.base': 'Calories must be a number',
    'number.min': 'Calories cannot be negative',
  }),

  allergens: Joi.array().items(Joi.string()).max(20).messages({
    'array.max': 'Maximum 20 allergens allowed',
  }),

  ingredients: Joi.array().items(Joi.string()).max(50).messages({
    'array.max': 'Maximum 50 ingredients allowed',
  }),

  nutritionalInfo: Joi.object({
    protein: Joi.number().min(0),
    carbs: Joi.number().min(0),
    fat: Joi.number().min(0),
    fiber: Joi.number().min(0),
  }),

  customizations: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      type: Joi.string().valid('single', 'multiple').default('single'),
      required: Joi.boolean().default(false),
      options: Joi.array()
        .items(
          Joi.object({
            name: Joi.string().required(),
            price: Joi.number().min(0).default(0),
          })
        )
        .min(1)
        .required(),
    })
  ),

  variants: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      price: Joi.number().min(0).required(),
      isAvailable: Joi.boolean().default(true),
    })
  ),

  dietaryTags: Joi.array()
    .items(
      Joi.string().valid(
        'vegan',
        'gluten-free',
        'dairy-free',
        'nut-free',
        'low-carb',
        'keto',
        'halal',
        'jain'
      )
    )
    .unique(),

  maxOrderQuantity: Joi.number().integer().min(1).default(10).messages({
    'number.min': 'Maximum order quantity must be at least 1',
  }),
});

/**
 * Validation schema for updating a menu item
 */
exports.updateMenuItemSchema = Joi.object({
  name: Joi.string().trim().min(3).max(100).messages({
    'string.min': 'Name must be at least 3 characters',
    'string.max': 'Name cannot exceed 100 characters',
  }),

  description: Joi.string().trim().allow('').max(1000).messages({
    'string.max': 'Description cannot exceed 1000 characters',
  }),

  // Allow both full URLs and relative paths (for placeholder images)
  image: Joi.string().trim().messages({
    'string.empty': 'Image URL is required',
  }),

  // Price Variants
  priceVariants: Joi.array()
    .items(
      Joi.object({
        quantity: Joi.string()
          .trim()
          .max(12)
          .pattern(/^(?:(?:\d+\s*(?:pc|pcs))|quarter|half|full)$/i)
          .required()
          .messages({
            'string.pattern.base': 'Quantity must be a valid plate/pc value (e.g. 1PC, 3 PC, Quarter, Half, Full)',
          }),
        price: Joi.number().min(0).required().messages({
          'number.base': 'Price must be a number',
          'number.min': 'Price cannot be negative',
        }),
      })
    )
    .min(1)
    .messages({
      'array.min': 'At least one price variant is required',
    }),

  // Categories
  categories: Joi.array()
    .items(Joi.string())
    .min(1)
    .messages({
      'array.min': 'At least one category is required',
    }),

  rating: Joi.number().min(0).max(5).messages({
    'number.min': 'Rating must be between 0 and 5',
    'number.max': 'Rating must be between 0 and 5',
  }),

  reviews: Joi.number().integer().min(0),

  isAvailable: Joi.boolean(),

  isActive: Joi.boolean(),

  // Legacy fields for backward compatibility
  price: Joi.number().min(0).messages({
    'number.min': 'Price cannot be negative',
  }),

  images: Joi.array().items(Joi.string().uri()).max(5).messages({
    'array.max': 'Maximum 5 images allowed',
  }),

  // Allow category as either string (category name/ID) or object (detailed structure)
  category: Joi.alternatives().try(
    Joi.string().trim(),
    Joi.object({
      main: Joi.string(),
      sub: Joi.array().items(Joi.string()),
      tags: Joi.array().items(Joi.string()).max(10),
    })
  ),

  plateQuantity: Joi.string()
    .valid('Full', 'Half', 'Quarter')
    .messages({
      'any.only': 'Plate quantity must be Full, Half, or Quarter',
    }),

  spiceLevel: Joi.string()
    .valid('mild', 'medium', 'hot', 'extra-hot')
    .messages({
      'any.only': 'Spice level must be mild, medium, hot, or extra-hot',
    }),

  servingSize: Joi.string().trim().max(50),
  calories: Joi.number().integer().min(0),
  allergens: Joi.array().items(Joi.string()).max(20),
  ingredients: Joi.array().items(Joi.string()).max(50),

  nutritionalInfo: Joi.object({
    protein: Joi.number().min(0),
    carbs: Joi.number().min(0),
    fat: Joi.number().min(0),
    fiber: Joi.number().min(0),
  }),

  customizations: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      type: Joi.string().valid('single', 'multiple').default('single'),
      required: Joi.boolean().default(false),
      options: Joi.array()
        .items(
          Joi.object({
            name: Joi.string().required(),
            price: Joi.number().min(0).default(0),
          })
        )
        .min(1)
        .required(),
    })
  ),

  variants: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      price: Joi.number().min(0).required(),
      isAvailable: Joi.boolean().default(true),
    })
  ),

  dietaryTags: Joi.array()
    .items(
      Joi.string().valid(
        'vegan',
        'gluten-free',
        'dairy-free',
        'nut-free',
        'low-carb',
        'keto',
        'halal',
        'jain'
      )
    )
    .unique(),

  maxOrderQuantity: Joi.number().integer().min(1),

  // Prevent updating certain fields
  slug: Joi.forbidden(),
  stats: Joi.forbidden(),
  reviewCount: Joi.forbidden(),
});

/**
 * Validation schema for updating availability
 */
exports.updateAvailabilitySchema = Joi.object({
  isAvailable: Joi.boolean().required().messages({
    'any.required': 'isAvailable field is required',
    'boolean.base': 'isAvailable must be a boolean',
  }),
});

/**
 * Validation schema for menu query parameters
 */
exports.menuQuerySchema = Joi.object({
  // Pagination
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),

  // Sorting
  sort: Joi.string().pattern(/^-?[\w,.-]+$/),

  // Field limiting
  fields: Joi.string().pattern(/^[\w,.-]+$/),

  // Search
  search: Joi.string().trim().max(100),

  // Filtering
  category: Joi.string(),
  isAvailable: Joi.boolean(),
  spiceLevel: Joi.string().valid('mild', 'medium', 'hot', 'extra-hot'),
  plateQuantity: Joi.string().valid('Full', 'Half', 'Quarter'),
  
  // Price range
  'price[gte]': Joi.number().min(0),
  'price[lte]': Joi.number().min(0),
  'price[gt]': Joi.number().min(0),
  'price[lt]': Joi.number().min(0),

  // Rating range
  'rating[gte]': Joi.number().min(0).max(5),
  'rating[lte]': Joi.number().min(0).max(5),

  // Dietary tags
  dietaryTags: Joi.string(), // Can be comma-separated

  // Allow unknown query parameters for MongoDB operators
}).unknown(true);

/**
 * Middleware to validate request body
 */
exports.validate = (schema) => {
  return (req, res, next) => {
    logger.request('REQUEST_VALIDATION_STARTED', 'Request validation started', {
      path: req.path,
      method: req.method
    }, { level: 'debug' });
    
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
        type: detail.type,
        context: detail.context
      }));

      logger.request('REQUEST_VALIDATION_FAILED', 'Request validation failed', {
        errorCount: errors.length,
        errors: errors.map(e => e.field + ': ' + e.message).slice(0, 5)
      }, { severity: 'medium' });

      return res.status(400).json({
        status: 'fail',
        message: 'Validation error',
        errors,
      });
    }

    logger.request('REQUEST_VALIDATION_PASSED', 'Request validation passed', {}, { level: 'debug' });
    
    req.body = value;
    next();
  };
};;

/**
 * Middleware to validate query parameters
 */
exports.validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: false,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        status: 'fail',
        message: 'Query validation error',
        errors,
      });
    }

    req.query = value;
    next();
  };
};
