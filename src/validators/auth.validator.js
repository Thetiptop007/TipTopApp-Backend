const Joi = require('joi');

const strongPasswordSchema = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/)
  .messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 8 characters',
    'string.max': 'Password cannot exceed 128 characters',
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  });

/**
 * Validation schema for user registration
 */
exports.registerSchema = Joi.object({
  name: Joi.alternatives()
    .try(
      // Accept string (will be split in controller)
      Joi.string().trim().min(2).max(100).required().messages({
        'string.empty': 'Name is required',
        'string.min': 'Name must be at least 2 characters',
        'string.max': 'Name cannot exceed 100 characters',
      }),
      // Or accept object (legacy support)
      Joi.object({
        first: Joi.string().trim().min(2).max(50).required().messages({
          'string.empty': 'First name is required',
          'string.min': 'First name must be at least 2 characters',
          'string.max': 'First name cannot exceed 50 characters',
        }),
        last: Joi.string().trim().min(2).max(50).allow('').optional().messages({
          'string.min': 'Last name must be at least 2 characters',
          'string.max': 'Last name cannot exceed 50 characters',
        }),
      })
    )
    .required(),

  email: Joi.string().trim().lowercase().email().messages({
    'string.email': 'Please provide a valid email address',
  }),

  password: strongPasswordSchema.required(),

  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      'string.empty': 'Phone number is required',
      'string.pattern.base':
        'Please provide a valid 10-digit Indian phone number',
    }),

  role: Joi.forbidden(),

  permissions: Joi.forbidden(),
  privileges: Joi.forbidden(),
  isAdmin: Joi.forbidden(),
  isBlocked: Joi.forbidden(),
  isActive: Joi.forbidden(),
  authSessions: Joi.forbidden(),
  deviceTokens: Joi.forbidden(),
  emailVerificationToken: Joi.forbidden(),
  emailVerificationExpires: Joi.forbidden(),
  passwordChangedAt: Joi.forbidden(),
  passwordResetToken: Joi.forbidden(),
  passwordResetExpires: Joi.forbidden(),

  addresses: Joi.array()
    .items(
      Joi.object({
        type: Joi.string()
          .valid('home', 'work', 'other')
          .default('home')
          .messages({
            'any.only': 'Address type must be home, work, or other',
          }),
        label: Joi.string().trim().max(50).messages({
          'string.max': 'Address label cannot exceed 50 characters',
        }),
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
        isDefault: Joi.boolean().default(false),
      })
    )
    .max(5)
    .messages({
      'array.max': 'You can add maximum 5 addresses',
    }),

  preferences: Joi.object({
    language: Joi.string().valid('en', 'hi').default('en'),
    notifications: Joi.object({
      email: Joi.boolean().default(true),
      sms: Joi.boolean().default(true),
      push: Joi.boolean().default(true),
      orderUpdates: Joi.boolean().default(true),
      promotions: Joi.boolean().default(false),
    }),
    dietary: Joi.array()
      .items(Joi.string().valid('vegetarian', 'vegan', 'jain', 'halal'))
      .unique(),
  }),
});

/**
 * Validation schema for user login
 */
exports.customerLoginSchema = Joi.object({
  email: Joi.alternatives()
    .try(
      // Accept email format
      Joi.string().trim().lowercase().email(),
      // Or accept phone number format (10 digits only)
      Joi.string().pattern(/^[6-9]\d{9}$/)
    )
    .required()
    .messages({
      'string.empty': 'Email or phone number is required',
      'alternatives.match': 'Please provide a valid email address or 10-digit phone number',
    }),

  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
  }),
});

exports.adminLoginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required().messages({
    'string.empty': 'Email is required',
    'string.email': 'Please provide a valid email address',
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
  }),
});

/**
 * Validation schema for refresh token
 */
exports.refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().optional(),
}).unknown(true);

/**
 * Validation schema for forgot password
 */
exports.forgotPasswordSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required().messages({
    'string.empty': 'Email is required',
    'string.email': 'Please provide a valid email address',
  }),
});

/**
 * Validation schema for reset password
 */
