const { notifyCriticalError } = require('../utils/errorNotification');
const logger = require('../utils/logger');

/**
 * @desc    Log frontend errors
 * @route   POST /api/v1/errors/log
 * @access  Public (no auth required - errors can happen before auth)
 */
exports.logFrontendError = async (req, res, next) => {
  try {
    const errorData = req.body;

    // Log to console/file
    logger.error('Frontend error received:', {
      type: errorData.type,
      message: errorData.message,
      url: errorData.url,
      timestamp: errorData.timestamp,
    });

    // Create an Error object for notification
    const error = new Error(errorData.message || 'Frontend error');
    error.name = errorData.type || 'FrontendError';
    error.stack = errorData.stack || errorData.componentStack || 'No stack trace available';

    // Determine if this is critical
    const isCritical =
      errorData.type === 'react-component-error' ||
      errorData.type === 'uncaught-exception' ||
      errorData.type === 'unhandled-rejection' ||
      (errorData.message && errorData.message.toLowerCase().includes('critical'));

    // Send notification if critical
    if (isCritical) {
      logger.warn('🚨 Critical frontend error detected, notifying developer...');
      
      await notifyCriticalError(error, {
        type: 'frontend-error',
        additionalInfo: {
          errorType: errorData.type,
          url: errorData.url,
          userAgent: errorData.userAgent,
          componentStack: errorData.componentStack,
          timestamp: errorData.timestamp,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Error logged successfully',
    });
  } catch (err) {
    logger.error('Failed to log frontend error:', err);
    // Don't send error response - we don't want to break the frontend further
    res.status(200).json({
      success: true,
      message: 'Error received',
    });
  }
};

/**
 * @desc    Test error notification system
 * @route   POST /api/v1/errors/test
 * @access  Private/Admin
 */
exports.testErrorNotification = async (req, res, next) => {
  try {
    const testError = new Error('This is a test error notification');
    testError.name = 'TestError';

    await notifyCriticalError(testError, {
      type: 'test',
      user: req.user,
      additionalInfo: {
        message: 'This is a test to verify the error notification system is working',
        triggeredBy: req.user?.email || 'Unknown',
      },
    });

    res.status(200).json({
      success: true,
      message: 'Test error notification sent. Check your email.',
    });
  } catch (err) {
    logger.error('Failed to send test error notification:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: err.message,
    });
  }
};
