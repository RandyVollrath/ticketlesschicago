/**
 * Push Notification Service
 *
 * Sends push notifications for parking alerts with different
 * urgency levels and sounds.
 *
 * Critical alerts:
 * - Loud alarm sound
 * - Maximum priority
 * - Bypass DND on Android
 * - Critical interruption level on iOS
 */

import { TowAlert } from './TowAlertService';

// =============================================================================
// Types
// =============================================================================

export interface NotificationConfig {
  sound: string;
  priority: 'max' | 'high' | 'default' | 'low';
  vibrate: number[];
  badge: boolean;
  interruptionLevel?: 'critical' | 'active' | 'passive'; // iOS
  channelId?: string; // Android
}

export interface ScheduledReminder {
  id: string;
  alertId: string;
  time: Date;
  title: string;
  body: string;
}

// =============================================================================
// Notification Configs by Severity
// =============================================================================

const NOTIFICATION_CONFIGS: Record<TowAlert['severity'], NotificationConfig> = {
  critical: {
    sound: 'alarm.wav', // Loud, attention-grabbing
    priority: 'max',
    vibrate: [0, 500, 200, 500, 200, 500],
    badge: true,
    interruptionLevel: 'critical',
    channelId: 'tow-alerts',
  },
  warning: {
    sound: 'alert.wav',
    priority: 'high',
    vibrate: [0, 250, 250, 250],
    badge: true,
    interruptionLevel: 'active',
    channelId: 'parking-alerts',
  },
  info: {
    sound: 'default',
    priority: 'default',
    vibrate: [0, 100],
    badge: false,
    interruptionLevel: 'passive',
    channelId: 'parking-reminders',
  },
};

// =============================================================================
// Push Notification Service
// =============================================================================

class PushNotificationService {
  private isInitialized = false;
  private scheduledReminders: Map<string, ScheduledReminder> = new Map();

  /**
   * Initialize the notification service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // In production, this would:
    // 1. Request notification permissions
    // 2. Set up notification channels (Android)
    // 3. Configure notification handlers

    await this.setupNotificationChannels();
    this.isInitialized = true;

    console.log('[PushNotification] Initialized');
  }

  /**
   * Set up Android notification channels
   */
  private async setupNotificationChannels(): Promise<void> {
    // In production with expo-notifications:
    // await Notifications.setNotificationChannelAsync('tow-alerts', {
    //   name: 'Tow Alerts',
    //   importance: Notifications.AndroidImportance.MAX,
    //   vibrationPattern: [0, 500, 200, 500, 200, 500],
    //   lightColor: '#FF0000',
    //   lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    //   bypassDnd: true,
    //   sound: 'alarm.wav',
    // });

    console.log('[PushNotification] Notification channels set up');
  }

  /**
   * Send a tow alert notification
   */
  async sendTowAlert(alert: TowAlert): Promise<void> {
    const config = NOTIFICATION_CONFIGS[alert.severity];

    const title =
      alert.severity === 'critical'
        ? 'MOVE YOUR CAR NOW'
        : alert.severity === 'warning'
          ? 'Parking Alert'
          : 'Parking Reminder';

    console.log('[PushNotification] Sending tow alert:', {
      title,
      body: alert.message,
      severity: alert.severity,
    });

    // In production with expo-notifications:
    // await Notifications.scheduleNotificationAsync({
    //   content: {
    //     title,
    //     body: alert.message,
    //     data: {
    //       alertId: alert.id,
    //       type: alert.type,
    //       towRisk: alert.towRisk,
    //     },
    //     sound: config.sound,
    //     priority: config.priority,
    //     vibrationPattern: config.vibrate,
    //     badge: config.badge ? 1 : 0,
    //     interruptionLevel: config.interruptionLevel,
    //   },
    //   trigger: null, // Send immediately
    // });
  }

