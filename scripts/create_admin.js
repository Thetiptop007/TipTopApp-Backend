#!/usr/bin/env node
/**
 * One-off script to create or update an admin user in the database.
 * Usage:
 *   MONGODB_URI="<your mongo uri>" node scripts/create_admin.js
 * Or from project root:
 *   cd Backend && MONGODB_URI="..." node scripts/create_admin.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB, closeDB } = require('../src/config/database');
const User = require('../src/models/User');

async function upsertAdmin() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('Missing MONGODB_URI environment variable. Set it and retry.');
      process.exit(1);
    }

    await connectDB();

    const email = 'thetiptop007@gmail.com';
    const phone = '9060557296';
    const password = '1234567890';

    // Search by email or phone
    let user = await User.findOne({
      $or: [ { 'email.address': email.toLowerCase() }, { 'phone.number': phone } ]
    }).select('+password');

    if (user) {
      console.log('Existing user found. Updating to admin role and setting credentials...');
      user.role = 'admin';
      user.email = { address: email.toLowerCase(), isVerified: true };
      user.phone = { number: phone, isVerified: true };
      user.password = password; // will be hashed by pre-save hook
      user.name = user.name || { first: 'Admin', last: 'User' };
      user.isActive = true;
      await user.save();
      console.log(`Updated user (${user._id}) as admin.`);
    } else {
      console.log('No existing user found. Creating new admin user...');
      const newUser = new User({
        email: { address: email.toLowerCase(), isVerified: true },
        phone: { number: phone, isVerified: true },
        password,
        role: 'admin',
        name: { first: 'Admin', last: 'User' },
        isActive: true,
      });

      await newUser.save();
      console.log(`Created admin user (${newUser._id}) with email ${email}`);
    }

    console.log('Done. You can now login with the admin credentials.');
  } catch (err) {
    console.error('Error creating/updating admin user:', err);
  } finally {
    await closeDB();
    process.exit(0);
  }
}

upsertAdmin();
