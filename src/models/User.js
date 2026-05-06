const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Address Sub-schema
const addressSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['home', 'work', 'other'],
    default: 'home',
  },
  label: String,
  street: {
    type: String,
    required: [true, 'Street address is required'],
  },
  apartment: String,
  city: {
    type: String,
    required: [true, 'City is required'],
  },
  state: {
    type: String,
    required: [true, 'State is required'],
  },
  zipCode: {
    type: String,
    required: [true, 'Zip code is required'],
  },
  landmark: String,
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      default: [0, 0],
    },
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// User Schema
const userSchema = new mongoose.Schema(
  {
    // Authentication
    email: {
      address: {
        type: String,
        required: [true, 'Email is required'],
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
      },
      isVerified: {
        type: Boolean,
        default: false,
      },
    },
    phone: {
      number: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true,
      },
      isVerified: {
        type: Boolean,
        default: false,
      },
      verificationCode: String,
      verificationExpires: Date,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    // Canonical role field - single source of truth for authorization
    role: {
      type: String,
      enum: ['customer', 'delivery', 'admin'],
      default: 'customer',
      required: [true, 'User role is required'],
    },

    // Profile
    name: {
      first: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
      },
      last: {
        type: String,
        required: false,
        trim: true,
      },
    },
    avatar: String,
    dateOfBirth: Date,

    // Addresses (for customers)
    addresses: [addressSchema],

    // Customer-specific fields
    customerData: {
      loyaltyPoints: {
        type: Number,
        default: 0,
      },
      totalOrders: {
        type: Number,
        default: 0,
      },
      totalSpent: {
        type: Number,
        default: 0,
      },
      favoriteItems: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'MenuItem',
        },
      ],
      dietaryPreferences: [String],
      allergies: [String],
    },

    // Delivery partner-specific fields
    deliveryData: {
      vehicleInfo: {
        type: {
          type: String,
          enum: ['bike', 'scooter', 'car'],
        },
        number: String,
        model: String,
        document: String,
      },
      availability: {
        type: Boolean,
        default: false,
      },
      currentLocation: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number],
          default: [0, 0],
        },
      },
      rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      totalDeliveries: {
        type: Number,
        default: 0,
      },
      totalEarnings: {
        type: Number,
        default: 0,
      },
      bankDetails: {
        accountNumber: String,
        ifscCode: String,
        accountHolderName: String,
      },
    },

    // Verification & Status
    isActive: {
      type: Boolean,
      default: true,
      select: false,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockReason: String,

    // Security & Tokens
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    emailVerificationToken: String,
    emailVerificationExpires: Date,

    // Refresh token sessions (one active session per scope)
    authSessions: {
      admin: {
        sessionId: String,
        accessTokenHash: String,
        refreshTokenHash: String,
        tokenHash: String,
        issuedAt: Date,
        expiresAt: Date,
        lastUsedAt: Date,
      },
      customer: {
        sessionId: String,
        accessTokenHash: String,
        refreshTokenHash: String,
        tokenHash: String,
        issuedAt: Date,
        expiresAt: Date,
        lastUsedAt: Date,
      },
    },

    // Push Notification Tokens (FCM)
    deviceTokens: [
      {
        token: {
          type: String,
          required: true,
        },
        platform: {
          type: String,
          enum: ['ios', 'android', 'web'],
          required: true,
        },
        deviceId: String,
        lastUsed: {
          type: Date,
          default: Date.now,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],

    // Preferences
    preferences: {
      language: {
        type: String,
        enum: ['en', 'hi'],
        default: 'en',
      },
      notifications: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: false },
      },
      dietary: [
        {
          type: String,
          enum: ['vegetarian', 'vegan', 'jain', 'halal'],
        },
      ],
      theme: {
        type: String,
        enum: ['light', 'dark', 'auto'],
        default: 'light',
      },
    },

    // ML/Analytics metadata (for future use)
    metadata: {
      userSegment: {
        type: String,
        enum: ['high-value', 'regular', 'new', 'at-risk'],
      },
      churnRisk: {
        type: Number,
        min: 0,
        max: 1,
      },
      recommendationProfile: {
        type: String,
        enum: ['explorer', 'loyal', 'budget-conscious', 'health-focused'],
      },
      lastRecommendationUpdate: Date,
    },

    lastLogin: Date,
    // Session version for global per-user invalidation
    sessionVersion: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
userSchema.index({ 'email.address': 1 }, { unique: true });
userSchema.index({ 'phone.number': 1 }, { unique: true });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ role: 1, isActive: 1, 'customerData.totalOrders': -1 });
userSchema.index({ role: 1, isActive: 1, 'customerData.totalSpent': -1 });
userSchema.index({ 'addresses.coordinates': '2dsphere' });
userSchema.index({ 'deliveryData.currentLocation.coordinates': '2dsphere' });
userSchema.index({ 'deliveryData.availability': 1, role: 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  if (!this.name || !this.name.first || !this.name.last) return '';
  return `${this.name.first} ${this.name.last}`;
});

