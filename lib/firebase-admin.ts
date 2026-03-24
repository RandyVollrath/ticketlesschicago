/**
 * Firebase Admin SDK Initialization
 *
 * Provides a singleton Firebase Admin instance for server-side operations:
 * - Sending push notifications via FCM
 * - Verifying Firebase Auth tokens (if needed)
 *
 * Required Environment Variables:
 * - FIREBASE_PROJECT_ID: Your Firebase project ID
 * - FIREBASE_CLIENT_EMAIL: Service account email
 * - FIREBASE_PRIVATE_KEY: Service account private key (with \n replaced)
 *
 * Setup:
 * 1. Go to Firebase Console > Project Settings > Service Accounts
 * 2. Click "Generate new private key"
 * 3. Add the JSON values to your environment variables
 */

import * as admin from 'firebase-admin';

let firebaseApp: admin.app.App | null = null;
let initializationAttempted = false;

/**
 * Get or initialize the Firebase Admin app
 */
export function getFirebaseAdmin(): admin.app.App | null {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (initializationAttempted) {
    return null;
  }

  initializationAttempted = true;

  // Check for required environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      'Firebase Admin SDK not configured. Missing environment variables:',
      !projectId ? 'FIREBASE_PROJECT_ID' : '',
      !clientEmail ? 'FIREBASE_CLIENT_EMAIL' : '',
      !privateKey ? 'FIREBASE_PRIVATE_KEY' : ''
    );
    return null;
  }

  try {
    // Check if already initialized (e.g., by another module)
    if (admin.apps.length > 0) {
      firebaseApp = admin.apps[0]!;
      return firebaseApp;
    }

    // Initialize Firebase Admin
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        // Handle escaped newlines in the private key
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });

    console.log('Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    return null;
  }
}

/**
 * Get Firebase Messaging instance
 */
export function getMessaging(): admin.messaging.Messaging | null {
  const app = getFirebaseAdmin();
  if (!app) {
    return null;
  }
  return admin.messaging(app);
}

/**
 * FCM error codes that definitively indicate the token is invalid/expired.
 * Shared between single-send and multicast to avoid duplication.
 * 'messaging/invalid-argument' is intentionally excluded — it fires on payload
 * validation errors (empty title, bad data), not just invalid tokens.
 */
const INVALID_TOKEN_CODES = [
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
];

/**
 * Send a push notification to a single device
 */
export async function sendPushNotification(
  fcmToken: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }
): Promise<{ success: boolean; error?: string; invalidToken?: boolean }> {
  const messaging = getMessaging();

  if (!messaging) {
    return { success: false, error: 'Firebase Messaging not available' };
  }

  try {
    const message: admin.messaging.Message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'parking-alerts',
          priority: 'high',
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

    await messaging.send(message);
    return { success: true };
  } catch (error: any) {
    // Handle invalid token errors — these tokens should be cleaned up.
    // NOTE: 'messaging/invalid-argument' is intentionally excluded. It fires on ANY
    // payload validation failure (empty title, missing data, etc.) — not just bad tokens.
    // Including it would incorrectly deactivate valid tokens when the real problem
    // is a malformed notification payload.
    if (INVALID_TOKEN_CODES.includes(error?.code)) {
      console.warn(`Invalid FCM token detected: ${fcmToken.substring(0, 20)}...`);
      return { success: false, error: error.message, invalidToken: true };
    }

    console.error('Error sending push notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send push notifications to multiple devices
 */
export async function sendMulticastNotification(
  fcmTokens: string[],
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }
): Promise<{
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}> {
  const messaging = getMessaging();

  if (!messaging) {
    return { successCount: 0, failureCount: fcmTokens.length, invalidTokens: [] };
  }

  if (fcmTokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  try {
    const message: admin.messaging.MulticastMessage = {
      tokens: fcmTokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'parking-alerts',
          priority: 'high',
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

    const response = await messaging.sendEachForMulticast(message);

    // Collect invalid tokens for cleanup
    const invalidTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        if (INVALID_TOKEN_CODES.includes(resp.error.code)) {
          invalidTokens.push(fcmTokens[idx]);
        }
      }
    });

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  } catch (error) {
    console.error('Error sending multicast notification:', error);
    return { successCount: 0, failureCount: fcmTokens.length, invalidTokens: [] };
  }
}

/**
 * Clean up invalid FCM tokens from the database.
 * Call this after sendMulticastNotification when invalidTokens is non-empty.
 * Accepts a Supabase client to avoid circular imports.
 */
export async function cleanupInvalidTokens(
  supabase: { from: (table: string) => any },
  invalidTokens: string[],
): Promise<number> {
  if (invalidTokens.length === 0) return 0;
  let cleaned = 0;
  // Process in batches of 50 to avoid overly long IN clauses
  for (let i = 0; i < invalidTokens.length; i += 50) {
    const batch = invalidTokens.slice(i, i + 50);
    const { error } = await supabase
      .from('push_tokens')
      .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivation_reason: 'fcm_invalid_token' })
      .in('token', batch);
    if (!error) {
      cleaned += batch.length;
    } else {
      console.error(`Failed to deactivate ${batch.length} invalid tokens: ${error.message}`);
    }
  }
  if (cleaned > 0) {
    console.log(`Deactivated ${cleaned} invalid FCM token(s)`);
  }
  return cleaned;
}

/**
 * Check if Firebase Admin is configured and available
 */
export function isFirebaseConfigured(): boolean {
  return getFirebaseAdmin() !== null;
}

export default {
  getFirebaseAdmin,
  getMessaging,
  sendPushNotification,
  sendMulticastNotification,
  cleanupInvalidTokens,
  isFirebaseConfigured,
};
