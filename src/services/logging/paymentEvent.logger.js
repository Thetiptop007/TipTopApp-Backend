const logger = require('../../utils/logger');
const { incrementPaymentEvent } = require('../metrics.service');

const paymentLogger = logger.createDomainLogger('payment', { fileName: 'payment.log' });

const PAYMENT_EVENTS = {
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_ORDER_CREATED: 'PAYMENT_ORDER_CREATED',
  PAYMENT_CALLBACK_RECEIVED: 'PAYMENT_CALLBACK_RECEIVED',
  PAYMENT_SIGNATURE_VERIFIED: 'PAYMENT_SIGNATURE_VERIFIED',
  PAYMENT_CAPTURE_REQUESTED: 'PAYMENT_CAPTURE_REQUESTED',
  PAYMENT_CAPTURED: 'PAYMENT_CAPTURED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUND_INITIATED: 'PAYMENT_REFUND_INITIATED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  PAYMENT_RECON_MISMATCH: 'PAYMENT_RECON_MISMATCH',
  PAYMENT_TAMPERING_ATTEMPT: 'PAYMENT_TAMPERING_ATTEMPT',
};

function sanitizePaymentPayload(payload = {}) {
  const sanitized = { ...payload };
  if (sanitized.signature) sanitized.signature = '[REDACTED]';
  if (sanitized.razorpaySignature) sanitized.razorpaySignature = '[REDACTED]';
  if (sanitized.secret) sanitized.secret = '[REDACTED]';
  if (sanitized.razorpaySecret) sanitized.razorpaySecret = '[REDACTED]';
  if (sanitized.rawPayload) sanitized.rawPayload = '[REDACTED_RAW_PAYLOAD]';
  return sanitized;
}

function logPaymentEvent(event, payload = {}, status = 'ok', level = 'info', severity = 'high') {
  incrementPaymentEvent(event, status);

  paymentLogger[level](
    {
      logType: 'payment',
      event,
      severity,
      category: 'payment_event',
      status,
      ...sanitizePaymentPayload(payload),
    },
    event
  );
}

function logRazorpayPlaceholderEvent(event, payload = {}) {
  logPaymentEvent(event, { gateway: 'razorpay', ...payload }, 'pending', 'info');
}

module.exports = {
  paymentLogger,
  PAYMENT_EVENTS,
  logPaymentEvent,
  logRazorpayPlaceholderEvent,
};
