const { AsyncLocalStorage } = require('async_hooks');

const requestContextStorage = new AsyncLocalStorage();

function runWithRequestContext(context, callback) {
  requestContextStorage.run(context, callback);
}

function getRequestContext() {
  return requestContextStorage.getStore() || {};
}

module.exports = {
  runWithRequestContext,
  getRequestContext,
};
