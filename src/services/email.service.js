const logger = require('../utils/logger');
const { Resend } = require('resend');

/**
 * Email Service for Critical Error Notifications Only
 * 
 * This service is configured to send emails ONLY for critical errors.
 * All other email functionality (OTP, order confirmations) has been removed.
 * 
 * Uses Resend.com:
 * - Free tier: 100 emails/day, 3,000/month
 * - Works on all hosting platforms including Render
 * - No SMTP required (REST API based)
 * 
 * Setup:
 * 1. Sign up at https://resend.com (FREE)
 * 2. Get API key from dashboard
 * 3. Add RESEND_API_KEY to .env
 * 4. Add DEVELOPER_EMAIL to receive error notifications
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
      logger.warn('⚠️  RESEND_API_KEY not configured. Critical error emails disabled.');
      return;
    }

    if (!this.developerEmail) {
      logger.warn('⚠️  DEVELOPER_EMAIL not configured. Critical error emails disabled.');
      return;
    }

    try {
      this.client = new Resend(process.env.RESEND_API_KEY);
      this.enabled = true;
    } catch (error) {
      logger.error('❌ Failed to initialize email service:', error.message);
    }
  }

  /**
   * Send critical error notification to developer
   * This is the ONLY email functionality in the system
   */
  async sendErrorNotification(error, context = {}) {
    if (!this.enabled) {
      logger.warn('⚠️  Email service disabled. Cannot send error notification.');
      return false;
    }

    if (!this.developerEmail) {
      logger.warn('⚠️  DEVELOPER_EMAIL not configured. Skipping error notification.');
      return false;
    }

    try {
      logger.info('📧 Sending critical error notification to developer');

      const errorDetails = {
        message: error.message || 'Unknown error',
        stack: error.stack || 'No stack trace',
        name: error.name || 'Error',
        code: error.code || 'N/A',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        ...context,
      };

      const userInfo = context.user
        ? `
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h3 style="margin: 0 0 10px 0; color: #333;">User Information</h3>
          <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>Email:</strong> ${context.user.email || 'N/A'}</p>
          <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>Role:</strong> ${context.user.role || 'N/A'}</p>
          <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>ID:</strong> ${context.user._id || 'N/A'}</p>
        </div>
        `
        : '';

      const requestInfo = context.req
        ? `
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h3 style="margin: 0 0 10px 0; color: #333;">Request Information</h3>
          <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>Method:</strong> ${context.req.method || 'N/A'}</p>
          <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>URL:</strong> ${context.req.url || 'N/A'}</p>
          <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>IP:</strong> ${context.req.ip || 'N/A'}</p>
        </div>
        `
        : '';

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Critical Error Alert</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 30px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🚨 Critical Error Alert</h1>
                      <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Environment: ${errorDetails.environment.toUpperCase()}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px 30px;">
                      <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin-bottom: 20px;">
                        <h2 style="margin: 0 0 10px 0; color: #dc2626; font-size: 20px;">${errorDetails.name}</h2>
                        <p style="margin: 0; color: #991b1b; font-size: 14px;">${errorDetails.message}</p>
                      </div>
                      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                        <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>Error Code:</strong> ${errorDetails.code}</p>
                        <p style="margin: 5px 0; color: #666; font-size: 14px;"><strong>Timestamp:</strong> ${errorDetails.timestamp}</p>
                      </div>
                      <h3 style="margin: 20px 0 10px 0; color: #333;">Stack Trace</h3>
                      <div style="background-color: #1f2937; color: #f3f4f6; padding: 15px; border-radius: 8px; overflow-x: auto; font-family: monospace; font-size: 12px; line-height: 1.5;">
                        ${errorDetails.stack.replace(/\n/g, '<br>')}
                      </div>
                      ${userInfo}
                      ${requestInfo}
                      ${context.additionalInfo ? `
                      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                        <h3 style="margin: 0 0 10px 0; color: #333;">Additional Information</h3>
                        <pre style="margin: 0; color: #666; font-size: 12px; white-space: pre-wrap;">${JSON.stringify(context.additionalInfo, null, 2)}</pre>
                      </div>
                      ` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #eeeeee;">
                      <p style="color: #999999; font-size: 12px; margin: 0;">
                        This is an automated alert from ThéTipTop error monitoring system.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      const result = await this.client.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: [this.developerEmail],
        subject: `🚨 Critical Error in ${errorDetails.environment.toUpperCase()} - ${errorDetails.name}`,
        html: htmlContent,
      });

      logger.info(`✅ Error notification sent to ${this.developerEmail}. ID: ${result.id || result.data?.id || 'unknown'}`);
      return true;
    } catch (emailError) {
      logger.error('❌ Failed to send error notification:', emailError.message);
      return false;
    }
  }
}

module.exports = new EmailService();
