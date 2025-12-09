import { supabaseAdmin } from './supabase';
import { Resend } from 'resend';
import { sendClickSendSMS } from './sms-service';
import { notificationLogger } from './notification-logger';

// ClickSend types (basic)
interface ClickSendConfig {
  authentications: {
    BasicAuth: {
      username: string;
      password: string;
    };
  };
}

interface ClickSendMessage {
  source: string;
  to: string;
  body: string;
  from?: string;
  voice?: string;
  custom_string?: string;
}

interface ClickSendCollection {
  messages: ClickSendMessage[];
}

// Types for notifications
export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  voice: boolean;
  reminder_days: number[];
}

export interface VehicleReminder {
  id: string;
  user_id: string;
  license_plate: string;
  city_sticker_expiry: string;
  license_plate_expiry: string;
  emissions_due_date: string | null;
  email: string;
  phone: string;
  notification_preferences: NotificationPreferences;
  sent_reminders: string[];
  reminder_sent: boolean;
  reminder_sent_at: string | null;
}

export interface EmailNotification {
  to: string;
  subject: string;
  html: string;
  text: string;
  // Optional logging fields
  userId?: string;
  category?: string;
}

export interface SMSNotification {
  to: string;
  message: string;
  // Optional logging fields
  userId?: string;
  category?: string;
}

export interface VoiceNotification {
  to: string;
  message: string;
  // Optional logging fields
  userId?: string;
  category?: string;
}

export class NotificationService {
  private resend: Resend | null = null;
  private clicksendConfig: ClickSendConfig | null = null;

  constructor() {
    // Initialize Resend for email
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
    
    // Store ClickSend config for dynamic loading
    if (process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY) {
      this.clicksendConfig = {
        authentications: {
          BasicAuth: {
            username: process.env.CLICKSEND_USERNAME,
            password: process.env.CLICKSEND_API_KEY
          }
        }
      };
    }
  }

  private async getClickSend() {
    // Deprecated - using direct API calls instead
    return null;
  }

