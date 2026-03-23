/**
 * Sweeper Passed Notification Cron Job
 *
 * Checks if the city's street sweeper has passed blocks where users are parked
 * with active street cleaning restrictions TODAY. If the sweeper has passed,
 * sends a push notification: "Sweeper passed your block — you can move your car back."
 *
 * Runs every 15 minutes during sweeper operating hours (9am-3pm, April-November).
 * Street sweepers operate roughly 9am-2pm on weekdays during sweeping season.
 *
 * Data flow:
 *   1. Query user_parked_vehicles for cars with street_cleaning_date = today
 *   2. For each vehicle, call checkSweeperPassedToday(address)
 *   3. If sweeper has passed, send push notification via FCM
 *   4. Mark as notified (dedup via notification_logs + sweeper_passed_notified_at column)
 *
 * Rate limiting:
 *   - Only runs during sweeper season (April-November)
 *   - Only runs 9am-3pm Chicago time (sweeper operating window)
 *   - Only checks vehicles with street_cleaning_date = today
 *   - Each vehicle only notified once per parking session (dedup)
 *   - City API calls are throttled (1 per vehicle, ~2-3 seconds each due to fetch+retry)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getChicagoTime } from '../../../lib/chicago-timezone-utils';
import { sendPushNotification, isFirebaseConfigured } from '../../../lib/firebase-admin';
import { checkSweeperPassedToday } from '../../../lib/sweeper-tracker';

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
 * Check notification_logs to see if we already sent a sweeper_passed notification
 * for this parking session (vehicle.id).
 */
async function alreadyNotified(vehicleId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { data } = await supabaseAdmin
      .from('notification_logs')
      .select('id')
      .eq('category', 'sweeper_passed')
      .eq('external_id', vehicleId)
      .limit(1);
    return !!(data && data.length > 0);
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
    vehiclesChecked: 0,
    sweeperPassed: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
    notificationsFailed: 0,
    apiErrors: 0,
  };

  try {
    // Get all active parked vehicles with street cleaning TODAY
    // Try to select sweeper_passed_notified_at — it may not exist yet (column migration pending)
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

    if (!parkedVehicles || parkedVehicles.length === 0) {
      console.log('[sweeper-notify] No vehicles parked with street cleaning today');
      return res.status(200).json({ success: true, message: 'No vehicles to check', results });
    }

    // Filter out already-notified vehicles
    const toCheck = parkedVehicles.filter(v => {
      // Column-based dedup (fast, if column exists)
      if (hasDedupColumn && v.sweeper_passed_notified_at) {
        results.notificationsSkipped++;
        return false;
      }
      return true;
    });

    console.log(`[sweeper-notify] ${parkedVehicles.length} vehicles with cleaning today, ${toCheck.length} need sweeper check`);

    // Check each vehicle's block for sweeper activity
    for (const vehicle of toCheck) {
      try {
        // Notification log dedup (fallback if column doesn't exist)
        if (!hasDedupColumn) {
          const wasNotified = await alreadyNotified(vehicle.id);
          if (wasNotified) {
            results.notificationsSkipped++;
            continue;
          }
        }

        if (!vehicle.fcm_token) {
          results.notificationsSkipped++;
          continue;
        }

        if (!vehicle.address) {
          results.notificationsSkipped++;
          continue;
        }

        results.vehiclesChecked++;

        // Call the sweeper tracker API
        const sweeperResult = await checkSweeperPassedToday(vehicle.address);

        if (!sweeperResult) {
          // Address not found in city street network — skip silently
          continue;
        }

        if (!sweeperResult.passed) {
          // Sweeper hasn't passed yet — we'll check again next cron run
          continue;
        }

        // Sweeper HAS passed! Send the notification.
        results.sweeperPassed++;

        const passTimeStr = sweeperResult.passTime || 'earlier today';
        const segmentStr = sweeperResult.segment || vehicle.address;

        const notifResult = await sendPushNotification(vehicle.fcm_token, {
          title: 'Street Sweeper Passed!',
          body: `The sweeper passed ${segmentStr} at ${passTimeStr}. You can move your car back now.`,
          data: {
            type: 'sweeper_passed',
            lat: vehicle.latitude?.toString() || '',
            lng: vehicle.longitude?.toString() || '',
            passTime: sweeperResult.passTime || '',
            vehicleId: sweeperResult.vehicleId || '',
          },
        });

        if (notifResult.success) {
          results.notificationsSent++;
          console.log(`[sweeper-notify] Sent sweeper-passed notification to ${vehicle.user_id} at ${vehicle.address} (passed at ${passTimeStr})`);

          // Mark as notified (column-based dedup)
          if (hasDedupColumn) {
            await supabaseAdmin
              .from('user_parked_vehicles')
              .update({ sweeper_passed_notified_at: new Date().toISOString() } as any)
              .eq('id', vehicle.id);
          }

          // Log to notification_logs (fallback dedup + audit trail)
          await logNotification(vehicle.user_id, vehicle.id, vehicle.address, sweeperResult.passTime, 'sent');

        } else if (notifResult.invalidToken) {
          // Deactivate vehicle with invalid token
          await supabaseAdmin
            .from('user_parked_vehicles')
            .update({ is_active: false })
            .eq('id', vehicle.id);
          console.log(`[sweeper-notify] Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
          results.notificationsFailed++;
        } else {
          results.notificationsFailed++;
          await logNotification(vehicle.user_id, vehicle.id, vehicle.address, sweeperResult.passTime, 'failed');
        }

      } catch (err) {
        console.error(`[sweeper-notify] Error checking vehicle ${vehicle.id}:`, err);
        results.apiErrors++;
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
