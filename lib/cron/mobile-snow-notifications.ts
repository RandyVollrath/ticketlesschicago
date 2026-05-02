/**
 * Mobile Snow Ban Notifications
 *
 * Sends push notifications to mobile app users who are parked on snow routes
 * when a 2-inch snow ban is triggered.
 */

import { supabaseAdmin } from '../supabase';
import { sendPushNotification, isFirebaseConfigured, cleanupInvalidTokens } from '../firebase-admin';
import { notificationLogger } from '../notification-logger';

interface ParkedVehicle {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  fcm_token: string;
  address: string;
  on_snow_route: boolean;
  snow_ban_notified_at: string | null;
}

async function sendLoggedSnowPush(params: {
  userId: string;
  parkingSessionId: string;
  fcmToken: string;
  title: string;
  body: string;
  data: Record<string, string | undefined>;
  address: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string; invalidToken?: boolean }> {
  const logId = await notificationLogger.log({
    user_id: params.userId,
    notification_type: 'push',
    category: 'snow_ban_alert',
    subject: params.title,
    content_preview: params.body,
    status: 'pending',
    metadata: {
      parking_session_id: params.parkingSessionId,
      address: params.address,
      severity: params.data.severity || null,
      ...(params.metadata || {}),
    },
  });

  const pushData = Object.fromEntries(
    Object.entries(params.data).filter(([, value]) => typeof value === 'string')
  ) as Record<string, string>;

  const result = await sendPushNotification(params.fcmToken, {
    title: params.title,
    body: params.body,
    data: pushData,
  });

  if (logId) {
    if (result.success) {
      await notificationLogger.updateStatus(logId, 'sent');
    } else {
      await notificationLogger.updateStatus(
        logId,
        'failed',
        undefined,
        result.error || 'Failed to send push notification'
      );
    }
  }

  return result;
}

/**
 * Send push notifications to mobile users parked on snow routes
 */
export async function sendMobileSnowBanNotifications(
  notificationType: 'forecast' | 'confirmation',
  snowAmountInches: number
): Promise<{ sent: number; failed: number; skipped: number }> {
  const results = { sent: 0, failed: 0, skipped: 0 };

  if (!supabaseAdmin) {
    console.error('Database not configured');
    return results;
  }

  // Check Firebase configuration
  if (!isFirebaseConfigured()) {
    console.warn('Firebase Admin not configured - skipping mobile push notifications');
    return results;
  }

  try {
    // Get all active parked vehicles on snow routes that haven't been notified yet
    const { data: parkedVehicles, error } = await supabaseAdmin
      .from('user_parked_vehicles')
      .select('*')
      .eq('is_active', true)
      .eq('on_snow_route', true)
      .is('snow_ban_notified_at', null);

    if (error) {
      console.error('Error fetching parked vehicles:', error);
      return results;
    }

    if (!parkedVehicles || parkedVehicles.length === 0) {
      console.log('No mobile users parked on snow routes');
      return results;
    }

    console.log(`Found ${parkedVehicles.length} mobile users parked on snow routes`);

    const invalidFcmTokens: string[] = [];
    const uniqueUserIds = Array.from(new Set((parkedVehicles as ParkedVehicle[]).map(v => v.user_id)));
    const freshTokenByUserId = new Map<string, string>();
    if (uniqueUserIds.length > 0) {
      const { data: tokens } = await supabaseAdmin
        .from('push_tokens')
        .select('user_id, token, last_used_at')
        .in('user_id', uniqueUserIds)
        .eq('is_active', true)
        .order('last_used_at', { ascending: false });
      if (tokens) {
        for (const tokenRow of tokens as Array<{ user_id: string; token: string }>) {
          if (!freshTokenByUserId.has(tokenRow.user_id) && tokenRow.token) {
            freshTokenByUserId.set(tokenRow.user_id, tokenRow.token);
          }
        }
      }
    }

    // Determine notification content based on type
    const isUrgent = notificationType === 'confirmation';
    const title = isUrgent
      ? '2-Inch Snow Ban ACTIVE!'
      : 'Snow Ban Warning';

    const bodyTemplate = isUrgent
      ? `${snowAmountInches}" of snow has fallen. Snow-route towing may be active near {address}. Move immediately.`
      : `${snowAmountInches}" of snow is forecast. Your car is on a snow route near {address}, so be ready to move before the ban starts.`;

    for (const vehicle of parkedVehicles as ParkedVehicle[]) {
      try {
        const freshFcmToken = freshTokenByUserId.get(vehicle.user_id) || vehicle.fcm_token || null;
        if (!freshFcmToken) {
          results.skipped++;
          continue;
        }

        const body = bodyTemplate.replace('{address}', vehicle.address || 'your parked location');

        const result = await sendLoggedSnowPush({
          userId: vehicle.user_id,
          parkingSessionId: vehicle.id,
          fcmToken: freshFcmToken,
          title,
          body,
          data: {
            type: 'snow_ban_alert',
            severity: isUrgent ? 'critical' : 'warning',
            lat: vehicle.latitude?.toString(),
            lng: vehicle.longitude?.toString(),
          },
          address: vehicle.address,
          metadata: {
            user_reason: isUrgent
              ? `${snowAmountInches}" of snow has already fallen and snow-route towing may be active.`
              : `${snowAmountInches}" of snow is forecast and a snow-route ban may start soon.`,
            snow_amount_inches: snowAmountInches,
            alert_phase: notificationType,
          },
        });

        if (result.success) {
          // Mark as notified to prevent duplicate notifications
          await supabaseAdmin
            .from('user_parked_vehicles')
            .update({ snow_ban_notified_at: new Date().toISOString() })
            .eq('id', vehicle.id);
          results.sent++;
          console.log(`Sent snow ban notification to user ${vehicle.user_id}`);
        } else if (result.invalidToken) {
          // Deactivate vehicle with invalid token
          await supabaseAdmin
            .from('user_parked_vehicles')
            .update({ is_active: false })
            .eq('id', vehicle.id)
            .eq('fcm_token', freshFcmToken);
          invalidFcmTokens.push(freshFcmToken);
          console.log(`Deactivated invalid FCM token for vehicle ${vehicle.id}${freshFcmToken === vehicle.fcm_token ? ' and parked session' : ''}`);
          results.failed++;
        } else {
          results.failed++;
        }
      } catch (err) {
        console.error(`Error sending notification to ${vehicle.user_id}:`, err);
        results.failed++;
      }
    }

    // Batch cleanup invalid FCM tokens in push_tokens table
    if (supabaseAdmin && invalidFcmTokens.length > 0) {
      await cleanupInvalidTokens(supabaseAdmin, invalidFcmTokens);
    }

    console.log('Mobile snow ban notifications completed:', results);
    return results;

  } catch (error) {
    console.error('Error in sendMobileSnowBanNotifications:', error);
    return results;
  }
}
