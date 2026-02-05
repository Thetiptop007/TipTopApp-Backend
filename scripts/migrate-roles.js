/**
 * Migration Script: Convert single role to roles array
 * Run this once to migrate existing users to the new roles structure
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

const closeDB = async () => {
  await mongoose.connection.close();
  console.log('📴 MongoDB connection closed');
};

async function migrateRoles() {
  try {
    await connectDB();

    console.log('\n========== MIGRATING USER ROLES ==========\n');

    // Find all users without roles array or with empty roles array
    const users = await User.find({
      $or: [
        { roles: { $exists: false } },
        { roles: { $size: 0 } },
        { roles: null }
      ]
    }).select('role roles email name');

    console.log(`Found ${users.length} users to migrate\n`);

    let migratedCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // Set roles array based on current role field
        if (user.role && !user.roles) {
          user.roles = [user.role];
        } else if (!user.role && !user.roles) {
          // Default to customer if no role set
          user.roles = ['customer'];
          user.role = 'customer';
        }

        await user.save({ validateBeforeSave: false });
        
        console.log(`✅ Migrated: ${user.email.address || user.name?.first} - Role: ${user.role} -> Roles: [${user.roles.join(', ')}]`);
        migratedCount++;
      } catch (err) {
        console.error(`❌ Error migrating user ${user.email?.address}:`, err.message);
        errorCount++;
      }
    }

    console.log('\n========== MIGRATION COMPLETE ==========');
    console.log(`✅ Successfully migrated: ${migratedCount} users`);
    console.log(`❌ Failed: ${errorCount} users`);
    console.log('=========================================\n');

  } catch (err) {
    console.error('❌ Migration error:', err);
  } finally {
    await closeDB();
    process.exit(0);
  }
}

// Run migration
migrateRoles();
