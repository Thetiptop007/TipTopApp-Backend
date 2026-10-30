const Joi = require('joi');

/**
 * Validation schema for creating an order
 */
exports.createOrderSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        menuItem: Joi.string()
          .regex(/^[0-9a-fA-F]{24}$/)
          .required()
          .messages({
            'string.empty': 'Menu item ID is required',
            'string.pattern.base': 'Invalid menu item ID',
          }),
        menuItemId: Joi.string()
          .regex(/^[0-9a-fA-F]{24}$/)
          .messages({
            'string.pattern.base': 'Invalid menu item ID',
          }),
        quantity: Joi.number().integer().min(1).max(50).required().messages({
          'number.min': 'Quantity must be at least 1',
          'number.max': 'Quantity cannot exceed 50',
          'any.required': 'Quantity is required',
        }),
        price: Joi.number().min(0).messages({
          'number.base': 'Price must be a number',
          'number.min': 'Price cannot be negative',
        }),
        portion: Joi.string().trim().allow('').optional().messages({
          'string.base': 'Portion must be a string',
        }),
        customizations: Joi.array().items(
          Joi.object({
            name: Joi.string().required(),
            option: Joi.string().required(),
            price: Joi.number().min(0).default(0),
          })
        ),
        specialInstructions: Joi.string().trim().max(200).messages({
          'string.max': 'Special instructions cannot exceed 200 characters',
        }),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required',
      'any.required': 'Order items are required',
    }),

  deliveryAddress: Joi.object({
    area: Joi.string().trim().required().messages({
      'string.empty': 'Area is required',
    }),
    addressLine: Joi.string().trim().min(5).max(300).required().messages({
      'string.empty': 'Address details are required',
      'string.min': 'Address details must be at least 5 characters',
      'string.max': 'Address details are too long (max 300 characters)',
    }),
    coordinates: Joi.object({
      type: Joi.string().valid('Point').default('Point'),
      coordinates: Joi.array()
        .items(Joi.number())
        .length(2)
        .messages({
          'array.length': 'Coordinates must be [longitude, latitude]',
        }),
    }),
  }).required(),

  paymentMethod: Joi.string()
    .valid('ONLINE', 'COD', 'CARD', 'UPI')
    .required()
    .messages({
      'any.only': 'Payment method must be ONLINE, COD, CARD, or UPI',
      'any.required': 'Payment method is required',
    }),
  
  contactPhone: Joi.string().trim().messages({
    'string.empty': 'Contact phone is required',
  }),
  
  customerName: Joi.string().trim().allow('').optional(),
  
  paymentDetails: Joi.object({
    transactionId: Joi.string(),
    gateway: Joi.string(),
    method: Joi.string(),
    timestamp: Joi.date(),
  }),

  scheduledFor: Joi.date().min('now').messages({
    'date.min': 'Scheduled time must be in the future',
  }),

  specialInstructions: Joi.string().trim().max(500).messages({
    'string.max': 'Special instructions cannot exceed 500 characters',
  }),

  promoCode: Joi.string().trim().uppercase(),
  allowDuplicate: Joi.boolean().optional(),
});

/**
 * Validation schema for updating order status
 */
exports.updateOrderStatusSchema = Joi.object({
  status: Joi.string()
    .valid(
      'pending',
      'confirmed',
      'preparing',
      'ready',
      'picked-up',
      'out-for-delivery',
      'delivered',
      'cancelled'
    )
    .required()
    .messages({
      'any.only': 'Invalid order status',
      'any.required': 'Status is required',
    }),

  notes: Joi.string().trim().max(500).messages({
    'string.max': 'Notes cannot exceed 500 characters',
  }),
});

/**
 * Validation schema for bulk status updates (admin only)
 */
exports.bulkUpdateOrderStatusSchema = Joi.object({
  orderIds: Joi.array()
    .items(
      Joi.string()
        .trim()
        .regex(/^[0-9a-fA-F]{24}$/)
        .messages({
          'string.pattern.base': 'Each order ID must be a valid MongoDB ObjectId',
        })
    )
    .min(1)
    .max(100)
    .unique()
    .required()
    .messages({
      'array.base': 'orderIds must be an array',
      'array.min': 'At least one order ID is required',
      'array.max': 'Cannot update more than 100 orders in one request',
      'array.unique': 'Duplicate order IDs are not allowed',
      'any.required': 'orderIds is required',
    }),
  status: Joi.string()
    .valid('ACCEPTED', 'READY', 'DELIVERED', 'CANCELLED')
    .required()
    .messages({
      'any.only': 'Status must be one of ACCEPTED, READY, DELIVERED, CANCELLED',
      'any.required': 'status is required',
    }),
});

/**
 * Validation schema for cancelling an order
 */
exports.cancelOrderSchema = Joi.object({
  reason: Joi.string().trim().min(5).max(500).required().messages({
    'string.empty': 'Cancellation reason is required',
    'string.min': 'Reason must be at least 5 characters',
    'string.max': 'Reason cannot exceed 500 characters',
  }),
});

/**
 * Validation schema for assigning delivery partner
 */
