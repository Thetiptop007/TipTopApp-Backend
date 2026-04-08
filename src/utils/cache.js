const redis = require('redis');
const logger = require('./logger');

class RedisCache {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.hasLoggedConnectionError = false;
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    // Prevent multiple simultaneous connection attempts
    if (this.isConnecting || this.isConnected) {
      return;
    }
    
    this.isConnecting = true;
    try {
      
      this.client = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: false,
        },
      });

      this.client.on('error', (err) => {
        if (!this.hasLoggedConnectionError) {
          logger.warn(`Redis Client Error (non-fatal): ${err.message}`);
          this.hasLoggedConnectionError = true;
        }
        this.isConnected = false;
        // Prevent error from bubbling up and crashing the app
        if (this.client) {
          this.client.disconnect().catch(() => {});
          this.client = null;
        }
      });

      this.client.on('connect', () => {
        logger.info('Redis: Connecting...');
      });

      this.client.on('ready', () => {
        logger.info('Redis: Connected and ready');
        this.isConnected = true;
        this.hasLoggedConnectionError = false;
      });

      this.client.on('reconnecting', () => {
        logger.warn('Redis: Reconnecting...');
      });

      const connectPromise = this.client.connect();
      
      await Promise.race([
        connectPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout after 5s')), 5000)
        )
      ]);
      
      this.isConnecting = false;
    } catch (error) {
      logger.warn(`Redis connection failed - running without cache: ${error.message}`);
      this.isConnected = false;
      this.isConnecting = false;
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
        this.client = null;
      }
      // Don't throw - allow app to run without Redis
    }
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or null
   */
  async get(key) {
    if (!this.isConnected) return null;

    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (default: 1 hour)
   */
  async set(key, value, ttl = 3600) {
    if (!this.isConnected) return false;

    try {
      await this.client.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete key from cache
   * @param {string} key - Cache key
   */
  async del(key) {
    if (!this.isConnected) return false;

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   * @param {string} pattern - Key pattern (e.g., 'menu:*')
   */
  async delPattern(pattern) {
    if (!this.isConnected) return false;

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      logger.error(`Redis DEL pattern error for ${pattern}:`, error);
      return false;
    }
  }

  /**
   * Check if key exists
   * @param {string} key - Cache key
   */
  async exists(key) {
    if (!this.isConnected) return false;

    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Set expiry on a key
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   */
  async expire(key, ttl) {
    if (!this.isConnected) return false;

    try {
      await this.client.expire(key, ttl);
      return true;
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Increment a counter
   * @param {string} key - Counter key
   */
  async incr(key) {
    if (!this.isConnected) return null;

    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error(`Redis INCR error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Clear all cache
   */
  async flushAll() {
    if (!this.isConnected) return false;

    try {
      await this.client.flushAll();
      logger.info('Redis: Cache cleared');
      return true;
    } catch (error) {
      logger.error('Redis FLUSHALL error:', error);
      return false;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis: Disconnected');
    }
  }
}

// Export singleton instance
const cache = new RedisCache();

// Auto-connect to Redis (gracefully handle failures)
if (process.env.REDIS_URL) {
  setImmediate(() => {
    cache.connect().catch((err) => {
      logger.warn('Redis connection failed - app will run without caching');
    });
  });
} else {
  logger.info('Redis disabled - Set REDIS_URL to enable caching');
}
module.exports = cache;
