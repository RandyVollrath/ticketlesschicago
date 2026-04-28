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
import { sendPushNotification, isFirebaseConfigured, cleanupInvalidTokens } from '../../../lib/firebase-admin';
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
  // Meter zone fields
  meter_zone_active: boolean;
  meter_max_time_minutes: number | null;
  meter_schedule_text: string | null;
  meter_was_enforced_at_park_time: boolean | null;
  // Notification tracking
  winter_ban_notified_at: string | null;
  snow_ban_notified_at: string | null;
  street_cleaning_notified_at: string | null;
  permit_zone_notified_at: string | null;
  dot_permit_notified_at: string | null;
  meter_max_notified_at: string | null;
  meter_active_notified_at: string | null;
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

function getChicagoDateString(date: Date): string {
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(date);
  const month = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: '2-digit' }).format(date);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: '2-digit' }).format(date);
  return `${year}-${month}-${day}`;
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

interface ReminderUserProfile {
  user_id: string;
  permit_zone_number: string | null;
  vehicle_zone: string | null;
  push_alert_preferences: Record<string, boolean> | null;
  phone_call_enabled: boolean;
  phone_number: string | null;
  call_alert_preferences: Record<string, CallAlertPref> | null;
}

function isPushAlertEnabled(
  prefs: Record<string, boolean> | null | undefined,
  key: 'street_cleaning' | 'winter_ban' | 'snow_route' | 'permit_zone' | 'dot_permit' | 'meter_max_expiring' | 'meter_zone_active'
): boolean {
  return prefs?.[key] !== false;
}

/**
 * Parse the FIRST enforcement-start hour from a meter schedule_text string,
 * for the current Chicago day-of-week. Returns null if no daytime enforcement
 * applies today.
 *
 * Schedule strings come from parseEnforcementSchedule in metered-parking-checker.ts
 * and look like: "Mon-Sat 8am-10pm", "Mon-Fri 7am-7pm, Sun 10am-8pm", "24/7", etc.
 *
 * For the "becomes active in the morning" notification we only care about the
 * first daytime start (typically 8am or 9am Mon-Sat). 24/7 returns null because
 * there's no overnight free window to wake up from.
 */
