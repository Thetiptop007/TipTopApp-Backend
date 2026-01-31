const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Middleware to check if shop is open before allowing order operations
 * Prevents orders when shop is closed
 */
exports.checkShopOpen = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    
    if (!settings.shopStatus || !settings.shopStatus.isOpen) {
      const closureReason = settings.shopStatus?.closureReason || 'The shop is temporarily closed';
      
      logger.warn(`🚫 Order attempt blocked - Shop is closed. Reason: ${closureReason}`);
      
      return next(new AppError(`Shop is currently closed. ${closureReason}`, 503));
    }
    
    // Shop is open, proceed
    next();
  } catch (error) {
    logger.error('Error checking shop status:', error);
    // If error checking status, allow the request to proceed (fail-open approach)
    next();
  }
};