  // Email service using Resend
  async sendEmail(notification: EmailNotification): Promise<boolean> {
    let logId: string | null = null;

    try {
      // Log the notification attempt
      if (notification.userId || notification.category) {
        logId = await notificationLogger.log({
          user_id: notification.userId,
          email: notification.to,
          notification_type: 'email',
          category: notification.category || 'general',
          subject: notification.subject,
          content_preview: notification.text?.substring(0, 200),
          status: 'pending',
          metadata: {
            email_content: {
              subject: notification.subject,
              html: notification.html,
              text: notification.text
            }
          }
        });
      }

      if (!this.resend || !process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'your-resend-api-key-here' || process.env.RESEND_API_KEY.length < 10) {
        console.log('📧 MOCK: No valid Resend API key, would send email:', {
          to: notification.to,
          subject: notification.subject,
          preview: notification.text.substring(0, 100) + '...'
        });
        if (logId) await notificationLogger.updateStatus(logId, 'sent');
        return true; // Mock success when no valid API key
      }

      const fromAddress = process.env.RESEND_FROM || 'onboarding@resend.dev';

      console.log('📧 Sending email via Resend:', {
        from: fromAddress,
        to: notification.to,
        subject: notification.subject
      });

      const { data, error } = await this.resend.emails.send({
        from: fromAddress,
        to: [notification.to],
        subject: notification.subject,
        html: notification.html,
        text: notification.text,
        headers: {
          'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>',
          'X-Entity-Ref-ID': crypto.randomUUID(),
        },
        replyTo: 'support@autopilotamerica.com'
      });

      if (error) {
        console.error('Resend error details:', error);
        console.error('From address used:', fromAddress);
        if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, error.message);
        return false;
      }

      console.log('✅ Email sent successfully:', data);
      if (logId) await notificationLogger.updateStatus(logId, 'sent', data?.id);
      return true;
    } catch (error) {
      console.error('Email sending failed:', error);
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, String(error));
      return false;
    }
  }

  // SMS service using ClickSend
  async sendSMS(notification: SMSNotification): Promise<boolean> {
    let logId: string | null = null;

    try {
      // Log the notification attempt
      if (notification.userId || notification.category) {
        logId = await notificationLogger.log({
          user_id: notification.userId,
          phone: notification.to,
          notification_type: 'sms',
          category: notification.category || 'general',
          content_preview: notification.message?.substring(0, 200),
          status: 'pending',
          metadata: {
            sms_content: notification.message
          }
        });
      }

      console.log('📱 Sending SMS via ClickSend:', {
        to: notification.to,
        length: notification.message.length + ' chars'
      });

      // Use direct API implementation instead of broken npm package
      const result = await sendClickSendSMS(notification.to, notification.message);

      if (result.success) {
        console.log('✅ SMS sent successfully to', notification.to);
        if (logId) await notificationLogger.updateStatus(logId, 'sent');
      } else {
        if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, result.error || 'ClickSend API returned failure');
      }

      return result.success;
    } catch (error) {
      console.error('SMS sending failed:', error);
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, String(error));
      return false;
    }
  }

  // Voice service using ClickSend
  async sendVoiceCall(notification: VoiceNotification): Promise<boolean> {
    let logId: string | null = null;
    const username = process.env.CLICKSEND_USERNAME;
    const apiKey = process.env.CLICKSEND_API_KEY;

    // Log the notification attempt
    if (notification.userId || notification.category) {
      logId = await notificationLogger.log({
        user_id: notification.userId,
        phone: notification.to,
        notification_type: 'voice',
        category: notification.category || 'general',
        content_preview: notification.message?.substring(0, 200),
        status: 'pending',
        metadata: {
          voice_content: notification.message
        }
      });
    }

    if (!username || !apiKey) {
      console.log('📞 MOCK: No ClickSend credentials for voice call');
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, 'No ClickSend credentials');
      return false;
    }

    try {
      console.log('📞 Making voice call via ClickSend API:', {
        to: notification.to
      });

      const response = await fetch('https://rest.clicksend.com/v3/voice/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64')
        },
        body: JSON.stringify({
          messages: [
            {
              to: notification.to.replace(/\D/g, ''), // Remove non-digits
              body: notification.message,
              voice: 'female',
              source: 'nodejs',
              custom_string: 'ticketless-america'
            }
          ]
        })
      });

      const result = await response.json();

      if (response.ok && result.data?.messages?.[0]?.status === 'SUCCESS') {
        console.log('✅ Voice call initiated successfully to', notification.to);
        if (logId) await notificationLogger.updateStatus(logId, 'sent', result.data?.messages?.[0]?.message_id);
        return true;
      } else {
        console.error('❌ ClickSend Voice failed:', result);
        if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, JSON.stringify(result));
        return false;
      }
    } catch (error) {
      console.error('❌ Error making voice call via ClickSend:', error);
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, String(error));
      return false;
    }
  }
}

export class NotificationScheduler {
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  // Get all pending obligations that might need notifications
  async getPendingReminders(): Promise<any[]> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from('upcoming_obligations')
      .select('*');

    if (error) {
      console.error('Error fetching pending obligations:', error);
      return [];
    }

