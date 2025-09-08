import { Reminder, Obligation, User } from '../types';

interface EmailNotification {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

interface SMSNotification {
  to: string;
  message: string;
}

export class NotificationService {
  // Email notification service
  async sendEmail(notification: EmailNotification): Promise<boolean> {
    try {
      // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
      console.log('Sending email:', {
        to: notification.to,
        subject: notification.subject,
        body: notification.body
      });
      
      // Mock successful send
      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  // SMS notification service
  async sendSMS(notification: SMSNotification): Promise<boolean> {
    try {
      // TODO: Integrate with SMS service (Twilio, AWS SNS, etc.)
      console.log('Sending SMS:', {
        to: notification.to,
        message: notification.message
      });
      
      // Mock successful send
      return true;
    } catch (error) {
      console.error('Failed to send SMS:', error);
      return false;
    }
  }

  // Generate reminder content
  generateReminderContent(obligation: Obligation, user: User, daysUntilDue: number): {
    email: EmailNotification;
    sms: SMSNotification;
  } {
    const urgencyLevel = this.getUrgencyLevel(daysUntilDue);
    const subject = this.generateEmailSubject(obligation, daysUntilDue, urgencyLevel);
    const emailBody = this.generateEmailBody(obligation, user, daysUntilDue, urgencyLevel);
    const smsMessage = this.generateSMSMessage(obligation, daysUntilDue, urgencyLevel);

    return {
      email: {
        to: user.email,
        subject,
        body: emailBody.text,
        html: emailBody.html
      },
      sms: {
        to: user.phone || '',
        message: smsMessage
      }
    };
  }

  private getUrgencyLevel(daysUntilDue: number): 'high' | 'medium' | 'low' {
    if (daysUntilDue <= 1) return 'high';
    if (daysUntilDue <= 7) return 'medium';
    return 'low';
  }

  private generateEmailSubject(obligation: Obligation, daysUntilDue: number, urgency: string): string {
    const urgencyPrefix = urgency === 'high' ? '⚠️ URGENT: ' : urgency === 'medium' ? '⏰ ' : '';
    
    if (daysUntilDue === 0) {
      return `${urgencyPrefix}Your ${this.getObligationDisplayName(obligation.type)} is due TODAY`;
    } else if (daysUntilDue === 1) {
      return `${urgencyPrefix}Your ${this.getObligationDisplayName(obligation.type)} is due TOMORROW`;
    } else {
      return `${urgencyPrefix}Your ${this.getObligationDisplayName(obligation.type)} is due in ${daysUntilDue} days`;
    }
  }

  private generateEmailBody(obligation: Obligation, user: User, daysUntilDue: number, urgency: string): {
    text: string;
    html: string;
  } {
    const displayName = this.getObligationDisplayName(obligation.type);
    const dueDate = new Date(obligation.dueDate).toLocaleDateString();
    
    const text = `
Hi there,

This is a friendly reminder that your ${displayName} is due ${daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`} (${dueDate}).

${obligation.description}

${this.getObligationInstructions(obligation.type)}

${obligation.autoRegister ? 
  '✅ Auto-registration is ENABLED for this obligation. We\'ll handle the registration for you before the due date.' : 
  '⚠️ Auto-registration is DISABLED. You\'ll need to complete this registration yourself.'
}

Don\'t let this slip by and avoid unnecessary tickets or fines!

Best regards,
TicketLess Chicago Team
    `;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #1f2937;">Reminder: ${displayName}</h2>
  
  <div style="background-color: ${urgency === 'high' ? '#fee2e2' : urgency === 'medium' ? '#fef3c7' : '#f0f9ff'}; 
              border-left: 4px solid ${urgency === 'high' ? '#dc2626' : urgency === 'medium' ? '#d97706' : '#0284c7'}; 
              padding: 16px; margin: 16px 0;">
    <p style="margin: 0; font-weight: bold;">
      Due: ${dueDate} (${daysUntilDue === 0 ? 'TODAY' : daysUntilDue === 1 ? 'TOMORROW' : `${daysUntilDue} days`})
    </p>
  </div>

  <p>${obligation.description}</p>

  <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
    ${this.getObligationInstructionsHTML(obligation.type)}
  </div>

  <div style="margin: 24px 0; padding: 16px; border-radius: 8px; 
              background-color: ${obligation.autoRegister ? '#d1fae5' : '#fed7d7'};
              border: 1px solid ${obligation.autoRegister ? '#10b981' : '#f56565'};">
    ${obligation.autoRegister ? 
      '<strong>✅ Auto-registration is ENABLED</strong><br>We\'ll handle this registration for you before the due date.' : 
      '<strong>⚠️ Auto-registration is DISABLED</strong><br>You\'ll need to complete this registration yourself.'
    }
  </div>

  <p style="font-size: 14px; color: #6b7280;">
    Don't let this slip by and avoid unnecessary tickets or fines!<br>
    <br>
    Best regards,<br>
    TicketLess Chicago Team
  </p>
</div>
    `;

    return { text, html };
  }

  private generateSMSMessage(obligation: Obligation, daysUntilDue: number, urgency: string): string {
    const displayName = this.getObligationDisplayName(obligation.type);
    const urgencyEmoji = urgency === 'high' ? '⚠️' : urgency === 'medium' ? '⏰' : '📅';
    
    let timePhrase;
    if (daysUntilDue === 0) timePhrase = 'TODAY';
    else if (daysUntilDue === 1) timePhrase = 'TOMORROW';
    else timePhrase = `in ${daysUntilDue} days`;

    const autoRegStatus = obligation.autoRegister ? '✅ Auto-reg ON' : '⚠️ Manual required';

    return `${urgencyEmoji} ${displayName} due ${timePhrase}. ${autoRegStatus}. Don't forget! - TicketLess Chicago`;
  }

  private getObligationDisplayName(type: string): string {
    switch (type) {
      case 'city-sticker': return 'Chicago City Sticker';
      case 'emissions': return 'Illinois Emissions Test';
      case 'vehicle-registration': return 'Vehicle Registration';
      case 'parking-permits': return 'Parking Permits';
      default: return 'City Obligation';
    }
  }

  private getObligationInstructions(type: string): string {
    switch (type) {
      case 'city-sticker':
        return `To complete your city sticker registration:
1. Visit chicago.gov/vehiclestickers or go to a Currency Exchange
2. Have your vehicle registration and ID ready
3. Pay the annual fee (typically $96.50 for regular vehicles)
4. Display the sticker on your vehicle's windshield`;

      case 'emissions':
        return `To complete your emissions test:
1. Visit an approved testing station
2. Bring your vehicle registration and payment ($20)
3. Test typically takes 15-20 minutes
4. Keep your certificate for your records`;

      case 'vehicle-registration':
        return `To renew your vehicle registration:
1. Visit your local DMV or renew online
2. Bring current registration and insurance proof
3. Pay renewal fees
4. Update registration documents in your vehicle`;

      default:
        return 'Please check the specific requirements for this obligation.';
    }
  }

  private getObligationInstructionsHTML(type: string): string {
    const instructions = this.getObligationInstructions(type);
    return instructions.replace(/\n(\d+\.)/g, '<br><strong>$1</strong>').replace(/\n/g, '<br>');
  }
}

// Notification scheduling service
export class NotificationScheduler {
  private notificationService = new NotificationService();

