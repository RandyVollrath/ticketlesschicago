/**
 * Mobile Snow Ban Notifications
 *
 * Sends push notifications to mobile app users who are parked on snow routes
 * when a 2-inch snow ban is triggered.
 */

import { supabaseAdmin } from '../../../lib/supabase';
import { sendPushNotification, isFirebaseConfigured } from '../../../lib/firebase-admin';

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

    // Determine notification content based on type
    const isUrgent = notificationType === 'confirmation';
    const title = isUrgent
      ? '2-Inch Snow Ban ACTIVE!'
      : 'Snow Ban Warning';

    const bodyTemplate = isUrgent
      ? `${snowAmountInches}" of snow has fallen. Your car at {address} may be towed. Move immediately!`
      : `${snowAmountInches}" of snow forecasted. Your car at {address} is on a snow route - prepare to move.`;

    for (const vehicle of parkedVehicles as ParkedVehicle[]) {
      try {
        if (!vehicle.fcm_token) {
          results.skipped++;
          continue;
        }

        const body = bodyTemplate.replace('{address}', vehicle.address || 'your parked location');

        const result = await sendPushNotification(vehicle.fcm_token, {
          title,
          body,
          data: {
            type: 'snow_ban_alert',
            severity: isUrgent ? 'critical' : 'warning',
            lat: vehicle.latitude?.toString(),
            lng: vehicle.longitude?.toString(),
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
            .eq('id', vehicle.id);
          console.log(`Deactivated vehicle ${vehicle.id} due to invalid FCM token`);
          results.failed++;
        } else {
          results.failed++;
        }
      } catch (err) {
        console.error(`Error sending notification to ${vehicle.user_id}:`, err);
        results.failed++;
      }
    }

    console.log('Mobile snow ban notifications completed:', results);
    return results;

  } catch (error) {
    console.error('Error in sendMobileSnowBanNotifications:', error);
    return results;
  }
}
