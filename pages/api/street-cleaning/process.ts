import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';

interface ProcessResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  timestamp: string;
  type: string;
}

// Get Chicago time for scheduling
function getChicagoTime(): { hour: number; chicagoTime: string } {
  const now = new Date();
  const chicagoTime = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const chicagoDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const hour = chicagoDate.getHours();
  
  return { hour, chicagoTime };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessResult | { error: string }>
) {
  // Allow both GET (for Vercel cron) and POST requests
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { hour, chicagoTime } = getChicagoTime();
  console.log(`🧹 Street cleaning notifications called at ${chicagoTime} (Hour: ${hour})`);

  // Determine notification type based on Chicago time
  let notificationType = 'unknown';
  if (hour === 7) {
    notificationType = 'morning_reminder';
  } else if (hour === 15) {
    notificationType = 'follow_up';
  } else if (hour === 19) {
    notificationType = 'evening_reminder';
  } else {
    return res.status(200).json({
      success: true,
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      timestamp: new Date().toISOString(),
      type: 'skipped - wrong hour'
    });
  }

  try {
    const results = await processStreetCleaningReminders(notificationType);
    
    res.status(200).json({
      success: true,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors,
      timestamp: new Date().toISOString(),
      type: notificationType
    });
    
  } catch (error) {
    console.error('❌ Error processing street cleaning notifications:', error);
    res.status(500).json({
      error: 'Failed to process street cleaning notifications'
    });
  }
}

