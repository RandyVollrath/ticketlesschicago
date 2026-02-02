/**
 * Local Notification Service
 *
 * Schedules local notifications for parking restriction reminders.
 * Uses notifee's createTriggerNotification for time-based scheduling.
 *
 * Key Features:
 * - Schedule reminders based on parking check results
 * - Support for custom reminder times (user preference)
 * - Automatic cancellation when user leaves parking spot
 */

import notifee, {
  TriggerType,
  TimestampTrigger,
  AndroidImportance,
} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';

const log = Logger.createLogger('LocalNotifications');

// Storage keys
const SCHEDULED_NOTIFICATIONS_KEY = 'scheduled_parking_notifications';
const REMINDER_PREFERENCES_KEY = 'parking_reminder_preferences';

// Notification ID prefixes for different restriction types
const NOTIFICATION_PREFIX = {
  STREET_CLEANING: 'street-cleaning-',
  WINTER_BAN: 'winter-ban-',
  SNOW_BAN: 'snow-ban-',
  PERMIT_ZONE: 'permit-zone-',
};

// Default reminder times (hours before restriction starts)
// NOTE: BackgroundTaskService now sends pre-computed notification times
// (9pm night before, 7am morning of, etc.) so these defaults are only used
// as fallbacks when the restriction time IS the notification time (hoursBefore=0).
const DEFAULT_REMINDER_HOURS = {
  STREET_CLEANING: 0, // Pre-computed: 9pm night before + 7am morning of
  WINTER_BAN: 0, // Pre-computed: 9pm notification time sent directly
  PERMIT_ZONE: 0, // Pre-computed: 7am notification time sent directly
};

export interface ReminderPreferences {
  streetCleaningHoursBefore: number;
  winterBanHoursBefore: number;
  permitZoneHoursBefore: number;
  enabled: boolean;
}

export interface ParkingRestriction {
  type: 'street_cleaning' | 'winter_ban' | 'snow_ban' | 'permit_zone';
  restrictionStartTime: Date;
  address: string;
  details?: string;
  latitude?: number;
  longitude?: number;
}

export interface ScheduledNotification {
  id: string;
  type: string;
  scheduledFor: string; // ISO string
  address: string;
}

class LocalNotificationServiceClass {
  private preferences: ReminderPreferences = {
    streetCleaningHoursBefore: DEFAULT_REMINDER_HOURS.STREET_CLEANING,
    winterBanHoursBefore: DEFAULT_REMINDER_HOURS.WINTER_BAN,
    permitZoneHoursBefore: DEFAULT_REMINDER_HOURS.PERMIT_ZONE,
    enabled: true,
  };

  /**
   * Initialize the service and load user preferences
   */
  async initialize(): Promise<void> {
    try {
      await this.loadPreferences();
      log.info('Local notification service initialized');
    } catch (error) {
      log.error('Error initializing local notification service', error);
    }
  }

