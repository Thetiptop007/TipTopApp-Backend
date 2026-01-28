const mongoose = require('mongoose');
require('dotenv').config();

const MenuItem = require('../src/models/MenuItem');

/**
 * Migration script to convert menu items from multiple categories to single category
 * Strategy:
 * 1. Items with 'All' category -> Keep 'All' for now (will need manual review)
 * 2. Items with multiple categories -> Keep the first non-'All' category
 * 3. Items already with single category -> No change
 */

const migrateSingleCategory = async () => {
  try {
    console.log('🔄 Starting category migration...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all menu items
    const items = await MenuItem.find({});
    console.log(`📊 Found ${items.length} menu items`);

    let updated = 0;
    let alreadySingle = 0;
    let errors = 0;

    for (const item of items) {
      try {
        // Skip if already has single category (excluding 'All')
        if (item.categories.length === 1 && item.categories[0] !== 'All') {
          alreadySingle++;
          continue;
        }

        // Get the first non-'All' category
        const newCategory = item.categories.find(cat => cat !== 'All') || item.categories[0];

        console.log(`\n📝 Item: ${item.name}`);
        console.log(`   Old categories: [${item.categories.join(', ')}]`);
        console.log(`   New category: [${newCategory}]`);

        // Update with validation disabled temporarily
        await MenuItem.updateOne(
          { _id: item._id },
          { 
            $set: { categories: [newCategory] }
          }
        );

        updated++;
      } catch (error) {
        console.error(`❌ Error updating ${item.name}:`, error.message);
        errors++;
      }
    }

    console.log('\n✅ Migration completed!');
    console.log(`   - Items updated: ${updated}`);
    console.log(`   - Already single category: ${alreadySingle}`);
    console.log(`   - Errors: ${errors}`);

    // Show items that still have 'All' category
    const allCategoryItems = await MenuItem.find({ categories: 'All' });
    if (allCategoryItems.length > 0) {
      console.log(`\n⚠️  ${allCategoryItems.length} items still have 'All' category:`);
      allCategoryItems.forEach(item => {
        console.log(`   - ${item.name}`);
      });
      console.log('   Please manually assign proper categories to these items.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
};

// Run migration
migrateSingleCategory();
