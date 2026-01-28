const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');
const Settings = require('../models/Settings');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { emitOrderUpdate, emitNewOrder } = require('../utils/socket');

/**
 * @desc    Get orders for admin management (TODAY tab)
 * @route   GET /api/v1/admin/orders/today
 * @access  Private/Admin
 */
exports.getTodayOrders = catchAsync(async (req, res, next) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Define active and inactive statuses (UPPERCASE to match DB)
  const activeStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];
  const inactiveStatuses = ['DELIVERED', 'CANCELLED', 'REJECTED'];

  // Fetch active orders WITH full details
  const activeOrders = await Order.find({
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: activeStatuses }
  })
    .select('orderNumber customer items pricing status createdAt deliveryAddress')
    .lean()
    .sort({ createdAt: -1 });

  // Fetch inactive orders WITHOUT details (summary only)
  const inactiveOrders = await Order.find({
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: inactiveStatuses }
  })
    .select('orderNumber customer.name customer.phone pricing.finalAmount status createdAt')
    .lean()
    .sort({ createdAt: -1 });

  // Transform active orders
  const transformedActiveOrders = activeOrders.map(order => {
    // Transform status to match UI (capitalize first letter)
    const statusMap = {
      'PENDING': 'New',
      'pending': 'New',
      'ACCEPTED': 'Accepted',
      'accepted': 'Accepted',
      'PREPARING': 'Preparing',
      'preparing': 'Preparing',
      'READY': 'Ready',
      'ready': 'Ready',
      'OUT_FOR_DELIVERY': 'Ready', // Group with Ready
      'out_for_delivery': 'Ready',
      'DELIVERED': 'Delivered',
      'delivered': 'Delivered',
      'CANCELLED': 'Canceled',
      'cancelled': 'Canceled',
      'REJECTED': 'Canceled',
      'rejected': 'Canceled'
    };

    return {
      id: order._id.toString(),
      orderId: order.orderNumber,
      customer: `${order.customer?.name || 'N/A'}`,
      phone: order.customer?.phone || 'N/A',
      items: order.items?.map(item => ({
        name: item.name,
        portion: item.portion || '',
        quantity: item.quantity,
        price: item.subtotal
      })) || [],
      itemCount: order.items?.length || 0,
      total: order.pricing?.finalAmount || 0,
      status: statusMap[order.status] || order.status,
      date: order.createdAt.toISOString().split('T')[0],
      time: order.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      address: {
        street: order.deliveryAddress?.street || '',
        city: order.deliveryAddress?.city || '',
        state: order.deliveryAddress?.state || '',
        zip: order.deliveryAddress?.zip || order.deliveryAddress?.postalCode || ''
      },
      image: order.items?.[0]?.image || ''
    };
  });

  // Transform inactive orders (summary only)
  const transformedInactiveOrders = inactiveOrders.map(order => {
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

    return {
      id: order._id.toString(),
      orderId: order.orderNumber,
      customer: `${order.customer?.name || 'N/A'}`,
      phone: order.customer?.phone || 'N/A',
      items: [], // Will be populated on expand
      itemCount: 0,
      total: order.pricing?.finalAmount || 0,
      status: statusMap[order.status] || order.status,
      date: order.createdAt.toISOString().split('T')[0],
      time: order.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    };
  });

  // Group by status (using transformed status names)
  const groupedOrders = {
    pending: transformedActiveOrders.filter(o => o.status === 'New'),
    accepted: transformedActiveOrders.filter(o => o.status === 'Accepted'),
    preparing: transformedActiveOrders.filter(o => o.status === 'Preparing'),
    ready: transformedActiveOrders.filter(o => o.status === 'Ready'),
    out_for_delivery: [], // Grouped with Ready
    delivered: transformedInactiveOrders.filter(o => o.status === 'Delivered'),
    cancelled: transformedInactiveOrders.filter(o => o.status === 'Canceled')
  };

  res.status(200).json({
    status: 'success',
    data: groupedOrders
  });
});

/**
 * @desc    Get all orders with pagination (ALL tab)
 * @route   GET /api/v1/admin/orders/all
 * @access  Private/Admin
 */
exports.getAllOrders = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Get total count
  const totalOrders = await Order.countDocuments();

  // Fetch orders (summary only but include items for count)
  const orders = await Order.find()
    .select('orderNumber customer.name customer.phone pricing.finalAmount status createdAt items')
    .lean()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  // Transform orders
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

  const transformedOrders = orders.map(order => ({
    id: order._id.toString(),
    orderId: order.orderNumber,
    customer: `${order.customer?.name || 'N/A'}`,
    phone: order.customer?.phone || 'N/A',
    items: [], // Will be populated on expand
    itemCount: order.items?.length || 0,
    total: order.pricing?.finalAmount || 0,
    status: statusMap[order.status] || order.status,
    date: order.createdAt.toISOString().split('T')[0],
    time: order.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }));

  res.status(200).json({
    status: 'success',
    data: {
      orders: transformedOrders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        limit
      }
    }
  });
});

