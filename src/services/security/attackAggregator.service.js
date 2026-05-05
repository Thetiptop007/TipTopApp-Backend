const logger = require('../../utils/logger');
const { incrementSuspiciousRequest } = require('../metrics.service');

const attackLogger = logger.createDomainLogger('security', { fileName: 'security.log' });
const aggregationWindowMs = Math.max(30000, Number(process.env.ATTACK_AGGREGATION_WINDOW_MS || 60000));
const buckets = new Map();

function toBucketKey({ ip, userAgent, route, attackType }) {
  return `${ip || 'unknown'}|${userAgent || 'unknown'}|${route || 'unknown'}|${attackType || 'UNKNOWN'}`;
}

function observeAttack({ ip, userAgent, route, attackType, rawContext = {} }) {
  const key = toBucketKey({ ip, userAgent, route, attackType });
  const existing = buckets.get(key) || {
    count: 0,
    ip: ip || 'unknown',
    userAgent: userAgent || 'unknown',
    route: route || 'unknown',
    attackType: attackType || 'UNKNOWN',
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  existing.count += 1;
  existing.lastSeenAt = Date.now();
  existing.rawContext = rawContext;
  buckets.set(key, existing);

  incrementSuspiciousRequest(existing.attackType.toLowerCase());
  if (process.env.NODE_ENV === 'development') {
    attackLogger.debug({
      logType: 'security',
      event: 'SUSPICIOUS_RAW',
      severity: 'low',
      attackType: existing.attackType,
      ip: existing.ip,
      route: existing.route,
      userAgent: existing.userAgent,
      context: rawContext,
    }, 'SUSPICIOUS_RAW');
  }
}

function flushAttackSummary() {
  if (buckets.size === 0) return;

  for (const bucket of buckets.values()) {
    const durationMs = bucket.lastSeenAt - bucket.firstSeenAt;
    const event = bucket.count >= 25 ? 'SUSPICIOUS_BURST' : bucket.count >= 8 ? 'PROBE_CLUSTER' : 'ATTACK_SUMMARY';

    attackLogger.warn({
      logType: 'security',
      event,
      severity: bucket.count >= 25 ? 'high' : 'medium',
      attackType: bucket.attackType,
      ip: bucket.ip,
      route: bucket.route,
      userAgent: bucket.userAgent,
      count: bucket.count,
      durationMs,
      firstSeenAt: new Date(bucket.firstSeenAt).toISOString(),
      lastSeenAt: new Date(bucket.lastSeenAt).toISOString(),
    }, event);
  }

  buckets.clear();
}

setInterval(flushAttackSummary, aggregationWindowMs).unref();

module.exports = {
  observeAttack,
  flushAttackSummary,
};
