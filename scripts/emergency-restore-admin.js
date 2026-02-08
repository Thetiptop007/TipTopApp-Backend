/**
 * Emergency Admin Account Restoration Script
 * Run this after accidentally deleting the admin account
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');

async function restoreAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tiptop_dev');
    console.log('Connected to MongoDB');

    const email = 'thetiptop007@gmail.com';
    const phone = '9060557296';
    const password = '1234567890';

    // Check if admin exists
    const existingAdmin = await User.findOne({ 'email.address': email });

    if (existingAdmin) {
      console.log('\n✅ Admin account already exists!');
      console.log('Email:', existingAdmin.email.address);
      console.log('Phone:', existingAdmin.phone.number);
      console.log('Roles:', existingAdmin.roles);
      console.log('Active:', existingAdmin.isActive);
      
      // Ensure admin has admin role
      if (!existingAdmin.roles.includes('admin')) {
        console.log('\n⚠️  Adding missing admin role...');
        existingAdmin.roles.push('admin');
        existingAdmin.role = 'admin';
        await existingAdmin.save();
        console.log('✅ Admin role added!');
      }
      
      process.exit(0);
    }

    console.log('\n🔧 Creating new admin account...');
    
    // Create admin account
    const admin = await User.create({
      name: {
        first: 'Admin',
        last: 'TipTop'
      },
      email: {
        address: email,
        isVerified: true
      },
      phone: {
        number: phone,
        isVerified: true
      },
      password: password,
      role: 'admin',
      roles: ['admin'],
      isActive: true
    });

    console.log('\n✅ Admin account restored successfully!');
    console.log('Email:', admin.email.address);
    console.log('Phone:', admin.phone.number);
    console.log('Password:', password);
    console.log('Roles:', admin.roles);
    console.log('\nYou can now login with these credentials.');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

restoreAdmin();
