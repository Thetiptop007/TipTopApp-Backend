const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
    roles: {
      type: [String],
      enum: ['customer', 'delivery', 'admin'],
      default: ['customer'],
      validate: {
        validator: function(v) {
          // Ensure no duplicate roles
          return v.length === new Set(v).size;
        },
        message: 'Duplicate roles are not allowed'
      }
    },
    // Keep 'role' for backward compatibility (returns primary role)
    role: {
      type: String,
      enum: ['customer', 'delivery', 'admin'],
      default: 'customer',
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
        tokenHash: String,
        issuedAt: Date,
        expiresAt: Date,
        lastUsedAt: Date,
      },
      customer: {
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

// Sync primary role with roles array
userSchema.pre('save', function () {
  if (this.roles && this.roles.length > 0) {
    // Set primary role based on priority: admin > delivery > customer
    if (this.roles.includes('admin')) {
      this.role = 'admin';
    } else if (this.roles.includes('delivery')) {
      this.role = 'delivery';
    } else {
      this.role = 'customer';
    }
  }
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
  return jwt.sign({ id: this._id, role: this.role, roles: this.roles, scope, tokenType: 'access' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// Check if user has a specific role
userSchema.methods.hasRole = function (role) {
  return this.roles && this.roles.includes(role);
};

// Add a role to user
userSchema.methods.addRole = function (role) {
  if (!this.roles) {
    this.roles = [];
  }
  if (!this.roles.includes(role)) {
    this.roles.push(role);
  }
};

// Remove a role from user
userSchema.methods.removeRole = function (role) {
  if (!this.roles) {
    return;
  }
  this.roles = this.roles.filter(r => r !== role);
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function (scope = this.getRefreshScope()) {
  return jwt.sign({ id: this._id, role: this.role, scope, tokenType: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE,
  });
};

userSchema.methods.getRefreshScope = function () {
  return this.role === 'admin' ? 'admin' : 'customer';
};

userSchema.methods.storeRefreshSession = async function (scope, refreshToken) {
  const tokenHash = bcrypt.hashSync(refreshToken, 12);
  const expiresIn = String(process.env.JWT_REFRESH_EXPIRE || '7d').trim();
  const match = expiresIn.match(/^(\d+)([smhd])$/i);
  const unitMs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const expiresAt = new Date(Date.now() + (match ? Number(match[1]) * unitMs[match[2].toLowerCase()] : 7 * 24 * 60 * 60 * 1000));

  this.authSessions = this.authSessions || {};
  this.authSessions[scope] = {
    tokenHash,
    issuedAt: new Date(),
    expiresAt,
    lastUsedAt: new Date(),
  };

  await this.save({ validateBeforeSave: false });
};

userSchema.methods.revokeRefreshSession = async function (scope) {
  if (this.authSessions && this.authSessions[scope]) {
    delete this.authSessions[scope];
    await this.save({ validateBeforeSave: false });
  }
};

userSchema.methods.verifyRefreshSession = async function (scope, refreshToken) {
  if (!this.authSessions || !this.authSessions[scope] || !this.authSessions[scope].tokenHash) {
    return false;
  }

  const isValid = await bcrypt.compare(refreshToken, this.authSessions[scope].tokenHash);
  if (isValid) {
    this.authSessions[scope].lastUsedAt = new Date();
    await this.save({ validateBeforeSave: false });
  }

  return isValid;
};

userSchema.methods.clearAllRefreshSessions = async function () {
  this.authSessions = {};
  await this.save({ validateBeforeSave: false });
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
    roles: 'delivery',
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
