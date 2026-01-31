const { notifyCriticalError, isCriticalError } = require('../utils/errorNotification');
const logger = require('../utils/logger');

/**
 * Global error handler middleware
 * Catches all errors and sends critical ones to developer
 */
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Error caught by global handler:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  // Check if error is critical and send notification
  if (isCriticalError(err)) {
    logger.warn('🚨 Critical error detected, notifying developer...');
    
    // Send notification asynchronously (don't block response)
    notifyCriticalError(err, {
      req: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        'user-agent': req.get('user-agent'),
      },
      user: req.user || null,
      additionalInfo: {
        body: req.body,
        params: req.params,
        query: req.query,
      },
    }).catch((notificationError) => {
      logger.error('Failed to send error notification:', notificationError);
    });
  }

  // Send error response to client
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? {
      stack: err.stack,
      details: err,
    } : undefined,
  });
};

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  logger.error('💥 UNCAUGHT EXCEPTION! Shutting down...', error);
  
  // Notify developer
  notifyCriticalError(error, {
    type: 'uncaughtException',
    additionalInfo: {
      message: 'Application encountered an uncaught exception and may need to restart',
    },
  }).finally(() => {
    process.exit(1);
  });
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 UNHANDLED REJECTION! Shutting down...', reason);
  
  const error = reason instanceof Error ? reason : new Error(String(reason));
  
  // Notify developer
  notifyCriticalError(error, {
    type: 'unhandledRejection',
    additionalInfo: {
      message: 'Application encountered an unhandled promise rejection',
      promise: promise.toString(),
    },
  }).finally(() => {
    process.exit(1);
  });
});

module.exports = { errorHandler };
