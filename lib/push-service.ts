/**
 * Push Notification Service
 *
 * Sends push notifications via Firebase Cloud Messaging (FCM).
 * Supports iOS and Android devices.
 */

import { supabaseAdmin } from './supabase';
import { notificationLogger } from './notification-logger';

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  // Optional logging fields
  userId?: string;
  category?: string;
}

interface PushResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

// FCM API endpoint
const FCM_API_URL = 'https://fcm.googleapis.com/fcm/send';

export class PushService {
  private fcmServerKey: string | null = null;

  constructor() {
    this.fcmServerKey = process.env.FCM_SERVER_KEY || null;
  }

  /**
   * Check if push notifications are configured
   */
  isConfigured(): boolean {
    return !!this.fcmServerKey;
  }

  /**
   * Send push notification to a single token
   */
  async sendToToken(token: string, notification: PushNotification): Promise<boolean> {
    if (!this.fcmServerKey) {
      console.log('📱 MOCK: FCM not configured, would send push:', {
        token: token.substring(0, 20) + '...',
        title: notification.title
      });
      return true;
    }

    try {
      const response = await fetch(FCM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${this.fcmServerKey}`
        },
        body: JSON.stringify({
          to: token,
          notification: {
            title: notification.title,
            body: notification.body,
            sound: 'default',
            badge: 1
          },
          data: notification.data || {},
          priority: 'high',
          content_available: true // For iOS background delivery
        })
      });

      const result = await response.json();

      if (result.success === 1) {
        console.log('✅ Push notification sent successfully');
        return true;
      } else {
        console.error('❌ FCM error:', result);
        return false;
      }
    } catch (error) {
      console.error('❌ Push notification error:', error);
      return false;
    }
  }

  /**
   * Send push notification to a user (all their registered devices)
   */
  async sendToUser(userId: string, notification: PushNotification): Promise<PushResult> {
    const result: PushResult = {
      success: false,
      successCount: 0,
      failureCount: 0,
      invalidTokens: []
    };

    // Log the notification attempt
    let logId: string | null = null;
    if (notification.category) {
      logId = await notificationLogger.log({
        user_id: userId,
        notification_type: 'push',
        category: notification.category,
        subject: notification.title,
        content_preview: notification.body.substring(0, 200),
        status: 'pending',
        metadata: {
          push_data: notification.data
        }
      });
    }

    try {
      // Get user's active push tokens
      const { data: tokens, error } = await supabaseAdmin.rpc('get_user_push_tokens', {
        p_user_id: userId
      });

      if (error || !tokens?.length) {
        console.log(`No push tokens found for user ${userId}`);
        if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, 'No push tokens registered');
        return result;
      }

      console.log(`📱 Sending push to ${tokens.length} device(s) for user ${userId}`);

      // Send to each token
      for (const tokenRecord of tokens) {
        const sent = await this.sendToToken(tokenRecord.token, notification);

        if (sent) {
          result.successCount++;
        } else {
          result.failureCount++;
          // Mark potentially invalid tokens
          result.invalidTokens.push(tokenRecord.token);
        }
      }

      result.success = result.successCount > 0;

      // Update log status
      if (logId) {
        if (result.success) {
          await notificationLogger.updateStatus(logId, 'sent');
        } else {
          await notificationLogger.updateStatus(logId, 'failed', undefined, `Failed to send to ${result.failureCount} device(s)`);
        }
      }

      // Deactivate invalid tokens
      for (const invalidToken of result.invalidTokens) {
        await this.deactivateToken(invalidToken);
      }

      return result;

    } catch (error) {
      console.error('Error sending push to user:', error);
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, String(error));
      return result;
    }
  }

  /**
   * Send push notification to multiple users
   */
  async sendToUsers(userIds: string[], notification: PushNotification): Promise<{
    totalSuccess: number;
    totalFailure: number;
  }> {
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const userId of userIds) {
      const result = await this.sendToUser(userId, notification);
      totalSuccess += result.successCount;
      totalFailure += result.failureCount;
    }

    return { totalSuccess, totalFailure };
  }

  /**
   * Deactivate an invalid push token
   */
  private async deactivateToken(token: string): Promise<void> {
    try {
      await supabaseAdmin.rpc('deactivate_push_token', { p_token: token });
      console.log('🔒 Deactivated invalid push token');
    } catch (error) {
      console.error('Error deactivating token:', error);
    }
  }
}

// Export singleton instance
export const pushService = new PushService();

// Helper function to create common notification types
export const pushNotifications = {
  streetCleaning: (address: string, date: string, daysUntil: number) => ({
    title: daysUntil === 0 ? '🚗 Street Cleaning TODAY' : `🚗 Street Cleaning in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`,
    body: `Move your car! Street cleaning at ${address} on ${date}.`,
    data: {
      type: 'street_cleaning',
      date: date
    },
    category: 'street_cleaning'
  }),

  stickerReminder: (plate: string, daysUntil: number) => ({
    title: daysUntil <= 1 ? '⚠️ City Sticker Due!' : `📋 City Sticker Reminder`,
    body: daysUntil <= 1
      ? `Your city sticker for ${plate} expires ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}!`
      : `Your city sticker for ${plate} expires in ${daysUntil} days.`,
    data: {
      type: 'sticker_renewal',
      plate: plate
    },
    category: 'sticker_renewal'
  }),

  snowBan: (address: string) => ({
    title: '❄️ Snow Ban Alert!',
    body: `Parking ban in effect for ${address}. Move your car to avoid a ticket!`,
    data: {
      type: 'snow_ban'
    },
    category: 'snow_ban'
  }),

  towing: (plate: string, location: string) => ({
    title: '🚨 Vehicle Towed!',
    body: `Your vehicle ${plate} may have been towed. Last seen near ${location}.`,
    data: {
      type: 'towing',
      plate: plate
    },
    category: 'towing'
  })
};
