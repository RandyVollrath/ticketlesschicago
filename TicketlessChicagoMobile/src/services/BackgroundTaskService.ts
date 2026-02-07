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
import ParkingDetectionStateMachine from './ParkingDetectionStateMachine';
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
const DEPARTURE_CONFIRMATION_DELAY_MS = 60 * 1000; // 60s after car starts — enough time to clear the block
const MIN_PARKING_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - prevent duplicate checks

// Periodic rescan: re-check parking at last location every 4 hours while parked
const RESCAN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
// Snow forecast check interval (every 2 hours while parked on a snow route)
const SNOW_FORECAST_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
// OpenWeatherMap-compatible API for Chicago snow forecast (free tier)
const CHICAGO_WEATHER_LAT = 41.8781;
const CHICAGO_WEATHER_LNG = -87.6298;

interface BackgroundTaskState {
  isInitialized: boolean;
  isMonitoring: boolean;
  lastCarConnectionStatus: boolean;
  lastDisconnectTime: number | null;
  lastParkingCheckTime: number | null;
  // Departure tracking
  pendingDepartureConfirmation: {
    parkingHistoryId: string | null; // null = local-only mode (API failed)
    parkedLocation: { latitude: number; longitude: number };
    clearedAt: string;
    retryCount: number;
    scheduledAt: number; // timestamp when confirmation was scheduled
    departedAt: number; // timestamp when driving actually started (not when confirmed)
    localHistoryItemId?: string; // local history item to update (local-only mode)
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
  // Periodic rescan timer (re-checks parking rules at last parked location)
  private rescanInterval: ReturnType<typeof setInterval> | null = null;
  // Snow forecast monitoring timers
  private snowForecastInterval: ReturnType<typeof setInterval> | null = null;
  private snowForecastInitialTimeout: ReturnType<typeof setTimeout> | null = null;
  // Debounce: timestamp of last handleCarDisconnection call (prevents duplicate triggers
  // from native service + JS-side listeners + pending events all firing for the same disconnect)
  private lastDisconnectHandlerTime: number = 0;
  // Timestamp of last real BT event from the native service (ACL connect/disconnect).
  // Delayed re-checks skip if a real event fired recently, since ACL events are authoritative.
  private lastNativeBtEventTime: number = 0;

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

      // Initialize parking detection state machine (Android).
      // This is the single source of truth for driving/parking state.
      // It replaces the scattered state across SharedPreferences, BluetoothService,
      // and HomeScreen's multi-source checks.
      if (Platform.OS === 'android') {
        const savedDevice = await BluetoothService.getSavedCarDevice();
        await ParkingDetectionStateMachine.initialize(
          savedDevice?.name ?? null,
          savedDevice?.address ?? null
        );
        this.registerStateMachineCallbacks();

      }

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
  /**
   * Register transition callbacks on the ParkingDetectionStateMachine.
   * This is the bridge between the state machine and the existing business
   * logic (parking check, departure tracking, camera alerts, notifications).
   */
  private registerStateMachineCallbacks(): void {
    // When parking is confirmed (debounce expired after BT disconnect):
    // -> trigger the parking rules check
    ParkingDetectionStateMachine.onTransition('PARKING_PENDING->PARKED', async () => {
      log.info('StateMachine: PARKING_PENDING -> PARKED -> triggering parking check');
      this.stopCameraAlerts();
      await this.sendDiagnosticNotification(
        'Car Disconnected',
        `${ParkingDetectionStateMachine.carName || 'Car'} disconnected. Checking parking rules...`
      );
      await this.handleCarDisconnection();
    });

    // When user starts driving again (BT reconnect while parked):
    // -> handle departure tracking
    ParkingDetectionStateMachine.onTransition('PARKED->DRIVING', async () => {
      log.info('StateMachine: PARKED -> DRIVING -> handling departure');
      this.startCameraAlerts();
      await this.handleCarReconnection();
    });

    // When BT reconnects during debounce (transient disconnect):
    // -> resume camera alerts, no parking check
    ParkingDetectionStateMachine.onTransition('PARKING_PENDING->DRIVING', async () => {
      log.info('StateMachine: PARKING_PENDING -> DRIVING -> transient disconnect, resuming');
      this.startCameraAlerts();
    });

    // When first connected at startup or after idle:
    // -> start camera alerts and GPS caching
    ParkingDetectionStateMachine.onTransition('IDLE->DRIVING', async () => {
      log.info('StateMachine: IDLE -> DRIVING -> car connected');
      this.startCameraAlerts();
      this.startGpsCaching();
    });

    ParkingDetectionStateMachine.onTransition('INITIALIZING->DRIVING', async () => {
      log.info('StateMachine: INITIALIZING -> DRIVING -> car was already connected');
      this.startCameraAlerts();
      this.startGpsCaching();
    });

    // When ANY state transitions to DRIVING:
    // -> reset the parking check time guard so the NEXT parking event isn't
    //    blocked by a stale 5-minute cooldown from the previous parking check.
    // -> also reset the disconnect handler debounce for the same reason.
    // -> attempt departure tracking (will check if there's a recent parking record)
    ParkingDetectionStateMachine.onTransition('*->DRIVING', async (event) => {
      log.info('StateMachine: *->DRIVING -> resetting parking check guards');
      this.state.lastParkingCheckTime = null;
      this.lastDisconnectHandlerTime = 0;

      // Attempt departure tracking for ANY transition to DRIVING, not just PARKED->DRIVING.
      // This catches cases where the state machine state was lost (app reinstall, AsyncStorage
      // cleared, etc.) but there's still a parking record in history that needs departure.
      // The markCarReconnected() function is idempotent — if there's no recent parking
      // record without a departure, it will do nothing.
      // Skip if coming from PARKED (that's handled by the specific PARKED->DRIVING callback).
      const fromState = event.metadata?.fromState;
      if (fromState !== 'PARKED') {
        log.info(`*->DRIVING from ${fromState}: checking for orphaned parking records`);
        await this.tryRecordDepartureForOrphanedParking();
      }
    });

    // Sync state machine to BluetoothService for backward compatibility.
    // Components that still use BluetoothService.isConnectedToCar() will
    // continue to work during the migration.
    ParkingDetectionStateMachine.addStateListener((snapshot) => {
      BluetoothService.setCarConnected(snapshot.isConnectedToCar);
    });

    log.info('State machine transition callbacks registered');
  }

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

    // Stop parking-while-parked timers
    this.stopRescanTimer();
    this.stopSnowForecastMonitoring();

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
              // Fire-and-forget: don't block the parking check waiting for a diagnostic notification
              this.sendDiagnosticNotification(
                'Parking Detected (iOS)',
                `Detected you parked. Duration: ${Math.round(event.drivingDurationSec || 0)}s driving. Checking parking rules...`
              );
              // Pass the stop-start coordinates so we check parking rules
              // at where the CAR is, not where the user walked to
              const parkingCoords = event.latitude && event.longitude
                ? { latitude: event.latitude, longitude: event.longitude, accuracy: event.accuracy }
                : undefined;
              // Pass the native event timestamp so parking history records
              // when the car ACTUALLY stopped, not when the check completes.
              await this.handleCarDisconnection(parkingCoords, event.timestamp);
            },
            // onDrivingStarted - fires when user starts driving
            (drivingTimestamp?: number) => {
              log.info('DRIVING STARTED - user departing', {
                nativeTimestamp: drivingTimestamp ? new Date(drivingTimestamp).toISOString() : 'none',
              });
              this.startCameraAlerts();
              this.handleCarReconnection(drivingTimestamp);
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

        // Ensure BluetoothService has the saved device ID loaded so that
        // setCarConnected() and isConnectedToCar() work correctly.
        await BluetoothService.ensureSavedDeviceLoaded();

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

            // Subscribe to native events from the foreground service.
            // Wrap in try/catch — if NativeEventEmitter fails to subscribe,
            // we still have the periodic check + pending events as fallbacks.
            try {
              const eventEmitter = new NativeEventEmitter(BluetoothMonitorModule);

              this.nativeBtDisconnectSub = eventEmitter.addListener(
                'BtMonitorCarDisconnected',
                (event: any) => {
                  log.info('NATIVE BT DISCONNECT EVENT received', event);
                  this.lastNativeBtEventTime = Date.now();
                  // Feed the state machine. It handles:
                  // 1. Transition to PARKING_PENDING
                  // 2. 10s debounce timer
                  // 3. If BT reconnects within 10s, cancels debounce (no parking check)
                  // 4. If debounce expires, transitions to PARKED -> triggers parking check
                  // The state machine also syncs BluetoothService via the state listener.
                  ParkingDetectionStateMachine.btDisconnected('bt_acl', {
                    deviceName: event?.deviceName,
                    deviceAddress: event?.deviceAddress,
                  });
                }
              );

              this.nativeBtConnectSub = eventEmitter.addListener(
                'BtMonitorCarConnected',
                (event: any) => {
                  log.info('NATIVE BT CONNECT EVENT - car reconnected', event);
                  this.lastNativeBtEventTime = Date.now();
                  // Feed the state machine. If in PARKING_PENDING, this cancels
                  // the debounce (transient disconnect). If in PARKED, this
                  // triggers departure handling.
                  ParkingDetectionStateMachine.btConnected('bt_acl', {
                    deviceName: event?.deviceName,
                    deviceAddress: event?.deviceAddress,
                  });
                }
              );

              log.info('NativeEventEmitter subscriptions registered for BT events');
            } catch (emitterError) {
              log.error('CRITICAL: Failed to subscribe to NativeEventEmitter BT events. ' +
                'Parking detection will rely on periodic checks + pending events only:', emitterError);
              await this.sendDiagnosticNotification(
                'BT Event Subscription Failed',
                'Native event listeners failed. Parking detection will use periodic checks as fallback.'
              );
            }

            // Check for pending events (service may have fired while JS was dead)
            try {
              const pending = await BluetoothMonitorModule.checkPendingEvents();
              if (pending?.pendingDisconnect) {
                const stillConnected = await BluetoothService.isConnectedToSavedCar();
                if (stillConnected) {
                  log.info('Found pending disconnect but car is currently CONNECTED — ignoring stale event');
                } else {
                  log.info('Found PENDING disconnect — feeding state machine');
                  ParkingDetectionStateMachine.btDisconnected('bt_acl', { source: 'pending_event' });
                }
              } else if (pending?.pendingConnect) {
                log.info('Found PENDING connect — feeding state machine');
                ParkingDetectionStateMachine.btConnected('bt_acl', { source: 'pending_event' });
              }
            } catch (pendingError) {
              log.warn('Error checking pending BT events:', pendingError);
            }

            // Sync initial connection state via the state machine.
            // The native service's checkInitialConnectionState() queries the BT
            // profile proxy (async, 100-2000ms). We do an immediate read of
            // SharedPrefs, then a delayed re-check to catch the async result.
            // The state machine handles all state corrections — no more manual
            // BluetoothService.setCarConnected() calls needed.
            try {
              const initiallyConnected = await BluetoothMonitorModule.isCarConnected();
              if (initiallyConnected) {
                ParkingDetectionStateMachine.btInitConnected('bt_profile_proxy');
              } else {
                ParkingDetectionStateMachine.btInitDisconnected('bt_profile_proxy');
              }
              log.info(`Initial BT state from native service: ${initiallyConnected ? 'CONNECTED' : 'NOT connected'}`);
            } catch (e) {
              log.debug('Could not get initial BT state from native service:', e);
            }

            // Delayed re-check: catches async profile proxy result.
            // Only one check at 2s needed — the state machine handles stale
            // state correction structurally via btInitConnected/btInitDisconnected.
            // Skip if a real ACL event fired since startup (ACL is authoritative).
            const startupTime = Date.now();
            setTimeout(async () => {
              try {
                if (!BluetoothMonitorModule) return;
                if (this.lastNativeBtEventTime > startupTime) {
                  log.debug('Delayed BT check (2s): skipping — real ACL event already fired');
                  return;
                }
                const check = await BluetoothMonitorModule.isCarConnected();
                const smState = ParkingDetectionStateMachine.state;
                if (check && smState !== 'DRIVING') {
                  log.info('Delayed BT check (2s): native says CONNECTED — feeding state machine');
                  ParkingDetectionStateMachine.btInitConnected('bt_profile_proxy');
                } else if (!check && smState === 'DRIVING') {
                  log.info('Delayed BT check (2s): native says NOT connected — correcting state machine');
                  ParkingDetectionStateMachine.btInitDisconnected('bt_profile_proxy');
                }
              } catch (e) { /* ignore */ }
            }, 2000);

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
   * Restart Android Bluetooth monitoring with the current saved car device.
   * Call this after the user selects a new car in Settings — the native
   * foreground service needs to be (re)started with the new device address
   * so its BroadcastReceiver can match ACL events for the correct car.
   */
  async restartBluetoothMonitoring(): Promise<void> {
    if (Platform.OS !== 'android' || !BluetoothMonitorModule) return;

    const savedDevice = await BluetoothService.getSavedCarDevice();
    if (!savedDevice) {
      log.warn('restartBluetoothMonitoring: no saved car device');
      return;
    }

    log.info(`Restarting BT monitoring for: ${savedDevice.name} (${savedDevice.address || savedDevice.id})`);

    // Ensure BluetoothService has the saved device ID loaded
    await BluetoothService.ensureSavedDeviceLoaded();

    // Clean up old native event subscriptions (safe — catch errors from stale listeners)
    try { this.nativeBtDisconnectSub?.remove(); } catch (e) { /* ignore */ }
    this.nativeBtDisconnectSub = null;
    try { this.nativeBtConnectSub?.remove(); } catch (e) { /* ignore */ }
    this.nativeBtConnectSub = null;

    try {
      await BluetoothMonitorModule.startMonitoring(
        savedDevice.address || savedDevice.id,
        savedDevice.name
      );
      log.info('Native BT foreground service (re)started for: ' + savedDevice.name);

      // Subscribe to native events
      const eventEmitter = new NativeEventEmitter(BluetoothMonitorModule);

      this.nativeBtDisconnectSub = eventEmitter.addListener(
        'BtMonitorCarDisconnected',
        (event: any) => {
          log.info('NATIVE BT DISCONNECT EVENT received (restart)', event);
          this.lastNativeBtEventTime = Date.now();
          ParkingDetectionStateMachine.btDisconnected('bt_acl', {
            deviceName: event?.deviceName,
            source: 'restart',
          });
        }
      );

      this.nativeBtConnectSub = eventEmitter.addListener(
        'BtMonitorCarConnected',
        (event: any) => {
          log.info('NATIVE BT CONNECT EVENT - car reconnected (restart)', event);
          this.lastNativeBtEventTime = Date.now();
          ParkingDetectionStateMachine.btConnected('bt_acl', {
            deviceName: event?.deviceName,
            source: 'restart',
          });
        }
      );

      // Update state machine with car info for the restarted device
      ParkingDetectionStateMachine.monitoringStarted(savedDevice.name, savedDevice.address);

      // Sync initial connection state via state machine.
      try {
        const initiallyConnected = await BluetoothMonitorModule.isCarConnected();
        if (initiallyConnected) {
          ParkingDetectionStateMachine.btInitConnected('bt_profile_proxy');
        } else {
          ParkingDetectionStateMachine.btInitDisconnected('bt_profile_proxy');
        }
        log.info(`Initial BT state after restart: ${initiallyConnected ? 'CONNECTED' : 'NOT connected'}`);
      } catch (e) {
        log.debug('Could not get initial BT state:', e);
      }

      // Single delayed re-check at 2s for async profile proxy result.
      const restartTime = Date.now();
      setTimeout(async () => {
        try {
          if (!BluetoothMonitorModule) return;
          if (this.lastNativeBtEventTime > restartTime) return;
          const check = await BluetoothMonitorModule.isCarConnected();
          const smState = ParkingDetectionStateMachine.state;
          if (check && smState !== 'DRIVING') {
            ParkingDetectionStateMachine.btInitConnected('bt_profile_proxy');
          } else if (!check && smState === 'DRIVING') {
            ParkingDetectionStateMachine.btInitDisconnected('bt_profile_proxy');
          }
        } catch (e) { /* ignore */ }
      }, 2000);

      // Ensure monitoring state is set
      this.state.isMonitoring = true;
      await this.saveState();
    } catch (error) {
      log.error('Failed to restart BT monitoring:', error);
    }
  }

  /**
   * Handle car reconnection event (Bluetooth reconnects)
   * This triggers departure tracking
   */
  private async handleCarReconnection(nativeDrivingTimestamp?: number): Promise<void> {
    log.info('Car reconnection detected via Bluetooth');
    await this.markCarReconnected(nativeDrivingTimestamp);
  }

  /**
   * Attempt departure tracking for orphaned parking records.
   *
   * "Orphaned" means: there's a parking history record without a departure,
   * but the state machine wasn't in PARKED state when driving started.
   * This happens when:
   * - App was reinstalled (AsyncStorage cleared, state machine reset to IDLE)
   * - State machine state was lost due to a bug
   * - User did a manual parking check, which didn't previously update state machine
   *
   * This function is idempotent: if there's no orphaned record, it does nothing.
   */
  private async tryRecordDepartureForOrphanedParking(): Promise<void> {
    try {
      const recentItem = await ParkingHistoryService.getMostRecent();

      if (!recentItem) {
        log.debug('tryRecordDepartureForOrphanedParking: no parking history');
        return;
      }

      if (recentItem.departure) {
        log.debug('tryRecordDepartureForOrphanedParking: most recent record already has departure');
        return;
      }

      // Check if the parking record is reasonably recent (within last 24 hours)
      // Old records shouldn't trigger departure tracking - the user may have had many drives since
      const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
      const age = Date.now() - recentItem.timestamp;
      if (age > MAX_AGE_MS) {
        log.info(`tryRecordDepartureForOrphanedParking: parking record too old (${Math.round(age / 3600000)}h), skipping`);
        return;
      }

      log.info('tryRecordDepartureForOrphanedParking: found orphaned parking record, triggering departure tracking', {
        historyItemId: recentItem.id,
        parkedAt: recentItem.timestamp,
        ageHours: Math.round(age / 3600000 * 10) / 10,
      });

      // Use the existing departure tracking flow
      await this.markCarReconnected();
    } catch (error) {
      log.error('tryRecordDepartureForOrphanedParking failed', error);
    }
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
          // Feed disconnect event into state machine — it handles the 10s debounce internally
          log.info('JS-SIDE BT DISCONNECT EVENT → feeding to state machine');
          ParkingDetectionStateMachine.btDisconnected('bt_acl', {
            deviceName: savedDevice.name,
            deviceAddress: savedDevice.address ?? '',
            source: 'js_fallback',
          });
        },
        async () => {
          // Feed connect event into state machine
          log.info('JS-SIDE BT CONNECT EVENT → feeding to state machine');
          ParkingDetectionStateMachine.btConnected('bt_acl', {
            deviceName: savedDevice.name,
            deviceAddress: savedDevice.address ?? '',
            source: 'js_fallback',
          });
        }
      );
      log.info('JS-side Bluetooth monitoring active for: ' + savedDevice.name);

