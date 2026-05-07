/**
 * Simple in-memory session cache with TTL
 * NO Redis required - uses Node.js Map for fast O(1) lookups
 * 
 * Purpose: Avoid repeated DB queries for user/session validation within TTL window
 * TTL Strategy: 30 seconds for development, 15 seconds for production
 * 
 * This reduces load on:
 * - MongoDB session lookups
 * - JWT verification on subsequent requests
 * - Role validation lookups
 */

class SessionCache {
  constructor() {
    this.cache = new Map();
    this.ttl = process.env.NODE_ENV === 'production' ? 15 * 1000 : 30 * 1000; // 15s prod, 30s dev
    this.cleanupInterval = setInterval(() => this._cleanup(), 60 * 1000); // Cleanup every 60s
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Get cached session (returns null if expired)
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set session in cache
   */
  set(key, data) {
    if (!key || !data) return;
    
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttl,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Remove specific key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  stats() {
    let expired = 0;
    let valid = 0;

    for (const [, entry] of this.cache) {
      if (Date.now() > entry.expiresAt) {
        expired++;
      } else {
        valid++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries: valid,
      expiredEntries: expired,
      ttlMs: this.ttl,
    };
  }

  /**
   * Cleanup expired entries (runs periodically)
   */
  _cleanup() {
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0 && process.env.NODE_ENV === 'development') {
      // Silently clean in production, log in dev for monitoring
      console.log(`[SessionCache] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Destroy cache and cleanup interval
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}

// Export singleton instance
module.exports = new SessionCache();
