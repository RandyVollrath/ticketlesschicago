import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainerRef, CommonActions } from '@react-navigation/native';
import ApiClient from '../utils/ApiClient';
import AuthService from './AuthService';
import config from '../config/config';
import Logger from '../utils/Logger';

const log = Logger.createLogger('PushNotifications');

const PUSH_TOKEN_KEY = 'pushNotificationToken';
const PUSH_PERMISSION_KEY = 'pushNotificationPermissionStatus';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Notification data types
export type NotificationType =
  | 'parking_alert'
  | 'street_cleaning_reminder'
  | 'snow_ban_alert'
  | 'permit_reminder'
  | 'general';

export interface NotificationData {
  type?: NotificationType;
  severity?: 'critical' | 'warning' | 'info';
  lat?: string;
  lng?: string;
  checkId?: string;
  screen?: string;
}

class PushNotificationServiceClass {
  private token: string | null = null;
  private isInitialized = false;
  private navigationRef: NavigationContainerRef<any> | null = null;
  private pendingNavigation: NotificationData | null = null;

  /**
   * Initialize push notification service
   * Call this when the app starts
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Create notification channels for Android
      if (Platform.OS === 'android') {
        await this.createNotificationChannels();
      }

      // Set up foreground message handler
      messaging().onMessage(async (remoteMessage: any) => {
        log.debug('Push notification received in foreground', remoteMessage?.notification?.title);
        await this.displayLocalNotification(remoteMessage);
      });

      // Set up background message handler
      messaging().setBackgroundMessageHandler(async (remoteMessage: any) => {
        log.debug('Push notification received in background', remoteMessage?.notification?.title);
        // Background notifications are displayed automatically
      });

      // Set up notification response handler
      notifee.onForegroundEvent(({ type, detail }) => {
        if (type === EventType.PRESS) {
          log.debug('User pressed notification', detail.notification?.title);
          this.handleNotificationPress(detail.notification);
        }
      });

      // Check for initial notification (app opened from notification)
      const initialNotification = await messaging().getInitialNotification();
      if (initialNotification) {
        log.debug('App opened from notification', initialNotification?.notification?.title);
        this.handleNotificationPress(initialNotification);
      }

      this.isInitialized = true;
      log.info('Push notification service initialized');
    } catch (error) {
      log.error('Error initializing push notifications', error);
    }
  }

  /**
   * Create Android notification channels
   */
  private async createNotificationChannels(): Promise<void> {
    try {
      await notifee.createChannel({
        id: 'parking-alerts',
        name: 'Parking Alerts',
        description: 'Urgent alerts about parking restrictions at your location',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
      });

      await notifee.createChannel({
        id: 'reminders',
        name: 'Reminders',
        description: 'Reminders about upcoming parking restrictions',
        importance: AndroidImportance.DEFAULT,
        sound: 'default',
      });

      await notifee.createChannel({
        id: 'general',
        name: 'General',
        description: 'General notifications and updates',
        importance: AndroidImportance.LOW,
      });

      log.debug('Notification channels created');
    } catch (error) {
      log.error('Error creating notification channels', error);
      // Don't throw - channels are not critical for app to function
    }
  }

