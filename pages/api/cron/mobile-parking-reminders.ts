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
import { sendClickSendVoiceCall } from '../../../lib/sms-service';

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
  // DOT permit fields
  dot_permit_active: boolean;
  dot_permit_type: string | null;
  dot_permit_start_date: string | null;
  // Notification tracking
  winter_ban_notified_at: string | null;
  snow_ban_notified_at: string | null;
  street_cleaning_notified_at: string | null;
  permit_zone_notified_at: string | null;
  dot_permit_notified_at: string | null;
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

/** Map rule type aliases to the 5 canonical call alert preference keys. */
function mapAlertTypeToCallKey(alertType: string): string | null {
  const mapping: Record<string, string> = {
    street_cleaning: 'street_cleaning',
    winter_ban: 'winter_ban',
    winter_overnight_ban: 'winter_ban',
    permit_zone: 'permit_zone',
    snow_route: 'snow_route',
    snow_ban: 'snow_route',
    two_inch_snow_ban: 'snow_route',
    dot_permit: 'dot_permit',
  };
  return mapping[alertType] || null;
}

interface CallAlertPref {
  enabled: boolean;
  hours_before: number;
}

/**
 * Check if now is the right time to place a call for this alert type,
 * given the user's hours_before preference and the enforcement start time.
 *
 * @param hoursBefore - User's preferred hours before enforcement to be called
 * @param enforcementTime - When enforcement starts (Chicago time Date)
 * @param chicagoNow - Current Chicago time
 * @returns true if current time is within a 15-minute window of (enforcementTime - hoursBefore)
 */
function isCallTimeWindow(
  hoursBefore: number,
  enforcementTime: Date,
  chicagoNow: Date
): boolean {
  if (hoursBefore === 0) {
    // "Immediately" — call alongside the push notification (caller decides when)
    return true;
  }
  const callTargetMs = enforcementTime.getTime() - hoursBefore * 60 * 60 * 1000;
  const nowMs = chicagoNow.getTime();
  const diffMs = nowMs - callTargetMs;
  // Call if we're within ±7.5 minutes of the target call time (centered window)
  // The cron runs every 15 minutes, so this catches the right window whether
  // the cron fires slightly before or after the target time
  return Math.abs(diffMs) <= 7.5 * 60 * 1000;
}

/**
 * Send a voice call alert for a parking restriction, if the user has it enabled
 * and the timing is right based on their hours_before preference.
 *
 * @param userId - User ID
 * @param parkingSessionId - Parking session ID (for rate limiting)
 * @param alertType - Alert type key (e.g., 'winter_ban', 'street_cleaning')
 * @param message - Voice message to speak
 * @param address - Parking address
 * @param enforcementTime - When enforcement starts (for hours_before timing). If null, only fires for hours_before === 0.
 * @param chicagoNow - Current Chicago time
 * @param cachedProfile - Optional pre-fetched profile to avoid redundant DB queries within the same vehicle loop
 */
