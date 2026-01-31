/**
 * Redis Configuration
 * Handles Redis connection for caching and request deduplication
 */

const logger = require('../utils/logger');

// Simple in-memory fallback if Redis is not available
class InMemoryCache {
  constructor() {
    this.cache = new Map();
    this.expirations = new Map();
  }

  async get(key) {
    // Check if key has expired
    if (this.expirations.has(key)) {
      const expiration = this.expirations.get(key);
      if (Date.now() > expiration) {
        this.cache.delete(key);
        this.expirations.delete(key);
        return null;
      }
    }
    return this.cache.get(key) || null;
  }

  async setex(key, seconds, value) {
    this.cache.set(key, value);
    this.expirations.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async set(key, value) {
    this.cache.set(key, value);
    return 'OK';
  }

  async del(key) {
    this.cache.delete(key);
    this.expirations.delete(key);
    return 1;
  }

  async exists(key) {
    return this.cache.has(key) ? 1 : 0;
  }

  // Cleanup expired keys periodically
  cleanup() {
    const now = Date.now();
    for (const [key, expiration] of this.expirations.entries()) {
      if (now > expiration) {
        this.cache.delete(key);
        this.expirations.delete(key);
      }
    }
  }
}

let redisClient;

// Try to use Redis, fallback to in-memory cache
try {
  const redis = require('redis');
  
  if (!redis || typeof redis.createClient !== 'function') {
    throw new Error('Redis module not properly loaded');
  }
  
  redisClient = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retry_strategy: (options) => {
      if (options.attempt > 3) {
        logger.warn('Redis connection failed after 3 attempts, using in-memory cache');
        return undefined; // Stop retrying
      }
      return Math.min(options.attempt * 100, 3000);
    },
  });

  redisClient.on('error', (err) => {
    logger.error('Redis Client Error:', err.message);
  });

  redisClient.on('connect', () => {
    logger.info('✅ Redis connected successfully');
  });

  // Promisify Redis methods
  const { promisify } = require('util');
  
  if (typeof redisClient.get !== 'function') {
    throw new Error('Redis client methods not available');
  }
  
  const getAsync = promisify(redisClient.get).bind(redisClient);
  const setAsync = promisify(redisClient.set).bind(redisClient);
  const setexAsync = promisify(redisClient.setex).bind(redisClient);
  const delAsync = promisify(redisClient.del).bind(redisClient);
  const existsAsync = promisify(redisClient.exists).bind(redisClient);

  module.exports = {
    get: getAsync,
    set: setAsync,
    setex: setexAsync,
    del: delAsync,
    exists: existsAsync,
    client: redisClient,
  };
} catch (error) {
  logger.warn('Redis not available, using in-memory cache');
  logger.warn(error.message);
  
  // Use in-memory cache as fallback
  const memoryCache = new InMemoryCache();
  
  // Cleanup expired keys every minute
  setInterval(() => memoryCache.cleanup(), 60000);
  
  module.exports = {
    get: memoryCache.get.bind(memoryCache),
    set: memoryCache.set.bind(memoryCache),
    setex: memoryCache.setex.bind(memoryCache),
    del: memoryCache.del.bind(memoryCache),
    exists: memoryCache.exists.bind(memoryCache),
    client: memoryCache,
  };
}
