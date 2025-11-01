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

  // Determine notification type based on SF time
  let notificationType = 'unknown';
  if (hour === 7) {
    notificationType = 'morning_reminder';
    console.log('✅ Matched: morning_reminder (7am PST)');
  } else if (hour === 15) {
    notificationType = 'follow_up';
    console.log('✅ Matched: follow_up (3pm PST)');
  } else if (hour === 19) {
    notificationType = 'evening_reminder';
    console.log('✅ Matched: evening_reminder (7pm PST)');
  } else {
    console.log(`⏭️  Skipped: Current hour ${hour} doesn't match any notification schedule (7am, 3pm, 7pm PST)`);
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
    const results = await processSFStreetCleaningReminders(notificationType);

    res.status(200).json({
      success: true,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors,
      timestamp: new Date().toISOString(),
      type: notificationType,
      city: 'san-francisco'
    });

  } catch (error) {
    console.error('❌ Error processing SF street cleaning notifications:', error);
    res.status(500).json({
      error: 'Failed to process SF street cleaning notifications'
    });
  }
}

async function processSFStreetCleaningReminders(type: string) {
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    // Get all San Francisco users with notifications enabled
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('city', 'san-francisco')
      .eq('notify_sms', true)
      .or('snooze_until_date.is.null,snooze_until_date.lt.' + today.toISOString().split('T')[0]);

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
        // Geocode user's address to find nearest street segment
        let schedules: SFStreetSweepingSchedule[] = [];

        if (user.home_address_full) {
          const googleApiKey = process.env.GOOGLE_API_KEY;

          if (googleApiKey) {
            try {
              // Geocode the address
              const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(user.home_address_full + ', San Francisco, CA')}&key=${googleApiKey}`;
              const geocodeRes = await fetch(geocodeUrl);
              const geocodeData = await geocodeRes.json();

              if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
                const location = geocodeData.results[0].geometry.location;
                const { lat, lng } = location;

                // Find nearest street segment using PostGIS function
                // 75 meters = about one city block (tighter to avoid false positives)
                const { data: nearbyStreets, error: geoError } = await supabaseAdmin.rpc('find_nearest_sf_street', {
                  lat,
                  lng,
                  max_distance_meters: 75
                });

                if (!geoError && nearbyStreets && nearbyStreets.length > 0) {
                  schedules = nearbyStreets as SFStreetSweepingSchedule[];
                  console.log(`✅ Found ${schedules.length} street segments near ${user.home_address_full}`);
                }
              }
            } catch (geoError) {
              console.error(`Failed to geocode ${user.home_address_full}:`, geoError);
            }
          }
        }

        // Fallback: try simple street name match if geocoding failed
        if (schedules.length === 0 && user.home_address_full) {
          const streetName = user.home_address_full.split(',')[0].trim();
          const { data: nameMatches, error: nameError } = await supabaseAdmin
            .from('sf_street_sweeping')
            .select('*')
            .ilike('corridor', `%${streetName}%`)
            .limit(10);

          if (!nameError && nameMatches && nameMatches.length > 0) {
            schedules = nameMatches as SFStreetSweepingSchedule[];
            console.log(`✅ Found ${schedules.length} street segments matching "${streetName}"`);
          }
        }

        if (schedules.length === 0) {
          console.log(`❌ No schedule found for user ${user.id} at ${user.home_address_full}`);
          continue;
        }

        // Calculate ALL upcoming cleaning dates (not just the next one)
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

        upcomingCleanings.sort((a, b) => a.date.getTime() - b.date.getTime());

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const notifyDays = user.notification_preferences?.reminder_days || [0, 1];

        // Group cleanings by date and notify about ALL cleanings on notify days
        const cleaningsByDate = new Map<number, any[]>();

        for (const cleaning of upcomingCleanings) {
          const cleaningDate = new Date(cleaning.date);
          cleaningDate.setHours(0, 0, 0, 0);
          const daysUntil = Math.floor((cleaningDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (notifyDays.includes(daysUntil)) {
            if (!cleaningsByDate.has(daysUntil)) {
              cleaningsByDate.set(daysUntil, []);
            }
            cleaningsByDate.get(daysUntil)!.push(cleaning);
          }
        }

        if (cleaningsByDate.size === 0) {
          console.log(`User ${user.id}: No cleanings on notify days`);
          continue;
        }

        // Build message for each notify day
        const messages: string[] = [];

        for (const [daysUntil, cleanings] of cleaningsByDate.entries()) {
          // Group cleanings by segment to show cross streets
          const segmentMessages: string[] = [];

          for (const cleaning of cleanings) {
            const schedule = schedules.find(s => s.corridor === cleaning.streetName);
            const limits = schedule?.limits || '';

            let locationInfo = cleaning.streetName;
            if (limits) {
              // Clean up the limits string (sometimes has "Start: " prefix)
              const cleanLimits = limits.replace(/Start:\s*/g, '').trim();
              locationInfo = `${cleaning.streetName} (${cleanLimits})`;
            }

            const startTime = cleaning.startTime;

            let segmentMsg = '';
            if (type === 'morning_reminder') {
              if (daysUntil === 0) {
                segmentMsg = `🧹 Street cleaning TODAY on ${locationInfo} at ${startTime}. Move your car now! ($97 ticket if you don't)`;
              } else if (daysUntil === 1) {
                segmentMsg = `🧹 Street cleaning TOMORROW on ${locationInfo} at ${startTime}. Set a reminder!`;
              } else {
                segmentMsg = `🧹 Street cleaning in ${daysUntil} days on ${locationInfo} at ${startTime}.`;
              }
            } else if (type === 'follow_up') {
              if (daysUntil === 1) {
                segmentMsg = `🧹 REMINDER: Street cleaning TOMORROW on ${locationInfo} at ${startTime}. Don't forget to move your car tonight!`;
              } else if (daysUntil === 0) {
                segmentMsg = `🧹 LAST CHANCE: Street cleaning TODAY on ${locationInfo}. Move your car NOW to avoid a $97 ticket!`;
              }
            } else if (type === 'evening_reminder') {
              if (daysUntil === 1) {
                segmentMsg = `🧹 Street cleaning TOMORROW at ${startTime} on ${locationInfo}. Move your car tonight before you sleep!`;
              }
            }

            if (segmentMsg && !segmentMessages.includes(segmentMsg)) {
              segmentMessages.push(segmentMsg);
            }
          }

          messages.push(...segmentMessages);
        }

        if (messages.length === 0) {
          continue;
        }

        // Combine all messages
        const message = messages.join('\n\n');

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
