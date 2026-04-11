const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const AppError = require('./utils/AppError');
const { errorHandler } = require('./middlewares/errorHandler.middleware');
const cache = require('./utils/cache');

const app = express();

morgan.format('tiptop-dev', ':method :url :status :response-time[0]ms');
morgan.format('tiptop-prod', ':remote-addr - - [:date[clf]] ":method :url HTTP/:http-version" :status');

// In-memory cache is ready to use (no connection needed)
logger.info('In-memory cache system initialized');

// Trust proxy (important for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // In production, allow specific origins from CLIENT_URL
    const whitelist = process.env.CLIENT_URL
      ? process.env.CLIENT_URL.split(',').map(url => url.trim()).filter(url => url)
      : [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:3000',
          'https://the-tip-top-git-feature-admin-thetiptop007s-projects.vercel.app',
          'https://the-tip-top-thetiptop007s-projects.vercel.app',
          'https://the-tip-top.vercel.app'
        ];
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin || whitelist.indexOf(origin) !== -1 || whitelist.some(allowed => origin && origin.includes('vercel.app'))) {
      callback(null, true);
    } else {
      if (process.env.NODE_ENV === 'development') {
        logger.info(`✅ [CORS] Allowed origin: ${origin}`);
      } else {
        logger.warn(`⚠️  [CORS] Unknown origin (allowed for debugging): ${origin}`);
      }
      callback(null, true); // Temporarily allow all origins for debugging
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key', 'X-Idempotency-Key'],
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

const windowMinutes = Number(process.env.RATE_LIMIT_WINDOW || 15);
const maxRequests = Number(process.env.RATE_LIMIT_MAX || 100);
const apiLimiter = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many requests, please try again later.',
  },
});
app.use('/api', apiLimiter);

// HTTP request logger
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('tiptop-dev'));
} else {
  app.use(morgan('tiptop-prod'));
}

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser());

// Data sanitization against NoSQL injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Compression
app.use(compression());

// Serve static files (for APK downloads)
app.use('/downloads', express.static(path.join(__dirname, '../public/downloads'), {
  maxAge: '1d', // Cache for 1 day
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="TipTop.apk"');
    }
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// Root route for platform probes (Render often checks "/")
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'TipTop backend is running',
    health: '/health',
    apiBase: '/api/v1',
  });
});

app.get('/api/v1', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'TipTop API base endpoint',
    test: '/api/v1/test',
  });
});

// API routes
const authRoutes = require('./routes/auth.routes');
const menuRoutes = require('./routes/menu.routes');
const categoryRoutes = require('./routes/category.routes');
const orderRoutes = require('./routes/order.routes');
const userRoutes = require('./routes/user.routes');
const deliveryRoutes = require('./routes/delivery.routes');
const settingsRoutes = require('./routes/settings.routes');
const addressRoutes = require('./routes/address.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const errorRoutes = require('./routes/error.routes');
const developerRoutes = require('./routes/developer.routes');
const aiRoutes = require('./routes/ai.routes');
const offerRoutes = require('./routes/offer.routes');

// Legacy compatibility routes for old admin panel paths
const adminOrdersRoutes = require('./routes/admin-orders.routes');
const adminMenuItemsRoutes = require('./routes/admin-menu-items.routes');

// Mount routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/delivery', deliveryRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/errors', errorRoutes);
app.use('/api/v1/developer', developerRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/offers', offerRoutes);

// Mount legacy compatibility routes (for old web admin panel)
app.use('/api/v1/admin/orders', adminOrdersRoutes);
app.use('/api/v1/admin/menu-items', adminMenuItemsRoutes);



// Test route
app.get('/api/v1/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'The-Tip-Top API is running!',
    version: process.env.API_VERSION || 'v1',
  });
});

// Handle 404 - Route not found
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

// Global error handling middleware
app.use(errorHandler);

module.exports = app;
