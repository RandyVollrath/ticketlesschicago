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

  // CRITICAL: Verify cron authorization before processing notifications
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const secret = process.env.CRON_SECRET;
  // Guard: if CRON_SECRET is not set, reject all requests
  const isAuthorized = secret
    ? (authHeader === `Bearer ${secret}` || keyParam === secret)
    : false;

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
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

  // Determine notification type based on Chicago time.
  // Use ranges to handle CST/CDT transitions:
  //   CDT (UTC-5, Apr-Oct): 12 UTC=7am, 20 UTC=3pm, 0 UTC=7pm
  //   CST (UTC-6, Nov-Mar): 13 UTC=7am, 21 UTC=3pm, 1 UTC=7pm
  // The cron fires at 0,12,13,20,21 UTC, so we accept ranges.
  let notificationType = 'unknown';
  if (hour >= 6 && hour <= 8) {
    notificationType = 'morning_reminder';
    console.log(`Matched: morning_reminder (Chicago hour ${hour})`);
  } else if (hour >= 14 && hour <= 16) {
    notificationType = 'follow_up';
    console.log(`Matched: follow_up (Chicago hour ${hour})`);
  } else if (hour >= 18 && hour <= 20) {
    notificationType = 'evening_reminder';
    console.log(`Matched: evening_reminder (Chicago hour ${hour})`);
  } else {
    console.log(`Skipped: Chicago hour ${hour} doesn't match any notification window (6-8, 14-16, 18-20)`);
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

  // Convert Chicago midnight to UTC for dedup queries against the timestamptz sent_at column.
  // Chicago is UTC-5 (CDT, Mar-Nov) or UTC-6 (CST, Nov-Mar). We compute this dynamically
  // to avoid hardcoding a wrong offset across DST boundaries.
  // Approach: guess noon UTC, read the Chicago hour at that instant, derive the UTC offset.
  const chicagoMidnightUTC = (() => {
    const noonUTC = new Date(`${todayStr}T12:00:00Z`);
    const chicagoHourAtNoonUTC = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(noonUTC)
    );
    // offset = 12 - chicagoHourAtNoonUTC (e.g. CDT: 12-7=5, CST: 12-6=6)
    const utcOffsetHours = 12 - chicagoHourAtNoonUTC;
    // Chicago midnight in UTC = 00:00 Chicago + offset hours
    return new Date(`${todayStr}T${String(utcOffsetHours).padStart(2, '0')}:00:00Z`).toISOString();
  })();

  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];
  let totalUsersQueried = 0;

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

    totalUsersQueried = users.length;
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
            .maybeSingle();

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
          .gte('sent_at', chicagoMidnightUTC)
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
          await logNotification(user.user_id, type, cleaningDateStr, user.home_address_ward, user.home_address_section, daysUntil, result.channels, 'sent');

          // Also log any partial failures (some channels succeeded, some failed)
          if (result.failedChannels.length > 0) {
            await logNotification(user.user_id, type, cleaningDateStr, user.home_address_ward, user.home_address_section, daysUntil, result.failedChannels, 'partial_failure', result.errors.join('; '));
          }
        } else {
          failed++;
          // Log complete failure with error details
          await logNotification(user.user_id, type, cleaningDateStr, user.home_address_ward, user.home_address_section, daysUntil, result.failedChannels, 'failed', result.errors.join('; '));
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

  // Zero-notification admin alert: if we had users to process but sent nothing, something is wrong
  if (successful === 0 && totalUsersQueried > 3) {
    console.warn('ALERT: Zero notifications sent despite having users to process!');
    try {
      await notificationService.sendEmail({
        to: 'randy@autopilotamerica.com',
        subject: `Street Cleaning Alert: ZERO notifications sent (${type})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: red;">Zero Notification Alert</h2>
            <p>The street cleaning notification pipeline processed <strong>${totalUsersQueried} users</strong> but sent <strong>0 notifications</strong>.</p>
            <h3>Details</h3>
            <ul>
              <li><strong>Type:</strong> ${type}</li>
              <li><strong>Chicago Date:</strong> ${chicagoDateISO}</li>
              <li><strong>Users Evaluated:</strong> ${processed}</li>
              <li><strong>Failed:</strong> ${failed}</li>
              <li><strong>Errors:</strong> ${errors.length > 0 ? errors.join('<br>') : 'None captured'}</li>
            </ul>
            <p>This likely means:</p>
            <ol>
              <li>No users had cleaning dates matching today's schedule</li>
              <li>All notifications were deduplicated (already sent)</li>
              <li>A bug is silently filtering everyone out</li>
            </ol>
            <p>Check <a href="https://vercel.com/randy-vollrath/ticketless-chicago/logs">Vercel logs</a> for details.</p>
          </div>
        `,
        text: `ZERO NOTIFICATION ALERT\n\nType: ${type}\nChicago Date: ${chicagoDateISO}\nUsers: ${totalUsersQueried}\nProcessed: ${processed}\nFailed: ${failed}\nErrors: ${errors.join(', ') || 'None'}\n\nCheck Vercel logs for details.`
      });
    } catch (alertError) {
      console.error('Failed to send zero-notification admin alert:', alertError);
    }
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
      // Send follow-up to users who have it enabled and cleaning was today
      return user.follow_up_sms && daysUntil === 0;

    default:
      return false;
  }
}

