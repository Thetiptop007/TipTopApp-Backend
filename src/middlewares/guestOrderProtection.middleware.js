const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const isDevelopment = process.env.NODE_ENV === 'development';

const GUEST_LIMIT_WINDOW_MS = Number(process.env.GUEST_ORDER_LIMIT_WINDOW_MS || 60 * 1000);
const GUEST_LIMIT_MAX = Number(process.env.GUEST_ORDER_LIMIT_MAX || 5);
const GUEST_COOLDOWN_MS = Number(process.env.GUEST_ORDER_COOLDOWN_MS || 15 * 1000);

const deviceCooldownMap = new Map();

const getDeviceKey = (req) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown-ip';
  const userAgent = req.headers['user-agent'] || 'unknown-agent';
  return `${ip}:${userAgent}`;
};

const guestOrderLimiter = rateLimit({
  windowMs: GUEST_LIMIT_WINDOW_MS,
  max: GUEST_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    if (isDevelopment) {
      logger.warn(`[GuestProtection] Rate limit blocked guest order from IP=${req.ip}`);
    }

    return res.status(429).json({
      status: 'fail',
      message: 'Too many guest order attempts. Please try again later.',
    });
  },
});

const guestOrderCooldown = (req, res, next) => {
  const now = Date.now();
  const key = getDeviceKey(req);
  const lastAttemptAt = deviceCooldownMap.get(key);

  if (lastAttemptAt && now - lastAttemptAt < GUEST_COOLDOWN_MS) {
    if (isDevelopment) {
      const waitMs = GUEST_COOLDOWN_MS - (now - lastAttemptAt);
      logger.warn(`[GuestProtection] Cooldown blocked key=${key}, remainingMs=${waitMs}`);
    }

    return res.status(429).json({
      status: 'fail',
      message: 'Please wait a few seconds before placing another order.',
    });
  }

  deviceCooldownMap.set(key, now);

  // Soft cleanup to avoid unbounded memory growth.
  if (deviceCooldownMap.size > 5000) {
    const cutoff = now - Math.max(GUEST_COOLDOWN_MS * 5, 60 * 1000);
    for (const [deviceKey, timestamp] of deviceCooldownMap.entries()) {
      if (timestamp < cutoff) {
        deviceCooldownMap.delete(deviceKey);
      }
    }
  }

  if (isDevelopment) {
    logger.info(`[GuestProtection] Cooldown passed key=${key}`);
  }

  next();
};

const checkGuestHoneypot = (req, res, next) => {
  const honeypotValue = req.body?.hiddenField || req.body?.honeypot || req.body?.website;

  if (honeypotValue) {
    if (isDevelopment) {
      logger.warn(`[GuestProtection] Honeypot blocked guest order from IP=${req.ip}`);
    }

    return res.status(400).json({
      status: 'fail',
      message: 'Invalid request.',
    });
  }

  if (isDevelopment) {
    logger.info('[GuestProtection] Honeypot passed');
  }

  next();
};

module.exports = {
  guestOrderLimiter,
  guestOrderCooldown,
  checkGuestHoneypot,
};
