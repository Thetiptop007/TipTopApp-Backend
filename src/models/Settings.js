const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    // General Settings
    siteName: {
      type: String,
      default: 'ThéTipTop',
    },
    contactEmail: {
      type: String,
      default: 'contact@thetiptop.com',
    },
    contactPhone: {
      type: String,
      default: '+33 1 23 45 67 89',
    },
    businessAddress: {
      type: String,
      default: '123 Restaurant Street, Paris, France',
      trim: true,
    },
    website: {
      type: String,
      default: 'www.thetiptop.com',
      trim: true,
    },

    // Order Configuration
    notificationEmails: {
      type: [String],
      default: [],
      validate: {
        validator: function(emails) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return emails.every(email => emailRegex.test(email));
        },
        message: 'Please provide valid email addresses'
      }
    },
    minimumOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    deliveryCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
      // Amount in rupees (₹), not percentage - only applied in mobile app
    },

    // App Update Notification
    appUpdateAvailable: {
      type: Boolean,
      default: false,
    },
    appUpdateMessage: {
      type: String,
      default: 'A new version of the app is available. Update now for the best experience!',
    },
    appUpdateUrl: {
      type: String,
      default: '',
    },

    // Payment Configuration
    upiId: {
      type: String,
      default: '',
      trim: true,
    },

    // App Download Links
    apkDownloadUrl: {
      type: String,
      default: 'https://drive.google.com/file/d/mock-apk-link/view',
      trim: true,
    },
    indusAppStoreUrl: {
      type: String,
      default: 'https://indusappstore.com/app/thetiptop',
      trim: true,
    },

    // Admin Personal Information
    adminProfile: {
      firstName: {
        type: String,
        default: '',
        trim: true,
      },
      lastName: {
        type: String,
        default: '',
        trim: true,
      },
    },

    // Singleton pattern - only one settings document
    singleton: {
      type: Boolean,
      default: true,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one settings document exists
settingsSchema.statics.getSettings = async function () {
  try {
    let settings = await this.findOne({ singleton: true });
    if (!settings) {
      settings = await this.create({ singleton: true });
    }
    return settings;
  } catch (error) {
    // If duplicate key error, fetch the existing document
    if (error.code === 11000) {
      const settings = await this.findOne({ singleton: true });
      if (settings) return settings;
    }
    throw error;
  }
};

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;
