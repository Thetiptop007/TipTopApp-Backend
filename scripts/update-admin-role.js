#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function updateAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const user = await User.findOneAndUpdate(
      { 'email.address': 'thetiptop007@gmail.com' },
      {
        $set: {
          role: 'admin',
          roles: ['admin'],
          isActive: true,
        }
      },
      { new: true, runValidators: false }
    ).select('+password');
    
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }
    
    console.log('✅ Updated role to:', { 
      email: user.email.address,
      role: user.role,
      roles: user.roles,
      isActive: user.isActive 
    });
    
    // Now update password separately
    user.password = '1234567890';
    await user.save();
    
    console.log('✅ Password updated successfully!');
    console.log('\nYou can now login with:');
    console.log('Email: thetiptop007@gmail.com');
    console.log('Password: 1234567890');
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

updateAdmin();
