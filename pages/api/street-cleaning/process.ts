import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase, supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';
import { sendClickSendVoiceCall } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

interface ProcessResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  timestamp: string;
  type: string;
}

/**
 * Get Chicago time for scheduling.
 * Uses Intl.DateTimeFormat to correctly extract Chicago hour and date
 * regardless of server timezone (Vercel runs in UTC).
 */
function getChicagoTime(): { hour: number; chicagoTime: string; chicagoDateISO: string } {
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

  // Get Chicago date as ISO string (YYYY-MM-DD)
  const chicagoYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(now);
  const chicagoMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: '2-digit' }).format(now);
  const chicagoDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: '2-digit' }).format(now);
  const chicagoDateISO = `${chicagoYear}-${chicagoMonth}-${chicagoDay}`;

  return { hour, chicagoTime, chicagoDateISO };
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
  const { hour, chicagoTime, chicagoDateISO } = getChicagoTime();

  // Enhanced logging to debug cron execution
  console.log('========================================');
  console.log('STREET CLEANING CRON EXECUTION');
  console.log('========================================');
  console.log('UTC Time:', now.toISOString());
  console.log('Chicago Time:', chicagoTime);
  console.log('Chicago Hour:', hour);
  console.log('Chicago Date:', chicagoDateISO);
  console.log('Request Method:', req.method);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('========================================');

  // Determine notification type based on Chicago time
  let notificationType = 'unknown';
  if (hour === 7) {
    notificationType = 'morning_reminder';
    console.log('Matched: morning_reminder (7am CDT)');
  } else if (hour === 15) {
    notificationType = 'follow_up';
    console.log('Matched: follow_up (3pm CDT)');
  } else if (hour === 19) {
    notificationType = 'evening_reminder';
    console.log('Matched: evening_reminder (7pm CDT)');
  } else {
    console.log(`Skipped: Current hour ${hour} doesn't match any notification schedule (7am, 3pm, 7pm CDT)`);
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
        chicagoDateISO,
        utcTime: now.toISOString()
      }
    } as any);
  }

  try {
    const results = await processStreetCleaningReminders(notificationType, chicagoDateISO);

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
    console.error('Error processing street cleaning notifications:', error);
    res.status(500).json({
      error: 'Failed to process street cleaning notifications'
    });
  }
}