  /**
   * Schedule a reminder notification
   */
  async scheduleReminder(
    alert: TowAlert,
    reminderTime: Date
  ): Promise<string> {
    const reminderId = `reminder-${Date.now()}`;

    const reminder: ScheduledReminder = {
      id: reminderId,
      alertId: alert.id,
      time: reminderTime,
      title: 'Time to move your car',
      body: alert.actionRequired,
    };

    this.scheduledReminders.set(reminderId, reminder);

    console.log('[PushNotification] Scheduled reminder:', {
      id: reminderId,
      time: reminderTime.toISOString(),
      body: alert.actionRequired,
    });

    // In production:
    // await Notifications.scheduleNotificationAsync({
    //   content: {
    //     title: reminder.title,
    //     body: reminder.body,
    //     data: { alertId: alert.id, reminderId },
    //   },
    //   trigger: {
    //     date: reminderTime,
    //   },
    // });

    return reminderId;
  }

  /**
   * Cancel a scheduled reminder
   */
  async cancelReminder(reminderId: string): Promise<void> {
    this.scheduledReminders.delete(reminderId);

    console.log('[PushNotification] Cancelled reminder:', reminderId);

    // In production:
    // await Notifications.cancelScheduledNotificationAsync(reminderId);
  }

  /**
   * Cancel all reminders for an alert
   */
  async cancelRemindersForAlert(alertId: string): Promise<void> {
    const toCancel: string[] = [];

    for (const [reminderId, reminder] of this.scheduledReminders) {
      if (reminder.alertId === alertId) {
        toCancel.push(reminderId);
      }
    }

    for (const reminderId of toCancel) {
      await this.cancelReminder(reminderId);
    }
  }

  /**
   * Send a snow emergency notification
   */
  async sendSnowEmergencyAlert(
    message: string,
    enforcementStart: Date
  ): Promise<void> {
    console.log('[PushNotification] Sending snow emergency alert:', message);

    // This is always critical
    // await Notifications.scheduleNotificationAsync({
    //   content: {
    //     title: 'SNOW EMERGENCY DECLARED',
    //     body: message,
    //     data: { type: 'snow-emergency' },
    //     ...NOTIFICATION_CONFIGS.critical,
    //   },
    //   trigger: null,
    // });
  }

  /**
   * Send an ASP suspension notification (NYC)
   */
  async sendASPSuspensionAlert(
    suspended: boolean,
    holiday: string
  ): Promise<void> {
    const title = suspended
      ? 'ASP Suspended Today!'
      : 'Alternate Side Parking Today';
    const body = suspended
      ? `No need to move - suspended for ${holiday}`
      : 'Remember to move your car for street cleaning';

    console.log('[PushNotification] Sending ASP alert:', { title, body });

    // await Notifications.scheduleNotificationAsync({
    //   content: {
    //     title,
    //     body,
    //     data: { type: 'asp-status', suspended, holiday },
    //     ...NOTIFICATION_CONFIGS.info,
    //   },
    //   trigger: null,
    // });
  }

  /**
   * Request notification permissions
   */
  async requestPermissions(): Promise<boolean> {
    // In production:
    // const { status } = await Notifications.requestPermissionsAsync();
    // return status === 'granted';

    console.log('[PushNotification] Requesting permissions (stub)');
    return true;
  }

  /**
   * Check if notifications are enabled
   */
  async areNotificationsEnabled(): Promise<boolean> {
    // In production:
    // const { status } = await Notifications.getPermissionsAsync();
    // return status === 'granted';

    return true;
  }

  /**
   * Get all scheduled reminders
   */
  getScheduledReminders(): ScheduledReminder[] {
    return [...this.scheduledReminders.values()];
  }

  /**
   * Clear all notifications
   */
  async clearAllNotifications(): Promise<void> {
    console.log('[PushNotification] Clearing all notifications');

    // In production:
    // await Notifications.dismissAllNotificationsAsync();
  }
}

// Singleton instance
export const pushNotificationService = new PushNotificationService();

export default pushNotificationService;
