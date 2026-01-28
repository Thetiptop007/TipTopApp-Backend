const mongoose = require('mongoose');

// Price Variant Sub-schema for different quantities
const priceVariantSchema = new mongoose.Schema({
  quantity: {
    type: String,
    required: true,
    enum: ['Quarter', 'Half', 'Full', '2PCS', '4PCS', '6PCS', '8PCS', '10PCS', '12PCS', '14PCS', '16PCS'],
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
}, { _id: false });

// MenuItem Schema - Simplified based on data.json
const menuItemSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },

    // Single Image
    image: {
      type: String,
      required: [true, 'Image is required'],
    },

    // Pricing with Variants (Quarter, Half, Full, etc.)
    priceVariants: {
      type: [priceVariantSchema],
      required: [true, 'At least one price variant is required'],
      validate: {
        validator: function(v) {
          return v && v.length > 0;
        },
        message: 'At least one price variant is required',
      },
    },

    // Categories (Single category stored as array for backward compatibility)
    categories: {
      type: [String],
      required: true,
      validate: {
        validator: function(v) {
          // Must have exactly 1 category (not 'All')
          return v && v.length === 1 && v[0] !== 'All';
        },
        message: 'Each menu item must have exactly one category (excluding "All")',
      },
    },

    // Ratings
    rating: {
      type: Number,
      default: 4.0,
      min: 0,
      max: 5,
    },
    reviews: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Availability
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // Statistics for popularity tracking
    stats: {
      totalOrders: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        type: Number,
        default: 0,
      },
      popularityScore: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes - Define all indexes here to avoid duplicates
menuItemSchema.index({ name: 'text', description: 'text' });
menuItemSchema.index({ slug: 1 }, { unique: true });
menuItemSchema.index({ categories: 1 });
menuItemSchema.index({ isAvailable: 1 });
menuItemSchema.index({ isActive: 1 });
menuItemSchema.index({ rating: -1 });
menuItemSchema.index({ createdAt: -1 });

// Generate slug before saving
menuItemSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

// Static method to find by category
menuItemSchema.statics.findByCategory = function (category, options = {}) {
  const query = {
    categories: category,
    isActive: true,
    isAvailable: true,
  };
  return this.find(query)
    .sort(options.sort || { rating: -1 })
    .limit(options.limit || 20);
};

// Static method to find popular items based on order count
menuItemSchema.statics.findPopular = function (limit = 10) {
  return this.find({
    isActive: true,
    isAvailable: true,
  })
    .sort({ 'stats.totalOrders': -1, rating: -1 })
    .limit(limit)
    .select('name image priceVariants categories rating reviews stats');
};

module.exports = mongoose.model('MenuItem', menuItemSchema);
