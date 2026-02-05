/**
 * ParkingDetectionStateMachine
 *
 * Single source of truth for parking/driving detection state on Android.
 * Replaces the scattered state across SharedPreferences, BluetoothService,
 * BackgroundTaskService, and HomeScreen component state.
 *
 * States:
 *   INITIALIZING → IDLE | DRIVING | PARKED
 *   IDLE         → DRIVING
 *   DRIVING      → PARKING_PENDING → PARKED
 *   PARKED       → DRIVING
 *
 * All native layers (BT service, Activity Recognition) feed events INTO this
 * machine. UI reads FROM it. One source of truth, no fallback checks needed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';

const log = Logger.createLogger('ParkingStateMachine');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParkingState =
  | 'INITIALIZING'  // App just started, waiting for BT check to complete
  | 'IDLE'          // No car paired, or monitoring not started
  | 'DRIVING'       // Car BT connected (user is in the car or near it)
  | 'PARKING_PENDING' // BT disconnected, inside debounce window
  | 'PARKED';       // Parking confirmed after debounce

export type DetectionEventType =
  | 'BT_CONNECTED'           // Car Bluetooth connected (ACL event)
  | 'BT_DISCONNECTED'        // Car Bluetooth disconnected (ACL event)
  | 'BT_INIT_CONNECTED'      // Initial BT check: car is connected
  | 'BT_INIT_DISCONNECTED'   // Initial BT check: car is NOT connected
  | 'DEBOUNCE_EXPIRED'       // 10s debounce timer completed, still disconnected
  | 'DEBOUNCE_CANCELLED'     // BT reconnected during debounce window
  | 'PARKING_CONFIRMED'      // Parking check completed successfully
  | 'DEPARTURE_DETECTED'     // User started driving again (BT reconnect)
  | 'MONITORING_STARTED'     // User started monitoring (car paired)
  | 'MONITORING_STOPPED'     // User stopped monitoring
  | 'ACTIVITY_DRIVING'       // Activity Recognition: IN_VEHICLE detected
  | 'ACTIVITY_STILL'         // Activity Recognition: STILL/WALKING detected
  | 'STATE_RESTORED';        // State restored from persistence on app restart

export type DetectionSource =
  | 'bt_acl'              // Android BT Classic ACL event
  | 'bt_profile_proxy'    // Android BT profile proxy check
  | 'activity_recognition'// Google Activity Recognition API
  | 'periodic_check'      // 15-minute periodic fallback
  | 'user_manual'         // User triggered manually
  | 'system';             // Internal (timers, persistence, initialization)

export interface DetectionEvent {
  type: DetectionEventType;
  source: DetectionSource;
  timestamp: number;
  prevState: ParkingState;
  newState: ParkingState;
  metadata?: Record<string, any>;
}

export interface ParkingDetectionSnapshot {
  state: ParkingState;
  carName: string | null;
  carAddress: string | null;
  lastEventType: DetectionEventType | null;
  lastEventTime: number | null;
  isConnectedToCar: boolean;
}

type StateListener = (snapshot: ParkingDetectionSnapshot) => void;
type TransitionCallback = (event: DetectionEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'parkingStateMachine';
const EVENT_LOG_STORAGE_KEY = 'parkingDetectionEventLog';
const MAX_EVENT_LOG_SIZE = 100;
const DEBOUNCE_DURATION_MS = 10_000; // 10 seconds — filters red light disconnects

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<ParkingState, ParkingState[]> = {
  INITIALIZING: ['IDLE', 'DRIVING', 'PARKED'],
  IDLE:         ['DRIVING', 'INITIALIZING'],
  DRIVING:      ['PARKING_PENDING', 'IDLE'],
  PARKING_PENDING: ['DRIVING', 'PARKED', 'IDLE'],
  PARKED:       ['DRIVING', 'IDLE'],
};

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

class ParkingDetectionStateMachineClass {
  private _state: ParkingState = 'INITIALIZING';
  private _carName: string | null = null;
  private _carAddress: string | null = null;
  private _lastEventType: DetectionEventType | null = null;
  private _lastEventTime: number | null = null;

  // Listeners
  private _stateListeners: StateListener[] = [];
  private _transitionCallbacks: Map<string, TransitionCallback[]> = new Map();

  // Event log (ring buffer)
  private _eventLog: DetectionEvent[] = [];

  // Debounce timer
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Track initialization
  private _initialized = false;

  // What put us into DRIVING state? If Activity Recognition (no BT), then
  // Activity Recognition STILL/WALKING should also trigger parking.
  // If BT put us into DRIVING, only BT disconnect triggers parking.
  private _drivingSource: DetectionSource | null = null;

  // Longer debounce for Activity Recognition (less precise than BT disconnect)
  private static readonly AR_DEBOUNCE_DURATION_MS = 30_000; // 30 seconds

  // ---------------------------------------------------------------------------
  // Public API — Reading State
  // ---------------------------------------------------------------------------

  get state(): ParkingState {
    return this._state;
  }

  get isConnectedToCar(): boolean {
    return this._state === 'DRIVING';
  }

  get isParked(): boolean {
    return this._state === 'PARKED';
  }

  get isParkingPending(): boolean {
    return this._state === 'PARKING_PENDING';
  }

  get carName(): string | null {
    return this._carName;
  }

  get snapshot(): ParkingDetectionSnapshot {
    return {
      state: this._state,
      carName: this._carName,
      carAddress: this._carAddress,
      lastEventType: this._lastEventType,
      lastEventTime: this._lastEventTime,
      isConnectedToCar: this.isConnectedToCar,
    };
  }

  get eventLog(): ReadonlyArray<DetectionEvent> {
    return this._eventLog;
  }

  // ---------------------------------------------------------------------------
  // Public API — Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize the state machine. Call once at app startup.
   * Restores persisted state and event log from AsyncStorage.
   */
  async initialize(carName?: string | null, carAddress?: string | null): Promise<void> {
    if (this._initialized) return;

    this._carName = carName ?? null;
    this._carAddress = carAddress ?? null;

    // Restore persisted state
    try {
      const [stateJson, logJson] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(EVENT_LOG_STORAGE_KEY),
      ]);

      if (logJson) {
        try {
          this._eventLog = JSON.parse(logJson);
        } catch {
          this._eventLog = [];
        }
      }

      if (stateJson) {
        const persisted = JSON.parse(stateJson);
        // Only restore to stable states (DRIVING or PARKED).
        // INITIALIZING and PARKING_PENDING are transient — if the app
        // crashed during those, we need to re-initialize properly.
        if (persisted.state === 'DRIVING' || persisted.state === 'PARKED') {
          this._state = persisted.state;
          this._lastEventType = persisted.lastEventType ?? null;
          this._lastEventTime = persisted.lastEventTime ?? null;
          this.logEvent('STATE_RESTORED', 'system', {
            restoredState: persisted.state,
          });
          log.info(`State restored from persistence: ${persisted.state}`);
        } else {
          log.info(`Ignoring persisted transient state: ${persisted.state}, starting in INITIALIZING`);
        }
      }
    } catch (e) {
      log.warn('Failed to restore state machine state:', e);
    }

    this._initialized = true;
    log.info(`ParkingStateMachine initialized. State: ${this._state}, car: ${this._carName}`);
  }

  // ---------------------------------------------------------------------------
  // Public API — Sending Events
  // ---------------------------------------------------------------------------

  /**
   * Bluetooth connected event — car BT ACL connected.
   * Transition to DRIVING from any state except INITIALIZING.
   */
  btConnected(source: DetectionSource = 'bt_acl', metadata?: Record<string, any>): void {
    const prev = this._state;

    if (prev === 'INITIALIZING') {
      // During initialization, BT_INIT_CONNECTED is the right event
      this.btInitConnected(source, metadata);
      return;
    }

    // Cancel any active debounce — the car reconnected
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      this.logEvent('DEBOUNCE_CANCELLED', source, metadata);
    }

    if (prev === 'DRIVING') {
      // Already driving, no transition needed
      return;
    }

    this.transition('DRIVING', 'BT_CONNECTED', source, metadata);
  }

  /**
   * Bluetooth disconnected event — car BT ACL disconnected.
   * Starts the debounce timer. If BT doesn't reconnect within 10s,
   * transitions to PARKING_PENDING → triggers parking check.
   */
  btDisconnected(source: DetectionSource = 'bt_acl', metadata?: Record<string, any>): void {
    const prev = this._state;

    if (prev === 'INITIALIZING') {
      this.btInitDisconnected(source, metadata);
      return;
    }

    if (prev !== 'DRIVING') {
      log.debug(`btDisconnected ignored: current state is ${prev}, not DRIVING`);
      return;
    }

    // Start debounce — transition to PARKING_PENDING
    this.transition('PARKING_PENDING', 'BT_DISCONNECTED', source, metadata);
    this.startDebounce(source);
  }

  /**
   * Initial BT check result: car IS connected.
   * Called after profile proxy check completes on startup.
   */
  btInitConnected(source: DetectionSource = 'bt_profile_proxy', metadata?: Record<string, any>): void {
    this.transition('DRIVING', 'BT_INIT_CONNECTED', source, metadata);
  }

  /**
   * Initial BT check result: car is NOT connected.
   * Called after profile proxy check completes on startup.
   */
  btInitDisconnected(source: DetectionSource = 'bt_profile_proxy', metadata?: Record<string, any>): void {
    // If we restored to DRIVING from persistence but BT says not connected,
    // that's the stale SharedPrefs bug. Correct it.
    if (this._state === 'DRIVING') {
      log.info('BT init says disconnected but state was DRIVING (stale) — correcting to PARKED');
      this.transition('PARKED', 'BT_INIT_DISCONNECTED', source, {
        ...metadata,
        reason: 'stale_state_correction',
      });
      return;
    }

    if (this._state === 'INITIALIZING') {
      // No car connected at startup — go to IDLE (will wait for BT connect)
      this.transition('IDLE', 'BT_INIT_DISCONNECTED', source, metadata);
      return;
    }

    // Already in a non-DRIVING state, no action
    log.debug(`btInitDisconnected: already in ${this._state}, no transition`);
  }

  /**
   * Parking confirmed — parking rules have been checked.
   * Only valid from PARKING_PENDING state.
   */
  parkingConfirmed(metadata?: Record<string, any>): void {
    if (this._state !== 'PARKING_PENDING') {
      log.warn(`parkingConfirmed ignored: current state is ${this._state}, not PARKING_PENDING`);
      return;
    }
    this.transition('PARKED', 'PARKING_CONFIRMED', 'system', metadata);
  }

  /**
   * Departure detected — user started driving again.
   * Triggered by BT reconnect (Android) or CoreMotion (iOS).
   */
  departureDetected(source: DetectionSource = 'bt_acl', metadata?: Record<string, any>): void {
    // Cancel any debounce
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    if (this._state !== 'PARKED' && this._state !== 'PARKING_PENDING') {
      log.debug(`departureDetected ignored: current state is ${this._state}`);
      return;
    }

    this.transition('DRIVING', 'DEPARTURE_DETECTED', source, metadata);
  }

  /**
   * Monitoring started — user paired a car and started detection.
   */
  monitoringStarted(carName: string, carAddress?: string): void {
    this._carName = carName;
    this._carAddress = carAddress ?? null;

    // Go to INITIALIZING — BT check will determine actual state
    if (this._state === 'IDLE') {
      this.transition('INITIALIZING', 'MONITORING_STARTED', 'system', { carName });
    }
    this.logEvent('MONITORING_STARTED', 'system', { carName, carAddress });
  }

  /**
   * Monitoring stopped — user removed car or disabled detection.
   */
  monitoringStopped(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._carName = null;
    this._carAddress = null;
    this.transition('IDLE', 'MONITORING_STOPPED', 'system');
  }

  /**
   * Activity Recognition: driving detected (IN_VEHICLE ENTER).
   *
   * Two roles:
   * 1. For BT users: secondary confirmation signal (logged for diagnostics).
   *    BT is the primary trigger — AR just adds confidence.
   * 2. For non-BT users: primary driving signal. Transitions IDLE/PARKED → DRIVING.
   */
  activityDriving(metadata?: Record<string, any>): void {
    if (this._state === 'PARKED' || this._state === 'IDLE' || this._state === 'INITIALIZING') {
      this.transition('DRIVING', 'ACTIVITY_DRIVING', 'activity_recognition', metadata);
    } else if (this._state === 'PARKING_PENDING') {
      // AR says driving while we're in debounce — cancel the parking, go back to DRIVING
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
        this.logEvent('DEBOUNCE_CANCELLED', 'activity_recognition', metadata);
      }
      this.transition('DRIVING', 'ACTIVITY_DRIVING', 'activity_recognition', metadata);
    } else {
      // Already DRIVING — just log for diagnostics
      this.logEvent('ACTIVITY_DRIVING', 'activity_recognition', metadata);
    }
  }

  /**
   * Activity Recognition: still/walking detected (IN_VEHICLE EXIT or STILL/WALKING ENTER).
   *
   * Two roles:
   * 1. For BT users: logged for diagnostics only. BT disconnect is the parking trigger.
   * 2. For non-BT users (drivingSource === 'activity_recognition'): triggers parking
   *    with a longer debounce (30s instead of 10s, since AR is less precise than BT).
   */
  activityStill(metadata?: Record<string, any>): void {
    if (this._state === 'DRIVING' && this._drivingSource === 'activity_recognition') {
      // AR was the primary signal that detected driving, so AR STILL should
      // trigger parking. Use longer debounce since AR has ~1 min latency and
      // can produce brief false transitions at intersections.
      log.info('Activity Recognition STILL while AR-driven DRIVING → starting AR parking debounce (30s)');
      this.transition('PARKING_PENDING', 'ACTIVITY_STILL', 'activity_recognition', metadata);
      this.startDebounce('activity_recognition', ParkingDetectionStateMachineClass.AR_DEBOUNCE_DURATION_MS);
    } else {
      // BT-driven DRIVING or non-DRIVING state: just log for diagnostics
      this.logEvent('ACTIVITY_STILL', 'activity_recognition', {
        ...metadata,
        note: this._state === 'DRIVING' ? 'BT-driven, AR STILL logged only' : 'not driving',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — Listeners
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to state changes. Returns unsubscribe function.
   * Listener fires immediately with current snapshot, then on every transition.
   */
  addStateListener(listener: StateListener): () => void {
    this._stateListeners.push(listener);
    // Fire immediately with current state
    listener(this.snapshot);
    return () => {
      this._stateListeners = this._stateListeners.filter(l => l !== listener);
    };
  }

  /**
   * Register a callback for a specific state transition.
   * Key format: "FROM->TO" e.g. "PARKING_PENDING->PARKED"
   *
   * This is how BackgroundTaskService hooks in:
   *   onTransition('PARKING_PENDING->PARKED', () => triggerParkingCheck())
   *   onTransition('PARKED->DRIVING', () => handleDeparture())
   */
  onTransition(key: string, callback: TransitionCallback): () => void {
    const existing = this._transitionCallbacks.get(key) ?? [];
    existing.push(callback);
    this._transitionCallbacks.set(key, existing);
    return () => {
      const cbs = this._transitionCallbacks.get(key) ?? [];
      this._transitionCallbacks.set(key, cbs.filter(c => c !== callback));
    };
  }

  // ---------------------------------------------------------------------------
  // Event Log
  // ---------------------------------------------------------------------------

  /**
   * Get the event log as a human-readable array for the debug screen.
   */
  getEventLog(): DetectionEvent[] {
    return [...this._eventLog];
  }

  /**
   * Clear the event log.
   */
  async clearEventLog(): Promise<void> {
    this._eventLog = [];
    await AsyncStorage.removeItem(EVENT_LOG_STORAGE_KEY);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private transition(
    newState: ParkingState,
    eventType: DetectionEventType,
    source: DetectionSource,
    metadata?: Record<string, any>
  ): void {
    const prev = this._state;

    // Validate transition
    if (!VALID_TRANSITIONS[prev]?.includes(newState)) {
      log.warn(`Invalid transition: ${prev} -> ${newState} (event: ${eventType}). Allowed: ${VALID_TRANSITIONS[prev]?.join(', ')}`);
      // Log the invalid attempt for debugging
      this.logEvent(eventType, source, { ...metadata, rejected: true, reason: 'invalid_transition' });
      return;
    }

    // Skip no-op transitions
    if (prev === newState) return;

    this._state = newState;
    this._lastEventType = eventType;
    this._lastEventTime = Date.now();

    // Track what put us into DRIVING (BT vs Activity Recognition)
    if (newState === 'DRIVING') {
      this._drivingSource = source;
    } else if (newState === 'IDLE' || newState === 'INITIALIZING') {
      this._drivingSource = null;
    }

    const event = this.logEvent(eventType, source, metadata);

    log.info(`STATE: ${prev} -> ${newState} [${eventType}] (source: ${source})`);

    // Persist stable states
    if (newState === 'DRIVING' || newState === 'PARKED' || newState === 'IDLE') {
      this.persistState();
    }

    // Notify state listeners
    const snap = this.snapshot;
    for (const listener of this._stateListeners) {
      try {
        listener(snap);
      } catch (e) {
        log.error('State listener error:', e);
      }
    }

    // Fire transition callbacks
    const transitionKey = `${prev}->${newState}`;
    const callbacks = this._transitionCallbacks.get(transitionKey) ?? [];
    for (const cb of callbacks) {
      try {
        const result = cb(event);
        if (result instanceof Promise) {
          result.catch(e => log.error(`Transition callback error (${transitionKey}):`, e));
        }
      } catch (e) {
        log.error(`Transition callback error (${transitionKey}):`, e);
      }
    }

    // Also fire wildcard callbacks for the event type
    const wildcardKey = `*->${newState}`;
    const wildcardCbs = this._transitionCallbacks.get(wildcardKey) ?? [];
    for (const cb of wildcardCbs) {
      try {
        const result = cb(event);
        if (result instanceof Promise) {
          result.catch(e => log.error(`Wildcard callback error (${wildcardKey}):`, e));
        }
      } catch (e) {
        log.error(`Wildcard callback error (${wildcardKey}):`, e);
      }
    }
  }

  private logEvent(
    type: DetectionEventType,
    source: DetectionSource,
    metadata?: Record<string, any>
  ): DetectionEvent {
    const event: DetectionEvent = {
      type,
      source,
      timestamp: Date.now(),
      prevState: this._state,
      newState: this._state,
      metadata,
    };

    // Ring buffer
    this._eventLog.push(event);
    if (this._eventLog.length > MAX_EVENT_LOG_SIZE) {
      this._eventLog = this._eventLog.slice(-MAX_EVENT_LOG_SIZE);
    }

    // Persist event log (fire and forget)
    this.persistEventLog();

    return event;
  }

  private startDebounce(source: DetectionSource, durationMs: number = DEBOUNCE_DURATION_MS): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;

      if (this._state !== 'PARKING_PENDING') {
        log.debug('Debounce expired but state is no longer PARKING_PENDING');
        return;
      }

      log.info(`Debounce expired (${durationMs}ms, source: ${source}) — confirming parking`);
      this.logEvent('DEBOUNCE_EXPIRED', source, { durationMs });

      // Transition to PARKED. The transition callback registered by
      // BackgroundTaskService will handle the actual parking check.
      this.transition('PARKED', 'PARKING_CONFIRMED', 'system', {
        debounceMs: durationMs,
        triggerSource: source,
      });
    }, durationMs);
  }

  private async persistState(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
        state: this._state,
        lastEventType: this._lastEventType,
        lastEventTime: this._lastEventTime,
        carName: this._carName,
        carAddress: this._carAddress,
      }));
    } catch (e) {
      log.warn('Failed to persist state:', e);
    }
  }

  private async persistEventLog(): Promise<void> {
    try {
      await AsyncStorage.setItem(EVENT_LOG_STORAGE_KEY, JSON.stringify(this._eventLog));
    } catch {
      // Non-critical, ignore
    }
  }
}

// Singleton
const ParkingDetectionStateMachine = new ParkingDetectionStateMachineClass();
export default ParkingDetectionStateMachine;
