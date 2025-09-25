import { supabaseAdmin } from './supabase';
import { sendClickSendSMS, sendClickSendVoiceCall } from './sms-service';

export class NotificationScheduler {
  // Process reminders using the USERS table where data actually is
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
      const today = new Date();
      console.log(`🔔 Checking for reminders on ${today.toISOString()}`);
      
      // Get ALL users with renewal dates
      const { data: users, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .not('city_sticker_expiry', 'is', null);
        
      if (error) {
        console.error('Error fetching users:', error);
        return results;
      }
      
      console.log(`Found ${users?.length || 0} users with renewal dates`);
      
      for (const user of users || []) {
        // Check each renewal type
        const renewals = [
          { date: user.city_sticker_expiry, type: 'City Sticker' },
          { date: user.license_plate_expiry, type: 'License Plate' },
          { date: user.emissions_date, type: 'Emissions Test' }
        ];
        
        for (const renewal of renewals) {
          if (!renewal.date) continue;
          
          const dueDate = new Date(renewal.date);
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          // Check if this matches a reminder day for the user
          const reminderDays = user.notification_preferences?.reminder_days || [30, 7, 1];
          
          if (reminderDays.includes(daysUntil)) {
            results.processed++;
            console.log(`📅 User ${user.email} needs ${daysUntil}-day reminder for ${renewal.type}`);
            
            // Send notifications based on preferences
            try {
              const prefs = user.notification_preferences || {};
              
              // Send SMS if enabled
              if (prefs.sms && user.phone) {
                const message = `TicketlessAmerica: Your ${renewal.type} expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dueDate.toLocaleDateString()}. Reply STOP to opt out.`;
                
                console.log(`📱 Sending SMS to ${user.phone}: ${message}`);
                const smsResult = await sendClickSendSMS(user.phone, message);
                
                if (smsResult.success) {
                  console.log('✅ SMS sent successfully');
                  results.successful++;
                } else {
                  console.error('❌ SMS failed:', smsResult.error);
                  results.failed++;
                }
              }
              
              // Send voice call if enabled
              if (prefs.voice && user.phone) {
                const voiceMessage = `Hello from Ticketless America. This is a reminder that your ${renewal.type} expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dueDate.toLocaleDateString()}. Please renew promptly to avoid penalties.`;
                
                console.log(`📞 Sending voice call to ${user.phone}: ${voiceMessage.substring(0, 50)}...`);
                const voiceResult = await sendClickSendVoiceCall(user.phone, voiceMessage);
                
                if (voiceResult.success) {
                  console.log('✅ Voice call sent successfully');
                  results.successful++;
                } else {
                  console.error('❌ Voice call failed:', voiceResult.error);
                  results.failed++;
                }
              }
              
              // Email is always sent
              if (user.email) {
                console.log(`📧 Email notifications not yet implemented for ${user.email}`);
              }
              
            } catch (error) {
              console.error(`Error sending notification to ${user.email}:`, error);
              results.failed++;
              results.errors.push(`Failed to notify ${user.email}: ${error}`);
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Fatal error in processPendingReminders:', error);
      results.errors.push(`Fatal error: ${error}`);
    }
    
    console.log(`📊 Notification Results: ${results.successful} sent, ${results.failed} failed, ${results.processed} processed`);
    return results;
  }
}

export const notificationScheduler = new NotificationScheduler();