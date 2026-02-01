const User = require('../models/User');
const Order = require('../models/Order');
const catchAsync = require('../utils/catchAsync');

/**
 * @desc    Get dashboard statistics using optimized MongoDB queries
 * @route   GET /api/v1/dashboard/stats
 * @access  Private/Admin
 */
exports.getDashboardStats = catchAsync(async (req, res, next) => {
  // Use parallel execution with Promise.all for better performance
  const [totalCustomers, totalOrders, recentOrders, monthlySales, highestMonthlySale, currentMonthSales] = await Promise.all([
    // Count only active customers (exclude soft-deleted users)
    User.countDocuments({ role: 'customer', isActive: { $ne: false } }),
    Order.countDocuments(),
    
    // Fetch 5 most recent orders with only required fields
    Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderNumber items pricing status')
      .lean(),
    
    // Calculate monthly sales using aggregation
    Order.aggregate([
      {
        $match: {
          status: { $nin: ['cancelled', 'rejected'] }, // Exclude only cancelled/rejected orders
          createdAt: {
            $gte: new Date(new Date().getFullYear(), 0, 1), // Start of current year
            $lte: new Date() // Current date
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          totalSales: { $sum: '$pricing.finalAmount' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]),
    
    // Get highest monthly sale ever (for target)
    Order.aggregate([
      {
        $match: {
          status: { $nin: ['cancelled', 'rejected'] }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalSales: { $sum: '$pricing.finalAmount' }
        }
      },
      {
        $sort: { totalSales: -1 }
      },
      {
        $limit: 1
      }
    ]),
    
    // Get current month's sales
    Order.aggregate([
      {
        $match: {
          status: { $nin: ['cancelled', 'rejected'] },
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            $lte: new Date()
          }
        }
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$pricing.finalAmount' }
        }
      }
    ])
  ]);

  // Transform orders to match frontend requirements
  const statusMap = {
    'PENDING': 'New',
    'pending': 'New',
    'ACCEPTED': 'Accepted',
    'accepted': 'Accepted',
    'PREPARING': 'Preparing',
    'preparing': 'Preparing',
    'READY': 'Ready',
    'ready': 'Ready',
    'OUT_FOR_DELIVERY': 'Ready',
    'out_for_delivery': 'Ready',
    'DELIVERED': 'Delivered',
    'delivered': 'Delivered',
    'CANCELLED': 'Canceled',
    'cancelled': 'Canceled',
    'REJECTED': 'Canceled',
    'rejected': 'Canceled'
  };

  const transformedOrders = recentOrders.map(order => {
    const firstItem = order.items[0];
    
    return {
      orderNumber: order.orderNumber,
      productName: firstItem?.name || 'N/A',
      productImage: firstItem?.image || '',
      itemCount: order.items.length,
      totalPrice: order.pricing?.finalAmount || 0,
      status: statusMap[order.status] || order.status
    };
  });

  // Transform monthly sales to array with all 12 months
  const monthlySalesArray = Array(12).fill(0);
  monthlySales.forEach(item => {
    monthlySalesArray[item._id - 1] = Math.round(item.totalSales);
  });

  // Calculate monthly target (highest monthly sale ever achieved)
  const monthlyTarget = highestMonthlySale.length > 0 
    ? Math.round(highestMonthlySale[0].totalSales) 
    : 100000; // Default target if no sales history

  // Get current month revenue
  const currentMonthRevenue = currentMonthSales.length > 0 
    ? Math.round(currentMonthSales[0].totalSales) 
    : 0;

  // Calculate progress percentage
  const progressPercentage = monthlyTarget > 0 
    ? Math.round((currentMonthRevenue / monthlyTarget) * 100) 
    : 0;

  res.status(200).json({
    status: 'success',
    data: {
      totalCustomers,
      totalOrders,
      recentOrders: transformedOrders,
      monthlySales: monthlySalesArray,
      monthlyTarget: {
        target: monthlyTarget,
        currentRevenue: currentMonthRevenue,
        progress: progressPercentage
      }
    }
  });
});
