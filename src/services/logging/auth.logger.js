const logger = require('../../utils/logger');

const authLogger = logger.createDomainLogger('auth', { fileName: 'auth.log' });

function logAuthEvent(event, payload = {}, level = 'info', severity = 'medium') {
  authLogger[level](
    {
      logType: 'auth',
      event,
      severity,
      ...payload,
    },
    event
  );
}

module.exports = {
  authLogger,
  logAuthEvent,
};
