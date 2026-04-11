const mongoose = require('mongoose');
require('dotenv').config();

const Order = require('../src/models/Order');

const TARGET_PHONE = '9999999999';

const getMongoUri = () => {
  return (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URI
  );
};

const run = async () => {
  try {
    const mongoUri = getMongoUri();

    if (!mongoUri) {
      console.error('MONGODB_URI (or MONGO_URI / DATABASE_URI) is not set');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected');

    const filter = { 'customer.phone': TARGET_PHONE };
    const matchedCount = await Order.countDocuments(filter);

    console.log(`Orders found for ${TARGET_PHONE}: ${matchedCount}`);

    if (matchedCount === 0) {
      console.log('Nothing to delete.');
      process.exit(0);
    }

    const result = await Order.deleteMany(filter);
    console.log(`Deleted orders: ${result.deletedCount}`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to delete orders:', error.message);
    process.exit(1);
  }
};

run();
