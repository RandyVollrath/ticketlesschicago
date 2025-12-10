/**
 * Mobile Parking Reminders Cron Job
 *
 * Sends follow-up push notifications to mobile app users who are parked
 * in restricted zones before restrictions take effect.
 *
 * Runs at:
 * - 10pm CT: Winter ban reminders (ban starts at 3am)
 * - 7am CT: Street cleaning reminders (cleaning starts at 9am)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getChicagoTime } from '../../../lib/chicago-timezone-utils';

// Firebase Admin SDK for sending push notifications (optional)
let admin: any = null;
let firebaseInitialized = false;

// Dynamically import and initialize Firebase Admin
async function initFirebase() {
  if (firebaseInitialized) return admin;

  try {
    // Dynamic import to avoid build errors if firebase-admin is not installed
    const firebaseAdmin = await import('firebase-admin').catch(() => null);

    if (!firebaseAdmin) {
      console.warn('firebase-admin package not installed - push notifications disabled');
      firebaseInitialized = true;
      return null;
    }

    admin = firebaseAdmin.default;

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }

    firebaseInitialized = true;
    return admin;
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    firebaseInitialized = true;
    return null;
  }
}

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
  parked_at: string;
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

  // Initialize Firebase
  await initFirebase();
  if (!admin) {
    console.warn('Firebase Admin not available - push notifications will be skipped');
  }

  const chicagoTime = getChicagoTime();
  const chicagoHour = chicagoTime.getHours();
  const today = chicagoTime.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`Running mobile parking reminders at ${chicagoTime.toISOString()} (Chicago hour: ${chicagoHour})`);

  try {
    const results = {
      winterBanReminders: 0,
      streetCleaningReminders: 0,
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
        // Winter ban reminder (10pm check, ban starts at 3am)
        if (chicagoHour >= 21 && chicagoHour <= 23 && isWinterSeason && vehicle.on_winter_ban_street) {
          await sendPushNotification(vehicle.fcm_token, {
            title: 'Winter Parking Ban Reminder',
            body: `Your car at ${vehicle.address} is on a winter ban street. Move before 3am to avoid towing ($150+).`,
            data: {
              type: 'winter_ban_reminder',
              lat: vehicle.latitude?.toString(),
              lng: vehicle.longitude?.toString(),
            },
          });
          results.winterBanReminders++;
          console.log(`Sent winter ban reminder to ${vehicle.user_id}`);
        }

        // Street cleaning reminder (7am check, cleaning at 9am)
        if (chicagoHour >= 6 && chicagoHour <= 8 && vehicle.street_cleaning_date === today) {
          await sendPushNotification(vehicle.fcm_token, {
            title: 'Street Cleaning Today!',
            body: `Street cleaning starts at 9am at ${vehicle.address}. Move your car now to avoid a $65 ticket.`,
            data: {
              type: 'street_cleaning_reminder',
              lat: vehicle.latitude?.toString(),
              lng: vehicle.longitude?.toString(),
            },
          });
          results.streetCleaningReminders++;
          console.log(`Sent street cleaning reminder to ${vehicle.user_id}`);
        }

      } catch (err) {
        console.error(`Error processing vehicle ${vehicle.id}:`, err);
        results.errors++;
      }
    }

    console.log('Mobile parking reminders completed:', results);

    return res.status(200).json({
      success: true,
      results,
      timestamp: chicagoTime.toISOString(),
    });

  } catch (error) {
    console.error('Error in mobile-parking-reminders:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendPushNotification(
  fcmToken: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }
): Promise<boolean> {
  try {
    if (!admin || !admin.apps?.length) {
      console.warn('Firebase Admin not available - skipping push notification');
      return false;
    }

    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      android: {
        priority: 'high' as const,
        notification: {
          channelId: 'parking-alerts',
          priority: 'high' as const,
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    await admin.messaging().send(message);
    return true;
  } catch (error: any) {
    // Handle invalid token errors
    if (error?.code === 'messaging/invalid-registration-token' ||
        error?.code === 'messaging/registration-token-not-registered') {
      console.warn('Invalid FCM token, should be cleaned up:', fcmToken.substring(0, 20));
    } else {
      console.error('Error sending push notification:', error);
    }
    return false;
  }
}
