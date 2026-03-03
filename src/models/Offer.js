const mongoose = require('mongoose');

// Offer Schema - Day-focused promotional offers
const offerSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      required: [true, 'Offer name is required'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Offer description is required'],
      trim: true,
    },

    // Date & Time
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    
    // Offer Type (for UI grouping)
    offerType: {
      type: String,
      enum: ['single_day', 'multi_day', 'recurring'],
      default: 'single_day',
    },

    // Discount Details
    discountType: {
      type: String,
      required: [true, 'Discount type is required'],
      enum: ['fixed', 'percentage'],
    },
    discountValue: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxDiscountCap: {
      type: Number,
      default: null, // Only for percentage discounts
      min: 0,
    },

    // Applicability
    applicableTo: {
      type: String,
      enum: ['all', 'categories', 'items'],
      default: 'all',
    },
    applicableCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
    }],
    applicableItems: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
    }],

    // Teaser/Announcement
    teaserEnabled: {
      type: Boolean,
      default: false,
    },
    teaserStartDate: {
      type: Date,
      default: null,
    },
    teaserMessage: {
      type: String,
      default: '',
      trim: true,
    },

    // Media
    bannerImage: {
      type: String,
      default: null,
    },

    // Status
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'active', 'ended', 'deactivated'],
      default: 'draft',
    },

    // Statistics (auto-calculated)
    totalOrders: {
      type: Number,
      default: 0,
    },
    totalDiscountGiven: {
      type: Number,
      default: 0,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },

    // Created by admin
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient queries
offerSchema.index({ status: 1, startDate: 1, endDate: 1 });
offerSchema.index({ status: 1, createdAt: -1 });

// Virtual for checking if offer is currently in teaser period
offerSchema.virtual('isTeaser').get(function() {
  if (!this.teaserEnabled || !this.teaserStartDate) return false;
  const now = new Date();
  return now >= this.teaserStartDate && now < this.startDate;
});

// Virtual for checking if offer is currently active
offerSchema.virtual('isActive').get(function() {
  if (this.status === 'deactivated' || this.status === 'draft') return false;
  const now = new Date();
  return now >= this.startDate && now <= this.endDate;
});

// Method to calculate discount for a given order amount
offerSchema.methods.calculateDiscount = function(orderAmount, orderItems = []) {
  // Check if order meets minimum amount
  if (orderAmount < this.minOrderAmount) {
    return 0;
  }

  // Check if offer is applicable to the items in the order
  if (this.applicableTo === 'items' && this.applicableItems.length > 0) {
    // Check if any order item is in the applicable items list
    const hasApplicableItem = orderItems.some(item => 
      this.applicableItems.some(applicableItem => 
        applicableItem.toString() === item.menuItem.toString()
      )
    );
    if (!hasApplicableItem) {
      return 0;
    }
  }

  // Calculate discount based on type
  let discount = 0;
  if (this.discountType === 'fixed') {
    discount = this.discountValue;
  } else if (this.discountType === 'percentage') {
    discount = (orderAmount * this.discountValue) / 100;
    // Apply max cap if set
    if (this.maxDiscountCap && discount > this.maxDiscountCap) {
      discount = this.maxDiscountCap;
    }
  }

  // Ensure discount doesn't exceed order amount
  return Math.min(discount, orderAmount);
};

// Static method to get active offers
offerSchema.statics.getActiveOffers = async function() {
  const now = new Date();
  return this.find({
    status: { $in: ['scheduled', 'active'] },
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ createdAt: -1 });
};

// Static method to get teaser offers
offerSchema.statics.getTeaserOffers = async function() {
  const now = new Date();
  return this.find({
    teaserEnabled: true,
    status: { $in: ['scheduled'] },
    teaserStartDate: { $lte: now },
    startDate: { $gt: now },
  }).sort({ startDate: 1 });
};

// Pre-save hook to auto-update status based on dates
offerSchema.pre('save', function(next) {
  const now = new Date();
  
  // Don't auto-update if manually set to deactivated or draft
  if (this.status === 'deactivated' || this.status === 'draft') {
    return next();
  }

  // Auto-update status based on dates
  if (now < this.startDate) {
    this.status = 'scheduled';
  } else if (now >= this.startDate && now <= this.endDate) {
    this.status = 'active';
  } else if (now > this.endDate) {
    this.status = 'ended';
  }

  next();
});

// Validation: End date must be after start date
offerSchema.pre('save', function(next) {
  if (this.endDate <= this.startDate) {
    return next(new Error('End date must be after start date'));
  }
  
  // If teaser is enabled, validate teaser start date
  if (this.teaserEnabled && this.teaserStartDate) {
    if (this.teaserStartDate >= this.startDate) {
      return next(new Error('Teaser start date must be before offer start date'));
    }
  }
  
  next();
});

const Offer = mongoose.model('Offer', offerSchema);

module.exports = Offer;
