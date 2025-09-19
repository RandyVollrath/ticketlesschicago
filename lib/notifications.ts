import { supabaseAdmin } from './supabase';
import { Resend } from 'resend';
import { sendClickSendSMS } from './sms-service';

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
}

export interface SMSNotification {
  to: string;
  message: string;
}

export interface VoiceNotification {
  to: string;
  message: string;
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
    try {
      if (!this.resend || !process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'your-resend-api-key-here' || process.env.RESEND_API_KEY.length < 10) {
        console.log('📧 MOCK: No valid Resend API key, would send email:', {
          to: notification.to,
          subject: notification.subject,
          preview: notification.text.substring(0, 100) + '...'
        });
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
          'List-Unsubscribe': '<https://ticketlesschicago.com/unsubscribe>',
          'X-Entity-Ref-ID': crypto.randomUUID(),
        },
        reply_to: 'support@ticketlesschicago.com'
      });

      if (error) {
        console.error('Resend error details:', error);
        console.error('From address used:', fromAddress);
        return false;
      }

      console.log('✅ Email sent successfully:', data);
      return true;
    } catch (error) {
      console.error('Email sending failed:', error);
      return false;
    }
  }

  // SMS service using ClickSend
  async sendSMS(notification: SMSNotification): Promise<boolean> {
    try {
      console.log('📱 Sending SMS via ClickSend:', {
        to: notification.to,
        length: notification.message.length + ' chars'
      });

      // Use direct API implementation instead of broken npm package
      const result = await sendClickSendSMS(notification.to, notification.message);
      
      if (result) {
        console.log('✅ SMS sent successfully to', notification.to);
      }
      
      return result;
    } catch (error) {
      console.error('SMS sending failed:', error);
      return false;
    }
  }

  // Voice service using ClickSend
  async sendVoiceCall(notification: VoiceNotification): Promise<boolean> {
    const username = process.env.CLICKSEND_USERNAME;
    const apiKey = process.env.CLICKSEND_API_KEY;
    
    if (!username || !apiKey) {
      console.log('📞 MOCK: No ClickSend credentials for voice call');
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
              custom_string: 'ticketless-chicago'
            }
          ]
        })
      });

      const result = await response.json();
      
      if (response.ok && result.data?.messages?.[0]?.status === 'SUCCESS') {
        console.log('✅ Voice call initiated successfully to', notification.to);
        return true;
      } else {
        console.error('❌ ClickSend Voice failed:', result);
        return false;
      }
    } catch (error) {
      console.error('❌ Error making voice call via ClickSend:', error);
      return false;
    }
  }
}

export class NotificationScheduler {
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  // Get all vehicle reminders that might need notifications
  async getPendingReminders(): Promise<VehicleReminder[]> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from('vehicle_reminders')
      .select('*')
      .eq('completed', false);

    if (error) {
      console.error('Error fetching pending reminders:', error);
      return [];
    }