exports.resetPasswordSchema = Joi.object({
  password: strongPasswordSchema.required(),
});

/**
 * Validation schema for change password
 */
exports.changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    'string.empty': 'Current password is required',
  }),

  newPassword: strongPasswordSchema.required().invalid(Joi.ref('currentPassword')).messages({
    'any.invalid': 'New password must be different from current password',
  }),
});

/**
 * Validation schema for update profile
 */
exports.updateProfileSchema = Joi.object({
  name: Joi.object({
    first: Joi.string().trim().min(2).max(50).messages({
      'string.min': 'First name must be at least 2 characters',
      'string.max': 'First name cannot exceed 50 characters',
    }),
    last: Joi.string().trim().min(2).max(50).allow('').optional().messages({
      'string.min': 'Last name must be at least 2 characters',
      'string.max': 'Last name cannot exceed 50 characters',
    }),
  }),

  email: Joi.string().email().trim().lowercase().messages({
    'string.email': 'Please provide a valid email address',
  }),

  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .trim()
    .messages({
      'string.empty': 'Phone number is required',
      'string.pattern.base': 'Please provide a valid 10-digit Indian phone number',
    }),

  addresses: Joi.array()
    .items(
      Joi.object({
        type: Joi.string()
          .valid('home', 'work', 'other')
          .default('home')
          .messages({
            'any.only': 'Address type must be home, work, or other',
          }),
        label: Joi.string().trim().max(50).messages({
          'string.max': 'Address label cannot exceed 50 characters',
        }),
        area: Joi.string().trim().optional().messages({
          'string.base': 'Area must be a string',
        }),
        addressLine: Joi.string().trim().min(5).max(300).optional().messages({
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
        isDefault: Joi.boolean().default(false),
      })
    )
    .max(5)
    .messages({
      'array.max': 'You can add maximum 5 addresses',
    }),

  preferences: Joi.object({
    language: Joi.string().valid('en', 'hi'),
    notifications: Joi.object({
      email: Joi.boolean(),
      sms: Joi.boolean(),
      push: Joi.boolean(),
      orderUpdates: Joi.boolean(),
      promotions: Joi.boolean(),
    }),
    dietary: Joi.array()
      .items(Joi.string().valid('vegetarian', 'vegan', 'jain', 'halal'))
      .unique(),
  }),

  // Prevent password updates through this route
  password: Joi.forbidden(),
  passwordConfirm: Joi.forbidden(),
});

/**
 * Validation schema for delete account
 */
exports.deleteAccountSchema = Joi.object({
  password: Joi.string().required().messages({
    'string.empty': 'Password is required to deactivate account',
  }),

  permissions: Joi.forbidden(),
  privileges: Joi.forbidden(),
  role: Joi.forbidden(),
  isAdmin: Joi.forbidden(),
  isBlocked: Joi.forbidden(),
  isActive: Joi.forbidden(),
  authSessions: Joi.forbidden(),
  deviceTokens: Joi.forbidden(),
  emailVerificationToken: Joi.forbidden(),
  emailVerificationExpires: Joi.forbidden(),
  passwordChangedAt: Joi.forbidden(),
  passwordResetToken: Joi.forbidden(),
  passwordResetExpires: Joi.forbidden(),
});

/** * Validation schema for changing password
 */
exports.changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    'string.empty': 'Current password is required',
  }),
  newPassword: strongPasswordSchema.required(),
  confirmPassword: Joi.string()
    .valid(Joi.ref('newPassword'))
    .required()
    .messages({
      'string.empty': 'Confirm password is required',
      'any.only': 'Passwords do not match',
    }),
});

/**
 * Validation schema for Customer Google login
 */
exports.googleLoginSchema = Joi.object({
  credential: Joi.string().required().messages({
    'string.empty': 'Google ID token (credential) is required',
    'any.required': 'Google ID token (credential) is required',
  }),
});

/** * Middleware to validate request body
 */
exports.validate = schema => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        status: 'fail',
        message: 'Validation error',
        errors,
      });
    }

    // Replace req.body with validated value
    req.body = value;
    next();
  };
};
