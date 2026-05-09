require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('./src/utils/logger');
const { connectDB } = require('./src/config/database');
const cache = require('./src/utils/cache');
const { initializeSecurityLayers, shutdownSecurity } = require('./src/services/security.service');
const { LOG_EVENTS, LOG_SEVERITY } = require('./src/constants/log-events');
const { initializeSocket } = require('./src/utils/socket');

const app = require('./src/app');

const PORT = process.env.PORT || 5001;
let server;
let isShuttingDown = false;

logger.system(LOG_EVENTS.SYSTEM.SERVER_BOOT_START, 'Server boot sequence started', {
  nodeVersion: process.version,
  processId: process.pid,
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.system(LOG_EVENTS.SYSTEM.UNCAUGHT_EXCEPTION, 'Uncaught exception encountered', {
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack,
  }, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
  
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// Monitor process memory usage in production only
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  setInterval(() => {
  const memUsage = process.memoryUsage();
  const rssMb = memUsage.rss / 1024 / 1024;
  const heapUsedMb = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMb = memUsage.heapTotal / 1024 / 1024;
  const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    if (rssMb > 512 && heapPercent > 92) {
      logger.system('MEMORY_PRESSURE_DETECTED', 'Process memory pressure detected', {
        rssMb: Number(rssMb.toFixed(2)),
        heapUsedMb: Number(heapUsedMb.toFixed(2)),
        heapTotalMb: Number(heapTotalMb.toFixed(2)),
        heapPercent: Number(heapPercent.toFixed(2)),
      }, { level: 'warn', severity: LOG_SEVERITY.HIGH });
    }
  }, 60000);
}

const startServer = async () => {
  try {
    // Validate critical environment variables on startup
    const criticalEnvVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
    const missingVars = criticalEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      logger.auth(LOG_EVENTS.AUTH.JWT_ENV_MISSING, 'Required JWT environment variables are missing', {
        missingVars,
      }, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
      
      if (process.env.NODE_ENV === 'production') {
        logger.system('BOOT_ABORTED', 'Server boot aborted due to missing JWT configuration', {}, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
        process.exit(1);
      } else {
        logger.system('CONFIG_FALLBACK_ACTIVE', 'Development fallback configuration is active', {}, { level: 'warn', severity: LOG_SEVERITY.MEDIUM });
      }
    } else {
      logger.auth(LOG_EVENTS.AUTH.JWT_ENV_VALIDATED, 'JWT environment configuration validated');
    }

    logger.system(LOG_EVENTS.SYSTEM.CONFIG_VALIDATED, 'Configuration validated');

    logger.security(LOG_EVENTS.SECURITY.ABUSE_PROTECTION_INIT, 'Initializing abuse protection layers');
    await initializeSecurityLayers();

    logger.db(LOG_EVENTS.DB.DB_CONNECT_START, 'Connecting to database');
    await connectDB();

    logger.db(LOG_EVENTS.DB.DB_CONNECTED, 'Database connection established', {
      database: mongoose.connection.name,
    });
    logger.system(LOG_EVENTS.SYSTEM.DEPENDENCIES_READY, 'Runtime dependencies ready');
  } catch (err) {
    logger.db(LOG_EVENTS.DB.DB_CONNECT_FAILED, 'Database connection failed', {
      errorMessage: err.message,
    }, { level: 'error', severity: LOG_SEVERITY.HIGH });

    if (process.env.NODE_ENV === 'production') {
      logger.system('BOOT_ABORTED', 'Server boot aborted due to database failure', {}, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
      process.exit(1);
    }

    logger.system('DEGRADED_MODE', 'Starting without database connectivity in development', {}, { level: 'warn', severity: LOG_SEVERITY.MEDIUM });
  }

  server = app.listen(PORT, () => {
    logger.system(LOG_EVENTS.SYSTEM.SERVER_STARTED, 'Server started', {
      port: Number(PORT),
    });
  });

  // Initialize Socket.IO
  initializeSocket(server);

  // Log if server closes unexpectedly
  server.on('close', () => {
    if (!isShuttingDown) {
      logger.system(LOG_EVENTS.SYSTEM.SERVER_CLOSE_UNEXPECTED, 'Server closed unexpectedly', {}, { level: 'error', severity: LOG_SEVERITY.HIGH });
    }
  });

  server.on('error', (err) => {
    logger.system(LOG_EVENTS.SYSTEM.SERVER_RUNTIME_ERROR, 'Server runtime error occurred', {
      errorMessage: err.message,
      errorCode: err.code || null,
    }, { level: 'error', severity: LOG_SEVERITY.HIGH });
    if (err.code === 'EADDRINUSE') {
      logger.system('PORT_IN_USE', 'Configured server port is already in use', {
        port: Number(PORT),
      }, { level: 'error', severity: LOG_SEVERITY.HIGH });
    }
  });
};

startServer().catch((err) => {
  logger.system('SERVER_START_FAILED', 'Failed to start server', {
    errorMessage: err.message,
  }, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.system(LOG_EVENTS.SYSTEM.UNHANDLED_REJECTION, 'Unhandled promise rejection encountered', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : 'N/A',
  }, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
  
  setTimeout(() => {
    if (server) {
      server.close(() => {
        logger.system('SERVER_CLOSED_AFTER_REJECTION', 'Server closed after unhandled rejection', {}, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
        process.exit(1);
      });
    } else {
      process.exit(1);
    }
  }, 5000);
});

// Graceful shutdown handlers
const gracefulShutdown = (signal) => {
  return () => {
    if (isShuttingDown) {
      logger.system('SHUTDOWN_FORCE_EXIT', 'Shutdown signal received again, forcing exit', {
        signal,
      }, { level: 'warn', severity: LOG_SEVERITY.HIGH });
      process.exit(1);
    }

    isShuttingDown = true;
    logger.system(LOG_EVENTS.SYSTEM.SERVER_SHUTDOWN_START, 'Graceful shutdown started', {
      signal,
    }, { severity: LOG_SEVERITY.MEDIUM });

    // Close server from accepting new connections
    if (server) {
      server.close(async () => {
        logger.system('HTTP_SERVER_CLOSED', 'HTTP server closed');

        try {
          // Close database connections
          await mongoose.connection.close();
          logger.db(LOG_EVENTS.DB.DB_CONNECTION_CLOSED, 'Database connection closed');

          // Cleanup cache
          await cache.disconnect();
          logger.system(LOG_EVENTS.SYSTEM.CACHE_SHUTDOWN, 'Cache shutdown completed');

          // Shutdown security infrastructure (Redis, etc.)
          await shutdownSecurity();
          logger.system('SECURITY_SHUTDOWN_COMPLETE', 'Security infrastructure shutdown completed');
        } catch (err) {
          logger.system('SHUTDOWN_ERROR', 'Error during shutdown', {
            errorMessage: err.message,
          }, { level: 'error', severity: LOG_SEVERITY.HIGH });
        }

        logger.system(LOG_EVENTS.SYSTEM.SERVER_SHUTDOWN_COMPLETE, 'Application terminated gracefully');
        process.exit(0);
      });

      // Force exit after 30 seconds
      setTimeout(() => {
        logger.system('SHUTDOWN_TIMEOUT', 'Forced shutdown due to timeout', {}, { level: 'error', severity: LOG_SEVERITY.CRITICAL });
        process.exit(1);
      }, 30000);
    } else {
      logger.system('SERVER_NOT_INITIALIZED', 'Server was not initialized during shutdown', {}, { level: 'warn', severity: LOG_SEVERITY.MEDIUM });
      process.exit(0);
    }
  };
};

// Register graceful shutdown handlers
process.on('SIGTERM', gracefulShutdown('SIGTERM'));
process.on('SIGINT', gracefulShutdown('SIGINT'));

// Warning for when Node detects memory leaks
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    if (global.gc) {
      logger.system('GC_CYCLE_TRIGGERED', 'Manual garbage collection cycle triggered');
      global.gc();
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

module.exports = server;
