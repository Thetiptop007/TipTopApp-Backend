const AuditLog = require('../models/AuditLog');
const AppError = require('./AppError');
const logger = require('./logger');

const PRIVILEGE_FIELDS = [
  'role',
  'roles',
  'permissions',
  'privileges',
  'isAdmin',
  'isBlocked',
  'isActive',
  'authSessions',
  'deviceTokens',
  'emailVerificationToken',
  'emailVerificationExpires',
  'passwordResetToken',
  'passwordResetExpires',
  'passwordChangedAt',
  'email.isVerified',
  'phone.isVerified',
];

const getPayloadKeys = (payload) => Object.keys(payload || {});

const hasPrivilegeFields = (payload) => {
  const keys = getPayloadKeys(payload);
  return keys.filter((key) => PRIVILEGE_FIELDS.includes(key));
};

const logPrivilegeViolation = async ({ req, actorId, actorRole, targetId = null, reason, deniedFields, status = 'FAILED' }) => {
  logger.security('PRIVILEGE_MUTATION_BLOCKED', reason, {
    actorId: actorId ? actorId.toString() : null,
    actorRole,
    targetId: targetId ? targetId.toString() : null,
    route: req.originalUrl,
    method: req.method,
    ipAddress: req.ip || 'unknown',
    userAgent: req.get('user-agent'),
    deniedFields,
  }, { level: 'warn', severity: 'high' });

  if (actorId) {
    await AuditLog.log({
      userId: actorId,
      performedBy: actorId,
      action: 'SECURITY_VIOLATION',
      resourceType: 'User',
      resourceId: targetId || actorId,
      details: {
        reason,
        deniedFields,
        before: null,
        after: null,
      },
      metadata: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.originalUrl,
      },
      severity: 'HIGH',
      status,
      tags: ['privilege', 'payload', 'blocked'],
    });
  }
};

const changeUserRoleWithAudit = async ({ req, actor, targetUser, newRole, reason, action = 'ROLE_CHANGE' }) => {
  const previousRole = targetUser.role;
  targetUser.role = newRole;
  await targetUser.save({ validateBeforeSave: false });

  await AuditLog.log({
    userId: targetUser._id,
    performedBy: actor._id,
    action,
    resourceType: 'User',
    resourceId: targetUser._id,
    details: {
      reason,
      before: { role: previousRole },
      after: { role: newRole },
    },
    metadata: {
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.originalUrl,
    },
    severity: 'HIGH',
    status: 'SUCCESS',
    tags: ['privilege', 'role-change'],
  });

  logger.security('ROLE_CHANGED', 'User role changed through canonical helper', {
    actorId: actor._id.toString(),
    actorRole: actor.role,
    targetId: targetUser._id.toString(),
    previousRole,
    newRole,
    route: req.originalUrl,
  }, { level: 'info', severity: 'high' });

  return targetUser;
};

const rejectPrivilegePayload = async ({ req, actorId, actorRole, targetId = null, reason, payload }) => {
  const deniedFields = hasPrivilegeFields(payload);

  if (deniedFields.length === 0) {
    return;
  }

  await logPrivilegeViolation({
    req,
    actorId,
    actorRole,
    targetId,
    reason,
    deniedFields,
  });

  throw new AppError('Privilege-bearing fields are not allowed on this route.', 400);
};

module.exports = {
  PRIVILEGE_FIELDS,
  hasPrivilegeFields,
  rejectPrivilegePayload,
  logPrivilegeViolation,
  changeUserRoleWithAudit,
};