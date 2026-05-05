const cache = require('../utils/cache');
const logger = require('../utils/logger');

const pendingResponses = new Map();
const SENSITIVE_ROUTE_PATTERNS = [
  '/api/v1/auth',
  '/api/v1/orders',
  '/api/v1/payments',
  '/api/v1/admin',
];

const IGNORED_CACHE_QUERY_PARAMS = new Set(['_t', 'timestamp', 'ts', 'cacheBust']);

const normalizeCacheKey = (req, keyPrefix) => {
  const sortedEntries = Object.entries(req.query || {})
    .filter(([key]) => !IGNORED_CACHE_QUERY_PARAMS.has(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const normalizedQuery = sortedEntries
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
    .join('&');

  const routePath = `${req.baseUrl || ''}${req.path || ''}`;
  const pathOnly = routePath || req.originalUrl.split('?')[0];
  return normalizedQuery
    ? `${keyPrefix}:${pathOnly}?${normalizedQuery}`
    : `${keyPrefix}:${pathOnly}`;
};

/**
 * Cache middleware factory
 * Caches GET requests based on URL and query parameters
 * @param {number} ttl - Time to live in seconds (default: 5 minutes)
 * @param {string} keyPrefix - Prefix for cache key
 */
const cacheMiddleware = (ttl = 300, keyPrefix = 'api') => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Safety guard: never cache sensitive or user-specific paths.
    if (SENSITIVE_ROUTE_PATTERNS.some((route) => req.originalUrl.startsWith(route))) {
      return next();
    }

    try {
      // Generate cache key from normalized URL/query params
      const cacheKey = normalizeCacheKey(req, keyPrefix);

      // Try to get cached response
      const cachedData = await cache.get(cacheKey);

      if (cachedData) {
        logger.system('CACHE_HIT', 'Cache hit', { cacheKey }, { level: 'debug' });
        return res.status(200).json(cachedData);
      }

      // Deduplicate concurrent identical requests while first response is in-flight.
      if (pendingResponses.has(cacheKey)) {
        const pendingData = await pendingResponses.get(cacheKey);
        if (pendingData) {
          logger.system('CACHE_IN_FLIGHT_HIT', 'Cache in-flight hit', { cacheKey }, { level: 'debug' });
          return res.status(200).json(pendingData);
        }
      }

      logger.system('CACHE_MISS', 'Cache miss', { cacheKey }, { level: 'debug' });

      let resolvePending;
      const pendingPromise = new Promise((resolve) => {
        resolvePending = resolve;
      });
      pendingResponses.set(cacheKey, pendingPromise);

      // Store original res.json
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response
      res.json = function (data) {
        // Only cache successful responses
        if (res.statusCode === 200) {
          cache.set(cacheKey, data, ttl).catch((err) => {
            logger.system('CACHE_SET_FAILED', 'Cache set failed', { cacheKey, errorMessage: err.message }, { level: 'error', severity: 'high' });
          });
        }
        resolvePending(data);
        pendingResponses.delete(cacheKey);
        return originalJson(data);
      };

      res.on('close', () => {
        if (pendingResponses.has(cacheKey)) {
          resolvePending(null);
          pendingResponses.delete(cacheKey);
        }
      });

      next();
    } catch (error) {
      logger.system('CACHE_MIDDLEWARE_ERROR', 'Cache middleware error', { errorMessage: error.message }, { level: 'error', severity: 'high' });
      next();
    }
  };
};

/**
 * Invalidate cache by pattern
 * @param {string} pattern - Pattern to match keys (e.g., 'menu:*')
 */
const invalidateCache = async (pattern) => {
  try {
    await cache.delPattern(pattern);
    logger.system('CACHE_INVALIDATED', 'Cache invalidated', { pattern }, { level: 'info' });
  } catch (error) {
    logger.system('CACHE_MIDDLEWARE_ERROR', 'Cache invalidation error', { errorMessage: error.message }, { level: 'error', severity: 'high' });
  }
};

/**
 * Invalidate specific cache key
 * @param {string} key - Cache key to invalidate
 */
const invalidateCacheKey = async (key) => {
  try {
    await cache.del(key);
    logger.system('CACHE_KEY_INVALIDATED', 'Cache key invalidated', { key }, { level: 'info' });
  } catch (error) {
    logger.system('CACHE_MIDDLEWARE_ERROR', 'Cache key invalidation error', { errorMessage: error.message }, { level: 'error', severity: 'high' });
  }
};

module.exports = {
  cacheMiddleware,
  invalidateCache,
  invalidateCacheKey,
};
