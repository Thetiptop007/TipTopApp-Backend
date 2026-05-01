const mongoose = require('mongoose');
const logger = require('../utils/logger');

const DEFAULT_DEV_MONGO_URI = 'mongodb://127.0.0.1:27017/tiptop_dev';

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
        retryWrites: true,
        w: 'majority',
      });

      logger.info(`✅ MongoDB Connected: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);

      if (process.env.NODE_ENV === 'development') {
        mongoose.set('debug', (collectionName, method, query, doc) => {
          try {
            logger.info(`[MONGODB_DEBUG] ${collectionName}.${method} ${JSON.stringify(query)} ${doc ? JSON.stringify(doc) : ''}`);
          } catch (err) {
            logger.info(`[MONGODB_DEBUG] ${collectionName}.${method} (could not stringify query)`);
          }
        });
      }

      // Connection event handlers - only log critical events
      let reconnectAttempts = 0;

      mongoose.connection.on('error', (err) => {
        logger.error(`❌ MongoDB connection error: ${err.message}`);
      });

      mongoose.connection.on('disconnected', () => {
        reconnectAttempts++;
        logger.warn(`⚠️  MongoDB disconnected (attempt ${reconnectAttempts}). Mongoose will attempt to reconnect...`);
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('✅ MongoDB reconnected successfully');
        reconnectAttempts = 0;
      });

      // Remove the redundant 'connected' handler to avoid duplicate logs
      return conn;
    } catch (error) {
      lastError = error;
      logger.warn(`⚠️  MongoDB connection failed for ${maskMongoUri(uri)}: ${getMongoConnectionFailureReason(error)}`);

      if (error?.stack) {
        logger.debug(`MongoDB connection stack for ${maskMongoUri(uri)}:\n${error.stack}`);
      }
    }
  }

  logger.error('❌ All MongoDB connection attempts failed. Available URIs:', candidates.length);
  throw lastError;
};

/**
 * Close database connection gracefully
 */
const closeDB = async () => {
  try {
    await mongoose.connection.close();
    logger.info('✅ MongoDB connection closed');
  } catch (error) {
    logger.error(`Error closing MongoDB connection: ${error.message}`);
  }
};

module.exports = { connectDB, closeDB };