    return data || [];
  }

  // Calculate days until due date
  getDaysUntilDue(dueDate: string): number {
    const today = new Date();
    const due = new Date(dueDate);
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
    reminder: VehicleReminder, 
    renewalType: 'city_sticker' | 'license_plate' | 'emissions',
    daysUntilDue: number
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
        dueDate = reminder.city_sticker_expiry;
        fineAmount = '$200+ in fines';
        renewalUrl = 'https://www.chicityclerk.com/citysticker';
        tipText = '💡 Renew online or visit any Currency Exchange location. Bring your registration and proof of insurance.';
        break;
      case 'license_plate':
        renewalName = 'License Plate Registration';
        dueDate = reminder.license_plate_expiry;
        fineAmount = '$90+ in fines';
        renewalUrl = 'https://www.ilsos.gov/departments/vehicles/registration/home.html';
        tipText = '💡 Renew at cyberdriveillinois.com or visit your local Secretary of State facility.';
        break;
      case 'emissions':
        renewalName = 'Emissions Test';
        dueDate = reminder.emissions_due_date || '';
        fineAmount = '$50-300 in fines';
        renewalUrl = 'https://www2.illinoisepa.gov/topics/air-quality/mobile-sources/vehicle-emissions/Pages/default.aspx';
        tipText = '💡 Find testing locations at illinoisveip.com. Bring your registration and $20 cash.';
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
      : `${renewalName} coming up in ${daysUntilDue} days`;
    
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: #2563eb; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Ticketless Chicago</h1>
          <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">Your Vehicle Compliance Partner</p>
        </div>
        
        <!-- Main Content -->
        <div style="padding: 32px 24px; background: #ffffff;">
          <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <h2 style="margin: 0 0 12px; color: #1e40af; font-size: 20px;">📋 ${renewalName} Reminder</h2>
            <div style="color: #1e40af; font-size: 16px; line-height: 1.5;">
              <strong>Vehicle:</strong> ${reminder.license_plate}<br>
              <strong>Due Date:</strong> ${dueDateFormatted}<br>
              <strong>Days Remaining:</strong> ${daysUntilDue === 0 ? 'Due today' : daysUntilDue === 1 ? '1 day' : `${daysUntilDue} days`}
            </div>
          </div>
          
          ${daysUntilDue <= 1 ? `
            <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <h3 style="color: #92400e; margin: 0 0 8px; font-size: 18px;">⏰ Renewal Due ${timeText === 'TODAY' ? 'Today' : 'Tomorrow'}</h3>
              <p style="color: #92400e; margin: 0;">We recommend renewing today to stay compliant and avoid any potential issues.</p>
            </div>
          ` : ''}
          
          <!-- Action Steps -->
          <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">How to Renew:</h3>
            ${tipText.replace('💡 ', '<div style="color: #0369a1; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">')}
            
            <div style="text-align: center; margin: 20px 0;">
              <a href="${renewalUrl}" 
                 style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px; margin-right: 12px;">
                Renew Online
              </a>
              <a href="https://ticketlesschicago.com/dashboard" 
                 style="background: #374151; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                View Dashboard
              </a>
            </div>
          </div>
          
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
            <p style="margin: 0;">Questions? We're here to help at support@ticketlesschicago.com</p>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
          <div style="margin-bottom: 12px;">
            <strong style="color: #374151;">Ticketless Chicago</strong><br>
            Your trusted vehicle compliance partner
          </div>
          <div>
            <a href="https://ticketlesschicago.com/dashboard" style="color: #6b7280; margin: 0 8px;">Dashboard</a> |
            <a href="https://ticketlesschicago.com/support" style="color: #6b7280; margin: 0 8px;">Support</a> |
            <a href="https://ticketlesschicago.com/unsubscribe?id=${reminder.id}" style="color: #6b7280; margin: 0 8px;">Unsubscribe</a>
          </div>
        </div>
      </div>
    `;

    const emailText = `
Hello,

This is a friendly reminder from Ticketless Chicago about your upcoming ${renewalName}.

Vehicle: ${reminder.license_plate}
Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntilDue === 0 ? 'Due today' : daysUntilDue === 1 ? '1 day' : `${daysUntilDue} days`}

${daysUntilDue <= 1 ? 'We recommend renewing today to stay compliant.' : 'You have time to renew, but we wanted to give you a heads up.'}

Renew online: ${renewalUrl}
View your dashboard: https://ticketlesschicago.com/dashboard

Best regards,
Ticketless Chicago Team