  async scheduleRemindersForObligation(
    obligation: Obligation, 
    user: User, 
    reminderDays: number[] = [30, 7, 1]
  ): Promise<Reminder[]> {
    const reminders: Reminder[] = [];
    const dueDate = new Date(obligation.dueDate);

    for (const days of reminderDays) {
      const scheduledDate = new Date(dueDate);
      scheduledDate.setDate(scheduledDate.getDate() - days);

      // Don't schedule reminders in the past
      if (scheduledDate > new Date()) {
        // Create email reminder
        if (user.preferences.email) {
          reminders.push({
            id: `reminder_email_${obligation.id}_${days}d`,
            obligationId: obligation.id,
            type: 'email',
            scheduledFor: scheduledDate.toISOString(),
            sent: false
          });
        }

        // Create SMS reminder
        if (user.preferences.sms && user.phone) {
          reminders.push({
            id: `reminder_sms_${obligation.id}_${days}d`,
            obligationId: obligation.id,
            type: 'sms',
            scheduledFor: scheduledDate.toISOString(),
            sent: false
          });
        }
      }
    }

    return reminders;
  }

  async processPendingReminders(): Promise<void> {
    // This would typically be called by a cron job or scheduled task
    // TODO: Implement with actual database and job scheduler
    console.log('Processing pending reminders...');
  }
}

export const notificationService = new NotificationService();
export const notificationScheduler = new NotificationScheduler();