// Virtual for default address
userSchema.virtual('defaultAddress').get(function () {
  if (!this.addresses || this.addresses.length === 0) {
    return null;
  }
  return this.addresses.find((addr) => addr.isDefault);
});

// Hash password before saving
userSchema.pre('save', async function () {
  // Only hash if password is modified
  if (!this.isModified('password')) return;

  this.password = await bcrypt.hash(this.password, 12);
});

// Ensure only one default address
userSchema.pre('save', function () {
  if (this.addresses && this.addresses.length > 0) {
    const defaultAddresses = this.addresses.filter((addr) => addr.isDefault);
    if (defaultAddresses.length > 1) {
      // Keep only the first default, set others to false
      this.addresses.forEach((addr, index) => {
        if (index > 0 && addr.isDefault) {
          addr.isDefault = false;
        }
      });
    }
  }
});

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  return `${this.name.first} ${this.name.last}`.trim();
});

// Configure schema to include virtuals in JSON
userSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    // Add name as string for frontend compatibility
    ret.name = ret.fullName;
    // Also keep the original structure
    ret.firstName = doc.name.first;
    ret.lastName = doc.name.last;
    
    // Simplify email and phone for frontend
    if (doc.email) {
      ret.email = doc.email.address;
      ret.isVerified = doc.email.isVerified;
    }
    if (doc.phone) {
      ret.phone = doc.phone.number;
      ret.phoneVerified = doc.phone.isVerified;
    }
    
    // Clean up
    delete ret.fullName;
    delete ret.id; // Remove duplicate id field (we have _id)
    return ret;
  },
});

userSchema.set('toObject', { virtuals: true });

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token
const parseJwtExpirySeconds = (rawValue) => {
  const raw = String(rawValue || '7d').trim();
  const match = raw.match(/^(\d+)([smhd])$/i);

  if (!match) {
    return raw;
  }

  return raw;
};

userSchema.methods.generateAuthToken = function (scope = this.getRefreshScope()) {
  const session = this.authSessions?.[scope] || null;
  const sid = session?.sessionId || null;

  const sv = this.sessionVersion || 0;

  return jwt.sign({ sub: this._id.toString(), role: this.role, type: 'access', sid, sv, v: 1 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function (scope = this.getRefreshScope()) {
  const session = this.authSessions?.[scope] || null;
  const sid = session?.sessionId || null;

  const sv = this.sessionVersion || 0;

  return jwt.sign({ sub: this._id.toString(), role: this.role, type: 'refresh', sid, sv, v: 1 }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE,
  });
};

userSchema.methods.getRefreshScope = function () {
  return this.role === 'admin' ? 'admin' : 'customer';
};

const parseDurationToMs = (value, fallbackMs) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d+)([smhd])$/i);

  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * unitMs[unit];
};

userSchema.methods.storeAuthSession = async function (scope, { accessToken, refreshToken, sessionId } = {}) {
  if (!scope || !['admin', 'customer'].includes(scope)) {
    throw new Error('Invalid session scope');
  }

  if (!accessToken || !refreshToken) {
    throw new Error('Both access and refresh tokens are required to store auth session');
  }

  const nextSessionId = sessionId || crypto.randomUUID();
  const accessTokenHash = bcrypt.hashSync(accessToken, 12);
  const refreshTokenHash = bcrypt.hashSync(refreshToken, 12);
  const expiresIn = String(process.env.JWT_REFRESH_EXPIRE || '7d').trim();
  const expiresAt = new Date(Date.now() + parseDurationToMs(expiresIn, 7 * 24 * 60 * 60 * 1000));

  this.authSessions = this.authSessions || {};
  this.authSessions[scope] = {
    sessionId: nextSessionId,
    accessTokenHash,
    refreshTokenHash,
    tokenHash: refreshTokenHash,
    issuedAt: new Date(),
    expiresAt,
    lastUsedAt: new Date(),
  };

  await this.save({ validateBeforeSave: false });
  return this.authSessions[scope];
};

userSchema.methods.storeRefreshSession = async function (scope, refreshToken) {
  const placeholderAccessToken = jwt.sign({ sub: this._id.toString(), role: this.role, type: 'access', sid: crypto.randomUUID(), v: 1 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });

  return this.storeAuthSession(scope, {
    accessToken: placeholderAccessToken,
    refreshToken,
  });
};

