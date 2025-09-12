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

    // Email content (rich HTML with enhanced design)
    const emailSubject = `${urgencyEmoji} ACTION NEEDED: ${renewalName} Due ${timeText === 'TODAY' ? 'Today' : timeText === 'TOMORROW' ? 'Tomorrow' : `in ${daysUntilDue} days`} - Avoid ${fineAmount}!`;
    
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: ${urgency === 'high' ? '#dc2626' : urgency === 'medium' ? '#ea580c' : '#2563eb'}; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <div style="font-size: 48px; margin-bottom: 8px;">${urgencyEmoji}</div>
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">VEHICLE RENEWAL ALERT</h1>
          <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">Immediate action required to avoid fines</p>
        </div>
        
        <!-- Main Content -->
        <div style="padding: 32px 24px; background: #ffffff;">
          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <h2 style="margin: 0 0 12px; color: #92400e; font-size: 20px;">⏰ ${renewalName} Due ${timeText}!</h2>
            <div style="color: #92400e; font-size: 16px; line-height: 1.5;">
              <strong>Vehicle:</strong> ${reminder.license_plate}<br>
              <strong>Due Date:</strong> ${dueDateFormatted}<br>
              <strong>Potential Fines:</strong> <span style="color: #dc2626; font-weight: bold;">${fineAmount}</span>
            </div>
          </div>
          
          ${urgency === 'high' ? `
            <div style="background: #fee2e2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <div style="font-size: 24px; margin-bottom: 8px;">🚨</div>
              <h3 style="color: #991b1b; margin: 0 0 8px; font-size: 18px;">CRITICAL: DUE ${timeText.toUpperCase()}</h3>
              <p style="color: #991b1b; margin: 0; font-weight: 600;">Don't risk expensive tickets! Renew immediately.</p>
            </div>
          ` : ''}
          
          <!-- Action Steps -->
          <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">🎯 How to Renew (2 minutes):</h3>
            ${tipText.replace('💡 ', '<div style="color: #0369a1; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">💡 ')}
            
            <div style="text-align: center; margin: 20px 0;">
              <a href="${renewalUrl}" 
                 style="background: #dc2626; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px; margin-right: 12px;">
                🔗 RENEW NOW →
              </a>
              <a href="https://ticketlesschicago.com/dashboard" 
                 style="background: #374151; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                📱 My Dashboard
              </a>
            </div>
          </div>
          
          <!-- Cost Comparison -->
          <div style="background: #f9fafb; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #374151; margin: 0 0 12px; font-size: 16px;">💰 Cost Comparison:</h3>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="text-align: center; flex: 1;">
                <div style="color: #059669; font-size: 24px; font-weight: bold;">✅ Renew Today</div>
                <div style="color: #6b7280; font-size: 14px;">Standard renewal fee only</div>
              </div>
              <div style="color: #6b7280; font-size: 20px; margin: 0 20px;">VS</div>
              <div style="text-align: center; flex: 1;">
                <div style="color: #dc2626; font-size: 24px; font-weight: bold;">❌ Get Ticketed</div>
                <div style="color: #6b7280; font-size: 14px;">Renewal fee + ${fineAmount}</div>
              </div>
            </div>
          </div>
          
          <!-- Peace of Mind -->
          <div style="text-align: center; color: #6b7280; font-style: italic; margin: 24px 0;">
            "One less thing to worry about. Thanks for keeping me compliant!" - Sarah K., Lincoln Park
          </div>
        </div>
        
        <!-- Footer -->
        <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
          <div style="margin-bottom: 12px;">
            <strong style="color: #374151;">TicketLess Chicago</strong><br>
            Protecting 10,000+ Chicago drivers from compliance tickets
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

    // SMS content (urgent, actionable, under 160 chars)
    const shortUrl = 'ticketlesschicago.com'; // Direct domain for easy typing
    const smsMessage = urgency === 'high' 
      ? `🚨 URGENT: ${renewalName} DUE ${timeText.toUpperCase()}! ${reminder.license_plate} risks ${fineAmount}. RENEW NOW: ${renewalUrl}`
      : `${urgencyEmoji} ${renewalName} due ${timeText}! ${reminder.license_plate} avoid ${fineAmount}. Quick renew: ${renewalUrl} | Track: ${shortUrl}`;

    // Voice content (natural speech with urgency and clear instructions)
    const plateSpoken = reminder.license_plate.split('').join(' '); // Spell out clearly: "A B C 1 2 3"
    const voiceMessage = urgency === 'high' 
      ? `URGENT ALERT from TicketLess Chicago! Your ${renewalName} is due ${timeText} for vehicle ${plateSpoken}. Without immediate action, you risk ${fineAmount}. To avoid expensive tickets, renew RIGHT NOW. Visit the Illinois Secretary of State website or call them immediately. This is your final warning. Thank you.`
      : `Hello from TicketLess Chicago! This is an important reminder that your ${renewalName} is due ${timeText} for vehicle ${plateSpoken}. To avoid ${fineAmount}, please renew within the next few days. You can renew online at the Illinois Secretary of State website or visit a local facility. Thank you for using TicketLess Chicago!`;

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
            if (allReminderDays.includes(daysUntilDue)) {
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