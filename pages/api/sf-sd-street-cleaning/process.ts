import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';
import { calculateNextCleaning as calculateSFNextCleaning, SFStreetSweepingSchedule } from '../../../lib/sf-street-sweeping';
import { calculateNextCleaning as calculateSDNextCleaning, SDStreetSweepingSchedule } from '../../../lib/sd-street-sweeping';

interface ProcessResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  timestamp: string;
  type: string;
  cities: string;
}

// Get Pacific time for scheduling (both SF and SD are PST)
function getPacificTime(): { hour: number; pstTime: string } {
  const now = new Date();
  const pstTime = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pstDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const hour = pstDate.getHours();

  return { hour, pstTime };
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
  const { hour, pstTime } = getPacificTime();

  console.log('========================================');
  console.log('🧹 SF/SD/LA STREET CLEANING CRON EXECUTION');
  console.log('========================================');
  console.log('UTC Time:', now.toISOString());
  console.log('PST Time:', pstTime);
  console.log('PST Hour:', hour);
  console.log('========================================');

  // Determine notification type based on PST time
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
      cities: 'san-francisco, san-diego'
    });
  }

  try {
    // Process SF, SD, and LA users (all Pacific timezone)
    const sfResults = await processSFStreetCleaningReminders(notificationType);
    const sdResults = await processSDStreetCleaningReminders(notificationType);
    const laResults = await processLAStreetCleaningReminders(notificationType);

    res.status(200).json({
      success: true,
      processed: sfResults.processed + sdResults.processed + laResults.processed,
      successful: sfResults.successful + sdResults.successful + laResults.successful,
      failed: sfResults.failed + sdResults.failed + laResults.failed,
      errors: [...sfResults.errors, ...sdResults.errors, ...laResults.errors],
      timestamp: new Date().toISOString(),
      type: notificationType,
      cities: `SF: ${sfResults.processed}, SD: ${sdResults.processed}, LA: ${laResults.processed}`
    });

  } catch (error) {
    console.error('❌ Error processing SF/SD/LA street cleaning notifications:', error);
    res.status(500).json({
      error: 'Failed to process SF/SD/LA street cleaning notifications'
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
        let schedules: SFStreetSweepingSchedule[] = [];

        if (user.home_address_full) {
          const googleApiKey = process.env.GOOGLE_API_KEY;

          if (googleApiKey) {
            try {
              const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(user.home_address_full + ', San Francisco, CA')}&key=${googleApiKey}`;
              const geocodeRes = await fetch(geocodeUrl);
              const geocodeData = await geocodeRes.json();

              if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
                const location = geocodeData.results[0].geometry.location;
                const { lat, lng } = location;

                const { data: nearbyStreets, error: geoError } = await supabaseAdmin.rpc('find_nearest_sf_street', {
                  lat,
                  lng,
                  max_distance_meters: 75
                });

                if (!geoError && nearbyStreets && nearbyStreets.length > 0) {
                  schedules = nearbyStreets as SFStreetSweepingSchedule[];
                }
              }
            } catch (geoError) {
              console.error(`Failed to geocode ${user.home_address_full}:`, geoError);
            }
          }
        }

        if (schedules.length === 0 && user.home_address_full) {
          const streetName = user.home_address_full.split(',')[0].trim();
          const { data: nameMatches, error: nameError } = await supabaseAdmin
            .from('sf_street_sweeping')
            .select('*')
            .ilike('corridor', `%${streetName}%`)
            .limit(10);

          if (!nameError && nameMatches && nameMatches.length > 0) {
            schedules = nameMatches as SFStreetSweepingSchedule[];
          }
        }

        if (schedules.length === 0) {
          continue;
        }

        const upcomingCleanings = [];
        for (const schedule of schedules as SFStreetSweepingSchedule[]) {
          const next = calculateSFNextCleaning(schedule);
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
          continue;
        }

        const messages: string[] = [];

        for (const [daysUntil, cleanings] of cleaningsByDate.entries()) {
          const segmentMessages: string[] = [];

          for (const cleaning of cleanings) {
            const schedule = schedules.find(s => s.corridor === cleaning.streetName);
            const limits = schedule?.limits || '';

            let locationInfo = cleaning.streetName;
            if (limits) {
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

        const message = messages.join('\n\n');

        if (user.notify_sms && user.phone_number) {
          await notificationService.sendSMS(user.phone_number, message);
          console.log(`✅ Sent SF SMS to ${user.phone_number}`);
        }

        if (user.notify_email && user.email) {
          await notificationService.sendEmail(
            user.email,
            'Street Cleaning Reminder - San Francisco',
            message
          );
          console.log(`✅ Sent SF email to ${user.email}`);
        }

        successful++;

      } catch (userError) {
        failed++;
        const errorMsg = `Failed to process SF user ${user.id}: ${userError instanceof Error ? userError.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return { processed, successful, failed, errors };

  } catch (error) {
    errors.push(`Fatal SF error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { processed, successful, failed, errors };
  }
}

async function processSDStreetCleaningReminders(type: string) {
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
      .eq('city', 'san-diego')
      .eq('notify_sms', true)
      .or('snooze_until_date.is.null,snooze_until_date.lt.' + today.toISOString().split('T')[0]);

    if (userError) {
      errors.push(`Failed to fetch SD users: ${userError.message}`);
      return { processed, successful, failed, errors };
    }

    if (!users || users.length === 0) {
      console.log('No SD users found with notifications enabled');
      return { processed, successful, failed, errors };
    }

    console.log(`Found ${users.length} SD users to process`);

    for (const user of users) {
      processed++;

      try {
        let schedules: SDStreetSweepingSchedule[] = [];

        if (user.home_address_full) {
          const googleApiKey = process.env.GOOGLE_API_KEY;

          if (googleApiKey) {
            try {
              const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(user.home_address_full + ', San Diego, CA')}&key=${googleApiKey}`;
              const geocodeRes = await fetch(geocodeUrl);
              const geocodeData = await geocodeRes.json();

              if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
                const addressComponents = geocodeData.results[0].address_components;
                const routeComponent = addressComponents.find((c: any) => c.types.includes('route'));
                const streetNumberComponent = addressComponents.find((c: any) => c.types.includes('street_number'));

                if (routeComponent) {
                  const streetName = routeComponent.long_name;
                  const streetNumber = streetNumberComponent ? parseInt(streetNumberComponent.long_name) : null;

                  const { data: allMatches, error: nameError } = await supabaseAdmin
                    .from('sd_street_sweeping')
                    .select('*')
                    .ilike('rd20full', `%${streetName}%`)
                    .limit(100);

                  if (!nameError && allMatches && allMatches.length > 0) {
                    // Filter by address range if we have a street number
                    if (streetNumber !== null) {
                      const matchingSegments: SDStreetSweepingSchedule[] = [];

                      for (const segment of allMatches) {
                        const leftLow = parseInt(segment.llowaddr) || 0;
                        const leftHigh = parseInt(segment.lhighaddr) || 0;
                        const rightLow = parseInt(segment.rlowaddr) || 0;
                        const rightHigh = parseInt(segment.rhighaddr) || 0;

                        const inLeftRange = streetNumber >= leftLow && streetNumber <= leftHigh;
                        const inRightRange = streetNumber >= rightLow && streetNumber <= rightHigh;

                        if (inLeftRange || inRightRange) {
                          matchingSegments.push(segment);
                        }
                      }

                      if (matchingSegments.length > 0) {
                        schedules = matchingSegments;
                      } else {
                        // Fallback to first few if no range match
                        schedules = allMatches.slice(0, 3) as SDStreetSweepingSchedule[];
                      }
                    } else {
                      schedules = allMatches.slice(0, 3) as SDStreetSweepingSchedule[];
                    }
                  }
                }
              }
            } catch (geoError) {
              console.error(`Failed to geocode ${user.home_address_full}:`, geoError);
            }
          }
        }

        // Fallback: simple street name match
        if (schedules.length === 0 && user.home_address_full) {
          const streetName = user.home_address_full.split(',')[0].trim();
          const { data: nameMatches, error: nameError } = await supabaseAdmin
            .from('sd_street_sweeping')
            .select('*')
            .ilike('rd20full', `%${streetName}%`)
            .limit(20);

          if (!nameError && nameMatches && nameMatches.length > 0) {
            schedules = nameMatches as SDStreetSweepingSchedule[];
          }
        }

        if (schedules.length === 0) {
          continue;
        }

        const upcomingCleanings = [];
        for (const schedule of schedules as SDStreetSweepingSchedule[]) {
          const next = calculateSDNextCleaning(schedule);
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
          continue;
        }

        const messages: string[] = [];

        for (const [daysUntil, cleanings] of cleaningsByDate.entries()) {
          const segmentMessages: string[] = [];

          for (const cleaning of cleanings) {
            const schedule = schedules.find(s => s.rd20full === cleaning.streetName);
            const xstrt1 = schedule?.xstrt1 || '';
            const xstrt2 = schedule?.xstrt2 || '';

            let locationInfo = cleaning.streetName;
            if (xstrt1 && xstrt2) {
              locationInfo = `${cleaning.streetName} (${xstrt1} to ${xstrt2})`;
            }

            const timeStr = cleaning.startTime && cleaning.endTime
              ? `${cleaning.startTime}-${cleaning.endTime}`
              : '';

            let segmentMsg = '';
            if (type === 'morning_reminder') {
              if (daysUntil === 0) {
                segmentMsg = `🧹 Street cleaning TODAY on ${locationInfo}${timeStr ? ' at ' + timeStr : ''}. Move your car now!`;
              } else if (daysUntil === 1) {
                segmentMsg = `🧹 Street cleaning TOMORROW on ${locationInfo}${timeStr ? ' at ' + timeStr : ''}. Set a reminder!`;
              } else {
                segmentMsg = `🧹 Street cleaning in ${daysUntil} days on ${locationInfo}${timeStr ? ' at ' + timeStr : ''}.`;
              }
            } else if (type === 'follow_up') {
              if (daysUntil === 1) {
                segmentMsg = `🧹 REMINDER: Street cleaning TOMORROW on ${locationInfo}${timeStr ? ' at ' + timeStr : ''}. Don't forget to move your car tonight!`;
              } else if (daysUntil === 0) {
                segmentMsg = `🧹 LAST CHANCE: Street cleaning TODAY on ${locationInfo}. Move your car NOW!`;
              }
            } else if (type === 'evening_reminder') {
              if (daysUntil === 1) {
                segmentMsg = `🧹 Street cleaning TOMORROW${timeStr ? ' at ' + timeStr : ''} on ${locationInfo}. Move your car tonight before you sleep!`;
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

        const message = messages.join('\n\n');

        if (user.notify_sms && user.phone_number) {
          await notificationService.sendSMS(user.phone_number, message);
          console.log(`✅ Sent SD SMS to ${user.phone_number}`);
        }

        if (user.notify_email && user.email) {
          await notificationService.sendEmail(
            user.email,
            'Street Cleaning Reminder - San Diego',
            message
          );
          console.log(`✅ Sent SD email to ${user.email}`);
        }

        successful++;

      } catch (userError) {
        failed++;
        const errorMsg = `Failed to process SD user ${user.id}: ${userError instanceof Error ? userError.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return { processed, successful, failed, errors };

  } catch (error) {
    errors.push(`Fatal SD error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { processed, successful, failed, errors };
  }
}

async function processLAStreetCleaningReminders(type: string) {
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
      .eq('city', 'los-angeles')
      .eq('notify_sms', true)
      .or('snooze_until_date.is.null,snooze_until_date.lt.' + today.toISOString().split('T')[0]);

    if (userError) {
      errors.push(`Failed to fetch LA users: ${userError.message}`);
      return { processed, successful, failed, errors };
    }

    if (!users || users.length === 0) {
      console.log('No LA users found with notifications enabled');
      return { processed, successful, failed, errors };
    }

    console.log(`Found ${users.length} LA users to process`);

    for (const user of users) {
      processed++;

      try {
        if (!user.home_address_full) {
          console.log(`Skipping LA user ${user.id} - no address`);
          continue;
        }

        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (!googleApiKey) {
          console.error('Google API key not configured');
          continue;
        }

        // Geocode user address
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(user.home_address_full + ', Los Angeles, CA')}&key=${googleApiKey}`;
        const geocodeRes = await fetch(geocodeUrl);
        const geocodeData = await geocodeRes.json();

        if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
          console.log(`Failed to geocode LA user address: ${user.home_address_full}`);
          continue;
        }

        const location = geocodeData.results[0].geometry.location;

        // Find routes using PostGIS polygon matching
        const { data: routes, error: routeError } = await supabaseAdmin.rpc('find_la_route_for_point', {
          lat: location.lat,
          lng: location.lng
        });

        if (routeError || !routes || routes.length === 0) {
          console.log(`No LA routes found for user ${user.id}`);
          continue;
        }

        // LA routes have specific days (M, Tu, W, Th, F)
        // Match today's day of week
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayAbbr: {[key: string]: string} = {
          'Monday': 'M',
          'Tuesday': 'Tu',
          'Wednesday': 'W',
          'Thursday': 'Th',
          'Friday': 'F'
        };

        const notifyDays = user.notification_preferences?.reminder_days || [0, 1];
        const messages: string[] = [];

        for (const daysUntil of notifyDays) {
          const targetDate = new Date(today);
          targetDate.setDate(today.getDate() + daysUntil);
          const targetDayName = daysOfWeek[targetDate.getDay()];
          const targetDayAbbr = dayAbbr[targetDayName];

          if (!targetDayAbbr) continue; // Weekend

          const routesForDay = routes.filter((r: any) => r.day_of_week === targetDayAbbr);

          if (routesForDay.length > 0) {
            const dayDesc = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `in ${daysUntil} days`;
            let msg = `🧹 Street sweeping ${dayDesc} (${targetDayName}):\n`;

            for (const route of routesForDay) {
              msg += `\nRoute ${route.route_no}\n`;
              msg += `Time: ${route.time_start} - ${route.time_end}\n`;
              msg += `Area: ${route.boundaries}\n`;
            }

            msg += `\nLA sweeps on a biweekly schedule (1st/3rd OR 2nd/4th weeks). Check posted signs to confirm.`;
            messages.push(msg);
          }
        }

        if (messages.length === 0) {
          continue;
        }

        const message = messages.join('\n\n');

        if (user.notify_sms && user.phone_number) {
          await notificationService.sendSMS(user.phone_number, message);
          console.log(`✅ Sent LA SMS to ${user.phone_number}`);
        }

        if (user.notify_email && user.email) {
          await notificationService.sendEmail(
            user.email,
            'Street Sweeping Reminder - Los Angeles',
            message
          );
          console.log(`✅ Sent LA email to ${user.email}`);
        }

        successful++;

      } catch (userError) {
        failed++;
        const errorMsg = `Failed to process LA user ${user.id}: ${userError instanceof Error ? userError.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return { processed, successful, failed, errors };

  } catch (error) {
    errors.push(`Fatal LA error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { processed, successful, failed, errors };
  }
}
