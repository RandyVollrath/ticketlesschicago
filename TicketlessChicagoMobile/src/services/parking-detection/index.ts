/**
 * Parking Detection Services
 *
 * Multi-signal parking detection using Bluetooth + Motion.
 * All features behind feature flags.
 */

// Main Service
export {
  parkingDetectionService,
  DEFAULT_DETECTION_CONFIG,
} from './ParkingDetectionService';
export type {
  BluetoothDevice,
  ParkingDetectionConfig,
  ParkingEvent,
  MotionData,
} from './ParkingDetectionService';

// State Machine
export { detectionStateMachine } from './DetectionStateMachine';
export type { DetectionState, StateTransition } from './DetectionStateMachine';

// Motion Service
export { motionService, DEFAULT_MOTION_CONFIG } from './MotionService';
export type {
  MotionServiceConfig,
  AccelerometerReading,
  GPSReading,
} from './MotionService';

// Bluetooth Service
export { bluetoothService, DEFAULT_BLUETOOTH_CONFIG } from './BluetoothService';
export type { BluetoothState, BluetoothServiceConfig } from './BluetoothService';
