import { supabaseAdmin } from './supabase';
import { Resend } from 'resend';

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
    if (!this.clicksendConfig) return null;
    
    try {
      const ClickSend = await import('clicksend');
      const client = new ClickSend.default.ApiClient();
      client.authentications.BasicAuth.username = this.clicksendConfig.authentications.BasicAuth.username;
      client.authentications.BasicAuth.password = this.clicksendConfig.authentications.BasicAuth.password;
      return { client, ClickSend: ClickSend.default };
    } catch (error) {
      console.error('Failed to load ClickSend:', error);
      return null;
    }
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

      console.log('📧 Sending email via Resend:', {
        to: notification.to,
        subject: notification.subject
      });

      const { data, error } = await this.resend.emails.send({
        from: 'TicketLess Chicago <noreply@ticketlesschicago.com>',
        to: [notification.to],
        subject: notification.subject,
        html: notification.html,
        text: notification.text,
      });

      if (error) {
        console.error('Resend error:', error);
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
      const clicksend = await this.getClickSend();
      
      if (!clicksend) {
        console.log('📱 MOCK: No ClickSend credentials, would send SMS:', {
          to: notification.to,
          message: notification.message,
          length: notification.message.length + ' chars'
        });
        return true; // Mock success when no credentials
      }

      console.log('📱 Sending SMS via ClickSend:', {
        to: notification.to,
        length: notification.message.length + ' chars'
      });

      const smsApi = new clicksend.ClickSend.SMSApi(clicksend.client);
      const smsMessage = new clicksend.ClickSend.SmsMessage();
      smsMessage.source = 'nodejs';
      smsMessage.to = notification.to;
      smsMessage.body = notification.message;
      smsMessage.from = 'TicketLess';

      const smsCollection = new clicksend.ClickSend.SmsMessageCollection();
      smsCollection.messages = [smsMessage];

      const result = await smsApi.smsSendPost(smsCollection);
      
      if (result.response.statusCode === 200) {
        console.log('✅ SMS sent successfully:', result.body);
        return true;
      } else {
        console.error('ClickSend SMS error:', result.body);
        return false;
      }
    } catch (error) {
      console.error('SMS sending failed:', error);
      return false;
    }
  }

  // Voice service using ClickSend
  async sendVoiceCall(notification: VoiceNotification): Promise<boolean> {
    try {
      const clicksend = await this.getClickSend();
      
      if (!clicksend) {
        console.log('📞 MOCK: No ClickSend credentials, would make voice call:', {
          to: notification.to,
          message: notification.message
        });
        return true; // Mock success when no credentials
      }

      console.log('📞 Making voice call via ClickSend:', {
        to: notification.to
      });

      const voiceApi = new clicksend.ClickSend.VoiceApi(clicksend.client);
      const voiceMessage = new clicksend.ClickSend.VoiceMessage();
      voiceMessage.to = notification.to;
      voiceMessage.body = notification.message;
      voiceMessage.voice = 'female'; // ClickSend voice options: male, female
      voiceMessage.custom_string = 'ticketless-chicago';

      const voiceMessageCollection = new clicksend.ClickSend.VoiceMessageCollection();
      voiceMessageCollection.messages = [voiceMessage];

      const result = await voiceApi.voiceSendPost(voiceMessageCollection);
      
      if (result.response.statusCode === 200) {
        console.log('✅ Voice call initiated successfully:', result.body);
        return true;
      } else {
        console.error('ClickSend Voice error:', result.body);
        return false;
      }
    } catch (error) {
      console.error('Voice call failed:', error);
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
    
    switch (renewalType) {
      case 'city_sticker':
        renewalName = 'Chicago City Sticker';
        dueDate = reminder.city_sticker_expiry;
        fineAmount = '$200';
        break;
      case 'license_plate':
        renewalName = 'License Plate Registration';
        dueDate = reminder.license_plate_expiry;
        fineAmount = '$90+';
        break;
      case 'emissions':
        renewalName = 'Emissions Test';
        dueDate = reminder.emissions_due_date || '';
        fineAmount = '$50-300';
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

    // Email content (rich HTML)
    const emailSubject = `${urgencyEmoji} ${renewalName} Due ${timeText === 'TODAY' ? 'Today' : timeText === 'TOMORROW' ? 'Tomorrow' : `in ${daysUntilDue} days`}`;
    
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${urgency === 'high' ? '#ff4444' : urgency === 'medium' ? '#ff8800' : '#0066cc'}; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">${urgencyEmoji} Vehicle Renewal Reminder</h1>
        </div>
        
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333;">Your ${renewalName} is due ${timeText}!</h2>
          <p style="font-size: 16px; color: #666;">
            <strong>Vehicle:</strong> ${reminder.license_plate}<br>
            <strong>Due Date:</strong> ${dueDateFormatted}<br>
            <strong>Fine if missed:</strong> ${fineAmount}
          </p>
          
          ${urgency === 'high' ? `
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <strong>⚠️ URGENT:</strong> This renewal is due very soon! Don't risk a ticket.
            </div>
          ` : ''}
          
          <p>Don't let a missed renewal turn into an expensive ticket. Take action today!</p>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="https://ticketlesschicago-b1l70m41y-randyvollraths-projects.vercel.app/dashboard" 
               style="background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Dashboard
            </a>
          </div>
        </div>
        
        <div style="padding: 15px; background: #eee; text-align: center; color: #666; font-size: 12px;">
          TicketLess Chicago - Keeping Chicago drivers compliant<br>
          <a href="https://ticketlesschicago-b1l70m41y-randyvollraths-projects.vercel.app/unsubscribe?id=${reminder.id}" style="color: #666;">Unsubscribe</a> | <a href="https://ticketlesschicago-b1l70m41y-randyvollraths-projects.vercel.app/dashboard" style="color: #666;">Update Preferences</a>
        </div>
      </div>
    `;

    const emailText = `
${urgencyEmoji} Vehicle Renewal Reminder

Your ${renewalName} is due ${timeText}!

Vehicle: ${reminder.license_plate}
Due Date: ${dueDateFormatted}
Fine if missed: ${fineAmount}

${urgency === 'high' ? 'URGENT: This renewal is due very soon! Don\'t risk a ticket.' : ''}

Don't let a missed renewal turn into an expensive ticket. Take action today!

View your dashboard: https://ticketlesschicago-b1l70m41y-randyvollraths-projects.vercel.app/dashboard

TicketLess Chicago - Keeping Chicago drivers compliant
    `;

    // SMS content (concise, under 160 chars)
    const shortUrl = 'https://tinyurl.com/ticketless-chi'; // TODO: Create actual short URL
    const smsMessage = `${urgencyEmoji} ${renewalName} due ${timeText}! Vehicle ${reminder.license_plate}. Fine: ${fineAmount}. Renew now: ${shortUrl}`;

    // Voice content (clear speech with natural pauses)
    const plateSpoken = reminder.license_plate.replace(/(\d)/g, ' $1').replace(/([A-Z])/g, ' $1').trim();
    const voiceMessage = `This is Ticketless Chicago. Your ${renewalName} for vehicle, ${plateSpoken}, is due ${timeText}. The fine for missing this renewal is ${fineAmount}. Please visit your dashboard, or renew immediately, to avoid a ticket.`;

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
            
            // Check if we should send a reminder for this timing
            if (preferences.reminder_days.includes(daysUntilDue)) {
              // Check if we've already sent this specific reminder
              const reminderKey = `${renewal.type}_${daysUntilDue}d`;
              const sentReminders = reminder.sent_reminders || [];
              
              if (sentReminders.includes(reminderKey)) {
                console.log(`Already sent ${reminderKey} reminder for ${reminder.license_plate}`);
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
              
              // Send voice call if enabled (only for urgent reminders)
              if (preferences.voice && reminder.phone && daysUntilDue <= 1) {
                const voiceSent = await this.notificationService.sendVoiceCall(content.voice);
                notificationSent = notificationSent || voiceSent;
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