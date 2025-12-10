import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase, supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';
import { calculateNextCleaning, BostonStreetSweepingSchedule } from '../../../lib/boston-street-sweeping';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

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

// Get Boston time for scheduling
function getBostonTime(): { hour: number; bostonTime: string } {
  const now = new Date();
  const bostonTime = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const bostonDate = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = bostonDate.getHours();

  return { hour, bostonTime };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessResult | { error: string }>
) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const now = new Date();
  const { hour, bostonTime } = getBostonTime();

  console.log('========================================');
  console.log('🧹 BOSTON STREET CLEANING CRON EXECUTION');
  console.log('========================================');
  console.log('UTC Time:', now.toISOString());
  console.log('Boston Time:', bostonTime);
  console.log('Boston Hour:', hour);
  console.log('========================================');

  let notificationType = 'unknown';
  if (hour === 7) {
    notificationType = 'morning_reminder';
    console.log('✅ Matched: morning_reminder (7am EST)');
  } else if (hour === 15) {
    notificationType = 'follow_up';
    console.log('✅ Matched: follow_up (3pm EST)');
  } else if (hour === 19) {
    notificationType = 'evening_reminder';
    console.log('✅ Matched: evening_reminder (7pm EST)');
  } else {
    console.log(`⏭️  Skipped: Current hour ${hour} doesn't match any notification schedule (7am, 3pm, 7pm EST)`);
    return res.status(200).json({
      success: true,
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      timestamp: now.toISOString(),
      type: 'skipped - wrong hour',
      city: 'boston'
    });
  }

  try {
    const results = await processBostonStreetCleaningReminders(notificationType);

    res.status(200).json({
      success: true,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors,
      timestamp: new Date().toISOString(),
      type: notificationType,
      city: 'boston'
    });

  } catch (error) {
    console.error('❌ Error processing Boston street cleaning notifications:', error);
    res.status(500).json({
      error: 'Failed to process Boston street cleaning notifications'
    });
  }
}

