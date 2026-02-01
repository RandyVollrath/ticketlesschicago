/**
 * BackgroundTaskService
 *
 * Handles background tasks for the app, including:
 * - Periodic Bluetooth connection checks
 * - Auto parking checks when car disconnects
 * - Background location updates
 *
 * Uses react-native-background-fetch for iOS/Android background execution.
 * Falls back to foreground-only monitoring if background fetch is not available.
 */

import { Platform, AppState, AppStateStatus, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance } from '@notifee/react-native';
import BluetoothService from './BluetoothService';
import MotionActivityService from './MotionActivityService';
import BackgroundLocationService, { ParkingDetectedEvent } from './BackgroundLocationService';
import LocationService from './LocationService';
import LocalNotificationService, { ParkingRestriction } from './LocalNotificationService';
import { ParkingHistoryService } from '../screens/HistoryScreen';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('BackgroundTaskService');

// Background task configuration
const BACKGROUND_TASK_ID = 'ticketless-parking-check';
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_DISCONNECT_DURATION_MS = 30 * 1000; // 30 seconds (to avoid false positives)
const DEPARTURE_CONFIRMATION_DELAY_MS = 120 * 1000; // 2 minutes after car starts

interface BackgroundTaskState {
  isInitialized: boolean;
  isMonitoring: boolean;
  lastCarConnectionStatus: boolean;
  lastDisconnectTime: number | null;
  lastParkingCheckTime: number | null;
  // Departure tracking
  pendingDepartureConfirmation: {
    parkingHistoryId: string;
    parkedLocation: { latitude: number; longitude: number };
    clearedAt: string;
    retryCount: number;
    scheduledAt: number; // timestamp when confirmation was scheduled
  } | null;
}

const MAX_DEPARTURE_RETRIES = 3;
const DEPARTURE_RETRY_DELAY_MS = 60 * 1000; // 1 minute between retries

class BackgroundTaskServiceClass {
  private state: BackgroundTaskState = {
    isInitialized: false,
    isMonitoring: false,
    lastCarConnectionStatus: false,
    lastDisconnectTime: null,
    lastParkingCheckTime: null,
    pendingDepartureConfirmation: null,
  };

  private appStateSubscription: any = null;
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private disconnectCallback: (() => void) | null = null;
  private reconnectCallback: (() => void) | null = null;
  private departureConfirmationTimeout: ReturnType<typeof setTimeout> | null = null;
  private gpsCacheInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize the background task service
   */
  async initialize(): Promise<void> {
    if (this.state.isInitialized) {
      log.debug('BackgroundTaskService already initialized');
      return;
    }

    try {
      // Load persisted state
      await this.loadState();

      // Setup app state listener for foreground/background transitions
      this.appStateSubscription = AppState.addEventListener(
        'change',
        this.handleAppStateChange.bind(this)
      );

      // Create notification channel for background alerts
      await this.createNotificationChannel();

      // Initialize local notification scheduling service
      await LocalNotificationService.initialize();

      // iOS: Self-test native modules to catch build issues early
      if (Platform.OS === 'ios') {
        await this.iosSelfTest();
      }

      this.state.isInitialized = true;
      log.info('BackgroundTaskService initialized');
    } catch (error) {
      log.error('Failed to initialize BackgroundTaskService', error);
    }
  }

  /**
   * iOS self-test: verify native modules are actually loaded and responding.
   * This catches the exact problem we had where .swift files existed on disk
   * but weren't compiled into the app.
   */
  private async iosSelfTest(): Promise<void> {
    const bgModule = NativeModules.BackgroundLocationModule;
    const motionModule = NativeModules.MotionActivityModule;

    const results: string[] = [];

    // Test BackgroundLocationModule
    if (!bgModule) {
      results.push('BackgroundLocationModule: NOT LOADED (Swift file not compiled?)');
      log.error('BackgroundLocationModule native module is NULL - not in Xcode build');
    } else {
      try {
        const status = await bgModule.getPermissionStatus();
        results.push(`BackgroundLocationModule: OK (perm=${status})`);
        log.info(`BackgroundLocationModule self-test passed. Permission: ${status}`);
      } catch (e) {
        results.push(`BackgroundLocationModule: LOADED but error (${String(e)})`);
        log.error('BackgroundLocationModule self-test call failed:', e);
      }
    }

    // Test MotionActivityModule
    if (!motionModule) {
      results.push('MotionActivityModule: NOT LOADED');
      log.error('MotionActivityModule native module is NULL - not in Xcode build');
    } else {
      try {
        const available = await motionModule.isAvailable();
        results.push(`MotionActivityModule: OK (available=${available})`);
        log.info(`MotionActivityModule self-test passed. Available: ${available}`);
      } catch (e) {
        results.push(`MotionActivityModule: LOADED but error (${String(e)})`);
        log.error('MotionActivityModule self-test call failed:', e);
      }
    }

    // Send one diagnostic notification with all results
    await this.sendDiagnosticNotification(
      'iOS Module Check',
      results.join('\n')
    );
  }

