/**
 * Idempotency Middleware
 * Prevents duplicate requests by checking idempotency keys
 * Uses in-memory cache for request deduplication
 */

const cache = require('../utils/cache');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Check for idempotency key and prevent duplicate requests
 * @param {number} ttl - Time to live for idempotency key in seconds (default: 24 hours)
 */
const checkIdempotency = (ttl = 86400) => {
  return async (req, res, next) => {
    // Get idempotency key from header
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

    // If no idempotency key provided, allow request (backward compatibility)
    if (!idempotencyKey) {
      return next();
    }

    try {
      const cacheKey = `idempotency:${idempotencyKey}`;

      // Check if this request was already processed
      const cachedResponse = await cache.get(cacheKey);

      if (cachedResponse) {
        logger.system('IDEMPOTENCY_DUPLICATE_REQUEST', 'Duplicate request detected', { idempotencyKeySuffix: idempotencyKey ? idempotencyKey.slice(-6) : undefined });

        // Return the cached response
        return res.status(cachedResponse.statusCode || 200).json(cachedResponse.body);
      }

      // Check if request is currently being processed
      const processingKey = `${cacheKey}:processing`;
      const isProcessing = await cache.get(processingKey);

      if (isProcessing) {
        logger.system('IDEMPOTENCY_ALREADY_PROCESSING', 'Idempotency key is already being processed', { idempotencyKeySuffix: idempotencyKey ? idempotencyKey.slice(-6) : undefined }, { level: 'warn', severity: 'medium' });
        return next(new AppError('Request is already being processed. Please wait.', 409));
      }

      // Mark as processing (with short TTL of 30 seconds)
      await cache.set(processingKey, 'true', 30);

      // Store original response methods
      const originalJson = res.json;
      const originalSend = res.send;

      // Override response to cache it
      res.json = function (body) {
        // Cache the successful response
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const responseToCache = {
            statusCode: res.statusCode,
            body,
            timestamp: new Date().toISOString(),
          };

          cache
            .set(cacheKey, responseToCache, ttl)
            .catch((err) => logger.system('IDEMPOTENCY_CACHE_SET_FAILED', 'Failed to cache idempotent response', { errorMessage: err?.message || String(err) }, { level: 'error' }));

          // Remove processing flag
          cache.del(processingKey).catch((err) => logger.system('IDEMPOTENCY_CACHE_DEL_FAILED', 'Failed to remove processing flag', { errorMessage: err?.message || String(err) }, { level: 'error' }));
        }

        return originalJson.call(this, body);
      };

      res.send = function (body) {
        // Also handle send method
        if (res.statusCode >= 200 && res.statusCode < 300 && typeof body === 'string') {
          const responseToCache = {
            statusCode: res.statusCode,
            body,
            timestamp: new Date().toISOString(),
          };

          cache
            .set(cacheKey, responseToCache, ttl)
            .catch((err) => logger.system('IDEMPOTENCY_CACHE_SET_FAILED', 'Failed to cache idempotent response', { errorMessage: err?.message || String(err) }, { level: 'error' }));

          // Remove processing flag
          cache.del(processingKey).catch((err) => logger.system('IDEMPOTENCY_CACHE_DEL_FAILED', 'Failed to remove processing flag', { errorMessage: err?.message || String(err) }, { level: 'error' }));
        }

        return originalSend.call(this, body);
      };

      next();
    } catch (error) {
      logger.system('IDEMPOTENCY_ERROR', 'Idempotency middleware error', { errorMessage: error?.message || String(error) }, { level: 'error', severity: 'high' });
      // Don't block request if cache fails
      next();
    }
  };
};

/**
 * Generate a unique idempotency key based on user and request data
 */
const generateIdempotencyKey = (userId, operation, data) => {
  const crypto = require('crypto');
  const content = `${userId}:${operation}:${JSON.stringify(data)}`;
  return crypto.createHash('sha256').update(content).digest('hex');
};

module.exports = {
  checkIdempotency,
  generateIdempotencyKey,
};
