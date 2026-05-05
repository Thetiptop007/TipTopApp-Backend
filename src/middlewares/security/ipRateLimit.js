/**
 * IP-Based Rate Limiting Middleware
 * First line of defense against distributed abuse
 */

const { getClientIp } = require('../../services/security/clientIp.service');
const { getOrCreateStore } = require('../../services/security/rateLimit.store');
const { getRouteTier, getRequestCost } = require('../../services/security/routeTier.service');
const { logRateLimit, logTemporaryBan } = require('../../services/security/securityLogger.service');
const logger = require('../../utils/logger');

let store = null;

function initStore(redisClient = null) {
  store = getOrCreateStore(redisClient);
}

/**
 * IP rate limit middleware
 * Per-IP request budget with progressive enforcement
 */
function ipRateLimit(options = {}) {
  const {
    windowMs = 60000,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    onLimitReached = null,
  } = options;

  if (!store) {
    initStore();
  }

  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      if (!ip) return next();

      const { config } = getRouteTier(req.path);
      const limit = Math.ceil(config.requestsPerMin);
      const cost = getRequestCost(req.path, req.method);
      const rateLimitKey = `ip:${ip}:${req.path}`;

      // Check if IP is temporarily banned
      const ban = await store.checkBan(`ip-ban:${ip}`);
      if (ban) {
        logTemporaryBan(ip, 'ip', ban.until - Date.now(), ban.reason);
        return res.status(429).json({
          status: 'fail',
          message: 'Temporarily unavailable. Please try again later.',
        });
      }

      // Increment counter
      const result = await store.increment(rateLimitKey, limit, windowMs);
      
      // Track weighted cost if multi-request
      const costKey = `cost:${ip}`;
      const costResult = await store.increment(costKey, limit * 2, windowMs);

      // Set rate limit headers
      res.setHeader('RateLimit-Limit', limit);
      res.setHeader('RateLimit-Remaining', Math.max(0, result.remaining));
      res.setHeader('RateLimit-Reset', Math.ceil(result.resetAt / 1000));

      // Log at high usage
      if (result.count > limit * 0.8) {
        logRateLimit(req, config.tier || 'PUBLIC_MEDIUM', result.count, limit, false);
      }

      // Block if over limit
      if (result.isLimited) {
        logRateLimit(req, config.tier || 'PUBLIC_MEDIUM', result.count, limit, true);

        // Progressive enforcement: temp ban on repeated abuse
        const abuseScore = await store.getAbuseScore(`abuse:${ip}`);
        if (abuseScore > 100) {
          // Heavy abuse detected, temporary ban
          await store.addBan(`ip-ban:${ip}`, 15 * 60000, 'Repeated rate limit violations');
          return res.status(429).json({
            status: 'fail',
            message: 'Too many requests. Account temporarily restricted.',
          });
        }

        if (onLimitReached) {
          onLimitReached(req, res);
        }

        return res.status(429).json({
          status: 'fail',
          message: 'Too many requests. Please try again later.',
        });
      }

      // Add abuse score for future distributed detection
      if (result.count > limit * 0.5) {
        await store.addAbuseScore(ip, 1);
      }

      next();
    } catch (error) {
      logger.security('RATE_LIMIT_TRIGGERED', 'IP rate limit error', { errorMessage: error.message }, { level: 'error', severity: 'high' });
      next();
    }
  };
}

/**
 * Auth-specific IP rate limit
 * Combined IP + identifier (email/phone) limiting
 */
function authBruteForceLimiter(options = {}) {
  const {
    windowMs = 15 * 60000,
    maxAttempts = 8,
  } = options;

  if (!store) {
    initStore();
  }

  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const identifier = req.body?.email || req.body?.phone || 'unknown';
      
      if (!ip || !identifier) return next();

      // Check combined IP + identifier limit
      const bruteKey = `brute:${ip}:${identifier}`;
      const result = await store.increment(bruteKey, maxAttempts, windowMs);

      if (result.isLimited) {
        logger.security('BRUTE_FORCE_ATTEMPT', 'Brute force attempt blocked', { ip, identifier, attempts: result.count }, { level: 'warn', severity: 'high' });

        // Add significant abuse score
        await store.addAbuseScore(`abuse:${ip}`, 50);

        // Temp ban after repeated abuse
        const abuseScore = await store.getAbuseScore(`abuse:${ip}`);
        if (abuseScore > 150) {
          await store.addBan(`ip-ban:${ip}`, 30 * 60000, 'Brute force attack detected');
          return res.status(429).json({
            status: 'fail',
            message: 'Too many login attempts. Please try again later.',
          });
        }

        return res.status(429).json({
          status: 'fail',
          message: 'Too many login attempts. Please try again later.',
        });
      }

      // Track failed attempts
      res.on('finish', () => {
        if (res.statusCode === 401 || res.statusCode === 400) {
          store.addAbuseScore(`abuse:${ip}`, 5);
        }
      });

      next();
    } catch (error) {
      logger.security('RATE_LIMIT_TRIGGERED', 'Auth brute force limiter error', { errorMessage: error.message }, { level: 'error', severity: 'high' });
      next();
    }
  };
}

module.exports = {
  ipRateLimit,
  authBruteForceLimiter,
  initStore: (redisClient) => { store = getOrCreateStore(redisClient); },
};