  /**
   * Request push notification permissions and register token
   */
  async requestPermissionAndRegister(): Promise<boolean> {
    try {
      // Request permission
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      // Save permission status
      await AsyncStorage.setItem(PUSH_PERMISSION_KEY, enabled ? 'granted' : 'denied');

      if (!enabled) {
        log.warn('Push notification permission denied');
        return false;
      }

      // Get FCM token
      const token = await messaging().getToken();
      this.token = token;

      // Save token locally
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

      // Register with backend if user is authenticated
      if (AuthService.isAuthenticated()) {
        await this.registerTokenWithBackend(token);
      }

      // Listen for token refresh
      messaging().onTokenRefresh(async (newToken: string) => {
        log.debug('FCM token refreshed');
        this.token = newToken;
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, newToken);

        if (AuthService.isAuthenticated()) {
          await this.registerTokenWithBackend(newToken);
        }
      });

      log.info('Push notifications enabled');
      return true;
    } catch (error) {
      log.error('Error requesting push notification permission', error);
      return false;
    }
  }

  /**
   * Register the push token with the backend
   */
  async registerTokenWithBackend(token?: string): Promise<boolean> {
    try {
      const pushToken = token || this.token || await AsyncStorage.getItem(PUSH_TOKEN_KEY);

      if (!pushToken) {
        log.debug('No push token to register');
        return false;
      }

      if (!AuthService.isAuthenticated()) {
        log.debug('User not authenticated, skipping token registration');
        return false;
      }

      // Use ApiClient with retry logic for reliability
      const response = await ApiClient.authPost<{ success: boolean; tokenId?: string }>(
        '/api/push/register-token',
        {
          token: pushToken,
          platform: Platform.OS as 'ios' | 'android',
          deviceName: `${Platform.OS} device`,
          appVersion: config.APP_VERSION,
        },
        {
          retries: 3,
          timeout: 10000,
        }
      );

      if (!response.success) {
        log.error('Failed to register push token', response.error?.message);
        return false;
      }

      log.info('Push token registered successfully');
      return true;
    } catch (error) {
      log.error('Error registering push token', error);
      return false;
    }
  }

  /**
   * Display a local notification (for foreground messages)
   */
  private async displayLocalNotification(remoteMessage: any): Promise<void> {
    try {
      const notification = remoteMessage?.notification || {};
      const data = remoteMessage?.data || {};

      // Determine channel based on notification type
      let channelId = 'general';
      if (data.type === 'parking_alert' || data.severity === 'critical') {
        channelId = 'parking-alerts';
      } else if (data.type === 'reminder') {
        channelId = 'reminders';
      }

      await notifee.displayNotification({
        title: notification.title || 'Ticketless Chicago',
        body: notification.body || '',
        data: data,
        android: {
          channelId,
          importance: channelId === 'parking-alerts' ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
          pressAction: {
            id: 'default',
          },
          smallIcon: 'ic_notification', // Make sure this icon exists in android/app/src/main/res
        },
        ios: {
          sound: channelId === 'parking-alerts' ? 'default' : undefined,
          critical: data.severity === 'critical',
        },
      });
    } catch (error) {
      log.error('Error displaying local notification', error);
    }
  }

  /**
   * Set the navigation ref for handling notification presses
   * Call this once the NavigationContainer is ready
   */
  setNavigationRef(ref: NavigationContainerRef<any> | null): void {
    this.navigationRef = ref;

    // If there was a pending navigation from a notification opened while nav wasn't ready
    if (ref && this.pendingNavigation) {
      this.navigateFromNotification(this.pendingNavigation);
      this.pendingNavigation = null;
    }
  }

  /**
   * Handle notification press
   */
  private handleNotificationPress(notification: any): void {
    const data: NotificationData = notification?.data || notification?.notification?.data || {};

    log.debug('Handling notification press', data.type);

    // If navigation isn't ready yet, store for later
    if (!this.navigationRef) {
      log.debug('Navigation not ready, storing pending navigation');
      this.pendingNavigation = data;
      return;
    }

    this.navigateFromNotification(data);
  }

  /**
   * Safely parse a coordinate string
   */
  private parseCoordinate(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = parseFloat(value);
    // Validate the coordinate is a valid number and within reasonable bounds
    if (isNaN(parsed) || parsed < -90 || parsed > 90) {
      log.warn('Invalid coordinate value', value);
      return undefined;
    }
    return parsed;
  }

  /**
   * Navigate to the appropriate screen based on notification data
   */
  private navigateFromNotification(data: NotificationData): void {
    if (!this.navigationRef) {
      log.warn('Cannot navigate: navigation ref not set');
      return;
    }

    try {
      log.debug('Navigating from notification', data.type);

      // Handle different notification types
      switch (data.type) {
        case 'parking_alert':
        case 'snow_ban_alert':
          // Navigate to Map screen to show the parking location
          const lat = this.parseCoordinate(data.lat);
          const lng = data.lng ? parseFloat(data.lng) : undefined;
          // Validate lng separately (can be -180 to 180)
          const validLng = lng !== undefined && !isNaN(lng) && lng >= -180 && lng <= 180 ? lng : undefined;

          this.navigationRef.dispatch(
            CommonActions.navigate({
              name: 'MainTabs',
              params: {
                screen: 'Map',
                params: {
                  lat,
                  lng: validLng,
                  fromNotification: true,
                },
              },
            })
          );
          break;

      case 'street_cleaning_reminder':
      case 'permit_reminder':
        // Navigate to Home screen to check parking
        this.navigationRef.dispatch(
          CommonActions.navigate({
            name: 'MainTabs',
            params: {
              screen: 'Home',
              params: {
                autoCheck: true,
                fromNotification: true,
              },
            },
          })
        );
        break;

      default:
        // If a specific screen was provided in the data, navigate there
        if (data.screen) {
          this.navigationRef.dispatch(
            CommonActions.navigate({
              name: 'MainTabs',
              params: {
                screen: data.screen,
              },
            })
          );
        } else {
          // Default: navigate to History to see past checks
          this.navigationRef.dispatch(
            CommonActions.navigate({
              name: 'MainTabs',
              params: {
                screen: 'History',
              },
            })
          );
        }
        break;
      }
    } catch (error) {
      log.error('Error navigating from notification', error);
    }
  }

  /**
   * Check if push notifications are enabled
   */
  async isEnabled(): Promise<boolean> {
    try {
      const status = await AsyncStorage.getItem(PUSH_PERMISSION_KEY);
      return status === 'granted';
    } catch (error) {
      log.error('Error checking push notification status', error);
      return false;
    }
  }

  /**
   * Get the current push token
   */
  async getToken(): Promise<string | null> {
    try {
      if (this.token) return this.token;
      return AsyncStorage.getItem(PUSH_TOKEN_KEY);
    } catch (error) {
      log.error('Error getting push token', error);
      return null;
    }
  }

  /**
   * Unregister push notifications (for logout)
   */
  async unregister(): Promise<void> {
    try {
      // Delete token from Firebase
      await messaging().deleteToken();

      // Clear local storage
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
      this.token = null;

      log.info('Push notifications unregistered');
    } catch (error) {
      log.error('Error unregistering push notifications', error);
    }
  }

  /**
   * Send a test local notification
   */
  async sendTestNotification(): Promise<boolean> {
    try {
      await notifee.displayNotification({
        title: 'Test Notification',
        body: 'Push notifications are working correctly!',
        android: {
          channelId: 'general',
          pressAction: {
            id: 'default',
          },
        },
      });
      return true;
    } catch (error) {
      log.error('Error sending test notification', error);
      return false;
    }
  }
}

export default new PushNotificationServiceClass();