Questions? Reply to support@ticketlesschicago.com
    `;

    // SMS content (helpful, under 160 chars)
    const shortUrl = 'ticketlesschicago.com';
    const smsMessage = daysUntilDue === 0
      ? `Ticketless: ${renewalName} due today for ${reminder.license_plate}. Renew: ${shortUrl}`
      : daysUntilDue === 1
      ? `Ticketless: ${renewalName} due tomorrow for ${reminder.license_plate}. Renew: ${shortUrl}`
      : `Ticketless reminder: ${renewalName} due in ${daysUntilDue} days for ${reminder.license_plate}. Details: ${shortUrl}`;

    // Voice content (friendly and informative)
    const plateSpoken = reminder.license_plate.split('').join(' '); // Spell out clearly: "A B C 1 2 3"
    const voiceMessage = daysUntilDue <= 1
      ? `Hello, this is Ticketless Chicago calling with a friendly reminder. Your ${renewalName} is due ${timeText === 'TODAY' ? 'today' : 'tomorrow'} for vehicle ${plateSpoken}. We recommend renewing as soon as possible to stay compliant. You can renew online or visit a local facility. Thank you for being a Ticketless Chicago customer. Have a great day!`
      : `Hello, this is Ticketless Chicago calling. Your ${renewalName} is coming up in ${daysUntilDue} days for vehicle ${plateSpoken}. This is just a friendly reminder to help you stay on top of your renewals. You can renew online or visit a local facility when convenient. Thank you for being a Ticketless Chicago customer. Have a great day!`;

    return {
      email: {
        to: reminder.email,
        subject: emailSubject,
        html: emailHtml,
        text: emailText
      },
      sms: {
        to: reminder.phone,
        message: smsMessage
      },
      voice: {
        to: reminder.phone,
        message: voiceMessage
      }
    };
  }

  // Process pending reminders
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
      const pendingReminders = await this.getPendingReminders();
      
      for (const reminder of pendingReminders) {
        results.processed++;
        
        try {
          const preferences = reminder.notification_preferences;
          
          // Check each renewal type
          const renewals = [
            { type: 'city_sticker' as const, dueDate: reminder.city_sticker_expiry },
            { type: 'license_plate' as const, dueDate: reminder.license_plate_expiry },
            { type: 'emissions' as const, dueDate: reminder.emissions_due_date }
          ].filter(r => r.dueDate); // Only check renewals with due dates

          for (const renewal of renewals) {
            const daysUntilDue = this.getDaysUntilDue(renewal.dueDate);
            
            // Enhanced reminder schedule: user preferences + critical safety net
            const standardReminders = preferences.reminder_days || [30, 14, 7, 3, 1];
            const criticalSafetyNet = [1, 0]; // Always remind day before and day of
            const allReminderDays = [...new Set([...standardReminders, ...criticalSafetyNet])];
            
            // Check if we should send a reminder for this timing
            if (allReminderDays.includes(daysUntilDue) || daysUntilDue <= 0) {
              // Check if we've already sent this specific reminder TODAY
              const today = new Date().toISOString().split('T')[0];
              const reminderKey = `${renewal.type}_${daysUntilDue}d_${today}`;
              const sentReminders = reminder.sent_reminders || [];
              
              if (sentReminders.some(r => r.startsWith(`${renewal.type}_${daysUntilDue}d_${today}`))) {
                console.log(`Already sent ${reminderKey} reminder today for ${reminder.license_plate}`);
                continue;
              }
              
              const content = this.generateNotificationContent(reminder, renewal.type, daysUntilDue);
              
              let notificationSent = false;
              
              // Send email if enabled
              if (preferences.email) {
                const emailSent = await this.notificationService.sendEmail(content.email);
                notificationSent = notificationSent || emailSent;
              }
              
              // Send SMS if enabled
              if (preferences.sms && reminder.phone) {
                const smsSent = await this.notificationService.sendSMS(content.sms);
                notificationSent = notificationSent || smsSent;
              }
              
              // Send voice call if enabled (escalated approach for urgent deadlines)
              if (preferences.voice && reminder.phone) {
                // Voice calls for: same day, next day, and 3 days (urgent only)
                if (daysUntilDue <= 3) {
                  const voiceSent = await this.notificationService.sendVoiceCall(content.voice);
                  notificationSent = notificationSent || voiceSent;
                }
              }
              
              // ESCALATION: For critical deadlines (due tomorrow or today)
              if (daysUntilDue <= 1) {
                // Send both email AND SMS regardless of normal preferences
                // This ensures critical alerts always get through
                if (reminder.phone && !preferences.sms) {
                  console.log(`🚨 ESCALATION: Sending emergency SMS for ${reminderKey}`);
                  const emergencySmsSent = await this.notificationService.sendSMS(content.sms);
                  notificationSent = notificationSent || emergencySmsSent;
                }
                
                // Always send email for critical deadlines
                if (!preferences.email) {
                  console.log(`🚨 ESCALATION: Sending emergency email for ${reminderKey}`);
                  const emergencyEmailSent = await this.notificationService.sendEmail(content.email);
                  notificationSent = notificationSent || emergencyEmailSent;
                }
              }
              
              if (notificationSent) {
                // Track this specific reminder as sent
                const updatedSentReminders = [...sentReminders, reminderKey];
                if (supabaseAdmin) {
                  await supabaseAdmin
                    .from('vehicle_reminders')
                    .update({ 
                      sent_reminders: updatedSentReminders,
                      reminder_sent_at: new Date().toISOString() 
                    })
                    .eq('id', reminder.id);
                }
                
                results.successful++;
              } else {
                results.failed++;
                results.errors.push(`Failed to send ${reminderKey} reminder for ${reminder.license_plate}`);
              }
            }
          }
        } catch (error) {
          results.failed++;
          results.errors.push(`Error processing reminder ${reminder.id}: ${error}`);
        }
      }
    } catch (error) {
      results.errors.push(`Error fetching pending reminders: ${error}`);
    }

    return results;
  }
}

// Export a singleton instance
export const notificationScheduler = new NotificationScheduler();
export const notificationService = new NotificationService();