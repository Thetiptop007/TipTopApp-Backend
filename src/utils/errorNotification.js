const emailService = require('../services/email.service');
const logger = require('./logger');

/**
 * Notify developer of critical error via email
 */
const notifyCriticalError = async (error, context = {}) => {
  try {
    // Only send emails in production or if explicitly enabled
    const env = process.env.NODE_ENV || 'development';
    if (env === 'development' && process.env.ENABLE_ERROR_EMAILS !== 'true') {
      logger.system('ERROR_EMAIL_SKIPPED_DEV', 'Skipping error email notification in development', {}, { level: 'info' });
      return;
    }

    // Use the universal email service
    await emailService.sendErrorNotification(error, context);
  } catch (notificationError) {
    logger.system('ERROR_NOTIFICATION_FAILED', 'Failed to send critical error notification', { errorMessage: notificationError?.message || String(notificationError) }, { level: 'error', severity: 'high' });
    // Don't throw - we don't want email failures to break the app
  }
};

/**
 * Determine if an error is critical
 */
const isCriticalError = (error) => {
  // Database errors
  if (error.name === 'MongoError' || error.name === 'MongooseError') {
    return true;
  }

  // Payment/financial errors
  if (error.message && error.message.toLowerCase().includes('payment')) {
    return true;
  }

  // Server errors (5xx)
  if (error.statusCode >= 500) {
    return true;
  }

  // Uncaught exceptions
  if (error.name === 'Error' && !error.statusCode) {
    return true;
  }

  // Authentication/Authorization failures that might indicate security issues
  if (error.statusCode === 403 && error.message && error.message.includes('admin')) {
    return true;
  }

  return false;
};

module.exports = {
  notifyCriticalError,
  isCriticalError,
};