async function sendNotification(user: any, type: string, cleaningDate: Date, daysUntil: number): Promise<{ sent: boolean; channels: string[]; failedChannels: string[]; errors: string[] }> {
  const channelsSent: string[] = [];
  const channelsFailed: string[] = [];
  const channelErrors: string[] = [];

  // Validate date to prevent "Invalid Date" in messages
  if (!cleaningDate || isNaN(cleaningDate.getTime())) {
    console.error('Invalid cleaning date provided:', cleaningDate);
    return { sent: false, channels: [], failedChannels: ['validation'], errors: ['Invalid cleaning date'] };
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
      try {
        const emailResult = await notificationService.sendEmail({
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
        if (emailResult) {
          channelsSent.push('email');
        } else {
          channelsFailed.push('email');
          channelErrors.push(`Email send returned false for ${user.email}`);
        }
      } catch (emailError: any) {
        channelsFailed.push('email');
        channelErrors.push(`Email error: ${sanitizeErrorMessage(emailError)}`);
        console.error(`  Email error for ${user.email}:`, emailError);
      }
    }

    // Send SMS if user explicitly opted in and has phone number
    // BUG FIX: Use === true (explicit opt-in) instead of !== false.
    // notify_sms defaults to false for most users; sending without consent is a TCPA violation.
    const phoneNumber = user.phone_number || user.phone;
    if (phoneNumber && user.notify_sms === true) {
      console.log(`  SMS -> ${phoneNumber}`);
      try {
        const smsResult = await notificationService.sendSMS({
          to: phoneNumber,
          message: message
        });
        if (smsResult) {
          channelsSent.push('sms');
        } else {
          channelsFailed.push('sms');
          console.error(`  SMS send returned false for ${phoneNumber}`);
        }
      } catch (smsError) {
        channelsFailed.push('sms');
        console.error(`  SMS error for ${phoneNumber}:`, smsError);
      }
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
          channelsFailed.push('voice');
          channelErrors.push(`Voice failed: ${voiceResult.error}`);
          console.error(`  Voice call failed for ${phoneNumber}:`, voiceResult.error);
        }
      } catch (voiceError: any) {
        channelsFailed.push('voice');
        channelErrors.push(`Voice error: ${sanitizeErrorMessage(voiceError)}`);
        console.error(`  Voice call error for ${phoneNumber}:`, voiceError);
      }
    }

    // Send push notification to all user's registered devices
    // Uses firebase-admin SDK (FCM v1 HTTP API) — the legacy FCM API was shut down June 2024.
    // Respect push_alert_preferences.street_cleaning if user explicitly disabled it in mobile app
    const pushPrefs = user.push_alert_preferences as Record<string, boolean> | null;
    const pushStreetCleaningEnabled = pushPrefs?.street_cleaning !== false; // Default to true if not set

    if (pushStreetCleaningEnabled) {
      try {
        const { sendPushNotification, isFirebaseConfigured } = await import('../../../lib/firebase-admin');
        if (!isFirebaseConfigured()) {
          console.log(`  Push skipped: Firebase not configured`);
        } else {
          // Look up user's active push tokens
          const { data: tokens, error: tokenError } = await supabaseAdmin.rpc('get_user_push_tokens', {
            p_user_id: user.user_id
          });

          if (tokenError || !tokens || !Array.isArray(tokens) || tokens.length === 0) {
            // No tokens registered — not an error, user may not have logged in on mobile
            console.log(`  Push skipped: no tokens for ${user.email}`);
          } else {
            let pushSuccessCount = 0;
            let pushFailCount = 0;
            for (const tokenRecord of tokens) {
              const pushResult = await sendPushNotification(tokenRecord.token, {
                title: subject,
                body: message,
                data: {
                  type: 'street_cleaning',
                  notificationType: type,
                  ward: user.home_address_ward || '',
                  section: user.home_address_section || '',
                },
              });
              if (pushResult.success) {
                pushSuccessCount++;
              } else {
                pushFailCount++;
                // Clean up invalid tokens
                if (pushResult.invalidToken) {
                  await supabaseAdmin.rpc('deactivate_push_token', { p_token: tokenRecord.token });
                  console.log(`  Deactivated invalid push token for ${user.email}`);
                }
              }
            }
            if (pushSuccessCount > 0) {
              console.log(`  Push -> ${pushSuccessCount} device(s)`);
              channelsSent.push('push');
            } else if (pushFailCount > 0) {
              channelsFailed.push('push');
              channelErrors.push(`Push failed on ${pushFailCount} device(s)`);
            }
          }
        }
      } catch (pushError: any) {
        channelsFailed.push('push');
        channelErrors.push(`Push error: ${sanitizeErrorMessage(pushError)}`);
        console.error(`  Push failed for ${user.email}:`, pushError);
      }
    }

    if (channelsSent.length === 0) {
      console.log(`  No channels available for ${user.email} (email: ${user.notify_email}, sms: ${user.notify_sms}, phone: ${phoneNumber})`);
    }

    if (channelsFailed.length > 0) {
      console.log(`  Failed channels for ${user.email}: ${channelsFailed.join(', ')}`);
    }

    return { sent: channelsSent.length > 0, channels: channelsSent, failedChannels: channelsFailed, errors: channelErrors };
  } catch (error: any) {
    console.error(`Failed to send notification to ${user.email}:`, error);
    return { sent: false, channels: [], failedChannels: ['all'], errors: [sanitizeErrorMessage(error)] };
  }
}


async function logNotification(
  userId: string,
  type: string,
  cleaningDateStr: string,
  ward: string,
  section: string,
  daysUntil?: number,
  channels?: string[],
  status: string = 'sent',
  errorMessage?: string
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
        status,
        ward: ward,
        section: section,
        cleaning_date: cleaningDateStr,
        days_before: daysUntil ?? null,
        channels: channels || ['email'],
        error_message: errorMessage || null,
        metadata: { type, ...(status !== 'sent' ? { failed_channels: channels } : {}) }
      } as any);
  } catch (error) {
    console.error('Failed to log notification:', error);
  }
}