async function processStreetCleaningReminders(type: string, chicagoDateISO: string) {
  // BUG FIX: Use Chicago date, not UTC date.
  // When this runs at 7pm CDT (midnight UTC), UTC date is already tomorrow.
  // chicagoDateISO is the correct "today" in Chicago timezone.
  const todayStr = chicagoDateISO; // e.g. "2026-04-01"

  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    // BUG FIX: Query ALL users with ward/section assigned, regardless of notify_sms.
    // The old code had .eq('notify_sms', true) which excluded 87% of users who only
    // have email enabled. The sendNotification function already checks each channel
    // individually (email, SMS, voice) so filtering here should be broad.
    //
    // For evening_reminder and follow_up, we still query all eligible users directly
    // instead of relying on database views that use UTC CURRENT_DATE (which is wrong
    // after 7pm CDT).
    const query = supabaseAdmin
      .from('user_profiles')
      .select('*')
      .not('home_address_ward', 'is', null)
      .not('home_address_section', 'is', null)
      .or(`snooze_until_date.is.null,snooze_until_date.lt.${todayStr}`);

    let { data: users, error: userError } = await query;

    if (userError) {
      errors.push(`Failed to fetch users: ${sanitizeErrorMessage(userError)}`);
      return { processed, successful, failed, errors };
    }

    // Add canary users - they get notifications every day regardless of address
    const { data: canaryUsers, error: canaryError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('is_canary', true);

    if (canaryUsers && !canaryError) {
      // Add canary users to the notification list, but avoid duplicates
      const existingUserIds = new Set((users || []).map(u => u.user_id));
      const newCanaryUsers = canaryUsers.filter(canary => !existingUserIds.has(canary.user_id));
      users = [...(users || []), ...newCanaryUsers];
      if (newCanaryUsers.length > 0) {
        console.log(`Added ${newCanaryUsers.length} canary users to notification list`);
      }
    }

    if (!users || users.length === 0) {
      console.log('No users found with ward/section for notification type:', type);
      return { processed, successful, failed, errors };
    }

    console.log(`Found ${users.length} user(s) to evaluate for ${type}`);

    // Process each user
    for (const user of users) {
      try {
        processed++;

        let cleaningDateStr: string; // YYYY-MM-DD format
        let daysUntil = 0;

        // Canary users always get notifications (simulate next weekday cleaning)
        if (user.is_canary) {
          // Parse Chicago date to get day of week
          const [y, m, d] = todayStr.split('-').map(Number);
          const chicagoToday = new Date(y, m - 1, d); // Local date object for day-of-week calc
          const dayOfWeek = chicagoToday.getDay(); // 0=Sunday, 6=Saturday
          let daysToAdd = 0;

          if (dayOfWeek === 0) daysToAdd = 1; // Sunday -> Monday
          else if (dayOfWeek === 6) daysToAdd = 2; // Saturday -> Monday

          const simDate = new Date(chicagoToday);
          simDate.setDate(simDate.getDate() + daysToAdd);

          if (type === 'morning_reminder') {
            daysUntil = daysToAdd;
          } else if (type === 'evening_reminder') {
            simDate.setDate(simDate.getDate() + 1);
            daysUntil = daysToAdd + 1;
          } else {
            daysUntil = daysToAdd;
          }

          cleaningDateStr = `${simDate.getFullYear()}-${String(simDate.getMonth() + 1).padStart(2, '0')}-${String(simDate.getDate()).padStart(2, '0')}`;
          console.log(`Canary ${user.email}: simulating cleaning ${cleaningDateStr} (${daysUntil}d) for ${type}`);
        } else {
          // Regular users: Get next cleaning date from schedule
          // For evening reminders (7pm), look for tomorrow or later
          // For morning reminders (7am), look for today or later
          let minDate = todayStr;
          if (type === 'evening_reminder') {
            // Calculate tomorrow's date string
            const [y, m, d] = todayStr.split('-').map(Number);
            const tomorrow = new Date(y, m - 1, d);
            tomorrow.setDate(tomorrow.getDate() + 1);
            minDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
          }

          // BUG FIX: Compare date strings (YYYY-MM-DD) not ISO datetimes.
          // The cleaning_date column stores date-only values like '2026-04-01'.
          const { data: schedule, error: scheduleError } = await supabaseAdmin
            .from('street_cleaning_schedule')
            .select('cleaning_date')
            .eq('ward', user.home_address_ward)
            .eq('section', user.home_address_section)
            .gte('cleaning_date', minDate)
            .order('cleaning_date', { ascending: true })
            .limit(1)
            .single();

          if (scheduleError || !schedule) {
            // No upcoming cleaning — skip silently (this is normal for most users on most days)
            continue;
          }

          cleaningDateStr = schedule.cleaning_date; // Already YYYY-MM-DD

          // Calculate daysUntil using date strings to avoid timezone math
          const [ty, tm, td] = todayStr.split('-').map(Number);
          const [cy, cm, cd] = cleaningDateStr.split('-').map(Number);
          const todayMs = new Date(ty, tm - 1, td).getTime();
          const cleaningMs = new Date(cy, cm - 1, cd).getTime();
          daysUntil = Math.round((cleaningMs - todayMs) / (1000 * 60 * 60 * 24));
        }

        // Check if we should send notification based on user preferences
        const shouldSend = user.is_canary || shouldSendNotification(user, type, daysUntil);

        if (!shouldSend) {
          continue;
        }

        // BUG FIX: Use supabaseAdmin for dedup check (bypasses RLS).
        // BUG FIX: Compare cleaning_date as date string, not ISO datetime.
        const { data: existingNotification } = await supabaseAdmin
          .from('user_notifications')
          .select('id')
          .eq('user_id', user.user_id)
          .eq('notification_type', 'street_cleaning')
          .eq('cleaning_date', cleaningDateStr)
          .contains('metadata', { type })
          .gte('sent_at', `${todayStr}T00:00:00`)
          .limit(1)
          .maybeSingle();

        if (existingNotification) {
          console.log(`Skipping duplicate for ${user.email} (${type}, cleaning ${cleaningDateStr})`);
          continue;
        }

        // Build a Date object for display formatting (use noon to avoid timezone shifts)
        const cleaningDateForDisplay = new Date(cleaningDateStr + 'T12:00:00');

        // Send notifications
        console.log(`Sending ${type} to ${user.email} for cleaning ${cleaningDateStr} (${daysUntil}d)`);
        const result = await sendNotification(user, type, cleaningDateForDisplay, daysUntil);

        if (result.sent) {
          successful++;
          // BUG FIX: Use supabaseAdmin for logging (bypasses RLS).
          // BUG FIX: Store cleaning_date as date string, not ISO datetime.
          await logNotification(user.user_id, type, cleaningDateStr, user.home_address_ward, user.home_address_section, daysUntil, result.channels);
        } else {
          failed++;
        }

      } catch (userError) {
        console.error(`Error processing user ${user.email}:`, userError);
        errors.push(`User ${user.email}: ${sanitizeErrorMessage(userError)}`);
        failed++;
      }
    }

  } catch (error) {
    console.error('Error in processStreetCleaningReminders:', error);
    errors.push(`General error: ${sanitizeErrorMessage(error)}`);
  }

  console.log(`\nResults: ${successful} sent, ${failed} failed, ${processed} evaluated`);
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
      // Send follow-up to users who have it enabled and cleaning was today
      return user.follow_up_sms && daysUntil === 0;

    default:
      return false;
  }
}