async function sendCallAlertIfEnabled(
  userId: string,
  parkingSessionId: string,
  alertType: string,
  message: string,
  address: string,
  enforcementTime: Date | null,
  chicagoNow: Date,
  cachedProfile?: { phone_call_enabled: boolean; phone_number: string | null; call_alert_preferences: Record<string, CallAlertPref> | null } | null
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  try {
    // Fetch profile if not cached
    const profile = cachedProfile ?? (await supabaseAdmin
      .from('user_profiles')
      .select('phone_call_enabled, phone_number, call_alert_preferences')
      .eq('id', userId)
      .single()).data;

    if (!profile?.phone_call_enabled || !profile?.phone_number) return false;

    // Check per-type preference
    const callKey = mapAlertTypeToCallKey(alertType);
    if (!callKey) return false;

    const prefs = (profile.call_alert_preferences as Record<string, CallAlertPref>) || {};
    const typePref = prefs[callKey];
    if (!typePref?.enabled) {
      return false;
    }

    // Check timing: is now the right time to call based on hours_before?
    if (enforcementTime) {
      if (!isCallTimeWindow(typePref.hours_before, enforcementTime, chicagoNow)) {
        return false;
      }
    } else {
      // No enforcement time known — only fire for "immediately" (hours_before === 0)
      if (typePref.hours_before !== 0) return false;
    }

    // Rate limit: check if we already called for this parking session + alert type
    const { data: existingCall } = await supabaseAdmin
      .from('parking_call_alerts')
      .select('id')
      .eq('user_id', userId)
      .eq('parking_session_id', parkingSessionId)
      .eq('alert_type', alertType)
      .limit(1)
      .maybeSingle();

    if (existingCall) {
      console.log(`Skipping cron call alert for user ${userId} — already called for session ${parkingSessionId} type ${alertType}`);
      return false;
    }

    // Rate limit: no more than 1 call per hour per user
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentCalls } = await supabaseAdmin
      .from('parking_call_alerts')
      .select('id')
      .eq('user_id', userId)
      .gte('called_at', oneHourAgo)
      .limit(1);

    if (recentCalls && recentCalls.length > 0) {
      console.log(`Skipping cron call alert for user ${userId} — already called within the last hour`);
      return false;
    }

    // Place the call
    const voiceMessage = `Autopilot parking alert. ${message}. This is an automated call from Autopilot America.`;
    console.log(`Cron: Placing call alert to ${profile.phone_number} for user ${userId}: ${alertType} (hours_before=${typePref.hours_before})`);
    const callResult = await sendClickSendVoiceCall(profile.phone_number, voiceMessage);

    // Log the call attempt
    await supabaseAdmin
      .from('parking_call_alerts')
      .insert({
        user_id: userId,
        phone_number: profile.phone_number,
        alert_type: alertType,
        message: voiceMessage,
        address: address || null,
        parking_session_id: parkingSessionId,
        success: callResult.success,
        error: callResult.error || null,
      })
      .then(r => {
        if (r.error) console.error('Failed to log cron call alert:', r.error);
      });

    if (callResult.success) {
      console.log(`Cron: Call alert sent successfully to ${profile.phone_number}`);
    } else {
      console.error(`Cron: Call alert failed for user ${userId}:`, callResult.error);
    }

    return callResult.success;
  } catch (error) {
    console.error(`Cron: Error sending call alert for user ${userId}:`, error);
    return false;
  }
}

/**
 * Check if enforcement starts within the next 30 minutes for this vehicle.
 * Returns the enforcement start time if a notification should be sent now, null otherwise.
 * Handles schedules like "Mon-Fri 6pm-9:30am", "Mon-Fri 8am-6pm", etc.
 */