/**
 * @desc    Get single order details (for expand)
 * @route   GET /api/v1/admin/orders/:id/details
 * @access  Private/Admin
 */
exports.getOrderDetails = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .select('orderNumber customer items pricing status createdAt deliveryAddress')
    .lean();

  if (!order) {
    return res.status(404).json({
      status: 'error',
      message: 'Order not found'
    });
  }

  // Transform to match UI format
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

  const transformedOrder = {
    id: order._id.toString(),
    orderId: order.orderNumber,
    customer: `${order.customer?.name || 'N/A'}`,
    phone: order.customer?.phone || 'N/A',
    items: order.items?.map(item => ({
      name: item.name,
      portion: item.portion || '',
      quantity: item.quantity,
      price: item.subtotal
    })) || [],
    itemCount: order.items?.length || 0,
    total: order.pricing?.finalAmount || 0,
    status: statusMap[order.status] || order.status,
    date: order.createdAt.toISOString().split('T')[0],
    time: order.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    address: {
      street: order.deliveryAddress?.street || '',
      city: order.deliveryAddress?.city || '',
      state: order.deliveryAddress?.state || '',
      zip: order.deliveryAddress?.zip || order.deliveryAddress?.postalCode || ''
    },
    image: order.items?.[0]?.image || ''
  };

  res.status(200).json({
    status: 'success',
    data: transformedOrder
  });
});

/**
 * @desc    Get minimal menu items for POS/Add Order page
 * @route   GET /api/v1/admin/orders/pos-menu
 * @access  Private/Admin
 */
exports.getPOSMenuItems = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50, category, search } = req.query;

  // Build query - only available items (isActive not checked, only isAvailable matters for ordering)
  const query = { isAvailable: true };

  if (category && category !== 'All') {
    query.categories = category;
  }

  if (search) {
    query.name = { $regex: search, $options: 'i' };
  }

  console.log('\n🔍 POS Menu Query:', JSON.stringify(query));
  
  // Get items with minimal fields for fast loading
  const items = await MenuItem.find(query)
    .select('name image categories priceVariants isAvailable')
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await MenuItem.countDocuments(query);
  
  // Log items by category
  const itemsByCategory = items.reduce((acc, item) => {
    const cat = item.categories?.find(c => c !== 'All') || 'Uncategorized';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});
  
  console.log('📦 POS Items Found:', items.length, 'Total:', total);
  console.log('📊 By Category:', itemsByCategory);
  
  // Check unavailable items for debugging
  if (!category || category === 'All' || category === 'Biryani') {
    const unavailableQuery = { isAvailable: false };
    if (category && category !== 'All') {
      unavailableQuery.categories = category;
    }
    const unavailableItems = await MenuItem.find(unavailableQuery).select('name categories isAvailable').lean();
    if (unavailableItems.length > 0) {
      console.log('⚠️  Unavailable Items (not shown in POS):', unavailableItems.length);
      unavailableItems.forEach(item => {
        console.log(`   - ${item.name} (${item.categories?.join(', ')})`);
      });
    }
  }
  console.log('');

  // Transform to POS format
  const posItems = items.map(item => {
    // Get the first category that's not "All"
    const actualCategory = item.categories?.find(cat => cat !== 'All') || item.categories?.[0] || 'Other';
    
    return {
      id: item._id.toString(),
      name: item.name,
      image: item.image || '/images/product/placeholder.jpg',
      category: actualCategory,
      priceVariants: item.priceVariants || [],
      isAvailable: item.isAvailable
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      items: posItems,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        limit: parseInt(limit)
      }
    }
  });
});

/**
 * @desc    Create order from admin panel (POS)
 * @route   POST /api/v1/admin/orders
 * @access  Private/Admin
 */
