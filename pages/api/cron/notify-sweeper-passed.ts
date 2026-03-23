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
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getChicagoTime } from '../../../lib/chicago-timezone-utils';
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
 */
async function alreadyNotified(vehicleId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { count } = await supabaseAdmin
      .from('notification_logs')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'sweeper_passed')
      .eq('external_id', vehicleId);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Log the notification to notification_logs for dedup and audit trail.
 */
async function logNotification(
  userId: string,
  vehicleId: string,
  address: string,
  passTime: string | null,
  status: 'sent' | 'failed'
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin
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
  } catch (err) {
    console.error('Failed to log sweeper notification:', err);
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
  const isAuthorized =
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  const chicagoTime = getChicagoTime();
  const chicagoHour = chicagoTime.getHours();
  const chicagoMonth = chicagoTime.getMonth() + 1; // 1-indexed
  const chicagoDay = chicagoTime.getDay(); // 0=Sun, 6=Sat
  const today = chicagoTime.toISOString().split('T')[0]; // YYYY-MM-DD

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

  // Check Firebase configuration
  if (!isFirebaseConfigured()) {
    console.warn('[sweeper-notify] Firebase Admin not configured — push notifications will fail');
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

    results.vehiclesEligible = eligible.length;

    if (eligible.length === 0) {
      console.log('[sweeper-notify] All vehicles already notified or ineligible');
      return res.status(200).json({ success: true, message: 'All already notified', results });
    }

    console.log(`[sweeper-notify] ${parkedVehicles.length} vehicles with cleaning today, ${eligible.length} eligible for check`);

    // ─── Step 2: Resolve addresses → TransIDs (cached per unique address) ───
    const startTime = Date.now();
    const MAX_RUNTIME_MS = 110_000; // 110s budget (10s buffer before 120s limit)

    // Cache: address string → TransID result (null = unparseable/not found)
    const transIdCache = new Map<string, { transId: number; segment: string } | null>();
    // Group: TransID → list of vehicles on that segment
    const segmentVehicles = new Map<number, { vehicles: ParkedVehicle[]; segment: string }>();
    // Vehicles that couldn't be resolved to a TransID
    let unresolvedCount = 0;

    for (const vehicle of eligible) {
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
    console.log(`[sweeper-notify] Resolved ${eligible.length} vehicles to ${segmentVehicles.size} unique segments (${unresolvedCount} unresolved, ${transIdCache.size} address lookups)`);

    // ─── Step 3: Check sweeper activity per unique TransID ───
    const todayChicago = new Date().toLocaleDateString('en-CA', { timeZone: CHICAGO_TZ });

    for (const [transId, group] of segmentVehicles) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log(`[sweeper-notify] Approaching timeout after ${results.segmentsSwept} segments checked. Will continue next run.`);
        break;
      }

      let sweeperResult: SegmentSweeperResult;

      try {
        const visits = await getSweeperHistory(transId);

        // Filter to today's visits
        const todayVisits = visits.filter((v: SweeperVisit) => v.chicagoDate === todayChicago);

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

          const notifResult = await sendPushNotification(vehicle.fcm_token, {
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
              await supabaseAdmin
                .from('user_parked_vehicles')
                .update({ sweeper_passed_notified_at: new Date().toISOString() } as any)
                .eq('id', vehicle.id);
            }

            // Log to notification_logs (definitive dedup + audit trail)
            await logNotification(vehicle.user_id, vehicle.id, vehicle.address, sweeperResult.passTime, 'sent');

          } else if (notifResult.invalidToken) {
            // Deactivate vehicle with invalid token
            await supabaseAdmin
              .from('user_parked_vehicles')
              .update({ is_active: false })
              .eq('id', vehicle.id);
            console.log(`[sweeper-notify] Deactivated vehicle ${vehicle.id} — invalid FCM token`);
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
      timestamp: chicagoTime.toISOString(),
    });

  } catch (error) {
    console.error('[sweeper-notify] Fatal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
