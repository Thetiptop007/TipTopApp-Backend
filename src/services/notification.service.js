const admin = require('firebase-admin');
const https = require('https');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.initialized = false;
    this.expoAccessToken = process.env.EXPO_ACCESS_TOKEN || null;
    this.initialize();
  }

  initialize() {
    try {
      // Check if Firebase is already initialized
      if (admin.apps.length > 0) {
        this.initialized = true;
        logger.info('✅ Firebase Cloud Messaging initialized');
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        this.initialized = true;
        logger.info('✅ Firebase Cloud Messaging initialized from environment variable');
      } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
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
        logger.warn('⚠️  Firebase credentials not configured. FCM push notifications will be disabled.');
      }

      if (!this.expoAccessToken) {
        logger.warn('⚠️  EXPO_ACCESS_TOKEN not configured. Expo push notifications will be disabled.');
      } else {
        logger.info('✅ Expo Push Notifications configured');
      }
    } catch (error) {
      logger.error('❌ Failed to initialize notification services:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Detect token type (Expo or FCM)
   */
  getTokenType(token) {
    if (!token) return null;
    if (token.startsWith('ExponentPushToken[')) return 'expo';
    if (token.match(/^[a-zA-Z0-9_-]{152}$/)) return 'fcm'; // FCM tokens are typically 152 chars
    return 'expo'; // Default to Expo for unknown formats
  }

  /**
   * Send push notification via Expo using native https
   */
  async sendExpoNotification(token, title, body, data = {}) {
    if (!this.expoAccessToken) {
      logger.warn('Expo token configured but EXPO_ACCESS_TOKEN not available');
      return false;
    }

    return new Promise((resolve) => {
      try {
        const payload = {
          to: token,
          sound: 'default',
          title,
          body,
          data,
          badge: 1,
          priority: 'high',
          channelId: 'orders',
        };

        const options = {
          hostname: 'exp.host',
          port: 443,
          path: '/--/api/v2/push/send',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(JSON.stringify(payload)),
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Authorization': `Bearer ${this.expoAccessToken}`,
          },
        };

        const req = https.request(options, (res) => {
          let responseData = '';

          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            try {
              const response = JSON.parse(responseData);
              if (response.data) {
                logger.info(`✅ [EXPO] Push notification sent successfully`);
                resolve(true);
              } else {
                logger.error(`❌ [EXPO] Failed to send notification:`, response.errors);
                resolve(false);
              }
            } catch (error) {
              logger.error(`❌ [EXPO] Failed to parse response: ${error.message}`);
              resolve(false);
            }
          });
        });

        req.on('error', (error) => {
          logger.error(`❌ [EXPO] Error sending notification: ${error.message}`);
          resolve(false);
        });

        req.write(JSON.stringify(payload));
        req.end();
      } catch (error) {
        logger.error(`❌ [EXPO] Error preparing notification: ${error.message}`);
        resolve(false);
      }
    });
  }

  /**
   * Send push notification when a new order is created
   * Supports both Expo and FCM tokens
   * @param {Object} order - Order object with customer and details
   * @param {string} deviceToken - Device token (Expo or FCM)
   */
  async sendOrderNotification(order, deviceToken) {
    if (!deviceToken) {
      return false;
    }

    const tokenType = this.getTokenType(deviceToken);
    logger.info(`📱 Sending order notification via ${tokenType.toUpperCase()}`);

    try {
      const totalAmount = order.pricing?.finalAmount || order.totalAmount || 0;
      
      const title = '🎉 Order Placed Successfully!';
      const body = `Order #${order.orderNumber || order._id.toString().slice(-6)} - ${order.items.length} items - ₹${totalAmount.toFixed(2)}`;
      
      const data = {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber || '',
        type: 'NEW_ORDER',
        totalAmount: totalAmount.toString(),
        itemCount: order.items.length.toString(),
        timestamp: new Date().toISOString()
      };

      // Send via Expo if it's an Expo token
      if (tokenType === 'expo') {
        return await this.sendExpoNotification(deviceToken, title, body, data);
      }

      // Send via FCM if it's an FCM token
      if (tokenType === 'fcm' && this.initialized) {
        const message = {
          notification: { title, body },
          data,
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

        const response = await admin.messaging().send(message);
        logger.info(`✅ [FCM] Order notification sent successfully! Response: ${response}`);
        return true;
      }

      logger.warn(`⚠️  No notification service available for token type: ${tokenType}`);
      return false;
    } catch (error) {
      logger.error(`❌ Failed to send order notification`);
      logger.error(`   Token Type: ${tokenType}`);
      logger.error(`   Error: ${error.message}`);
      logger.error(`   Order ID: ${order._id}`);
      logger.error(`   Device Token (first 30): ${deviceToken.substring(0, 30)}`);
      return false;
    }
  }

  /**
   * Send push notification when order status changes
   * Supports both Expo and FCM tokens
   * @param {Object} order - Order object
   * @param {string} newStatus - New order status
   * @param {string} deviceToken - Device token (Expo or FCM)
   */
  async sendOrderStatusUpdate(order, newStatus, deviceToken) {
    if (!deviceToken) {
      return false;
    }

    const tokenType = this.getTokenType(deviceToken);

    try {
      const statusMessages = {
        confirmed: '✅ Your order has been confirmed!',
        preparing: '👨‍🍳 Your order is being prepared',
        ready: '🎉 Your order is ready for pickup!',
        picked_up: '🚚 Your order is out for delivery',
        delivered: '✅ Your order has been delivered!',
        cancelled: '❌ Your order has been cancelled'
      };

      const title = 'Order Status Update';
      const body = statusMessages[newStatus] || `Order status: ${newStatus}`;
      
      const data = {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber || '',
        type: 'ORDER_STATUS_UPDATE',
        status: newStatus,
        timestamp: new Date().toISOString()
      };

      // Send via Expo if it's an Expo token
      if (tokenType === 'expo') {
        return await this.sendExpoNotification(deviceToken, title, body, data);
      }

      // Send via FCM if it's an FCM token
      if (tokenType === 'fcm' && this.initialized) {
        const message = {
          notification: { title, body },
          data,
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
      }

      logger.warn(`⚠️  No notification service available for token type: ${tokenType}`);
      return false;
    } catch (error) {
      logger.error(`❌ Failed to send order status update: ${error.message}`);
      return false;
    }
  }

  /**
   * Send custom notification to a device
   * Supports both Expo and FCM tokens
   * @param {string} deviceToken - Device token (Expo or FCM)
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data payload
   */
  async sendCustomNotification(deviceToken, title, body, data = {}) {
    if (!deviceToken) {
      return false;
    }

    const tokenType = this.getTokenType(deviceToken);

    try {
      // Send via Expo if it's an Expo token
      if (tokenType === 'expo') {
        return await this.sendExpoNotification(deviceToken, title, body, data);
      }

      // Send via FCM if it's an FCM token
      if (tokenType === 'fcm' && this.initialized) {
        const message = {
          notification: { title, body },
          data,
          token: deviceToken,
          android: {
            priority: 'high',
            notification: {
              sound: 'default'
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
        logger.info(`✅ [FCM] Custom notification sent. Response: ${response}`);
        return true;
      }

      logger.warn(`⚠️  No notification service available for token type: ${tokenType}`);
      return false;
    } catch (error) {
      logger.error(`❌ Failed to send custom notification: ${error.message}`);
      return false;
    }
  }

  /**
   * Send notification to multiple devices (broadcast)
   * Automatically routes to Expo or FCM based on token type
   * @param {Array<string>} deviceTokens - Array of device tokens (Expo or FCM)
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data payload
   */
  async sendMulticastNotification(deviceTokens, title, body, data = {}) {
    if (!deviceTokens || deviceTokens.length === 0) {
      return { success: 0, failed: 0 };
    }

    let successCount = 0;
    let failedCount = 0;

    for (const token of deviceTokens) {
      const result = await this.sendCustomNotification(token, title, body, data);
      if (result) {
        successCount++;
      } else {
        failedCount++;
      }
    }

    logger.info(`📊 Broadcast complete - Success: ${successCount}, Failed: ${failedCount}`);
    return { success: successCount, failed: failedCount };
  }
}

module.exports = new NotificationService();
