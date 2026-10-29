const Joi = require('joi');

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

exports.bulkBlockUsersSchema = Joi.object({
  userIds: Joi.array()
    .items(
      Joi.string()
        .trim()
        .regex(objectIdPattern)
        .messages({
          'string.pattern.base': 'Each user ID must be a valid MongoDB ObjectId',
        })
    )
    .min(1)
    .max(100)
    .unique()
    .required()
    .messages({
      'array.base': 'userIds must be an array',
      'array.min': 'At least one user ID is required',
      'array.max': 'Cannot process more than 100 users in one request',
      'array.unique': 'Duplicate user IDs are not allowed',
      'any.required': 'userIds is required',
    }),
  isBlocked: Joi.boolean()
    .required()
    .messages({
      'boolean.base': 'isBlocked must be a boolean',
      'any.required': 'isBlocked is required',
    }),
  blockReason: Joi.string()
    .trim()
    .max(255)
    .allow('', null)
    .default('')
    .messages({
      'string.max': 'Block reason cannot exceed 255 characters',
    }),
});

exports.bulkDeleteUsersSchema = Joi.object({
  userIds: Joi.array()
    .items(
      Joi.string()
        .trim()
        .regex(objectIdPattern)
        .messages({
          'string.pattern.base': 'Each user ID must be a valid MongoDB ObjectId',
        })
    )
    .min(1)
    .max(100)
    .unique()
    .required()
    .messages({
      'array.base': 'userIds must be an array',
      'array.min': 'At least one user ID is required',
      'array.max': 'Cannot process more than 100 users in one request',
      'array.unique': 'Duplicate user IDs are not allowed',
      'any.required': 'userIds is required',
    }),
});

exports.validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const AppError = require('../utils/AppError');
    const message = error.details.map((d) => d.message).join('; ');
    return next(new AppError(message, 400));
  }

  req.body = value;
  next();
};