async function sendNotification(user: any, type: string, cleaningDate: Date, daysUntil: number): Promise<{ sent: boolean; channels: string[] }> {
  const channelsSent: string[] = [];

  // Validate date to prevent "Invalid Date" in messages
  if (!cleaningDate || isNaN(cleaningDate.getTime())) {
    console.error('Invalid cleaning date provided:', cleaningDate);
    return { sent: false, channels: [] };
  }

  const formattedDate = cleaningDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });

  let message = '';
  let subject = '';

  // Get user's full address for messaging
  const addressText = user.street_address || user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`;

  switch (type) {
    case 'morning_reminder':
      if (daysUntil === 0) {
        message = `Street cleaning TODAY at 9am at ${addressText}. Move your car NOW to avoid a ticket! - Autopilot America`;
        subject = 'Street Cleaning TODAY - Move Your Car!';
      } else if (daysUntil === 1) {
        message = `Street cleaning TOMORROW (${formattedDate}) at 9am at ${addressText}. Don't forget to move your car! - Autopilot America`;
        subject = 'Street Cleaning Tomorrow';
      } else {
        message = `Street cleaning in ${daysUntil} days (${formattedDate}) at 9am at ${addressText}. Remember to move your car! - Autopilot America`;
        subject = `Street Cleaning in ${daysUntil} Days`;
      }
      break;

    case 'evening_reminder':
      if (daysUntil === 1) {
        message = `Street cleaning TOMORROW at 9am at ${addressText}. Don't forget to move your car tonight! - Autopilot America`;
        subject = 'Street Cleaning Tomorrow Morning';
      } else {
        message = `Street cleaning in ${daysUntil} days (${formattedDate}) at 9am at ${addressText}. - Autopilot America`;
        subject = `Street Cleaning in ${daysUntil} Days`;
      }
      break;

    case 'follow_up':
      message = `Street cleaning completed in your area today. You can park normally now. Did you move your car and avoid a ticket? Reply and let us know! - Autopilot America`;
      subject = 'Street Cleaning Complete - Safe to Park';
      break;
  }

  try {
    // Send email if enabled (most users have email enabled)
    if (user.email && user.notify_email !== false) {
      console.log(`  Email -> ${user.email}`);
      await notificationService.sendEmail({
        to: user.email,
        subject: subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>${subject}</h2>
            <p>${message}</p>
            <p style="margin-top: 20px;">
              <strong>Your Address:</strong><br>
              ${user.street_address || user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`}
            </p>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">
              Manage your preferences at <a href="https://autopilotamerica.com/settings">autopilotamerica.com/settings</a>
            </p>
          </div>
        `,
        text: `${subject}\n\n${message}\n\nYour Address:\n${user.street_address || user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`}\n\nManage your preferences at https://autopilotamerica.com/settings`
      });
      channelsSent.push('email');
    }

    // Send SMS if user has SMS enabled and phone number
    const phoneNumber = user.phone_number || user.phone;
    if (phoneNumber && user.notify_sms !== false) {
      console.log(`  SMS -> ${phoneNumber}`);
      await notificationService.sendSMS({
        to: phoneNumber,
        message: message
      });
      channelsSent.push('sms');
    }

    // Send voice call if enabled (morning reminders only)
    const callPrefs = (user.call_alert_preferences as Record<string, { enabled: boolean; hours_before?: number }>) || {};
    const streetCleaningCallEnabled = callPrefs.street_cleaning ? callPrefs.street_cleaning.enabled !== false : true;
    if (user.phone_call_enabled && streetCleaningCallEnabled && phoneNumber && type === 'morning_reminder') {
      console.log(`  Voice -> ${phoneNumber}`);
      try {
        // Strip emojis for voice calls - they cause 500 errors in ClickSend
        const voiceMessage = message.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
        const voiceResult = await sendClickSendVoiceCall(phoneNumber, voiceMessage);
        if (voiceResult.success) {
          channelsSent.push('voice');
        } else {
          console.error(`  Voice call failed for ${phoneNumber}:`, voiceResult.error);
        }
      } catch (voiceError) {
        console.error(`  Voice call error for ${phoneNumber}:`, voiceError);
      }
    }

    // Send push notification if user has a push token
    if (user.push_token) {
      try {
        const { pushService } = await import('../../../lib/push-service');
        const pushSent = await pushService.sendToToken(user.push_token, {
          title: subject,
          body: message,
          data: { type: 'street_cleaning', notificationType: type },
          userId: user.user_id,
          category: 'street_cleaning'
        });
        if (pushSent) {
          console.log(`  Push -> ${user.push_token.substring(0, 20)}...`);
          channelsSent.push('push');
        }
      } catch (pushError) {
        console.error(`  Push failed for ${user.email}:`, pushError);
      }
    }

    if (channelsSent.length === 0) {
      console.log(`  No channels available for ${user.email} (email: ${user.notify_email}, sms: ${user.notify_sms}, phone: ${phoneNumber})`);
    }

    return { sent: channelsSent.length > 0, channels: channelsSent };
  } catch (error) {
    console.error(`Failed to send notification to ${user.email}:`, error);
    return { sent: false, channels: [] };
  }
}


async function logNotification(
  userId: string,
  type: string,
  cleaningDateStr: string,
  ward: string,
  section: string,
  daysUntil?: number,
  channelsSent?: string[]
) {
  try {
    // BUG FIX: Use supabaseAdmin to bypass RLS.
    // BUG FIX: Store cleaning_date as date string (matches column type).
    await supabaseAdmin
      .from('user_notifications')
      .insert({
        user_id: userId,
        notification_type: 'street_cleaning',
        sent_at: new Date().toISOString(),
        status: 'sent',
        ward: ward,
        section: section,
        cleaning_date: cleaningDateStr,
        days_before: daysUntil ?? null,
        channels: channelsSent || ['email'],
        metadata: { type }
      } as any);
  } catch (error) {
    console.error('Failed to log notification:', error);
  }
}
