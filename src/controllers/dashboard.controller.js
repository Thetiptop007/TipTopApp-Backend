const catchAsync = require('../utils/catchAsync');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const {
  DASHBOARD_CACHE_KEYS,
  DASHBOARD_CACHE_TTL_SECONDS,
  buildDashboardBundle,
} = require('../services/dashboard.service');

const isDev = process.env.NODE_ENV === 'development';

const logDevPayload = (label, payload) => {
  if (!isDev) {
    return;
  }

  logger.info(`[ANALYTICS_DEBUG] ${label} ${JSON.stringify(payload)}`);
};

const setDashboardBundleCache = async (bundle) => {
  await Promise.all([
    cache.set(DASHBOARD_CACHE_KEYS.stats, bundle.stats, DASHBOARD_CACHE_TTL_SECONDS),
    cache.set(DASHBOARD_CACHE_KEYS.insights, bundle.insights, DASHBOARD_CACHE_TTL_SECONDS),
    cache.set(DASHBOARD_CACHE_KEYS.full, bundle, DASHBOARD_CACHE_TTL_SECONDS),
  ]);
};

const getOrBuildDashboardBundle = async () => {
  const cachedFull = await cache.get(DASHBOARD_CACHE_KEYS.full);
  if (cachedFull) {
    return { bundle: cachedFull, fromFullCache: true };
  }

  if (process.env.NODE_ENV === 'development') {
    logger.info('[DASHBOARD_DEBUG] getOrBuildDashboardBundle - cache miss, building bundle');
  }

  const bundle = await buildDashboardBundle();
  await setDashboardBundleCache(bundle);

  return { bundle, fromFullCache: false };
};

/**
 * @desc    Get dashboard statistics using optimized MongoDB queries
 * @route   GET /api/v1/dashboard/stats
 * @access  Private/Admin
 */
exports.getDashboardStats = catchAsync(async (req, res, next) => {
  const startedAt = Date.now();

  if (process.env.NODE_ENV === 'development') {
    logger.info(`[DASHBOARD_DEBUG] dashboard/stats entry - user:${req.user?.email || req.user?._id || 'unknown'}`);
  }

  const cachedStats = await cache.get(DASHBOARD_CACHE_KEYS.stats);

  if (cachedStats) {
    logDevPayload('dashboard/stats (cached)', {
      cache: true,
      totalCustomers: cachedStats.totalCustomers,
      totalOrders: cachedStats.totalOrders,
      monthlyTarget: cachedStats.monthlyTarget,
      recentOrdersCount: cachedStats.recentOrders?.length || 0,
    });

    return res.status(200).json({
      status: 'success',
      data: cachedStats,
    });
  }

  const { bundle, fromFullCache } = await getOrBuildDashboardBundle();

  logDevPayload('dashboard/stats', {
    cache: false,
    fullCacheUsed: fromFullCache,
    totalCustomers: bundle.stats.totalCustomers,
    totalOrders: bundle.stats.totalOrders,
    monthlyTarget: bundle.stats.monthlyTarget,
    recentOrdersCount: bundle.stats.recentOrders?.length || 0,
  });

  if (process.env.NODE_ENV === 'development') {
    logger.info(`[DASHBOARD_DEBUG] dashboard/stats response ${JSON.stringify({
      cache: false,
      fullCacheUsed: fromFullCache,
      durationMs: Date.now() - startedAt,
      totalCustomers: bundle.stats.totalCustomers,
      totalOrders: bundle.stats.totalOrders,
    })}`);
  }

  return res.status(200).json({
    status: 'success',
    data: bundle.stats,
  });
});

/**
 * @desc    Get business insights data (optimized + cached)
 * @route   GET /api/v1/dashboard/business-insights
 * @access  Private/Admin
 */
exports.getBusinessInsights = catchAsync(async (req, res, next) => {
  const startedAt = Date.now();
  const cached = await cache.get(DASHBOARD_CACHE_KEYS.insights);

  if (cached) {
    logDevPayload('dashboard/business-insights (cached)', {
      cache: true,
      summary: cached.summary,
      yearlyPoints: cached.trends?.yearly?.length || 0,
      monthlyYears: Object.keys(cached.trends?.monthlyByYear || {}),
    });

    return res.status(200).json({
      status: 'success',
      data: cached,
      meta: { cached: true },
    });
  }

  const { bundle, fromFullCache } = await getOrBuildDashboardBundle();

  logDevPayload('dashboard/business-insights', {
    cache: false,
    fullCacheUsed: fromFullCache,
    summary: bundle.insights.summary,
    yearlyPoints: bundle.insights.trends?.yearly?.length || 0,
    monthlyYears: Object.keys(bundle.insights.trends?.monthlyByYear || {}),
  });

  if (process.env.NODE_ENV === 'development') {
    logger.info(`[DASHBOARD_DEBUG] dashboard/business-insights response ${JSON.stringify({
      cache: false,
      fullCacheUsed: fromFullCache,
      durationMs: Date.now() - startedAt,
      todayOrders: bundle.insights.summary.todayOrders,
    })}`);
  }

  return res.status(200).json({
    status: 'success',
    data: bundle.insights,
    meta: { cached: false },
  });
});

/**
 * @desc    Get full dashboard payload in one call (stats + insights)
 * @route   GET /api/v1/dashboard/full
 * @access  Private/Admin
 */
exports.getDashboardFull = catchAsync(async (req, res, next) => {
  const startedAt = Date.now();
  const cachedFull = await cache.get(DASHBOARD_CACHE_KEYS.full);

  if (cachedFull) {
    logDevPayload('dashboard/full (cached)', {
      cache: true,
      totalOrders: cachedFull.stats?.totalOrders,
      todayOrders: cachedFull.insights?.summary?.todayOrders,
    });

    return res.status(200).json({
      status: 'success',
      data: cachedFull,
      meta: { cached: true },
    });
  }

  const bundle = await buildDashboardBundle();
  await setDashboardBundleCache(bundle);

  logDevPayload('dashboard/full', {
    cache: false,
    totalOrders: bundle.stats.totalOrders,
    todayOrders: bundle.insights.summary.todayOrders,
  });

  if (process.env.NODE_ENV === 'development') {
    logger.info(`[DASHBOARD_DEBUG] dashboard/full response ${JSON.stringify({
      cache: false,
      durationMs: Date.now() - startedAt,
      totalOrders: bundle.stats.totalOrders,
      todayOrders: bundle.insights.summary.todayOrders,
    })}`);
  }

  return res.status(200).json({
    status: 'success',
    data: bundle,
    meta: { cached: false },
  });
});
