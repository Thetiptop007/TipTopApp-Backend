/**
 * Security Infrastructure Initializer
 * Sets up Redis, rate limit stores, and initializes all security middleware
 */

const logger = require('../utils/logger');
const { getOrCreateStore } = require('./security/rateLimit.store');
const ipRateLimit = require('../middlewares/security/ipRateLimit');
const userRateLimit = require('../middlewares/security/userRateLimit');
const costBasedThrottle = require('../middlewares/security/costBasedThrottle');

let redisClient = null;
let securityInitialized = false;

/**
 * Try to initialize Redis connection
 */
async function initializeRedis() {
  try {
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
      // Import redis client
      let redis;
      try {
        redis = require('redis');
      } catch (e) {
        logger.warn('redis package not installed. Using in-memory rate limiting.');
        return null;
      }

      const client = redis.createClient({
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10),
        password: process.env.REDIS_PASSWORD || undefined,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis connection refused. Falling back to in-memory.');
            return new Error('Redis unavailable');
          }
          return Math.min(options.attempt * 100, 3000);
        },
      });

      client.on('error', (err) => {
        logger.error('Redis error:', err.message);
      });

      client.on('connect', () => {
        logger.info('[SECURITY] Redis connected for layered rate limiting');
      });

      return new Promise((resolve) => {
        client.ping((err, reply) => {
          if (err) {
            logger.warn('Redis not available, using in-memory rate limiting');
            resolve(null);
          } else {
            logger.info('[SECURITY] Redis ping successful');
            resolve(client);
          }
        });
      });
    }
  } catch (error) {
    logger.warn('Redis initialization failed:', error.message);
  }

  return null;
}

/**
 * Initialize all security layers
 */
async function initializeSecurityLayers() {
  if (securityInitialized) {
    logger.debug('Security layers already initialized');
    return;
  }

  try {
    logger.info('[SECURITY] Initializing layered abuse protection system...');

    // Try Redis
    redisClient = await initializeRedis();

    // Initialize stores
    const store = getOrCreateStore(redisClient);

    // Initialize all middleware with Redis
    ipRateLimit.initStore(redisClient);
    userRateLimit.initStore(redisClient);
    costBasedThrottle.initStore(redisClient);

    logger.info('[SECURITY] Layered abuse protection system initialized');
    logger.info(`[SECURITY] Backend: ${redisClient ? 'Redis' : 'In-Memory'}`);

    securityInitialized = true;
  } catch (error) {
    logger.error('[SECURITY] Failed to initialize security layers:', error.message);
    // Continue with in-memory fallback
    securityInitialized = true;
  }
}

/**
 * Get security middleware stack for mounting
 */
function getSecurityMiddlewareStack() {
  return [
    // IP-based rate limiting (first line of defense)
    ipRateLimit.ipRateLimit({
      windowMs: 60000,
    }),

    // Distributed abuse detection
    costBasedThrottle.detectDistributedAbuse({
      scoreThreshold: 150,
      endpointThreshold: 5,
    }),

    // Cost-based throttling for expensive operations
    costBasedThrottle.costBasedThrottle({
      windowMs: 60000,
      baseBudget: 100,
    }),

    // User-based limiting (for authenticated users)
    userRateLimit.userRateLimit({
      windowMs: 60000,
    }),

    // Admin-specific limits
    userRateLimit.adminRateLimit({
      windowMs: 60000,
    }),
  ];
}

/**
 * Get auth-specific middleware
 */
function getAuthSecurityMiddleware() {
  return [
    // Brute force protection
    ipRateLimit.authBruteForceLimiter({
      windowMs: 15 * 60000,
      maxAttempts: 8,
    }),
  ];
}

/**
 * Get refresh-specific middleware
 */
function getRefreshSecurityMiddleware() {
  return [
    // Refresh token abuse protection
    costBasedThrottle.refreshTokenRateLimit({
      windowMs: 15 * 60000,
      maxRefreshes: 30,
      rapidRefreshWindow: 5000,
      maxRapidRefreshes: 5,
    }),
  ];
}

/**
 * Shutdown security infrastructure
 */
async function shutdownSecurity() {
  if (redisClient) {
    return new Promise((resolve) => {
      redisClient.quit(() => {
        logger.info('[SECURITY] Redis connection closed');
        resolve();
      });
    });
  }
}

module.exports = {
  initializeSecurityLayers,
  initializeRedis,
  getSecurityMiddlewareStack,
  getAuthSecurityMiddleware,
  getRefreshSecurityMiddleware,
  shutdownSecurity,
};
