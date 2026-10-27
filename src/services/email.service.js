const logger = require('../utils/logger');
const { Resend } = require('resend');

/**
 * Enterprise Email Service using Resend
 * 
 * Configured for:
 * - Critical error notifications
 * - Customer password reset links / OTPs
 * - Order confirmation emails
 * - General transactional messaging
 */
class EmailService {
  constructor() {
    this.client = null;
    this.enabled = false;
    this.fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
    this.fromName = process.env.FROM_NAME || 'ThéTipTop';
    this.developerEmail = process.env.DEVELOPER_EMAIL;
    this.initialize();
  }

  initialize() {
    if (!process.env.RESEND_API_KEY) {
      logger.system('EMAIL_RESEND_API_KEY_MISSING', 'RESEND_API_KEY not configured; email service disabled', {}, { level: 'warn', severity: 'medium' });
      return;
    }

    try {
      this.client = new Resend(process.env.RESEND_API_KEY);
      this.enabled = true;
      logger.system('EMAIL_SERVICE_INIT', 'Resend email service initialized successfully', { from: this.fromEmail });
    } catch (error) {
      logger.system('EMAIL_INIT_FAILED', 'Failed to initialize email service', { errorMessage: error.message }, { level: 'error', severity: 'high' });
    }
  }

  /**
   * Generic sender with formatting and error resilience
   */
  async sendEmail({ to, subject, html, text }) {
    if (!this.enabled || !this.client) {
      logger.system('EMAIL_SERVICE_DISABLED', 'Cannot send email: Resend service not initialized', { to, subject }, { level: 'warn', severity: 'medium' });
      return { success: false, reason: 'disabled' };
    }

    try {
      const recipientList = Array.isArray(to) ? to : [to];
      const payload = {
        from: `${this.fromName} <${this.fromEmail}>`,
        to: recipientList,
        subject,
        html,
      };
      if (text) payload.text = text;

      const result = await this.client.emails.send(payload);
      logger.system('EMAIL_SENT_SUCCESS', 'Email dispatched via Resend', {
        to: recipientList,
        subject,
        id: result?.id || result?.data?.id,
      });
      return { success: true, data: result };
    } catch (error) {
      logger.system('EMAIL_SEND_ERROR', 'Failed to dispatch email via Resend', {
        to,
        subject,
        errorMessage: error?.message || String(error),
      }, { level: 'error', severity: 'medium' });
      return { success: false, error: error?.message };
    }
  }

