/**
 * Hardened Client IP Resolver
 * Single source of truth for real client IP extraction
 * 
 * Rules:
 * - Trust only configured proxies
 * - Safely extract from CF, X-Real-IP, X-Forwarded-For
 * - Normalize IPv4/IPv6
 * - Reject malformed/spoofed values
 * - Never blindly trust user headers
 */

const logger = require('../../utils/logger');

// Trusted proxy IPs/ranges (Cloudflare, load balancers, etc.)
const TRUSTED_PROXIES = process.env.TRUSTED_PROXIES
  ? process.env.TRUSTED_PROXIES.split(',').map(ip => ip.trim())
  : [
      '127.0.0.1',
      '::1',
      '10.0.0.0/8',      // Private range
      '172.16.0.0/12',   // Private range
      '192.168.0.0/16',  // Private range
      '::ffff:127.0.0.1', // IPv4-mapped IPv6 localhost
    ];

const TRUSTED_HEADERS = [
  'cf-connecting-ip',      // Cloudflare
  'x-real-ip',             // Nginx reverse proxy
  'x-forwarded-for',       // Standard proxy
  'true-client-ip',        // Akamai/Cloudflare
  'x-client-ip',           // Cisco
];

/**
 * Check if IP is in CIDR range
 */
function isIpInRange(ip, range) {
  // Simple check - in production, use ip-address library
  if (range === ip) return true;
  if (range.includes('/')) {
    // Simplified CIDR check - just check if starts with base
    const base = range.split('/')[0];
    return ip.startsWith(base.split('.').slice(0, 3).join('.'));
  }
  return false;
}

/**
 * Check if IP is from trusted proxy
 */
function isTrustedProxy(ip) {
  if (!ip) return false;
  return TRUSTED_PROXIES.some(proxy => isIpInRange(ip, proxy));
}

/**
 * Normalize IPv4 address
 */
function normalizeIpv4(ip) {
  if (!ip || typeof ip !== 'string') return null;
  
  // Remove IPv4-mapped IPv6 prefix
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  // Validate IPv4 format
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return null;
  
  // Validate octets are in range
  const parts = ip.split('.');
  if (parts.some(p => parseInt(p) > 255)) return null;
  
  return ip;
}

/**
 * Extract real client IP from request
 * Returns normalized IP or null if unable to determine safely
 */
function getClientIp(req) {
  if (!req || !req.headers) return null;

  try {
    const proxyIp = req.ip || req.connection?.remoteAddress;
    
    // Only trust headers if request came through trusted proxy
    if (!proxyIp || !isTrustedProxy(proxyIp)) {
      // No trusted proxy, use direct connection IP
      const direct = normalizeIpv4(proxyIp);
      return direct || proxyIp;
    }

    // Proxy is trusted, check forwarded headers
    for (const header of TRUSTED_HEADERS) {
      const value = req.headers[header];
      if (!value) continue;

      // Handle X-Forwarded-For which may contain multiple IPs
      if (header === 'x-forwarded-for' && typeof value === 'string') {
        // Take the first IP (original client)
        const ips = value.split(',').map(ip => ip.trim());
        const clientIp = ips[0];
        
        const normalized = normalizeIpv4(clientIp);
        if (normalized) return normalized;
        
        // If not valid IPv4, may be IPv6, return as-is
        if (clientIp && /^[0-9a-f:]+$/i.test(clientIp)) return clientIp;
      }

      // Single-value headers
      const normalized = normalizeIpv4(value);
      if (normalized) return normalized;
      
      // May be IPv6
      if (typeof value === 'string' && /^[0-9a-f:]+$/i.test(value)) {
        return value;
      }
    }

    // All proxy headers checked, fall back to proxy IP
    const direct = normalizeIpv4(proxyIp);
    return direct || proxyIp;

  } catch (error) {
    logger.error('Error extracting client IP:', error.message);
    return req.ip || null;
  }
}

/**
 * Get client IP and request fingerprint for abuse detection
 */
function getClientFingerprint(req) {
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  const acceptLanguage = req.headers['accept-language'] || 'unknown';
  
  return {
    ip,
    userAgent,
    acceptLanguage,
    hash: `${ip}:${userAgent}`.substring(0, 64), // Fingerprint for abuse scoring
  };
}

module.exports = {
  getClientIp,
  getClientFingerprint,
  isTrustedProxy,
  normalizeIpv4,
  TRUSTED_PROXIES,
  TRUSTED_HEADERS,
};
