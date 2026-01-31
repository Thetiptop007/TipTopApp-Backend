/**
 * Request Deduplication Middleware
 * Prevents processing duplicate requests within a short time window
 */

const redis = require('../config/redis');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Deduplicate requests based on user, method, path, and body
 * @param {number} windowSeconds - Time window to check for duplicates (default: 5 seconds)
 */
const deduplicateRequest = (windowSeconds = 5) => {
  return async (req, res, next) => {
    try {
      // Generate request fingerprint
      const fingerprint = generateRequestFingerprint(req);
      const dedupeKey = `dedupe:${fingerprint}`;

      // Check if identical request was made recently
      const exists = await redis.get(dedupeKey);

      if (exists) {
        logger.warn(`🚫 Duplicate request blocked: ${req.method} ${req.path}`);
        logger.warn(`   User: ${req.user?._id || 'anonymous'}`);
        logger.warn(`   Fingerprint: ${fingerprint}`);
        
        return res.status(429).json({
          status: 'error',
          message: 'Duplicate request detected. Please wait before retrying.',
          code: 'DUPLICATE_REQUEST',
        });
      }

      // Mark this request as processed
      await redis.setex(dedupeKey, windowSeconds, Date.now().toString());

      next();
    } catch (error) {
      logger.error('Request deduplication error:', error);
      // Don't block request if Redis fails
      next();
    }
  };
};

/**
 * Generate unique fingerprint for a request
 */
function generateRequestFingerprint(req) {
  const userId = req.user?._id?.toString() || 'anonymous';
  const method = req.method;
  const path = req.path;
  
  // For POST/PUT/PATCH, include body in fingerprint
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(req.body) : '';
  
  const content = `${userId}:${method}:${path}:${body}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

module.exports = {
  deduplicateRequest,
};
