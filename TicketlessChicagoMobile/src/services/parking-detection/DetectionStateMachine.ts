/**
 * Detection State Machine
 *
 * Implements the smart parking detection logic using a state machine.
 * Transitions through states based on motion and Bluetooth signals.
 *
 * States:
 * - driving: Connected to car BT, moving
 * - slowing: Connected, speed decreasing
 * - stopped: Connected, no motion for X seconds
 * - parked: Confirmed parked (or BT disconnected)
 * - walking-away: BT disconnected, motion detected (walking)
 */

import {
  BluetoothDevice,
  ParkingDetectionConfig,
  ParkingEvent,
  MotionData,
  DEFAULT_DETECTION_CONFIG,
} from './ParkingDetectionService';

// =============================================================================
// Types
// =============================================================================

export type DetectionState =
  | 'idle' // Not connected to car BT
  | 'driving' // Connected to car BT, moving
  | 'slowing' // Connected, speed decreasing
  | 'stopped' // Connected, no motion for X seconds
  | 'parked' // Confirmed parked (or BT disconnected)
  | 'walking-away'; // BT disconnected, motion detected (walking)

export interface StateTransition {
  from: DetectionState;
  to: DetectionState;
  trigger: string;
  timestamp: Date;
}

export interface Location {
  latitude: number;
  longitude: number;
  accuracy: number;
}

// =============================================================================
// Detection State Machine
// =============================================================================

class DetectionStateMachine {
  private state: DetectionState = 'idle';
  private config: ParkingDetectionConfig = DEFAULT_DETECTION_CONFIG;
  private stoppedAt: Date | null = null;
  private lastLocation: Location | null = null;
  private stateHistory: StateTransition[] = [];

  // Callbacks
  private onParkingDetectedCallback?: (
    event: ParkingEvent,
    confidence: 'high' | 'medium' | 'low'
  ) => Promise<void>;
  private onParkingConfirmedCallback?: (
    confidence: 'high' | 'medium' | 'low'
  ) => Promise<void>;

  /**
   * Initialize the state machine
   */
  initialize(config: ParkingDetectionConfig): void {
    this.config = config;
    this.reset();
  }

  /**
   * Reset state machine to initial state
   */
  reset(): void {
    this.transitionTo('idle', 'reset');
    this.stoppedAt = null;
    this.lastLocation = null;
  }

  /**
   * Get current state
   */
  getState(): DetectionState {
    return this.state;
  }

  /**
   * Get state history
   */
  getStateHistory(): StateTransition[] {
    return [...this.stateHistory];
  }

  /**
   * Set parking detected callback
   */
  onParkingDetected(
    callback: (
      event: ParkingEvent,
      confidence: 'high' | 'medium' | 'low'
    ) => Promise<void>
  ): void {
    this.onParkingDetectedCallback = callback;
  }

  /**
   * Set parking confirmed callback
   */
  onParkingConfirmed(
    callback: (confidence: 'high' | 'medium' | 'low') => Promise<void>
  ): void {
    this.onParkingConfirmedCallback = callback;
  }

  /**
   * Handle Bluetooth connection to car
   */
  async onBluetoothConnect(device: BluetoothDevice): Promise<void> {
    if (!this.isCarDevice(device)) return;

    console.log('[StateMachine] Connected to car:', device.name);
    this.transitionTo('driving', `bluetooth-connect:${device.name}`);
  }

  /**
   * Handle Bluetooth disconnection from car
   */
  async onBluetoothDisconnect(device: BluetoothDevice): Promise<void> {
    if (!this.isCarDevice(device)) return;

    console.log('[StateMachine] Disconnected from car:', device.name);

    switch (this.state) {
      case 'parked':
        // Already detected via motion - high confidence
        await this.confirmParking('high');
        break;

      case 'stopped':
        // Stopped but not long enough - medium confidence
        this.transitionTo('parked', 'bluetooth-disconnect-while-stopped');
        await this.triggerParkingDetected('bluetooth-disconnect', 'medium');
        await this.confirmParking('medium');
        break;

      case 'driving':
      case 'slowing':
        // Was moving when BT disconnected? Low confidence
        this.transitionTo('parked', 'bluetooth-disconnect-while-driving');
        this.lastLocation = await this.getCurrentLocation();
        await this.triggerParkingDetected('bluetooth-disconnect', 'low');
        await this.confirmParking('low');
        break;

      default:
        // Not connected, ignore
        break;
    }

    this.transitionTo('walking-away', 'bluetooth-disconnected');
  }

