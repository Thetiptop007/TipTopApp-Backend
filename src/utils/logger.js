const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { getRequestContext } = require('./requestContext');
const { LOG_SEVERITY, LOG_TYPE, LOG_EVENTS } = require('../constants/log-events');
const {
  env,
  isDevelopment,
  serviceName,
  serviceVersion,
  hostname,
  logLevel,
  logPrettyEnabled,
} = require('../config/observability');

// Flatten all canonical events into a single set for validation
const CANONICAL_EVENTS = new Set(
  [
    ...Object.values(LOG_EVENTS.SYSTEM),
    ...Object.values(LOG_EVENTS.DB),
    ...Object.values(LOG_EVENTS.REQUEST),
    ...Object.values(LOG_EVENTS.AUTH),
    ...Object.values(LOG_EVENTS.SECURITY),
    ...Object.values(LOG_EVENTS.PAYMENT),
    ...Object.values(LOG_EVENTS.NOTIFICATION),
    ...Object.values(LOG_EVENTS.BUSINESS),
  ]
);

const VALID_LOG_TYPES = new Set(Object.values(LOG_TYPE));
const RESERVED_LOG_KEYS = new Set([
  'timestamp',
  'level',
  'service',
  'environment',
  'version',
  'hostname',
  'logType',
  'event',
  'severity',
  'message',
  'requestId',
  'ip',
  'method',
  'route',
  'routeTier',
]);

const REQUEST_LOG_ALLOWLIST = new Set([
  'requestId',
  'route',
  'method',
  'routeTier',
  'statusCode',
  'durationMs',
  'userId',
  'userRole',
  'contentLength',
  'ip',
]);

const REQUEST_START_FIELDS = new Set([
  'requestId',
  'ip',
  'route',
  'method',
  'routeTier',
]);

const REQUEST_COMPLETE_FIELDS = new Set([
  'requestId',
  'ip',
  'route',
  'method',
  'routeTier',
  'userId',
  'userRole',
  'statusCode',
  'durationMs',
  'contentLength',
]);

const WELL_FORMED_EVENT_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

// Environment gating
const DEBUG_LOG_ENABLED = process.env.LOG_DEBUG_ENABLED === 'true' || process.env.LOG_DEBUG_AUTH === 'true';
const DEBUG_LOG_DISABLED_IN_PROD = env === 'production' && !DEBUG_LOG_ENABLED;

