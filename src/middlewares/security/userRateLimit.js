/**
 * User-Based Rate Limiting Middleware
 * Protects against authenticated abuse per user
 */

const { getOrCreateStore } = require('../../services/security/rateLimit.store');
const { getRouteTier, ROUTE_TIERS } = require('../../services/security/routeTier.service');
const { logRateLimit, logCostAbuse } = require('../../services/security/securityLogger.service');
const logger = require('../../utils/logger');

let store = null;

function initStore(redisClient = null) {
  store = getOrCreateStore(redisClient);
}

/**
 * Per-user rate limiting
 * Authenticated users have separate rate limits
 */
function userRateLimit(options = {}) {
  const {
    windowMs = 60000,
  } = options;

  if (!store) {
    initStore();
  }

  return async (req, res, next) => {
    try {
      // Only apply to authenticated users
      if (!req.user || !req.user._id) return next();

      const userId = req.user._id.toString();
      const { config, tier } = getRouteTier(req.path);

      // Skip non-sensitive routes for authenticated users (more generous)
      if (tier === ROUTE_TIERS.PUBLIC_LIGHT) {
        return next();
      }

      const userKey = `user:${userId}:${req.path}`;
      const limit = tier === ROUTE_TIERS.ADMIN_SENSITIVE 
        ? Math.ceil(config.requestsPerMin * 0.5)  // Admins stricter
        : config.requestsPerMin;

      const result = await store.increment(userKey, limit, windowMs);

      if (result.isLimited) {
        logRateLimit(req, tier, result.count, limit, true);

        return res.status(429).json({
          status: 'fail',
          message: 'Too many requests. Please try again later.',
        });
      }

      // Log high usage for admin routes
      if (tier === ROUTE_TIERS.ADMIN_SENSITIVE && result.count > limit * 0.7) {
        logRateLimit(req, tier, result.count, limit, false);
      }

      next();
    } catch (error) {
      logger.security('RATE_LIMIT_TRIGGERED', 'User rate limit error', { errorMessage: error.message }, { level: 'error', severity: 'high' });
      next();
    }
  };
}

/**
 * Admin-specific rate limiting
 * Stricter limits for admin operations
 */
function adminRateLimit(options = {}) {
  const {
    windowMs = 60000,
  } = options;

  if (!store) {
    initStore();
  }

  return async (req, res, next) => {
    try {
      if (!req.user || req.user.role !== 'admin') return next();

      const adminKey = `admin:${req.user._id.toString()}:${req.path}`;
      
      // Admin operations are strict: 30 per minute for most, 5 for expensive
      const isExpensive = req.path.includes('dashboard/full') || 
                         req.path.includes('business-insights') ||
                         req.path.includes('developer');
      const limit = isExpensive ? 5 : 30;

      const result = await store.increment(adminKey, limit, windowMs);

      if (result.isLimited) {
        logger.security('ADMIN_RATE_LIMIT_TRIGGERED', 'Admin rate limit triggered', { userId: req.user._id.toString(), path: req.path, attempts: result.count }, { level: 'warn', severity: 'high' });

        return res.status(429).json({
          status: 'fail',
          message: 'Admin rate limit exceeded. Please try again later.',
        });
      }

      next();
    } catch (error) {
      logger.security('RATE_LIMIT_TRIGGERED', 'Admin rate limit error', { errorMessage: error.message }, { level: 'error', severity: 'high' });
      next();
    }
  };
}

module.exports = {
  userRateLimit,
  adminRateLimit,
  initStore: (redisClient) => { store = getOrCreateStore(redisClient); },
};