  /**
   * Create notification channel for parking alerts
   */
  private async createNotificationChannel(): Promise<void> {
    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id: 'parking-monitoring',
        name: 'Parking Monitoring',
        importance: AndroidImportance.HIGH,
        description: 'Notifications for parking monitoring and car disconnection alerts',
      });
    }
  }

  /**
   * Start monitoring for car disconnection and reconnection
   */
  async startMonitoring(
    onDisconnect?: () => void,
    onReconnect?: () => void
  ): Promise<boolean> {
    try {
      this.disconnectCallback = onDisconnect || null;
      this.reconnectCallback = onReconnect || null;
      this.state.isMonitoring = true;
      this.state.lastCarConnectionStatus = true; // Assume connected at start

      // Start foreground monitoring
      await this.startForegroundMonitoring();

      await this.saveState();
      log.info('Monitoring started');
      return true;
    } catch (error) {
      log.error('Failed to start monitoring', error);
      return false;
    }
  }

  /**
   * Stop all monitoring
   */
  async stopMonitoring(): Promise<void> {
    this.state.isMonitoring = false;

    // Stop foreground monitoring
    this.stopForegroundMonitoring();

    // Stop Bluetooth monitoring
    BluetoothService.stopMonitoring();

    // Clear departure confirmation timeout
    if (this.departureConfirmationTimeout) {
      clearTimeout(this.departureConfirmationTimeout);
      this.departureConfirmationTimeout = null;
    }

    this.disconnectCallback = null;
    this.reconnectCallback = null;
    await this.saveState();
    log.info('Monitoring stopped');
  }

  /**
   * Start foreground monitoring with interval checks
   * Uses different strategies depending on platform:
   * - iOS: Motion-based detection (speed/activity monitoring)
   * - Android: Bluetooth Classic connection monitoring
   */
  private async startForegroundMonitoring(): Promise<void> {
    // Clear any existing interval
    this.stopForegroundMonitoring();

    if (Platform.OS === 'ios') {
      // iOS: Use background location + motion detection
      // This keeps the app alive in the background via CLLocationManager
      // CoreMotion detects driving→parked transitions
      log.info('Starting background location parking detection for iOS');
      try {
        if (BackgroundLocationService.isAvailable()) {
          // Request permissions first
          const permStatus = await BackgroundLocationService.requestPermissions();
          log.info('Background location permission:', permStatus);

          if (permStatus === 'denied' || permStatus === 'restricted') {
            log.error('Location permission denied/restricted - parking detection will NOT work');
            await this.sendDiagnosticNotification(
              'Location Permission Required',
              'Autopilot needs "Always" location access to detect parking. Go to Settings > Privacy > Location Services > Autopilot and select "Always".'
            );
          } else if (permStatus === 'when_in_use') {
            log.warn('Only "When In Use" permission - background detection may not work reliably');
            await this.sendDiagnosticNotification(
              'Upgrade Location Permission',
              'For reliable parking detection, Autopilot needs "Always" location access. Go to Settings > Privacy > Location Services > Autopilot and change to "Always".'
            );
          } else if (permStatus === 'not_determined') {
            log.warn('Location permission not yet determined - will prompt user');
            await this.sendDiagnosticNotification(
              'Location Permission Needed',
              'Please allow location access when prompted. Choose "Always Allow" for automatic parking detection.'
            );
          }

          // Start monitoring - this handles everything:
          // significant location changes, continuous updates, motion detection
          const bgStarted = await BackgroundLocationService.startMonitoring(
            // onParkingDetected - fires when user stops driving for 90+ seconds
            async (event: ParkingDetectedEvent) => {
              log.info('PARKING DETECTED via background location', {
                lat: event.latitude,
                lng: event.longitude,
                accuracy: event.accuracy,
                drivingDuration: event.drivingDurationSec,
                locationSource: event.locationSource,
                driftMeters: event.driftFromParkingMeters,
              });
              await this.sendDiagnosticNotification(
                'Parking Detected (iOS)',
                `CoreMotion detected you parked. Duration: ${Math.round(event.drivingDurationSec || 0)}s driving. Checking parking rules...`
              );
              // Pass the stop-start coordinates so we check parking rules
              // at where the CAR is, not where the user walked to
              const parkingCoords = event.latitude && event.longitude
                ? { latitude: event.latitude, longitude: event.longitude, accuracy: event.accuracy }
                : undefined;
              await this.handleCarDisconnection(parkingCoords);
            },
            // onDrivingStarted - fires when user starts driving
            () => {
              log.info('DRIVING STARTED - user departing');
              this.handleCarReconnection();
            }
          );
          log.info(`BackgroundLocationService.startMonitoring returned: ${bgStarted}`);
          if (!bgStarted) {
            log.error('BackgroundLocationService failed to start - falling back to motion');
            throw new Error('BackgroundLocationService.startMonitoring returned false');
          }

          // Send startup diagnostic with full status
          const bgStatus = await BackgroundLocationService.getStatus();
          await this.sendDiagnosticNotification(
            'iOS Monitoring Active',
            `Permission: ${permStatus}, CoreMotion: ${bgStatus.motionAvailable ? 'YES' : 'NO'}, Always: ${bgStatus.hasAlwaysPermission ? 'YES' : 'NO'}. Drive for 2+ min then park to test.`
          );
        } else {
          // Fallback to motion-only (less reliable in background)
          log.warn('BackgroundLocationModule not available, falling back to motion-only');
          await this.sendDiagnosticNotification(
            'iOS: Using Fallback Detection',
            'BackgroundLocationModule not available. Using motion-only detection (less reliable in background).'
          );
          await MotionActivityService.startMonitoring(
            this.handleCarDisconnection.bind(this),
            this.handleCarReconnection.bind(this)
          );
        }
      } catch (error) {
        log.warn('Could not start iOS monitoring:', error);
        // Try motion as last resort
        try {
          await MotionActivityService.startMonitoring(
            this.handleCarDisconnection.bind(this),
            this.handleCarReconnection.bind(this)
          );
          log.info('Fallback motion monitoring started');
          await this.sendDiagnosticNotification(
            'iOS: Fallback Mode',
            `Main detection failed (${String(error)}). Using motion-only fallback.`
          );
        } catch (motionError) {
          log.error('Motion monitoring also failed:', motionError);
          await this.sendDiagnosticNotification(
            'Parking Detection Failed',
            `Could not start any detection method. Main: ${String(error)}. Motion: ${String(motionError)}. Please restart the app.`
          );
        }
      }
    } else {
      // Android: Use Bluetooth Classic connection monitoring
      log.info('Starting Bluetooth-based parking detection for Android');
      const savedDevice = await BluetoothService.getSavedCarDevice();
      if (!savedDevice) {
        log.error('No saved car device - Bluetooth monitoring cannot start. User must pair a car in Settings.');
        await this.sendDiagnosticNotification(
          'No Car Paired',
          'Go to Settings in the app and select your car from Bluetooth devices.'
        );
        // Don't throw - periodic check will still run as backup
      } else {
        log.info(`Saved car device found: ${savedDevice.name} (${savedDevice.address || savedDevice.id})`);
        try {
          await BluetoothService.monitorCarConnection(
            async () => {
              log.info('BT DISCONNECT EVENT FIRED - triggering parking check');
              await this.sendDiagnosticNotification(
                'Bluetooth Disconnect Detected',
                `${savedDevice.name} disconnected. Checking parking rules...`
              );
              await this.handleCarDisconnection();
            },
            async () => {
              log.info('BT CONNECT EVENT FIRED - car reconnected');
              await this.handleCarReconnection();
            }
          );
          log.info('Bluetooth monitoring active for: ' + savedDevice.name);

          // Pre-cache GPS location periodically while car is connected.
          // This ensures we have a recent location when BT disconnect fires,
          // even if background GPS acquisition fails at that moment.
          this.startGpsCaching();
        } catch (error) {
          log.error('Could not start Bluetooth monitoring:', error);
          await this.sendDiagnosticNotification(
            'Bluetooth Monitoring Failed',
            `Could not monitor ${savedDevice.name}. Error: ${error}`
          );
        }
      }
    }

    // Also run periodic checks as a backup
    this.monitoringInterval = setInterval(
      () => this.performPeriodicCheck(),
      CHECK_INTERVAL_MS
    );

    // Check if there's a pending departure confirmation from app restart
    if (this.state.pendingDepartureConfirmation) {
      log.info('Found pending departure confirmation from previous session, scheduling...');
      this.scheduleDepartureConfirmation();
    }

    log.debug('Foreground monitoring started');
  }

  /**
   * Handle car reconnection event (Bluetooth reconnects)
   * This triggers departure tracking
   */
  private async handleCarReconnection(): Promise<void> {
    log.info('Car reconnection detected via Bluetooth');
    await this.markCarReconnected();
  }

  /**
   * Stop foreground monitoring
   */
  private stopForegroundMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    // Stop GPS caching
    this.stopGpsCaching();

    // Stop platform-specific monitoring
    if (Platform.OS === 'ios') {
      BackgroundLocationService.stopMonitoring();
      MotionActivityService.stopMonitoring();
    }
  }

  /**
   * Pre-cache GPS location periodically (Android).
   * While the car is connected via Bluetooth, we periodically get the user's
   * location and cache it. When BT disconnect fires (possibly in background),
   * we can use the cached location even if fresh GPS fails.
   */
  private startGpsCaching(): void {
    this.stopGpsCaching();

    // Cache GPS every 60 seconds while app is in foreground
    const GPS_CACHE_INTERVAL = 60 * 1000;

    // Get initial cache immediately
    this.cacheCurrentGps();

    this.gpsCacheInterval = setInterval(() => {
      // Only cache when app is active (foreground) to save battery
      if (AppState.currentState === 'active') {
        this.cacheCurrentGps();
      }
    }, GPS_CACHE_INTERVAL);

    log.debug('GPS pre-caching started (60s interval while foreground)');
  }

  private stopGpsCaching(): void {
    if (this.gpsCacheInterval) {
      clearInterval(this.gpsCacheInterval);
      this.gpsCacheInterval = null;
    }
  }

  private async cacheCurrentGps(): Promise<void> {
    try {
      const coords = await LocationService.getCurrentLocation('balanced');
      // The location is automatically cached inside LocationService via getLocationWithRetry
      // but getCurrentLocation doesn't cache, so let's do it manually
      if (coords.latitude && coords.longitude) {
        log.debug(`GPS cached: ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)} ±${coords.accuracy?.toFixed(0) || '?'}m`);
      }
    } catch (error) {
      // Silent failure - this is just pre-caching
      log.debug('GPS pre-cache failed (non-critical):', error);
    }
  }

  /**
   * Handle car disconnection event
   * @param parkingCoords - Optional pre-determined parking coordinates from
   *   BackgroundLocationService (iOS). These are captured at the moment the car
   *   stops, BEFORE the user walks away. Using these avoids the 90-second walk problem.
   */
  private async handleCarDisconnection(parkingCoords?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  }): Promise<void> {
    log.info('=== CAR DISCONNECTION HANDLER TRIGGERED ===');
    log.info(`Parking coords provided: ${parkingCoords ? `${parkingCoords.latitude.toFixed(6)}, ${parkingCoords.longitude.toFixed(6)}` : 'NO (will get GPS)'}`);

    // Record disconnect time
    this.state.lastDisconnectTime = Date.now();
    this.state.lastCarConnectionStatus = false;
    await this.saveState();

    // Check parking - use provided coords if available (iOS background location)
    await this.triggerParkingCheck(parkingCoords);

    // Call the callback if provided (HomeScreen UI refresh)
    if (this.disconnectCallback) {
      try {
        await Promise.resolve(this.disconnectCallback());
      } catch (err) {
        log.error('Error in disconnect callback (UI refresh):', err);
      }
    }
  }

  /**
   * Trigger a parking check at current location
   * @param presetCoords - If provided, skip GPS acquisition and use these coordinates.
   *   This is used on iOS where BackgroundLocationModule captures the location at the
   *   exact moment the car stops (before user walks away from it).
   */
  private async triggerParkingCheck(presetCoords?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  }): Promise<void> {
    try {
      log.info('=== TRIGGERING PARKING CHECK ===');

      let coords;
      let gpsSource = 'unknown';

      // On iOS with background location, we already have the parking spot coordinates
      // captured at the moment the car stopped. Use those instead of getting a fresh fix.
      if (presetCoords?.latitude && presetCoords?.longitude) {
        coords = presetCoords;
        gpsSource = 'pre-captured (iOS)';
        log.info(`Using pre-captured parking location: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} ±${coords.accuracy?.toFixed(1) || '?'}m`);
      } else {
        // Android (Bluetooth disconnect) or fallback: get fresh GPS
        // NOTE: On Android, BT disconnect may fire while app is in background.
        // GPS access in background requires ACCESS_BACKGROUND_LOCATION permission.
        // We try multiple strategies with generous timeouts to handle this.
        log.info(`Getting GPS location... (Platform: ${Platform.OS}, appState: ${AppState.currentState})`);

        // Strategy 1: Try cached location first (may be very recent if user just parked)
        const cachedCoords = LocationService.getCachedLocation();
        if (cachedCoords && cachedCoords.accuracy && cachedCoords.accuracy <= 50) {
          log.info(`Using cached location (${cachedCoords.accuracy.toFixed(1)}m accuracy, very recent)`);
          coords = cachedCoords;
          gpsSource = `cached (${cachedCoords.accuracy.toFixed(1)}m)`;
        } else {
          // Strategy 2: Try high accuracy GPS with longer timeout for background
          try {
            const timeout = Platform.OS === 'android' ? 25000 : 15000; // Extra time on Android background
            coords = await LocationService.getHighAccuracyLocation(50, timeout); // Accept up to 50m in background
            gpsSource = `high-accuracy (${coords.accuracy?.toFixed(1)}m)`;
            log.info(`Got high-accuracy location: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} ±${coords.accuracy?.toFixed(1)}m`);
          } catch (gpsError) {
            log.warn('High accuracy GPS failed:', gpsError);

            // Strategy 3: Retry with balanced accuracy
            try {
              log.info('Trying balanced accuracy GPS with retry...');
              coords = await LocationService.getLocationWithRetry(3);
              gpsSource = `retry-balanced (${coords.accuracy?.toFixed(1)}m)`;
              log.info(`Got retry location: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`);
            } catch (retryError) {
              // Strategy 4: Use stale cached location (better than nothing)
              const staleCoords = LocationService.getLastKnownLocation();
              if (staleCoords) {
                log.info('Using stale cached location as last resort');
                coords = staleCoords;
                gpsSource = `stale-cache (${staleCoords.accuracy?.toFixed(1) || '?'}m)`;
              } else if (Platform.OS === 'ios') {
                // Strategy 5 (iOS only): use the last driving location from BackgroundLocationService
                const lastDriving = await BackgroundLocationService.getLastDrivingLocation();
                if (lastDriving) {
                  log.info('Using last driving location as parking location fallback');
                  coords = {
                    latitude: lastDriving.latitude,
                    longitude: lastDriving.longitude,
                    accuracy: lastDriving.accuracy,
                  };
                  gpsSource = 'last-driving-fallback';
                } else {
                  log.error('ALL GPS methods failed - no location available');
                  await this.sendDiagnosticNotification(
                    'GPS Failed',
                    'Could not get your location. Make sure Location Services are enabled and set to "Always". Error: ' + String(retryError)
                  );
                  throw retryError;
                }
              } else {
                log.error('ALL GPS methods failed on Android');
                await this.sendDiagnosticNotification(
                  'GPS Failed',
                  'Could not get your location. Make sure Location is set to "Allow all the time" in Android settings. Try opening the app and checking manually. Error: ' + String(retryError)
                );
                throw retryError;
              }
            }
          }
        }
      }

      log.info(`GPS acquired via ${gpsSource}. Now calling parking API...`);

      // Check parking rules
      let result;
      try {
        result = await LocationService.checkParkingLocation(coords);
      } catch (apiError) {
        log.error('Parking API call failed:', apiError);
        await this.sendDiagnosticNotification(
          'Parking API Failed',
          `Got GPS (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}) but API call failed: ${String(apiError)}`
        );
        throw apiError;
      }

      // Save the result
      await LocationService.saveParkingCheckResult(result);

      // Update last check time
      this.state.lastParkingCheckTime = Date.now();
      await this.saveState();

      // Send notification if there are restrictions
      if (result.rules.length > 0) {
        await this.sendParkingNotification(result, coords.accuracy);

        // Schedule local notifications for upcoming restrictions
        await this.scheduleRestrictionReminders(result, coords);
      } else {
        await this.sendSafeNotification(result.address, coords.accuracy);
      }

      log.info('=== PARKING CHECK COMPLETE ===', {
        rulesFound: result.rules.length,
        address: result.address,
        gpsSource,
        accuracy: coords.accuracy ? `${coords.accuracy.toFixed(1)}m` : 'unknown',
      });
    } catch (error) {
      log.error('=== PARKING CHECK FAILED ===', error);
      // Only send generic error if we haven't already sent a specific diagnostic
      await this.sendErrorNotification();
    }
  }

  /**
   * Schedule local notifications for upcoming restrictions
   * These fire before each restriction begins, giving user time to move
   */
  private async scheduleRestrictionReminders(
    result: any,
    coords: { latitude: number; longitude: number }
  ): Promise<void> {
    const restrictions: ParkingRestriction[] = [];

    // Parse the API response to extract restriction times
    // The result comes from LocationService.checkParkingLocation which returns
    // data from the check-parking API with streetCleaning, winterOvernightBan, etc.

    // Street cleaning reminder
    if (result.streetCleaning?.hasRestriction && result.streetCleaning?.nextDate) {
      // Street cleaning typically starts at 9am on the scheduled day
      // Parse date carefully - nextDate is in YYYY-MM-DD format
      const dateParts = result.streetCleaning.nextDate.split('-');
      if (dateParts.length === 3) {
        const cleaningDate = new Date(
          parseInt(dateParts[0], 10),
          parseInt(dateParts[1], 10) - 1, // Month is 0-indexed
          parseInt(dateParts[2], 10),
          9, 0, 0, 0 // 9 AM local time
        );

        // Only schedule if the date is valid and in the future
        if (!isNaN(cleaningDate.getTime()) && cleaningDate.getTime() > Date.now()) {
          restrictions.push({
            type: 'street_cleaning',
            restrictionStartTime: cleaningDate,
            address: result.address,
            details: result.streetCleaning.schedule || 'Street cleaning - move your car',
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
        }
      }
    }

    // Winter overnight ban reminder (3am-7am, Dec 1 - Apr 1)
    if (result.winterOvernightBan?.active || result.winterBan?.found) {
      const now = new Date();
      const currentHour = now.getHours();

      // Only schedule if NOT currently in ban hours (3am-7am)
      if (currentHour < 3 || currentHour >= 7) {
        const next3am = new Date(now);
        next3am.setHours(3, 0, 0, 0);
        next3am.setMinutes(0);
        next3am.setSeconds(0);
        next3am.setMilliseconds(0);

        // If it's past 3am (meaning 7am or later), schedule for tomorrow 3am
        if (currentHour >= 7) {
          next3am.setDate(next3am.getDate() + 1);
        }

        restrictions.push({
          type: 'winter_ban',
          restrictionStartTime: next3am,
          address: result.address,
          details: 'Winter overnight parking ban (3am-7am)',
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      }
      // If currently in ban hours (3am-7am), don't schedule - user should already know
    }

    // Permit zone reminder
    if (result.permitZone?.inPermitZone && !result.permitZone?.permitRequired) {
      // Not currently enforced but will be - schedule reminder before enforcement starts
      // Default permit enforcement is Mon-Fri 6am-6pm
      const now = new Date();
      const currentHour = now.getHours();
      const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday

      const next6am = new Date(now);
      next6am.setHours(6, 0, 0, 0);
      next6am.setMinutes(0);
      next6am.setSeconds(0);
      next6am.setMilliseconds(0);

      // Determine if we need to move to a future date
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isPast6amToday = currentHour >= 6;

      if (isWeekend || isPast6amToday) {
        // Move to tomorrow first
        next6am.setDate(next6am.getDate() + 1);

        // Now check if tomorrow is a weekend and skip to Monday
        let nextDay = next6am.getDay();
        while (nextDay === 0 || nextDay === 6) {
          next6am.setDate(next6am.getDate() + 1);
          nextDay = next6am.getDay();
        }
      }

      restrictions.push({
        type: 'permit_zone',
        restrictionStartTime: next6am,
        address: result.address,
        details: `${result.permitZone.zoneName || 'Permit zone'} - ${result.permitZone.restrictionSchedule || 'Mon-Fri 6am-6pm'}`,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    }

    // Snow ban - weather dependent, handled by push notifications from backend
    // We could add a placeholder here but snow bans are triggered by weather, not time

    if (restrictions.length > 0) {
      await LocalNotificationService.scheduleNotificationsForParking(restrictions);
      log.info(`Scheduled ${restrictions.length} local reminder notifications`);
    }
  }

  /**
   * Send notification about parking restrictions
   */
  private async sendParkingNotification(
    result: {
      address: string;
      rules: Array<{ message: string; severity: string }>;
    },
    accuracy?: number
  ): Promise<void> {
    const hasCritical = result.rules.some(r => r.severity === 'critical');
    const accuracyNote = accuracy ? ` (GPS: ${accuracy.toFixed(0)}m)` : '';

    await notifee.displayNotification({
      title: hasCritical ? 'Parking Restriction Active!' : 'Parking Alert',
      body: `At ${result.address}${accuracyNote}:\n${result.rules.map(r => r.message).join('\n')}`,
      android: {
        channelId: 'parking-monitoring',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        smallIcon: 'ic_notification', // You'll need to add this icon
      },
      ios: {
        sound: 'default',
        critical: hasCritical,
        criticalVolume: 1.0,
      },
    });
  }

  /**
   * Send notification that parking is safe
   */
  private async sendSafeNotification(address: string, accuracy?: number): Promise<void> {
    const accuracyNote = accuracy ? ` (GPS: ${accuracy.toFixed(0)}m)` : '';
    await notifee.displayNotification({
      title: 'Parking Check Complete',
      body: `No restrictions found at ${address}${accuracyNote}. You're good to park!`,
      android: {
        channelId: 'parking-monitoring',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
      },
    });
  }

  /**
   * Send error notification
   */
  private async sendErrorNotification(): Promise<void> {
    await notifee.displayNotification({
      title: 'Parking Check Failed',
      body: 'Could not check parking rules. Please check manually.',
      android: {
        channelId: 'parking-monitoring',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
      },
    });
  }

  /**
   * Send a diagnostic notification (visible to user for debugging)
   * These help diagnose detection issues in the field
   */
  private async sendDiagnosticNotification(title: string, body: string): Promise<void> {
    try {
      await notifee.displayNotification({
        title: `[Autopilot] ${title}`,
        body,
        android: {
          channelId: 'parking-monitoring',
          pressAction: { id: 'default' },
        },
        ios: {
          sound: 'default',
        },
      });
    } catch (error) {
      log.error('Failed to send diagnostic notification', error);
    }
  }

  /**
   * Perform periodic check (backup mechanism)
   */
  private async performPeriodicCheck(): Promise<void> {
    if (!this.state.isMonitoring) return;

    log.debug('Performing periodic Bluetooth check');

    try {
      const savedDevice = await BluetoothService.getSavedCarDevice();
      if (!savedDevice) {
        log.warn('No saved device during periodic check');
        return;
      }

      // If we were connected but now detect disconnect, trigger parking check
      const wasConnected = this.state.lastCarConnectionStatus;
      // Note: Actual connection check would require scanning, which may not be possible in background
      // This serves as a fallback mechanism

      if (wasConnected && !this.state.lastCarConnectionStatus) {
        // Connection was lost, check if we should trigger parking check
        const timeSinceDisconnect = this.state.lastDisconnectTime
          ? Date.now() - this.state.lastDisconnectTime
          : Infinity;

        const timeSinceLastCheck = this.state.lastParkingCheckTime
          ? Date.now() - this.state.lastParkingCheckTime
          : Infinity;

        // Only trigger if enough time has passed since last check
        if (
          timeSinceDisconnect > MIN_DISCONNECT_DURATION_MS &&
          timeSinceLastCheck > CHECK_INTERVAL_MS
        ) {
          await this.triggerParkingCheck();
        }
      }
    } catch (error) {
      log.error('Error in periodic check', error);
    }
  }

  /**
   * Handle app state changes (foreground/background)
   */
  private handleAppStateChange(nextAppState: AppStateStatus): void {
    log.debug('App state changed:', nextAppState);

    if (nextAppState === 'active' && this.state.isMonitoring) {
      // App came to foreground, restart monitoring
      this.startForegroundMonitoring();
    } else if (nextAppState === 'background' && this.state.isMonitoring) {
      // App went to background
      // Foreground monitoring continues, background fetch handles the rest
      log.info('App entered background, monitoring continues');
    }
  }

  /**
   * Load persisted state from storage
   */
  private async loadState(): Promise<void> {
    try {
      const stateJson = await AsyncStorage.getItem(StorageKeys.BACKGROUND_TASK_STATE);
      if (stateJson) {
        const savedState = JSON.parse(stateJson);
        this.state = { ...this.state, ...savedState };
      }
    } catch (error) {
      log.error('Error loading background task state', error);
    }
  }

  /**
   * Save state to storage
   */
  private async saveState(): Promise<void> {
    try {
      await AsyncStorage.setItem(StorageKeys.BACKGROUND_TASK_STATE, JSON.stringify({
        isMonitoring: this.state.isMonitoring,
        lastCarConnectionStatus: this.state.lastCarConnectionStatus,
        lastDisconnectTime: this.state.lastDisconnectTime,
        lastParkingCheckTime: this.state.lastParkingCheckTime,
        isInitialized: this.state.isInitialized,
        pendingDepartureConfirmation: this.state.pendingDepartureConfirmation,
      }));
    } catch (error) {
      log.error('Error saving background task state', error);
    }
  }

  /**
   * Get current monitoring status
   */
  getStatus(): {
    isMonitoring: boolean;
    lastCheckTime: number | null;
    isCarConnected: boolean;
  } {
    return {
      isMonitoring: this.state.isMonitoring,
      lastCheckTime: this.state.lastParkingCheckTime,
      isCarConnected: this.state.lastCarConnectionStatus,
    };
  }

  /**
   * Manually trigger a parking check
   */
  async manualParkingCheck(): Promise<void> {
    await this.triggerParkingCheck();
  }

  /**
   * Mark car as reconnected (user feedback or detection)
   * This triggers the clear parked location API and schedules departure confirmation
   */
  async markCarReconnected(): Promise<void> {
    log.info('Car reconnection detected');

    this.state.lastCarConnectionStatus = true;
    this.state.lastDisconnectTime = null;
    await this.saveState();

    // Cancel any scheduled parking reminder notifications
    await LocalNotificationService.cancelAllScheduledNotifications();
    log.info('Cancelled scheduled parking reminders');

    // Call the reconnect callback if provided
    if (this.reconnectCallback) {
      this.reconnectCallback();
    }

    // Clear the parked location and get history ID for departure confirmation
    try {
      const response = await LocationService.clearParkedLocation();

      if (response.parking_history_id && response.parked_location) {
        log.info('Parked location cleared, scheduling departure confirmation', {
          historyId: response.parking_history_id,
          delayMs: DEPARTURE_CONFIRMATION_DELAY_MS,
        });

        // Store pending departure confirmation
        this.state.pendingDepartureConfirmation = {
          parkingHistoryId: response.parking_history_id,
          parkedLocation: response.parked_location,
          clearedAt: response.cleared_at,
          retryCount: 0,
          scheduledAt: Date.now(),
        };
        await this.saveState();

        // Schedule departure confirmation after delay
        this.scheduleDepartureConfirmation();
      }
    } catch (error) {
      log.error('Failed to clear parked location on reconnect', error);
    }
  }

  /**
   * Schedule departure confirmation after a delay
   * This captures the user's location ~2 minutes after leaving to prove they left
   */
  private scheduleDepartureConfirmation(): void {
    // Clear any existing timeout
    if (this.departureConfirmationTimeout) {
      clearTimeout(this.departureConfirmationTimeout);
    }

    this.departureConfirmationTimeout = setTimeout(async () => {
      await this.confirmDeparture();
    }, DEPARTURE_CONFIRMATION_DELAY_MS);

    log.info(`Departure confirmation scheduled in ${DEPARTURE_CONFIRMATION_DELAY_MS / 1000}s`);
  }

  /**
   * Confirm departure by capturing current location
   * This proves the user was no longer at their parking spot at this time
   */
  private async confirmDeparture(): Promise<void> {
    if (!this.state.pendingDepartureConfirmation) {
      log.debug('No pending departure confirmation');
      return;
    }

    const pending = this.state.pendingDepartureConfirmation;

    try {
      log.info('Confirming departure...', { attempt: pending.retryCount + 1 });

      // Get current location with high accuracy
      let coords;
      try {
        coords = await LocationService.getHighAccuracyLocation(30, 20000);
        log.info(`Got departure location: ${coords.accuracy?.toFixed(1)}m accuracy`);
      } catch (error) {
        log.warn('High accuracy location failed for departure, trying fallback', error);
        coords = await LocationService.getLocationWithRetry(3);
      }

      // Call the confirm-departure API
      const result = await LocationService.confirmDeparture(
        pending.parkingHistoryId,
        coords.latitude,
        coords.longitude,
        coords.accuracy
      );

      log.info('Departure confirmed:', {
        distance: result.distance_from_parked_meters,
        isConclusive: result.is_conclusive,
      });

      // Save departure data to the most recent parking history entry
      try {
        const recentItem = await ParkingHistoryService.getMostRecent();
        if (recentItem) {
          await ParkingHistoryService.updateItem(recentItem.id, {
            departure: {
              confirmedAt: Date.now(),
              distanceMeters: result.distance_from_parked_meters,
              isConclusive: result.is_conclusive,
              latitude: coords.latitude,
              longitude: coords.longitude,
            },
          });
          log.info('Departure data saved to history item', recentItem.id);
        }
      } catch (historyError) {
        log.warn('Failed to save departure to history (non-critical)', historyError);
      }

      // Clear pending confirmation on success
      this.state.pendingDepartureConfirmation = null;
      await this.saveState();

      // Notify user if departure is conclusive
      if (result.is_conclusive) {
        await this.sendDepartureConfirmedNotification(result.distance_from_parked_meters);
      } else {
        // Not conclusive - user hasn't moved far enough yet
        // Send a softer notification
        await this.sendDepartureRecordedNotification(result.distance_from_parked_meters);
      }
    } catch (error) {
      log.error('Failed to confirm departure', error);

      // Retry logic
      if (pending.retryCount < MAX_DEPARTURE_RETRIES) {
        pending.retryCount++;
        await this.saveState();
        log.info(`Scheduling departure confirmation retry ${pending.retryCount}/${MAX_DEPARTURE_RETRIES}`);

        // Schedule retry
        this.departureConfirmationTimeout = setTimeout(async () => {
          await this.confirmDeparture();
        }, DEPARTURE_RETRY_DELAY_MS);
      } else {
        // Max retries exceeded - clear pending and notify user
        log.warn('Max departure confirmation retries exceeded, giving up');
        this.state.pendingDepartureConfirmation = null;
        await this.saveState();
        await this.sendDepartureFailedNotification();
      }
    }
  }

  /**
   * Send notification that departure was recorded but not conclusive
   */
  private async sendDepartureRecordedNotification(distanceMeters: number): Promise<void> {
    await notifee.displayNotification({
      title: 'Departure Recorded',
      body: `Location recorded ${distanceMeters}m from parking spot. Drive further for stronger evidence.`,
      android: {
        channelId: 'parking-monitoring',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
      },
    });
  }

  /**
   * Send notification that departure confirmation failed
   */
  private async sendDepartureFailedNotification(): Promise<void> {
    await notifee.displayNotification({
      title: 'Departure Tracking Failed',
      body: 'Could not record your departure location. Open the app to retry manually.',
      android: {
        channelId: 'parking-monitoring',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
      },
    });
  }

  /**
   * Send notification that departure was confirmed
   */
  private async sendDepartureConfirmedNotification(distanceMeters: number): Promise<void> {
    await notifee.displayNotification({
      title: 'Departure Recorded',
      body: `Your departure has been recorded. You moved ${distanceMeters}m from your parking spot. This can be used as evidence if needed.`,
      android: {
        channelId: 'parking-monitoring',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
      },
    });
  }

  /**
   * Manually trigger departure confirmation (if auto failed)
   */
  async manualDepartureConfirmation(): Promise<{ success: boolean; distance?: number }> {
    if (!this.state.pendingDepartureConfirmation) {
      return { success: false };
    }

    try {
      await this.confirmDeparture();
      return { success: true };
    } catch (error) {
      log.error('Manual departure confirmation failed', error);
      return { success: false };
    }
  }

  /**
   * Check if there's a pending departure confirmation
   */
  hasPendingDepartureConfirmation(): boolean {
    return this.state.pendingDepartureConfirmation !== null;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.stopMonitoring();

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    this.state.isInitialized = false;
    log.info('BackgroundTaskService cleaned up');
  }
}

export default new BackgroundTaskServiceClass();
