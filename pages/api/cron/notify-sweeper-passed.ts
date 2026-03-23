/**
 * Sweeper Passed Notification Cron Job
 *
 * Checks if the city's street sweeper has passed blocks where users are parked
 * with active street cleaning restrictions TODAY. If the sweeper has passed,
 * sends a push notification: "Sweeper passed your block — you can move your car back."
 *
 * Architecture (batched for scale):
 *   1. Query user_parked_vehicles for cars with street_cleaning_date = today
 *   2. Resolve each unique address → TransID (city street segment ID), with caching
 *   3. Check each unique TransID for sweeper activity — ONE API call per segment
 *   4. Fan out results: send push notification to every vehicle on swept segments
 *
 * Scale characteristics:
 *   With 1000 vehicles on 200 unique blocks, this makes ~200 TransLegend + ~200 SweepTracker
 *   calls instead of 2000-3000 (the old per-vehicle approach). Vehicles on the same block
 *   share a single set of API calls.
 *
 * Cron schedule: every 15 min, 9am-3pm CT, Apr-Nov, weekdays (via vercel.json)
 *
 * Deduplication (belt-and-suspenders):
 *   - Column-based: sweeper_passed_notified_at on user_parked_vehicles (fast DB filter)
 *   - Log-based: notification_logs with category='sweeper_passed' (definitive check)
 *
 * Reliability features:
 *   - FCM token freshness: looks up latest token from push_tokens table (not just
 *     the snapshot stored at parking time, which can go stale after hours)
 *   - Timeout starvation prevention: segments are shuffled each run so different
 *     blocks get checked if the cron times out partway through
 *   - Invalid token cleanup: deactivates stale tokens in both user_parked_vehicles
 *     and push_tokens when Firebase reports them as unregistered
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getChicagoTime, getChicagoDateISO } from '../../../lib/chicago-timezone-utils';
import { sendPushNotification, isFirebaseConfigured } from '../../../lib/firebase-admin';
import { lookupTransId, getSweeperHistory } from '../../../lib/sweeper-tracker';
import type { SweeperVisit } from '../../../lib/sweeper-tracker';

interface ParkedVehicle {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  fcm_token: string;
  address: string;
  street_cleaning_date: string | null;
  sweeper_passed_notified_at?: string | null;
}

/**
 * Look up the freshest active FCM token for a user from the push_tokens table.
 * The token stored on user_parked_vehicles is a snapshot from parking time and
 * can go stale if Firebase rotates it hours later before the sweeper cron runs.
 * Falls back to the stale vehicle token if push_tokens has nothing.
 */
async function getFreshFcmToken(userId: string, staleFallback: string): Promise<string> {
  if (!supabaseAdmin) return staleFallback;
  try {
    const { data, error } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('last_used_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return staleFallback;
    return data[0].token || staleFallback;
  } catch {
    // Table might not exist yet or be empty — use the vehicle's token
    return staleFallback;
  }
}

/**
 * Fisher-Yates shuffle — randomize array in-place.
 * Used to prevent timeout starvation: if the cron times out partway through,
 * different segments get checked on each run instead of always the same ones.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Sweeper check result for a street segment */
interface SegmentSweeperResult {
  passed: boolean;
  passTime: string | null;     // Chicago local time (e.g. "10:28 AM")
  segment: string | null;      // e.g. "N SHEFFIELD AVE (2300-2358)"
  vehicleId: string | null;    // City sweeper truck ID
}

/** Chicago timezone for date comparisons */
const CHICAGO_TZ = 'America/Chicago';

/**
 * Check notification_logs to see if we already sent a sweeper_passed notification
 * for this parking session (vehicle.id).
 *
 * IMPORTANT: On query errors (table doesn't exist, DB timeout, etc.) returns true
 * (assume notified) to prevent spamming users. This is the safe default — missing
 * a notification is better than sending duplicates.
 */
async function alreadyNotified(vehicleId: string): Promise<boolean> {
  if (!supabaseAdmin) return true; // Can't check → assume notified (safe default)
  try {
    const { count, error } = await supabaseAdmin
      .from('notification_logs')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'sweeper_passed')
      .eq('external_id', vehicleId);
    if (error) {
      // Table might not exist yet — log and fail safe (don't send duplicate)
      console.error(`[sweeper-notify] alreadyNotified query error:`, error.message);
      return true;
    }
    return (count ?? 0) > 0;
  } catch (err) {
    console.error(`[sweeper-notify] alreadyNotified exception:`, err);
    return true; // Fail safe — assume notified
  }
}

