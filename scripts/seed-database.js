require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const logger = require('../src/utils/logger');

// Import models
const Menu = require('../src/models/Menu');
const Category = require('../src/models/Category');
const Offer = require('../src/models/Offer');
const Settings = require('../src/models/Settings');

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tiptop_dev');
    logger.info('✅ Connected to MongoDB');

    // Clear existing data
    await Menu.deleteMany({});
    await Category.deleteMany({});
    await Offer.deleteMany({});
    logger.info('🗑️  Cleared existing data');

    // Create categories
    const categories = await Category.insertMany([
      {
        name: 'Burgers',
        description: 'Delicious handcrafted burgers',
        image: '/images/category/burger.jpg',
        isActive: true,
      },
      {
        name: 'Pizzas',
        description: 'Wood-fired authentic pizzas',
        image: '/images/category/pizza.jpg',
        isActive: true,
      },
      {
        name: 'Salads',
        description: 'Fresh and healthy salads',
        image: '/images/category/salad.jpg',
        isActive: true,
      },
      {
        name: 'Desserts',
        description: 'Sweet delights',
        image: '/images/category/dessert.jpg',
        isActive: true,
      },
      {
        name: 'Beverages',
        description: 'Refreshing drinks',
        image: '/images/category/beverage.jpg',
        isActive: true,
      },
    ]);
    logger.info(`✅ Created ${categories.length} categories`);

    // Create menu items
    const menuItems = await Menu.insertMany([
      {
        name: 'Classic Burger',
        description: 'Juicy beef patty with fresh vegetables',
        category: categories[0]._id,
        price: 12.99,
        image: '/images/product/burger1.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 15,
      },
      {
        name: 'Cheese Burger',
        description: 'Double cheese with crispy bacon',
        category: categories[0]._id,
        price: 14.99,
        image: '/images/product/burger2.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 15,
      },
      {
        name: 'Margherita Pizza',
        description: 'Fresh mozzarella, basil, tomato sauce',
        category: categories[1]._id,
        price: 13.99,
        image: '/images/product/pizza1.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 20,
      },
      {
        name: 'Pepperoni Pizza',
        description: 'Loaded with pepperoni and cheese',
        category: categories[1]._id,
        price: 15.99,
        image: '/images/product/pizza2.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 20,
      },
      {
        name: 'Caesar Salad',
        description: 'Crispy romaine with parmesan',
        category: categories[2]._id,
        price: 9.99,
        image: '/images/product/salad1.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 10,
      },
      {
        name: 'Greek Salad',
        description: 'Fresh feta cheese with olives',
        category: categories[2]._id,
        price: 10.99,
        image: '/images/product/salad2.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 10,
      },
      {
        name: 'Chocolate Cake',
        description: 'Rich and decadent chocolate cake',
        category: categories[3]._id,
        price: 6.99,
        image: '/images/product/dessert1.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 5,
      },
      {
        name: 'Cheesecake',
        description: 'Creamy New York style cheesecake',
        category: categories[3]._id,
        price: 7.99,
        image: '/images/product/dessert2.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 5,
      },
      {
        name: 'Coca Cola',
        description: 'Ice-cold refreshing Coca Cola',
        category: categories[4]._id,
        price: 2.99,
        image: '/images/product/drink1.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 2,
      },
      {
        name: 'Orange Juice',
        description: 'Fresh squeezed orange juice',
        category: categories[4]._id,
        price: 3.99,
        image: '/images/product/drink2.jpg',
        isAvailable: true,
        isActive: true,
        preparationTime: 2,
      },
    ]);
    logger.info(`✅ Created ${menuItems.length} menu items`);

    // Create offers
    const offers = await Offer.insertMany([
      {
        title: 'Burger Special',
        description: 'Get 20% off on all burgers',
        type: 'discount',
        discountPercent: 20,
        applicableOn: [categories[0]._id],
        isActive: true,
      },
      {
        title: 'Pizza Tuesday',
        description: 'Buy one get one 50% off on pizzas',
        type: 'discount',
        discountPercent: 50,
        applicableOn: [categories[1]._id],
        isActive: true,
      },
    ]);
    logger.info(`✅ Created ${offers.length} offers`);

    // Ensure default settings exist
    const existingSettings = await Settings.findOne({ singleton: true });
    if (!existingSettings) {
      await Settings.create({
        singleton: true,
        siteName: 'ThéTipTop',
        contactEmail: 'contact@thetiptop.com',
        contactPhone: '+33 1 23 45 67 89',
        businessAddress: '123 Restaurant Street, Paris, France',
        website: 'www.thetiptop.com',
        shopStatus: {
          isOpen: true,
          lastUpdatedBy: 'System',
          lastUpdatedAt: new Date(),
          closureReason: ''
        }
      });
      logger.info('✅ Created default settings');
    }

    logger.info('🌱 Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
