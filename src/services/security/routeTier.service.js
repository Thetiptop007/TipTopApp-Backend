/**
 * Route Sensitivity Classifier
 * Categorizes routes into tiers for risk-based rate limiting
 */

const ROUTE_TIERS = {
  PUBLIC_LIGHT: 'PUBLIC_LIGHT',          // menu, categories, offers
  PUBLIC_MEDIUM: 'PUBLIC_MEDIUM',        // search, filters, lists
  AUTH_SENSITIVE: 'AUTH_SENSITIVE',      // login, register, refresh, forgot-password
  ADMIN_SENSITIVE: 'ADMIN_SENSITIVE',    // dashboard, analytics, logs
  EXPENSIVE: 'EXPENSIVE',                // heavy reports, aggregations
};

const ROUTE_CONFIG = {
  // Public light tier - generous limits
  [ROUTE_TIERS.PUBLIC_LIGHT]: {
    requestsPerMin: 100,
    requestsPerHour: 1000,
    requestCost: 1,
    windowMs: 60000,
    cooldownMs: 5000,
    patterns: [
      '/api/v1/menu',
      '/api/v1/categories',
      '/api/v1/offers',
    ],
  },

  // Public medium - stricter
  [ROUTE_TIERS.PUBLIC_MEDIUM]: {
    requestsPerMin: 30,
    requestsPerHour: 300,
    requestCost: 2,
    windowMs: 60000,
    cooldownMs: 10000,
    patterns: [
      '/api/v1/menu/search',
      '/api/v1/categories/search',
      '/api/v1/offers/search',
    ],
  },

  // Auth sensitive - very strict
  [ROUTE_TIERS.AUTH_SENSITIVE]: {
    requestsPerMin: 5,
    requestsPerHour: 20,
    requestCost: 5,
    windowMs: 15 * 60000,
    cooldownMs: 30000,
    patterns: [
      '/api/v1/auth/admin/login',
      '/api/v1/auth/customer/login',
      '/api/v1/auth/customer/register',
      '/api/v1/auth/admin/refresh',
      '/api/v1/auth/customer/refresh',
      '/api/v1/auth/customer/forgot-password',
    ],
  },

  // Admin sensitive - strict, role-based
  [ROUTE_TIERS.ADMIN_SENSITIVE]: {
    requestsPerMin: 30,
    requestsPerHour: 300,
    requestCost: 3,
    windowMs: 60000,
    cooldownMs: 5000,
    patterns: [
      '/api/v1/dashboard',
      '/api/v1/developer',
      '/api/v1/analytics',
    ],
  },

  // Expensive - very limited
  [ROUTE_TIERS.EXPENSIVE]: {
    requestsPerMin: 2,
    requestsPerHour: 10,
    requestCost: 10,
    windowMs: 15 * 60000,
    cooldownMs: 60000,
    patterns: [
      '/api/v1/dashboard/full',
      '/api/v1/business-insights',
      '/api/v1/developer/api-stats',
    ],
  },
};

/**
 * Get tier for a route
 */
function getRouteTier(path) {
  for (const [tier, config] of Object.entries(ROUTE_CONFIG)) {
    for (const pattern of config.patterns) {
      if (path.startsWith(pattern)) {
        return { tier, config };
      }
    }
  }

  // Default to public medium
  return {
    tier: ROUTE_TIERS.PUBLIC_MEDIUM,
    config: ROUTE_CONFIG[ROUTE_TIERS.PUBLIC_MEDIUM],
  };
}

/**
 * Get request cost (for budget-based throttling)
 */
function getRequestCost(path, method = 'GET') {
  const { config } = getRouteTier(path);
  
  // POST/PATCH/DELETE costs more
  let cost = config.requestCost;
  if (method === 'POST' || method === 'PATCH') cost *= 1.5;
  if (method === 'DELETE') cost *= 2;
  
  return cost;
}

module.exports = {
  ROUTE_TIERS,
  ROUTE_CONFIG,
  getRouteTier,
  getRequestCost,
};
