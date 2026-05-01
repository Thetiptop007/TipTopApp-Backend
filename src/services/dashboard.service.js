const Order = require('../models/Order');
const User = require('../models/User');
const logger = require('../utils/logger');

const isDev = process.env.NODE_ENV === 'development';

const logDevTiming = (label, payload) => {
  if (!isDev) {
    return;
  }

  logger.info(`[DASHBOARD_DEBUG] ${label} ${JSON.stringify(payload)}`);
};

const timedQuery = async (label, fn, payload = {}) => {
  const startedAt = Date.now();

  try {
    const result = await fn();

    if (isDev) {
      logDevTiming(`${label} success`, {
        durationMs: Date.now() - startedAt,
        ...payload,
      });
    }

    return result;
  } catch (error) {
    if (isDev) {
      logDevTiming(`${label} error`, {
        durationMs: Date.now() - startedAt,
        message: error.message,
        ...payload,
      });
    }

    throw error;
  }
};

const VALID_ORDER_FILTER = {
  status: { $nin: ['CANCELLED', 'REJECTED', 'cancelled', 'rejected'] },
};

const DASHBOARD_CACHE_TTL_SECONDS = 60;

const DASHBOARD_CACHE_KEYS = {
  stats: 'dashboard:stats:v1',
  insights: 'dashboard:insights:v1',
  full: 'dashboard:full:v1',
};

const STATUS_MAP = {
  PENDING: 'New',
  pending: 'New',
  ACCEPTED: 'Accepted',
  accepted: 'Accepted',
  PREPARING: 'Preparing',
  preparing: 'Preparing',
  READY: 'Ready',
  ready: 'Ready',
  OUT_FOR_DELIVERY: 'Ready',
  out_for_delivery: 'Ready',
  DELIVERED: 'Delivered',
  delivered: 'Delivered',
  CANCELLED: 'Canceled',
  cancelled: 'Canceled',
  REJECTED: 'Canceled',
  rejected: 'Canceled',
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const getDateBoundaries = (now = new Date()) => {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  return {
    now,
    startOfToday,
    startOfYesterday,
    startOfMonth,
    startOfYear,
  };
};

const pctChange = (current, previous) => {
  if (!previous || previous <= 0) {
    return current > 0 ? 100 : 0;
  }

  return ((current - previous) / previous) * 100;
};

const aggregateRevenueAndOrders = async (match) => {
  const rows = await timedQuery('aggregateRevenueAndOrders', () => Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$pricing.finalAmount' },
        orders: { $sum: 1 },
      },
    },
  ]), {
    hasCreatedAtRange: !!match.createdAt,
    statusFilter: Array.isArray(match.status?.$nin) ? match.status.$nin.length : 0,
  });

  return rows[0] || { revenue: 0, orders: 0 };
};

const countValidOrders = async (extraMatch = {}) => Order.countDocuments({
  ...VALID_ORDER_FILTER,
  ...extraMatch,
});

const getOverallAovAndOrders = async () => {
  const rows = await timedQuery('getOverallAovAndOrders', () => Order.aggregate([
    { $match: VALID_ORDER_FILTER },
    {
      $group: {
        _id: null,
        avgOrderValue: { $avg: '$pricing.finalAmount' },
        totalOrders: { $sum: 1 },
      },
    },
  ]));

  return rows[0] || { avgOrderValue: 0, totalOrders: 0 };
};

const getMonthlySalesForCurrentYear = async ({ startOfYear, now }) => {
  const rows = await timedQuery('getMonthlySalesForCurrentYear', () => Order.aggregate([
    {
      $match: {
        ...VALID_ORDER_FILTER,
        createdAt: {
          $gte: startOfYear,
          $lte: now,
        },
      },
    },
    {
      $group: {
        _id: { $month: '$createdAt' },
        totalSales: { $sum: '$pricing.finalAmount' },
      },
    },
    { $sort: { _id: 1 } },
  ]), {
    year: now.getFullYear(),
  });

  const monthlySales = Array(12).fill(0);
  rows.forEach((item) => {
    monthlySales[item._id - 1] = Math.round(item.totalSales || 0);
  });

  return monthlySales;
};

const getHighestMonthlySaleEver = async () => {
  const rows = await timedQuery('getHighestMonthlySaleEver', () => Order.aggregate([
    { $match: VALID_ORDER_FILTER },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        totalSales: { $sum: '$pricing.finalAmount' },
      },
    },
    { $sort: { totalSales: -1 } },
    { $limit: 1 },
  ]));

  return rows.length > 0 ? Math.round(rows[0].totalSales || 0) : 100000;
};

const getCurrentMonthRevenue = async ({ startOfMonth, now }) => {
  const rows = await timedQuery('getCurrentMonthRevenue', () => Order.aggregate([
    {
      $match: {
        ...VALID_ORDER_FILTER,
        createdAt: {
          $gte: startOfMonth,
          $lte: now,
        },
      },
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: '$pricing.finalAmount' },
      },
    },
  ]));

  return rows.length > 0 ? Math.round(rows[0].totalSales || 0) : 0;
};

