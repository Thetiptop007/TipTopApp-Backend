const crypto = require('crypto');
const logger = require('../utils/logger');
const { runWithRequestContext } = require('../utils/requestContext');
const getClientIp = require('../utils/getClientIp');
const { observeHttpRequest } = require('../services/metrics.service');
const { enableSampling, sampleRate, isDevelopment } = require('../config/observability');
const shouldLogPreflight = String(process.env.LOG_DEBUG_ENABLED || '').toLowerCase() === 'true';

function resolveRouteTier(route) {
  const normalizedRoute = String(route || '');

  if (normalizedRoute.startsWith('/api/v1/payments') || normalizedRoute.includes('webhook')) {
    return 'payment_critical';
  }
  if (normalizedRoute.startsWith('/api/v1/admin') || normalizedRoute.startsWith('/api/v1/dashboard') || normalizedRoute.startsWith('/api/v1/developer')) {
    return 'admin_critical';
  }
  if (normalizedRoute.startsWith('/api/v1/auth')) {
    return 'auth_high';
  }
  if (normalizedRoute.startsWith('/api/v1/orders')) {
    return 'public_medium';
  }

  return 'public_low';
}

function shouldAlwaysLog(req, statusCode) {
  if (isDevelopment) return true;
  if (statusCode >= 400) return true;

  const tier = resolveRouteTier(req.logContext?.route || req.originalUrl || req.path || '');
  if (tier === 'auth_high' || tier === 'admin_critical' || tier === 'payment_critical') return true;

  return false;
}

function requestContextMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const ip = getClientIp(req) || 'unknown';
  const route = String(req.originalUrl || req.url || req.path || '').split('?')[0] || '/';
  const routeTier = resolveRouteTier(route);
  const startedAt = process.hrtime.bigint();
  const isPreflight = req.method === 'OPTIONS';
  const shouldEmitLifecycleLogs = !isPreflight || shouldLogPreflight;
  const requestLogLevel = isPreflight && shouldLogPreflight ? 'debug' : 'info';

  req.id = requestId;
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const context = {
    requestId,
    ip,
    route,
    method: req.method,
    routeTier,
  };

  req.logContext = context;

  runWithRequestContext(context, () => {
    req.log = logger;

    if (shouldEmitLifecycleLogs) {
      const requestStartPayload = logger.buildRequestStartContext(req);

      logger[requestLogLevel](requestStartPayload, 'HTTP request started');
    }

    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / BigInt(1000000));
      const statusCode = res.statusCode;

      observeHttpRequest({
        method: req.method,
        route,
        statusCode,
        durationMs,
      });

      if (enableSampling && !shouldAlwaysLog(req, statusCode) && Math.random() > sampleRate) {
        return;
      }

      if (shouldEmitLifecycleLogs) {
        const requestCompletePayload = logger.buildRequestCompleteContext(req, res, durationMs);

        logger[requestLogLevel](requestCompletePayload, 'HTTP request completed');
      }
    });

    next();
  });
}

module.exports = {
  requestContextMiddleware,
};
