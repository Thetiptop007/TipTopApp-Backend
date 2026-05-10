const User = require('../../src/models/User');

/**
 * Reusable user factory for tests
 */
const createAdmin = async (overrides = {}) => {
  return await User.create({
    name: { first: 'Test', last: 'Admin' },
    email: { address: `admin-${Date.now()}@example.com`, isVerified: true },
    phone: { number: `90000${Math.floor(Math.random() * 100000)}`, isVerified: true },
    password: 'Password123!',
    role: 'admin',
    isActive: true,
    ...overrides,
  });
};

const createCustomer = async (overrides = {}) => {
  return await User.create({
    name: { first: 'Test', last: 'Customer' },
    email: { address: `customer-${Date.now()}@example.com`, isVerified: true },
    phone: { number: `80000${Math.floor(Math.random() * 100000)}`, isVerified: true },
    password: 'Password123!',
    role: 'customer',
    isActive: true,
    ...overrides,
  });
};

module.exports = {
  createAdmin,
  createCustomer,
};
