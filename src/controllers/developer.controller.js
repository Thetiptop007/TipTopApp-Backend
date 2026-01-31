const logger = require('../utils/logger');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

/**
 * Get system health status
 * GET /api/v1/developer/health
 */
exports.getSystemHealth = catchAsync(async (req, res, next) => {
  const healthData = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    system: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      usedMemory: os.totalmem() - os.freemem(),
      memoryUsagePercent: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2),
      loadAverage: os.loadavg(),
      hostname: os.hostname(),
    },
    process: {
      nodeVersion: process.version,
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      env: process.env.NODE_ENV,
    },
    services: {
      database: {
        status: 'connected', // Will be determined by actual connection
        type: 'MongoDB',
      },
      redis: {
        status: process.env.REDIS_URL ? 'configured' : 'not-configured',
      },
      email: {
        status: process.env.RESEND_API_KEY ? 'configured' : 'not-configured',
        provider: 'Resend',
      },
      firebase: {
        status: process.env.FIREBASE_SERVICE_ACCOUNT ? 'configured' : 'not-configured',
      },
    },
  };

  res.status(200).json({
    status: 'success',
    data: healthData,
  });
});

/**
 * Get application performance metrics
 * GET /api/v1/developer/performance
 */
exports.getPerformanceMetrics = catchAsync(async (req, res, next) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    memory: {
      heapUsed: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
      heapTotal: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB',
      external: (process.memoryUsage().external / 1024 / 1024).toFixed(2) + ' MB',
      rss: (process.memoryUsage().rss / 1024 / 1024).toFixed(2) + ' MB',
    },
    cpu: {
      user: (process.cpuUsage().user / 1000000).toFixed(2) + ' seconds',
      system: (process.cpuUsage().system / 1000000).toFixed(2) + ' seconds',
      loadAverage: os.loadavg().map(avg => avg.toFixed(2)),
    },
    uptime: {
      process: formatUptime(process.uptime()),
      system: formatUptime(os.uptime()),
    },
  };

  res.status(200).json({
    status: 'success',
    data: metrics,
  });
});

/**
 * Get application logs (real-time streaming support)
 * GET /api/v1/developer/logs
 */
exports.getLogs = catchAsync(async (req, res, next) => {
  const { level, limit = 100, tail = false } = req.query;
  
  // For SSE streaming
  if (tail === 'true' || tail === true) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    res.write('data: ' + JSON.stringify({ message: 'Connected to log stream' }) + '\n\n');
    
    // Set up log listener
    const logListener = (logData) => {
      res.write('data: ' + JSON.stringify(logData) + '\n\n');
    };
    
    logger.on('data', logListener);
    
    // Clean up on client disconnect
    req.on('close', () => {
      logger.removeListener('data', logListener);
      res.end();
    });
    
    return; // Keep connection open
  }
  
  // For regular log retrieval
  try {
    const logsDir = path.join(__dirname, '../../logs');
    const logFiles = {
      combined: path.join(logsDir, 'combined.log'),
      error: path.join(logsDir, 'error.log'),
    };
    
    const fileName = level === 'error' ? 'error.log' : 'combined.log';
    const filePath = logFiles[level === 'error' ? 'error' : 'combined'];
    
    let logs = [];
    
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      // Get last N lines
      const startIndex = Math.max(0, lines.length - parseInt(limit));
      logs = lines.slice(startIndex).map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return { message: line, timestamp: null };
        }
      });
    } catch (error) {
      logger.warn(`Failed to read log file: ${fileName}`, error.message);
    }
    
    res.status(200).json({
      status: 'success',
      results: logs.length,
      data: logs,
    });
  } catch (error) {
    logger.error('Error reading logs:', error);
    return next(new AppError('Failed to retrieve logs', 500));
  }
});

/**
 * Get error logs with filtering
 * GET /api/v1/developer/errors
 */
exports.getErrorLogs = catchAsync(async (req, res, next) => {
  const { limit = 50, critical = false } = req.query;
  
  try {
    const logsDir = path.join(__dirname, '../../logs');
    const errorLogPath = path.join(logsDir, 'error.log');
    
    let errors = [];
    
    try {
      const fileContent = await fs.readFile(errorLogPath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      // Get last N lines
      const startIndex = Math.max(0, lines.length - parseInt(limit));
      errors = lines.slice(startIndex).map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return { message: line, timestamp: null };
        }
      });
      
      // Filter critical errors if requested
      if (critical === 'true' || critical === true) {
        errors = errors.filter(err => 
          err.level === 'error' && 
          (err.message?.includes('Critical') || 
           err.message?.includes('Database') ||
           err.message?.includes('Payment'))
        );
      }
    } catch (error) {
      logger.warn('Failed to read error log file', error.message);
    }
    
    res.status(200).json({
      status: 'success',
      results: errors.length,
      data: errors,
    });
  } catch (error) {
    logger.error('Error reading error logs:', error);
    return next(new AppError('Failed to retrieve error logs', 500));
  }
});

/**
 * Get API performance statistics
 * GET /api/v1/developer/api-stats
 */
