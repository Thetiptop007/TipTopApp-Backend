/**
 * Restore Admin Account Script
 * 
 * This script removes the 'delivery' role from the admin account
 * that was compromised by the security vulnerability.
 * 
 * Run: node scripts/restore-admin.js
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const { config } = require('dotenv');

config();

async function restoreAdminAccount() {
  try {
    console.log('\n========== ADMIN ACCOUNT RESTORATION ==========\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.DATABASE_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find admin account
    const admin = await User.findOne({ 'email.address': 'thetiptop007@gmail.com' });
    
    if (!admin) {
      console.error('❌ Admin account not found!');
      process.exit(1);
    }
    
    console.log('Current Admin Status:');
    console.log('  Email:', admin.email.address);
    console.log('  Phone:', admin.phone.number);
    console.log('  Roles:', JSON.stringify(admin.roles));
    console.log('  Primary Role:', admin.role);
    console.log('  Has Delivery Data:', !!admin.deliveryData);
    console.log('');
    
    // Check if admin has delivery role
    if (!admin.roles.includes('delivery')) {
      console.log('✅ Admin account is clean - no delivery role found');
      console.log('No action needed.');
      process.exit(0);
    }
    
    console.log('⚠️  Admin has unwanted delivery role!\n');
    console.log('Removing delivery role...');
    
    // Remove delivery role
    const oldRoles = [...admin.roles];
    admin.roles = admin.roles.filter(role => role !== 'delivery');
    
    // Ensure admin role is primary
    if (admin.roles.includes('admin')) {
      admin.role = 'admin';
    }
    
    // Remove delivery data
    if (admin.deliveryData) {
      admin.deliveryData = undefined;
    }
    
    // Save changes (bypass validation to avoid password issues)
    await admin.save({ validateBeforeSave: false });
    
    console.log('✅ Delivery role removed\n');
    
    // Create audit log
    await AuditLog.create({
      user: admin._id,
      action: 'ROLE_REMOVED',
      entityType: 'User',
      entityId: admin._id,
      changes: {
        field: 'roles',
        oldValue: oldRoles,
        newValue: admin.roles
      },
      performedBy: admin._id, // System action
      ipAddress: 'localhost',
      userAgent: 'restore-admin-script',
      severity: 'critical',
      metadata: {
        roleRemoved: 'delivery',
        reason: 'Security vulnerability fix - unauthorized role addition',
        scriptName: 'restore-admin.js'
      }
    });
    
    console.log('✅ Audit log created\n');
    
    console.log('Updated Admin Status:');
    console.log('  Email:', admin.email.address);
    console.log('  Phone:', admin.phone.number);
    console.log('  Roles:', JSON.stringify(admin.roles));
    console.log('  Primary Role:', admin.role);
    console.log('  Has Delivery Data:', !!admin.deliveryData);
    console.log('');
    
    console.log('========================================');
    console.log('✅ Admin account successfully restored!');
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

restoreAdminAccount();
