const { PAYMENT_EVENTS, logPaymentEvent, logRazorpayPlaceholderEvent } = require('./logging/paymentEvent.logger');
const { incrementWebhookVerificationFailure } = require('./metrics.service');

function logPaymentInitiated(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_INITIATED, payload, 'pending');
}

function logPaymentOrderCreated(payload = {}) {
  logRazorpayPlaceholderEvent(PAYMENT_EVENTS.PAYMENT_ORDER_CREATED, payload);
}

function logPaymentCallbackReceived(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_CALLBACK_RECEIVED, payload, 'pending');
}

function logPaymentSignatureVerified(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_SIGNATURE_VERIFIED, payload, 'success');
}

function logPaymentCaptureRequested(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_CAPTURE_REQUESTED, payload, 'pending');
}

function logPaymentCaptured(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_CAPTURED, payload, 'success');
}

function logPaymentFailed(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_FAILED, payload, 'failed', 'warn');
}

function logPaymentReconMismatch(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_RECON_MISMATCH, payload, 'mismatch', 'error');
}

function logPaymentRefundInitiated(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_REFUND_INITIATED, payload, 'pending');
}

function logPaymentRefunded(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_REFUNDED, payload, 'success');
}

function logPaymentTamperingAttempt(payload = {}) {
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_TAMPERING_ATTEMPT, payload, 'failed', 'error', 'critical');
}

function logWebhookSignatureMismatch(provider = 'razorpay', payload = {}) {
  incrementWebhookVerificationFailure(provider);
  logPaymentEvent(PAYMENT_EVENTS.PAYMENT_TAMPERING_ATTEMPT, {
    provider,
    reason: 'webhook_signature_mismatch',
    ...payload,
  }, 'failed', 'error', 'critical');
}

module.exports = {
  PAYMENT_EVENTS,
  logPaymentInitiated,
  logPaymentOrderCreated,
  logPaymentCallbackReceived,
  logPaymentSignatureVerified,
  logPaymentCaptureRequested,
  logPaymentCaptured,
  logPaymentFailed,
  logPaymentReconMismatch,
  logPaymentRefundInitiated,
  logPaymentRefunded,
  logPaymentTamperingAttempt,
  logWebhookSignatureMismatch,
};
