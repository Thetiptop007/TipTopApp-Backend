const logger = require('./logger');

/**
 * Simple In-Memory Cache System
 * - No external dependencies (no Redis needed)
 * - Automatic TTL expiration
 * - Low memory footprint
 * - Perfect for small to medium applications
 */
class InMemoryCache {
  constructor() {
    this.store = new Map(); // Main cache storage
    this.timers = new Map(); // TTL timers for automatic cleanup
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
    };
    
    // Cleanup old entries every 5 minutes to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    logger.info('In-Memory Cache: Initialized (cleanup every 5 minutes)');
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or null
   */
  async get(key) {
    if (!this.store.has(key)) {
      this.stats.misses++;
      return null;
    }

    const entry = this.store.get(key);

    // Check if entry has expired
    if (entry.expiry && Date.now() > entry.expiry) {
      this.store.delete(key);
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
      }
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.data;
  }

  /**
   * Set value in cache with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (default: 5 minutes)
   */
  async set(key, value, ttl = 300) {
    try {
      // Clear existing timer if key already exists
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
      }

      // Calculate expiry time
      const expiryTime = Date.now() + ttl * 1000;

      // Store the value with expiry metadata
      this.store.set(key, {
        data: value,
        expiry: expiryTime,
        createdAt: Date.now(),
      });

      // Set auto-cleanup timer
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl * 1000);

      this.timers.set(key, timer);
      this.stats.sets++;

      return true;
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete specific cache key
   * @param {string} key - Cache key
   */
  async del(key) {
    try {
      // Clear the timer
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
      }

      // Delete the cache entry
      this.store.delete(key);
      return true;
    } catch (error) {
      logger.error(`Cache DEL error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern (e.g., 'menu:*')
   * @param {string} pattern - Key pattern to match
   */
  async delPattern(pattern) {
    try {
      const regex = new RegExp(
        `^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`
      );

      let deletedCount = 0;

      for (const key of this.store.keys()) {
        if (regex.test(key)) {
          await this.del(key);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        logger.debug(`Cache: Deleted ${deletedCount} keys matching pattern ${pattern}`);
      }

      return true;
    } catch (error) {
      logger.error(`Cache DEL pattern error for ${pattern}:`, error);
      return false;
    }
  }

  /**
   * Check if key exists
   * @param {string} key - Cache key
   */
  async exists(key) {
    try {
      const cachedValue = await this.get(key);
      return cachedValue !== null;
    } catch (error) {
      logger.error(`Cache EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Set expiry on existing key
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   */
  async expire(key, ttl) {
    try {
      if (!this.store.has(key)) {
        return false;
      }

      const entry = this.store.get(key);
      const expiryTime = Date.now() + ttl * 1000;

      // Update expiry time
      entry.expiry = expiryTime;

      // Clear old timer and set new one
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
      }

      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl * 1000);

      this.timers.set(key, timer);

      return true;
    } catch (error) {
      logger.error(`Cache EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Increment a counter value
   * @param {string} key - Counter key
   */
  async incr(key) {
    try {
      const current = await this.get(key);
      const newValue = (current || 0) + 1;

      // Keep same TTL if it exists
      const entry = this.store.get(key);
      const ttl = entry ? Math.ceil((entry.expiry - Date.now()) / 1000) : 300;

      await this.set(key, newValue, Math.max(ttl, 1));

      return newValue;
    } catch (error) {
      logger.error(`Cache INCR error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Clear all cache
   */
  async flushAll() {
    try {
      // Clear all timers
      for (const timer of this.timers.values()) {
        clearTimeout(timer);
      }

      // Clear all cache entries
      this.store.clear();
      this.timers.clear();

      logger.info('Cache: All entries cleared');
      return true;
    } catch (error) {
      logger.error('Cache FLUSHALL error:', error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.store.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      hitRate:
        this.stats.hits + this.stats.misses > 0
          ? (
              (this.stats.hits /
                (this.stats.hits + this.stats.misses)) *
              100
            ).toFixed(2) + '%'
          : '0%',
    };
  }

  /**
   * Cleanup expired entries
   * Runs automatically every 5 minutes
   */
  cleanup() {
    let cleanedCount = 0;

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiry && Date.now() > entry.expiry) {
        this.store.delete(key);
        if (this.timers.has(key)) {
          clearTimeout(this.timers.get(key));
          this.timers.delete(key);
        }
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cache cleanup: Removed ${cleanedCount} expired entries`);
    }
  }

  /**
   * Gracefully shutdown cache
   */
  async disconnect() {
    clearInterval(this.cleanupInterval);

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.store.clear();
    this.timers.clear();

    logger.info('In-Memory Cache: Shutdown complete');
  }
}

// Export singleton instance
const cache = new InMemoryCache();

module.exports = cache;
