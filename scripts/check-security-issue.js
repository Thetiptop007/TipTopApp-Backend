const mongoose = require('mongoose');
const User = require('../src/models/User');

async function checkSecurityIssue() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    console.log(process.env.MONGODB_URI);
    await mongoose.connect(process.env.DATABASE_URI || 'mongodb+srv://raj:RkhYZlM7hgDyKEo4@cluster0.j9hjo.mongodb.net/tiptop_prod?retryWrites=true&w=majority&appName=Cluster0');
    
    console.log('\n========== SECURITY ISSUE INVESTIGATION ==========\n');
    
    // Check admin account
    const admin = await User.findOne({ 'email.address': 'thetiptop007@gmail.com' }).select('+password');
    
    if (admin) {
      console.log('ADMIN ACCOUNT:');
      console.log('  ID:', admin._id);
      console.log('  Name:', `${admin.name.first} ${admin.name.last}`);
      console.log('  Email:', admin.email.address);
      console.log('  Phone:', admin.phone.number);
      console.log('  Roles:', JSON.stringify(admin.roles));
      console.log('  Primary Role:', admin.role);
      console.log('  Is Active:', admin.isActive);
      console.log('  Has Password:', !!admin.password);
      console.log('  Has Delivery Data:', !!admin.deliveryData);
    } else {
      console.log('❌ ADMIN NOT FOUND!');
    }
    
    console.log('\n');
    
    // Check user with phone 9060557296
    const phoneUser = await User.findOne({ 'phone.number': '9060557296' }).select('+password');
    
    if (phoneUser) {
      console.log('USER WITH PHONE 9060557296:');
      console.log('  ID:', phoneUser._id);
      console.log('  Name:', `${phoneUser.name.first} ${phoneUser.name.last}`);
      console.log('  Email:', phoneUser.email.address);
      console.log('  Phone:', phoneUser.phone.number);
      console.log('  Roles:', JSON.stringify(phoneUser.roles));
      console.log('  Primary Role:', phoneUser.role);
      console.log('  Is Active:', phoneUser.isActive);
      console.log('  Has Password:', !!phoneUser.password);
      console.log('  Has Delivery Data:', !!phoneUser.deliveryData);
    } else {
      console.log('❌ USER WITH PHONE 9060557296 NOT FOUND!');
    }
    
    console.log('\n');
    
    // Check if they're the same user
    if (admin && phoneUser) {
      const isSameUser = admin._id.equals(phoneUser._id);
      console.log('🔍 ARE THEY THE SAME USER?', isSameUser ? 'YES ❌' : 'NO ✅');
      
      if (isSameUser) {
        console.log('\n⚠️  CRITICAL BUG CONFIRMED:');
        console.log('   When registering delivery agent with admin phone,');
        console.log('   it added delivery role to admin account!');
        console.log('   This is a MAJOR security vulnerability.');
      }
    }
    
    console.log('\n==================================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSecurityIssue();
