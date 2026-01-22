/**
 * Mobile Parking Reminders Cron Job
 *
 * Sends follow-up push notifications to mobile app users who are parked
 * in restricted zones before restrictions take effect.
 *
 * Runs at:
 * - 5am CT: Permit zone reminders (most zones start at 6am)
 * - 7am CT: Street cleaning reminders (cleaning starts at 9am)
 * - 9pm CT: Winter ban reminders (ban starts at 3am)
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
 * Parse permit restriction schedule to get start hour
 * Examples: "Mon-Fri 6am-6pm" -> 6, "Mon-Fri 8am-6pm" -> 8
 */
function getPermitRestrictionStartHour(schedule: string | null): number | null {
  if (!schedule) return null;

  // Match patterns like "6am", "8am", "6:00am"
  const match = schedule.match(/(\d{1,2})(?::\d{2})?\s*am/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Check if today is a weekday (permit zones typically Mon-Fri)
 */
function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
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

        // Permit zone reminder (5-6am check, most zones start at 6am)
        // Only on weekdays since most permit zones are Mon-Fri
        // Only send once per parking session
        if (chicagoHour >= 5 && chicagoHour <= 6 && vehicle.permit_zone && isWeekday(chicagoTime) && !vehicle.permit_zone_notified_at) {
          const restrictionStartHour = getPermitRestrictionStartHour(vehicle.permit_restriction_schedule);

          // Send reminder if restriction starts within the next 1-2 hours
          if (restrictionStartHour && chicagoHour < restrictionStartHour && (restrictionStartHour - chicagoHour) <= 2) {
            const result = await sendPushNotification(vehicle.fcm_token, {
              title: 'Permit Zone Reminder',
              body: `Your car at ${vehicle.address} is in ${vehicle.permit_zone}. Permit required starting at ${restrictionStartHour}am. Move now or risk a $65 ticket.`,
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

