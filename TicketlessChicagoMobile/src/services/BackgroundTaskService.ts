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

import { Platform, AppState, AppStateStatus, NativeModules, NativeEventEmitter } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance } from '@notifee/react-native';
import BluetoothService from './BluetoothService';
import MotionActivityService from './MotionActivityService';
import BackgroundLocationService, { ParkingDetectedEvent } from './BackgroundLocationService';
import LocationService from './LocationService';
import LocalNotificationService, { ParkingRestriction } from './LocalNotificationService';
import PushNotificationService from './PushNotificationService';
import AuthService from './AuthService';
import { ParkingHistoryService } from '../screens/HistoryScreen';
import CameraAlertService from './CameraAlertService';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

// Native module for persistent Android BT monitoring foreground service
const BluetoothMonitorModule = Platform.OS === 'android' ? NativeModules.BluetoothMonitorModule : null;

const log = Logger.createLogger('BackgroundTaskService');

// Background task configuration
const BACKGROUND_TASK_ID = 'ticketless-parking-check';
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_DISCONNECT_DURATION_MS = 30 * 1000; // 30 seconds (to avoid false positives)
const DEPARTURE_CONFIRMATION_DELAY_MS = 120 * 1000; // 2 minutes after car starts
const MIN_PARKING_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - prevent duplicate checks

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
  private cameraLocationUnsubscribe: (() => void) | null = null;
  private androidDrivingGpsWatchId: number | null = null;
  // Native BT monitor service event subscriptions (Android only)
  private nativeBtDisconnectSub: any = null;
  private nativeBtConnectSub: any = null;

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

      // Initialize camera alert service (TTS for speed/red light cameras)
      await CameraAlertService.initialize();

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
              this.stopCameraAlerts();
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
              this.startCameraAlerts();
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
      // Android: Use native foreground service for persistent BT monitoring.
      // This survives app backgrounding because the service has its own
      // BroadcastReceiver that never gets unregistered (unlike react-native-bluetooth-classic
      // which unregisters receivers in onHostPause).
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

        // Try native foreground service first (reliable, survives background)
        if (BluetoothMonitorModule) {
          try {
            await BluetoothMonitorModule.startMonitoring(
              savedDevice.address || savedDevice.id,
              savedDevice.name
            );
            log.info('Native BT foreground service started for: ' + savedDevice.name);

            // Request battery optimization exemption so Android doesn't kill the service
            try {
              const exempt = await BluetoothMonitorModule.isBatteryOptimizationExempt();
              if (!exempt) {
                log.info('App is NOT exempt from battery optimization — requesting exemption');
                await BluetoothMonitorModule.requestBatteryOptimizationExemption();
              } else {
                log.info('App is already exempt from battery optimization');
              }
            } catch (batteryError) {
              log.warn('Failed to check/request battery optimization exemption:', batteryError);
            }

            // Subscribe to native events from the foreground service
            const eventEmitter = new NativeEventEmitter(BluetoothMonitorModule);

            this.nativeBtDisconnectSub = eventEmitter.addListener(
              'BtMonitorCarDisconnected',
              async (event: any) => {
                log.info('NATIVE BT DISCONNECT EVENT - triggering parking check', event);
                this.stopCameraAlerts();
                await this.sendDiagnosticNotification(
                  'Car Disconnected (Native)',
                  `${event?.deviceName || savedDevice.name} disconnected. Checking parking rules...`
                );
                await this.handleCarDisconnection();
              }
            );

            this.nativeBtConnectSub = eventEmitter.addListener(
              'BtMonitorCarConnected',
              async (event: any) => {
                log.info('NATIVE BT CONNECT EVENT - car reconnected', event);
                this.startCameraAlerts();
                await this.handleCarReconnection();
              }
            );

            // Check for pending events (service may have fired while JS was dead)
            try {
              const pending = await BluetoothMonitorModule.checkPendingEvents();
              if (pending?.pendingDisconnect) {
                log.info('Found PENDING disconnect from native service - triggering parking check');
                await this.sendDiagnosticNotification(
                  'Pending BT Disconnect',
                  'Bluetooth disconnect was detected while app was sleeping. Checking parking now...'
                );
                await this.handleCarDisconnection();
              } else if (pending?.pendingConnect) {
                log.info('Found PENDING connect from native service');
                this.startCameraAlerts();
                await this.handleCarReconnection();
              }
            } catch (pendingError) {
              log.warn('Error checking pending BT events:', pendingError);
            }

            // Pre-cache GPS location periodically while car is connected.
            this.startGpsCaching();

            await this.sendDiagnosticNotification(
              'BT Monitor Active',
              `Native foreground service monitoring ${savedDevice.name}. BT disconnect detection works even when app is in background.`
            );
          } catch (nativeError) {
            log.error('Native BT monitor failed, falling back to JS-side monitoring:', nativeError);
            await this.startJsSideBluetoothMonitoring(savedDevice);
          }
        } else {
          // Native module not available, use JS-side monitoring (unreliable in background)
          log.warn('BluetoothMonitorModule not available, using JS-side BT monitoring');
          await this.startJsSideBluetoothMonitoring(savedDevice);
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
   * Fallback: JS-side Bluetooth monitoring via react-native-bluetooth-classic.
   * This is unreliable in background (receivers get unregistered in onHostPause)
   * but serves as a fallback if the native foreground service fails to start.
   */
  private async startJsSideBluetoothMonitoring(savedDevice: { name: string; address?: string; id: string }): Promise<void> {
    try {
      await BluetoothService.monitorCarConnection(
        async () => {
          log.info('JS-SIDE BT DISCONNECT EVENT - triggering parking check');
          this.stopCameraAlerts();
          await this.sendDiagnosticNotification(
            'BT Disconnect (JS fallback)',
            `${savedDevice.name} disconnected. Note: JS-side monitoring may miss events in background.`
          );
          await this.handleCarDisconnection();
        },
        async () => {
          log.info('JS-SIDE BT CONNECT EVENT - car reconnected');
          this.startCameraAlerts();
          await this.handleCarReconnection();
        }
      );
      log.info('JS-side Bluetooth monitoring active for: ' + savedDevice.name);
      this.startGpsCaching();
      await this.sendDiagnosticNotification(
        'BT Monitor (Fallback)',
        `Using JS-side monitoring for ${savedDevice.name}. This may miss events when app is in background.`
      );
    } catch (error) {
      log.error('Could not start JS-side Bluetooth monitoring:', error);
      await this.sendDiagnosticNotification(
        'Bluetooth Monitoring Failed',
        `Could not monitor ${savedDevice.name}. Error: ${error}`
      );
    }
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

    // Stop camera alerts
    this.stopCameraAlerts();

    // Clean up native BT monitor subscriptions (Android)
    if (this.nativeBtDisconnectSub) {
      this.nativeBtDisconnectSub.remove();
      this.nativeBtDisconnectSub = null;
    }
    if (this.nativeBtConnectSub) {
      this.nativeBtConnectSub.remove();
      this.nativeBtConnectSub = null;
    }

    // Stop platform-specific monitoring
    if (Platform.OS === 'ios') {
      BackgroundLocationService.stopMonitoring();
      MotionActivityService.stopMonitoring();
    } else if (Platform.OS === 'android' && BluetoothMonitorModule) {
      // Stop the native foreground service
      BluetoothMonitorModule.stopMonitoring().catch((e: any) =>
        log.warn('Error stopping native BT monitor:', e)
      );
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

  // --------------------------------------------------------------------------
  // Camera Alert Helpers
  // --------------------------------------------------------------------------

  /**
   * Start camera proximity alerts while driving.
   * On iOS: subscribes to BackgroundLocationService location updates.
   * On Android: uses the GPS caching interval to feed camera checks.
   */
  private startCameraAlerts(): void {
    if (!CameraAlertService.isAlertEnabled()) return;

    CameraAlertService.start();

    if (Platform.OS === 'ios') {
      // Subscribe to continuous GPS updates from the native module
      this.cameraLocationUnsubscribe = BackgroundLocationService.addLocationListener(
        (event) => {
          CameraAlertService.onLocationUpdate(
            event.latitude,
            event.longitude,
            event.speed,
            event.heading ?? -1
          );
        }
      );
      log.info('Camera alerts: subscribed to iOS location updates');
    } else if (Platform.OS === 'android') {
      // Start continuous GPS watching for camera proximity while driving
      this.startAndroidDrivingGps();
    }
  }

  /**
   * Stop camera proximity alerts.
   */
  private stopCameraAlerts(): void {
    CameraAlertService.stop();

    if (this.cameraLocationUnsubscribe) {
      this.cameraLocationUnsubscribe();
      this.cameraLocationUnsubscribe = null;
      log.info('Camera alerts: unsubscribed from iOS location updates');
    }

    this.stopAndroidDrivingGps();
  }

  /**
   * Start continuous GPS on Android while driving (BT connected).
   * Interval set to 1s so alerts fire as close to 200m as possible —
   * at 30mph you cover ~13m/s, so 1s means ±13m accuracy on trigger distance.
   */
  private startAndroidDrivingGps(): void {
    if (Platform.OS !== 'android') return;
    this.stopAndroidDrivingGps(); // Clear any existing watch

    try {
      this.androidDrivingGpsWatchId = Geolocation.watchPosition(
        (position) => {
          CameraAlertService.onLocationUpdate(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.speed ?? -1,
            position.coords.heading ?? -1
          );
        },
        (error) => {
          log.warn('Android driving GPS error:', error.message);
        },
        {
          enableHighAccuracy: true,
          distanceFilter: 5, // Update every ~5m for tight camera proximity
          interval: 1000, // 1s — fast enough for immediate 200m alerts
          fastestInterval: 500,
          forceRequestLocation: true,
          forceLocationManager: true,
          showLocationDialog: false,
        }
      );
      log.info('Android driving GPS started for camera alerts');
    } catch (error) {
      log.error('Failed to start Android driving GPS', error);
    }
  }

  /**
   * Stop Android driving GPS watch.
   */
  private stopAndroidDrivingGps(): void {
    if (this.androidDrivingGpsWatchId !== null) {
      Geolocation.clearWatch(this.androidDrivingGpsWatchId);
      this.androidDrivingGpsWatchId = null;
      log.info('Android driving GPS stopped');
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

    // Stop GPS pre-caching from driving — we don't want stale driving positions
    // being used as the parking location. Clear the in-app location cache so
    // triggerParkingCheck gets a FRESH GPS fix at the actual parking spot.
    this.stopGpsCaching();
    LocationService.clearLocationCache();
    log.info('Cleared driving GPS cache before parking check');

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
   * @param isRealParkingEvent - If true, this was triggered by an actual BT disconnect
   *   or iOS parking detection. If false (periodic check), failures are silent.
   */
  private async triggerParkingCheck(presetCoords?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  }, isRealParkingEvent: boolean = true): Promise<void> {
    // Guard against duplicate parking checks (e.g., from app state changes re-triggering)
    if (this.state.lastParkingCheckTime) {
      const timeSinceLastCheck = Date.now() - this.state.lastParkingCheckTime;
      if (timeSinceLastCheck < MIN_PARKING_CHECK_INTERVAL_MS) {
        log.info(`Skipping parking check - last check was ${Math.round(timeSinceLastCheck / 1000)}s ago (min interval: ${MIN_PARKING_CHECK_INTERVAL_MS / 1000}s)`);
        return;
      }
    }

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
        //
        // IMPORTANT: Always try fresh GPS first. The in-app cache may contain a
        // stale position from while the user was DRIVING (GPS pre-caching runs
        // every 60s while BT is connected). Using a driving position as the
        // parking location causes the check to report restrictions for the wrong
        // address (e.g., 1128 W Fullerton when parked at Belden & Sheffield).
        // handleCarDisconnection clears the cache, but we also guard here.
        log.info(`Getting GPS location... (Platform: ${Platform.OS}, appState: ${AppState.currentState})`);

        // Strategy 1: Try high accuracy GPS (fresh fix at actual parking spot)
        // forceNoCache=true ensures the OS doesn't return a stale position from driving
        try {
          const timeout = Platform.OS === 'android' ? 25000 : 15000;
          coords = await LocationService.getHighAccuracyLocation(50, timeout, true);
          gpsSource = `high-accuracy (${coords.accuracy?.toFixed(1)}m)`;
          log.info(`Got high-accuracy location: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} ±${coords.accuracy?.toFixed(1)}m`);
        } catch (gpsError) {
          log.warn('High accuracy GPS failed:', gpsError);

          // Strategy 2: Retry with balanced accuracy
          try {
            log.info('Trying balanced accuracy GPS with retry...');
            coords = await LocationService.getLocationWithRetry(3, undefined, true);
            gpsSource = `retry-balanced (${coords.accuracy?.toFixed(1)}m)`;
            log.info(`Got retry location: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`);
          } catch (retryError) {
            // Strategy 3: Use cached location as last resort (better than nothing)
            // NOTE: handleCarDisconnection clears the driving cache, so this will
            // only have data if getCurrentLocation succeeded and cached during retries.
            const cachedCoords = LocationService.getCachedLocation();
            if (cachedCoords) {
              log.info(`Using cached location as last resort: ${cachedCoords.accuracy?.toFixed(1) || '?'}m accuracy`);
              coords = cachedCoords;
              gpsSource = `cache-fallback (${cachedCoords.accuracy?.toFixed(1) || '?'}m)`;
            } else {
              // Strategy 4: Stale cache (any age)
              const staleCoords = LocationService.getLastKnownLocation();
              if (staleCoords) {
                log.info('Using stale cached location as absolute last resort');
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

      // Save the result (overwrites LAST_PARKING_LOCATION for HomeScreen hero card)
      await LocationService.saveParkingCheckResult(result);

      // Save to parking history so it shows up in the History tab.
      // This includes all-clear results — the user should see a record of
      // every auto-detected parking event, not just ones with restrictions.
      try {
        await ParkingHistoryService.addToHistory(coords, result.rules, result.address);
        log.info('Auto-detection result saved to parking history');
      } catch (historyError) {
        log.error('Failed to save auto-detection to history (non-fatal):', historyError);
      }

      // Save parked location to server for cron-based push notification reminders.
      // This populates user_parked_vehicles, enabling timed server-side notifications:
      // - 9pm winter ban reminder (before 3am ban)
      // - 8pm night-before + 7am morning-of street cleaning reminders
      // - 7am permit zone reminder (before 8am enforcement)
      // - Snow ban push notifications to parked users on snow routes
      try {
        const fcmToken = await PushNotificationService.getToken();
        if (fcmToken && AuthService.isAuthenticated()) {
          // Get the raw API response data for mapping to server fields
          const rawData = await this.getRawParkingData(result);
          await LocationService.saveParkedLocationToServer(coords, rawData, result.address, fcmToken);
        } else {
          log.debug('Skipping server save: no FCM token or not authenticated');
        }
      } catch (serverSaveError) {
        // Non-fatal — local notifications still work without server save
        log.warn('Failed to save parked location to server (non-fatal):', serverSaveError);
      }

      // Update last check time
      this.state.lastParkingCheckTime = Date.now();
      await this.saveState();

      // Check if user is parked in their own permit zone — if so, filter it out
      const filteredResult = await this.filterOwnPermitZone(result);

      // Send notification — always notify so the user knows the scan ran
      if (filteredResult.rules.length > 0) {
        await this.sendParkingNotification(filteredResult, coords.accuracy);

        // Schedule local notifications for upcoming restrictions
        await this.scheduleRestrictionReminders(filteredResult, coords);
      } else {
        await this.sendSafeNotification(filteredResult.address, coords.accuracy);
      }

      log.info('=== PARKING CHECK COMPLETE ===', {
        rulesFound: result.rules.length,
        address: result.address,
        gpsSource,
        accuracy: coords.accuracy ? `${coords.accuracy.toFixed(1)}m` : 'unknown',
      });
    } catch (error) {
      log.error('=== PARKING CHECK FAILED ===', error);
      // Only show "Parking Check Failed" notification if ALL of these are true:
      // 1. This was a real parking event (BT disconnect or iOS detection), not a periodic check
      // 2. We haven't successfully checked recently (avoids duplicate error after success)
      if (!isRealParkingEvent) {
        log.info('Suppressing error notification - periodic check failure (not a real parking event)');
      } else {
        const recentCheckAge = this.state.lastParkingCheckTime
          ? Date.now() - this.state.lastParkingCheckTime
          : Infinity;
        if (recentCheckAge > MIN_PARKING_CHECK_INTERVAL_MS) {
          await this.sendErrorNotification();
        } else {
          log.info('Suppressing error notification - successful check was recent');
        }
      }
    }
  }

  /**
   * Extract raw parking data from the check result for server save.
   * The result from checkParkingLocation has processed rules[], but
   * save-parked-location needs the raw API fields.
   */
  private async getRawParkingData(result: any): Promise<any> {
    // The result object from LocationService.checkParkingLocation already
    // has the parsed data we need — reconstruct the API response shape
    const winterRule = result.rules?.find((r: any) => r.type === 'winter_ban');
    const snowRule = result.rules?.find((r: any) => r.type === 'snow_route');
    const cleaningRule = result.rules?.find((r: any) => r.type === 'street_cleaning');
    const permitRule = result.rules?.find((r: any) => r.type === 'permit_zone');

    return {
      winterOvernightBan: winterRule ? { active: true, streetName: null } : null,
      twoInchSnowBan: snowRule ? { active: true, streetName: null } : null,
      streetCleaning: cleaningRule ? {
        hasRestriction: true,
        nextDate: cleaningRule.nextDate || null,
        schedule: cleaningRule.schedule || null,
      } : null,
      permitZone: permitRule ? {
        inPermitZone: true,
        zoneName: permitRule.zoneName || null,
        restrictionSchedule: permitRule.schedule || null,
      } : null,
    };
  }

  /**
   * Filter permit zone notifications ONLY if user is parked in their own zone.
   *
   * Permit zones are restricted — you WILL be ticketed without a permit.
   * - No home zone set → KEEP (they don't have a permit, warn them!)
   * - Home zone matches parked zone → REMOVE (they have a permit here)
   * - Home zone set but different → KEEP (their permit doesn't cover this zone)
   */
  private async filterOwnPermitZone(result: any): Promise<any> {
    try {
      const permitRule = result.rules?.find((r: any) => r.type === 'permit_zone');
      if (!permitRule) return result;

      const homeZone = await AsyncStorage.getItem(StorageKeys.HOME_PERMIT_ZONE);
      if (!homeZone) {
        // No permit zone set — they probably don't have a permit, keep the warning
        log.info('No home permit zone set — keeping permit zone notification (user needs a permit here)');
        return result;
      }

      // Compare zone names (case-insensitive, strip "Zone " prefix)
      const parkedZoneNum = (permitRule.zoneName || '').trim().toLowerCase().replace(/^zone\s*/i, '');
      const userZoneNum = homeZone.trim().toLowerCase().replace(/^zone\s*/i, '');

      if (parkedZoneNum === userZoneNum) {
        // Parked in their own zone — they have a permit, no need to warn
        log.info(`Filtering out permit zone notification — parked in own zone (${homeZone})`);
        return {
          ...result,
          rules: result.rules.filter((r: any) => r.type !== 'permit_zone'),
        };
      }

      // Different zone — their permit doesn't help here, keep the warning
      log.info(`User has permit for zone ${homeZone} but parked in ${permitRule.zoneName} — keeping notification`);
    } catch (error) {
      log.warn('Error checking home permit zone (non-fatal):', error);
    }
    return result;
  }

  /**
   * Schedule local notifications for upcoming restrictions.
   *
   * Timing strategy (user-requested):
   * - Street cleaning: 9pm night before + 7am morning of
   * - Winter ban: 9pm (before 3am ban)
   * - Permit zone: 7am (before 8am enforcement start)
   * - Snow ban: handled by server push notifications (weather-dependent)
   */
  private async scheduleRestrictionReminders(
    result: any,
    coords: { latitude: number; longitude: number }
  ): Promise<void> {
    const restrictions: ParkingRestriction[] = [];

    // Parse the API response to extract restriction times
    // The result comes from LocationService.checkParkingLocation which returns
    // data from the check-parking API with streetCleaning, winterOvernightBan, etc.

    // Street cleaning reminders — 9pm night before + 7am morning of
    if (result.streetCleaning?.hasRestriction && result.streetCleaning?.nextDate) {
      // Street cleaning typically starts at 9am on the scheduled day
      const dateParts = result.streetCleaning.nextDate.split('-');
      if (dateParts.length === 3) {
        const cleaningDate = new Date(
          parseInt(dateParts[0], 10),
          parseInt(dateParts[1], 10) - 1, // Month is 0-indexed
          parseInt(dateParts[2], 10),
          9, 0, 0, 0 // 9 AM local time
        );

        if (!isNaN(cleaningDate.getTime()) && cleaningDate.getTime() > Date.now()) {
          // Notification 1: 9pm the night before cleaning
          const nightBefore9pm = new Date(cleaningDate);
          nightBefore9pm.setDate(nightBefore9pm.getDate() - 1);
          nightBefore9pm.setHours(21, 0, 0, 0); // 9 PM

          if (nightBefore9pm.getTime() > Date.now()) {
            restrictions.push({
              type: 'street_cleaning',
              restrictionStartTime: nightBefore9pm, // We set the time directly
              address: result.address,
              details: result.streetCleaning.schedule || 'Street cleaning tomorrow - move your car tonight',
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
          }

          // Notification 2: 7am morning of cleaning
          const morningOf7am = new Date(cleaningDate);
          morningOf7am.setHours(7, 0, 0, 0); // 7 AM

          if (morningOf7am.getTime() > Date.now()) {
            restrictions.push({
              type: 'street_cleaning',
              restrictionStartTime: morningOf7am,
              address: result.address,
              details: 'Street cleaning starts at 9am - MOVE YOUR CAR NOW',
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
          }
        }
      }
    }

    // Winter overnight ban reminder — 9pm (before 3am ban)
    if (result.winterOvernightBan?.active || result.winterBan?.found) {
      const now = new Date();
      const currentHour = now.getHours();

      // Schedule for 9pm tonight if before 9pm, or 9pm tomorrow if already past
      if (currentHour < 3 || currentHour >= 7) {
        const next9pm = new Date(now);
        next9pm.setHours(21, 0, 0, 0); // 9 PM

        // If it's already past 9pm, schedule for tomorrow 9pm
        if (currentHour >= 21) {
          next9pm.setDate(next9pm.getDate() + 1);
        }

        if (next9pm.getTime() > Date.now()) {
          restrictions.push({
            type: 'winter_ban',
            restrictionStartTime: next9pm,
            address: result.address,
            details: 'Winter overnight parking ban starts at 3am - move before 3am!',
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
        }
      }
      // If currently in ban hours (3am-7am), don't schedule - user should already know
    }

    // Permit zone reminder — 7am before 8am enforcement
    if (result.permitZone?.inPermitZone && !result.permitZone?.permitRequired) {
      const now = new Date();
      const currentHour = now.getHours();
      const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday

      // Schedule for 7am (1 hour before typical 8am enforcement start)
      const next7am = new Date(now);
      next7am.setHours(7, 0, 0, 0);
      next7am.setMinutes(0);
      next7am.setSeconds(0);
      next7am.setMilliseconds(0);

      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isPast7amToday = currentHour >= 7;

      if (isWeekend || isPast7amToday) {
        next7am.setDate(next7am.getDate() + 1);
        // Skip weekends
        let nextDay = next7am.getDay();
        while (nextDay === 0 || nextDay === 6) {
          next7am.setDate(next7am.getDate() + 1);
          nextDay = next7am.getDay();
        }
      }

      if (next7am.getTime() > Date.now()) {
        restrictions.push({
          type: 'permit_zone',
          restrictionStartTime: next7am,
          address: result.address,
          details: `${result.permitZone.zoneName || 'Permit zone'} - enforcement starts at 8am`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      }
    }

    // Snow ban - weather dependent, handled by push notifications from backend
    // Server cron sends push to users with on_snow_route=true in user_parked_vehicles

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
      title: hasCritical ? '⚠️ Parked — Restriction Active!' : '⚠️ Parked — Heads Up',
      body: `${result.address}${accuracyNote}\n${result.rules.map(r => r.message).join('\n')}`,
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
    const accuracyNote = accuracy ? ` (GPS: ±${accuracy.toFixed(0)}m)` : '';
    await notifee.displayNotification({
      title: '✅ Parked — All Clear',
      body: `${address}${accuracyNote}\nNo active restrictions. You're good to park here!`,
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
   * Log a diagnostic message. In debug mode (user opt-in via Settings),
   * also shows a visible notification. Otherwise log-only to avoid
   * spamming users with internal diagnostics.
   */
  private async sendDiagnosticNotification(title: string, body: string): Promise<void> {
    // Always log for debugging via adb logcat / Xcode console
    log.info(`[Diagnostic] ${title}: ${body}`);

    // Only show visible notification if user has enabled debug mode
    try {
      const debugEnabled = await AsyncStorage.getItem('debug_notifications_enabled');
      if (debugEnabled !== 'true') return;

      await notifee.displayNotification({
        title: `[Autopilot] ${title}`,
        body,
        android: {
          channelId: 'parking-monitoring',
          pressAction: { id: 'default' },
        },
        ios: {
          sound: undefined, // Silent even in debug mode
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
          // isRealParkingEvent=false: periodic checks should not show error notifications
          await this.triggerParkingCheck(undefined, false);
        }
      }
    } catch (error) {
      log.error('Error in periodic check', error);
    }
  }

  /**
   * Handle app state changes (foreground/background)
   *
   * IMPORTANT: We must NOT call startForegroundMonitoring() here because that
   * tears down and re-registers BT listeners. Re-registering BT monitoring
   * when the car is already disconnected (user parked and walked away) can
   * cause false disconnect events, triggering a SECOND parking check at the
   * wrong GPS location (stale/cached position instead of actual parking spot).
   */
  private handleAppStateChange(nextAppState: AppStateStatus): void {
    log.debug('App state changed:', nextAppState);

    if (nextAppState === 'active' && this.state.isMonitoring) {
      // App came to foreground - only restart periodic check timer if needed
      // Do NOT re-register BT listeners (they persist across app state changes)
      if (!this.monitoringInterval) {
        log.info('App foregrounded: restarting periodic check interval');
        this.monitoringInterval = setInterval(
          () => this.performPeriodicCheck(),
          CHECK_INTERVAL_MS
        );
      } else {
        log.debug('App foregrounded: monitoring interval already active');
      }
    } else if (nextAppState === 'background' && this.state.isMonitoring) {
      // App went to background
      // BT listeners and periodic checks continue running
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

    // Clear stale parking data from AsyncStorage so HomeScreen doesn't show old results
    try {
      await AsyncStorage.removeItem(StorageKeys.LAST_PARKING_LOCATION);
      log.info('Cleared stale parking data from AsyncStorage');
    } catch (e) {
      log.warn('Failed to clear stale parking data', e);
    }

    // Call the reconnect callback if provided (tells HomeScreen to clear UI)
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
   * Log departure recorded (not shown to user — internal tracking only)
   */
  private async sendDepartureRecordedNotification(distanceMeters: number): Promise<void> {
    log.info(`Departure recorded: ${distanceMeters}m from parking spot`);
  }

  /**
   * Log departure tracking failure (not shown to user)
   */
  private async sendDepartureFailedNotification(): Promise<void> {
    log.warn('Departure tracking failed — could not record departure location');
  }

  /**
   * Log departure confirmed (not shown to user)
   */
  private async sendDepartureConfirmedNotification(distanceMeters: number): Promise<void> {
    log.info(`Departure confirmed: moved ${distanceMeters}m from parking spot`);
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
