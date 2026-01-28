/**
 * Migration Script: Remove PREPARING Status
 * 
 * This script updates all orders with status 'PREPARING' to 'ACCEPTED'
 * Run this once to migrate existing data after removing PREPARING from enum
 * 
 * Usage: node scripts/migrate-remove-preparing-status.js
 */

const mongoose = require('mongoose');
const Order = require('../src/models/Order');
require('dotenv').config();

const migrateOrders = async () => {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all orders with PREPARING status
    console.log('🔍 Searching for orders with PREPARING status...');
    const preparingOrders = await Order.find({ status: 'PREPARING' });
    
    console.log(`📊 Found ${preparingOrders.length} orders with PREPARING status\n`);

    if (preparingOrders.length === 0) {
      console.log('✅ No orders to migrate. All done!');
      process.exit(0);
    }

    // Display orders to be updated
    console.log('Orders to be updated:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    preparingOrders.forEach((order, index) => {
      console.log(`${index + 1}. Order #${order.orderNumber} (${order._id})`);
      console.log(`   Customer: ${order.customer.name}`);
      console.log(`   Created: ${order.createdAt.toLocaleString()}`);
      console.log(`   Status: PREPARING → ACCEPTED`);
      console.log('');
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Confirm before proceeding
    console.log('⚠️  This will update all PREPARING orders to ACCEPTED status');
    console.log('🔄 Starting migration in 3 seconds...\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Update orders
    let successCount = 0;
    let errorCount = 0;

    for (const order of preparingOrders) {
      try {
        // Update status
        order.status = 'ACCEPTED';
        
        // Add migration note to status history
        order.statusHistory.push({
          status: 'ACCEPTED',
          timestamp: new Date(),
          notes: 'Migrated from PREPARING to ACCEPTED (workflow simplification)',
        });

        await order.save({ validateBeforeSave: false });
        
        successCount++;
        console.log(`✅ Updated Order #${order.orderNumber}`);
      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to update Order #${order.orderNumber}:`, error.message);
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Successfully updated: ${successCount} orders`);
    if (errorCount > 0) {
      console.log(`   ❌ Failed to update: ${errorCount} orders`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('✅ Migration completed successfully!');
    console.log('💡 You can now restart your server with the updated Order model\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run migration
migrateOrders();
