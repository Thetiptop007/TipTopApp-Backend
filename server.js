require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('./src/utils/logger');
const { connectDB } = require('./src/config/database');

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

// Monitor process memory usage
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const used = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    const total = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
    const external = (memUsage.external / 1024 / 1024).toFixed(2);
    const uptime = process.uptime();
    
    // Only log memory warnings to reduce noise
    if (used > total * 0.85) {
      logger.warn(`⚠️ High memory usage: ${used}MB / ${total}MB (${((used / total) * 100).toFixed(1)}%)`);
    }
  }, 60000); // Check every 60 seconds
}

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
        } catch (err) {
          logger.error('⚠️ Error closing MongoDB:', err.message);
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
