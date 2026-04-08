/**
 * Redis Configuration
 * Provides a Redis-backed cache when available and a safe in-memory fallback otherwise.
 */

const redis = require('redis');
const logger = require('../utils/logger');

class InMemoryCache {
  constructor() {
    this.cache = new Map();
    this.expirations = new Map();
  }

  async get(key) {
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

  async set(key, value) {
    this.cache.set(key, value);
    return 'OK';
  }

  async setex(key, seconds, value) {
    this.cache.set(key, value);
    this.expirations.set(key, Date.now() + seconds * 1000);
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

  async delPattern(pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let deleted = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.expirations.delete(key);
        deleted += 1;
      }
    }

    return deleted;
  }

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

class RedisCache {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.fallback = new InMemoryCache();
  }

  async connect() {
    if (this.isConnected || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      if (!process.env.REDIS_URL) {
        throw new Error('REDIS_URL is not set');
      }

      this.client = redis.createClient({
        url: process.env.REDIS_URL,
      });

      this.client.on('error', (err) => {
        logger.warn('Redis Client Error (non-fatal):', err.message);
        this.isConnected = false;
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('✅ Redis connected successfully');
      });

      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      logger.warn('Redis not available, using in-memory cache');
      logger.warn(error.message);
      this.isConnected = false;

      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (disconnectError) {
          // Ignore disconnect errors.
        }
      }

      this.client = null;
    } finally {
      this.isConnecting = false;
    }
  }

  async get(key) {
    if (!this.isConnected) {
      return this.fallback.get(key);
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return this.fallback.get(key);
    }
  }

  async set(key, value) {
    if (!this.isConnected) {
      return this.fallback.set(key, value);
    }

    try {
      return await this.client.set(key, value);
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      return this.fallback.set(key, value);
    }
  }

  async setex(key, seconds, value) {
    if (!this.isConnected) {
      return this.fallback.setex(key, seconds, value);
    }

    try {
      return await this.client.setEx(key, seconds, value);
    } catch (error) {
      logger.error(`Redis SETEX error for key ${key}:`, error);
      return this.fallback.setex(key, seconds, value);
    }
  }

  async del(key) {
    if (!this.isConnected) {
      return this.fallback.del(key);
    }

    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      return this.fallback.del(key);
    }
  }

  async exists(key) {
    if (!this.isConnected) {
      return this.fallback.exists(key);
    }

    try {
      return await this.client.exists(key);
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      return this.fallback.exists(key);
    }
  }

  async delPattern(pattern) {
    if (!this.isConnected) {
      return this.fallback.delPattern(pattern);
    }

    try {
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        return this.client.del(keys);
      }

      return 0;
    } catch (error) {
      logger.error(`Redis DEL pattern error for ${pattern}:`, error);
      return this.fallback.delPattern(pattern);
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis: Disconnected');
    }
  }
}

const cache = new RedisCache();

if (process.env.REDIS_URL) {
  setImmediate(() => {
    cache.connect().catch(() => {
      logger.warn('Redis connection failed - app will run without caching');
    });
  });
} else {
  logger.info('Redis disabled - Set REDIS_URL to enable caching');
}

module.exports = cache;