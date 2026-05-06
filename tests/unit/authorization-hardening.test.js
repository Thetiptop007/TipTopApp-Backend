jest.mock('../../src/utils/logger', () => ({
  security: jest.fn(),
  auth: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  system: jest.fn(),
}));

jest.mock('../../src/models/AuditLog', () => ({
  log: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/models/User', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../../src/models/Order', () => ({
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
}));

jest.mock('../../src/models/DeliverySession', () => ({}));

jest.mock('../../src/services/notification.service', () => ({}));

jest.mock('../../src/services/logging/securityAudit.logger', () => ({
  logSecurityAudit: jest.fn(),
  SECURITY_EVENTS: {
    TOKEN_VALIDATION_FAILURE: 'TOKEN_VALIDATION_FAILURE',
    FORBIDDEN_ACCESS: 'FORBIDDEN_ACCESS',
  },
}));

jest.mock('../../src/services/logging/auth.logger', () => ({
  logAuthEvent: jest.fn(),
}));

jest.mock('../../src/services/metrics.service', () => ({
  incrementLoginOutcome: jest.fn(),
}));

const authValidator = require('../../src/validators/auth.validator');
const authMiddleware = require('../../src/middlewares/auth');
const authController = require('../../src/controllers/auth.controller');
const userController = require('../../src/controllers/user.controller');
const deliveryController = require('../../src/controllers/delivery.controller');
const User = require('../../src/models/User');
const AuditLog = require('../../src/models/AuditLog');
const { changeUserRoleWithAudit, rejectPrivilegePayload } = require('../../src/utils/privilege-guard');

const flushAsyncHandlers = () => new Promise((resolve) => {
  setImmediate(resolve);
});

const makeReq = ({ body = {}, user = null, params = {}, originalUrl = '/api/v1/test', method = 'POST' } = {}) => ({
  body,
  user,
  params,
  originalUrl,
  method,
  ip: '127.0.0.1',
  get: jest.fn().mockReturnValue('test-agent'),
});

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('authorization hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects privileged fields on public registration schema', () => {
    const { error } = authValidator.registerSchema.validate({
      name: 'Test User',
      email: 'test@example.com',
      phone: '9876543210',
      password: 'Strong@123',
      role: 'admin',
    }, { abortEarly: false });

    expect(error).toBeTruthy();
    expect(error.details.map((detail) => detail.path.join('.'))).toContain('role');
  });

  it('rejects privileged fields on self-service profile schema', () => {
    const { error } = authValidator.updateProfileSchema.validate({
      name: { first: 'Test' },
      isBlocked: false,
      authSessions: {},
      role: 'admin',
    }, { abortEarly: false });

    expect(error).toBeTruthy();
    expect(error.details.map((detail) => detail.path.join('.'))).toEqual(expect.arrayContaining(['isBlocked', 'authSessions', 'role']));
  });

  it('blocks privilege-bearing payloads with the shared guard', async () => {
    await expect(rejectPrivilegePayload({
      req: makeReq({ body: { role: 'admin', permissions: ['*'] } }),
      actorId: null,
      actorRole: 'anonymous',
      reason: 'test rejection',
      payload: { role: 'admin', permissions: ['*'] },
    })).rejects.toMatchObject({ message: 'Privilege-bearing fields are not allowed on this route.' });

    expect(AuditLog.log).not.toHaveBeenCalled();
  });

  it('keeps canonical role mutation on the audited helper only', async () => {
    const targetUser = {
      _id: 'user-1',
      role: 'customer',
      save: jest.fn().mockResolvedValue(undefined),
    };

    const updated = await changeUserRoleWithAudit({
      req: makeReq({ originalUrl: '/api/v1/users/user-1/role', method: 'PATCH', user: { _id: 'admin-1', role: 'admin' } }),
      actor: { _id: 'admin-1', role: 'admin' },
      targetUser,
      newRole: 'delivery',
      reason: 'canonical role update',
    });

    expect(updated.role).toBe('delivery');
    expect(targetUser.save).toHaveBeenCalledWith({ validateBeforeSave: false });
    expect(AuditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_CHANGE',
      resourceType: 'User',
      status: 'SUCCESS',
    }));
  });

  it('rejects admin-create payloads that try to set role', async () => {
    const req = makeReq({
      body: {
        name: { first: 'Admin', last: 'User' },
        email: { address: 'admin@example.com' },
        phone: { number: '9000000000' },
        password: 'Strong@123',
        role: 'admin',
      },
      user: { _id: 'admin-1', role: 'admin', email: { address: 'admin@example.com' } },
      originalUrl: '/api/v1/users',
    });
    const res = makeRes();
    const next = jest.fn();

    await userController.createUser(req, res, next);
    await flushAsyncHandlers();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(User.create).not.toHaveBeenCalled();
  });

  it('rejects generic admin updates that try to mutate auth state', async () => {
    const req = makeReq({
      body: {
        name: { first: 'Updated' },
        authSessions: { admin: {} },
      },
      user: { _id: 'admin-1', role: 'admin', email: { address: 'admin@example.com' } },
      params: { id: 'user-2' },
      originalUrl: '/api/v1/users/user-2',
      method: 'PATCH',
    });
    const res = makeRes();
    const next = jest.fn();

    await userController.updateUser(req, res, next);
    await flushAsyncHandlers();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects self-service updates that try to escalate privilege', async () => {
    const req = makeReq({
      body: {
        name: { first: 'Customer' },
        role: 'admin',
        isBlocked: false,
      },
      user: { _id: 'user-1', role: 'customer', email: { address: 'customer@example.com' } },
      originalUrl: '/api/v1/auth/me',
      method: 'PATCH',
    });
    const res = makeRes();
    const next = jest.fn();

    await authController.updateMe(req, res, next);
    await flushAsyncHandlers();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects delivery registration payloads that include privilege fields', async () => {
    const req = makeReq({
      body: {
        name: 'Delivery Person',
        email: 'delivery@example.com',
        phone: '9876543210',
        password: 'Strong@123',
        vehicleType: 'bike',
        role: 'admin',
      },
      user: { _id: 'admin-1', role: 'admin', email: { address: 'admin@example.com' } },
      originalUrl: '/api/v1/delivery/register',
      method: 'POST',
    });
    const res = makeRes();
    const next = jest.fn();

    await deliveryController.registerDeliveryPartner(req, res, next);
    await flushAsyncHandlers();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(User.create).not.toHaveBeenCalled();
  });

  it('blocks non-admin users from the canonical role-change middleware gate', () => {
    const middleware = authMiddleware.restrictTo('admin');
    const req = makeReq({
      user: { _id: 'user-1', role: 'customer' },
      originalUrl: '/api/v1/users/user-1/role',
      method: 'PATCH',
    });
    const res = makeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});