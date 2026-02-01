/**
 * Script to normalize phone numbers in database
 * Removes +91 prefix from all phone numbers
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');
require('dotenv').config();

const normalizePhoneNumbers = async () => {
  try {
    console.log('🔌 Connecting to database...');
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoUri) {
      console.error('❌ MONGO_URI not found in environment variables');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to database');

    // Find all users with phone numbers starting with +91
    const usersWithCountryCode = await User.find({
      'phone.number': /^\+91/
    });

    console.log(`\n📱 Found ${usersWithCountryCode.length} users with +91 prefix\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const user of usersWithCountryCode) {
      const oldPhone = user.phone.number;
      const newPhone = oldPhone.replace(/^\+91/, '');
      
      // Check if normalized phone already exists
      const existingUser = await User.findOne({
        'phone.number': newPhone,
        '_id': { $ne: user._id }
      });
      
      if (existingUser) {
        console.log(`⚠️  Skipping: ${oldPhone} → ${newPhone} (${user.email.address}) - duplicate exists`);
        skippedCount++;
        continue;
      }
      
      console.log(`✅ Updating: ${oldPhone} → ${newPhone} (${user.email.address})`);
      
      user.phone.number = newPhone;
      await user.save();
      updatedCount++;
    }

    console.log(`\n✅ Successfully updated ${updatedCount} phone numbers`);
    if (skippedCount > 0) {
      console.log(`⚠️  Skipped ${skippedCount} duplicates (need manual review)`);
    }
    console.log('🎉 Phone number normalization complete!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

normalizePhoneNumbers();
