const os = require('os');
const pkg = require('../../package.json');

const env = process.env.NODE_ENV || 'development';
const isDevelopment = env === 'development';
const isStaging = env === 'staging';
const isProduction = env === 'production';

const sampleRate = Math.min(
  1,
  Math.max(0, Number(process.env.REQUEST_LOG_SAMPLE_RATE || 0.2))
);

const logPrettyEnabled = String(process.env.LOG_PRETTY || '').toLowerCase() === 'true';

module.exports = {
  env,
  isDevelopment,
  isStaging,
  isProduction,
  serviceName: process.env.SERVICE_NAME || 'tiptop-backend',
  serviceVersion: process.env.SERVICE_VERSION || pkg.version || '0.0.0',
  hostname: os.hostname(),
  // Production: warn/error only. Staging: info. Dev: debug. Can override with LOG_LEVEL env var.
  logLevel: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : isStaging ? 'info' : 'warn'),
  logPrettyEnabled,
  enableSampling: isProduction,
  sampleRate,
};