    return data || [];
  }

  // Calculate days until due date
  getDaysUntilDue(dueDate: string): number {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); // Normalize to UTC midnight
    const due = new Date(dueDate);
    due.setUTCHours(0, 0, 0, 0); // Normalize to UTC midnight
    const diffTime = due.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // Determine urgency level for content generation
  getUrgencyLevel(daysUntilDue: number): 'high' | 'medium' | 'low' {
    if (daysUntilDue <= 1) return 'high';
    if (daysUntilDue <= 7) return 'medium';
    return 'low';
  }

  // Generate notification content based on renewal type and urgency
  generateNotificationContent(
    obligation: any,
    renewalType: 'city_sticker' | 'license_plate' | 'emissions',
    daysUntilDue: number,
    hasProtection: boolean = false,
    hasPermitZone: boolean = false
  ): { email: EmailNotification; sms: SMSNotification; voice: VoiceNotification } {
    const urgency = this.getUrgencyLevel(daysUntilDue);
    const urgencyEmoji = urgency === 'high' ? '🚨' : urgency === 'medium' ? '⚠️' : '📋';
    
    let renewalName = '';
    let dueDate = '';
    let fineAmount = '';
    let renewalUrl = '';
    let tipText = '';
    
    switch (renewalType) {
      case 'city_sticker':
        renewalName = 'Chicago City Sticker';
        dueDate = obligation.due_date;
        fineAmount = '$200+ in fines';
        renewalUrl = 'https://www.chicityclerk.com/citysticker';
        tipText = '💡 Renew online or visit any Currency Exchange location. Bring your registration and proof of insurance.';
        break;
      case 'license_plate':
        renewalName = 'License Plate Registration';
        dueDate = obligation.due_date;
        fineAmount = '$90+ in fines';
        renewalUrl = 'https://www.ilsos.gov/departments/vehicles/registration/home.html';
        tipText = '💡 Renew at cyberdriveillinois.com or visit your local Secretary of State facility.';
        break;
      case 'emissions':
        renewalName = 'Emissions Test';
        dueDate = obligation.due_date;
        fineAmount = '$50-300 in fines';
        renewalUrl = 'https://www2.illinoisepa.gov/topics/air-quality/mobile-sources/vehicle-emissions/Pages/default.aspx';
        tipText = '💡 Find testing locations at airteam.app. Bring your registration and $20 cash.';
        break;
    }

    const dueDateFormatted = new Date(dueDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const timeText = daysUntilDue === 0 ? 'TODAY' : 
                     daysUntilDue === 1 ? 'TOMORROW' : 
                     `${daysUntilDue} days`;

    // Email content (helpful and supportive)
    const emailSubject = daysUntilDue <= 1
      ? `${renewalName} Renewal Reminder - Due ${timeText === 'TODAY' ? 'Today' : 'Tomorrow'}`
      : hasProtection
      ? `${renewalName} coming up - We'll handle the renewal`
      : `${renewalName} coming up in ${daysUntilDue} days`;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: #2563eb; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Autopilot America</h1>
          <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">Your Vehicle Compliance Partner</p>
        </div>
        
        <!-- Main Content -->
        <div style="padding: 32px 24px; background: #ffffff;">
          <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <h2 style="margin: 0 0 12px; color: #1e40af; font-size: 20px;">📋 ${renewalName} Reminder</h2>
            <div style="color: #1e40af; font-size: 16px; line-height: 1.5;">
              <strong>Vehicle:</strong> ${obligation.license_plate}<br>
              <strong>Due Date:</strong> ${dueDateFormatted}<br>
              <strong>Days Remaining:</strong> ${daysUntilDue === 0 ? 'Due today' : daysUntilDue === 1 ? '1 day' : `${daysUntilDue} days`}
            </div>
          </div>

          ${!hasProtection ? `
            ${daysUntilDue <= 1 ? `
              <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                <h3 style="color: #92400e; margin: 0 0 8px; font-size: 18px;">⏰ Renewal Due ${timeText === 'TODAY' ? 'Today' : 'Tomorrow'}</h3>
                <p style="color: #92400e; margin: 0;">We recommend renewing today to stay compliant and avoid any potential issues.</p>
              </div>
            ` : ''}

            <!-- Action Steps for Free Alert Users -->
            <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">How to Renew:</h3>
              <div style="color: #0369a1; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">
                ${tipText.replace('💡 ', '')}
              </div>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${renewalUrl}"
                   style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px; margin-right: 12px;">
                  Renew Online
                </a>
                <a href="https://autopilotamerica.com/dashboard"
                   style="background: #374151; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                  View Dashboard
                </a>
              </div>
            </div>

            <!-- Upgrade to Protection -->
            <div style="background: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <h3 style="color: #065f46; margin: 0 0 12px; font-size: 18px;">💡 Want us to handle this for you?</h3>
              <p style="color: #065f46; margin: 0 0 16px; line-height: 1.6;">
                Upgrade to Autopilot Protection and we'll purchase your renewals automatically. Never worry about forgetting again!
              </p>
              <div style="text-align: center;">
                <a href="https://autopilotamerica.com/protection"
                   style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 15px;">
                  Learn About Protection
                </a>
              </div>
            </div>
          ` : `
            <!-- Protection Plan: We Handle The Renewal -->
            <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
              <h3 style="color: #065f46; margin: 0 0 12px; font-size: 18px;">✅ We've Got This Covered</h3>
              <p style="color: #065f46; margin: 0; line-height: 1.6;">
                ${daysUntilDue <= 14
                  ? `We're purchasing your ${renewalName} on your behalf ${daysUntilDue === 14 ? 'today' : `in ${14 - daysUntilDue} days`}. You don't need to do anything!`
                  : `We'll purchase your ${renewalName} when there are 30 days left until expiration. You don't need to do anything!`
                }
              </p>
            </div>

            ${hasPermitZone ? `
              <!-- Permit Zone Document Upload Required -->
              <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
                <h3 style="color: #92400e; margin: 0 0 12px; font-size: 18px;">📄 Action Required: Upload Permit Zone Documents</h3>
                <p style="color: #92400e; margin: 0 0 16px; line-height: 1.6;">
                  Since you're in a residential permit parking zone, we need the following documents to complete your city sticker renewal:
                </p>
                <ul style="color: #92400e; margin: 0 0 16px; padding-left: 20px; line-height: 1.8;">
                  <li><strong>Driver's License:</strong> Front and back (clear photos)</li>
                  <li><strong>Proof of Residency:</strong> Utility bill, lease agreement, or mortgage statement showing your address</li>
                </ul>
                <div style="text-align: center;">
                  <a href="https://autopilotamerica.com/dashboard"
                     style="background: #f59e0b; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                    Upload Documents Now
                  </a>
                </div>
              </div>
            ` : ''}

            <!-- Confirm Your Information -->
            <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <h3 style="color: #0c4a6e; margin: 0 0 12px; font-size: 18px;">📝 Please Confirm Your Information</h3>
              <p style="color: #0369a1; margin: 0 0 16px; line-height: 1.6;">
                Before we purchase your renewal, please reply to this email if any of the following has changed:
              </p>
              <ul style="color: #0369a1; margin: 0; padding-left: 20px; line-height: 1.8;">
                <li>VIN (if you got a new vehicle)</li>
                <li>License plate number</li>
                <li>Mailing address</li>
              </ul>
            </div>
          `}

          <!-- Why We're Here -->
          <div style="background: #f9fafb; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #374151; margin: 0 0 12px; font-size: 16px;">Why This Matters:</h3>
            <p style="color: #6b7280; margin: 0; line-height: 1.6;">
              Staying on top of your vehicle renewals helps you avoid unnecessary fines and keeps you compliant with Chicago regulations.
              We're here to help make sure nothing slips through the cracks.
            </p>
          </div>
          
          <!-- Support Message -->
          <div style="text-align: center; color: #6b7280; margin: 24px 0;">
            <p style="margin: 0;">Questions? We're here to help at support@autopilotamerica.com</p>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
          <div style="margin-bottom: 12px;">
            <strong style="color: #374151;">Autopilot America</strong><br>
            Your trusted vehicle compliance partner
          </div>
          <div>
            <a href="https://autopilotamerica.com/dashboard" style="color: #6b7280; margin: 0 8px;">Dashboard</a> |
            <a href="https://autopilotamerica.com/support" style="color: #6b7280; margin: 0 8px;">Support</a> |
            <a href="https://autopilotamerica.com/unsubscribe?id=${obligation.obligation_id}" style="color: #6b7280; margin: 0 8px;">Unsubscribe</a>
          </div>
        </div>
      </div>
    `;

    const emailText = !hasProtection ? `
Hello,

This is a friendly reminder from Autopilot America about your upcoming ${renewalName}.

Vehicle: ${obligation.license_plate}
Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntilDue === 0 ? 'Due today' : daysUntilDue === 1 ? '1 day' : `${daysUntilDue} days`}

${daysUntilDue <= 1 ? 'We recommend renewing today to stay compliant.' : 'You have time to renew, but we wanted to give you a heads up.'}

Renew online: ${renewalUrl}
View your dashboard: https://autopilotamerica.com/dashboard

💡 Want us to handle this for you?
Upgrade to Autopilot Protection and we'll purchase your renewals automatically. Never worry about forgetting again!
Learn more: https://autopilotamerica.com/protection

Best regards,
Autopilot America Team

Questions? Reply to support@autopilotamerica.com
    ` : `
Hello,

This is a friendly reminder from Autopilot America about your upcoming ${renewalName}.

Vehicle: ${obligation.license_plate}
Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntilDue === 0 ? 'Due today' : daysUntilDue === 1 ? '1 day' : `${daysUntilDue} days`}