exports.createAdminOrder = catchAsync(async (req, res, next) => {
  console.log('\n📦 Creating admin order...');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  const {
    items,
    customer,
    deliveryAddress,
    orderType,
    paymentMethod = 'COD' // Cash On Delivery
  } = req.body;

  // Validate required fields
  if (!items || items.length === 0) {
    console.log('❌ Validation failed: No items');
    return next(new AppError('Please add items to the order', 400));
  }

  if (!customer || !customer.name || !customer.phone) {
    console.log('❌ Validation failed: Missing customer info');
    return next(new AppError('Customer name and phone are required', 400));
  }

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    console.log('❌ Validation failed: No delivery address for DELIVERY order');
    return next(new AppError('Delivery address is required for delivery orders', 400));
  }

  // Validate menu items
  console.log('🔍 Validating menu items...');
  const menuItemIds = items.map(item => item.menuItem);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } }).lean();

  if (menuItems.length !== menuItemIds.length) {
    console.log('❌ Some menu items not found');
    return next(new AppError('Some menu items not found', 404));
  }
  console.log(`✅ All ${menuItems.length} menu items found`);

  // Calculate pricing
  let itemsTotal = 0;
  const orderItems = items.map(item => {
    const menuItem = menuItems.find(m => m._id.toString() === item.menuItem);
    
    let itemPrice = item.price;
    // If price not provided, find it from variants or base price
    if (!itemPrice) {
      if (item.portion && menuItem.priceVariants) {
        const variant = menuItem.priceVariants.find(v => v.quantity === item.portion);
        itemPrice = variant ? variant.price : menuItem.price;
      } else {
        itemPrice = menuItem.price;
      }
    }

    const subtotal = itemPrice * item.quantity;
    itemsTotal += subtotal;

    return {
      menuItemId: menuItem._id,
      name: menuItem.name,
      image: menuItem.image,
      portion: item.portion || 'Regular',
      quantity: item.quantity,
      price: itemPrice,
      subtotal
    };
  });

  // Get settings for tax and delivery
  console.log('⚙️ Fetching settings...');
  const settings = await Settings.findOne();
  console.log('Settings found:', settings ? 'Yes' : 'No');
  
  // Use taxRate and deliveryCharge from Settings model
  const taxRate = settings?.taxRate || 0;
  const deliveryFee = orderType === 'DELIVERY' ? (settings?.deliveryCharge || 0) : 0;
  
  console.log(`💰 Pricing: itemsTotal=${itemsTotal}, taxRate=${taxRate}%, deliveryFee=${deliveryFee}`);

  const tax = (itemsTotal * taxRate) / 100;
  const finalAmount = itemsTotal + tax + deliveryFee;
  
  console.log(`💵 Final calculation: ${itemsTotal} + ${tax} (tax) + ${deliveryFee} (delivery) = ${finalAmount}`);

  // Generate order number
  const orderCount = await Order.countDocuments();
  const orderNumber = `ORD${String(orderCount + 1).padStart(6, '0')}`;
  console.log(`📋 Order number generated: ${orderNumber}`);

  // Create order
  console.log('💾 Creating order in database...');
  const order = await Order.create({
    orderNumber,
    customer: {
      // No customer.id for admin orders - they're walk-in/phone customers
      name: customer.name,
      phone: customer.phone,
      email: customer.email || ''
    },
    items: orderItems,
    pricing: {
      itemsTotal,
      deliveryFee,
      gst: tax,
      gstRate: taxRate,
      discount: 0,
      finalAmount
    },
    deliveryAddress: orderType === 'DELIVERY' ? {
      street: deliveryAddress.street,
      city: deliveryAddress.city,
      state: deliveryAddress.state,
      zipCode: deliveryAddress.zipCode
    } : undefined,
    orderType: orderType || 'DELIVERY',
    paymentMethod,
    paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PAID',
    status: 'PENDING',
    placedBy: 'ADMIN',
    placedByUser: req.user?._id,
    estimatedDeliveryTime: new Date(Date.now() + 45 * 60000) // 45 minutes
  });
  
  console.log(`✅ Order created successfully: ${order._id}\n`);

  // Emit socket event for new order
  try {
    emitNewOrder(order);
  } catch (error) {
    logger.error('Socket emit error:', error);
  }

  logger.info(`✅ Admin order created: ${orderNumber}`);

  res.status(201).json({
    status: 'success',
    data: {
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        customer: order.customer,
        items: order.items,
        pricing: order.pricing,
        status: order.status,
        orderType: order.orderType
      }
    }
  });
});

/**
 * @desc    Update order status
 * @route   PATCH /api/v1/admin/orders/:id/status
 * @access  Private/Admin
 */
exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  
  console.log(`\n📦 Updating order ${req.params.id}`);
  console.log(`   Current request status: ${status}`);
  console.log(`   Valid enum values: PENDING, ACCEPTED, READY, ASSIGNED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, COMPLETED`);
  
  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { 
      status,
      $push: {
        statusHistory: {
          status,
          timestamp: new Date(),
          updatedBy: req.user?._id
        }
      }
    },
    { new: true, runValidators: true }
  );

  if (!order) {
    console.log(`❌ Order not found: ${req.params.id}\n`);
    return res.status(404).json({
      status: 'error',
      message: 'Order not found'
    });
  }

  console.log(`✅ Order status updated successfully to: ${order.status}\n`);

  res.status(200).json({
    status: 'success',
    data: {
      orderId: order.orderNumber,
      newStatus: order.status
    }
  });
});