userSchema.methods.revokeRefreshSession = async function (scope) {
  if (this.authSessions && this.authSessions[scope]) {
    delete this.authSessions[scope];
    await this.save({ validateBeforeSave: false });
  }
};

userSchema.methods.verifyAccessSession = async function (scope, { accessToken, sessionId } = {}) {
  const session = this.authSessions?.[scope];
  if (!session || !session.accessTokenHash || !session.sessionId) {
    return { valid: false, reason: 'missing_session' };
  }

  if (!accessToken || !sessionId) {
    return { valid: false, reason: 'missing_token_or_session_id' };
  }

  if (session.sessionId !== sessionId) {
    return { valid: false, reason: 'session_id_mismatch' };
  }

  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: 'session_expired' };
  }

  const matches = await bcrypt.compare(accessToken, session.accessTokenHash);
  if (!matches) {
    return { valid: false, reason: 'access_token_mismatch' };
  }

  this.authSessions[scope].lastUsedAt = new Date();
  await this.save({ validateBeforeSave: false });

  return { valid: true, session: this.authSessions[scope] };
};

userSchema.methods.verifyRefreshSession = async function (scope, refreshToken, sessionId = null) {
  const session = this.authSessions?.[scope];
  if (!session || !session.refreshTokenHash || !session.sessionId) {
    return { valid: false, reason: 'missing_session' };
  }

  if (!refreshToken) {
    return { valid: false, reason: 'missing_refresh_token' };
  }

  if (sessionId && session.sessionId !== sessionId) {
    return { valid: false, reason: 'session_id_mismatch' };
  }

  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: 'session_expired' };
  }

  const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
  if (!isValid) {
    return { valid: false, reason: 'refresh_token_mismatch' };
  }

  this.authSessions[scope].lastUsedAt = new Date();
  await this.save({ validateBeforeSave: false });

  return { valid: true, session: this.authSessions[scope] };
};

userSchema.methods.normalizeRoleFromLegacy = async function () {
  if (this.role) {
    return { migrated: false, role: this.role };
  }

  const legacyRoles = this.get('roles');
  if (!Array.isArray(legacyRoles) || legacyRoles.length === 0) {
    return { migrated: false, role: null };
  }

  // Never auto-upgrade to admin from legacy arrays.
  const migratedRole = legacyRoles.includes('customer')
    ? 'customer'
    : legacyRoles.includes('delivery')
      ? 'delivery'
      : null;

  if (!migratedRole) {
    return { migrated: false, role: null };
  }

  this.role = migratedRole;
  await this.save({ validateBeforeSave: false });

  return { migrated: true, role: migratedRole };
};

userSchema.methods.clearAllRefreshSessions = async function () {
  this.authSessions = {};
  await this.save({ validateBeforeSave: false });
};

userSchema.methods.incrementSessionVersion = async function () {
  this.sessionVersion = (this.sessionVersion || 0) + 1;
  // clear stored session blobs so existing sessions are invalidated
  this.authSessions = {};
  await this.save({ validateBeforeSave: false });
  return this.sessionVersion;
};

// Update last login
userSchema.methods.updateLastLogin = async function () {
  this.lastLogin = new Date();
  await this.save({ validateBeforeSave: false });
};

// Add or update device token for push notifications
userSchema.methods.addDeviceToken = async function (token, platform, deviceId) {
  // Check if token already exists
  const existingToken = this.deviceTokens.find(dt => dt.token === token);
  
  if (existingToken) {
    // Update existing token
    existingToken.lastUsed = new Date();
    existingToken.isActive = true;
    existingToken.platform = platform;
    if (deviceId) existingToken.deviceId = deviceId;
  } else {
    // Add new token
    this.deviceTokens.push({
      token,
      platform,
      deviceId,
      lastUsed: new Date(),
      isActive: true,
    });
  }
  
  await this.save({ validateBeforeSave: false });
};

// Remove device token
userSchema.methods.removeDeviceToken = async function (token) {
  this.deviceTokens = this.deviceTokens.filter(dt => dt.token !== token);
  await this.save({ validateBeforeSave: false });
};

// Get active device tokens
userSchema.methods.getActiveDeviceTokens = function () {
  return this.deviceTokens
    .filter(dt => dt.isActive)
    .map(dt => dt.token);
};

// Static method to find available delivery partners
userSchema.statics.findAvailableDeliveryPartners = function (location, limit = 10) {
  return this.find({
    role: 'delivery',
    isActive: true,
    'deliveryData.availability': true,
    'deliveryData.currentLocation.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: location,
        },
        $maxDistance: 10000, // 10km radius
      },
    },
  }).limit(limit);
};

module.exports = mongoose.model('User', userSchema);
