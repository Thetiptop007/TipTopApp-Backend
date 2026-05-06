const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const authRoutes = require('../../src/routes/auth.routes');
const { errorHandler } = require('../../src/middlewares/errorHandler.middleware');
const User = require('../../src/models/User');
const { resetStoreForTests } = require('../../src/services/security/rateLimit.store');

const TEST_JWT_SECRET = 'integration-jwt-secret';
const TEST_REFRESH_SECRET = 'integration-refresh-secret';

jest.setTimeout(60000);

const getCookieValue = (setCookieHeaders, cookieName) => {
  if (!Array.isArray(setCookieHeaders)) {
    return null;
  }

  const rows = setCookieHeaders.filter((header) => String(header).includes(`${cookieName}=`));
  if (rows.length === 0) {
    return null;
  }

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const value = String(rows[i]).split(';')[0].split('=').slice(1).join('=');
    if (value) {
      return value;
    }
  }

  return '';
};

describe('Auth lifecycle integration', () => {
  let mongoServer;
  let app;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.JWT_EXPIRE = '15m';
    process.env.JWT_REFRESH_EXPIRE = '2d';

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
    resetStoreForTests();
  });

  beforeEach(async () => {
    await User.deleteMany({});

    await User.create({
      name: { first: 'Customer', last: 'One' },
      email: { address: 'customer@example.com', isVerified: true },
      phone: { number: '9876543210', isVerified: true },
      password: 'Strong@123',
      role: 'customer',
      isActive: true,
      isBlocked: false,
    });

    await User.create({
      name: { first: 'Admin', last: 'One' },
      email: { address: 'admin@example.com', isVerified: true },
      phone: { number: '9876501234', isVerified: true },
      password: 'Strong@123',
      role: 'admin',
      isActive: true,
      isBlocked: false,
    });
  });

  it('completes customer login -> me -> refresh -> logout lifecycle deterministically', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/api/v1/auth/customer/login')
      .send({ email: 'customer@example.com', password: 'Strong@123' })
      .expect(200);

    expect(login.body?.data?.authenticated).toBe(true);
    expect(login.body?.data?.authVersion).toBe('v2');
    expect(login.body?.data?.role).toBe('customer');
    expect(login.body?.data?.tokens?.accessToken).toBeTruthy();
    expect(login.body?.data?.expiresAt).toBeTruthy();

    const accessToken = login.body.data.tokens.accessToken;
    const csrfToken = login.body.data.csrfToken;
    const me = await agent
      .get('/api/v1/auth/customer/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(me.body?.data?.authenticated).toBe(true);
    expect(me.body?.data?.role).toBe('customer');

    const refresh = await agent
      .post('/api/v1/auth/customer/refresh')
      .set('X-CSRF-Token', csrfToken)
      .send({})
      .expect(200);

    expect(refresh.body?.data?.authenticated).toBe(true);
    expect(refresh.body?.data?.tokens?.accessToken).toBeTruthy();
    expect(refresh.body?.data?.authVersion).toBe('v2');

    const rotatedCsrf = refresh.body?.data?.csrfToken;

    await agent
      .post('/api/v1/auth/customer/logout')
      .set('Authorization', `Bearer ${refresh.body.data.tokens.accessToken}`)
      .set('X-CSRF-Token', rotatedCsrf)
      .send({})
      .expect(200);

    const refreshDeniedAfterLogout = await agent
      .post('/api/v1/auth/customer/refresh')
      .set('X-CSRF-Token', rotatedCsrf)
      .send({})
      .expect((res) => {
        expect([401, 403]).toContain(res.status);
      });

    expect(refreshDeniedAfterLogout.status).toBeGreaterThanOrEqual(401);
  });

  it('rejects replayed refresh token after rotation', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/api/v1/auth/customer/login')
      .send({ email: 'customer@example.com', password: 'Strong@123' })
      .expect(200);

    const oldRefreshCookie = getCookieValue(login.headers['set-cookie'], 'customerRefreshToken');
    const oldCsrfToken = login.body.data.csrfToken;

    expect(oldRefreshCookie).toBeTruthy();
    expect(oldCsrfToken).toBeTruthy();

    const refresh = await agent
      .post('/api/v1/auth/customer/refresh')
      .set('X-CSRF-Token', oldCsrfToken)
      .send({})
      .expect(200);

    expect(refresh.body?.data?.tokens?.accessToken).toBeTruthy();

    const replayDenied = await request(app)
      .post('/api/v1/auth/customer/refresh')
      .set('Cookie', [`customerCsrfToken=${oldCsrfToken}`])
      .set('X-CSRF-Token', oldCsrfToken)
      .send({ refreshToken: oldRefreshCookie })
      .expect((res) => {
        expect([400, 401, 403]).toContain(res.status);
      });

    expect(replayDenied.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects cross-role token misuse for admin routes', async () => {
    const customerLogin = await request(app)
      .post('/api/v1/auth/customer/login')
      .send({ email: 'customer@example.com', password: 'Strong@123' })
      .expect(200);

    const customerAccessToken = customerLogin.body.data.tokens.accessToken;

    await request(app)
      .get('/api/v1/auth/admin/me')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .expect(403);
  });

  it('denies blocked user even with a valid token and refresh session', async () => {
    const login = await request(app)
      .post('/api/v1/auth/customer/login')
      .send({ email: 'customer@example.com', password: 'Strong@123' })
      .expect(200);

    const customer = await User.findOne({ 'email.address': 'customer@example.com' });
    customer.isBlocked = true;
    await customer.save({ validateBeforeSave: false });

    await request(app)
      .get('/api/v1/auth/customer/me')
      .set('Authorization', `Bearer ${login.body.data.tokens.accessToken}`)
      .expect(403);
  });

  it('denies access when DB auth session is deleted', async () => {
    const login = await request(app)
      .post('/api/v1/auth/customer/login')
      .send({ email: 'customer@example.com', password: 'Strong@123' })
      .expect(200);

    const customer = await User.findOne({ 'email.address': 'customer@example.com' });
    customer.authSessions.customer = undefined;
    await customer.save({ validateBeforeSave: false });

    await request(app)
      .get('/api/v1/auth/customer/me')
      .set('Authorization', `Bearer ${login.body.data.tokens.accessToken}`)
      .expect(401);
  });

  it('admin can revoke a user sessions and old access token is denied', async () => {
    const adminAgent = request.agent(app);

    const adminLogin = await adminAgent
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'Strong@123' })
      .expect(200);

    const adminAccessToken = adminLogin.body.data.tokens.accessToken;
    const adminCsrf = adminLogin.body.data.csrfToken;

    const customerLogin = await request(app)
      .post('/api/v1/auth/customer/login')
      .send({ email: 'customer@example.com', password: 'Strong@123' })
      .expect(200);

    const customerAccess = customerLogin.body.data.tokens.accessToken;
    const customerUser = await User.findOne({ 'email.address': 'customer@example.com' });

    // Admin revokes customer sessions
    await adminAgent
      .post(`/api/v1/auth/admin/ops/revoke/user/${customerUser._id.toString()}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .set('X-CSRF-Token', adminCsrf)
      .send({})
      .expect(200);

    // Customer should now be denied using old access token
    await request(app)
      .get('/api/v1/auth/customer/me')
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(401);
  });
});
