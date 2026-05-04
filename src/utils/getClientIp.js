/**
 * Helper to determine real client IP from request headers
 */
function getClientIp(req) {
  if (!req || !req.headers) return req?.ip || null;

  const headerChecks = [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'true-client-ip',
  ];

  for (const h of headerChecks) {
    const val = req.headers[h];
    if (!val) continue;
    // x-forwarded-for can be a CSV
    if (typeof val === 'string' && val.includes(',')) {
      return val.split(',')[0].trim();
    }
    return val;
  }

  // Fallback to express provided IP
  if (req.ip) return req.ip;
  if (req.connection && req.connection.remoteAddress) return req.connection.remoteAddress;
  return null;
}

module.exports = getClientIp;
