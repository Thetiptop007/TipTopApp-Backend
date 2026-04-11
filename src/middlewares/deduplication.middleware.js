/**
 * Request Deduplication Middleware
 * Prevents processing duplicate requests within a short time window
 * Uses in-memory cache for fast deduplication
 */

const cache = require('../utils/cache');
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
      const exists = await cache.get(dedupeKey);

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
      await cache.set(dedupeKey, Date.now().toString(), windowSeconds);

      next();
    } catch (error) {
      logger.error('Request deduplication error:', error);
      // Don't block request if cache fails
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
