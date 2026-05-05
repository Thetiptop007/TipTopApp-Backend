const mongoose = require('mongoose');
const logger = require('../utils/logger');

const DEFAULT_DEV_MONGO_URI = 'mongodb://127.0.0.1:27017/tiptop_dev';
const shouldEnableMongoDebug = String(process.env.MONGOOSE_DEBUG || '').toLowerCase() === 'true';

const maskMongoUri = (uri) => {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch (error) {
    return uri.replace(/\/\/.*@/, '//***:***@');
  }
};

const getMongoConnectionFailureReason = (error) => {
  if (!error) {
    return 'Unknown MongoDB connection error';
  }

  const parts = [error.message || 'Unknown error'];

  if (error.code) parts.push(`code=${error.code}`);
  if (error.syscall) parts.push(`syscall=${error.syscall}`);
  if (error.hostname) parts.push(`hostname=${error.hostname}`);
  if (error.address) parts.push(`address=${error.address}`);
  if (error.port) parts.push(`port=${error.port}`);

  return parts.join(' | ');
};

const buildMongoCandidates = () => {
  const candidates = [];

  

  if (process.env.MONGODB_URI) {
    candidates.push(process.env.MONGODB_URI);
  }

  if (process.env.MONGODB_URI_FALLBACK) {
    candidates.push(process.env.MONGODB_URI_FALLBACK);
  }

  if (process.env.NODE_ENV !== 'production') {
    candidates.push(DEFAULT_DEV_MONGO_URI);
  }

  return [...new Set(candidates.filter(Boolean))];
};

const shouldEnableRetryWrites = (uri) => {
  if (String(process.env.MONGO_RETRY_WRITES || '').toLowerCase() === 'true') {
    return true;
  }

  return /replicaSet=|mongodb\+srv:/.test(String(uri || ''));
};

/**
 * Connect to MongoDB, falling back to local development URIs when needed.
 */
const connectDB = async () => {
  const candidates = buildMongoCandidates();
  let lastError;

  if (candidates.length === 0) {
    throw new Error('No MongoDB connection string configured. Set MONGODB_URI.');
  }

  for (const uri of candidates) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        retryWrites: shouldEnableRetryWrites(uri),
        w: 'majority',
      });

      logger.db('DB_CONNECTED', 'Database connection established', {
        host: conn.connection.host,
        port: conn.connection.port,
        database: conn.connection.name,
      });

      if (process.env.NODE_ENV === 'development' && shouldEnableMongoDebug) {
        mongoose.set('debug', (collectionName, method, query, doc) => {
          try {
            logger.db('DB_QUERY', 'MongoDB debug query executed', {
              collectionName,
              method,
              query,
              doc: doc || null,
            }, { level: 'debug' });
          } catch (err) {
            logger.db('DB_QUERY', 'MongoDB debug query executed', {
              collectionName,
              method,
              querySummary: 'could not stringify query',
            }, { level: 'debug' });
          }
        });
        logger.db('DB_DEBUG_ENABLED', 'MongoDB debug logging enabled', {}, { level: 'debug' });
      }

      // Connection event handlers - only log critical events
      let reconnectAttempts = 0;

      mongoose.connection.on('error', (err) => {
        logger.db('DB_ERROR', 'MongoDB connection error', { errorMessage: err.message }, { level: 'error' });
      });

      mongoose.connection.on('disconnected', () => {
        reconnectAttempts++;
        logger.db('DB_DISCONNECTED', 'MongoDB disconnected; attempting reconnect', { attempt: reconnectAttempts }, { level: 'warn' });
      });

      mongoose.connection.on('reconnected', () => {
        logger.db('DB_RECONNECTED', 'MongoDB reconnected successfully');
        reconnectAttempts = 0;
      });

      // Remove the redundant 'connected' handler to avoid duplicate logs
      return conn;
    } catch (error) {
      lastError = error;
      logger.db('DB_CONNECT_FAILED_URI', 'MongoDB connection failed for candidate', { uri: maskMongoUri(uri), reason: getMongoConnectionFailureReason(error) }, { level: 'warn' });

      if (error?.stack) {
        logger.db('DB_CONNECT_FAILED', 'MongoDB connection stack captured', {
          uri: maskMongoUri(uri),
          stack: error.stack,
        }, { level: 'debug' });
      }
    }
  }
  logger.db('DB_ALL_ATTEMPTS_FAILED', 'All MongoDB connection attempts failed', { candidatesCount: candidates.length }, { level: 'error' });
  throw lastError;
};

/**
 * Close database connection gracefully
 */
const closeDB = async () => {
  try {
    await mongoose.connection.close();
    logger.db('DB_CONNECTION_CLOSED', 'MongoDB connection closed');
  } catch (error) {
    logger.db('DB_CLOSE_ERROR', 'Error closing MongoDB connection', { errorMessage: error.message }, { level: 'error' });
  }
};

module.exports = { connectDB, closeDB };