  /**
   * Send Password Reset Link / Code to Customer
   */
  async sendPasswordResetEmail(email, resetUrl, context = {}) {
    const customerName = context.name || 'Valued Customer';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Reset Your TipTop Password</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F6F5F2; padding: 24px; margin: 0;">
        <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #eae6df;">
          <div style="background: linear-gradient(135deg, #D8271E 0%, #a71812 100%); padding: 32px 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Thé Tip Top</h1>
            <p style="color: #F2C8B8; margin: 6px 0 0 0; font-size: 13px;">Delicious Food, Fast Delivery</p>
          </div>
          <div style="padding: 36px 32px; color: #1E1E1E;">
            <h2 style="font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 12px; color: #111;">Password Reset Request</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #555; margin-bottom: 24px;">
              Hello ${customerName},<br />
              We received a request to reset the password for your Tip Top account associated with <strong>${email}</strong>.
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" style="display: inline-block; background-color: #D8271E; color: #ffffff; font-weight: 700; font-size: 14px; padding: 14px 32px; text-decoration: none; border-radius: 9999px; box-shadow: 0 4px 12px rgba(216, 39, 30, 0.25);">
                Reset Password
              </a>
            </div>
            <p style="font-size: 12px; line-height: 1.6; color: #777; margin-bottom: 8px;">
              This link is valid for <strong>15 minutes</strong>. If you did not request a password reset, you can safely ignore this email — your account remains secure.
            </p>
            <p style="font-size: 11px; color: #999; word-break: break-all; margin-top: 16px;">
              If the button above does not work, paste this URL into your browser:<br />
              <a href="${resetUrl}" style="color: #D8271E;">${resetUrl}</a>
            </p>
          </div>
          <div style="background-color: #faf8f5; padding: 20px 32px; text-align: center; border-top: 1px solid #eae6df; font-size: 12px; color: #999;">
            &copy; ${new Date().getFullYear()} The Tip Top Restaurant • Law Gate, Phagwara, Punjab
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Reset your Thé Tip Top Password',
      html,
    });
  }

  /**
   * Send Order Confirmation to Customer
   */
  async sendOrderConfirmationEmail(email, order, context = {}) {
    const customerName = context.name || 'Valued Customer';
    const itemsListHtml = (order.items || [])
      .map(
        (i) => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-size: 13px; color: #333;">
            ${i.name || i.menuItem?.name || 'Item'} ${i.quantity ? `× ${i.quantity}` : ''}
          </td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-size: 13px; text-align: right; color: #111; font-weight: 600;">
            ₹${i.price || 0}
          </td>
        </tr>
      `
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Confirmed - Thé Tip Top</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F6F5F2; padding: 24px; margin: 0;">
        <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #eae6df;">
          <div style="background: linear-gradient(135deg, #D8271E 0%, #a71812 100%); padding: 32px 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 800;">Order Received!</h1>
            <p style="color: #F2C8B8; margin: 6px 0 0 0; font-size: 13px;">Order #${order.orderNumber || order._id}</p>
          </div>
          <div style="padding: 32px; color: #1E1E1E;">
            <p style="font-size: 14px; color: #555; margin-top: 0;">
              Thank you ${customerName}! Your order has been placed and is currently being prepared by our kitchen.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
              <thead>
                <tr>
                  <th align="left" style="padding-bottom: 8px; border-bottom: 2px solid #D8271E; font-size: 12px; text-transform: uppercase; color: #D8271E;">Item</th>
                  <th align="right" style="padding-bottom: 8px; border-bottom: 2px solid #D8271E; font-size: 12px; text-transform: uppercase; color: #D8271E;">Price</th>
                </tr>
              </thead>
              <tbody>
                ${itemsListHtml}
              </tbody>
              <tfoot>
                <tr>
                  <td style="padding-top: 14px; font-size: 15px; font-weight: 800; color: #111;">Total Amount</td>
                  <td style="padding-top: 14px; font-size: 15px; font-weight: 800; text-align: right; color: #D8271E;">₹${order.total || order.amount || 0}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style="background-color: #faf8f5; padding: 20px 32px; text-align: center; border-top: 1px solid #eae6df; font-size: 12px; color: #999;">
            &copy; ${new Date().getFullYear()} The Tip Top Restaurant • Law Gate, Phagwara, Punjab
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: `Order #${order.orderNumber || order._id} Confirmed - Thé Tip Top`,
      html,
    });
  }

  /**
   * Critical error notification for system alerts
   */
  async sendErrorNotification(error, context = {}) {
    if (!this.enabled || !this.developerEmail) {
      return false;
    }

    try {
      const errorDetails = {
        message: error.message || 'Unknown error',
        stack: error.stack || 'No stack trace',
        name: error.name || 'Error',
        code: error.code || 'N/A',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        ...context,
      };

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; padding: 30px;">
            <h2 style="color: #dc2626; margin-top: 0;">🚨 Critical Server Alert (${errorDetails.environment.toUpperCase()})</h2>
            <p><strong>Error:</strong> ${errorDetails.message}</p>
            <p><strong>Code:</strong> ${errorDetails.code}</p>
            <p><strong>Timestamp:</strong> ${errorDetails.timestamp}</p>
            <h3>Stack:</h3>
            <pre style="background: #1f2937; color: #fff; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto;">${errorDetails.stack}</pre>
          </div>
        </body>
        </html>
      `;

      return await this.sendEmail({
        to: this.developerEmail,
        subject: `🚨 Critical Error Alert: ${errorDetails.name}`,
        html: htmlContent,
      });
    } catch {
      return false;
    }
  }

  /**
   * Send Session Revocation OTP
   */
  async sendSessionRevocationOtp(email, otp, context = {}) {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 12px;">
        <h2 style="color: #D8271E;">Security Verification OTP</h2>
        <p>A request was made to revoke a session from your account. Use this OTP to confirm:</p>
        <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #D8271E; background: #fff5f5; padding: 16px; text-align: center; border-radius: 8px;">
          ${otp}
        </div>
        <p style="font-size: 12px; color: #888; margin-top: 16px;">Valid for 5 minutes. If this wasn't you, please secure your account.</p>
      </div>
    `;

    return this.sendEmail({
      to: email,
      subject: `Your Security OTP: ${otp}`,
      html: htmlContent,
    });
  }
}

module.exports = new EmailService();
