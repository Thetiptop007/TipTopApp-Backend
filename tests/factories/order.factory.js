const Order = require('../../src/models/Order');
const MenuItem = require('../../src/models/MenuItem');

/**
 * Reusable order factory for tests
 */
const createTestOrder = async (customer, overrides = {}) => {
  // 1. Ensure we have at least one menu item
  let item = await MenuItem.findOne();
  if (!item) {
    item = await MenuItem.create({
      name: 'Test Pizza',
      description: 'Test Description',
      image: 'test.jpg',
      priceVariants: [
        { quantity: 'full', price: 299 }
      ],
      categories: ['Main Course'],
      isAvailable: true
    });
  }

  // 2. Create the order
  return await Order.create({
    customer: {
      id: customer._id,
      name: `${customer.name.first} ${customer.name.last}`,
      phone: customer.phone.number,
      email: customer.email.address
    },
    items: [{
      menuItemId: item._id,
      quantity: 1,
      price: 299,
      name: item.name,
      portion: 'full',
      subtotal: 299
    }],
    pricing: {
      itemsTotal: 299,
      finalAmount: 299,
      deliveryFee: 0
    },
    deliveryAddress: {
      street: '123 Test St',
      city: 'Phagwara',
      state: 'Punjab',
      zipCode: '144401',
      coordinates: {
        type: 'Point',
        coordinates: [0, 0]
      }
    },
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    status: 'PENDING',
    placedBy: 'CUSTOMER',
    ...overrides
  });
};

module.exports = {
  createTestOrder
};
