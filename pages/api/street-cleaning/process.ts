import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase, supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';
import { sendClickSendVoiceCall } from '../../../lib/sms-service';
import { createClient } from '@supabase/supabase-js';

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
  const chicagoTime = now.toLocaleString("en-US", { timeZone: "America/Chicago" });

  // CORRECT way to get Chicago hour: use Intl.DateTimeFormat
  // DO NOT use new Date(chicagoTimeString) - that interprets the string in server's timezone (UTC)!
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }).format(now)
  );

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

  const now = new Date();
  const { hour, chicagoTime } = getChicagoTime();

  // Enhanced logging to debug cron execution
  console.log('========================================');
  console.log('🧹 STREET CLEANING CRON EXECUTION');
  console.log('========================================');
  console.log('UTC Time:', now.toISOString());
  console.log('Chicago Time:', chicagoTime);
  console.log('Chicago Hour:', hour);
  console.log('Request Method:', req.method);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Is Vercel Cron?:', req.headers['user-agent']?.includes('vercel-cron') || req.headers['user-agent']?.includes('Vercel'));
  console.log('========================================');

  // Determine notification type based on Chicago time
  let notificationType = 'unknown';
  if (hour === 7) {
    notificationType = 'morning_reminder';
    console.log('✅ Matched: morning_reminder (7am)');
  } else if (hour === 15) {
    notificationType = 'follow_up';
    console.log('✅ Matched: follow_up (3pm)');
  } else if (hour === 19) {
    notificationType = 'evening_reminder';
    console.log('✅ Matched: evening_reminder (7pm)');
  } else {
    console.log(`⏭️  Skipped: Current hour ${hour} doesn't match any notification schedule (7am, 3pm, 7pm)`);
    return res.status(200).json({
      success: true,
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      timestamp: now.toISOString(),
      type: 'skipped - wrong hour',
      debug: {
        chicagoHour: hour,
        chicagoTime,
        utcTime: now.toISOString()
      }
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
        // For morning reminders at 7am, query all users with street cleaning enabled
        // We'll check their notify_days_array to see if they want 0, 1, 2, 3 day advance alerts
        query = supabase
          .from('user_profiles')
          .select('*')
          .not('home_address_ward', 'is', null)
          .not('home_address_section', 'is', null)
          .eq('notify_sms', true)
          .or('snooze_until_date.is.null,snooze_until_date.lt.' + today.toISOString().split('T')[0]);
        break;
      case 'evening_reminder':
        query = supabase.from('report_one_day').select('*');
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

    let { data: users, error: userError } = await query;

    if (userError) {
      errors.push(`Failed to fetch users: ${userError.message}`);
      return { processed, successful, failed, errors };
    }

    // Add canary users - they get notifications every day regardless of address
    const { data: canaryUsers, error: canaryError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('is_canary', true);

    if (canaryUsers && !canaryError) {
      // Add canary users to the notification list, but avoid duplicates
      const existingUserIds = new Set((users || []).map(u => u.user_id));
      const newCanaryUsers = canaryUsers.filter(canary => !existingUserIds.has(canary.user_id));
      users = [...(users || []), ...newCanaryUsers];
      console.log(`Added ${newCanaryUsers.length} new canary users to notification list (${canaryUsers.length - newCanaryUsers.length} already in list)`);
    }

    if (!users || users.length === 0) {
      console.log('⚠️  No users found in view for notification type:', type);
      return { processed, successful, failed, errors };
    }

    console.log(`📋 Found ${users.length} user(s) to process for ${type}`);

    // Process each user
    for (const user of users) {
      try {
        processed++;
        console.log(`\n👤 Processing user ${processed}/${users.length}: ${user.email}`);

        let cleaningDate;
        let daysUntil = 0;

        // Canary users always get notifications (simulate next weekday cleaning)
        if (user.is_canary) {
          // Find next Monday-Friday from today
          const dayOfWeek = today.getDay(); // 0=Sunday, 6=Saturday
          let daysToAdd = 0;

          if (dayOfWeek === 0) { // Sunday
            daysToAdd = 1; // Next Monday
          } else if (dayOfWeek === 6) { // Saturday
            daysToAdd = 2; // Next Monday
          } else {
            // Monday-Friday: use today for morning, tomorrow for evening
            daysToAdd = 0;
          }

          cleaningDate = new Date(today);
          cleaningDate.setDate(today.getDate() + daysToAdd);

          // Calculate daysUntil based on notification type
          if (type === 'morning_reminder') {
            daysUntil = daysToAdd; // 0 for weekday, 1-2 for weekend
          } else if (type === 'evening_reminder') {
            // Evening reminder is for next day, so add 1
            cleaningDate.setDate(cleaningDate.getDate() + 1);
            daysUntil = daysToAdd + 1;
          } else {
            daysUntil = daysToAdd;
          }

          console.log(`🐦 Canary user ${user.email}: simulating cleaning on ${cleaningDate.toDateString()} (${daysUntil} days) for ${type}`);
        } else {
          // Regular users: Get next cleaning date for user's address
          // First try local database, then MSC database
          let schedule = null;
          let scheduleError = null;

          // For evening reminders (7pm), we want tomorrow or later, not today
          // For morning reminders (7am), we want today or later
          const minDate = type === 'evening_reminder'
            ? new Date(today.getTime() + 24 * 60 * 60 * 1000) // Tomorrow
            : today; // Today

          // Try local database first
          const localResult = await supabase
            .from('street_cleaning_schedule')
            .select('cleaning_date')
            .eq('ward', user.home_address_ward)
            .eq('section', user.home_address_section)
            .gte('cleaning_date', minDate.toISOString())
            .order('cleaning_date', { ascending: true })
            .limit(1)
            .single();
          
          if (!localResult.error && localResult.data) {
            schedule = localResult.data;
          } else if (process.env.MSC_SUPABASE_URL && process.env.MSC_SUPABASE_SERVICE_ROLE_KEY) {
            // Try MyStreetCleaning database
            const mscSupabase = createClient(
              process.env.MSC_SUPABASE_URL,
              process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
            );
            
            const mscResult = await mscSupabase
              .from('street_cleaning_schedule')
              .select('cleaning_date')
              .eq('ward', user.home_address_ward)
              .eq('section', user.home_address_section)
              .gte('cleaning_date', minDate.toISOString())
              .order('cleaning_date', { ascending: true })
              .limit(1)
              .single();
            
            if (!mscResult.error && mscResult.data) {
              schedule = mscResult.data;
              console.log(`Using MSC database for ward ${user.home_address_ward}, section ${user.home_address_section}`);
            } else {
              scheduleError = mscResult.error || localResult.error;
            }
          } else {
            scheduleError = localResult.error;
          }

          if (scheduleError || !schedule) {
            console.log(`No upcoming cleaning for ward ${user.home_address_ward}, section ${user.home_address_section}`);
            continue;
          }

          cleaningDate = new Date(schedule.cleaning_date);
          daysUntil = Math.floor((cleaningDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        }

        // Check if we should send notification based on user preferences
        const shouldSend = user.is_canary || shouldSendNotification(user, type, daysUntil);
        
        if (!shouldSend) {
          continue;
        }

        // Send notifications
        const notificationSent = await sendNotification(user, type, cleaningDate, daysUntil);
        
        if (notificationSent) {
          successful++;
          
          // Log the notification
          await logNotification(user.user_id, type, cleaningDate, user.home_address_ward, user.home_address_section);
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
  const notifyDays = user.notify_days_array || [0]; // Default to day-of only

  switch (type) {
    case 'morning_reminder':
      // Send morning alerts for 0, 1, 2, 3 days ahead based on notify_days_array
      return notifyDays.includes(daysUntil);

    case 'evening_reminder':
      // Send evening before if enabled and tomorrow is cleaning day
      if (user.notify_evening_before && daysUntil === 1) return true;
      return false;

    case 'follow_up':
      // Send follow-up to users who have it enabled
      return user.follow_up_sms && daysUntil === 0;

    default:
      return false;
  }
}

async function sendNotification(user: any, type: string, cleaningDate: Date, daysUntil: number): Promise<boolean> {
  // Validate date to prevent "Invalid Date" in messages
  if (!cleaningDate || isNaN(cleaningDate.getTime())) {
    console.error('Invalid cleaning date provided:', cleaningDate);
    return false;
  }
  
  const formattedDate = cleaningDate.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  });
  
  let message = '';
  let subject = '';
  
  // Get user's full address for messaging
  const addressText = user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`;

  switch (type) {
    case 'morning_reminder':
      if (daysUntil === 0) {
        message = `🚗 Street cleaning TODAY at 9am at ${addressText}. Move your car NOW to avoid a ticket! - Autopilot America`;
        subject = '🚗 Street Cleaning TODAY - Move Your Car!';
      } else if (daysUntil === 1) {
        message = `🗓️ Street cleaning TOMORROW (${formattedDate}) at 9am at ${addressText}. Don't forget to move your car! - Autopilot America`;
        subject = '🗓️ Street Cleaning Tomorrow';
      } else {
        message = `📅 Street cleaning in ${daysUntil} days (${formattedDate}) at 9am at ${addressText}. Remember to move your car! - Autopilot America`;
        subject = `📅 Street Cleaning in ${daysUntil} Days`;
      }
      break;

    case 'evening_reminder':
      if (daysUntil === 1) {
        message = `🌙 Street cleaning TOMORROW at 9am at ${addressText}. Don't forget to move your car! - Autopilot America`;
        subject = '🌙 Street Cleaning Tomorrow Morning';
      } else {
        message = `📅 Street cleaning in ${daysUntil} days (${formattedDate}) at 9am at ${addressText}. - Autopilot America`;
        subject = `📅 Street Cleaning in ${daysUntil} Days`;
      }
      break;

    case 'follow_up':
      message = `✅ Street cleaning completed in your area today. You can park normally now. Did you move your car and avoid a ticket? Reply and let us know! - Autopilot America`;
      subject = '✅ Street Cleaning Complete';
      break;
  }
  
  try {
    // Send email if enabled
    if (user.email && user.notify_email !== false) {
      console.log(`📧 Sending email to ${user.email} for ${type}`);
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
      console.log(`✅ Email sent successfully to ${user.email}`);
    } else {
      console.log(`⏭️  Skipping email for ${user.email} (notify_email: ${user.notify_email})`);
    }

    // Send SMS if user has SMS enabled and phone number
    const phoneNumber = user.phone_number || user.phone;
    if (phoneNumber && user.notify_sms !== false) {
      console.log(`📱 Sending SMS to ${phoneNumber} for ${type}`);
      await notificationService.sendSMS({
        to: phoneNumber,
        message: message
      });
      console.log(`✅ SMS sent successfully to ${phoneNumber}`);
    } else {
      console.log(`⏭️  Skipping SMS for ${user.email} (notify_sms: ${user.notify_sms}, phone: ${phoneNumber})`);
    }

    // Send voice call if enabled (morning reminders only)
    if (user.phone_call_enabled && phoneNumber && type === 'morning_reminder') {
      console.log(`📞 Sending voice call to ${phoneNumber} for ${type}`);
      try {
        // Strip emojis for voice calls - they cause 500 errors in ClickSend
        const voiceMessage = message.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
        const voiceResult = await sendClickSendVoiceCall(phoneNumber, voiceMessage);
        if (voiceResult.success) {
          console.log(`✅ Voice call sent successfully to ${phoneNumber}`);
        } else {
          console.error(`❌ Voice call failed for ${phoneNumber}:`, voiceResult.error);
        }
      } catch (voiceError) {
        console.error(`❌ Voice call error for ${phoneNumber}:`, voiceError);
        // Don't fail the whole notification if just voice call fails
      }
    } else {
      console.log(`⏭️  Skipping voice call for ${user.email} (phone_call_enabled: ${user.phone_call_enabled}, phone: ${phoneNumber}, type: ${type})`);
    }

    return true;
  } catch (error) {
    console.error(`❌ Failed to send notification to ${user.email}:`, error);
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
        status: 'sent',
        ward: ward,
        section: section,
        cleaning_date: cleaningDate.toISOString(),
        metadata: { type, channels: ['email', 'sms'] }
      });
  } catch (error) {
    console.error('Failed to log notification:', error);
  }
}