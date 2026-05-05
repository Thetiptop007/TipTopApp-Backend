/**
 * Security Event Logger
 * Machine-readable structured logging for abuse detection and analysis
 */

const { logSecurityAudit } = require('../logging/securityAudit.logger');
const { incrementRateLimit } = require('../metrics.service');
const { getClientIp } = require('./clientIp.service');

// Standard security event tags
const EVENT_TAGS = {
  SECURITY_EVENT: '[SECURITY_EVENT]',
  BRUTE_FORCE_DETECTED: '[BRUTE_FORCE_DETECTED]',
  REFRESH_ABUSE_DETECTED: '[REFRESH_ABUSE_DETECTED]',
  DISTRIBUTED_ABUSE_DETECTED: '[DISTRIBUTED_ABUSE_DETECTED]',
  COST_ABUSE_DETECTED: '[COST_ABUSE_DETECTED]',
  SUSPICIOUS_REQUEST: '[SUSPICIOUS_REQUEST]',
  RATE_LIMIT_TRIGGERED: '[RATE_LIMIT_TRIGGERED]',
  RATE_LIMIT_ESCALATION: '[RATE_LIMIT_ESCALATION]',
  TEMPORARY_BAN: '[TEMPORARY_BAN]',
  AUTH_FAILURE: '[AUTH_FAILURE]',
  SESSION_ANOMALY: '[SESSION_ANOMALY]',
  CACHE_BYPASS_ATTEMPT: '[CACHE_BYPASS_ATTEMPT]',
  RECON_ACTIVITY_DETECTED: '[RECON_ACTIVITY_DETECTED]',
};

/**
 * Log security event with structured data
 */
function logSecurityEvent(tag, data = {}) {
  const eventName = String(tag || '').replace(/\[|\]/g, '') || 'SECURITY_EVENT';

  switch (tag) {
    case EVENT_TAGS.BRUTE_FORCE_DETECTED:
    case EVENT_TAGS.REFRESH_ABUSE_DETECTED:
    case EVENT_TAGS.DISTRIBUTED_ABUSE_DETECTED:
    case EVENT_TAGS.COST_ABUSE_DETECTED:
    case EVENT_TAGS.RECON_ACTIVITY_DETECTED:
      logSecurityAudit(eventName, data, { level: 'warn', severity: 'high' });
      break;
    case EVENT_TAGS.TEMPORARY_BAN:
      logSecurityAudit(eventName, data, { level: 'error', severity: 'critical' });
      break;
    default:
      logSecurityAudit(eventName, data, { level: 'info', severity: 'medium' });
  }
}

/**
 * Log brute force attempt on auth endpoints
 */
function logBruteForceAttempt(req, identifier, attemptCount, threshold) {
  logSecurityEvent(EVENT_TAGS.BRUTE_FORCE_DETECTED, {
    method: req.method,
    endpoint: req.path,
    identifier,           // email, phone, or combined
    attemptCount,
    threshold,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
    referer: req.headers.referer || null,
    origin: req.headers.origin || null,
  });
}

/**
 * Log refresh token abuse
 */
function logRefreshAbuse(req, userId, sessionId, reason, refreshCount) {
  logSecurityEvent(EVENT_TAGS.REFRESH_ABUSE_DETECTED, {
    method: req.method,
    endpoint: req.path,
    userId,
    sessionId,
    reason,              // 'excessive', 'rapid', 'replay', etc.
    refreshCount,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
  });
}

/**
 * Log distributed abuse across endpoints
 */
function logDistributedAbuse(ip, score, endpointCount, affectedEndpoints) {
  logSecurityEvent(EVENT_TAGS.DISTRIBUTED_ABUSE_DETECTED, {
    ip,
    abuseScore: score,
    endpointCount,
    affectedEndpoints,   // array of paths
    detectionMethod: 'cross-endpoint-scoring',
  });
}

/**
 * Log cost-based abuse (expensive endpoints)
 */
function logCostAbuse(req, userId, totalCost, budget, reason) {
  logSecurityEvent(EVENT_TAGS.COST_ABUSE_DETECTED, {
    method: req.method,
    endpoint: req.path,
    userId,
    totalCost,
    budget,
    reason,              // 'budget_exceeded', 'expensive_endpoint_spam', etc.
    ip: getClientIp(req),
  });
}

/**
 * Log rate limit trigger
 */
function logRateLimit(req, tier, attempt, limit, escalation = false) {
  incrementRateLimit(tier, req.user?._id ? 'user' : 'ip');

  logSecurityEvent(escalation ? EVENT_TAGS.RATE_LIMIT_ESCALATION : EVENT_TAGS.RATE_LIMIT_TRIGGERED, {
    method: req.method,
    endpoint: req.path,
    routeTier: tier,
    attemptCount: attempt,
    limit,
    ip: getClientIp(req),
    userId: req.user?._id?.toString() || null,
  });
}

/**
 * Log temporary ban enforcement
 */
function logTemporaryBan(identifier, type, durationMs, reason) {
  logSecurityEvent(EVENT_TAGS.TEMPORARY_BAN, {
    identifier,
    banType: type,       // 'ip', 'user', 'session'
    durationMs,
    reason,
    unbanAt: new Date(Date.now() + durationMs).toISOString(),
  });
}

/**
 * Log auth failure with context
 */
function logAuthFailure(req, reason, identifier = null) {
  logSecurityEvent(EVENT_TAGS.AUTH_FAILURE, {
    method: req.method,
    endpoint: req.path,
    reason,              // 'invalid_credentials', 'blocked_account', 'rate_limited', etc.
    identifier,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
  });
}

/**
 * Log session anomaly
 */
function logSessionAnomaly(userId, anomalyType, details) {
  logSecurityEvent(EVENT_TAGS.SESSION_ANOMALY, {
    userId,
    anomalyType,         // 'unusual_location', 'device_change', 'concurrent_sessions', etc.
    ...details,
  });
}

/**
 * Log cache bypass attempt
 */
function logCacheBypassAttempt(req, bypassMethod) {
  logSecurityEvent(EVENT_TAGS.CACHE_BYPASS_ATTEMPT, {
    method: req.method,
    endpoint: req.path,
    bypassMethod,        // 'random_params', 'header_injection', etc.
    query: req.query,
    ip: getClientIp(req),
  });
}

/**
 * Log suspicious request (general)
 */
function logSuspiciousRequest(req, suspicionType, details) {
  logSecurityEvent(EVENT_TAGS.SUSPICIOUS_REQUEST, {
    method: req.method,
    endpoint: req.path,
    suspicionType,       // 'path_traversal', 'sql_injection', 'xss', etc.
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
    ...details,
  });
}

module.exports = {
  EVENT_TAGS,
  logSecurityEvent,
  logBruteForceAttempt,
  logRefreshAbuse,
  logDistributedAbuse,
  logCostAbuse,
  logRateLimit,
  logTemporaryBan,
  logAuthFailure,
  logSessionAnomaly,
  logCacheBypassAttempt,
  logSuspiciousRequest,
};
