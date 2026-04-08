const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
      maxlength: [50, 'Category name cannot exceed 50 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, 'Description cannot exceed 200 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    itemCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    color: {
      type: String,
      enum: ['green', 'red', 'blue', 'purple', 'orange', 'pink', 'yellow'],
      default: 'blue',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for faster queries
// Note: name has unique index from field definition
categorySchema.index({ isActive: 1 });
categorySchema.index({ createdAt: -1 });

// Static method to get all categories with item counts
categorySchema.statics.getAllWithCounts = async function() {
  const MenuItem = mongoose.model('MenuItem');
  
  const categories = await this.find().sort({ createdAt: -1 });
  
  // Get actual item counts from MenuItem collection
  // Note: Menu items now use categories array field (single category stored as array)
  const categoriesWithCounts = await Promise.all(
    categories.map(async (category) => {
      const count = await MenuItem.countDocuments({ categories: category.name });
      return {
        ...category.toObject(),
        itemCount: count,
      };
    })
  );
  
  return categoriesWithCounts;
};

// Pre-save middleware to capitalize first letter
categorySchema.pre('save', function() {
  if (this.isModified('name')) {
    this.name = this.name.charAt(0).toUpperCase() + this.name.slice(1);
  }
});

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