const getRecentOrders = async (limit = 5) => {
  const rows = await timedQuery('getRecentOrders', () => Order.find(VALID_ORDER_FILTER)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('orderNumber items pricing status')
    .lean(), {
    limit,
  });

  return rows.map((order) => {
    const firstItem = order.items[0];

    return {
      orderNumber: order.orderNumber,
      productName: firstItem?.name || 'N/A',
      productImage: firstItem?.image || '',
      itemCount: order.items.length,
      totalPrice: order.pricing?.finalAmount || 0,
      status: STATUS_MAP[order.status] || order.status,
    };
  });
};

const getYearlyTrend = async () => {
  const rows = await timedQuery('getYearlyTrend', () => Order.aggregate([
    { $match: VALID_ORDER_FILTER },
    {
      $group: {
        _id: { $year: '$createdAt' },
        revenue: { $sum: '$pricing.finalAmount' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]));

  return rows.map((item) => ({
    label: String(item._id),
    revenue: Math.round(item.revenue || 0),
    orders: item.orders || 0,
  }));
};

const getMonthlyTrendByYear = async () => {
  const rows = await timedQuery('getMonthlyTrendByYear', () => Order.aggregate([
    { $match: VALID_ORDER_FILTER },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        revenue: { $sum: '$pricing.finalAmount' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]));

  const monthlyTrendByYear = {};

  rows.forEach((item) => {
    const year = String(item._id.year);
    const monthIndex = item._id.month - 1;

    if (!monthlyTrendByYear[year]) {
      monthlyTrendByYear[year] = MONTH_LABELS.map((month) => ({
        label: month,
        revenue: 0,
        orders: 0,
      }));
    }

    monthlyTrendByYear[year][monthIndex] = {
      label: MONTH_LABELS[monthIndex],
      revenue: Math.round(item.revenue || 0),
      orders: item.orders || 0,
    };
  });

  return monthlyTrendByYear;
};

const buildDashboardStats = async ({ now, startOfMonth, startOfYear }) => {
  const startedAt = Date.now();

  const [totalCustomers, totalOrders, recentOrders, monthlySales, monthlyTarget, currentMonthRevenue] = await Promise.all([
    timedQuery('countCustomers', () => User.countDocuments({ role: 'customer', isActive: { $ne: false } })),
    timedQuery('countValidOrders', () => countValidOrders()),
    getRecentOrders(5),
    getMonthlySalesForCurrentYear({ startOfYear, now }),
    getHighestMonthlySaleEver(),
    getCurrentMonthRevenue({ startOfMonth, now }),
  ]);

  const progress = monthlyTarget > 0 ? Math.round((currentMonthRevenue / monthlyTarget) * 100) : 0;

  const result = {
    totalCustomers,
    totalOrders,
    recentOrders,
    monthlySales,
    monthlyTarget: {
      target: monthlyTarget,
      currentRevenue: currentMonthRevenue,
      progress,
    },
  };

  logDevTiming('buildDashboardStats', {
    durationMs: Date.now() - startedAt,
    totalCustomers,
    totalOrders,
    recentOrdersCount: recentOrders.length,
    monthlyTarget,
    currentMonthRevenue,
  });

  return result;
};

const buildBusinessInsights = async ({ now, startOfToday, startOfYesterday }) => {
  const startedAt = Date.now();

  const [today, yesterday, overall, yearly, monthlyByYear] = await Promise.all([
    aggregateRevenueAndOrders({
      ...VALID_ORDER_FILTER,
      createdAt: { $gte: startOfToday, $lte: now },
    }),
    aggregateRevenueAndOrders({
      ...VALID_ORDER_FILTER,
      createdAt: { $gte: startOfYesterday, $lt: startOfToday },
    }),
    getOverallAovAndOrders(),
    getYearlyTrend(),
    getMonthlyTrendByYear(),
  ]);

  const result = {
    summary: {
      todayRevenue: Math.round(today.revenue || 0),
      todayOrders: today.orders || 0,
      todayAvgOrderValue: today.orders > 0 ? Math.round(today.revenue / today.orders) : 0,
      totalAvgOrderValue: Math.round(overall.avgOrderValue || 0),
      changes: {
        todayRevenuePct: Number(pctChange(today.revenue || 0, yesterday.revenue || 0).toFixed(1)),
        todayOrdersPct: Number(pctChange(today.orders || 0, yesterday.orders || 0).toFixed(1)),
      },
    },
    trends: {
      yearly,
      monthlyByYear,
    },
  };

  logDevTiming('buildBusinessInsights', {
    durationMs: Date.now() - startedAt,
    todayOrders: today.orders || 0,
    yearlyPoints: yearly.length,
    monthlyYears: Object.keys(monthlyByYear || {}).length,
  });

  return result;
};

const buildDashboardBundle = async () => {
  const startedAt = Date.now();
  const boundaries = getDateBoundaries();

  const [stats, insights] = await Promise.all([
    buildDashboardStats(boundaries),
    buildBusinessInsights(boundaries),
  ]);

  const result = {
    stats,
    insights,
  };

  logDevTiming('buildDashboardBundle', {
    durationMs: Date.now() - startedAt,
    statsOrders: stats.totalOrders,
    insightsTodayOrders: insights.summary.todayOrders,
  });

  return result;
};

module.exports = {
  VALID_ORDER_FILTER,
  DASHBOARD_CACHE_TTL_SECONDS,
  DASHBOARD_CACHE_KEYS,
  getDateBoundaries,
  aggregateRevenueAndOrders,
  countValidOrders,
  getOverallAovAndOrders,
  buildDashboardStats,
  buildBusinessInsights,
  buildDashboardBundle,
};