  /**
   * Load user preferences from storage
   */
  async loadPreferences(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(REMINDER_PREFERENCES_KEY);
      if (stored) {
        this.preferences = { ...this.preferences, ...JSON.parse(stored) };
      }
    } catch (error) {
      log.error('Error loading preferences', error);
    }
  }

  /**
   * Save user preferences
   */
  async savePreferences(preferences: Partial<ReminderPreferences>): Promise<void> {
    try {
      this.preferences = { ...this.preferences, ...preferences };
      await AsyncStorage.setItem(REMINDER_PREFERENCES_KEY, JSON.stringify(this.preferences));
      log.debug('Preferences saved', this.preferences);
    } catch (error) {
      log.error('Error saving preferences', error);
    }
  }

  /**
   * Get current preferences
   */
  getPreferences(): ReminderPreferences {
    return { ...this.preferences };
  }

  /**
   * Schedule notifications based on parking check results
   * Called when user parks (Bluetooth disconnects)
   */
  async scheduleNotificationsForParking(restrictions: ParkingRestriction[]): Promise<void> {
    if (!this.preferences.enabled) {
      log.debug('Local notifications disabled by user preference');
      return;
    }

    // Cancel any existing scheduled notifications first
    await this.cancelAllScheduledNotifications();

    const scheduled: ScheduledNotification[] = [];

    for (const restriction of restrictions) {
      try {
        const notification = await this.scheduleRestrictionNotification(restriction);
        if (notification) {
          scheduled.push(notification);
        }
      } catch (error) {
        log.error(`Error scheduling notification for ${restriction.type}`, error);
      }
    }

    // Store scheduled notifications for tracking
    await AsyncStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(scheduled));
    log.info(`Scheduled ${scheduled.length} parking reminder notifications`);
  }

  /**
   * Schedule a single restriction notification
   */
  private async scheduleRestrictionNotification(
    restriction: ParkingRestriction
  ): Promise<ScheduledNotification | null> {
    const { type, restrictionStartTime, address, details, latitude, longitude } = restriction;

    // Calculate reminder time based on preferences
    let hoursBefore: number;
    let notificationId: string;
    let channelId: string;
    let title: string;
    let body: string;

    switch (type) {
      case 'street_cleaning':
        hoursBefore = 0; // Time is pre-computed by BackgroundTaskService
        notificationId = `${NOTIFICATION_PREFIX.STREET_CLEANING}${Date.now()}`;
        channelId = 'reminders';
        // Detect if this is the morning-of (7am) or night-before (9pm) notification
        if (details?.includes('MOVE YOUR CAR NOW')) {
          title = 'Street Cleaning Today - Move Now!';
          body = `Street cleaning starts at 9am at ${address}. Move your car NOW to avoid a $65 ticket.`;
          channelId = 'parking-alerts'; // Higher priority for urgent morning alert
        } else {
          title = 'Street Cleaning Tomorrow!';
          body = `Street cleaning scheduled tomorrow at ${address}. ${details || 'Move your car tonight to avoid a $65 ticket.'}`;
        }
        break;

      case 'winter_ban':
        hoursBefore = 0; // Time is pre-computed (9pm)
        notificationId = `${NOTIFICATION_PREFIX.WINTER_BAN}${Date.now()}`;
        channelId = 'parking-alerts';
        title = 'Winter Parking Ban Tonight';
        body = `Your car at ${address} is on a winter ban street. Move before 3am to avoid towing ($150+).`;
        break;

      case 'snow_ban':
        // Snow ban is weather-dependent, immediate notification
        notificationId = `${NOTIFICATION_PREFIX.SNOW_BAN}${Date.now()}`;
        channelId = 'parking-alerts';
        title = '2-Inch Snow Ban Alert!';
        body = `Snow ban may be active at ${address}. ${details || 'Check conditions and move if needed.'}`;
        // For snow ban, schedule for 30 minutes from now as a reminder
        hoursBefore = 0;
        break;

      case 'permit_zone':
        hoursBefore = 0; // Time is pre-computed (7am)
        notificationId = `${NOTIFICATION_PREFIX.PERMIT_ZONE}${Date.now()}`;
        channelId = 'reminders';
        title = 'Permit Zone - Move by 8am';
        body = `Your car at ${address} needs a permit. ${details || 'Enforcement starts at 8am - move your car or risk a $65 ticket.'}`;
        break;

      default:
        return null;
    }

    // Calculate notification time
    const notificationTime = new Date(restrictionStartTime.getTime() - hoursBefore * 60 * 60 * 1000);

    // Don't schedule if the notification time is in the past
    if (notificationTime.getTime() <= Date.now()) {
      log.debug(`Skipping ${type} notification - time already passed`);
      return null;
    }

    // Create the trigger
    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: notificationTime.getTime(),
    };

    // Schedule the notification
    await notifee.createTriggerNotification(
      {
        id: notificationId,
        title,
        body,
        data: {
          type: `${type}_reminder`,
          lat: latitude?.toString() || '',
          lng: longitude?.toString() || '',
        },
        android: {
          channelId,
          importance: channelId === 'parking-alerts' ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
          pressAction: { id: 'default' },
          smallIcon: 'ic_notification',
        },
        ios: {
          sound: channelId === 'parking-alerts' ? 'default' : undefined,
        },
      },
      trigger
    );

    log.debug(`Scheduled ${type} notification for ${notificationTime.toISOString()}`);

    return {
      id: notificationId,
      type,
      scheduledFor: notificationTime.toISOString(),
      address,
    };
  }

  /**
   * Schedule a custom notification at a specific time
   * For user-defined reminder times
   */
  async scheduleCustomReminder(
    reminderTime: Date,
    title: string,
    body: string,
    address: string,
    latitude?: number,
    longitude?: number
  ): Promise<string | null> {
    if (reminderTime.getTime() <= Date.now()) {
      log.warn('Cannot schedule notification in the past');
      return null;
    }

    const notificationId = `custom-reminder-${Date.now()}`;

    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: reminderTime.getTime(),
    };

    try {
      await notifee.createTriggerNotification(
        {
          id: notificationId,
          title,
          body,
          data: {
            type: 'custom_reminder',
            lat: latitude?.toString() || '',
            lng: longitude?.toString() || '',
          },
          android: {
            channelId: 'reminders',
            importance: AndroidImportance.DEFAULT,
            pressAction: { id: 'default' },
            smallIcon: 'ic_notification',
          },
          ios: {
            sound: 'default',
          },
        },
        trigger
      );

      // Add to tracked notifications
      const stored = await AsyncStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
      const notifications: ScheduledNotification[] = stored ? JSON.parse(stored) : [];
      notifications.push({
        id: notificationId,
        type: 'custom',
        scheduledFor: reminderTime.toISOString(),
        address,
      });
      await AsyncStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(notifications));

      log.info(`Custom reminder scheduled for ${reminderTime.toISOString()}`);
      return notificationId;
    } catch (error) {
      log.error('Error scheduling custom reminder', error);
      return null;
    }
  }

  /**
   * Cancel all scheduled parking notifications
   * Called when user leaves parking spot (Bluetooth reconnects)
   */
  async cancelAllScheduledNotifications(): Promise<void> {
    try {
      const ids = await notifee.getTriggerNotificationIds();

      // Filter to only cancel parking-related notifications
      const parkingNotificationIds = ids.filter(
        (id) =>
          id.startsWith(NOTIFICATION_PREFIX.STREET_CLEANING) ||
          id.startsWith(NOTIFICATION_PREFIX.WINTER_BAN) ||
          id.startsWith(NOTIFICATION_PREFIX.SNOW_BAN) ||
          id.startsWith(NOTIFICATION_PREFIX.PERMIT_ZONE) ||
          id.startsWith('custom-reminder-')
      );

      for (const id of parkingNotificationIds) {
        await notifee.cancelTriggerNotification(id);
      }

      // Clear stored notifications
      await AsyncStorage.removeItem(SCHEDULED_NOTIFICATIONS_KEY);

      log.info(`Cancelled ${parkingNotificationIds.length} scheduled notifications`);
    } catch (error) {
      log.error('Error cancelling scheduled notifications', error);
    }
  }

  /**
   * Cancel a specific notification by ID
   */
  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await notifee.cancelTriggerNotification(notificationId);

      // Update stored notifications
      const stored = await AsyncStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
      if (stored) {
        const notifications: ScheduledNotification[] = JSON.parse(stored);
        const filtered = notifications.filter((n) => n.id !== notificationId);
        await AsyncStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(filtered));
      }

      log.debug(`Cancelled notification ${notificationId}`);
    } catch (error) {
      log.error('Error cancelling notification', error);
    }
  }

  /**
   * Get list of currently scheduled notifications
   */
  async getScheduledNotifications(): Promise<ScheduledNotification[]> {
    try {
      const stored = await AsyncStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      log.error('Error getting scheduled notifications', error);
      return [];
    }
  }

  /**
   * Update preference for how many hours before to remind
   */
  async setReminderHours(
    type: 'street_cleaning' | 'winter_ban' | 'permit_zone',
    hours: number
  ): Promise<void> {
    const updateKey = {
      street_cleaning: 'streetCleaningHoursBefore',
      winter_ban: 'winterBanHoursBefore',
      permit_zone: 'permitZoneHoursBefore',
    }[type] as keyof ReminderPreferences;

    await this.savePreferences({ [updateKey]: hours });
  }

  /**
   * Enable or disable local notifications
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.savePreferences({ enabled });

    if (!enabled) {
      await this.cancelAllScheduledNotifications();
    }
  }
}

export default new LocalNotificationServiceClass();
