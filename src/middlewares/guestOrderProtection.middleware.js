const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const isDevelopment = process.env.NODE_ENV === 'development';

const GUEST_LIMIT_WINDOW_MS = Number(process.env.GUEST_ORDER_LIMIT_WINDOW_MS || 60 * 1000);
const GUEST_LIMIT_MAX = Number(process.env.GUEST_ORDER_LIMIT_MAX || 5);
const GUEST_COOLDOWN_MS = Number(process.env.GUEST_ORDER_COOLDOWN_MS || (isDevelopment ? 2000 : 15000));

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
      logger.security('GUEST_ORDER_BLOCKED', 'Guest order rate limit blocked', { ip: req.ip, limit: GUEST_LIMIT_MAX, windowMs: GUEST_LIMIT_WINDOW_MS }, { level: 'warn', severity: 'medium' });
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
      logger.security('GUEST_ORDER_COOLDOWN_BLOCKED', 'Guest order cooldown blocked', { key, remainingMs: waitMs }, { level: 'warn', severity: 'medium' });
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
    logger.security('GUEST_ORDER_COOLDOWN_PASSED', 'Guest order cooldown passed', { key }, { level: 'debug' });
  }

  next();
};

const checkGuestHoneypot = (req, res, next) => {
  const honeypotValue = req.body?.hiddenField || req.body?.honeypot || req.body?.website;

  if (honeypotValue) {
    if (isDevelopment) {
      logger.security('GUEST_HONEYPOT_BLOCKED', 'Guest honeypot blocked guest order', { ip: req.ip }, { level: 'warn', severity: 'medium' });
    }

    return res.status(400).json({
      status: 'fail',
      message: 'Invalid request.',
    });
  }

  if (isDevelopment) {
    logger.security('GUEST_HONEYPOT_PASSED', 'Guest honeypot passed', {}, { level: 'debug' });
  }

  next();
};

module.exports = {
  guestOrderLimiter,
  guestOrderCooldown,
  checkGuestHoneypot,
};
