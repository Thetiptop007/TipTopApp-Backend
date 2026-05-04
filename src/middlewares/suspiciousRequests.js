const logger = require('../utils/logger');
const { getClientIp } = require('../services/security/clientIp.service');

// In-memory counters (simple, reset on restart)
const ipCounters = new Map();

const ROOT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ROOT_LIMIT = 20; // 20 requests per window per IP
const INVALID_ROUTE_WINDOW_MS = 5 * 60 * 1000;
const INVALID_ROUTE_THRESHOLD = 30; // many different invalid paths

const PROBE_QUERY_KEYS = new Set(['cb', 'callback', 'cacheBust', 'test', 'debug', '_cb', '_']);

function now() {
  return Date.now();
}

function getCountersForIp(ip) {
  let entry = ipCounters.get(ip);
  if (!entry) {
    entry = {
      rootHits: [], // timestamps
      invalidRoutes: new Map(), // path -> count
      lastSeen: now(),
      reconLogged: false,
    };
    ipCounters.set(ip, entry);
  }
  entry.lastSeen = now();
  return entry;
}

// Clean old timestamps in array to keep sliding window
function pruneArray(arr, windowMs) {
  const cutoff = now() - windowMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
}

// Middleware to log suspicious probing and rate limit root
module.exports = (req, res, next) => {
  try {
    const ip = getClientIp(req) || 'unknown';
    const ua = req.headers['user-agent'] || null;
    const referer = req.headers.referer || req.headers.referrer || null;
    const origin = req.headers.origin || null;
    const method = req.method;
    const originalUrl = req.originalUrl || req.url;

    const counters = getCountersForIp(ip);

    // Detect root API probing patterns
    if (req.path === '/api/v1') {
      const queryKeys = Object.keys(req.query || {});
      const looksLikeProbe = queryKeys.some(k => PROBE_QUERY_KEYS.has(k) || /^[0-9a-f]{6,}$/i.test(req.query[k] ? String(req.query[k]) : '')) || queryKeys.length > 0;

      if (looksLikeProbe) {
        logger.warn(`[SUSPICIOUS_REQUEST] method=${method} originalUrl=${originalUrl} ip=${ip} ua=${ua} referer=${referer} origin=${origin} query=${JSON.stringify(req.query)}`);

        // record root hit
        counters.rootHits.push(now());
        pruneArray(counters.rootHits, ROOT_WINDOW_MS);

        if (counters.rootHits.length > ROOT_LIMIT) {
          logger.warn(`[RATE_LIMIT] excessive root probing detected for ip=${ip} count=${counters.rootHits.length}`);
          return res.status(429).json({ status: 'fail', message: 'Too many requests' });
        }
        // mark as suspicious but allow downstream to respond (we may choose to respond 404 there)
        req.isSuspicious = true;
      }
    }

    // Track invalid route attempts when path looks like /api/v1/unknown
    if (req.path.startsWith('/api/v1') && req.path !== '/api/v1' && req.path !== '/api/v1/test') {
      // We'll increment a counter per unique invalid path
      const count = counters.invalidRoutes.get(req.path) || 0;
      counters.invalidRoutes.set(req.path, count + 1);

      // If many distinct invalid routes accessed recently, flag recon activity
      const distinct = counters.invalidRoutes.size;
      if (distinct > 10 && !counters.reconLogged) {
        counters.reconLogged = true;
        logger.warn(`[RECON_ACTIVITY_DETECTED] ip=${ip} distinctInvalidPaths=${distinct} samplePath=${req.path} ua=${ua}`);
      }

      // If overall invalid route counts cross a threshold in window, log
      let totalInvalid = 0;
      for (const v of counters.invalidRoutes.values()) totalInvalid += v;
      if (totalInvalid > INVALID_ROUTE_THRESHOLD && !counters.reconLogged) {
        counters.reconLogged = true;
        logger.warn(`[RECON_ACTIVITY_DETECTED] ip=${ip} totalInvalidRequests=${totalInvalid}`);
      }
    }

    next();
  } catch (err) {
    logger.error('Error in suspiciousRequests middleware', err.message || err);
    next();
  }
};