const logDir = path.resolve(__dirname, '../../logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Validate event name against canonical registry
 * Returns true if valid, false otherwise
 */
function isCanonicalEvent(event) {
  if (!event || typeof event !== 'string') return false;
  return CANONICAL_EVENTS.has(event) || (WELL_FORMED_EVENT_PATTERN.test(event) && !appearsDynamicallyGenerated(event));
}

/**
 * Validate logType is allowed
 */
function isValidLogType(logType) {
  if (!logType || typeof logType !== 'string') return false;
  return VALID_LOG_TYPES.has(logType);
}

/**
 * Check if event name appears to be dynamically generated
 * (contains IDs, URLs, user input, or too many underscores)
 */
function appearsDynamicallyGenerated(event) {
  if (!event || typeof event !== 'string') return false;
  
  // Too many consecutive underscores (likely from interpolation)
  if (/__/.test(event)) return true;
  
  // Contains common patterns from interpolation
  if (/API_V\d|_\d{1,}$|_URL|_PATH|_ID$/.test(event)) return true;
  
  // Event too long (likely contains details)
  if (event.length > 64) return true;
  
  return false;
}

/**
 * Normalize severity value
 */
function normalizeSeverity(value, fallback = LOG_SEVERITY.LOW) {
  const normalized = String(value || '').toLowerCase();
  if (Object.values(LOG_SEVERITY).includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function isStructuredLogObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function humanizeEvent(event) {
  if (!event || typeof event !== 'string') return 'Log event';
  return event
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function consoleFallback(level, payload, message) {
  try {
    if (isDevelopment) {
      const method = console[level] || console.warn;
      method.call(console, message || payload?.message || 'Logger recovery', payload);
      return;
    }

    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(payload)}\n`);
  } catch (error) {
    try {
      process.stderr.write(`${JSON.stringify({
        logType: 'system',
        event: 'LOGGER_INTERNAL_RECOVERY',
        severity: LOG_SEVERITY.HIGH,
        message: 'Logger recovery write failed',
        errorMessage: error?.message || String(error),
      })}\n`);
    } catch {
      // Intentionally swallow fallback failures.
    }
  }
}

function emitInternalRecovery(event, message, details = {}, severity = LOG_SEVERITY.MEDIUM, level = 'warn') {
  const payload = {
    logType: 'system',
    event: 'LOGGER_INTERNAL_RECOVERY',
    severity,
    message,
    recoveryReason: event,
    ...details,
  };

  consoleFallback(level, payload, message);
  return null;
}

function emitRejection(methodOrLogger, event, message, details = {}, severity = LOG_SEVERITY.MEDIUM, level = 'warn', thisArg = null) {
  return emitInternalRecovery(event, message, details, severity, level);
}

function stripReservedKeys(meta = {}) {
  const sanitized = {};

  for (const [key, value] of Object.entries(meta)) {
    if (RESERVED_LOG_KEYS.has(key)) continue;
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function sanitizeRequestMeta(meta = {}) {
  const sanitized = {};

  for (const [key, value] of Object.entries(meta)) {
    if (!REQUEST_LOG_ALLOWLIST.has(key)) continue;

    if (key === 'contentLength') {
      sanitized.contentLength = value == null ? null : value;
      continue;
    }

    if (key === 'userRole') {
      sanitized.userRole = value;
      continue;
    }

    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  if (!('userRole' in sanitized)) {
    if (meta.userRole !== undefined) {
      sanitized.userRole = meta.userRole;
    } else if (meta.role !== undefined) {
      sanitized.userRole = meta.role;
    } else if (Array.isArray(meta.userRoles) && meta.userRoles.length > 0) {
      sanitized.userRole = meta.userRoles[0];
    }
  }

  return sanitized;
}

function sanitizeBusinessMeta(meta = {}) {
  return stripReservedKeys(meta);
}

function sanitizeMeta(logType, meta = {}) {
  if (logType === 'request') {
    return sanitizeRequestMeta(meta);
  }

  if (logType === 'business') {
    return sanitizeBusinessMeta(meta);
  }

  return stripReservedKeys(meta);
}

function getCanonicalRoute(req) {
  if (req?.logContext?.route) {
    return req.logContext.route;
  }

  const originalUrl = String(req?.originalUrl || req?.url || req?.baseUrl || req?.path || '');
  return originalUrl.split('?')[0] || '/';
}

/**
 * Build strict request start context
 * Only includes fields relevant to request execution start
 * NEVER inherits from merged logger context
 */
function buildRequestStartContext(req) {
  const route = getCanonicalRoute(req);

  return {
    logType: 'request',
    event: 'HTTP_REQUEST_STARTED',
    severity: 'low',
    requestId: req.requestId || req.id,
    ip: req.ip,
    route,
    method: req.method,
    routeTier: req.routeTier || 'unknown',
  };
}

/**
 * Build strict request completion context
 * Only includes fields relevant to request execution completion
 * NEVER inherits business/auth/error metadata from merged context
 */
function buildRequestCompleteContext(req, res, durationMs) {
  const route = getCanonicalRoute(req);
  const statusCode = res.statusCode || 200;
  const userId = req.user?._id?.toString() || null;
  const userRole = req.user?.userRole || req.user?.role || null;

  // Determine severity only from HTTP status, never from merged context
  let severity = 'low';
  if (statusCode >= 500) {
    severity = 'high';
  } else if (statusCode >= 400) {
    severity = 'medium';
  }

  return {
    logType: 'request',
    event: 'HTTP_REQUEST_COMPLETED',
    severity,
    requestId: req.requestId || req.id,
    ip: req.ip,
    route,
    method: req.method,
    routeTier: req.routeTier || 'unknown',
    statusCode,
    durationMs,
    userId,
    userRole,
    contentLength: res.getHeader('content-length') || null,
  };
}

function emitSafeLog(method, payload, message, thisArg = null) {
  try {
    return thisArg ? method.apply(thisArg, [payload, message]) : method(payload, message);
  } catch (error) {
    consoleFallback('error', payload, `${message}: ${error?.message || String(error)}`);
    return null;
  }
}

const redactPaths = [
  'password',
  'token',
  'refreshToken',
  'authorization',
  'headers.authorization',
  'headers.cookie',
  'cookies',
  'csrfToken',
  'headers.x-csrf-token',
  'body.password',
  'body.token',
  'body.refreshToken',
  'body.csrfToken',
  'body.signature',
  'body.razorpay_signature',
  'body.razorpaySecret',
  'body.currentPassword',
  'body.newPassword',
  'razorpaySignature',
  'signature',
  'rawWebhookSecret',
  'webhookSecret',
  'razorpay_secret',
  'paymentDetails.cardNumber',
  'paymentDetails.cvv',
  'paymentDetails.card',
  '*.password',
  '*.token',
  '*.authorization',
];

const extraRedactions = (process.env.LOG_REDACT_PATHS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function severityFromLevel(levelNumber) {
  if (levelNumber >= 60) return LOG_SEVERITY.CRITICAL;
  if (levelNumber >= 50) return LOG_SEVERITY.HIGH;
  if (levelNumber >= 40) return LOG_SEVERITY.MEDIUM;
  return LOG_SEVERITY.LOW;
}

const baseOptions = {
  level: logLevel,
  base: {
    service: serviceName,
    environment: env,
    version: serviceVersion,
    hostname,
    logType: 'system',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [...redactPaths, ...extraRedactions],
    censor: '[REDACTED]',
  },
  mixin() {
    return getRequestContext();
  },
  hooks: {
    logMethod(inputArgs, method, levelNumber) {
      const levelSeverity = severityFromLevel(levelNumber);
      const bindings = this.bindings ? this.bindings() : {};
      let message = null;
      let logType = bindings.logType || 'system';
      let event = null;
      let severity = levelSeverity;

      if (inputArgs.length === 0) {
        return emitRejection(method, 'INVALID_LOG_PAYLOAD_REJECTED', 'Empty log payload rejected', { reason: 'empty_arguments' }, LOG_SEVERITY.MEDIUM, 'warn', this);
      }

      // Parse input arguments
      if (isStructuredLogObject(inputArgs[0])) {
        const objectArg = inputArgs[0];
        message = typeof inputArgs[1] === 'string' ? inputArgs[1] : objectArg.message || null;
        if (!message) {
          message = humanizeEvent(objectArg.event || 'INVALID_LOG_PAYLOAD_REJECTED');
        }
        
        // Extract and validate logType
        if (objectArg.logType && isValidLogType(objectArg.logType)) {
          logType = objectArg.logType;
        } else if (objectArg.logType && !isValidLogType(objectArg.logType)) {
          return emitRejection(method, 'INVALID_LOG_TYPE_REJECTED', 'Invalid logType rejected', { providedLogType: objectArg.logType }, LOG_SEVERITY.MEDIUM, 'warn', this);
        }
        
        // Extract and validate event
        if (objectArg.event && isCanonicalEvent(objectArg.event)) {
          event = objectArg.event;
        } else if (objectArg.event) {
          return emitRejection(method, 'INVALID_EVENT_REJECTED', 'Invalid event rejected', { providedEvent: objectArg.event, providedLogType: logType }, LOG_SEVERITY.MEDIUM, 'warn', this);
        } else {
          return emitRejection(method, 'INVALID_EVENT_REJECTED', 'Structured log missing event', { providedLogType: logType, message }, LOG_SEVERITY.MEDIUM, 'warn', this);
        }
        
        severity = normalizeSeverity(objectArg.severity, levelSeverity);
        
        inputArgs[0] = {
          ...stripReservedKeys(objectArg),
          logType,
          event,
          severity,
          message,
        };
      } else if (typeof inputArgs[0] === 'string') {
        message = inputArgs[0];
        emitInternalRecovery('DEV_RAW_LOG_REJECTED', 'Raw string log rejected', { rawMessage: message }, LOG_SEVERITY.MEDIUM, 'warn');
        return; // Exit early, do not continue with structured logging
      } else {
        return emitRejection(method, 'INVALID_LOG_PAYLOAD_REJECTED', 'Malformed log payload rejected', { payloadType: typeof inputArgs[0] });
      }

      if (typeof inputArgs[1] !== 'string') {
        inputArgs[1] = message || inputArgs[0].message || humanizeEvent(event);
      }

      if (logType === 'request') {
        inputArgs[0] = {
          ...sanitizeRequestMeta(inputArgs[0]),
          logType,
          event,
          severity,
          message: inputArgs[0].message || message,
        };
      } else if (logType === 'business') {
        inputArgs[0] = {
          ...sanitizeBusinessMeta(inputArgs[0]),
          logType,
          event,
          severity,
          message: inputArgs[0].message || message,
        };
      } else {
        inputArgs[0] = {
          ...stripReservedKeys(inputArgs[0]),
          logType,
          event,
          severity,
          message: inputArgs[0].message || message,
        };
      }

      return emitSafeLog(method, inputArgs[0], inputArgs[1], this);
    },
  },
};

const prettyModeEnabled = isDevelopment || logPrettyEnabled;

const stdoutTransport = prettyModeEnabled
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
      },
    })
  : pino.destination(1);

const rootLogger = pino(baseOptions, stdoutTransport);

function createChildLogger(context = {}) {
  return rootLogger.child(context);
}

function emitWithSchema(logType, event, message, meta = {}, options = {}) {
  if (!isValidLogType(logType)) {
    return emitRejection(
      rootLogger,
      'INVALID_LOG_TYPE_REJECTED',
      'Invalid logType rejected',
      { providedLogType: logType, providedEvent: event },
      LOG_SEVERITY.MEDIUM,
      'warn'
    );
  }

  if (!isCanonicalEvent(event)) {
    return emitRejection(
      rootLogger,
      'INVALID_EVENT_REJECTED',
      'Invalid event rejected',
      { providedEvent: event, providedLogType: logType },
      LOG_SEVERITY.MEDIUM,
      'warn'
    );
  }

  // Environment gating for debug logs
  if (DEBUG_LOG_DISABLED_IN_PROD && options.level === 'debug') {
    return; // Suppress debug logs in production unless explicitly enabled
  }

  const level = options.level || 'info';
  const severity = normalizeSeverity(options.severity, LOG_SEVERITY.LOW);
  const sanitizedMeta = sanitizeMeta(logType, meta);
  const humanMessage = typeof message === 'string' && message.trim() ? message : humanizeEvent(event);
  const payload = {
    logType,
    event,
    severity,
    message: humanMessage,
    ...sanitizedMeta,
  };

  try {
    rootLogger[level](payload, humanMessage);
  } catch (error) {
    emitInternalRecovery('LOGGER_EMIT_FAILED', humanMessage, {
      logType,
      event,
      severity,
      errorMessage: error?.message || String(error),
      ...sanitizedMeta,
    }, LOG_SEVERITY.HIGH, 'error');
  }
}

function createDomainLogger(domain, { fileName } = {}) {
  const domainPath = path.join(logDir, fileName || `${domain}.log`);
  const streams = [{ stream: stdoutTransport }];

  if (fileName) {
    streams.push({ stream: pino.destination({ dest: domainPath, mkdir: true, sync: false }) });
  }

  const options = {
    ...baseOptions,
    base: {
      ...baseOptions.base,
      logType: domain,
    },
  };

  const loggerInstance = pino(options, pino.multistream(streams));
  loggerInstance.createChildLogger = (context = {}) => loggerInstance.child(context);
  return loggerInstance;
}

rootLogger.createChildLogger = createChildLogger;
rootLogger.createDomainLogger = createDomainLogger;
rootLogger.system = (event, message, meta = {}, options = {}) => emitWithSchema('system', event, message, meta, options);
rootLogger.security = (event, message, meta = {}, options = {}) => emitWithSchema('security', event, message, meta, options);
rootLogger.auth = (event, message, meta = {}, options = {}) => emitWithSchema('auth', event, message, meta, options);
rootLogger.payment = (event, message, meta = {}, options = {}) => emitWithSchema('payment', event, message, meta, options);
rootLogger.request = (event, message, meta = {}, options = {}) => emitWithSchema('request', event, message, meta, options);
rootLogger.db = (event, message, meta = {}, options = {}) => emitWithSchema('db', event, message, meta, options);
rootLogger.order = (event, message, meta = {}, options = {}) => emitWithSchema('order', event, message, meta, options);
rootLogger.notification = (event, message, meta = {}, options = {}) => emitWithSchema('notification', event, message, meta, options);
rootLogger.business = (event, message, meta = {}, options = {}) => emitWithSchema('business', event, message, meta, options);
rootLogger.domains = {
  auth: rootLogger.createDomainLogger('auth', { fileName: 'auth.log' }),
  payments: rootLogger.createDomainLogger('payment', { fileName: 'payment.log' }),
  orders: rootLogger.createDomainLogger('order', { fileName: 'order.log' }),
  business: rootLogger.createDomainLogger('business', { fileName: 'business.log' }),
  security: rootLogger.createDomainLogger('security', { fileName: 'security.log' }),
  db: rootLogger.createDomainLogger('db', { fileName: 'db.log' }),
  notifications: rootLogger.createDomainLogger('notification', { fileName: 'notification.log' }),
};

rootLogger.buildRequestStartContext = buildRequestStartContext;
rootLogger.buildRequestCompleteContext = buildRequestCompleteContext;
rootLogger.__internal = {
  isCanonicalEvent,
  sanitizeRequestMeta,
  sanitizeBusinessMeta,
  stripReservedKeys,
  getCanonicalRoute,
  emitInternalRecovery,
  emitRejection,
  normalizeSeverity,
  wellFormedEventPattern: WELL_FORMED_EVENT_PATTERN,
};

module.exports = rootLogger;