exports.assignDeliveryPartnerSchema = Joi.object({
  deliveryPartnerId: Joi.string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      'string.empty': 'Delivery partner ID is required',
      'string.pattern.base': 'Invalid delivery partner ID',
    }),
});

/**
 * Validation schema for rating an order
 */
exports.rateOrderSchema = Joi.object({
  foodRating: Joi.number().min(1).max(5).required().messages({
    'number.min': 'Food rating must be between 1 and 5',
    'number.max': 'Food rating must be between 1 and 5',
    'any.required': 'Food rating is required',
  }),

  deliveryRating: Joi.number().min(1).max(5).required().messages({
    'number.min': 'Delivery rating must be between 1 and 5',
    'number.max': 'Delivery rating must be between 1 and 5',
    'any.required': 'Delivery rating is required',
  }),

  packagingRating: Joi.number().min(1).max(5).required().messages({
    'number.min': 'Packaging rating must be between 1 and 5',
    'number.max': 'Packaging rating must be between 1 and 5',
    'any.required': 'Packaging rating is required',
  }),

  comment: Joi.string().trim().max(1000).messages({
    'string.max': 'Comment cannot exceed 1000 characters',
  }),
});

/**
 * Validation schema for order query parameters
 */
exports.orderQuerySchema = Joi.object({
  // Pagination
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),

  // Sorting
  sort: Joi.string().pattern(/^-?[\w,.-]+$/),

  // Field limiting
  fields: Joi.string().pattern(/^[\w,.-]+$/),

  // Filtering
  status: Joi.string().valid(
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'picked-up',
    'out-for-delivery',
    'delivered',
    'cancelled'
  ),
  paymentMethod: Joi.string().valid('cash', 'card', 'upi', 'wallet'),
  paymentStatus: Joi.string().valid('pending', 'completed', 'failed', 'refunded'),

  // Date range
  'createdAt[gte]': Joi.date(),
  'createdAt[lte]': Joi.date(),

  // Amount range
  'pricing.finalAmount[gte]': Joi.number().min(0),
  'pricing.finalAmount[lte]': Joi.number().min(0),

  // Allow unknown query parameters for MongoDB operators
}).unknown(true);

/**
 * Middleware to validate request body
 */
exports.validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        status: 'fail',
        message: 'Validation error',
        errors,
      });
    }

    req.body = value;
    next();
  };
};

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

/**
 * Validation schema for guest order creation (no authentication required)
 */
exports.createGuestOrderSchema = Joi.object({
  customer: Joi.object({
    name: Joi.string().trim().min(2).max(50).required().messages({
      'string.min': 'Customer name must be at least 2 characters long',
      'any.required': 'Customer name is required',
    }),
    phone: Joi.string()
      .trim()
      .pattern(/^(\+91|0)?[6-9]\d{9}$/)
      .required()
      .messages({
        'string.pattern.base': 'Please provide a valid 10-digit phone number',
        'any.required': 'Phone number is required',
      }),
    email: Joi.string().email().optional().allow('').messages({
      'string.email': 'Invalid email format',
    }),
  }).required(),

  items: Joi.array()
    .items(
      Joi.object({
        menuItem: Joi.string()
          .regex(/^[0-9a-fA-F]{24}$/)
          .required()
          .messages({
            'string.empty': 'Menu item ID is required',
            'string.pattern.base': 'Invalid menu item ID',
          }),
        quantity: Joi.number().integer().min(1).max(50).required().messages({
          'number.min': 'Quantity must be at least 1',
          'number.max': 'Quantity cannot exceed 50',
          'any.required': 'Quantity is required',
        }),
        price: Joi.number().min(0).optional().messages({
          'number.base': 'Price must be a number',
          'number.min': 'Price cannot be negative',
        }),
        portion: Joi.string().trim().allow('').optional().messages({
          'string.base': 'Portion must be a string',
        }),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required',
      'any.required': 'Order items are required',
    }),

  orderType: Joi.string()
    .valid('DELIVERY', 'TAKEAWAY')
    .default('DELIVERY')
    .messages({
      'any.only': 'Order type must be DELIVERY or TAKEAWAY',
    }),

  deliveryAddress: Joi.when('orderType', {
    is: 'DELIVERY',
    then: Joi.object({
      area: Joi.string().trim().required().messages({
        'any.required': 'Area selection is required',
      }),
      addressLine: Joi.string().trim().min(1).max(300).required().messages({
        'string.min': 'Address must not be empty',
        'any.required': 'Address line is required',
      }),
    }).required(),
    otherwise: Joi.optional(),
  }),

  paymentMethod: Joi.string()
    .valid('COD', 'ONLINE')
    .default('COD')
    .messages({
      'any.only': 'Payment method must be COD or ONLINE',
    }),

  fcmToken: Joi.string().trim().allow('', null).optional().messages({
    'string.base': 'FCM token must be a string',
  }),

  specialInstructions: Joi.string().trim().max(500).allow('').optional().messages({
    'string.max': 'Special instructions cannot exceed 500 characters',
  }),
});
