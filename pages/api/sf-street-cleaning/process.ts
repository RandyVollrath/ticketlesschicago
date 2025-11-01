import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase, supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';
import { calculateNextCleaning, SFStreetSweepingSchedule } from '../../../lib/sf-street-sweeping';

interface ProcessResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  timestamp: string;
  type: string;
  city: string;
}

// Get San Francisco time for scheduling
function getSanFranciscoTime(): { hour: number; sfTime: string } {
  const now = new Date();
  const sfTime = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const sfDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const hour = sfDate.getHours();

  return { hour, sfTime };
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
  const { hour, sfTime } = getSanFranciscoTime();

  console.log('========================================');
  console.log('🧹 SF STREET CLEANING CRON EXECUTION');
  console.log('========================================');
  console.log('UTC Time:', now.toISOString());
  console.log('SF Time:', sfTime);
  console.log('SF Hour:', hour);
  console.log('========================================');

  // Only run at 7am PST
  if (hour !== 7) {
    console.log(`⏭️  Skipped: Current hour ${hour} doesn't match 7am PST`);
    return res.status(200).json({
      success: true,
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      timestamp: now.toISOString(),
      type: 'skipped - wrong hour',
      city: 'san-francisco'
    });
  }

  try {
    const results = await processSFStreetCleaningReminders();

    res.status(200).json({
      success: true,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors,
      timestamp: new Date().toISOString(),
      type: 'morning_reminder',
      city: 'san-francisco'
    });

  } catch (error) {
    console.error('❌ Error processing SF street cleaning notifications:', error);
    res.status(500).json({
      error: 'Failed to process SF street cleaning notifications'
    });
  }
}

async function processSFStreetCleaningReminders() {
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    // Get all San Francisco users with notifications enabled
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('city', 'san-francisco')
      .eq('notify_sms', true);

    if (userError) {
      errors.push(`Failed to fetch SF users: ${userError.message}`);
      return { processed, successful, failed, errors };
    }

    if (!users || users.length === 0) {
      console.log('No SF users found with notifications enabled');
      return { processed, successful, failed, errors };
    }

    console.log(`Found ${users.length} SF users to process`);

    for (const user of users) {
      processed++;

      try {
        // Get user's street sweeping schedule
        const { data: schedules, error: schedError } = await supabaseAdmin
          .from('sf_street_sweeping')
          .select('*')
          .ilike('corridor', user.home_address?.split(',')[0] || '');

        if (schedError || !schedules || schedules.length === 0) {
          console.log(`No schedule found for user ${user.id}`);
          continue;
        }

        // Calculate next cleaning dates
        const upcomingCleanings = [];
        for (const schedule of schedules as SFStreetSweepingSchedule[]) {
          const next = calculateNextCleaning(schedule);
          if (next) {
            upcomingCleanings.push(next);
          }
        }

        if (upcomingCleanings.length === 0) {
          continue;
        }

        // Sort by date and get the next one
        upcomingCleanings.sort((a, b) => a.date.getTime() - b.date.getTime());
        const nextCleaning = upcomingCleanings[0];

        // Calculate days until cleaning
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const cleaningDate = new Date(nextCleaning.date);
        cleaningDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.floor((cleaningDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        // Check if user wants notification for this many days ahead
        const notifyDays = user.notification_preferences?.reminder_days || [0, 1];
        if (!notifyDays.includes(daysUntil)) {
          console.log(`User ${user.id}: Not sending (${daysUntil} days not in remind list)`);
          continue;
        }

        // Build message
        let message = '';
        if (daysUntil === 0) {
          message = `🧹 Street cleaning TODAY on ${nextCleaning.streetName} at ${nextCleaning.startTime}. Move your car now!`;
        } else if (daysUntil === 1) {
          message = `🧹 Street cleaning TOMORROW on ${nextCleaning.streetName} at ${nextCleaning.startTime}. Set a reminder!`;
        } else {
          message = `🧹 Street cleaning in ${daysUntil} days on ${nextCleaning.streetName} at ${nextCleaning.startTime}.`;
        }

        // Send notification
        if (user.notify_sms && user.phone_number) {
          await notificationService.sendSMS(user.phone_number, message);
          console.log(`✅ Sent SMS to ${user.phone_number}`);
        }

        if (user.notify_email && user.email) {
          await notificationService.sendEmail(
            user.email,
            'Street Cleaning Reminder - San Francisco',
            message
          );
          console.log(`✅ Sent email to ${user.email}`);
        }

        successful++;

      } catch (userError) {
        failed++;
        const errorMsg = `Failed to process user ${user.id}: ${userError instanceof Error ? userError.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return { processed, successful, failed, errors };

  } catch (error) {
    errors.push(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { processed, successful, failed, errors };
  }
}