async function processBostonStreetCleaningReminders(type: string) {
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('city', 'boston')
      .eq('notify_sms', true)
      .or('snooze_until_date.is.null,snooze_until_date.lt.' + today.toISOString().split('T')[0]);

    if (userError) {
      errors.push(`Failed to fetch Boston users: ${sanitizeErrorMessage(userError)}`);
      return { processed, successful, failed, errors };
    }

    if (!users || users.length === 0) {
      console.log('No Boston users found with notifications enabled');
      return { processed, successful, failed, errors };
    }

    console.log(`Found ${users.length} Boston users to process`);

    for (const user of users) {
      processed++;

      try {
        let schedules: BostonStreetSweepingSchedule[] = [];
        let userLat: number | null = null;
        let userLng: number | null = null;
        let streetName = '';

        // Geocode user's address to get lat/lng and street name
        if (user.home_address_full) {
          const googleApiKey = process.env.GOOGLE_API_KEY;

          if (googleApiKey) {
            try {
              // Geocode the address
              const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(user.home_address_full + ', Boston, MA')}&key=${googleApiKey}`;
              const geocodeRes = await fetch(geocodeUrl);
              const geocodeData = await geocodeRes.json();

              if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
                const location = geocodeData.results[0].geometry.location;
                userLat = location.lat;
                userLng = location.lng;

                // Extract street name from address_components
                const addressComponents = geocodeData.results[0].address_components;
                const routeComponent = addressComponents.find((c: any) => c.types.includes('route'));

                if (routeComponent) {
                  streetName = routeComponent.long_name;
                  console.log(`✅ Geocoded "${user.home_address_full}" → ${userLat}, ${userLng} on "${streetName}"`);
                }
              }
            } catch (geoError) {
              console.error(`Failed to geocode ${user.home_address_full}:`, geoError);
            }
          }
        }

        // Fallback: try simple street name extraction if geocoding failed
        if (!streetName && user.home_address_full) {
          streetName = user.home_address_full.split(',')[0].trim();
          console.log(`⚠️  Using fallback street name extraction: "${streetName}"`);
        }

        // Find all matching street segments
        if (streetName) {
          const { data: nameMatches, error: nameError } = await supabaseAdmin
            .from('boston_street_sweeping')
            .select('*')
            .ilike('st_name', `%${streetName}%`)
            .limit(50);

          if (!nameError && nameMatches && nameMatches.length > 0) {
            // If we have user's lat/lng, find the CLOSEST segments
            if (userLat && userLng) {
              const segmentsWithDistance: Array<{ schedule: BostonStreetSweepingSchedule; distance: number }> = [];

              for (const schedule of nameMatches as BostonStreetSweepingSchedule[]) {
                // Use cached segment lat/lng if available
                const segmentLat = (schedule as any).segment_lat;
                const segmentLng = (schedule as any).segment_lng;

                if (segmentLat && segmentLng) {
                  // Calculate distance in meters (Haversine formula)
                  const R = 6371000; // Earth radius in meters
                  const φ1 = userLat * Math.PI / 180;
                  const φ2 = segmentLat * Math.PI / 180;
                  const Δφ = (segmentLat - userLat) * Math.PI / 180;
                  const Δλ = (segmentLng - userLng) * Math.PI / 180;

                  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                          Math.cos(φ1) * Math.cos(φ2) *
                          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
                  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                  const distance = R * c;

                  segmentsWithDistance.push({ schedule, distance });
                } else {
                  // No cached location - include it with max distance
                  segmentsWithDistance.push({ schedule, distance: 999999 });
                }
              }

              // Sort by distance (closest first)
              segmentsWithDistance.sort((a, b) => a.distance - b.distance);

              // Take segments within 150m (handles long blocks)
              // But prioritize the closest ones
              const nearbySchedules: BostonStreetSweepingSchedule[] = [];
              for (const item of segmentsWithDistance) {
                if (item.distance <= 150) {
                  nearbySchedules.push(item.schedule);
                  console.log(`✅ Segment "${item.schedule.st_name} (${item.schedule.from_street} - ${item.schedule.to_street})" is ${item.distance.toFixed(0)}m away - INCLUDED`);
                } else {
                  console.log(`⏭️  Segment "${item.schedule.st_name} (${item.schedule.from_street} - ${item.schedule.to_street})" is ${item.distance.toFixed(0)}m away - SKIPPED (too far)`);
                }
              }

              schedules = nearbySchedules;
              console.log(`✅ Filtered to ${schedules.length} nearby segments (within 150m, sorted by distance)`);
            } else {
              // No lat/lng, use all matching segments
              schedules = nameMatches as BostonStreetSweepingSchedule[];
              console.log(`⚠️  No geocoding - using all ${schedules.length} matching segments`);
            }
          }
        }

        if (schedules.length === 0) {
          console.log(`❌ No schedule found for user ${user.id} at ${user.home_address_full}`);
          continue;
        }

        // Calculate ALL upcoming cleaning dates (not just the next one)
        const upcomingCleanings = [];
        for (const schedule of schedules) {
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
        const cleaningsByDate = new Map<number, NextCleaningEvent[]>();

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
            const schedule = schedules.find(s => s.st_name === cleaning.streetName && s.side === cleaning.side);
            const fromStreet = schedule?.from_street || '';
            const toStreet = schedule?.to_street || '';

            let locationInfo = cleaning.streetName;
            if (fromStreet && toStreet) {
              locationInfo = `${cleaning.streetName} (${fromStreet} to ${toStreet})`;
            } else if (fromStreet) {
              locationInfo = `${cleaning.streetName} (from ${fromStreet})`;
            } else if (toStreet) {
              locationInfo = `${cleaning.streetName} (to ${toStreet})`;
            }

            let sideInfo = '';
            if (cleaning.side && cleaning.side !== 'both') {
              sideInfo = ` on the ${cleaning.side} side`;
            }

            const startTime = cleaning.startTime;

            let segmentMsg = '';
            if (type === 'morning_reminder') {
              if (daysUntil === 0) {
                segmentMsg = `🧹 Street cleaning TODAY${sideInfo} on ${locationInfo} at ${startTime}. Move your car now! ($40 ticket if you don't)`;
              } else if (daysUntil === 1) {
                segmentMsg = `🧹 Street cleaning TOMORROW${sideInfo} on ${locationInfo} at ${startTime}. Set a reminder!`;
              } else {
                segmentMsg = `🧹 Street cleaning in ${daysUntil} days${sideInfo} on ${locationInfo} at ${startTime}.`;
              }
            } else if (type === 'follow_up') {
              if (daysUntil === 1) {
                segmentMsg = `🧹 REMINDER: Street cleaning TOMORROW${sideInfo} on ${locationInfo} at ${startTime}. Don't forget to move your car tonight!`;
              } else if (daysUntil === 0) {
                segmentMsg = `🧹 LAST CHANCE: Street cleaning TODAY${sideInfo} on ${locationInfo}. Move your car NOW to avoid a $40 ticket!`;
              }
            } else if (type === 'evening_reminder') {
              if (daysUntil === 1) {
                segmentMsg = `🧹 Street cleaning TOMORROW${sideInfo} at ${startTime} on ${locationInfo}. Move your car tonight before you sleep!`;
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

        if (user.notify_sms && user.phone_number) {
          await notificationService.sendSMS(user.phone_number, message);
          console.log(`✅ Sent SMS to ${user.phone_number}`);
        }

        if (user.notify_email && user.email) {
          await notificationService.sendEmail(
            user.email,
            'Street Cleaning Reminder - Boston',
            message
          );
          console.log(`✅ Sent email to ${user.email}`);
        }

        successful++;

      } catch (userError) {
        failed++;
        const errorMsg = `Failed to process user ${user.id}: ${sanitizeErrorMessage(userError)}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return { processed, successful, failed, errors };

  } catch (error) {
    errors.push(`Fatal error: ${sanitizeErrorMessage(error)}`);
    return { processed, successful, failed, errors };
  }
}