async function processStreetCleaningReminders(type: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    // Get users ready for notifications using appropriate report view
    let query;
    switch (type) {
      case 'morning_reminder':
        query = supabase.from('report_zero_day').select('*');
        break;
      case 'evening_reminder':
        query = supabase.from('report_one_day').select('*'); // Could also check 2-day, 3-day based on preferences
        break;
      case 'follow_up':
        query = supabase.from('report_follow_up').select('*');
        break;
      default:
        // Fallback to manual query
        query = supabase
          .from('user_profiles')
          .select('*')
          .not('home_address_ward', 'is', null)
          .not('home_address_section', 'is', null)
          .or('snooze_until_date.is.null,snooze_until_date.lt.' + today.toISOString().split('T')[0]);
    }
    
    const { data: users, error: userError } = await query;

    if (userError) {
      errors.push(`Failed to fetch users: ${userError.message}`);
      return { processed, successful, failed, errors };
    }

    if (!users || users.length === 0) {
      console.log('No users with street cleaning addresses found');
      return { processed, successful, failed, errors };
    }

    // Process each user
    for (const user of users) {
      try {
        processed++;
        
        // Get next cleaning date for user's address
        const { data: schedule, error: scheduleError } = await supabase
          .from('street_cleaning_schedule')
          .select('cleaning_date')
          .eq('ward', user.home_address_ward)
          .eq('section', user.home_address_section)
          .gte('cleaning_date', today.toISOString())
          .order('cleaning_date', { ascending: true })
          .limit(1)
          .single();

        if (scheduleError || !schedule) {
          console.log(`No upcoming cleaning for ward ${user.home_address_ward}, section ${user.home_address_section}`);
          continue;
        }

        const cleaningDate = new Date(schedule.cleaning_date);
        const daysUntil = Math.floor((cleaningDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        // Check if we should send notification based on user preferences
        const shouldSend = shouldSendNotification(user, type, daysUntil);
        
        if (!shouldSend) {
          continue;
        }

        // Send notifications
        const notificationSent = await sendNotification(user, type, cleaningDate, daysUntil);
        
        if (notificationSent) {
          successful++;
          
          // Log the notification
          await logNotification(user.id, type, cleaningDate, user.home_address_ward, user.home_address_section);
        } else {
          failed++;
        }
        
      } catch (userError) {
        console.error(`Error processing user ${user.email}:`, userError);
        errors.push(`User ${user.email}: ${userError.message}`);
        failed++;
      }
    }
    
  } catch (error) {
    console.error('Error in processStreetCleaningReminders:', error);
    errors.push(`General error: ${error.message}`);
  }

  return { processed, successful, failed, errors };
}

function shouldSendNotification(user: any, type: string, daysUntil: number): boolean {
  const notifyDays = user.notify_days_array || [1];
  
  switch (type) {
    case 'morning_reminder':
      // Send on morning of cleaning if 0 is in notify_days_array
      return daysUntil === 0 && notifyDays.includes(0);
      
    case 'evening_reminder':
      // Send evening before if enabled and tomorrow is cleaning day
      if (user.notify_evening_before && daysUntil === 1) return true;
      // Or send for multi-day reminders
      return notifyDays.includes(daysUntil);
      
    case 'follow_up':
      // Send follow-up only to Pro users who have it enabled
      return user.sms_pro && user.follow_up_sms && daysUntil === 0;
      
    default:
      return false;
  }
}

async function sendNotification(user: any, type: string, cleaningDate: Date, daysUntil: number): Promise<boolean> {
  const formattedDate = cleaningDate.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  });
  
  let message = '';
  let subject = '';
  
  switch (type) {
    case 'morning_reminder':
      message = `🚗 Street cleaning TODAY in your area (Ward ${user.home_address_ward}, Section ${user.home_address_section})! Move your car by 7 AM to avoid a ticket.`;
      subject = '🚗 Street Cleaning TODAY - Move Your Car!';
      break;
      
    case 'evening_reminder':
      if (daysUntil === 1) {
        message = `🌙 Street cleaning TOMORROW morning in your area (Ward ${user.home_address_ward}, Section ${user.home_address_section}). Don't forget to move your car!`;
        subject = '🌙 Street Cleaning Tomorrow Morning';
      } else {
        message = `📅 Street cleaning in ${daysUntil} days (${formattedDate}) in Ward ${user.home_address_ward}, Section ${user.home_address_section}.`;
        subject = `📅 Street Cleaning in ${daysUntil} Days`;
      }
      break;
      
    case 'follow_up':
      message = `✅ Street cleaning completed in your area today. You can park normally now. Thank you for using Ticketless America!`;
      subject = '✅ Street Cleaning Complete';
      break;
  }
  
  try {
    // Send email if enabled
    if (user.email && user.notification_preferences?.email !== false) {
      await notificationService.sendEmail({
        to: user.email,
        subject: subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>${subject}</h2>
            <p>${message}</p>
            <p style="margin-top: 20px;">
              <strong>Your Address:</strong><br>
              ${user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`}
            </p>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">
              Manage your preferences at <a href="https://ticketlessamerica.com/settings">ticketlessamerica.com/settings</a>
            </p>
          </div>
        `,
        text: `${subject}\n\n${message}\n\nYour Address:\n${user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`}\n\nManage your preferences at https://ticketlessamerica.com/settings`
      });
    }
    
    // Send SMS if user is Pro and has SMS enabled
    if (user.sms_pro && user.phone && user.notification_preferences?.sms !== false) {
      await notificationService.sendSMS({
        to: user.phone,
        message: message
      });
    }
    
    // Send voice call if enabled (Pro feature)
    if (user.sms_pro && user.phone_call_enabled && user.phone && type === 'morning_reminder') {
      // Voice calls only for morning reminders
      await notificationService.sendVoiceCall({
        to: user.phone,
        message: message
      });
    }
    
    return true;
  } catch (error) {
    console.error(`Failed to send notification to ${user.email}:`, error);
    return false;
  }
}


async function logNotification(userId: string, type: string, cleaningDate: Date, ward: string, section: string) {
  try {
    await supabase
      .from('user_notifications')
      .insert({
        user_id: userId,
        notification_type: 'street_cleaning',
        scheduled_for: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        channels: ['email', 'sms'],
        status: 'sent',
        ward: ward,
        section: section,
        cleaning_date: cleaningDate.toISOString(),
        metadata: { type }
      });
  } catch (error) {
    console.error('Failed to log notification:', error);
  }
}