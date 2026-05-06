const logger = require('../../utils/logger');
const { incrementSecurityEvent } = require('../metrics.service');

const securityLogger = logger.createDomainLogger('security', { fileName: 'security.log' });

const SECURITY_EVENTS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  SUSPICIOUS_REQUEST: 'SUSPICIOUS_REQUEST',
  RATE_LIMIT_TRIGGERED: 'RATE_LIMIT_TRIGGERED',
  RATE_LIMIT_ESCALATION: 'RATE_LIMIT_ESCALATION',
  ROLE_CHANGE: 'ROLE_CHANGE',
  AUTH_SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  ADMIN_ACCESS: 'ADMIN_ACCESS',
  FORBIDDEN_ACCESS: 'FORBIDDEN_ACCESS',
  TOKEN_VALIDATION_FAILURE: 'TOKEN_VALIDATION_FAILURE',
  CSRF_FAILURE: 'CSRF_FAILURE',
  SUSPICIOUS_QUERY_PROBING: 'SUSPICIOUS_QUERY_PROBING',
  BRUTE_FORCE_DETECTION: 'BRUTE_FORCE_DETECTION',
  WEBHOOK_SIGNATURE_MISMATCH: 'WEBHOOK_SIGNATURE_MISMATCH',
  PAYMENT_TAMPERING_ATTEMPT: 'PAYMENT_TAMPERING_ATTEMPT',
};

function logSecurityAudit(event, payload = {}, options = {}) {
  const level = options.level || 'info';
  const severity = String(options.severity || level || 'medium').toLowerCase();

  incrementSecurityEvent(event, severity);

  securityLogger[level](
    {
      logType: 'security',
      event,
      severity,
      category: 'security_audit',
      ...payload,
    },
    event
  );
}

module.exports = {
  SECURITY_EVENTS,
  securityLogger,
  logSecurityAudit,
};
