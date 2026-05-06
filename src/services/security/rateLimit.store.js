/**
 * Layered Rate Limit Store
 * Redis-backed for multi-instance environments
 * Falls back to in-memory for development
 * 
 * Supports:
 * - Sliding window counters
 * - Distributed rate limits
 * - Abuse scoring
 * - Temporary bans
 */

const logger = require('../../utils/logger');

class RateLimitStore {
  constructor(redisClient = null) {
    this.redis = redisClient;
    this.useRedis = !!redisClient;
    
    // In-memory fallback
    this.memory = {
      counters: new Map(),      // key -> { count, expiry }
      abuse: new Map(),         // userId/ip -> abuse score
      bans: new Map(),          // ip/userId/sessionId -> { until, reason }
    };

    if (!this.useRedis) {
      logger.system('RATE_LIMIT_FALLBACK_MEMORY', 'Using in-memory rate limiting (not recommended for production)', {}, { level: 'warn', severity: 'high' });
      this._startMemoryCleanup();
    } else {
      logger.system('RATE_LIMIT_BACKEND_SELECTED', 'Using Redis-backed rate limiting', { backend: 'Redis' });
    }
  }

  _startMemoryCleanup() {
    // Clean up expired entries every 5 minutes
    this.memoryCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.memory.counters.entries()) {
        if (data.expiry < now) {
          this.memory.counters.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  shutdown() {
    if (this.memoryCleanupInterval) {
      clearInterval(this.memoryCleanupInterval);
      this.memoryCleanupInterval = null;
    }
  }

  /**
   * Increment a rate limit counter
   * Returns { count, limit, remaining, resetAt, isLimited }
   */
  async increment(key, limit, windowMs) {
    if (this.useRedis) {
      return this._incrementRedis(key, limit, windowMs);
    }
    return this._incrementMemory(key, limit, windowMs);
  }

  async _incrementRedis(key, limit, windowMs) {
    try {
      const now = Date.now();
      const resetAt = now + windowMs;
      const rateKey = `rl:${key}`;
      
      // Use Redis INCR with expiry
      const count = await this.redis.incr(rateKey);
      
      // Set expiry on first request
      if (count === 1) {
        await this.redis.pexpire(rateKey, windowMs);
      }

      const remaining = Math.max(0, limit - count);
      
      return {
        count,
        limit,
        remaining,
        resetAt,
        isLimited: count > limit,
      };
    } catch (error) {
      logger.error('Redis rate limit increment error:', error.message);
      return { count: 0, limit, remaining: limit, resetAt: 0, isLimited: false };
    }
  }

  async _incrementMemory(key, limit, windowMs) {
    const now = Date.now();
    const entry = this.memory.counters.get(key);
    
    let count = 1;
    let resetAt = now + windowMs;
    
    if (entry && entry.expiry > now) {
      count = entry.count + 1;
      resetAt = entry.resetAt;
    } else {
      this.memory.counters.set(key, { count: 1, expiry: now + windowMs, resetAt });
    }

    const remaining = Math.max(0, limit - count);
    
    if (count === 1) {
      this.memory.counters.set(key, { count, expiry: now + windowMs, resetAt });
    } else {
      const entry = this.memory.counters.get(key);
      entry.count = count;
    }

    return {
      count,
      limit,
      remaining,
      resetAt,
      isLimited: count > limit,
    };
  }

  /**
   * Check if client is temporarily banned
   */
  async checkBan(identifier) {
    if (this.useRedis) {
      try {
        const banData = await this.redis.get(`ban:${identifier}`);
        if (banData) {
          const ban = JSON.parse(banData);
          if (ban.until > Date.now()) {
            return ban;
          }
          await this.redis.del(`ban:${identifier}`);
        }
      } catch (error) {
        logger.error('Redis ban check error:', error.message);
      }
    } else {
      const ban = this.memory.bans.get(identifier);
      if (ban && ban.until > Date.now()) {
        return ban;
      }
      if (ban) {
        this.memory.bans.delete(identifier);
      }
    }
    return null;
  }

  /**
   * Add temporary ban
   */
  async addBan(identifier, durationMs, reason = 'Temporary ban') {
    const ban = {
      identifier,
      until: Date.now() + durationMs,
      reason,
      bannedAt: Date.now(),
    };

    if (this.useRedis) {
      try {
        await this.redis.setex(`ban:${identifier}`, Math.ceil(durationMs / 1000), JSON.stringify(ban));
      } catch (error) {
        logger.error('Redis ban set error:', error.message);
      }
    } else {
      this.memory.bans.set(identifier, ban);
    }

    logger.warn(`[SECURITY_ENFORCEMENT] Temporary ban: ${identifier} reason=${reason} durationMs=${durationMs}`);
    return ban;
  }

  /**
   * Remove ban
   */
  async removeBan(identifier) {
    if (this.useRedis) {
      try {
        await this.redis.del(`ban:${identifier}`);
      } catch (error) {
        logger.error('Redis ban delete error:', error.message);
      }
    } else {
      this.memory.bans.delete(identifier);
    }
  }

  /**
   * Add abuse score (for distributed abuse detection)
   */
  async addAbuseScore(identifier, score) {
    const key = `abuse:${identifier}`;
    
    if (this.useRedis) {
      try {
        const current = await this.redis.incrby(key, Math.round(score));
        // Reset score after 1 hour
        await this.redis.expire(key, 3600);
        return current;
      } catch (error) {
        logger.error('Redis abuse score error:', error.message);
        return 0;
      }
    } else {
      const entry = this.memory.abuse.get(key) || { score: 0, expiry: Date.now() + 3600000 };
      entry.score += score;
      this.memory.abuse.set(key, entry);
      return entry.score;
    }
  }

  /**
   * Get abuse score
   */
  async getAbuseScore(identifier) {
    const key = `abuse:${identifier}`;
    
    if (this.useRedis) {
      try {
        const score = await this.redis.get(key);
        return parseInt(score || '0', 10);
      } catch (error) {
        logger.error('Redis abuse score get error:', error.message);
        return 0;
      }
    } else {
      const entry = this.memory.abuse.get(key);
      if (entry && entry.expiry > Date.now()) {
        return entry.score;
      }
      if (entry) {
        this.memory.abuse.delete(key);
      }
      return 0;
    }
  }

  /**
   * Reset counters for key (admin use)
   */
  async reset(key) {
    if (this.useRedis) {
      try {
        await this.redis.del(`rl:${key}`);
      } catch (error) {
        logger.error('Redis reset error:', error.message);
      }
    } else {
      this.memory.counters.delete(key);
    }
  }

  /**
   * Get store health info
   */
  async getHealthInfo() {
    if (this.useRedis) {
      try {
        const info = await this.redis.info('memory');
        return { backend: 'redis', info };
      } catch (error) {
        return { backend: 'redis', error: error.message };
      }
    }
    return {
      backend: 'memory',
      counters: this.memory.counters.size,
      bans: this.memory.bans.size,
      abuseScores: this.memory.abuse.size,
    };
  }
}

// Singleton instance
let storeInstance = null;

function getOrCreateStore(redisClient = null) {
  if (!storeInstance) {
    storeInstance = new RateLimitStore(redisClient);
  }
  return storeInstance;
}

function resetStoreForTests() {
  if (storeInstance && typeof storeInstance.shutdown === 'function') {
    storeInstance.shutdown();
  }
  storeInstance = null;
}

module.exports = {
  RateLimitStore,
  getOrCreateStore,
  resetStoreForTests,
};