/**
 * Log the notification to notification_logs for dedup and audit trail.
 * Returns true if logged successfully, false if the log failed (e.g. table missing).
 */
async function logNotification(
  userId: string,
  vehicleId: string,
  address: string,
  passTime: string | null,
  status: 'sent' | 'failed'
): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { error } = await supabaseAdmin
      .from('notification_logs')
      .insert({
        user_id: userId,
        notification_type: 'push',
        category: 'sweeper_passed',
        subject: 'Sweeper Passed Your Block',
        content_preview: `Sweeper passed ${address} at ${passTime || 'unknown time'}`,
        status,
        external_id: vehicleId,
        metadata: { address, passTime, vehicleId },
      });
    if (error) {
      console.error(`[sweeper-notify] logNotification error: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[sweeper-notify] logNotification exception:', err);
    return false;
  }
}

/**
 * Format an address for a user-facing push notification.
 * "2317 N Sheffield Ave, Chicago, IL 60614" → "2317 N Sheffield Ave"
 * Strips city/state/zip but keeps the street address readable.
 */
function formatAddressForNotification(address: string): string {
  // Strip everything after the first comma (city, state, zip)
  const streetPart = address.split(',')[0].trim();
  return streetPart || address;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Auth: Vercel cron header OR CRON_SECRET (Bearer or query param)
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  // Guard: if CRON_SECRET is not set, only allow Vercel's cron header.
  // Without this, undefined === undefined would bypass auth.
  const isAuthorized = secret
    ? (authHeader === `Bearer ${secret}` || keyParam === secret)
    : false;

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  const chicagoTime = getChicagoTime();
  const chicagoHour = chicagoTime.getHours();
  const chicagoMonth = chicagoTime.getMonth() + 1; // 1-indexed
  const chicagoDay = chicagoTime.getDay(); // 0=Sun, 6=Sat
  // CRITICAL: Do NOT use chicagoTime.toISOString() — it returns UTC, not Chicago.
  // At 11 PM CT (= 5 AM UTC next day), .toISOString() returns tomorrow's date.
  const today = getChicagoDateISO(); // Correctly extracts YYYY-MM-DD from Chicago-adjusted Date

  console.log(`[sweeper-notify] Running at ${chicagoTime.toISOString()} (Chicago hour: ${chicagoHour}, month: ${chicagoMonth})`);

  // Guard 1: Sweeper season is April (4) through November (11)
  if (chicagoMonth < 4 || chicagoMonth > 11) {
    console.log('[sweeper-notify] Outside sweeper season (Apr-Nov). Skipping.');
    return res.status(200).json({ success: true, message: 'Outside sweeper season', results: {} });
  }

  // Guard 2: Sweepers operate roughly 9am-2pm weekdays. Check 9am-3pm for stragglers.
  if (chicagoHour < 9 || chicagoHour > 15) {
    console.log(`[sweeper-notify] Outside sweeper hours (9am-3pm). Hour: ${chicagoHour}. Skipping.`);
    return res.status(200).json({ success: true, message: 'Outside sweeper operating hours', results: {} });
  }

  // Guard 3: Sweepers only operate on weekdays (Mon-Fri)
  if (chicagoDay === 0 || chicagoDay === 6) {
    console.log('[sweeper-notify] Weekend — no street sweeping. Skipping.');
    return res.status(200).json({ success: true, message: 'Weekend', results: {} });
  }

  // Fail early if Firebase isn't configured — no point checking sweeper API
  // for 200 segments if we can't send any notifications.
  if (!isFirebaseConfigured()) {
    console.error('[sweeper-notify] Firebase Admin not configured — aborting');
    return res.status(500).json({ error: 'Firebase not configured' });
  }

  const results = {
    vehiclesTotal: 0,
    vehiclesEligible: 0,
    uniqueSegments: 0,
    segmentsSwept: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
    notificationsFailed: 0,
    apiErrors: 0,
  };

  try {
    // ─── Step 1: Get all active parked vehicles with street cleaning TODAY ───
    let parkedVehicles: ParkedVehicle[] | null = null;
    let hasDedupColumn = true;

    const { data, error } = await supabaseAdmin
      .from('user_parked_vehicles')
      .select('id, user_id, latitude, longitude, fcm_token, address, street_cleaning_date, sweeper_passed_notified_at')
      .eq('is_active', true)
      .eq('street_cleaning_date', today);

    if (error) {
      // If the column doesn't exist, retry without it
      if (error.message?.includes('sweeper_passed_notified_at')) {
        console.log('[sweeper-notify] sweeper_passed_notified_at column not found, querying without it');
        hasDedupColumn = false;
        const { data: data2, error: err2 } = await supabaseAdmin
          .from('user_parked_vehicles')
          .select('id, user_id, latitude, longitude, fcm_token, address, street_cleaning_date')
          .eq('is_active', true)
          .eq('street_cleaning_date', today);

        if (err2) {
          console.error('[sweeper-notify] Error fetching parked vehicles:', err2);
          return res.status(500).json({ error: 'Failed to fetch parked vehicles' });
        }
        parkedVehicles = (data2 || []) as ParkedVehicle[];
      } else {
        console.error('[sweeper-notify] Error fetching parked vehicles:', error);
        return res.status(500).json({ error: 'Failed to fetch parked vehicles' });
      }
    } else {
      parkedVehicles = (data || []) as ParkedVehicle[];
    }

    results.vehiclesTotal = parkedVehicles?.length || 0;

    if (!parkedVehicles || parkedVehicles.length === 0) {
      console.log('[sweeper-notify] No vehicles parked with street cleaning today');
      return res.status(200).json({ success: true, message: 'No vehicles to check', results });
    }

    // Filter out already-notified vehicles (column-based, fast)
    const eligible = parkedVehicles.filter(v => {
      if (hasDedupColumn && v.sweeper_passed_notified_at) {
        results.notificationsSkipped++;
        return false;
      }
      if (!v.fcm_token || !v.address) {
        results.notificationsSkipped++;
        return false;
      }
      return true;
    });

    // ─── Check user preferences: filter out users who disabled sweeper alerts ───
    // Batch-fetch push_alert_preferences for all eligible users in one query.
    const uniqueUserIds = [...new Set(eligible.map(v => v.user_id))];
    const optedOutUsers = new Set<string>();
    // Guard: .in() with an empty array can error on some Supabase client versions
    if (uniqueUserIds.length > 0) {
      try {
        const { data: profiles } = await supabaseAdmin
          .from('user_profiles')
          .select('id, push_alert_preferences')
          .in('id', uniqueUserIds);
        if (profiles) {
          for (const p of profiles) {
            const prefs = p.push_alert_preferences as Record<string, boolean> | null;
            if (prefs && prefs.sweeper_passed === false) {
              optedOutUsers.add(p.id);
            }
          }
        }
      } catch {
        // Column might not exist yet — treat as all opted-in (default ON)
      }
    }

    // Always filter — no-op when optedOutUsers is empty, avoids two code paths
    const finalEligible = eligible.filter(v => {
      if (optedOutUsers.has(v.user_id)) {
        results.notificationsSkipped++;
        return false;
      }
      return true;
    });

    results.vehiclesEligible = finalEligible.length;

    if (finalEligible.length === 0) {
      console.log('[sweeper-notify] All vehicles already notified, ineligible, or opted out');
      return res.status(200).json({ success: true, message: 'All already notified or opted out', results });
    }

    if (optedOutUsers.size > 0) {
      console.log(`[sweeper-notify] ${optedOutUsers.size} user(s) opted out of sweeper alerts`);
    }

    console.log(`[sweeper-notify] ${parkedVehicles.length} vehicles with cleaning today, ${finalEligible.length} eligible for check`);

    // ─── Step 2: Resolve addresses → TransIDs (cached per unique address) ───
    const startTime = Date.now();
    const MAX_RUNTIME_MS = 110_000; // 110s budget (10s buffer before 120s limit)

    // Cache: address string → TransID result (null = unparseable/not found)
    const transIdCache = new Map<string, { transId: number; segment: string } | null>();
    // Group: TransID → list of vehicles on that segment
    const segmentVehicles = new Map<number, { vehicles: ParkedVehicle[]; segment: string }>();
    // Vehicles that couldn't be resolved to a TransID
    let unresolvedCount = 0;

    for (const vehicle of finalEligible) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log('[sweeper-notify] Approaching timeout during TransID resolution');
        break;
      }

      // Normalize address for cache (strip city/state/zip, uppercase)
      const cacheKey = vehicle.address.toUpperCase().replace(/,.*$/, '').trim();

      let transResult: { transId: number; segment: string } | null | undefined = transIdCache.get(cacheKey);
      if (transResult === undefined) {
        // Cache miss — call city API
        try {
          transResult = await lookupTransId(vehicle.address);
        } catch (err) {
          console.error(`[sweeper-notify] TransID lookup failed for "${vehicle.address}":`, err);
          results.apiErrors++;
          transResult = null;
        }
        transIdCache.set(cacheKey, transResult);
      }

      if (!transResult) {
        unresolvedCount++;
        continue;
      }

      // Group this vehicle under its TransID
      const existing = segmentVehicles.get(transResult.transId);
      if (existing) {
        existing.vehicles.push(vehicle);
      } else {
        segmentVehicles.set(transResult.transId, {
          vehicles: [vehicle],
          segment: transResult.segment,
        });
      }
    }

    results.uniqueSegments = segmentVehicles.size;
    console.log(`[sweeper-notify] Resolved ${finalEligible.length} vehicles to ${segmentVehicles.size} unique segments (${unresolvedCount} unresolved, ${transIdCache.size} address lookups)`);

    // ─── Step 3: Check sweeper activity per unique TransID ───
    // Shuffle segment order to prevent timeout starvation: if cron times out,
    // different segments get checked next run instead of always the same ones first.
    // Reuse `today` (from getChicagoDateISO) — don't create a second date source.
    const shuffledSegments = shuffle([...segmentVehicles.entries()]);

    for (const [transId, group] of shuffledSegments) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log(`[sweeper-notify] Approaching timeout after ${results.segmentsSwept} segments checked. Will continue next run.`);
        break;
      }

      let sweeperResult: SegmentSweeperResult;

      try {
        const visits = await getSweeperHistory(transId);

        // null = API error (timeout, HTTP error, bad JSON) — skip this segment, try next run
        if (visits === null) {
          results.apiErrors++;
          console.warn(`[sweeper-notify] Sweeper API error for transId=${transId}, will retry next run`);
          continue;
        }

        // Filter to today's visits
        const todayVisits = visits.filter((v: SweeperVisit) => v.chicagoDate === today);

        if (todayVisits.length === 0) {
          // Sweeper hasn't passed this segment today
          continue;
        }

        // Find the first pass today
        const sorted = [...todayVisits].sort(
          (a: SweeperVisit, b: SweeperVisit) => new Date(a.postingTime).getTime() - new Date(b.postingTime).getTime()
        );
        const first = sorted[0];

        sweeperResult = {
          passed: true,
          passTime: first.chicagoTime,
          segment: group.segment,
          vehicleId: first.vehicleId,
        };
      } catch (err) {
        console.error(`[sweeper-notify] Sweeper history check failed for transId=${transId}:`, err);
        results.apiErrors++;
        continue;
      }

      if (!sweeperResult.passed) continue;

      results.segmentsSwept++;
      const passTimeStr = sweeperResult.passTime || 'earlier today';

      // ─── Step 4: Notify all vehicles on this swept segment ───
      for (const vehicle of group.vehicles) {
        try {
          // Definitive dedup check via notification_logs
          const wasNotified = await alreadyNotified(vehicle.id);
          if (wasNotified) {
            results.notificationsSkipped++;
            continue;
          }

          const friendlyAddr = formatAddressForNotification(vehicle.address);

          // Use freshest FCM token — the one on user_parked_vehicles may be stale
          // if Firebase rotated it between parking time and sweeper cron execution.
          const freshToken = await getFreshFcmToken(vehicle.user_id, vehicle.fcm_token);

          const notifResult = await sendPushNotification(freshToken, {
            title: 'Street Sweeper Passed!',
            body: `The sweeper passed ${friendlyAddr} at ${passTimeStr}. You can move your car back now.`,
            data: {
              type: 'sweeper_passed',
              lat: vehicle.latitude?.toString() || '',
              lng: vehicle.longitude?.toString() || '',
              passTime: sweeperResult.passTime || '',
              sweeperVehicleId: sweeperResult.vehicleId || '',
              segment: sweeperResult.segment || '',
            },
          });

          if (notifResult.success) {
            results.notificationsSent++;
            console.log(`[sweeper-notify] ✓ Notified ${vehicle.user_id} — ${friendlyAddr} (sweeper at ${passTimeStr})`);

            // Mark as notified (column-based dedup for next run)
            if (hasDedupColumn) {
              const { error: dedupErr } = await supabaseAdmin
                .from('user_parked_vehicles')
                .update({ sweeper_passed_notified_at: new Date().toISOString() } as any)
                .eq('id', vehicle.id);
              if (dedupErr) console.error(`[sweeper-notify] Failed to set dedup flag on ${vehicle.id}:`, dedupErr.message);
            }

            // Log to notification_logs (definitive dedup + audit trail)
            await logNotification(vehicle.user_id, vehicle.id, vehicle.address, sweeperResult.passTime, 'sent');

          } else if (notifResult.invalidToken) {
            // Deactivate the invalid FCM token in push_tokens so other crons don't retry it
            try {
              const { error: tokenErr } = await supabaseAdmin
                .from('push_tokens')
                .update({ is_active: false })
                .eq('token', freshToken);
              if (tokenErr) console.error(`[sweeper-notify] Failed to deactivate token:`, tokenErr.message);
            } catch { /* push_tokens table might not exist yet */ }
            // Only deactivate the vehicle if the fresh token IS the vehicle's token.
            // If getFreshFcmToken returned a different (fresher) token that's also invalid,
            // the vehicle itself isn't the problem — just the token table entry.
            if (freshToken === vehicle.fcm_token) {
              const { error: vehErr } = await supabaseAdmin
                .from('user_parked_vehicles')
                .update({ is_active: false })
                .eq('id', vehicle.id);
              if (vehErr) console.error(`[sweeper-notify] Failed to deactivate vehicle ${vehicle.id}:`, vehErr.message);
            }
            console.log(`[sweeper-notify] Invalid FCM token for vehicle ${vehicle.id} — deactivated token${freshToken === vehicle.fcm_token ? ' and vehicle' : ''}`);
            results.notificationsFailed++;
          } else {
            results.notificationsFailed++;
            await logNotification(vehicle.user_id, vehicle.id, vehicle.address, sweeperResult.passTime, 'failed');
          }

        } catch (err) {
          console.error(`[sweeper-notify] Error notifying vehicle ${vehicle.id}:`, err);
          results.notificationsFailed++;
        }
      }
    }

    console.log('[sweeper-notify] Completed:', JSON.stringify(results));

    return res.status(200).json({
      success: true,
      results,
      chicagoDate: today,
      timestamp: new Date().toISOString(), // Actual UTC timestamp for logging
    });

  } catch (error) {
    console.error('[sweeper-notify] Fatal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
