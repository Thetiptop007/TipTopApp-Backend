const mongoose = require('mongoose');

/**
 * Audit Log Schema
 * Tracks all critical administrative actions for security and compliance
 */
const auditLogSchema = new mongoose.Schema(
  {
    // User who was affected by the action
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // User who performed the action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Type of action performed
    action: {
      type: String,
      enum: [
        'ROLE_CHANGE',
        'ROLE_ADDED',
        'ROLE_REMOVED',
        'PASSWORD_RESET',
        'PASSWORD_CHANGE',
        'ACCOUNT_BLOCK',
        'ACCOUNT_UNBLOCK',
        'ACCOUNT_DELETE',
        'ACCOUNT_CREATE',
        'ACCOUNT_ACTIVATE',
        'ACCOUNT_DEACTIVATE',
        'SETTINGS_CHANGE',
        'MENU_ITEM_CREATE',
        'MENU_ITEM_UPDATE',
        'MENU_ITEM_DELETE',
        'ORDER_STATUS_CHANGE',
        'ORDER_CANCEL',
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGOUT',
        'TOKEN_REFRESH',
        'PERMISSION_DENIED',
        'SECURITY_ALERT',
        'SECURITY_VIOLATION',
      ],
      required: true,
      index: true,
    },

    // Resource affected (e.g., 'User', 'Order', 'MenuItem', 'Settings')
    resourceType: {
      type: String,
      enum: ['User', 'Order', 'MenuItem', 'Category', 'Settings', 'Auth'],
      required: true,
    },

    // Resource ID if applicable
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
    },

    // Detailed information about the change
    details: {
      before: mongoose.Schema.Types.Mixed, // State before change
      after: mongoose.Schema.Types.Mixed, // State after change
      reason: String, // Reason for the action
      additionalInfo: mongoose.Schema.Types.Mixed,
    },

    // Request metadata
    metadata: {
      ipAddress: {
        type: String,
        required: true,
      },
      userAgent: String,
      requestMethod: String, // GET, POST, PUT, DELETE, PATCH
      requestPath: String, // API endpoint path
      statusCode: Number, // HTTP status code
      duration: Number, // Request duration in ms
    },

    // Severity level for filtering critical events
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
      index: true,
    },

    // Success or failure
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PENDING'],
      default: 'SUCCESS',
      index: true,
    },

    // Error message if action failed
    errorMessage: String,

    // Tags for easier filtering
    tags: [
      {
        type: String,
        index: true,
      },
    ],

    // Timestamp (automatically managed by mongoose)
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: 'auditlogs',
  }
);

// Compound indexes for common queries
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ performedBy: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ severity: 1, timestamp: -1 });
auditLogSchema.index({ 'metadata.ipAddress': 1, timestamp: -1 });

// Index for security monitoring - failed login attempts
auditLogSchema.index({ 
  action: 1, 
  status: 1, 
  'metadata.ipAddress': 1, 
  timestamp: -1 
});

// Static method to create audit log
auditLogSchema.statics.log = async function ({
  userId,
  performedBy,
  action,
  resourceType,
  resourceId = null,
  details = {},
  metadata = {},
  severity = 'MEDIUM',
  status = 'SUCCESS',
  errorMessage = null,
  tags = [],
}) {
  try {
    const log = await this.create({
      userId,
      performedBy,
      action,
      resourceType,
      resourceId,
      details,
      metadata,
      severity,
      status,
      errorMessage,
      tags,
    });
    return log;
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw error - audit logging should not break application flow
    return null;
  }
};

// Static method to get recent failed login attempts from IP
auditLogSchema.statics.getRecentFailedLogins = async function (ipAddress, minutes = 15) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  
  return this.countDocuments({
    action: 'LOGIN_FAILED',
    'metadata.ipAddress': ipAddress,
    timestamp: { $gte: since },
  });
};

// Static method to get all actions by a user in time range
auditLogSchema.statics.getUserActivity = async function (userId, startDate, endDate) {
  return this.find({
    performedBy: userId,
    timestamp: { $gte: startDate, $lte: endDate },
  })
    .sort({ timestamp: -1 })
    .populate('userId', 'name email')
    .lean();
};

// Static method to get security alerts (HIGH and CRITICAL severity)
auditLogSchema.statics.getSecurityAlerts = async function (hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return this.find({
    severity: { $in: ['HIGH', 'CRITICAL'] },
    timestamp: { $gte: since },
  })
    .sort({ timestamp: -1 })
    .populate('userId performedBy', 'name email role')
    .lean();
};

// Auto-delete logs older than 2 years (compliance/GDPR)
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 63072000 }); // 2 years

// Virtual for human-readable timestamp
auditLogSchema.virtual('timestampFormatted').get(function () {
  return this.timestamp.toISOString();
});

// Virtual for performer name
auditLogSchema.virtual('performerName').get(function () {
  if (this.populated('performedBy')) {
    return this.performedBy.name;
  }
  return 'System';
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