✅ WE'VE GOT THIS COVERED
${daysUntilDue <= 14
  ? `We're purchasing your ${renewalName} on your behalf ${daysUntilDue === 14 ? 'today' : `in ${14 - daysUntilDue} days`}. You don't need to do anything!`
  : `We'll purchase your ${renewalName} when there are 30 days left until expiration. You don't need to do anything!`
}

${hasPermitZone ? `
📄 ACTION REQUIRED: Upload Permit Zone Documents
Since you're in a residential permit parking zone, we need:
- Driver's License (front and back)
- Proof of Residency (utility bill, lease, or mortgage statement)

Upload now: https://autopilotamerica.com/dashboard
` : ''}

📝 PLEASE CONFIRM YOUR INFORMATION
Before we purchase your renewal, please reply if any of the following has changed:
- VIN (if you got a new vehicle)
- License plate number
- Mailing address

View your dashboard: https://autopilotamerica.com/dashboard

Best regards,
Autopilot America Team

Questions? Reply to support@autopilotamerica.com
    `;

    // SMS content - differentiate between simple reminders and auto-registration alerts
    const shortUrl = 'autopilotamerica.com';
    let smsMessage = '';

    if (!hasProtection) {
      // Simple reminder for free alert users
      if (daysUntilDue === 0) {
        smsMessage = `Autopilot: ${renewalName} expires TODAY for plate ${obligation.license_plate}. Renew now to avoid fines. - Autopilot America`;
      } else if (daysUntilDue === 1) {
        smsMessage = `Autopilot: ${renewalName} expires TOMORROW for plate ${obligation.license_plate}. Renew today to stay compliant. - Autopilot America`;
      } else if (daysUntilDue <= 7) {
        smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. Don't forget to renew! - Autopilot America`;
      } else if (daysUntilDue <= 14) {
        smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. Time to renew soon. - Autopilot America`;
      } else {
        smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. Mark your calendar! - Autopilot America`;
      }
    } else {
      // Auto-registration alerts for Protection plan users
      if (hasPermitZone) {
        // Permit zone users need to upload documents
        if (daysUntilDue === 14) {
          smsMessage = `Autopilot: ${renewalName} expires in 2 weeks for plate ${obligation.license_plate}. We're purchasing it TODAY. Reply NOW if info changed (VIN, plate, or address). ALSO: Upload permit zone docs (front/back of license + proof of residency) at ${shortUrl}/dashboard - Autopilot America`;
        } else if (daysUntilDue <= 21) {
          smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. We'll purchase in 7 days. Reply if info changed (VIN, plate, or address). IMPORTANT: Upload permit zone docs at ${shortUrl}/dashboard - Autopilot America`;
        } else if (daysUntilDue <= 30) {
          smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. We'll purchase when there's 30 days left. Reply with updates. REQUIRED: Upload permit zone docs at ${shortUrl}/dashboard - Autopilot America`;
        } else {
          smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. We'll purchase when there's 30 days left. Reply with any updates. Don't forget: Upload permit zone docs at ${shortUrl}/dashboard - Autopilot America`;
        }
      } else {
        // Standard protection users (no permit zone)
        if (daysUntilDue === 14) {
          smsMessage = `Autopilot: ${renewalName} expires in 2 weeks for plate ${obligation.license_plate}. We're purchasing it TODAY. Reply NOW if you have: New VIN (new car), new plate number, or new address. This is your final reminder. - Autopilot America`;
        } else if (daysUntilDue <= 21) {
          smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. We'll purchase it in 7 days. Please reply by then if you have: New VIN (new car), new plate number, or new address. - Autopilot America`;
        } else if (daysUntilDue <= 30) {
          smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. We'll purchase it when there's 30 days left. Reply anytime before then with any updates: New VIN (if new car), new plate number, or new address. - Autopilot America`;
        } else {
          smsMessage = `Autopilot: ${renewalName} expires in ${daysUntilDue} days for plate ${obligation.license_plate}. We'll purchase it when there's 30 days left, so you have time. If anything changed (new VIN, new plate, or address), reply anytime before then. - Autopilot America`;
        }
      }
    }

    // Voice content (friendly and informative)
    const plateSpoken = obligation.license_plate.split('').join(' '); // Spell out clearly: "A B C 1 2 3"
    const voiceMessage = daysUntilDue <= 1
      ? `Hello, this is Autopilot America calling with a friendly reminder. Your ${renewalName} is due ${timeText === 'TODAY' ? 'today' : 'tomorrow'} for vehicle ${plateSpoken}. We recommend renewing as soon as possible to stay compliant. You can renew online or visit a local facility. Thank you for being a Autopilot America customer. Have a great day!`
      : `Hello, this is Autopilot America calling. Your ${renewalName} is coming up in ${daysUntilDue} days for vehicle ${plateSpoken}. This is just a friendly reminder to help you stay on top of your renewals. You can renew online or visit a local facility when convenient. Thank you for being a Autopilot America customer. Have a great day!`;

    return {
      email: {
        to: obligation.email,
        subject: emailSubject,
        html: emailHtml,
        text: emailText
      },
      sms: {
        to: obligation.phone,
        message: smsMessage
      },
      voice: {
        to: obligation.phone,
        message: voiceMessage
      }
    };
  }

  // Process pending reminders using new database structure
  async processPendingReminders(): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: string[];
  }> {
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    try {
      // Check all standard reminder intervals
      // Updated schedule: Stop at 30 days (when we process renewals)
      const reminderDays = [60, 45, 30, 21, 14];
      
      for (const days of reminderDays) {
        console.log(`Checking for reminders ${days} days ahead...`);
        
        // Use the database function to get obligations needing reminders
        const { data: obligations, error } = await supabaseAdmin.rpc(
          'get_obligations_needing_reminders', 
          { days_ahead: days }
        );
        
        if (error) {
          console.error(`Error getting ${days}-day reminders:`, error);
          results.errors.push(`Error getting ${days}-day reminders: ${error.message}`);
          continue;
        }
        
        if (!obligations || obligations.length === 0) {
          console.log(`No ${days}-day reminders needed`);
          continue;
        }
        
        console.log(`Found ${obligations.length} obligations needing ${days}-day reminders`);
        
        for (const obligation of obligations) {
          results.processed++;

          try {
            const preferences = obligation.notification_preferences || {};
            const reminderDaysAllowed = preferences.reminder_days || [60, 45, 30, 21, 14];

            // Check if this user wants reminders at this interval
            if (!reminderDaysAllowed.includes(days)) {
              console.log(`User ${obligation.email} doesn't want ${days}-day reminders`);
              continue;
            }

            // Fetch user protection status, permit zone info, and profile confirmation from user_profiles
            let hasProtection = false;
            let hasPermitZone = false;
            let profileConfirmedForYear: number | null = null;

            try {
              const { data: userProfile } = await supabaseAdmin
                .from('user_profiles')
                .select('has_protection, has_permit_zone, profile_confirmed_for_year, city_sticker_expiry, license_plate_expiry')
                .eq('user_id', obligation.user_id)
                .single();

              if (userProfile) {
                hasProtection = userProfile.has_protection || false;
                hasPermitZone = userProfile.has_permit_zone || false;
                profileConfirmedForYear = userProfile.profile_confirmed_for_year || null;

                // Check if profile is confirmed for the current renewal year
                // Get renewal year from the nearest expiry date
                const stickerExpiry = userProfile.city_sticker_expiry ? new Date(userProfile.city_sticker_expiry) : null;
                const plateExpiry = userProfile.license_plate_expiry ? new Date(userProfile.license_plate_expiry) : null;
                const nextExpiry = stickerExpiry && plateExpiry
                  ? (stickerExpiry < plateExpiry ? stickerExpiry : plateExpiry)
                  : stickerExpiry || plateExpiry;
                const currentRenewalYear = nextExpiry ? nextExpiry.getFullYear() : new Date().getFullYear();

                // If Protection user has confirmed their profile for this renewal year,
                // skip "confirm your info" reminders (but still send post-purchase notifications)
                if (hasProtection && profileConfirmedForYear === currentRenewalYear && days > 14) {
                  console.log(`Skipping ${days}-day reminder for ${obligation.email} - profile already confirmed for ${currentRenewalYear}`);
                  continue;
                }
              }
            } catch (profileError) {
              console.error(`Error fetching user profile for ${obligation.email}:`, profileError);
              // Continue with defaults (false, false)
            }

            // Generate notification content with protection status
            const content = this.generateNotificationContent(
              obligation,
              obligation.type,
              days,
              hasProtection,
              hasPermitZone
            );
            
            let notificationSent = false;
            
            // Send email if enabled
            if (preferences.email && obligation.email) {
              const emailSent = await this.notificationService.sendEmail(content.email);
              if (emailSent) {
                await this.logReminder(obligation.obligation_id, obligation.user_id, 'email', days);
                notificationSent = true;
              }
            }
            
            // Send SMS if enabled
            if (preferences.sms && obligation.phone) {
              const smsSent = await this.notificationService.sendSMS(content.sms);
              if (smsSent) {
                await this.logReminder(obligation.obligation_id, obligation.user_id, 'sms', days);
                notificationSent = true;
              }
            }
            
            // Send voice call if enabled (for urgent reminders only)
            if (preferences.voice && obligation.phone && days <= 3) {
              const voiceSent = await this.notificationService.sendVoiceCall(content.voice);
              if (voiceSent) {
                await this.logReminder(obligation.obligation_id, obligation.user_id, 'voice', days);
                notificationSent = true;
              }
            }
            
            // ESCALATION: For critical deadlines (due today or tomorrow)
            if (days <= 1) {
              // Send emergency SMS if not normally enabled
              if (obligation.phone && !preferences.sms) {
                console.log(`🚨 ESCALATION: Sending emergency SMS for ${obligation.type} due in ${days} days`);
                const emergencySmsSent = await this.notificationService.sendSMS(content.sms);
                if (emergencySmsSent) {
                  await this.logReminder(obligation.obligation_id, obligation.user_id, 'sms', days, 'escalation');
                  notificationSent = true;
                }
              }
              
              // Send emergency email if not normally enabled
              if (obligation.email && !preferences.email) {
                console.log(`🚨 ESCALATION: Sending emergency email for ${obligation.type} due in ${days} days`);
                const emergencyEmailSent = await this.notificationService.sendEmail(content.email);
                if (emergencyEmailSent) {
                  await this.logReminder(obligation.obligation_id, obligation.user_id, 'email', days, 'escalation');
                  notificationSent = true;
                }
              }
            }
            
            if (notificationSent) {
              results.successful++;
              console.log(`✅ Sent ${days}-day reminder for ${obligation.type} to ${obligation.email}`);
            } else {
              results.failed++;
              results.errors.push(`Failed to send ${days}-day reminder for ${obligation.type} to ${obligation.email}`);
            }
            
          } catch (error) {
            results.failed++;
            results.errors.push(`Error processing ${days}-day reminder for obligation ${obligation.obligation_id}: ${error}`);
            console.error(`Error processing reminder:`, error);
          }
        }
      }
    } catch (error) {
      results.errors.push(`Error in processPendingReminders: ${error}`);
      console.error('Error in processPendingReminders:', error);
    }

    return results;
  }
  
  // Helper function to log sent reminders
  private async logReminder(obligationId: string, userId: string, method: string, daysUntilDue: number, status: string = 'sent') {
    try {
      const { error } = await supabaseAdmin.rpc('log_reminder', {
        p_obligation_id: obligationId,
        p_user_id: userId,
        p_method: method,
        p_days_until_due: daysUntilDue,
        p_status: status
      });
      
      if (error) {
        console.error('Error logging reminder:', error);
      }
    } catch (error) {
      console.error('Error logging reminder:', error);
    }
  }
}

// Export a singleton instance
export const notificationScheduler = new NotificationScheduler();
export const notificationService = new NotificationService();