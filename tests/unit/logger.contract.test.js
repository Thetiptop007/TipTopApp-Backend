describe('production logger contract', () => {
  const originalEnv = { ...process.env };

  const loadLogger = () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.LOG_PRETTY = 'false';
    process.env.LOG_DEBUG_ENABLED = 'false';
    process.env.LOG_DEBUG_AUTH = 'false';
    return require('../../src/utils/logger');
  };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('accepts valid runtime events and rejects invalid ones', () => {
    const logger = loadLogger();
    const internal = logger.__internal;

    expect(internal.isCanonicalEvent('ORDERS_TODAY_SUMMARY')).toBe(true);
    expect(internal.isCanonicalEvent('CRITICAL_ERROR_5XX')).toBe(true);
    expect(internal.isCanonicalEvent('ORDER_ACCEPTED')).toBe(true);
    expect(internal.isCanonicalEvent('bad_event')).toBe(false);
    expect(internal.isCanonicalEvent('ORDER_ACCEPTED_123')).toBe(false);
  });

  it('keeps request start and completion routes stable', () => {
    const logger = loadLogger();
    const req = {
      requestId: 'req-1',
      id: 'req-1',
      originalUrl: '/api/v1/settings/shop-status?cache=1',
      method: 'GET',
      routeTier: 'admin_critical',
      logContext: {
        route: '/api/v1/settings/shop-status',
      },
      user: {
        _id: { toString: () => 'user-1' },
        role: 'admin',
      },
    };
    const res = {
      statusCode: 503,
      getHeader: jest.fn().mockReturnValue('128'),
    };

    const start = logger.buildRequestStartContext(req);
    const complete = logger.buildRequestCompleteContext(req, res, 42);

    expect(start.route).toBe('/api/v1/settings/shop-status');
    expect(complete.route).toBe('/api/v1/settings/shop-status');
    expect(start).toEqual(expect.objectContaining({ requestId: 'req-1', method: 'GET', routeTier: 'admin_critical' }));
    expect(complete).toEqual(expect.objectContaining({ userId: 'user-1', userRole: 'admin', statusCode: 503, durationMs: 42 }));
    expect(complete.severity).toBe('high');
  });

  it('strips reserved fields from generic payloads', () => {
    const logger = loadLogger();
    const internal = logger.__internal;

    const sanitized = internal.stripReservedKeys({
      logType: 'business',
      event: 'MENU_FETCHED',
      severity: 'low',
      message: 'Menu fetched',
      requestId: 'req-1',
      route: '/api/v1/menu',
      method: 'GET',
      routeTier: 'public_low',
      customField: 'kept',
    });

    expect(sanitized).toEqual({ customField: 'kept' });
  });

  it('writes a clean internal recovery record for raw strings in production', () => {
    const writes = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const logger = loadLogger();
    logger.info('raw string log payload');

    const output = writes.join('');
    expect(output).toContain('LOGGER_INTERNAL_RECOVERY');
    expect(output).not.toContain('[logger fallback]');
    expect(output).toContain('Raw string log rejected');
  });

  it('normalizes business payloads without reserved key leakage', () => {
    const logger = loadLogger();
    const internal = logger.__internal;

    const sanitized = internal.sanitizeBusinessMeta({
      logType: 'business',
      event: 'ORDERS_TODAY_SUMMARY',
      severity: 'low',
      message: 'Today orders summary generated',
      requestId: 'req-1',
      route: '/api/v1/orders',
      customField: 10,
    });

    expect(sanitized).toEqual({ customField: 10 });
    expect(internal.isCanonicalEvent('ORDERS_TODAY_SUMMARY')).toBe(true);
  });
});