exports.getApiStats = catchAsync(async (req, res, next) => {
  // This would typically come from a monitoring service or database
  // For now, we'll provide basic statistics
  
  const stats = {
    timestamp: new Date().toISOString(),
    requests: {
      total: 0, // Would be tracked via middleware
      successful: 0,
      failed: 0,
    },
    responseTime: {
      average: 0, // ms
      p50: 0,
      p95: 0,
      p99: 0,
    },
    endpoints: [], // Top endpoints by usage
    errors: {
      rate: 0,
      recent: [],
    },
  };
  
  res.status(200).json({
    status: 'success',
    data: stats,
  });
});

/**
 * Clear logs
 * DELETE /api/v1/developer/logs
 */
exports.clearLogs = catchAsync(async (req, res, next) => {
  const { type = 'all' } = req.query;
  
  try {
    const logsDir = path.join(__dirname, '../../logs');
    const logFiles = {
      combined: path.join(logsDir, 'combined.log'),
      error: path.join(logsDir, 'error.log'),
    };
    
    if (type === 'all' || type === 'combined') {
      await fs.writeFile(logFiles.combined, '', 'utf-8');
      logger.info('Combined logs cleared by admin');
    }
    
    if (type === 'all' || type === 'error') {
      await fs.writeFile(logFiles.error, '', 'utf-8');
      logger.info('Error logs cleared by admin');
    }
    
    res.status(200).json({
      status: 'success',
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} logs cleared successfully`,
    });
  } catch (error) {
    logger.error('Error clearing logs:', error);
    return next(new AppError('Failed to clear logs', 500));
  }
});

/**
 * Test critical error email notification
 * POST /api/v1/developer/test-error-email
 */
exports.testErrorEmail = catchAsync(async (req, res, next) => {
  const emailService = require('../services/email.service');
  const { notifyCriticalError } = require('../utils/errorNotification');
  
  // Create a test error
  const testError = new Error('Test critical error from developer dashboard');
  testError.name = 'TestError';
  testError.code = 'TEST_ERROR';
  testError.stack = `TestError: Test critical error from developer dashboard
    at exports.testErrorEmail (/backend/src/controllers/developer.controller.js:250:21)
    at Layer.handle [as handle_request] (/backend/node_modules/express/lib/router/layer.js:95:5)`;
  
  const context = {
    source: 'Developer Dashboard',
    user: req.user,
    req: {
      method: 'POST',
      url: req.originalUrl,
      ip: req.ip,
    },
    timestamp: new Date().toISOString(),
  };
  
  try {
    await notifyCriticalError(testError, context);
    
    res.status(200).json({
      status: 'success',
      message: 'Test error email sent successfully. Check your email.',
    });
  } catch (error) {
    logger.error('Failed to send test error email:', error);
    return next(new AppError('Failed to send test error email', 500));
  }
});

/**
 * Get database statistics
 * GET /api/v1/developer/database-stats
 */
exports.getDatabaseStats = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  
  if (mongoose.connection.readyState !== 1) {
    return next(new AppError('Database not connected', 503));
  }
  
  try {
    const db = mongoose.connection.db;
    const stats = await db.stats();
    const collections = await db.listCollections().toArray();
    
    const collectionStats = [];
    for (const collection of collections) {
      try {
        const colStats = await db.collection(collection.name).stats();
        collectionStats.push({
          name: collection.name,
          count: colStats.count,
          size: (colStats.size / 1024 / 1024).toFixed(2) + ' MB',
          avgObjSize: colStats.avgObjSize,
          indexes: colStats.nindexes,
        });
      } catch (err) {
        logger.warn(`Could not get stats for collection ${collection.name}`);
      }
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        database: stats.db,
        collections: stats.collections,
        dataSize: (stats.dataSize / 1024 / 1024).toFixed(2) + ' MB',
        indexSize: (stats.indexSize / 1024 / 1024).toFixed(2) + ' MB',
        storageSize: (stats.storageSize / 1024 / 1024).toFixed(2) + ' MB',
        collectionDetails: collectionStats,
      },
    });
  } catch (error) {
    logger.error('Error getting database stats:', error);
    return next(new AppError('Failed to retrieve database statistics', 500));
  }
});

/**
 * Get environment configuration (sanitized)
 * GET /api/v1/developer/config
 */
exports.getConfig = catchAsync(async (req, res, next) => {
  // Return sanitized config (no sensitive data)
  const config = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    services: {
      database: process.env.MONGODB_URI ? 'configured' : 'not-configured',
      redis: process.env.REDIS_URL ? 'configured' : 'not-configured',
      email: process.env.RESEND_API_KEY ? 'configured' : 'not-configured',
      firebase: process.env.FIREBASE_SERVICE_ACCOUNT ? 'configured' : 'not-configured',
    },
    features: {
      errorEmails: process.env.RESEND_API_KEY && process.env.DEVELOPER_EMAIL ? 'enabled' : 'disabled',
      pushNotifications: process.env.FIREBASE_SERVICE_ACCOUNT ? 'enabled' : 'disabled',
    },
  };
  
  res.status(200).json({
    status: 'success',
    data: config,
  });
});

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}