function getEnforcementStartingSoon(schedule: string | null, chicagoTime: Date): { enforcementStart: Date; enforcementTimeStr: string } | null {
  if (!schedule) {
    // No verified hours for this zone — cannot determine enforcement timing.
    // Never assume default hours.
    return null;
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
      snowRouteReminders: 0,
      streetCleaningReminders: 0,
      permitZoneReminders: 0,
      dotPermitReminders: 0,
      callAlertsSent: 0,
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
        // ——————————————————————————————————————————————
        // PUSH NOTIFICATIONS (unchanged timing windows)
        // ——————————————————————————————————————————————

        // Winter ban reminder — send from 8pm through 2am (ban starts at 3am)
        // Wide window catches users who park late at night on winter ban streets.
        // Only send once per parking session (tracked by winter_ban_notified_at).
        const isWinterBanWindow = isWinterSeason && (chicagoHour >= 20 || chicagoHour <= 2);
        if (isWinterBanWindow && vehicle.on_winter_ban_street && !vehicle.winter_ban_notified_at) {
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

        // Snow route reminder — when user is parked on a 2-inch snow ban street
        // and snow is active or forecasted. This complements mobile-snow-notifications.ts
        // (which is triggered by monitor-snow.ts on weather changes). This cron catches
        // users who PARK on a snow route AFTER the snow event was already detected.
        // Also sends call alerts for snow routes.
        if (vehicle.on_snow_route && !vehicle.snow_ban_notified_at) {
          // Check if there's an active snow event
          const { data: activeSnowEvent } = await supabaseAdmin
            .from('snow_events')
            .select('id, snow_amount_inches, is_active')
            .eq('is_active', true)
            .order('event_date', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (activeSnowEvent) {
            const snowAmount = activeSnowEvent.snow_amount_inches || 2;
            const result = await sendPushNotification(vehicle.fcm_token, {
              title: '2-Inch Snow Ban — Move Your Car!',
              body: `${snowAmount}" of snow detected. Your car at ${vehicle.address} is on a snow route and may be towed ($150+). Move now!`,
              data: {
                type: 'snow_ban_reminder',
                lat: vehicle.latitude?.toString(),
                lng: vehicle.longitude?.toString(),
              },
            });
            if (result.success) {
              await supabaseAdmin.from('user_parked_vehicles')
                .update({ snow_ban_notified_at: new Date().toISOString() })
                .eq('id', vehicle.id);
              results.snowRouteReminders++;
              console.log(`Sent snow route reminder to ${vehicle.user_id} (${snowAmount}" snow active)`);
            } else if (result.invalidToken) {
              await supabaseAdmin.from('user_parked_vehicles')
                .update({ is_active: false })
                .eq('id', vehicle.id);
              console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
            }
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
            body: `Street cleaning scheduled tomorrow at ${vehicle.address}. Consider moving your car tonight to avoid a $60 ticket.`,
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
            body: `Street cleaning starts at 9am at ${vehicle.address}. Move your car NOW to avoid a $60 ticket.`,
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

        // DOT permit reminder — night before (8-9pm) and morning of (6-8am)
        // Only send once per parking session
        if (vehicle.dot_permit_active && !vehicle.dot_permit_notified_at) {
          const permitStartDate = vehicle.dot_permit_start_date;
          const permitType = vehicle.dot_permit_type || 'Street permit';

          let shouldNotify = false;
          let notifTitle = '';
          let notifBody = '';

          if (permitStartDate) {
            const isPermitTomorrow = permitStartDate === tomorrowStr;
            const isPermitToday = permitStartDate === today;

            if (chicagoHour >= 19 && chicagoHour <= 21 && isPermitTomorrow) {
              // Night before notification
              shouldNotify = true;
              notifTitle = `${permitType} Tomorrow on Your Block`;
              notifBody = `A ${permitType.toLowerCase()} permit starts tomorrow at ${vehicle.address}. Consider moving your car tonight to avoid towing.`;
            } else if (chicagoHour >= 6 && chicagoHour <= 8 && isPermitToday) {
              // Morning of notification
              shouldNotify = true;
              notifTitle = `${permitType} Active Today - Move Now!`;
              notifBody = `A ${permitType.toLowerCase()} permit is active today at ${vehicle.address}. Move your car NOW to avoid towing.`;
            }
          } else {
            // No specific start date — permit was already active when user parked
            // Send one notification during morning hours
            if (chicagoHour >= 6 && chicagoHour <= 8) {
              shouldNotify = true;
              notifTitle = `${permitType} Active on Your Block`;
              notifBody = `A ${permitType.toLowerCase()} permit is active at ${vehicle.address}. Check posted signs — risk of towing.`;
            }
          }

          if (shouldNotify) {
            const result = await sendPushNotification(vehicle.fcm_token, {
              title: notifTitle,
              body: notifBody,
              data: {
                type: 'dot_permit_reminder',
                lat: vehicle.latitude?.toString(),
                lng: vehicle.longitude?.toString(),
              },
            });
            if (result.success) {
              await supabaseAdmin.from('user_parked_vehicles')
                .update({ dot_permit_notified_at: new Date().toISOString() })
                .eq('id', vehicle.id);
              results.dotPermitReminders++;
              console.log(`Sent DOT permit reminder to ${vehicle.user_id} (${permitType})`);
            } else if (result.invalidToken) {
              await supabaseAdmin.from('user_parked_vehicles')
                .update({ is_active: false })
                .eq('id', vehicle.id);
              console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
            }
          }
        }

        // ——————————————————————————————————————————————
        // CALL ALERTS (independent timing based on hours_before)
        // ——————————————————————————————————————————————
        // Calls run on their own schedule, decoupled from push notifications.
        // sendCallAlertIfEnabled checks per-type enabled flag, hours_before timing,
        // and rate limits (1 per session per type, 1 per hour per user).

        // Build enforcement times for each alert type
        // Winter ban: enforcement at 3am tomorrow (if evening) or 3am today (if after midnight)
        if (isWinterSeason && vehicle.on_winter_ban_street) {
          const winterEnforcement = new Date(chicagoTime);
          if (chicagoHour >= 12) {
            // Evening — enforcement is 3am tomorrow
            winterEnforcement.setDate(winterEnforcement.getDate() + 1);
          }
          winterEnforcement.setHours(3, 0, 0, 0);

          const callSent = await sendCallAlertIfEnabled(
            vehicle.user_id, vehicle.id, 'winter_ban',
            `Your car at ${vehicle.address} is on a winter ban street. Move before 3 AM to avoid towing.`,
            vehicle.address,
            winterEnforcement,
            chicagoTime
          );
          if (callSent) results.callAlertsSent++;
        }

        // Street cleaning: enforcement at 9am on cleaning date
        if (vehicle.street_cleaning_date) {
          const cleaningDate = vehicle.street_cleaning_date; // YYYY-MM-DD
          const isCleaningToday = cleaningDate === today;
          const isCleaningTomorrow = cleaningDate === (tomorrow ? tomorrowStr : '');

          if (isCleaningToday || isCleaningTomorrow) {
            const cleaningEnforcement = new Date(chicagoTime);
            if (isCleaningTomorrow) {
              cleaningEnforcement.setDate(cleaningEnforcement.getDate() + 1);
            }
            cleaningEnforcement.setHours(9, 0, 0, 0);

            const callSent = await sendCallAlertIfEnabled(
              vehicle.user_id, vehicle.id, 'street_cleaning',
              isCleaningToday
                ? `Street cleaning starts at 9 AM at ${vehicle.address}. Move your car now to avoid a 65 dollar ticket.`
                : `Street cleaning is scheduled tomorrow at ${vehicle.address}. Move your car to avoid a 65 dollar ticket.`,
              vehicle.address,
              cleaningEnforcement,
              chicagoTime
            );
            if (callSent) results.callAlertsSent++;
          }
        }

        // Permit zone: use enforcement start time from schedule
        if (vehicle.permit_zone) {
          const enforcement = getEnforcementStartingSoon(vehicle.permit_restriction_schedule, chicagoTime);
          if (enforcement) {
            const callSent = await sendCallAlertIfEnabled(
              vehicle.user_id, vehicle.id, 'permit_zone',
              `Your car at ${vehicle.address} is in ${vehicle.permit_zone}. Permit rules are about to start. Check posted signs to avoid a 75 dollar ticket.`,
              vehicle.address,
              enforcement.enforcementStart,
              chicagoTime
            );
            if (callSent) results.callAlertsSent++;
          }
        }

        // DOT permit: enforcement at 7am on permit date (typical construction start)
        if (vehicle.dot_permit_active) {
          const permitStartDate = vehicle.dot_permit_start_date;
          const permitType = vehicle.dot_permit_type || 'Street permit';

          let dotEnforcement: Date | null = null;
          if (permitStartDate) {
            const isPermitToday = permitStartDate === today;
            const isPermitTomorrow = permitStartDate === tomorrowStr;
            if (isPermitToday || isPermitTomorrow) {
              dotEnforcement = new Date(chicagoTime);
              if (isPermitTomorrow) {
                dotEnforcement.setDate(dotEnforcement.getDate() + 1);
              }
              dotEnforcement.setHours(7, 0, 0, 0); // Typical construction start
            }
          }

          if (dotEnforcement) {
            const callSent = await sendCallAlertIfEnabled(
              vehicle.user_id, vehicle.id, 'dot_permit',
              `A ${permitType.toLowerCase()} permit is active at ${vehicle.address}. Move your car to avoid towing.`,
              vehicle.address,
              dotEnforcement,
              chicagoTime
            );
            if (callSent) results.callAlertsSent++;
          }
        }

        // Snow route: call alert when snow ban is active (no fixed enforcement time,
        // so pass null — only fires for users with hours_before === 0 aka "immediately")
        if (vehicle.on_snow_route) {
          // Reuse the snow event query result if we already checked above, or check now
          const { data: snowEventForCall } = await supabaseAdmin
            .from('snow_events')
            .select('id, snow_amount_inches, is_active')
            .eq('is_active', true)
            .order('event_date', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (snowEventForCall) {
            const snowAmt = snowEventForCall.snow_amount_inches || 2;
            const callSent = await sendCallAlertIfEnabled(
              vehicle.user_id, vehicle.id, 'snow_route',
              `${snowAmt} inches of snow detected. Your car at ${vehicle.address} is on a snow route and may be towed. Move your car now.`,
              vehicle.address,
              null, // No fixed enforcement time for snow bans
              chicagoTime
            );
            if (callSent) results.callAlertsSent++;
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
