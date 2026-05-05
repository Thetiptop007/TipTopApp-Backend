const { notifyCriticalError, isCriticalError } = require('../utils/errorNotification');
const logger = require('../utils/logger');
const { LOG_EVENTS } = require('../constants/log-events');

/**
 * Global error handler middleware
 * Only logs critical errors to avoid log bloat
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isCritical = statusCode >= 500;

  // Only log critical errors (5xx) in production
  if (process.env.NODE_ENV === 'production') {
    if (isCritical) {
      logger.system('CRITICAL_ERROR_5XX', 'Critical server error', {
        message: err.message,
        method: req.method,
        url: req.originalUrl,
        statusCode,
        name: err.name,
      }, { level: 'error', severity: 'high' });
    }
    // Don't log 4xx errors in production (too noisy)
  } else {
    // Log all errors in development
    logger.system(LOG_EVENTS.SYSTEM.ERROR_CAUGHT_GLOBAL, 'Global error captured', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      statusCode,
    }, { level: 'error' });
  }

  // Check if error is critical and send notification (only for 500+ errors)
  if (isCritical && isCriticalError(err)) {
    logger.system('ERROR_NOTIFICATION_TRIGGERED', 'Sending critical error notification to developer', {}, { level: 'warn', severity: 'high' });

    // Send notification asynchronously (don't block response)
    notifyCriticalError(err, {
      req: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        'user-agent': req.get('user-agent'),
      },
      user: req.user || null,
      statusCode,
    }).catch((notificationError) => {
      logger.system('ERROR_NOTIFICATION_FAILED', 'Failed to send error notification', { errorMessage: notificationError?.message || String(notificationError) }, { level: 'error', severity: 'high' });
    });
  }

  // Send error response to client
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && {
      error: {
        stack: err.stack,
        details: err,
      },
    }),
  });
};

/**
 * Handle uncaught exceptions globally
 */
process.on('uncaughtException', (error) => {
  logger.system('UNCAUGHT_EXCEPTION', 'Uncaught exception, application must restart', {
    message: error.message,
    name: error.name,
    stack: error.stack,
  }, { level: 'error', severity: 'critical' });

  // Notify developer
  notifyCriticalError(error, {
    type: 'uncaughtException',
    message: 'Application crashed due to uncaught exception',
  }).finally(() => {
    logger.system('PROCESS_EXIT_SCHEDULED', 'Exiting process in 5 seconds due to uncaught exception');
    setTimeout(() => process.exit(1), 5000);
  });
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.system('UNHANDLED_PROMISE_REJECTION', 'Unhandled promise rejection, application must restart', {
    message: reason instanceof Error ? reason.message : String(reason),
    name: reason instanceof Error ? reason.name : 'Unknown',
    stack: reason instanceof Error ? reason.stack : 'N/A',
  }, { level: 'error', severity: 'critical' });

  const error = reason instanceof Error ? reason : new Error(String(reason));

  // Notify developer
  notifyCriticalError(error, {
    type: 'unhandledRejection',
    message: 'Application encountered unhandled promise rejection',
  }).finally(() => {
    logger.system('PROCESS_EXIT_SCHEDULED', 'Exiting process in 5 seconds due to unhandled rejection');
    setTimeout(() => process.exit(1), 5000);
  });
});

module.exports = { errorHandler };