  /**
   * Called continuously while connected to car Bluetooth
   */
  async onMotionUpdate(motion: MotionData): Promise<void> {
    if (this.state === 'idle' || this.state === 'walking-away') {
      return; // Not connected to car
    }

    const isStationary = motion.isStationary;

    switch (this.state) {
      case 'driving':
        if (isStationary) {
          this.transitionTo('stopped', 'motion-stopped');
          this.stoppedAt = new Date();
          this.lastLocation = await this.getCurrentLocation();
        }
        break;

      case 'slowing':
        if (isStationary) {
          this.transitionTo('stopped', 'fully-stopped');
          this.stoppedAt = new Date();
          this.lastLocation = await this.getCurrentLocation();
        } else {
          // Back to driving
          this.transitionTo('driving', 'accelerating');
        }
        break;

      case 'stopped':
        if (!isStationary) {
          // Started moving again - was just a red light
          this.transitionTo('driving', 'started-moving');
          this.stoppedAt = null;
        } else {
          // Still stopped - check duration
          const stoppedDuration = this.getStoppedDuration();
          if (
            stoppedDuration !== null &&
            stoppedDuration >= this.config.stationaryDurationSeconds * 1000
          ) {
            // Been stopped long enough - likely parked!
            this.transitionTo('parked', 'stopped-long-enough');
            await this.triggerParkingDetected('motion-stopped', 'high');
          }
        }
        break;

      case 'parked':
        // Already detected parking, waiting for BT disconnect
        break;
    }
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Check if device is a paired car device
   */
  private isCarDevice(device: BluetoothDevice): boolean {
    return this.config.pairedCarDevices.some((d) => d.id === device.id);
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: DetectionState, trigger: string): void {
    if (this.state === newState) return;

    const transition: StateTransition = {
      from: this.state,
      to: newState,
      trigger,
      timestamp: new Date(),
    };

    console.log(
      `[StateMachine] ${this.state} -> ${newState} (${trigger})`
    );

    this.stateHistory.push(transition);

    // Keep only last 20 transitions
    if (this.stateHistory.length > 20) {
      this.stateHistory.shift();
    }

    this.state = newState;
  }

  /**
   * Get duration stopped in milliseconds
   */
  private getStoppedDuration(): number | null {
    if (!this.stoppedAt) return null;
    return Date.now() - this.stoppedAt.getTime();
  }

  /**
   * Get current GPS location
   */
  private async getCurrentLocation(): Promise<Location> {
    // In production, use react-native-geolocation-service or expo-location
    // For now, return a stub
    return {
      latitude: 41.8781, // Chicago
      longitude: -87.6298,
      accuracy: 10,
    };
  }

  /**
   * Trigger parking detected event
   */
  private async triggerParkingDetected(
    trigger: 'motion-stopped' | 'bluetooth-disconnect',
    confidence: 'high' | 'medium' | 'low'
  ): Promise<void> {
    if (!this.lastLocation) {
      this.lastLocation = await this.getCurrentLocation();
    }

    const event: ParkingEvent = {
      id: `park-${Date.now()}`,
      timestamp: new Date(),
      location: {
        ...this.lastLocation,
      },
      trigger,
      confidence,
    };

    console.log('[StateMachine] Parking detected:', {
      trigger,
      confidence,
    });

    if (this.onParkingDetectedCallback) {
      await this.onParkingDetectedCallback(event, confidence);
    }
  }

  /**
   * Confirm parking (after BT disconnect)
   */
  private async confirmParking(
    confidence: 'high' | 'medium' | 'low'
  ): Promise<void> {
    console.log('[StateMachine] Parking confirmed with confidence:', confidence);

    if (this.onParkingConfirmedCallback) {
      await this.onParkingConfirmedCallback(confidence);
    }
  }
}

// Singleton instance
export const detectionStateMachine = new DetectionStateMachine();

export default detectionStateMachine;
