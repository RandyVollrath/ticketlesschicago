/**
 * Mobile Parking Reminders Cron Job
 *
 * Sends follow-up push notifications to mobile app users who are parked
 * in restricted zones before restrictions take effect.
 *
 * Runs every 15 minutes to catch all enforcement start times.
 *
 * - Permit zones: 30 minutes before actual enforcement start (parsed from schedule)
 * - Street cleaning: 7am morning-of + 8pm night-before
 * - Winter ban: 9pm (ban starts at 3am)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getChicagoTime } from '../../../lib/chicago-timezone-utils';
import { sendPushNotification, isFirebaseConfigured } from '../../../lib/firebase-admin';

interface ParkedVehicle {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  fcm_token: string;
  address: string;
  on_winter_ban_street: boolean;
  on_snow_route: boolean;
  street_cleaning_date: string | null;
  permit_zone: string | null;
  permit_restriction_schedule: string | null;
  parked_at: string;
  // Notification tracking
  winter_ban_notified_at: string | null;
  street_cleaning_notified_at: string | null;
  permit_zone_notified_at: string | null;
}

/**
 * Parse a time string like "6pm", "9:30am", "8am" to { hours, minutes }
 */
function parseTimeStr(timeStr: string): { hours: number; minutes: number } | null {
  const match = timeStr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toLowerCase();
  if (period === 'pm' && hours !== 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  return { hours, minutes };
}

const DAY_MAP: { [key: string]: number } = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2,
  wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * Parse day range string to array of day numbers (0=Sun, 6=Sat)
 */
function parseDayRange(dayStr: string): number[] {
  const parts = dayStr.toLowerCase().trim().split('-');
  if (parts.length === 2) {
    const start = DAY_MAP[parts[0].trim()];
    const end = DAY_MAP[parts[1].trim()];
    if (start === undefined || end === undefined) return [1, 2, 3, 4, 5];
    const days: number[] = [];
    if (start <= end) {
      for (let i = start; i <= end; i++) days.push(i);
    } else {
      for (let i = start; i <= 6; i++) days.push(i);
      for (let i = 0; i <= end; i++) days.push(i);
    }
    return days;
  }
  const single = DAY_MAP[dayStr.toLowerCase().trim()];
  return single !== undefined ? [single] : [1, 2, 3, 4, 5];
}

const ADVANCE_WARNING_MINUTES = 30;

/**
 * Check if enforcement starts within the next 30 minutes for this vehicle.
 * Returns the enforcement start time if a notification should be sent now, null otherwise.
 * Handles schedules like "Mon-Fri 6pm-9:30am", "Mon-Fri 8am-6pm", etc.
 */
function getEnforcementStartingSoon(schedule: string | null, chicagoTime: Date): { enforcementStart: Date; enforcementTimeStr: string } | null {
  if (!schedule) {
    // Default: Mon-Fri 8am
    schedule = 'Mon-Fri 8am-6pm';
  }

  const chicagoDay = chicagoTime.getDay();
  const chicagoMs = chicagoTime.getTime();

  const parts = schedule.split(',').map(s => s.trim());

  for (const part of parts) {
    const match = part.match(/^([a-zA-Z]+(?:-[a-zA-Z]+)?)\s+(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)$/i);
    if (!match) continue;

    const days = parseDayRange(match[1]);
    if (!days.includes(chicagoDay)) continue;

    const startTime = parseTimeStr(match[2]);
    if (!startTime) continue;

    // Build enforcement start as a Date in Chicago time
    const enforcementStart = new Date(chicagoTime);
    enforcementStart.setHours(startTime.hours, startTime.minutes, 0, 0);

    const msBefore = enforcementStart.getTime() - chicagoMs;

    // Notify if enforcement starts within 0 to ADVANCE_WARNING_MINUTES from now
    if (msBefore > 0 && msBefore <= ADVANCE_WARNING_MINUTES * 60 * 1000) {
      const enforcementTimeStr = enforcementStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
      return { enforcementStart, enforcementTimeStr };
    }
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret or allow in development
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.NODE_ENV === 'production' && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  // Check Firebase configuration
  if (!isFirebaseConfigured()) {
    console.warn('Firebase Admin not configured - push notifications will be skipped');
  }

  const chicagoTime = getChicagoTime();
  const chicagoHour = chicagoTime.getHours();
  const today = chicagoTime.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`Running mobile parking reminders at ${chicagoTime.toISOString()} (Chicago hour: ${chicagoHour})`);

  try {
    const results = {
      winterBanReminders: 0,
      streetCleaningReminders: 0,
      permitZoneReminders: 0,
      errors: 0,
    };

    // Get all active parked vehicles
    const { data: parkedVehicles, error } = await supabaseAdmin
      .from('user_parked_vehicles')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching parked vehicles:', error);
      return res.status(500).json({ error: 'Failed to fetch parked vehicles' });
    }

    if (!parkedVehicles || parkedVehicles.length === 0) {
      console.log('No active parked vehicles found');
      return res.status(200).json({ success: true, message: 'No active parked vehicles', results });
    }

    console.log(`Found ${parkedVehicles.length} active parked vehicles`);

    // Check if we're in winter ban season (Dec 1 - Apr 1)
    const month = chicagoTime.getMonth();
    const day = chicagoTime.getDate();
    const isWinterSeason = month === 11 || month === 0 || month === 1 || month === 2 || (month === 3 && day === 1);

    for (const vehicle of parkedVehicles as ParkedVehicle[]) {
      try {
        // Winter ban reminder (9pm check, ban starts at 3am)
        // Changed from 10pm to 9pm to give users more time
        // Only send once per parking session
        if (chicagoHour >= 20 && chicagoHour <= 22 && isWinterSeason && vehicle.on_winter_ban_street && !vehicle.winter_ban_notified_at) {
          const result = await sendPushNotification(vehicle.fcm_token, {
            title: 'Winter Parking Ban Reminder',
            body: `Your car at ${vehicle.address} is on a winter ban street. Move before 3am to avoid towing ($150+).`,
            data: {
              type: 'winter_ban_reminder',
              lat: vehicle.latitude?.toString(),
              lng: vehicle.longitude?.toString(),
            },
          });
          if (result.success) {
            await supabaseAdmin.from('user_parked_vehicles')
              .update({ winter_ban_notified_at: new Date().toISOString() })
              .eq('id', vehicle.id);
            results.winterBanReminders++;
            console.log(`Sent winter ban reminder to ${vehicle.user_id}`);
          } else if (result.invalidToken) {
            // Mark vehicle as inactive if token is invalid
            await supabaseAdmin.from('user_parked_vehicles')
              .update({ is_active: false })
              .eq('id', vehicle.id);
            console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
          }
        }

        // Street cleaning reminder - NIGHT BEFORE (8pm check for tomorrow's cleaning)
        // This gives users time to move their car the evening before
        const tomorrow = new Date(chicagoTime);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        if (chicagoHour >= 19 && chicagoHour <= 21 && vehicle.street_cleaning_date === tomorrowStr && !vehicle.street_cleaning_notified_at) {
          const result = await sendPushNotification(vehicle.fcm_token, {
            title: 'Street Cleaning Tomorrow!',
            body: `Street cleaning scheduled tomorrow at ${vehicle.address}. Consider moving your car tonight to avoid a $65 ticket.`,
            data: {
              type: 'street_cleaning_reminder',
              lat: vehicle.latitude?.toString(),
              lng: vehicle.longitude?.toString(),
            },
          });
          if (result.success) {
            await supabaseAdmin.from('user_parked_vehicles')
              .update({ street_cleaning_notified_at: new Date().toISOString() })
              .eq('id', vehicle.id);
            results.streetCleaningReminders++;
            console.log(`Sent night-before street cleaning reminder to ${vehicle.user_id}`);
          } else if (result.invalidToken) {
            await supabaseAdmin.from('user_parked_vehicles')
              .update({ is_active: false })
              .eq('id', vehicle.id);
            console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
          }
        }

        // Street cleaning reminder - MORNING OF (7am check, cleaning at 9am)
        // Backup reminder for those who didn't move the night before
        if (chicagoHour >= 6 && chicagoHour <= 8 && vehicle.street_cleaning_date === today && !vehicle.street_cleaning_notified_at) {
          const result = await sendPushNotification(vehicle.fcm_token, {
            title: 'Street Cleaning Today - Move Now!',
            body: `Street cleaning starts at 9am at ${vehicle.address}. Move your car NOW to avoid a $65 ticket.`,
            data: {
              type: 'street_cleaning_reminder',
              lat: vehicle.latitude?.toString(),
              lng: vehicle.longitude?.toString(),
            },
          });
          if (result.success) {
            await supabaseAdmin.from('user_parked_vehicles')
              .update({ street_cleaning_notified_at: new Date().toISOString() })
              .eq('id', vehicle.id);
            results.streetCleaningReminders++;
            console.log(`Sent morning-of street cleaning reminder to ${vehicle.user_id}`);
          } else if (result.invalidToken) {
            await supabaseAdmin.from('user_parked_vehicles')
              .update({ is_active: false })
              .eq('id', vehicle.id);
            console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
          }
        }

        // Permit zone reminder — 15 minutes before actual enforcement start
        // Uses the real schedule (e.g., "Mon-Fri 6pm-9:30am") instead of hardcoded 7am/8am
        // Only send once per parking session
        // Skip if user is parked in their own permit zone
        if (vehicle.permit_zone && !vehicle.permit_zone_notified_at) {
          const enforcement = getEnforcementStartingSoon(vehicle.permit_restriction_schedule, chicagoTime);

          if (enforcement) {
            // Check if user has a permit for this zone
            let isOwnZone = false;
            try {
              const { data: userProfile } = await supabaseAdmin
                .from('user_profiles')
                .select('permit_zone_number, vehicle_zone')
                .eq('user_id', vehicle.user_id)
                .single();

              if (userProfile) {
                const homeZone = (userProfile.permit_zone_number || userProfile.vehicle_zone || '').toString().trim().toLowerCase().replace(/^zone\s*/i, '');
                const parkedZone = (vehicle.permit_zone || '').trim().toLowerCase().replace(/^zone\s*/i, '');

                if (homeZone && parkedZone && homeZone === parkedZone) {
                  isOwnZone = true;
                  console.log(`Skipping permit zone notification for ${vehicle.user_id} — parked in own zone (${vehicle.permit_zone})`);
                }
              }
            } catch (profileErr) {
              console.warn(`Could not check permit zone for ${vehicle.user_id} — notifying to be safe:`, profileErr);
            }

            if (!isOwnZone) {
              const result = await sendPushNotification(vehicle.fcm_token, {
                title: 'Permit Zone Alert',
                body: `Your car at ${vehicle.address} is in ${vehicle.permit_zone}. Permit rules may be active. Check posted signs to avoid a ticket.`,
                data: {
                  type: 'permit_reminder',
                  lat: vehicle.latitude?.toString(),
                  lng: vehicle.longitude?.toString(),
                },
              });
              if (result.success) {
                await supabaseAdmin.from('user_parked_vehicles')
                  .update({ permit_zone_notified_at: new Date().toISOString() })
                  .eq('id', vehicle.id);
                results.permitZoneReminders++;
                console.log(`Sent permit zone reminder to ${vehicle.user_id}`);
              } else if (result.invalidToken) {
                await supabaseAdmin.from('user_parked_vehicles')
                  .update({ is_active: false })
                  .eq('id', vehicle.id);
                console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
              }
            }
          }
        }

      } catch (err) {
        console.error(`Error processing vehicle ${vehicle.id}:`, err);
        results.errors++;
      }
    }

    // Cleanup stale parked vehicles (older than 48 hours)
    // These are likely cars that moved without the app detecting it
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: staleVehicles } = await supabaseAdmin
      .from('user_parked_vehicles')
      .update({ is_active: false })
      .eq('is_active', true)
      .lt('parked_at', cutoffTime)
      .select('id');

    const staleCount = staleVehicles?.length || 0;
    if (staleCount > 0) {
      console.log(`Deactivated ${staleCount} stale parked vehicles (>48 hours old)`);
    }

    console.log('Mobile parking reminders completed:', results);

    return res.status(200).json({
      success: true,
      results: { ...results, staleDeactivated: staleCount },
      timestamp: chicagoTime.toISOString(),
    });

  } catch (error) {
    console.error('Error in mobile-parking-reminders:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
