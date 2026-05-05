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
        logger.system('SECURITY_REDIS_INIT_WARNING', 'redis package not installed', {}, { level: 'warn', severity: 'medium' });
        return null;
      }

      const client = redis.createClient({
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10),
        password: process.env.REDIS_PASSWORD || undefined,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.system('RATE_LIMIT_FALLBACK_MEMORY', 'Redis connection refused, using in-memory rate limiting', {}, { level: 'warn', severity: 'high' });
            return new Error('Redis unavailable');
          }
          return Math.min(options.attempt * 100, 3000);
        },
      });

      client.on('error', (err) => {
        logger.system('REDIS_ERROR', 'Redis error occurred', { errorMessage: err.message }, { level: 'error', severity: 'high' });
      });

      client.on('connect', () => {
        logger.system('RATE_LIMIT_BACKEND_SELECTED', 'Rate limiting backend selected', { backend: 'Redis' });
      });

      return new Promise((resolve) => {
        client.ping((err, reply) => {
          if (err) {
            logger.system('RATE_LIMIT_FALLBACK_MEMORY', 'Redis not available, using in-memory rate limiting', {}, { level: 'warn', severity: 'medium' });
            resolve(null);
          } else {
            logger.system('RATE_LIMIT_BACKEND_SELECTED', 'Redis rate limiting backend initialized');
            resolve(client);
          }
        });
      });
    }
  } catch (error) {
    logger.system('SECURITY_INIT_FAILED', 'Failed to initialize security layers', { errorMessage: error.message }, { level: 'error', severity: 'high' });
  }

  return null;
}

/**
 * Initialize all security layers
 */
async function initializeSecurityLayers() {
  if (securityInitialized) {
    return;
  }

  try {
    logger.system('SECURITY_INIT_START', 'Initializing security layers');

    // Try Redis
    redisClient = await initializeRedis();

    // Initialize stores
    const store = getOrCreateStore(redisClient);

    // Initialize all middleware with Redis
    ipRateLimit.initStore(redisClient);
    userRateLimit.initStore(redisClient);
    costBasedThrottle.initStore(redisClient);

    logger.system('SECURITY_INIT_COMPLETE', 'Security layers initialized', { backend: redisClient ? 'Redis' : 'In-Memory' });

    securityInitialized = true;
  } catch (error) {
    logger.system('SECURITY_INIT_FAILED', 'Failed to initialize security layers', { errorMessage: error.message }, { level: 'error', severity: 'high' });
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
        logger.system('REDIS_CONNECTION_CLOSED', 'Redis connection closed');
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
