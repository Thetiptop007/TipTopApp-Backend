const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const authRoutes = require('../../src/routes/auth.routes');
const { errorHandler } = require('../../src/middlewares/errorHandler.middleware');
const User = require('../../src/models/User');

const TEST_JWT_SECRET = 'session-stability-secret';
const TEST_REFRESH_SECRET = 'session-stability-refresh-secret';

describe('Session Stability Integration', () => {
  let mongoServer;
  let app;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/auth', authRoutes);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    
    await User.create({
      name: { first: 'Admin', last: 'One' },
      email: { address: 'admin@example.com', isVerified: true },
      phone: { number: '9876501234', isVerified: true },
      password: 'Strong@123',
      role: 'admin',
      isActive: true,
    });
  });

  it('handles array-valued refresh tokens by picking the first non-empty value', async () => {
    const login = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'Strong@123' })
      .expect(200);

    const validCookie = login.headers['set-cookie'][0].split(';')[0];
    const validToken = validCookie.split('=')[1];
    const csrfToken = login.body.data.csrfToken;

    // Simulate browser sending TWO cookies with same name (one empty, one valid)
    // Supertest doesn't support multiple cookies with same name easily in set(), 
    // so we manually construct the Cookie header
    const cookieHeader = `adminRefreshToken=; adminRefreshToken=${validToken}; adminCsrfToken=${csrfToken}`;

    const refresh = await request(app)
      .post('/api/v1/auth/admin/refresh')
      .set('Cookie', [cookieHeader])
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    expect(refresh.body.status).toBe('success');
    expect(refresh.body.data.tokens.accessToken).toBeTruthy();
  });

  it('prevents phantom cookies by only clearing other scope cookies if they were present', async () => {
    // 1. Login as admin without any pre-existing cookies
    const login = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'Strong@123' })
      .expect(200);

    // Verify that NO customer cookies were sent in Set-Cookie
    const setCookies = login.headers['set-cookie'] || [];
    const customerCookies = setCookies.filter(c => c.includes('customerRefreshToken') || c.includes('customerCsrfToken'));
    
    expect(customerCookies.length).toBe(0);

    // 2. Now login as admin WITH a pre-existing customer cookie
    const loginWithConflict = await request(app)
      .post('/api/v1/auth/admin/login')
      .set('Cookie', ['customerRefreshToken=old-token; customerCsrfToken=old-csrf'])
      .send({ email: 'admin@example.com', password: 'Strong@123' })
      .expect(200);

    // Verify that customer cookies WERE cleared this time
    const setCookiesConflict = loginWithConflict.headers['set-cookie'] || [];
    const clearedCustomerRefresh = setCookiesConflict.find(c => c.includes('customerRefreshToken=;') || c.includes('customerRefreshToken= '));
    const clearedCustomerCsrf = setCookiesConflict.find(c => c.includes('customerCsrfToken=;') || c.includes('customerCsrfToken= '));

    expect(clearedCustomerRefresh).toBeTruthy();
    expect(clearedCustomerCsrf).toBeTruthy();
  });
});
