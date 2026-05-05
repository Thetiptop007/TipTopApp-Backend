const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestCounter = new client.Counter({
  name: 'tiptop_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpErrorCounter = new client.Counter({
  name: 'tiptop_http_errors_total',
  help: 'Total number of HTTP 5xx responses',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpClientErrorCounter = new client.Counter({
  name: 'tiptop_http_client_errors_total',
  help: 'Total number of HTTP 4xx responses',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpStatusCounter = new client.Counter({
  name: 'tiptop_http_response_status_total',
  help: 'Response count by method, route and status',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpDurationMs = new client.Histogram({
  name: 'tiptop_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

const paymentEventsCounter = new client.Counter({
  name: 'tiptop_payment_events_total',
  help: 'Payment event counters by event type and status',
  labelNames: ['event', 'status'],
  registers: [register],
});

const suspiciousRequestCounter = new client.Counter({
  name: 'tiptop_suspicious_requests_total',
  help: 'Suspicious request detections',
  labelNames: ['type'],
  registers: [register],
});

const rateLimitCounter = new client.Counter({
  name: 'tiptop_rate_limit_triggers_total',
  help: 'Rate-limit trigger counts',
  labelNames: ['tier', 'scope'],
  registers: [register],
});

const securityEventCounter = new client.Counter({
  name: 'tiptop_security_events_total',
  help: 'Security event counters by type and severity',
  labelNames: ['event', 'severity'],
  registers: [register],
});

const webhookVerificationFailureCounter = new client.Counter({
  name: 'tiptop_webhook_verification_failures_total',
  help: 'Failed webhook verification attempts',
  labelNames: ['provider'],
  registers: [register],
});

const authLoginCounter = new client.Counter({
  name: 'tiptop_auth_login_total',
  help: 'Login outcomes by scope and result',
  labelNames: ['scope', 'result'],
  registers: [register],
});

const orderCreatedCounter = new client.Counter({
  name: 'tiptop_orders_created_total',
  help: 'Order creation count by source',
  labelNames: ['source'],
  registers: [register],
});

function normalizeRoute(path) {
  if (!path) return 'unknown';
  return String(path)
    .replace(/[0-9a-fA-F]{24}/g, ':id')
    .replace(/\d+/g, ':n');
}

function observeHttpRequest({ method, route, statusCode, durationMs }) {
  const labels = {
    method: String(method || 'GET').toUpperCase(),
    route: normalizeRoute(route),
    status: String(statusCode || 0),
  };

  httpRequestCounter.inc(labels);
  httpDurationMs.observe(labels, Number(durationMs || 0));
  httpStatusCounter.inc({
    method: labels.method,
    route: labels.route,
    status: labels.status,
  });

  if (Number(statusCode) >= 400 && Number(statusCode) < 500) {
    httpClientErrorCounter.inc({
      method: labels.method,
      route: labels.route,
      status: labels.status,
    });
  }

  if (Number(statusCode) >= 500) {
    httpErrorCounter.inc({
      method: labels.method,
      route: labels.route,
      status: labels.status,
    });
  }
}

function incrementPaymentEvent(event, status = 'ok') {
  paymentEventsCounter.inc({
    event: String(event || 'UNKNOWN'),
    status: String(status || 'ok'),
  });
}

function incrementSuspiciousRequest(type = 'unknown') {
  suspiciousRequestCounter.inc({ type: String(type) });
}

function incrementRateLimit(tier = 'unknown', scope = 'ip') {
  rateLimitCounter.inc({
    tier: String(tier),
    scope: String(scope),
  });
}

function incrementSecurityEvent(event = 'unknown', severity = 'info') {
  securityEventCounter.inc({
    event: String(event),
    severity: String(severity).toLowerCase(),
  });
}

function incrementWebhookVerificationFailure(provider = 'unknown') {
  webhookVerificationFailureCounter.inc({ provider: String(provider) });
}

function incrementLoginOutcome(scope = 'customer', result = 'success') {
  authLoginCounter.inc({
    scope: String(scope),
    result: String(result),
  });
}

function incrementOrderCreated(source = 'unknown') {
  orderCreatedCounter.inc({ source: String(source) });
}

async function metricsHandler(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  register,
  observeHttpRequest,
  incrementPaymentEvent,
  incrementSuspiciousRequest,
  incrementRateLimit,
  incrementSecurityEvent,
  incrementWebhookVerificationFailure,
  incrementLoginOutcome,
  incrementOrderCreated,
  metricsHandler,
};
