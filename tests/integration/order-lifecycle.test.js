const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const orderRoutes = require('../../src/routes/order.routes');
const adminOrderRoutes = require('../../src/routes/admin-orders.routes');
const { errorHandler } = require('../../src/middlewares/errorHandler.middleware');
const { createAdmin, createCustomer } = require('../factories/user.factory');
const { createTestOrder } = require('../factories/order.factory');

// Mock auth middleware BEFORE it's used in routes
jest.mock('../../src/middlewares/auth', () => ({
  protect: (role) => (req, res, next) => {
    const auth = req.headers.authorization;
    // We assume the user is already attached by our dummy middleware or attach it here
    if (!req.user) {
      // In this test, we handle user attachment in a separate middleware for simplicity
      return next(new Error('Auth mock requires req.user to be set or tokens to match'));
    }
    next();
  },
  restrictTo: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ status: 'error', message: 'Forbidden' });
    }
    next();
  }
}));

describe('INTEGRATION: Order Lifecycle State Machine', () => {
  let mongoServer;
  let app;
  let admin;
  let customer;
  let adminToken;
  let customerToken;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'order-test-secret';
    process.env.JWT_REFRESH_SECRET = 'order-test-refresh-secret';
    process.env.JWT_EXPIRE = '15m';
    process.env.JWT_REFRESH_EXPIRE = '7d';

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    
    // Simple mock auth for this test to focus on state transitions
    app.use((req, res, next) => {
      const auth = req.headers.authorization;
      if (auth === 'Bearer admin-token') req.user = admin;
      if (auth === 'Bearer customer-token') req.user = customer;
      next();
    });

    app.use('/api/v1/orders', orderRoutes);
    app.use('/api/v1/admin/orders', adminOrderRoutes);
    app.use(errorHandler);

    admin = await createAdmin({ role: 'admin' });
    customer = await createCustomer({ role: 'customer' });
    adminToken = 'admin-token';
    customerToken = 'customer-token';
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongoServer.stop();
  });

  it('SUCCESS: walks through a perfect order lifecycle (PENDING -> DELIVERED)', async () => {
    const order = await createTestOrder(customer);
    const orderId = order._id.toString();

    // 1. Admin Accepts
    await request(app)
      .patch(`/api/v1/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 2. Admin starts preparing
    await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'preparing' })
      .expect(200);

    // 3. Admin marks as ready
    await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ready' })
      .expect(200);

    // 4. Final delivery
    const final = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'delivered' })
      .expect(200);

    expect(final.body.data.order.status).toBe('DELIVERED');
  });

  it('REJECT: prevents invalid state skips (PENDING -> READY should fail)', async () => {
    const order = await createTestOrder(customer);
    const orderId = order._id.toString();

    // Try to mark as ready without accepting first
    await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ready' })
      .expect(400); // Should be blocked by business logic
  });

  it('REJECT: prevents unauthorized actions (Customer cannot accept own order)', async () => {
    const order = await createTestOrder(customer);
    const orderId = order._id.toString();

    await request(app)
      .patch(`/api/v1/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403); // Or 401 depending on middleware implementation
  });
});