      // Notify the state machine that monitoring is active
      ParkingDetectionStateMachine.monitoringStarted(savedDevice.name, savedDevice.address);

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
  }, nativeTimestamp?: number): Promise<void> {
    // Debounce: if handleCarDisconnection was called in the last 30 seconds, skip.
    // Multiple sources can trigger this for the same physical disconnect:
    // native service event, JS-side BluetoothClassic listener, pending event check.
    const now = Date.now();
    const timeSinceLastHandler = now - this.lastDisconnectHandlerTime;
    if (timeSinceLastHandler < 30000) {
      log.info(`handleCarDisconnection debounced: last call was ${Math.round(timeSinceLastHandler / 1000)}s ago (< 30s)`);
      return;
    }
    this.lastDisconnectHandlerTime = now;

    log.info('=== CAR DISCONNECTION HANDLER TRIGGERED ===');
    log.info(`Parking coords provided: ${parkingCoords ? `${parkingCoords.latitude.toFixed(6)}, ${parkingCoords.longitude.toFixed(6)}` : 'NO (will get GPS)'}`);
    if (nativeTimestamp) {
      const delayMs = Date.now() - nativeTimestamp;
      log.info(`Native event timestamp: ${new Date(nativeTimestamp).toISOString()} (${Math.round(delayMs / 1000)}s ago)`);
    }

    // If there's a pending departure from a PREVIOUS parking spot, finalize it NOW
    // with the current time as the departure time (since driving has clearly happened).
    // This prevents the old departure timer from firing AFTER the new parking is recorded.
    if (this.state.pendingDepartureConfirmation) {
      log.info('Finalizing previous departure before recording new parking');
      await this.finalizePendingDepartureImmediately();
    }

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
    await this.triggerParkingCheck(parkingCoords, true, nativeTimestamp);

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
  }, isRealParkingEvent: boolean = true, nativeTimestamp?: number): Promise<void> {
    // Guard against duplicate parking checks (e.g., from app state changes re-triggering).
    // ONLY throttle non-real events (periodic checks, retries). Real parking events
    // (BT disconnect, iOS CoreMotion detection) MUST always be processed — the user
    // can legitimately park twice within 5 minutes (e.g., quick stop then drive 6 blocks).
    if (!isRealParkingEvent && this.state.lastParkingCheckTime) {
      const timeSinceLastCheck = Date.now() - this.state.lastParkingCheckTime;
      if (timeSinceLastCheck < MIN_PARKING_CHECK_INTERVAL_MS) {
        log.info(`Skipping non-real parking check - last check was ${Math.round(timeSinceLastCheck / 1000)}s ago (min interval: ${MIN_PARKING_CHECK_INTERVAL_MS / 1000}s)`);
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
        // TWO-PHASE approach: get a fast single fix immediately, then refine
        // with burst-sampling in the background. This gives the user a
        // notification in ~3-5s instead of ~15s while still achieving high
        // accuracy for history and server records.
        log.info(`Getting GPS location... (Platform: ${Platform.OS}, appState: ${AppState.currentState})`);

        // Phase 1: Fast single GPS fix (1-3 seconds)
        try {
          coords = await LocationService.getCurrentLocation('high', true);
          gpsSource = `fast-single (${coords.accuracy?.toFixed(1)}m)`;
          log.info(`Fast GPS fix: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} ±${coords.accuracy?.toFixed(1) || '?'}m`);
        } catch (fastError) {
          log.warn('Fast GPS failed, trying balanced:', fastError);
          try {
            coords = await LocationService.getLocationWithRetry(3, undefined, true);
            gpsSource = `retry-balanced (${coords.accuracy?.toFixed(1)}m)`;
          } catch (retryError) {
            // Use any available fallback
            const cachedCoords = LocationService.getCachedLocation();
            if (cachedCoords) {
              coords = cachedCoords;
              gpsSource = `cache-fallback (${cachedCoords.accuracy?.toFixed(1) || '?'}m)`;
            } else {
              const staleCoords = LocationService.getLastKnownLocation();
              if (staleCoords) {
                coords = staleCoords;
                gpsSource = `stale-cache (${staleCoords.accuracy?.toFixed(1) || '?'}m)`;
              } else if (Platform.OS === 'ios') {
                const lastDriving = await BackgroundLocationService.getLastDrivingLocation();
                if (lastDriving) {
                  coords = {
                    latitude: lastDriving.latitude,
                    longitude: lastDriving.longitude,
                    accuracy: lastDriving.accuracy,
                  };
                  gpsSource = 'last-driving-fallback';
                } else {
                  log.error('ALL GPS methods failed');
                  await this.sendDiagnosticNotification(
                    'GPS Failed',
                    'Could not get your location. Make sure Location Services are enabled and set to "Always".'
                  );
                  throw retryError;
                }
              } else {
                log.error('ALL GPS methods failed on Android');
                await this.sendDiagnosticNotification(
                  'GPS Failed',
                  'Could not get your location. Make sure Location is set to "Allow all the time".'
                );
                throw retryError;
              }
            }
          }
        }

        // Phase 2: Kick off burst-sampling in the background.
        // If the refined location differs significantly (>25m), re-run the
        // parking check and update the notification + history silently.
        const initialCoords = { ...coords };
        this.backgroundBurstRefine(initialCoords, nativeTimestamp);
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
        log.info(`Saving to parking history: addr="${result.address}", rules=${result.rules.length}, coords=${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}${nativeTimestamp ? `, nativeTime=${new Date(nativeTimestamp).toISOString()}` : ''}`);
        await ParkingHistoryService.addToHistory(coords, result.rules, result.address, nativeTimestamp);
        log.info('Auto-detection result saved to parking history ✓');
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
          // Use raw API response data for mapping to server fields
          const rawData = result.rawApiData || await this.getRawParkingData(result);
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

      // Save parked coordinates for periodic rescan and snow monitoring
      await this.saveParkedCoords(coords, result.address, result.rawApiData);

      // Start periodic rescan timer (re-checks restrictions every 4 hours)
      this.startRescanTimer();

      // If parked on a snow route, start monitoring local weather
      if (result.rawApiData?.twoInchSnowBan || result.rules?.some((r: any) => r.type === 'snow_route')) {
        this.startSnowForecastMonitoring();
      }

      // Check if user is parked in their own permit zone — if so, filter it out
      const filteredResult = await this.filterOwnPermitZone(result);

      // Send notification — always notify so the user knows the scan ran
      const rawData = result.rawApiData || await this.getRawParkingData(result);
      if (filteredResult.rules.length > 0) {
        await this.sendParkingNotification(filteredResult, coords.accuracy, rawData);
      } else {
        await this.sendSafeNotification(filteredResult.address, coords.accuracy, rawData);
      }

      // Schedule advance reminder notifications for upcoming restrictions.
      // IMPORTANT: Always call this, even when rules.length === 0, because
      // the spot may be clear NOW but have upcoming restrictions (e.g., street
      // cleaning tomorrow). Use rawApiData which has the full response including
      // UPCOMING timing, not the filtered rules array.
      try {
        await this.scheduleRestrictionReminders(rawData, coords);
      } catch (reminderError) {
        log.warn('Failed to schedule restriction reminders (non-fatal):', reminderError);
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
   * Phase 2 of two-phase GPS: burst-sample in the background and, if the
   * refined position is significantly different from the initial fast fix,
   * silently re-run the parking check and update notification + history.
   *
   * This is fire-and-forget — errors are logged but never bubble up.
   * The user already received a notification from Phase 1; this only
   * corrects it if the initial GPS was materially wrong (>25m off).
   */
  private async backgroundBurstRefine(
    initialCoords: { latitude: number; longitude: number; accuracy?: number },
    nativeTimestamp?: number
  ): Promise<void> {
    const REFINEMENT_THRESHOLD_M = 25; // Only re-check if burst is >25m from initial

    try {
      log.info('[GPS Phase 2] Starting background burst refinement...');
      const burstCoords = await LocationService.getParkingLocation();
      log.info(`[GPS Phase 2] Burst result: ${burstCoords.latitude.toFixed(6)}, ${burstCoords.longitude.toFixed(6)} ±${burstCoords.accuracy?.toFixed(1) || '?'}m (confidence: ${burstCoords.confidence})`);

      // Calculate distance between fast fix and burst-averaged position
      const distM = this.haversineDistance(
        initialCoords.latitude, initialCoords.longitude,
        burstCoords.latitude, burstCoords.longitude
      );
      log.info(`[GPS Phase 2] Distance from initial fix: ${distM.toFixed(1)}m (threshold: ${REFINEMENT_THRESHOLD_M}m)`);

      if (distM < REFINEMENT_THRESHOLD_M) {
        log.info('[GPS Phase 2] Burst position within threshold — no correction needed');
        return;
      }

      // --- Position differs significantly: re-run parking check ---
      log.info(`[GPS Phase 2] Position shifted ${distM.toFixed(0)}m — re-checking parking rules...`);

      const result = await LocationService.checkParkingLocation(burstCoords);
      const filteredResult = await this.filterOwnPermitZone(result);

      // Update saved result (HomeScreen hero card reads this)
      await LocationService.saveParkingCheckResult(result);

      // Update parking history — find the most recent entry and update its coords/rules
      try {
        const recentItem = await ParkingHistoryService.getMostRecent();
        if (recentItem) {
          await ParkingHistoryService.updateItem(recentItem.id, {
            coords: burstCoords,
            address: result.address,
            rules: result.rules,
          });
          log.info(`[GPS Phase 2] Updated history entry ${recentItem.id} with refined location`);
        }
      } catch (histErr) {
        log.warn('[GPS Phase 2] Failed to update history (non-fatal):', histErr);
      }

      // Re-send notification with corrected data
      const rawData = result.rawApiData || await this.getRawParkingData(result);
      if (filteredResult.rules.length > 0) {
        await this.sendParkingNotification(filteredResult, burstCoords.accuracy, rawData);
      } else {
        await this.sendSafeNotification(filteredResult.address, burstCoords.accuracy, rawData);
      }

      // Update server record
      try {
        const fcmToken = await PushNotificationService.getToken();
        if (fcmToken && AuthService.isAuthenticated()) {
          await LocationService.saveParkedLocationToServer(burstCoords, rawData, result.address, fcmToken);
        }
      } catch (serverErr) {
        log.warn('[GPS Phase 2] Failed to update server (non-fatal):', serverErr);
      }

      // Update saved parked coords (for rescan + snow monitoring)
      await this.saveParkedCoords(burstCoords, result.address, result.rawApiData);

      // Re-schedule restriction reminders with corrected location
      try {
        await this.scheduleRestrictionReminders(rawData, burstCoords);
      } catch (reminderErr) {
        log.warn('[GPS Phase 2] Failed to reschedule reminders (non-fatal):', reminderErr);
      }

      log.info(`[GPS Phase 2] Correction complete: ${result.address} (${filteredResult.rules.length} rules)`);
    } catch (error) {
      // Entirely non-fatal — Phase 1 result stands
      log.warn('[GPS Phase 2] Burst refinement failed (Phase 1 result stands):', error);
    }
  }

  /**
   * Haversine distance between two lat/lng points in meters.
   */
  private haversineDistance(
    lat1: number, lng1: number,
    lat2: number, lng2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
      const schedule = result.streetCleaning.schedule || '9am–3pm (estimated)';
      const dateParts = result.streetCleaning.nextDate.split('-');
      if (dateParts.length === 3) {
        const cleaningDate = new Date(
          parseInt(dateParts[0], 10),
          parseInt(dateParts[1], 10) - 1, // Month is 0-indexed
          parseInt(dateParts[2], 10),
          9, 0, 0, 0 // 9 AM local time
        );

        if (!isNaN(cleaningDate.getTime()) && cleaningDate.getTime() > Date.now()) {
          const dayName = cleaningDate.toLocaleDateString('en-US', { weekday: 'long' });
          const monthDay = cleaningDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          // Notification 1: 9pm the night before cleaning
          const nightBefore9pm = new Date(cleaningDate);
          nightBefore9pm.setDate(nightBefore9pm.getDate() - 1);
          nightBefore9pm.setHours(21, 0, 0, 0); // 9 PM

          if (nightBefore9pm.getTime() > Date.now()) {
            restrictions.push({
              type: 'street_cleaning',
              restrictionStartTime: nightBefore9pm,
              address: result.address || '',
              details: `Street cleaning ${dayName} ${monthDay}, ${schedule}. Move your car tonight to avoid a $60 ticket.`,
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
              address: result.address || '',
              details: `Street cleaning starts at 9am today (${schedule}). MOVE YOUR CAR NOW — $60 ticket.`,
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
            address: result.address || '',
            details: 'Winter overnight parking ban 3am–7am. Move before 3am or risk towing ($150+).',
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
        const zoneName = result.permitZone.zoneName || 'Permit zone';
        const schedule = result.permitZone.restrictionSchedule || 'Mon–Fri 8am–6pm (estimated)';
        restrictions.push({
          type: 'permit_zone',
          restrictionStartTime: next7am,
          address: result.address || '',
          details: `${zoneName} — enforcement: ${schedule}. Move by 8am or risk a $60 ticket.`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      }
    }

    // Snow ban - weather dependent, handled by push notifications from backend
    // Server cron sends push to users with on_snow_route=true in user_parked_vehicles

    // Enforcement risk follow-up — HIGH urgency only, max once per parking event.
    // Schedule a reminder partway through the peak enforcement window so users
    // feel the data actively watching out for them.
    const risk = result?.enforcementRisk;
    if (risk?.urgency === 'high' && risk.in_peak_window && risk.peak_window) {
      const { end_hour, hours_remaining } = risk.peak_window;

      // Schedule follow-up at ~halfway through remaining peak window, minimum 30 min out
      const followUpDelayMs = Math.max(
        (hours_remaining / 2) * 60 * 60 * 1000,
        30 * 60 * 1000 // at least 30 minutes from now
      );

      // But cap at 2 hours — don't schedule a notification 4 hours out
      const cappedDelayMs = Math.min(followUpDelayMs, 2 * 60 * 60 * 1000);

      const followUpTime = new Date(Date.now() + cappedDelayMs);

      // Only schedule if it's still within the peak window
      const todayEndHour = new Date();
      todayEndHour.setHours(end_hour, 0, 0, 0);

      if (followUpTime.getTime() < todayEndHour.getTime()) {
        const blockInfo = risk.total_block_tickets
          ? `${risk.total_block_tickets.toLocaleString()} tickets on record`
          : 'High enforcement activity';
        const endFormatted = end_hour > 12
          ? `${end_hour - 12}pm`
          : end_hour === 12 ? '12pm' : `${end_hour}am`;

        restrictions.push({
          type: 'street_cleaning', // reuse existing type — the notification content makes the difference
          restrictionStartTime: followUpTime,
          address: result.address || '',
          details: `MOVE YOUR CAR NOW — You're still in the peak enforcement window (until ${endFormatted}). ${blockInfo}. ${risk.top_violation ? `Most common violation: ${risk.top_violation}.` : ''}`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });

        log.info(`Scheduled HIGH urgency follow-up in ${Math.round(cappedDelayMs / 60000)} minutes`);
      }
    }

    if (restrictions.length > 0) {
      await LocalNotificationService.scheduleNotificationsForParking(restrictions);
      log.info(`Scheduled ${restrictions.length} local reminder notifications`);
    }
  }

  /**
   * Build a human-readable summary of upcoming restrictions from the raw API data.
   * This tells the user WHAT is coming and WHEN, even when they're currently safe.
   */
  private buildUpcomingContext(rawData: any): string {
    const parts: string[] = [];

    // Street cleaning upcoming
    if (rawData?.streetCleaning?.hasRestriction && rawData.streetCleaning.nextDate) {
      const schedule = rawData.streetCleaning.schedule || '9am–3pm (estimated)';
      const nextDate = rawData.streetCleaning.nextDate;
      // Format the date nicely (e.g., "Feb 5")
      try {
        const dateParts = nextDate.split('-');
        if (dateParts.length === 3) {
          const d = new Date(
            parseInt(dateParts[0], 10),
            parseInt(dateParts[1], 10) - 1,
            parseInt(dateParts[2], 10)
          );
          const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
          const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          parts.push(`🧹 Street cleaning ${dayName} ${monthDay}, ${schedule} — $60 ticket`);
        } else {
          parts.push(`🧹 Street cleaning ${nextDate}, ${schedule} — $60 ticket`);
        }
      } catch {
        parts.push(`🧹 Street cleaning ${nextDate}, ${schedule} — $60 ticket`);
      }
    }

    // Winter overnight ban (active on this street — happens nightly Dec-Apr 3am-7am)
    if (rawData?.winterOvernightBan?.active) {
      parts.push('❄️ Winter ban street — no parking 3am–7am, tow risk ($150+)');
    }

    // Snow route (street is a designated snow route, even if no snow now)
    // The twoInchSnowBan.active field only means snow HAS fallen. The message
    // field mentions snow route status regardless.
    if (rawData?.twoInchSnowBan?.active) {
      parts.push('🌨️ 2-inch snow ban ACTIVE — move now or risk towing');
    }

    // Permit zone
    if (rawData?.permitZone?.inPermitZone) {
      const zone = rawData.permitZone.zoneName || 'this zone';
      const schedule = rawData.permitZone.restrictionSchedule || 'check posted signs';
      if (rawData.permitZone.permitRequired) {
        parts.push(`🅿️ Permit zone ${zone} enforced now — ${schedule}`);
      } else {
        parts.push(`🅿️ Permit zone ${zone} — enforcement: ${schedule}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Build enforcement risk context string from FOIA ticket analysis.
   * Returns a concise, human-readable risk summary for notification bodies.
   *
   * 3 urgency tiers:
   * - HIGH: "You're in the peak enforcement window" — urgent, actionable
   * - MEDIUM: "Enforcement likely today" — awareness
   * - LOW: informational only — light context
   */
  private buildEnforcementRiskContext(rawData: any): string | null {
    const risk = rawData?.enforcementRisk;
    if (!risk) return null;

    const { urgency, risk_score, has_block_data, insight, in_peak_window,
            peak_window, total_block_tickets, city_rank, top_violation,
            current_hour_pct } = risk;

    switch (urgency) {
      case 'high': {
        // Peak enforcement window — most actionable alert
        const parts: string[] = [];
        parts.push(`Risk: HIGH (${risk_score}/100)`);

        if (in_peak_window && peak_window) {
          const endFormatted = peak_window.end_hour > 12
            ? `${peak_window.end_hour - 12}pm`
            : peak_window.end_hour === 12 ? '12pm' : `${peak_window.end_hour}am`;
          parts.push(`Peak enforcement window — ends at ${endFormatted}`);
        }

        if (has_block_data && total_block_tickets) {
          const rankStr = city_rank ? ` (#${city_rank} most ticketed block)` : '';
          parts.push(`${total_block_tickets.toLocaleString()} tickets issued here${rankStr}`);
        }

        if (current_hour_pct && current_hour_pct > 5) {
          parts.push(`${current_hour_pct.toFixed(0)}% of this block's tickets happen at this hour`);
        }

        if (top_violation) {
          parts.push(`Most common: ${top_violation}`);
        }

        return parts.join('\n');
      }

      case 'medium': {
        // Enforcement likely today — moderate awareness
        const parts: string[] = [];
        parts.push(`Risk: MEDIUM (${risk_score}/100)`);

        if (insight) {
          // Use the server-generated insight which is already well-written
          parts.push(insight);
        } else if (has_block_data && total_block_tickets) {
          parts.push(`${total_block_tickets.toLocaleString()} tickets on record for this block`);
          if (top_violation) {
            parts.push(`Most common: ${top_violation}`);
          }
        }

        return parts.join('\n');
      }

      case 'low': {
        // Informational — light context, don't overwhelm
        if (!has_block_data) {
          return 'Risk: LOW — Limited enforcement data for this block';
        }

        if (total_block_tickets && total_block_tickets > 50) {
          return `Risk: LOW (${risk_score}/100) — ${total_block_tickets.toLocaleString()} tickets on record, but not during this time`;
        }

        return `Risk: LOW (${risk_score}/100)`;
      }

      default:
        return null;
    }
  }

  /**
   * Send notification about parking restrictions.
   * Now includes enforcement risk intelligence from 1.18M FOIA ticket records.
   */
  private async sendParkingNotification(
    result: {
      address: string;
      rules: Array<{ message: string; severity: string }>;
    },
    accuracy?: number,
    rawData?: any
  ): Promise<void> {
    const hasCritical = result.rules.some(r => r.severity === 'critical');
    const accuracyNote = accuracy ? ` (GPS: ${accuracy.toFixed(0)}m)` : '';

    // Build the body with rule messages
    let body = `${result.address}${accuracyNote}\n${result.rules.map(r => r.message).join('\n')}`;

    // Add enforcement risk intelligence
    const riskContext = this.buildEnforcementRiskContext(rawData);
    if (riskContext) {
      body += `\n\n${riskContext}`;
    }

    // Add upcoming context that isn't already in the active rules
    // (e.g., if there's a permit zone warning but also upcoming street cleaning)
    if (rawData) {
      const upcomingContext = this.buildUpcomingContext(rawData);
      // Filter out lines that are already covered by active rules
      const activeTypes = result.rules.map((r: any) => r.type || '');
      const extraLines = upcomingContext.split('\n').filter(line => {
        if (line.includes('Street cleaning') && activeTypes.includes('street_cleaning')) return false;
        if (line.includes('Winter ban') && activeTypes.includes('winter_ban')) return false;
        if (line.includes('snow ban') && activeTypes.includes('snow_route')) return false;
        if (line.includes('Permit zone') && activeTypes.includes('permit_zone')) return false;
        return true;
      });
      if (extraLines.length > 0) {
        body += '\n\nAlso:\n' + extraLines.join('\n');
      }
    }

    // Determine urgency-aware title
    const riskUrgency = rawData?.enforcementRisk?.urgency;
    let title: string;
    if (hasCritical) {
      title = '⚠️ Parked — Restriction Active!';
    } else if (riskUrgency === 'high') {
      title = '⚠️ Parked — Peak Enforcement Window';
    } else {
      title = '⚠️ Parked — Heads Up';
    }

    await notifee.displayNotification({
      title,
      body,
      android: {
        channelId: 'parking-monitoring',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        smallIcon: 'ic_notification',
      },
      ios: {
        sound: 'default',
        critical: hasCritical,
        criticalVolume: 1.0,
      },
    });
  }

  /**
   * Send notification that parking is safe.
   * Includes upcoming restriction context and enforcement risk intelligence.
   */
  private async sendSafeNotification(address: string, accuracy?: number, rawData?: any): Promise<void> {
    const accuracyNote = accuracy ? ` (GPS: ±${accuracy.toFixed(0)}m)` : '';

    let body = `${address}${accuracyNote}\nNo active restrictions right now.`;

    // Add enforcement risk context even when "all clear" — users want to
    // understand the risk profile of where they parked
    const riskContext = this.buildEnforcementRiskContext(rawData);
    if (riskContext) {
      body += `\n\n${riskContext}`;
    }

    // Append upcoming restrictions so users know what to watch for
    if (rawData) {
      const upcomingContext = this.buildUpcomingContext(rawData);
      if (upcomingContext) {
        body += `\n\nComing up:\n${upcomingContext}\nWe'll remind you before these start.`;
      } else if (!riskContext) {
        body += ' You\'re good to park here!';
      }
    } else if (!riskContext) {
      body += ' You\'re good to park here!';
    }

    // Use risk-aware title for high urgency even when no active restriction
    const riskUrgency = rawData?.enforcementRisk?.urgency;
    const title = riskUrgency === 'high'
      ? '⚠️ Parked — Peak Enforcement Area'
      : '✅ Parked — All Clear';

    await notifee.displayNotification({
      title,
      body,
      android: {
        channelId: 'parking-monitoring',
        // Boost importance when high risk, even though technically "all clear"
        importance: riskUrgency === 'high' ? AndroidImportance.HIGH : undefined,
        pressAction: { id: 'default' },
        smallIcon: riskUrgency === 'high' ? 'ic_notification' : undefined,
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
   * Manually trigger a parking check.
   * After a successful check, transitions state machine to PARKED so that
   * departure tracking works when the user drives away.
   */
  async manualParkingCheck(): Promise<void> {
    await this.triggerParkingCheck();

    // Set state to PARKED so that when the user drives away, the PARKED→DRIVING
    // transition fires and departure is recorded. Without this, manual checks
    // leave the state machine in IDLE, and departure is never captured.
    if (Platform.OS === 'android') {
      ParkingDetectionStateMachine.manualParkingConfirmed();
    }
    // Note: iOS uses CoreMotion which tracks driving state independently,
    // so this is primarily needed for Android's BT-based detection.
  }

  /**
   * Mark car as reconnected (user feedback or detection)
   * This triggers the clear parked location API and schedules departure confirmation
   */
  async markCarReconnected(nativeDrivingTimestamp?: number): Promise<void> {
    log.info('Car reconnection detected');
    // Use the native driving-start timestamp as the departure time
    const departureTime = nativeDrivingTimestamp || Date.now();
    if (nativeDrivingTimestamp) {
      const delayMs = Date.now() - nativeDrivingTimestamp;
      log.info(`Native driving-start timestamp: ${new Date(nativeDrivingTimestamp).toISOString()} (${Math.round(delayMs / 1000)}s ago)`);
    }

    this.state.lastCarConnectionStatus = true;
    this.state.lastDisconnectTime = null;
    await this.saveState();

    // Cancel any scheduled parking reminder notifications
    await LocalNotificationService.cancelAllScheduledNotifications();
    log.info('Cancelled scheduled parking reminders');

    // Stop periodic rescan and snow monitoring
    this.stopRescanTimer();
    this.stopSnowForecastMonitoring();

    // Clear parked state data
    try {
      await AsyncStorage.multiRemove([
        StorageKeys.LAST_PARKING_LOCATION,
        StorageKeys.LAST_PARKED_COORDS,
        StorageKeys.RESCAN_LAST_RUN,
        StorageKeys.SNOW_FORECAST_LAST_CHECK,
        StorageKeys.SNOW_FORECAST_NOTIFIED,
      ]);
      log.info('Cleared parking data and rescan/snow state from AsyncStorage');
    } catch (e) {
      log.warn('Failed to clear parking data', e);
    }

    // Call the reconnect callback if provided (tells HomeScreen to clear UI)
    if (this.reconnectCallback) {
      this.reconnectCallback();
    }

    // Try server-side clear first, fall back to local-only departure tracking
    let serverSucceeded = false;

    try {
      const response = await LocationService.clearParkedLocation();

      if (response.parking_history_id && response.parked_location) {
        log.info('Parked location cleared via server, scheduling departure confirmation', {
          historyId: response.parking_history_id,
          delayMs: DEPARTURE_CONFIRMATION_DELAY_MS,
        });

        // Store pending departure confirmation (server mode)
        this.state.pendingDepartureConfirmation = {
          parkingHistoryId: response.parking_history_id,
          parkedLocation: response.parked_location,
          clearedAt: response.cleared_at,
          retryCount: 0,
          scheduledAt: Date.now(),
          departedAt: departureTime, // When driving actually started (native timestamp)
        };
        await this.saveState();
        this.scheduleDepartureConfirmation();
        serverSucceeded = true;
      }
    } catch (error) {
      log.warn('Server clear-parked-location failed (will use local fallback)', error);
    }

    // Local-only fallback: use the most recent parking history item's coords
    // This ensures departure tracking works even without network or auth
    if (!serverSucceeded) {
      try {
        const recentItem = await ParkingHistoryService.getMostRecent();
        if (recentItem && recentItem.coords) {
          log.info('Using local-only departure tracking fallback', {
            historyItemId: recentItem.id,
            parkedAt: `${recentItem.coords.latitude.toFixed(6)}, ${recentItem.coords.longitude.toFixed(6)}`,
          });

          this.state.pendingDepartureConfirmation = {
            parkingHistoryId: null, // null = local-only mode
            parkedLocation: {
              latitude: recentItem.coords.latitude,
              longitude: recentItem.coords.longitude,
            },
            clearedAt: new Date().toISOString(),
            retryCount: 0,
            scheduledAt: Date.now(),
            departedAt: departureTime, // When driving actually started (native timestamp)
            localHistoryItemId: recentItem.id,
          };
          await this.saveState();
          this.scheduleDepartureConfirmation();
        } else {
          // Last resort: capture current GPS as approximate parking spot.
          // This covers the case where the app was loaded while already parked
          // (no parking event was recorded by this app instance), then the user
          // drove away. Since onDrivingStarted fires as they BEGIN moving,
          // their current location is approximately where the car was parked.
          log.info('No parking history — attempting GPS capture as departure fallback');
          try {
            const currentPos = await new Promise<{ latitude: number; longitude: number; accuracy: number } | null>((resolve) => {
              const timeout = setTimeout(() => resolve(null), 5000);
              Geolocation.getCurrentPosition(
                (pos) => {
                  clearTimeout(timeout);
                  resolve({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                  });
                },
                () => {
                  clearTimeout(timeout);
                  resolve(null);
                },
                { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
              );
            });

            if (currentPos) {
              log.info('Using current GPS as approximate departure location', {
                lat: currentPos.latitude.toFixed(6),
                lng: currentPos.longitude.toFixed(6),
                accuracy: currentPos.accuracy,
              });
              this.state.pendingDepartureConfirmation = {
                parkingHistoryId: null,
                parkedLocation: {
                  latitude: currentPos.latitude,
                  longitude: currentPos.longitude,
                },
                clearedAt: new Date().toISOString(),
                retryCount: 0,
                scheduledAt: Date.now(),
                departedAt: departureTime,
              };
              await this.saveState();
              this.scheduleDepartureConfirmation();
            } else {
              log.warn('No parking history and GPS unavailable — departure tracking skipped');
            }
          } catch (gpsError) {
            log.error('GPS departure fallback failed', gpsError);
          }
        }
      } catch (localError) {
        log.error('Local departure tracking fallback also failed', localError);
      }
    }
  }

  /**
   * Schedule clearance record capture after a delay.
   * After 60s of driving, we capture fresh GPS and compare against
   * the parked location to prove the car has left the block.
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
   * Immediately finalize a pending departure WITHOUT waiting for the 60s confirmation.
   * Called when a NEW parking event fires while the old departure is still pending.
   * This prevents the timeline from showing: "parked at spot B" BEFORE "left spot A".
   *
   * Since the user has clearly driven to a new spot (new parking detected), we don't
   * need GPS proof that they left — the new parking IS the proof. We record the
   * departure with the departedAt timestamp and mark it as conclusive.
   */
  private async finalizePendingDepartureImmediately(): Promise<void> {
    const pending = this.state.pendingDepartureConfirmation;
    if (!pending) return;

    // Cancel the pending timer
    if (this.departureConfirmationTimeout) {
      clearTimeout(this.departureConfirmationTimeout);
      this.departureConfirmationTimeout = null;
    }

    const departureTime = pending.departedAt || Date.now();
    log.info(`Immediately finalizing departure from previous spot at ${new Date(departureTime).toISOString()}`);

    try {
      const departureData = {
        departure: {
          confirmedAt: departureTime,
          distanceMeters: 0, // Unknown — we didn't wait for GPS
          isConclusive: true, // User clearly left (they parked somewhere new)
          latitude: 0,
          longitude: 0,
        },
      };

      const targetItemId = pending.localHistoryItemId;
      if (targetItemId) {
        await ParkingHistoryService.updateItem(targetItemId, departureData);
        log.info('Previous departure finalized (local mode)', targetItemId);
      } else {
        const recentItem = await ParkingHistoryService.getMostRecent();
        if (recentItem) {
          await ParkingHistoryService.updateItem(recentItem.id, departureData);
          log.info('Previous departure finalized (server mode)', recentItem.id);
        }
      }
    } catch (error) {
      log.warn('Failed to finalize previous departure (non-critical)', error);
    }

    // Clear the pending state
    this.state.pendingDepartureConfirmation = null;
    await this.saveState();
  }

  /**
   * Confirm departure by capturing current location.
   * Two modes:
   *   1. Server mode (parkingHistoryId != null): call confirm-departure API + update local history
   *   2. Local-only mode (parkingHistoryId == null): calculate distance locally + update local history
   * Local-only mode ensures departure tracking works even without network or auth.
   */
  private async confirmDeparture(): Promise<void> {
    if (!this.state.pendingDepartureConfirmation) {
      log.debug('No pending departure confirmation');
      return;
    }

    const pending = this.state.pendingDepartureConfirmation;
    const isLocalOnly = !pending.parkingHistoryId;

    try {
      log.info('Confirming departure...', {
        attempt: pending.retryCount + 1,
        mode: isLocalOnly ? 'local-only' : 'server',
      });

      // Get fresh GPS — where the car is NOW after ~60s of driving.
      // Compare against parkedLocation to prove the car left the block.
      // This is a "clearance record": proof for ticket contesting.
      let currentCoords;
      try {
        currentCoords = await LocationService.getHighAccuracyLocation(30, 20000);
        log.info(`Clearance GPS (current position): ${currentCoords.latitude.toFixed(6)}, ${currentCoords.longitude.toFixed(6)} (±${currentCoords.accuracy?.toFixed(1)}m)`);
      } catch (error) {
        log.warn('High accuracy location failed, trying fallback', error);
        currentCoords = await LocationService.getLocationWithRetry(3);
      }

      let distanceMeters: number;
      let isConclusive: boolean;
      const CONCLUSIVE_DISTANCE_M = 50; // 50m — far enough to prove they left the spot, close enough to catch end-of-block moves

      if (isLocalOnly) {
        distanceMeters = this.haversineDistance(
          pending.parkedLocation.latitude,
          pending.parkedLocation.longitude,
          currentCoords.latitude,
          currentCoords.longitude
        );
        isConclusive = distanceMeters > CONCLUSIVE_DISTANCE_M;

        log.info('Clearance calculation:', {
          distanceMeters: Math.round(distanceMeters),
          isConclusive,
          threshold: CONCLUSIVE_DISTANCE_M,
        });

        // Best-effort server sync
        this.tryServerDepartureConfirmation(currentCoords, pending).catch(() => {});
      } else {
        const result = await LocationService.confirmDeparture(
          pending.parkingHistoryId!,
          currentCoords.latitude,
          currentCoords.longitude,
          currentCoords.accuracy
        );

        distanceMeters = result.distance_from_parked_meters;
        isConclusive = distanceMeters > CONCLUSIVE_DISTANCE_M;

        log.info('Server clearance confirmed:', {
          distance: distanceMeters,
          isConclusive,
          threshold: CONCLUSIVE_DISTANCE_M,
        });
      }

      // Save clearance record to parking history.
      // Coords = where the car is NOW (proof it's not at the parking spot).
      // Timestamp = when driving started (departedAt), not when we confirmed.
      const departureTime = pending.departedAt || Date.now();
      const confirmationDelay = Math.round((Date.now() - departureTime) / 1000);
      log.info(`Clearance time: ${new Date(departureTime).toISOString()} (confirmed ${confirmationDelay}s later)`);

      try {
        const clearanceData = {
          departure: {
            confirmedAt: departureTime,
            distanceMeters,
            isConclusive,
            latitude: currentCoords.latitude,
            longitude: currentCoords.longitude,
          },
        };

        const targetItemId = pending.localHistoryItemId;
        if (targetItemId) {
          await ParkingHistoryService.updateItem(targetItemId, clearanceData);
          log.info('Clearance record saved (local mode)', targetItemId);
        } else {
          const recentItem = await ParkingHistoryService.getMostRecent();
          if (recentItem) {
            await ParkingHistoryService.updateItem(recentItem.id, clearanceData);
            log.info('Clearance record saved (server mode)', recentItem.id);
          }
        }
      } catch (historyError) {
        log.warn('Failed to save clearance record (non-critical)', historyError);
      }

      // Clear pending confirmation on success
      this.state.pendingDepartureConfirmation = null;
      await this.saveState();

      // Clearance record — always silent. This is proof the car left the spot,
      // saved to history for ticket contesting. No user notification needed.
      log.info(`Clearance record saved: ${Math.round(distanceMeters)}m from parking spot, conclusive=${isConclusive}`);
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
        // Max retries exceeded — silently give up. Clearance record is nice-to-have,
        // not critical enough to bother the user about.
        log.warn('Max clearance record retries exceeded, giving up');
        this.state.pendingDepartureConfirmation = null;
        await this.saveState();
      }
    }
  }

  /**
   * Best-effort: try to also send departure data to the server even in local-only mode.
   * If auth/network recovered since the initial failure, the server gets the data too.
   */
  private async tryServerDepartureConfirmation(
    coords: { latitude: number; longitude: number; accuracy?: number },
    pending: NonNullable<BackgroundTaskState['pendingDepartureConfirmation']>
  ): Promise<void> {
    try {
      if (!AuthService.isAuthenticated()) return;
      const response = await LocationService.clearParkedLocation();
      if (response.parking_history_id) {
        await LocationService.confirmDeparture(
          response.parking_history_id,
          coords.latitude,
          coords.longitude,
          coords.accuracy
        );
        log.info('Best-effort server departure confirmation succeeded');
      }
    } catch (e) {
      // Expected to fail sometimes — that's fine, local data is already saved
      log.debug('Best-effort server departure confirmation failed (expected)', e);
    }
  }

  /**
   * Calculate distance between two lat/lng points using the Haversine formula.
   * Returns distance in meters.
   */
  private haversineDistance(
    lat1: number, lng1: number,
    lat2: number, lng2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  // Clearance record notifications removed — this data is saved silently
  // to history for ticket contesting. No user-facing notifications needed.

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

  // ==========================================================================
  // Periodic Rescan — re-check parking restrictions at last parked location
  // ==========================================================================

  /**
   * Save the parked coordinates so periodic rescan can re-check later.
   */
  private async saveParkedCoords(
    coords: { latitude: number; longitude: number },
    address: string,
    rawApiData?: any
  ): Promise<void> {
    try {
      await AsyncStorage.setItem(StorageKeys.LAST_PARKED_COORDS, JSON.stringify({
        lat: coords.latitude,
        lng: coords.longitude,
        address,
        parkedAt: new Date().toISOString(),
        onSnowRoute: !!(rawApiData?.twoInchSnowBan || rawApiData?.snowRoute),
      }));
    } catch (e) {
      log.warn('Failed to save parked coords for rescan', e);
    }
  }

  /**
   * Start a 4-hour recurring timer to re-check parking restrictions.
   * Catches changed conditions: new snow ban, approaching street cleaning day, etc.
   */
  private startRescanTimer(): void {
    this.stopRescanTimer();

    // First rescan after 4 hours
    this.rescanInterval = setInterval(async () => {
      await this.performRescan();
    }, RESCAN_INTERVAL_MS);

    log.info('Rescan timer started (every 4 hours while parked)');
  }

  private stopRescanTimer(): void {
    if (this.rescanInterval) {
      clearInterval(this.rescanInterval);
      this.rescanInterval = null;
    }
  }

  /**
   * Re-check parking restrictions at the last parked location.
   * If conditions changed, send a new notification and reschedule reminders.
   */
  private async performRescan(): Promise<void> {
    try {
      const parkedJson = await AsyncStorage.getItem(StorageKeys.LAST_PARKED_COORDS);
      if (!parkedJson) {
        log.debug('Rescan skipped — no parked coords saved');
        return;
      }

      const parked = JSON.parse(parkedJson);
      log.info('Performing periodic rescan at last parked location', {
        lat: parked.lat.toFixed(4),
        lng: parked.lng.toFixed(4),
        parkedAt: parked.parkedAt,
      });

      // Re-call the parking API with the saved coordinates
      const result = await LocationService.checkParkingLocation({
        latitude: parked.lat,
        longitude: parked.lng,
      });

      // Save updated result
      await LocationService.saveParkingCheckResult(result);

      // Update last rescan time
      await AsyncStorage.setItem(StorageKeys.RESCAN_LAST_RUN, new Date().toISOString());

      // Filter own permit zone
      const filteredResult = await this.filterOwnPermitZone(result);
      const rawData = result.rawApiData || await this.getRawParkingData(result);

      // Only notify if there are active restrictions (don't spam "All Clear" every 4 hours)
      if (filteredResult.rules.length > 0) {
        await notifee.displayNotification({
          title: '🔄 Parking Update — Conditions Changed',
          body: `${filteredResult.address}\n${filteredResult.rules.map((r: any) => r.message).join('\n')}`,
          android: {
            channelId: 'parking-monitoring',
            importance: AndroidImportance.HIGH,
            pressAction: { id: 'default' },
            smallIcon: 'ic_notification',
          },
          ios: {
            sound: 'default',
          },
        });
        log.info('Rescan found active restrictions — notified user');
      }

      // Re-schedule advance reminders with updated data
      try {
        await this.scheduleRestrictionReminders(rawData, { latitude: parked.lat, longitude: parked.lng });
      } catch (e) {
        log.warn('Failed to reschedule reminders after rescan', e);
      }

      log.info('Periodic rescan complete', { rules: result.rules.length });
    } catch (error) {
      log.warn('Periodic rescan failed (non-fatal)', error);
    }
  }

  // ==========================================================================
  // Snow Forecast Monitoring — local weather check while parked on snow route
  // ==========================================================================

  /**
   * Start periodic weather checks when parked on a designated snow route.
   * Uses the National Weather Service (NWS) API — free, no API key needed.
   * Checks if 2" or more snow is forecast OR has recently fallen.
   */
  private startSnowForecastMonitoring(): void {
    this.stopSnowForecastMonitoring();

    // Run an initial check after 5 minutes (give time for settlement)
    this.snowForecastInitialTimeout = setTimeout(() => {
      this.snowForecastInitialTimeout = null;
      this.checkSnowForecast().catch(e =>
        log.warn('Initial snow forecast check failed', e)
      );
    }, 5 * 60 * 1000);

    // Then check every 2 hours
    this.snowForecastInterval = setInterval(async () => {
      await this.checkSnowForecast();
    }, SNOW_FORECAST_CHECK_INTERVAL_MS);

    log.info('Snow forecast monitoring started (parked on snow route)');
  }

  private stopSnowForecastMonitoring(): void {
    if (this.snowForecastInitialTimeout) {
      clearTimeout(this.snowForecastInitialTimeout);
      this.snowForecastInitialTimeout = null;
    }
    if (this.snowForecastInterval) {
      clearInterval(this.snowForecastInterval);
      this.snowForecastInterval = null;
    }
  }

  /**
   * Check the NWS forecast for Chicago snow accumulation.
   * Uses api.weather.gov which is free and doesn't require an API key.
   * Notifies the user if 2" or more snow is forecast.
   *
   * Urgency scales with how soon the snow is expected:
   * - Within ~6 hours: URGENT (critical alert, sound)
   * - Within ~12-24 hours: WARNING (heads up, plan to move)
   * - 24+ hours out: INFO (FYI, keep an eye on it)
   */
  private async checkSnowForecast(): Promise<void> {
    try {
      // Check if already notified about this snow event
      const alreadyNotified = await AsyncStorage.getItem(StorageKeys.SNOW_FORECAST_NOTIFIED);
      if (alreadyNotified === 'true') {
        log.debug('Snow forecast check skipped — already notified about current event');
        return;
      }

      // Verify we're still parked on a snow route
      const parkedJson = await AsyncStorage.getItem(StorageKeys.LAST_PARKED_COORDS);
      if (!parkedJson) return;
      const parked = JSON.parse(parkedJson);
      if (!parked.onSnowRoute) {
        log.debug('Snow forecast check skipped — not on a snow route');
        return;
      }

      log.info('Checking NWS forecast for snow...');

      // NWS API: Get forecast for Chicago (with 15-second timeouts)
      // Step 1: Get the grid point for Chicago coordinates
      const pointAbort = new AbortController();
      const pointTimer = setTimeout(() => pointAbort.abort(), 15000);

      let pointResponse: Response;
      try {
        pointResponse = await fetch(
          `https://api.weather.gov/points/${CHICAGO_WEATHER_LAT},${CHICAGO_WEATHER_LNG}`,
          {
            headers: {
              'User-Agent': 'TicketlessChicago/1.0 (parking app)',
              Accept: 'application/geo+json',
            },
            signal: pointAbort.signal,
          }
        );
      } finally {
        clearTimeout(pointTimer);
      }

      if (!pointResponse.ok) {
        log.warn('NWS point lookup failed:', pointResponse.status);
        return;
      }

      const pointData = await pointResponse.json();
      const forecastUrl = pointData?.properties?.forecast;
      if (!forecastUrl) {
        log.warn('No forecast URL in NWS point response');
        return;
      }

      // Step 2: Get the detailed forecast
      const forecastAbort = new AbortController();
      const forecastTimer = setTimeout(() => forecastAbort.abort(), 15000);

      let forecastResponse: Response;
      try {
        forecastResponse = await fetch(forecastUrl, {
          headers: {
            'User-Agent': 'TicketlessChicago/1.0 (parking app)',
            Accept: 'application/geo+json',
          },
          signal: forecastAbort.signal,
        });
      } finally {
        clearTimeout(forecastTimer);
      }

      if (!forecastResponse.ok) {
        log.warn('NWS forecast fetch failed:', forecastResponse.status);
        return;
      }

      const forecastData = await forecastResponse.json();
      const periods = forecastData?.properties?.periods || [];

      // Check the next 4 periods (~48 hours) for snow
      let snowForecast: { amount: number; period: string; hoursAway: number } | null = null;

      for (const period of periods.slice(0, 4)) {
        const forecast = (period.detailedForecast || '').toLowerCase();
        const shortForecast = (period.shortForecast || '').toLowerCase();

        // Look for snow accumulation mentions
        // NWS uses patterns like "snow accumulation of 2 to 4 inches"
        // or "new snow accumulation of around 3 inches"
        const accumMatch = forecast.match(
          /(?:snow|snowfall)\s+(?:accumulation|accumulations?)\s+(?:of\s+)?(?:around\s+)?(\d+)(?:\s*to\s*(\d+))?\s*inch/i
        );

        let snowAmount = 0;

        if (accumMatch) {
          const lowInches = parseInt(accumMatch[1], 10);
          const highInches = accumMatch[2] ? parseInt(accumMatch[2], 10) : lowInches;
          snowAmount = (lowInches + highInches) / 2;
        } else if (
          (shortForecast.includes('snow') || forecast.includes('snow')) &&
          (forecast.includes('heavy') || forecast.includes('considerable'))
        ) {
          snowAmount = 2; // Conservative estimate for heavy snow without specific inches
        }

        if (snowAmount >= 2) {
          // Calculate hours until this forecast period starts
          const periodStart = period.startTime ? new Date(period.startTime).getTime() : Date.now();
          const hoursAway = Math.max(0, (periodStart - Date.now()) / (60 * 60 * 1000));

          snowForecast = { amount: snowAmount, period: period.name, hoursAway };
          break;
        }
      }

      await AsyncStorage.setItem(StorageKeys.SNOW_FORECAST_LAST_CHECK, new Date().toISOString());

      if (snowForecast) {
        log.info('Snow forecast detected!', snowForecast);
        await AsyncStorage.setItem(StorageKeys.SNOW_FORECAST_NOTIFIED, 'true');

        // Scale urgency based on how soon the snow is expected
        const isImminent = snowForecast.hoursAway <= 6;   // Within 6 hours — urgent
        const isSoon = snowForecast.hoursAway <= 24;       // Within 24 hours — warning
        // else: 24+ hours out — informational

        let title: string;
        let body: string;
        let channelId: string;
        let importance: AndroidImportance;
        let isCritical: boolean;

        if (isImminent) {
          // Snow within hours — urgent, needs action now
          title = '🌨️ Snow Alert — Move Your Car!';
          body = `${snowForecast.amount}" of snow expected ${snowForecast.period}.\n\n${parked.address}\nYour car is on a snow route. 2" snow ban = towing risk ($150+). Move your car now.`;
          channelId = 'parking-alerts';
          importance = AndroidImportance.HIGH;
          isCritical = true;
        } else if (isSoon) {
          // Snow within a day — heads up, plan to move
          title = '🌨️ Snow Coming — Plan to Move';
          body = `${snowForecast.amount}" of snow forecast for ${snowForecast.period}.\n\n${parked.address}\nYour car is on a snow route. Plan to move before it starts — 2" triggers a tow-risk snow ban.`;
          channelId = 'reminders';
          importance = AndroidImportance.DEFAULT;
          isCritical = false;
        } else {
          // Snow 24+ hours out — FYI
          title = '🌨️ Snow in the Forecast';
          body = `${snowForecast.amount}" of snow forecast for ${snowForecast.period} (~${Math.round(snowForecast.hoursAway)} hours from now).\n\n${parked.address}\nYour car is on a snow route. Keep an eye on it — we'll alert you again if it gets closer.`;
          channelId = 'reminders';
          importance = AndroidImportance.LOW;
          isCritical = false;
          // For distant forecasts, allow re-notification when it gets closer
          await AsyncStorage.removeItem(StorageKeys.SNOW_FORECAST_NOTIFIED);
        }

        await notifee.displayNotification({
          title,
          body,
          android: {
            channelId,
            importance,
            pressAction: { id: 'default' },
            smallIcon: 'ic_notification',
          },
          ios: {
            sound: isCritical ? 'default' : undefined,
            critical: isCritical,
            criticalVolume: isCritical ? 1.0 : undefined,
          },
        });

        log.info(`Snow forecast notification sent (urgency: ${isImminent ? 'URGENT' : isSoon ? 'WARNING' : 'INFO'}, ${snowForecast.hoursAway.toFixed(1)}h away)`);
      } else {
        log.debug('No significant snow in forecast');
      }
    } catch (error) {
      log.warn('Snow forecast check failed (non-fatal)', error);
    }
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
