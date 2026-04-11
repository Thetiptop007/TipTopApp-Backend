require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('./src/utils/logger');
const { connectDB } = require('./src/config/database');
const cache = require('./src/utils/cache');

const app = require('./src/app');

const PORT = process.env.PORT || 5001;
let server;
let isShuttingDown = false;

// Log startup environment
logger.info('═══════════════════════════════════════════');
logger.info('🚀 BACKEND STARTUP');
logger.info('═══════════════════════════════════════════');
logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
logger.info(`Node Version: ${process.version}`);
logger.info(`Process ID: ${process.pid}`);
logger.info(`Available Memory: ${(require('os').totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB`);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('💥 UNCAUGHT EXCEPTION - CRITICAL');
  logger.error('Error Name:', err.name);
  logger.error('Error Message:', err.message);
  logger.error('Stack Trace:', err.stack);
  logger.error('Process will exit in 5 seconds...');
  
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// Monitor process memory usage and cache performance
const isProduction = process.env.NODE_ENV === 'production';
const monitorInterval = isProduction ? 60000 : 30000; // 60s in prod, 30s in dev

setInterval(() => {
  const memUsage = process.memoryUsage();
  const rssMb = memUsage.rss / 1024 / 1024;
  const heapUsedMb = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMb = memUsage.heapTotal / 1024 / 1024;
  const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  const externalMb = memUsage.external / 1024 / 1024;

  // Get cache statistics
  const cacheStats = cache.getStats?.() || {};

  // Format cache info
  const cacheInfo =
    cacheStats.size > 0
      ? `[Cache] Size: ${cacheStats.size} entries | Hits: ${cacheStats.hits} | Misses: ${cacheStats.misses} | Hit Rate: ${cacheStats.hitRate}`
      : '[Cache] Empty';

  // In development, always show stats
  if (!isProduction) {
    logger.info(
      `📊 Memory: RSS ${rssMb.toFixed(1)}MB | Heap ${heapUsedMb.toFixed(1)}MB/${heapTotalMb.toFixed(1)}MB (${heapPercent.toFixed(1)}%) | External ${externalMb.toFixed(1)}MB`
    );
    logger.info(cacheInfo);
  } else {
    // In production, warn only when memory is genuinely high
    if (rssMb > 512 && heapPercent > 92) {
      logger.warn(
        `⚠️ High memory usage: RSS ${rssMb.toFixed(2)}MB, Heap ${heapUsedMb.toFixed(2)}MB / ${heapTotalMb.toFixed(2)}MB (${heapPercent.toFixed(1)}%)`
      );
      logger.warn(cacheInfo);
    }
  }
}, monitorInterval);

const startServer = async () => {
  try {
    logger.info('📡 Connecting to MongoDB...');
    await connectDB();

    logger.info('✅ MongoDB Connected Successfully');
    logger.info(`Database: ${mongoose.connection.name}`);
  } catch (err) {
    logger.error('❌ MongoDB connection error:', err.message);

    if (process.env.NODE_ENV === 'production') {
      logger.error('Production mode: Cannot start without database. Exiting...');
      process.exit(1);
    }

    logger.warn('Development mode: Starting without MongoDB (data operations will fail)...');
  }

  server = app.listen(PORT, () => {
    logger.info('═══════════════════════════════════════════');
    logger.info(`✅ Server is RUNNING on port ${PORT}`);
    logger.info(`📍 Mode: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`📍 API: http://localhost:${PORT}/api/v1`);
    logger.info(`📍 Health: http://localhost:${PORT}/health`);
    logger.info('═══════════════════════════════════════════');
  });

  // Log if server closes unexpectedly
  server.on('close', () => {
    if (!isShuttingDown) {
      logger.error('🔴 Server closed unexpectedly (not via shutdown signal)');
    }
  });

  server.on('error', (err) => {
    logger.error('❌ Server error occurred:', err.message);
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use`);
    }
  });
};

startServer().catch((err) => {
  logger.error('❌ Failed to start server:', err.message);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 UNHANDLED PROMISE REJECTION - CRITICAL');
  logger.error('Reason:', reason instanceof Error ? reason.message : String(reason));
  logger.error('Stack:', reason instanceof Error ? reason.stack : 'N/A');
  logger.error('Process will exit in 5 seconds...');
  
  setTimeout(() => {
    if (server) {
      server.close(() => {
        logger.error('Server closed after unhandled rejection');
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
      logger.warn(`${signal} signal received again, force exiting...`);
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`═══════════════════════════════════════════`);
    logger.info(`📢 ${signal} signal received. Gracefully shutting down...`);
    logger.info(`═══════════════════════════════════════════`);

    // Close server from accepting new connections
    if (server) {
      server.close(async () => {
        logger.info('✅ HTTP server closed');

        try {
          // Close database connections
          await mongoose.connection.close();
          logger.info('✅ MongoDB connection closed');

          // Cleanup cache
          await cache.disconnect();
          logger.info('✅ Cache cleaned up');
        } catch (err) {
          logger.error('⚠️ Error during shutdown:', err.message);
        }

        logger.info('═══════════════════════════════════════════');
        logger.info('✨ Application terminated gracefully');
        logger.info('═══════════════════════════════════════════');
        process.exit(0);
      });

      // Force exit after 30 seconds
      setTimeout(() => {
        logger.error('❌ Forced shutdown: Graceful shutdown took too long');
        process.exit(1);
      }, 30000);
    } else {
      logger.warn('Server not initialized, exiting...');
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
      logger.debug('Running garbage collection...');
      global.gc();
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

module.exports = server;
