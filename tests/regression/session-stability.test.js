const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const authRoutes = require('../../src/routes/auth.routes');
const { errorHandler } = require('../../src/middlewares/errorHandler.middleware');
const { createAdmin } = require('../factories/user.factory');

const TEST_JWT_SECRET = 'session-stability-secret';
const TEST_REFRESH_SECRET = 'session-stability-refresh-secret';

describe('REGRESSION: Session Stability', () => {
  let mongoServer;
  let app;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.JWT_EXPIRE = '15m';
    process.env.JWT_REFRESH_EXPIRE = '7d';
    
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

  it('FIX: handles array-valued refresh tokens (Regression from Production Refresh Bug)', async () => {
    const admin = await createAdmin({ password: 'Password123!' });
    
    const login = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email.address, password: 'Password123!' })
      .expect(200);

    const validCookie = login.headers['set-cookie'][0].split(';')[0];
    const validToken = validCookie.split('=')[1];
    const csrfToken = login.body.data.csrfToken;

    // Simulate browser sending TWO cookies with same name (one empty, one valid)
    // This happens in production due to different path/domain settings in legacy versions
    const cookieHeader = `adminRefreshToken=; adminRefreshToken=${validToken}; adminCsrfToken=${csrfToken}`;

    const refresh = await request(app)
      .post('/api/v1/auth/admin/refresh')
      .set('Cookie', [cookieHeader])
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    expect(refresh.body.status).toBe('success');
    expect(refresh.body.data.tokens.accessToken).toBeTruthy();
  });

  it('FIX: prevents phantom cookies by only clearing other scope cookies if present (Regression from Ghost Cookie Bug)', async () => {
    const admin = await createAdmin({ password: 'Password123!' });

    // 1. Login as admin WITHOUT any pre-existing customer cookies
    const loginNoConflict = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email.address, password: 'Password123!' })
      .expect(200);

    // Verify that NO customer cookies were sent in Set-Cookie (should not blindly clear if not present)
    const setCookies = loginNoConflict.headers['set-cookie'] || [];
    const customerClears = setCookies.filter(c => c.includes('customerRefreshToken=;') || c.includes('customerCsrfToken=;'));
    expect(customerClears.length).toBe(0);

    // 2. Login as admin WITH a pre-existing customer cookie
    const loginWithConflict = await request(app)
      .post('/api/v1/auth/admin/login')
      .set('Cookie', ['customerRefreshToken=stale-token; customerCsrfToken=stale-csrf'])
      .send({ email: admin.email.address, password: 'Password123!' })
      .expect(200);

    // Verify that customer cookies WERE cleared this time to prevent mixed sessions
    const setCookiesConflict = loginWithConflict.headers['set-cookie'] || [];
    const clearedRefresh = setCookiesConflict.find(c => c.includes('customerRefreshToken=;'));
    const clearedCsrf = setCookiesConflict.find(c => c.includes('customerCsrfToken=;'));

    expect(clearedRefresh).toBeTruthy();
    expect(clearedCsrf).toBeTruthy();
  });
});
