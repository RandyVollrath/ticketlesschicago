import { supabase } from './supabase';

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
  // Email service - CRITICAL: Currently mocked, needs real integration
  async sendEmail(notification: EmailNotification): Promise<boolean> {
    try {
      console.log('📧 MOCK: Email notification would be sent:', {
        to: notification.to,
        subject: notification.subject,
        preview: notification.text.substring(0, 100) + '...'
      });
      
      // TODO URGENT: Replace with real email service (SendGrid, AWS SES, etc.)
      // Example integration:
      // const sgMail = require('@sendgrid/mail');
      // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      // await sgMail.send({
      //   to: notification.to,
      //   from: 'noreply@ticketlesschicago.com',
      //   subject: notification.subject,
      //   html: notification.html,
      //   text: notification.text
      // });
      
      return true; // Mock success - WILL NOT SEND REAL EMAILS
    } catch (error) {
      console.error('Email sending failed:', error);
      return false;
    }
  }

  // SMS service - CRITICAL: Currently mocked, needs real integration  
  async sendSMS(notification: SMSNotification): Promise<boolean> {
    try {
      console.log('📱 MOCK: SMS notification would be sent:', {
        to: notification.to,
        message: notification.message,
        length: notification.message.length + ' chars'
      });
      
      // TODO URGENT: Replace with real SMS service (Twilio, AWS SNS, etc.)
      // Example integration:
      // const twilio = require('twilio');
      // const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
      // await client.messages.create({
      //   to: notification.to,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   body: notification.message
      // });
      
      return true; // Mock success - WILL NOT SEND REAL SMS
    } catch (error) {
      console.error('SMS sending failed:', error);
      return false;
    }
  }

  // Voice service - CRITICAL: Currently mocked, needs real integration
  async sendVoiceCall(notification: VoiceNotification): Promise<boolean> {
    try {
      console.log('📞 MOCK: Voice call would be made:', {
        to: notification.to,
        message: notification.message
      });
      
      // TODO URGENT: Replace with real voice service (Twilio Voice, etc.)
      // Example integration:
      // const twilio = require('twilio');
      // const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
      // await client.calls.create({
      //   to: notification.to,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   twiml: `<Response><Say voice="alice" rate="slow">${notification.message}</Say></Response>`
      // });
      
      return true; // Mock success - WILL NOT MAKE REAL CALLS
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
    const { data, error } = await supabase
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
                await supabase
                  .from('vehicle_reminders')
                  .update({ 
                    sent_reminders: updatedSentReminders,
                    reminder_sent_at: new Date().toISOString() 
                  })
                  .eq('id', reminder.id);
                
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