function getMeterEnforcementStartTodayLocal(scheduleText: string | null, chicagoTime: Date): Date | null {
  if (!scheduleText) return null;
  const day = chicagoTime.getDay();

  // 24/7 has no morning-activation moment
  if (/^24\/7$/i.test(scheduleText.trim())) return null;

  // Normalize en-dashes to plain hyphens — metered-parking-checker formats
  // schedule strings like "Mon–Sat 8am–10pm" using en-dash, but the existing
  // parseDayRange splits only on '-'. Normalize first so both sides agree.
  const normalized = scheduleText.replace(/–/g, '-');
  const parts = normalized.split(',').map(s => s.trim());
  for (const part of parts) {
    // Skip rush-hour fragments
    if (/^RH/i.test(part)) continue;

    const match = part.match(
      /^(Mon-Sat|Mon-Fri|Mon-Sun|Sat-Sun|Sun|Sat|Fri|Mon|Tue|Wed|Thu)\s+(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)$/i
    );
    if (!match) continue;

    const days = parseDayRange(match[1]);
    if (!days.includes(day)) continue;

    const startTime = parseTimeStr(match[2]);
    if (!startTime) continue;

    // Skip 24-hour wrap-around windows ("12am-12am", "12am-11:59pm") — those
    // already cover the morning and have no overnight free gap.
    const endTime = parseTimeStr(match[3]);
    if (startTime.hours === 0 && startTime.minutes === 0) continue;
    if (endTime && endTime.hours === 0 && startTime.hours === 0) continue;

    const enforcementStart = new Date(chicagoTime);
    enforcementStart.setHours(startTime.hours, startTime.minutes, 0, 0);
    return enforcementStart;
  }
  return null;
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
      .eq('user_id', userId)
      .maybeSingle()).data;

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
  // CRITICAL: Verify cron authorization before processing notifications
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  // Guard: if CRON_SECRET is not set, reject all requests
  const isAuthorized = isVercelCron || (secret ? (authHeader === `Bearer ${secret}`) : false);

  if (!isAuthorized) {
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
  // CRITICAL: Do NOT use toISOString() — it returns UTC, not Chicago time.
  // At 11 PM CT (= 5 AM UTC next day), toISOString() returns tomorrow's date.
  // Use Intl.DateTimeFormat to extract YYYY-MM-DD in Chicago timezone.
  const chicagoYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(chicagoTime);
  const chicagoMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: '2-digit' }).format(chicagoTime);
  const chicagoDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: '2-digit' }).format(chicagoTime);
  const today = `${chicagoYear}-${chicagoMonth}-${chicagoDay}`; // YYYY-MM-DD

  console.log(`Running mobile parking reminders at ${chicagoTime.toISOString()} (Chicago hour: ${chicagoHour})`);

  try {
    const results = {
      winterBanReminders: 0,
      snowRouteReminders: 0,
      streetCleaningReminders: 0,
      permitZoneReminders: 0,
      dotPermitReminders: 0,
      meterMaxReminders: 0,
      meterActiveReminders: 0,
      callAlertsSent: 0,
      errors: 0,
    };

    // Get all active parked vehicles — only select needed columns.
    // Defensive: if the meter notification columns haven't been migrated yet,
    // fall back to the old column set so the existing notifications keep firing.
    // The new meter branches are gated on vehicle.meter_zone_active being true,
    // so they automatically no-op when those fields aren't selected.
    const fullSelect = 'id, user_id, latitude, longitude, fcm_token, address, on_winter_ban_street, on_snow_route, street_cleaning_date, permit_zone, permit_restriction_schedule, parked_at, dot_permit_active, dot_permit_type, dot_permit_start_date, meter_zone_active, meter_max_time_minutes, meter_schedule_text, meter_was_enforced_at_park_time, winter_ban_notified_at, snow_ban_notified_at, street_cleaning_notified_at, permit_zone_notified_at, dot_permit_notified_at, meter_max_notified_at, meter_active_notified_at';
    const fallbackSelect = 'id, user_id, latitude, longitude, fcm_token, address, on_winter_ban_street, on_snow_route, street_cleaning_date, permit_zone, permit_restriction_schedule, parked_at, dot_permit_active, dot_permit_type, dot_permit_start_date, winter_ban_notified_at, snow_ban_notified_at, street_cleaning_notified_at, permit_zone_notified_at, dot_permit_notified_at';

    let parkedVehicles: any[] | null = null;
    {
      const { data, error } = await supabaseAdmin
        .from('user_parked_vehicles')
        .select(fullSelect)
        .eq('is_active', true);
      if (error && /column .* does not exist/i.test(error.message)) {
        console.warn('[mobile-parking-reminders] Meter columns missing — running with fallback SELECT until migration is applied');
        const fb = await supabaseAdmin
          .from('user_parked_vehicles')
          .select(fallbackSelect)
          .eq('is_active', true);
        if (fb.error) {
          console.error('Error fetching parked vehicles (fallback):', fb.error);
          return res.status(500).json({ error: 'Failed to fetch parked vehicles' });
        }
        parkedVehicles = fb.data;
      } else if (error) {
        console.error('Error fetching parked vehicles:', error);
        return res.status(500).json({ error: 'Failed to fetch parked vehicles' });
      } else {
        parkedVehicles = data;
      }
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

    // Pre-fetch snow event ONCE (same for all vehicles, no need to query per-vehicle)
    let activeSnowEvent: { id: string; snow_amount_inches: number | null; is_active: boolean } | null = null;
    const hasSnowRouteVehicles = parkedVehicles.some((v: any) => v.on_snow_route);
    if (hasSnowRouteVehicles) {
      const { data } = await supabaseAdmin
        .from('snow_events')
        .select('id, snow_amount_inches, is_active')
        .eq('is_active', true)
        .order('event_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      activeSnowEvent = data;
    }

    // Pre-fetch user profiles once so push preferences, permit-zone ownership,
    // and call-alert settings all use the same authoritative snapshot.
    const uniqueUserIds = Array.from(new Set(parkedVehicles.map((v: any) => v.user_id)));
    const userProfiles = new Map<string, ReminderUserProfile>();
    if (uniqueUserIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, permit_zone_number, vehicle_zone, push_alert_preferences, phone_call_enabled, phone_number, call_alert_preferences')
        .in('user_id', uniqueUserIds);
      if (profiles) {
        for (const profile of profiles) {
          userProfiles.set(profile.user_id, {
            user_id: profile.user_id,
            permit_zone_number: profile.permit_zone_number,
            vehicle_zone: profile.vehicle_zone,
            push_alert_preferences: (profile.push_alert_preferences as Record<string, boolean> | null) || null,
            phone_call_enabled: !!profile.phone_call_enabled,
            phone_number: profile.phone_number,
            call_alert_preferences: (profile.call_alert_preferences as Record<string, CallAlertPref> | null) || null,
          });
        }
      }
    }

    // Collect invalid FCM tokens for batch cleanup at end
    const invalidFcmTokens: string[] = [];

    for (const vehicle of parkedVehicles as unknown as ParkedVehicle[]) {
      try {
        const userProfile = userProfiles.get(vehicle.user_id);

        // ——————————————————————————————————————————————
        // PUSH NOTIFICATIONS (unchanged timing windows)
        // ——————————————————————————————————————————————

        // Winter ban reminder — send from 8pm through 2am (ban starts at 3am)
        // Wide window catches users who park late at night on winter ban streets.
        // Atomic claim-then-send: conditional UPDATE where flag is still null
        // guarantees no concurrent fire can double-send even on a deployment
        // cutover. If push fails, rollback the flag so the next fire retries.
        const isWinterBanWindow = isWinterSeason && (chicagoHour >= 20 || chicagoHour <= 2);
        if (isWinterBanWindow && vehicle.on_winter_ban_street && !vehicle.winter_ban_notified_at && isPushAlertEnabled(userProfile?.push_alert_preferences, 'winter_ban')) {
          const { data: claimed } = await supabaseAdmin.from('user_parked_vehicles')
            .update({ winter_ban_notified_at: new Date().toISOString() })
            .eq('id', vehicle.id)
            .is('winter_ban_notified_at', null)
            .select('id');
          if (claimed && claimed.length > 0) {
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
              results.winterBanReminders++;
              console.log(`Sent winter ban reminder to ${vehicle.user_id}`);
            } else {
              // Rollback the claim so the next fire retries.
              await supabaseAdmin.from('user_parked_vehicles')
                .update({ winter_ban_notified_at: null })
                .eq('id', vehicle.id);
              if (result.invalidToken) {
                await supabaseAdmin.from('user_parked_vehicles')
                  .update({ is_active: false })
                  .eq('id', vehicle.id);
                invalidFcmTokens.push(vehicle.fcm_token);
                console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
              }
            }
          }
        }

        // Snow route reminder — when user is parked on a 2-inch snow ban street
        // and snow is active or forecasted. This complements mobile-snow-notifications.ts
        // (which is triggered by monitor-snow.ts on weather changes). This cron catches
        // users who PARK on a snow route AFTER the snow event was already detected.
        // Also sends call alerts for snow routes.
        if (vehicle.on_snow_route && !vehicle.snow_ban_notified_at && isPushAlertEnabled(userProfile?.push_alert_preferences, 'snow_route')) {
          if (activeSnowEvent) {
            // Atomic claim — see winter_ban block above for rationale.
            const { data: claimed } = await supabaseAdmin.from('user_parked_vehicles')
              .update({ snow_ban_notified_at: new Date().toISOString() })
              .eq('id', vehicle.id)
              .is('snow_ban_notified_at', null)
              .select('id');
            if (claimed && claimed.length > 0) {
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
                results.snowRouteReminders++;
                console.log(`Sent snow route reminder to ${vehicle.user_id} (${snowAmount}" snow active)`);
              } else {
                await supabaseAdmin.from('user_parked_vehicles')
                  .update({ snow_ban_notified_at: null })
                  .eq('id', vehicle.id);
                if (result.invalidToken) {
                  await supabaseAdmin.from('user_parked_vehicles')
                    .update({ is_active: false })
                    .eq('id', vehicle.id);
                  invalidFcmTokens.push(vehicle.fcm_token);
                  console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
                }
              }
            }
          }
        }

        // Street cleaning reminder - NIGHT BEFORE (8pm check for tomorrow's cleaning)
        // This gives users time to move their car the evening before
        // CRITICAL: Calculate tomorrow's date in Chicago timezone, not UTC
        const tomorrowDate = new Date(chicagoTime);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrowYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(tomorrowDate);
        const tomorrowMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: '2-digit' }).format(tomorrowDate);
        const tomorrowDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: '2-digit' }).format(tomorrowDate);
        const tomorrowStr = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;

        const lastStreetCleaningNotificationDate = vehicle.street_cleaning_notified_at
          ? getChicagoDateString(new Date(vehicle.street_cleaning_notified_at))
          : null;
        const sentStreetCleaningTonight = lastStreetCleaningNotificationDate === today;

        if (
          chicagoHour >= 19 &&
          chicagoHour <= 21 &&
          vehicle.street_cleaning_date === tomorrowStr &&
          !sentStreetCleaningTonight &&
          isPushAlertEnabled(userProfile?.push_alert_preferences, 'street_cleaning')
        ) {
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
            invalidFcmTokens.push(vehicle.fcm_token);
            console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
          }
        }

        // Street cleaning reminder - MORNING OF (7am check, cleaning at 9am)
        // Backup reminder for those who didn't move the night before
        if (
          chicagoHour >= 6 &&
          chicagoHour <= 8 &&
          vehicle.street_cleaning_date === today &&
          !sentStreetCleaningTonight &&
          isPushAlertEnabled(userProfile?.push_alert_preferences, 'street_cleaning')
        ) {
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
            invalidFcmTokens.push(vehicle.fcm_token);
            console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
          }
        }

        // Permit zone reminder — 15 minutes before actual enforcement start
        // Uses the real schedule (e.g., "Mon-Fri 6pm-9:30am") instead of hardcoded 7am/8am
        // Only send once per parking session
        // Skip if user is parked in their own permit zone
        if (vehicle.permit_zone && !vehicle.permit_zone_notified_at && isPushAlertEnabled(userProfile?.push_alert_preferences, 'permit_zone')) {
          const enforcement = getEnforcementStartingSoon(vehicle.permit_restriction_schedule, chicagoTime);

          if (enforcement) {
            // Check if user has a permit for this zone (using pre-fetched profiles)
            let isOwnZone = false;
            if (userProfile) {
              const homeZone = (userProfile.permit_zone_number || userProfile.vehicle_zone || '').toString().trim().toLowerCase().replace(/^zone\s*/i, '');
              const parkedZone = (vehicle.permit_zone || '').trim().toLowerCase().replace(/^zone\s*/i, '');

              if (homeZone && parkedZone && homeZone === parkedZone) {
                isOwnZone = true;
                console.log(`Skipping permit zone notification for ${vehicle.user_id} — parked in own zone (${vehicle.permit_zone})`);
              }
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
                invalidFcmTokens.push(vehicle.fcm_token);
                console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
              }
            }
          }
        }

        // DOT permit reminder — night before (8-9pm) and morning of (6-8am)
        // Only send once per parking session
        if (vehicle.dot_permit_active && !vehicle.dot_permit_notified_at && isPushAlertEnabled(userProfile?.push_alert_preferences, 'dot_permit')) {
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
              invalidFcmTokens.push(vehicle.fcm_token);
              console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
            }
          }
        }

        // ——————————————————————————————————————————————
        // METER ZONE: max-time expiring
        // ——————————————————————————————————————————————
        // Fire ~15 minutes before parked_at + max_time_minutes, but ONLY while
        // the meter zone is currently enforced. We don't know how long the user
        // actually paid for, so we use the zone's max time as a conservative
        // upper bound. If the meter is unenforced when this would fire (e.g.
        // user parked at 9pm Sat with 2hr max → would fire at 10:45pm, but
        // enforcement ends at 10pm) we skip it.
        if (
          vehicle.meter_zone_active &&
          vehicle.meter_max_time_minutes &&
          vehicle.meter_max_time_minutes > 0 &&
          vehicle.meter_was_enforced_at_park_time === true &&
          !vehicle.meter_max_notified_at &&
          isPushAlertEnabled(userProfile?.push_alert_preferences, 'meter_max_expiring')
        ) {
          const parkedAtMs = new Date(vehicle.parked_at).getTime();
          const expiresAtMs = parkedAtMs + vehicle.meter_max_time_minutes * 60 * 1000;
          const fireAtMs = expiresAtMs - 30 * 60 * 1000;
          const nowMs = chicagoTime.getTime();
          // Cron runs every 15 min, so fire any time between 30-min-before and
          // 5-min-after the expiry so the user has lead time to walk back to
          // the car and we still catch sessions whose cron tick lands late.
          const inWindow = nowMs >= fireAtMs && nowMs <= expiresAtMs + 5 * 60 * 1000;

          // Re-check enforcement using stored schedule text
          const stillEnforced = (() => {
            if (!vehicle.meter_schedule_text) return true; // unknown — assume yes
            // For simple schedules, peek at today's first window:
            const todayStart = getMeterEnforcementStartTodayLocal(vehicle.meter_schedule_text, chicagoTime);
            if (!todayStart) return true; // 24/7 or no parseable window — trust the snapshot
            // We need an end time too. Quick re-parse for end:
            const m = vehicle.meter_schedule_text.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
            if (!m) return true;
            const endTime = parseTimeStr(m[2]);
            if (!endTime) return true;
            const todayEnd = new Date(chicagoTime);
            todayEnd.setHours(endTime.hours, endTime.minutes, 0, 0);
            return chicagoTime >= todayStart && chicagoTime < todayEnd;
          })();

          if (inWindow && stillEnforced) {
            const result = await sendPushNotification(vehicle.fcm_token, {
              title: 'Meter Expiring Soon',
              body: `Your meter at ${vehicle.address} hits its ${vehicle.meter_max_time_minutes / 60}-hour max in 30 min. Head back to your car or feed the meter to avoid a $50 ticket.`,
              data: {
                type: 'meter_max_expiring',
                lat: vehicle.latitude?.toString(),
                lng: vehicle.longitude?.toString(),
              },
            });
            if (result.success) {
              await supabaseAdmin.from('user_parked_vehicles')
                .update({ meter_max_notified_at: new Date().toISOString() } as any)
                .eq('id', vehicle.id);
              results.meterMaxReminders++;
              console.log(`Sent meter max-time reminder to ${vehicle.user_id}`);
            } else if (result.invalidToken) {
              await supabaseAdmin.from('user_parked_vehicles')
                .update({ is_active: false })
                .eq('id', vehicle.id);
              invalidFcmTokens.push(vehicle.fcm_token);
            }
          }
        }

        // ——————————————————————————————————————————————
        // METER ZONE: zone activates this morning
        // ——————————————————————————————————————————————
        // For users who parked overnight while the meter zone was unenforced
        // (free overnight parking), notify ~30 min before today's enforcement
        // start so they have time to move. Only one shot per session.
        if (
          vehicle.meter_zone_active &&
          vehicle.meter_was_enforced_at_park_time === false &&
          !vehicle.meter_active_notified_at &&
          isPushAlertEnabled(userProfile?.push_alert_preferences, 'meter_zone_active')
        ) {
          const enforcementStart = getMeterEnforcementStartTodayLocal(vehicle.meter_schedule_text, chicagoTime);
          if (enforcementStart) {
            const fireAtMs = enforcementStart.getTime() - 30 * 60 * 1000;
            const nowMs = chicagoTime.getTime();
            // 15-min cron window — fire if within ±7.5 min of fireAt
            if (Math.abs(nowMs - fireAtMs) <= 7.5 * 60 * 1000) {
              const startStr = enforcementStart.toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago'
              });
              const result = await sendPushNotification(vehicle.fcm_token, {
                title: 'Meter Zone Activates Soon',
                body: `Meters at ${vehicle.address} start enforcing at ${startStr}. Pay the meter or move to avoid a $50 ticket.`,
                data: {
                  type: 'meter_zone_active',
                  lat: vehicle.latitude?.toString(),
                  lng: vehicle.longitude?.toString(),
                },
              });
              if (result.success) {
                await supabaseAdmin.from('user_parked_vehicles')
                  .update({ meter_active_notified_at: new Date().toISOString() } as any)
                  .eq('id', vehicle.id);
                results.meterActiveReminders++;
                console.log(`Sent meter activation reminder to ${vehicle.user_id}`);
              } else if (result.invalidToken) {
                await supabaseAdmin.from('user_parked_vehicles')
                  .update({ is_active: false })
                  .eq('id', vehicle.id);
                invalidFcmTokens.push(vehicle.fcm_token);
              }
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
            chicagoTime,
            userProfile ? {
              phone_call_enabled: userProfile.phone_call_enabled,
              phone_number: userProfile.phone_number,
              call_alert_preferences: userProfile.call_alert_preferences,
            } : undefined
          );
          if (callSent) results.callAlertsSent++;
        }

        // Street cleaning: enforcement at 9am on cleaning date
        if (vehicle.street_cleaning_date) {
          const cleaningDate = vehicle.street_cleaning_date; // YYYY-MM-DD
          const isCleaningToday = cleaningDate === today;
          const isCleaningTomorrow = cleaningDate === tomorrowStr;

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
              chicagoTime,
              userProfile ? {
                phone_call_enabled: userProfile.phone_call_enabled,
                phone_number: userProfile.phone_number,
                call_alert_preferences: userProfile.call_alert_preferences,
              } : undefined
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
              chicagoTime,
              userProfile ? {
                phone_call_enabled: userProfile.phone_call_enabled,
                phone_number: userProfile.phone_number,
                call_alert_preferences: userProfile.call_alert_preferences,
              } : undefined
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
              chicagoTime,
              userProfile ? {
                phone_call_enabled: userProfile.phone_call_enabled,
                phone_number: userProfile.phone_number,
                call_alert_preferences: userProfile.call_alert_preferences,
              } : undefined
            );
            if (callSent) results.callAlertsSent++;
          }
        }

        // Snow route: call alert when snow ban is active (no fixed enforcement time,
        // so pass null — only fires for users with hours_before === 0 aka "immediately")
        if (vehicle.on_snow_route) {
          // Use pre-fetched snow event (queried once before the loop)
          if (activeSnowEvent) {
            const snowAmt = activeSnowEvent.snow_amount_inches || 2;
            const callSent = await sendCallAlertIfEnabled(
              vehicle.user_id, vehicle.id, 'snow_route',
              `${snowAmt} inches of snow detected. Your car at ${vehicle.address} is on a snow route and may be towed. Move your car now.`,
              vehicle.address,
              null, // No fixed enforcement time for snow bans
              chicagoTime,
              userProfile ? {
                phone_call_enabled: userProfile.phone_call_enabled,
                phone_number: userProfile.phone_number,
                call_alert_preferences: userProfile.call_alert_preferences,
              } : undefined
            );
            if (callSent) results.callAlertsSent++;
          }
        }

      } catch (err) {
        console.error(`Error processing vehicle ${vehicle.id}:`, err);
        results.errors++;
      }
    }

    // Batch cleanup invalid FCM tokens in push_tokens table
    if (invalidFcmTokens.length > 0) {
      await cleanupInvalidTokens(supabaseAdmin, invalidFcmTokens);
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
