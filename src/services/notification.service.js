const admin = require('firebase-admin');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.initialized = false;
    this.initialize();
  }

  initialize() {
    try {
      // Check if Firebase is already initialized
      if (admin.apps.length > 0) {
        this.initialized = true;
        logger.info('✅ Firebase already initialized');
        return;
      }

      // Initialize Firebase Admin SDK
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // For production (Render) - JSON string in environment variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        this.initialized = true;
        logger.info('✅ Firebase Cloud Messaging initialized from environment variable');
      } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        // Alternative: individual environment variables
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          })
        });
        this.initialized = true;
        logger.info('✅ Firebase Cloud Messaging initialized from individual env vars');
      } else {
        logger.warn('⚠️  Firebase credentials not configured. Push notifications disabled.');
        logger.warn('   Set FIREBASE_SERVICE_ACCOUNT (JSON string) or individual Firebase env vars');
      }
    } catch (error) {
      logger.error('❌ Failed to initialize Firebase:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Send push notification when a new order is created
   * @param {Object} order - Order object with customer and details
   * @param {string} deviceToken - FCM device token of the recipient
   */
  async sendOrderNotification(order, deviceToken) {
    if (!this.initialized) {
      logger.error('Firebase not initialized. Cannot send notification.');
      return false;
    }

    if (!deviceToken) {
      return false;
    }

    try {
      const totalAmount = order.pricing?.finalAmount || order.totalAmount || 0;
      
      const message = {
        notification: {
          title: '🎉 Order Placed Successfully!',
          body: `Order #${order.orderNumber || order._id.toString().slice(-6)} - ${order.items.length} items - ₹${totalAmount.toFixed(2)}`
        },
        data: {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber || '',
          type: 'NEW_ORDER',
          totalAmount: totalAmount.toString(),
          itemCount: order.items.length.toString(),
          timestamp: new Date().toISOString()
        },
        token: deviceToken,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'orders',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      logger.info(`📱 [FCM] Message prepared:`, {
        title: message.notification.title,
        body: message.notification.body,
        orderId: message.data.orderId,
        type: message.data.type
      });

      logger.info(`📱 [FCM] Sending to Firebase...`);
      const response = await admin.messaging().send(message);
      
      logger.info(`✅ [FCM] Order notification sent successfully!`);
      logger.info(`✅ [FCM] Firebase Response: ${response}`);
      logger.info(`✅ [FCM] Order: ${order.orderNumber}, Amount: ₹${order.totalAmount}`);
      
      return true;
    } catch (error) {
      logger.error(`❌ [FCM] Failed to send order notification`);
      logger.error(`❌ [FCM] Error Message: ${error.message}`);
      logger.error(`❌ [FCM] Error Code: ${error.code}`);
      logger.error(`❌ [FCM] Order ID: ${order._id}`);
      logger.error(`❌ [FCM] Device Token (first 30): ${deviceToken.substring(0, 30)}`);
      if (error.stack) {
        logger.error(`❌ [FCM] Stack Trace: ${error.stack}`);
      }
      return false;
    }
  }

  /**
   * Send push notification when order status changes
   * @param {Object} order - Order object
   * @param {string} newStatus - New order status
   * @param {string} deviceToken - FCM device token
   */
  async sendOrderStatusUpdate(order, newStatus, deviceToken) {
    if (!this.initialized || !deviceToken) {
      return false;
    }

    try {
      const statusMessages = {
        confirmed: '✅ Your order has been confirmed!',
        preparing: '👨‍🍳 Your order is being prepared',
        ready: '🎉 Your order is ready for pickup!',
        picked_up: '🚚 Your order is out for delivery',
        delivered: '✅ Your order has been delivered!',
        cancelled: '❌ Your order has been cancelled'
      };

      const message = {
        notification: {
          title: 'Order Status Update',
          body: statusMessages[newStatus] || `Order status: ${newStatus}`
        },
        data: {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber || '',
          type: 'ORDER_STATUS_UPDATE',
          status: newStatus,
          timestamp: new Date().toISOString()
        },
        token: deviceToken,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'orders'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default'
            }
          }
        }
      };

      const response = await admin.messaging().send(message);
      logger.info(`✅ Order status notification sent. Status: ${newStatus}, FCM Response: ${response}`);
      return true;
    } catch (error) {
      logger.error('❌ Failed to send order status notification:', error.message);
      return false;
    }
  }

  /**
   * Send notification to multiple devices (broadcast)
   * @param {Array<string>} deviceTokens - Array of FCM device tokens
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data payload
   */
  async sendMulticastNotification(deviceTokens, title, body, data = {}) {
    if (!this.initialized || !deviceTokens || deviceTokens.length === 0) {
      return false;
    }

    try {
      const message = {
        notification: { title, body },
        data: {
          ...data,
          timestamp: new Date().toISOString()
        },
        tokens: deviceTokens
      };

      const response = await admin.messaging().sendMulticast(message);
      logger.info(`✅ Multicast notification sent. Success: ${response.successCount}, Failed: ${response.failureCount}`);
      
      // Log failed tokens for cleanup
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            logger.warn(`Failed token: ${deviceTokens[idx]}, Error: ${resp.error?.message}`);
          }
        });
      }

      return true;
    } catch (error) {
      logger.error('❌ Failed to send multicast notification:', error.message);
      return false;
    }
  }

  /**
   * Send custom notification
   * @param {string} deviceToken - FCM device token
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data payload
   */
  async sendCustomNotification(deviceToken, title, body, data = {}) {
    if (!this.initialized || !deviceToken) {
      return false;
    }

    try {
      const message = {
        notification: { 
          title, 
          body,
          ...(data.icon && { imageUrl: data.icon })
        },
        data: {
          ...data,
          timestamp: new Date().toISOString()
        },
        token: deviceToken
      };

      const response = await admin.messaging().send(message);
      logger.info(`✅ Custom notification sent. FCM Response: ${response}`);
      return true;
    } catch (error) {
      logger.error('❌ Failed to send custom notification:', error.message);
      return false;
    }
  }
}

module.exports = new NotificationService();
