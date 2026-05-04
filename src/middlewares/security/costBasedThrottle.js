/**
 * Session-Based & Cost-Based Rate Limiting
 * Protects against refresh abuse and expensive endpoint spam
 */

const { getOrCreateStore } = require('../../services/security/rateLimit.store');
const { getRequestCost, getRouteTier, ROUTE_TIERS } = require('../../services/security/routeTier.service');
const { logRefreshAbuse, logCostAbuse, logDistributedAbuse } = require('../../services/security/securityLogger.service');
const { getClientIp } = require('../../services/security/clientIp.service');
const logger = require('../../utils/logger');

let store = null;

function initStore(redisClient = null) {
  store = getOrCreateStore(redisClient);
}

/**
 * Refresh token abuse protection
 * Limits excessive token refresh attempts
 */
function refreshTokenRateLimit(options = {}) {
  const {
    windowMs = 15 * 60000,
    maxRefreshes = 30,
    rapidRefreshWindow = 5000,
    maxRapidRefreshes = 5,
  } = options;

  if (!store) {
    initStore();
  }

  return async (req, res, next) => {
    try {
      if (!req.user || !req.user._id) return next();

      const userId = req.user._id.toString();
      const sessionKey = `session:${userId}:${req.sessionID || req.ip}`;
      const rapidKey = `rapid-refresh:${userId}`;

      // Check for rapid consecutive refreshes
      const rapidResult = await store.increment(rapidKey, maxRapidRefreshes, rapidRefreshWindow);
      if (rapidResult.isLimited) {
        logRefreshAbuse(req, userId, sessionKey, 'rapid_refresh', rapidResult.count);

        await store.addAbuseScore(`abuse:${getClientIp(req)}`, 20);
        
        return res.status(429).json({
          status: 'fail',
          message: 'Token refresh rate exceeded. Please try again later.',
        });
      }

      // Check overall refresh quota
      const overallResult = await store.increment(sessionKey, maxRefreshes, windowMs);
      if (overallResult.isLimited) {
        logRefreshAbuse(req, userId, sessionKey, 'excessive_refresh', overallResult.count);

        await store.addAbuseScore(`abuse:${getClientIp(req)}`, 10);

        return res.status(429).json({
          status: 'fail',
          message: 'Too many token refreshes. Please log in again.',
        });
      }

      next();
    } catch (error) {
      logger.error('Refresh token rate limit error:', error.message);
      next();
    }
  };
}

/**
 * Cost-based throttling
 * Budget-based rate limiting where expensive operations cost more
 */
function costBasedThrottle(options = {}) {
  const {
    windowMs = 60000,
    baseBudget = 100,
  } = options;

  if (!store) {
    initStore();
  }

  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const cost = getRequestCost(req.path, req.method);
      const budgetKey = `cost:${ip}:budget`;

      // Get current budget
      let budget = baseBudget;
      if (store.useRedis) {
        const stored = await store.redis?.get(budgetKey);
        if (stored) {
          budget = parseInt(stored, 10);
        }
      }

      // Check if request would exceed budget
      if (cost > budget) {
        const { config } = getRouteTier(req.path);
        logCostAbuse(req, req.user?._id?.toString() || null, cost, budget, 'budget_exceeded');

        return res.status(429).json({
          status: 'fail',
          message: 'Too many expensive requests. Please try again later.',
        });
      }

      // Deduct cost from budget
      const newBudget = budget - cost;
      if (store.useRedis) {
        await store.redis?.setex(budgetKey, Math.ceil(windowMs / 1000), newBudget.toString());
      }

      // Attach remaining budget to response
      res.setHeader('X-Cost-Budget-Remaining', Math.max(0, newBudget));
      res.setHeader('X-Request-Cost', cost.toString());

      next();
    } catch (error) {
      logger.error('Cost-based throttle error:', error.message);
      next();
    }
  };
}

/**
 * Distributed abuse detection
 * Track cross-endpoint abuse patterns
 */
function detectDistributedAbuse(options = {}) {
  const {
    scoreThreshold = 150,
    endpointThreshold = 5,
    windowMs = 60000,
  } = options;

  if (!store) {
    initStore();
  }

  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const abuseKey = `abuse:${ip}`;
      
      // Get current abuse score
      const score = await store.getAbuseScore(abuseKey);

      if (score > scoreThreshold) {
        // Track affected endpoints
        const endpointKey = `endpoints:${ip}`;
        let endpoints = [];
        
        if (store.useRedis) {
          const data = await store.redis?.get(endpointKey);
          if (data) {
            endpoints = JSON.parse(data);
          }
        }

        if (!endpoints.includes(req.path)) {
          endpoints.push(req.path);
        }

        // Check if distributed across many endpoints
        if (endpoints.length >= endpointThreshold) {
          logDistributedAbuse(ip, score, endpoints.length, endpoints);

          // Apply temporary ban
          await store.addBan(`dist-abuse:${ip}`, 30 * 60000, 'Distributed abuse detected');

          return res.status(429).json({
            status: 'fail',
            message: 'Temporarily unavailable.',
          });
        }

        // Update endpoint list
        if (store.useRedis) {
          await store.redis?.setex(endpointKey, Math.ceil(windowMs / 1000), JSON.stringify(endpoints));
        }
      }

      next();
    } catch (error) {
      logger.error('Distributed abuse detection error:', error.message);
      next();
    }
  };
}

module.exports = {
  refreshTokenRateLimit,
  costBasedThrottle,
  detectDistributedAbuse,
  initStore: (redisClient) => { store = getOrCreateStore(redisClient); },
};
