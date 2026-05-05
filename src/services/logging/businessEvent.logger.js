const logger = require('../../utils/logger');
const { incrementOrderCreated } = require('../metrics.service');

const businessLogger = logger.createDomainLogger('business', { fileName: 'business.log' });

const BUSINESS_EVENTS = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_ACCEPTED: 'ORDER_ACCEPTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  ORDER_REFUNDED: 'ORDER_REFUNDED',
  GUEST_ORDER_CREATED: 'GUEST_ORDER_CREATED',
  REFUND_ISSUED: 'REFUND_ISSUED',
  DELIVERY_ASSIGNED: 'DELIVERY_ASSIGNED',
  MENU_ITEM_UPDATED: 'MENU_ITEM_UPDATED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  OFFER_CHANGED: 'OFFER_CHANGED',
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
};

function logBusinessEvent(event, payload = {}, level = 'info', severity = 'medium') {
  if (event === BUSINESS_EVENTS.ORDER_CREATED || event === BUSINESS_EVENTS.GUEST_ORDER_CREATED) {
    incrementOrderCreated(payload.placedBy || payload.source || 'unknown');
  }

  businessLogger[level](
    {
      logType: 'business',
      event,
      severity,
      category: 'business_event',
      ...payload,
    },
    event
  );
}

module.exports = {
  businessLogger,
  BUSINESS_EVENTS,
  logBusinessEvent,
};
