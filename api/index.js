const app = require('../src/app');
const { connectDB } = require('../src/config/database');
const { initializeSecurityLayers } = require('../src/services/security.service');

// Cache database connection across serverless function invocations
let isInitialized = false;

module.exports = async (req, res) => {
  if (!isInitialized) {
    try {
      await initializeSecurityLayers();
      await connectDB();
      isInitialized = true;
    } catch (err) {
      console.error('Serverless initialization failed:', err);
      return res.status(500).json({
        status: 'error',
        message: 'Database initialization failed. Please retry.',
      });
    }
  }

  return app(req, res);
};
