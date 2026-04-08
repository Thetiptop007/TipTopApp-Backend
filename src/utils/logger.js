const winston = require('winston');

// Optimized log format for production (minimal but traceable)
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Development format with colors
const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level}]: ${message}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  transports: [
    // Only log errors to file in production (to reduce disk I/O)
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      format: productionFormat,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: 'logs/exceptions.log',
      maxsize: 5242880,
      maxFiles: 3,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: 'logs/rejections.log',
      maxsize: 5242880,
      maxFiles: 3,
    }),
  ],
});

// Always add console for cloud platforms (Render reads from stdout/stderr)
logger.add(
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  })
);

// Stream for Morgan HTTP logger - only log errors and slow requests
logger.stream = {
  write: (message) => {
    // Only log if it's an error status code or warning
    if (message.includes(' 4') || message.includes(' 5') || message.includes('WARN')) {
      logger.info(message.trim());
    }
  },
};

// Monitor memory usage in production
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMb = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMb = memUsage.heapTotal / 1024 / 1024;
    const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    // On Node, heapTotal can be small and dynamic (especially after GC),
    // so percentage alone causes noisy false positives.
    const shouldWarn = heapPercent > 90 && heapUsedMb > 256;
    const shouldCritical = heapPercent > 95 && heapUsedMb > 384;

    if (shouldWarn) {
      logger.warn(`⚠️ HIGH MEMORY USAGE: ${heapPercent.toFixed(2)}% (${heapUsedMb.toFixed(2)}MB / ${heapTotalMb.toFixed(2)}MB)`);
    }

    if (shouldCritical) {
      logger.error(`🔴 CRITICAL MEMORY USAGE: ${heapPercent.toFixed(2)}% - Server may crash soon`);
    }
  }, 30000); // Check every 30 seconds
}

module.exports = logger;
