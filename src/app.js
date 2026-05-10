const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const logger = require('./utils/logger');
const AppError = require('./utils/AppError');
const { errorHandler } = require('./middlewares/errorHandler.middleware');
const { requestContextMiddleware } = require('./middlewares/requestContext.middleware');
const { metricsHandler } = require('./services/metrics.service');
const suspiciousRequests = require('./middlewares/suspiciousRequests');
const { logSecurityAudit } = require('./services/logging/securityAudit.logger');
const { getSecurityMiddlewareStack } = require('./services/security.service');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Do not expose Express fingerprint header
app.disable('x-powered-by');

// Trust proxy (important for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Request context + structured request logs (FAST - must be early)
app.use(requestContextMiddleware);

// Security HTTP headers (FAST)
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
    // HSTS only in production to avoid local HTTPS development issues
    hsts: isProduction
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    referrerPolicy: {
      policy: 'no-referrer',
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS configuration (FAST)
const corsOptions = {
  origin: function (origin, callback) {
    const whitelist = process.env.CLIENT_URL
      ? process.env.CLIENT_URL.split(',').map(url => url.trim()).filter(url => url)
      : [];
    
    const isAllowedOrigin = !origin || 
      whitelist.includes(origin) || 
      (origin && whitelist.some(allowed => allowed.includes('*') && new RegExp('^' + allowed.replace(/\*/g, '.*') + '$').test(origin))) ||
      (origin && origin.includes('vercel.app')); // Keep vercel helper or remove if strictly dynamic

    if (isAllowedOrigin) {
      callback(null, true);
    } else {
      if (process.env.NODE_ENV === 'development') {
        logger.system('CORS_ORIGIN_ALLOWED_WITH_DEBUG_OVERRIDE', 'CORS origin allowed in development override', {
          origin,
        });
      } else {
        logger.system('CORS_ORIGIN_ALLOWED_WITH_OVERRIDE', 'Unknown origin allowed by override', {
          origin,
        }, { level: 'warn', severity: 'medium' });
      }
      callback(null, true); // Temporarily allow all origins for debugging
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key', 'X-Idempotency-Key', 'X-CSRF-Token', 'X-Request-Id', 'X-Token-Scope', 'X-Refresh-Token'],
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Body parser (FAST)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser (FAST)
app.use(cookieParser());

// Data sanitization against NoSQL injection (FAST)
app.use(mongoSanitize());

// Data sanitization against XSS (FAST)
app.use(xss());

// Compression (FAST)
app.use(compression());

// Serve static files (for APK downloads) - BEFORE heavy middleware
app.use('/downloads', express.static(path.join(__dirname, '../public/downloads'), {
  maxAge: '1d', // Cache for 1 day
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="TipTop.apk"');
    }
  }
}));

// Health check endpoint (FAST, NO MIDDLEWARE)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// Prometheus metrics endpoint (FAST, NO MIDDLEWARE)
app.get('/metrics', metricsHandler);

// Root route for platform probes (Render often checks "/") - FAST
app.get('/', (req, res) => {
  // Minimal root response to avoid leaking metadata
  res.status(200).json({ status: 'ok' });
});

// Use suspicious request middleware early - BEFORE SECURITY STACK (detects obvious abuse patterns)
app.use(suspiciousRequests);

app.get('/api/v1', (req, res) => {
  // If query params present that look like probe parameters, do not reveal metadata
  if (req.query && Object.keys(req.query).length > 0) {
    return res.status(404).json({ status: 'fail', message: 'Route not found' });
  }

  // Minimal health reply for API root
  return res.status(200).json({ status: 'ok' });
});

// **HEAVY SECURITY MIDDLEWARE** - Applied only to /api routes (rate limiting, abuse detection)
// This is the most expensive middleware, so it's applied only where needed
app.use('/api', ...getSecurityMiddlewareStack());

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
const getClientIp = require('./utils/getClientIp');
app.all('*', (req, res, next) => {
  const ip = getClientIp(req) || 'unknown';
  if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    logSecurityAudit('API_ROUTE_NOT_FOUND', {
      method: req.method,
      originalUrl: req.originalUrl,
      ip,
      userAgent: req.get('user-agent') || '',
    }, { level: 'warn', severity: 'medium' });
  }
  // Do not leak requested URL or framework details
  next(new AppError('Route not found', 404));
});

// Global error handling middleware
app.use(errorHandler);

module.exports = app;
