/**
 * Motion Service
 *
 * Detects motion using GPS speed and accelerometer data.
 * Used to determine if the user's car is moving, stopped, or parked.
 *
 * Uses:
 * - GPS for vehicle-level motion detection (most reliable)
 * - Accelerometer for fine-grained stationary detection
 */

import { MotionData } from './ParkingDetectionService';

// =============================================================================
// Types
// =============================================================================

export interface MotionServiceConfig {
  // GPS settings
  gpsUpdateIntervalMs: number; // How often to get GPS updates
  gpsDistanceFilter: number; // Minimum distance change (meters) to trigger update

  // Accelerometer settings
  accelerometerUpdateIntervalMs: number;
  accelerometerHistorySize: number; // How many readings to keep

  // Detection thresholds
  stationarySpeedMPS: number; // Below this = stopped
  accelerometerVarianceThreshold: number; // Below this = no movement
}

export interface AccelerometerReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface GPSReading {
  latitude: number;
  longitude: number;
  speed: number | null;
  speedAccuracy: number | null;
  accuracy: number;
  timestamp: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_MOTION_CONFIG: MotionServiceConfig = {
  gpsUpdateIntervalMs: 2000, // 2 seconds
  gpsDistanceFilter: 5, // 5 meters

  accelerometerUpdateIntervalMs: 500, // 2 Hz
  accelerometerHistorySize: 10,

  stationarySpeedMPS: 0.5, // 0.5 m/s = ~1.1 mph
  accelerometerVarianceThreshold: 0.1,
};

// =============================================================================
// Motion Service
// =============================================================================

class MotionService {
  private config: MotionServiceConfig = DEFAULT_MOTION_CONFIG;
  private isMonitoring = false;
  private recentAccelerations: AccelerometerReading[] = [];
  private lastGPSReading: GPSReading | null = null;

  // Subscriptions (in production, these would be actual sensor subscriptions)
  private accelerometerSubscription: any = null;
  private locationSubscription: any = null;

  // Callback for motion updates
  private motionCallback?: (motion: MotionData) => void;

  /**
   * Initialize with configuration
   */
  initialize(config?: Partial<MotionServiceConfig>): void {
    this.config = { ...DEFAULT_MOTION_CONFIG, ...config };
    console.log('[MotionService] Initialized');
  }

  /**
   * Start monitoring motion
   */
  async startMonitoring(callback: (motion: MotionData) => void): Promise<void> {
    if (this.isMonitoring) {
      console.log('[MotionService] Already monitoring');
      return;
    }

    this.motionCallback = callback;
    this.isMonitoring = true;

    // In production, these would start actual sensor monitoring:
    // - expo-sensors for Accelerometer
    // - expo-location for GPS

    console.log('[MotionService] Started monitoring');

    // Simulate motion updates for development
    this.simulateMotionUpdates();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    this.accelerometerSubscription?.remove?.();
    this.locationSubscription?.remove?.();
    this.accelerometerSubscription = null;
    this.locationSubscription = null;
    console.log('[MotionService] Stopped monitoring');
  }

  /**
   * Get current motion status
   */
  getCurrentMotion(): MotionData | null {
    if (!this.lastGPSReading) return null;
    return this.calculateMotion(this.lastGPSReading);
  }

  /**
   * Check if currently stationary
   */
  isStationary(): boolean {
    const motion = this.getCurrentMotion();
    return motion?.isStationary ?? true;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Calculate motion data from GPS and accelerometer
   */
  private calculateMotion(gps: GPSReading): MotionData {
    const gpsSpeed = gps.speed;
    const accelVariance = this.calculateAccelerometerVariance();

    // GPS speed is most reliable for vehicle detection
    // Accelerometer variance for stationary detection when GPS is unavailable
    const isStationary =
      (gpsSpeed !== null && gpsSpeed < this.config.stationarySpeedMPS) ||
      (gpsSpeed === null && accelVariance < this.config.accelerometerVarianceThreshold);

    const confidence = gpsSpeed !== null ? 0.9 : 0.6;

    const latestAccel = this.recentAccelerations[this.recentAccelerations.length - 1];

    return {
      acceleration: latestAccel
        ? { x: latestAccel.x, y: latestAccel.y, z: latestAccel.z }
        : { x: 0, y: 0, z: 0 },
      speed: gpsSpeed,
      speedAccuracy: gps.speedAccuracy,
      isStationary,
      confidence,
    };
  }

  /**
   * Calculate variance in accelerometer readings
   * Low variance = stationary, high variance = moving
   */
  private calculateAccelerometerVariance(): number {
    if (this.recentAccelerations.length < 3) return 1;

    // Calculate magnitude of each reading
    const magnitudes = this.recentAccelerations.map((a) =>
      Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
    );

    // Calculate mean
    const mean = magnitudes.reduce((sum, m) => sum + m, 0) / magnitudes.length;

    // Calculate variance
    const variance =
      magnitudes.reduce((sum, m) => sum + Math.pow(m - mean, 2), 0) /
      magnitudes.length;

    return variance;
  }

  /**
   * Handle accelerometer update
   */
  private handleAccelerometerUpdate(reading: AccelerometerReading): void {
    this.recentAccelerations.push(reading);

    // Keep only recent readings
    if (this.recentAccelerations.length > this.config.accelerometerHistorySize) {
      this.recentAccelerations.shift();
    }
  }

  /**
   * Handle GPS update
   */
  private handleGPSUpdate(reading: GPSReading): void {
    this.lastGPSReading = reading;

    if (this.motionCallback) {
      const motion = this.calculateMotion(reading);
      this.motionCallback(motion);
    }
  }

  /**
   * Simulate motion updates for development
   */
  private simulateMotionUpdates(): void {
    // In production, this would be replaced by actual sensor data
    // This is just for testing/development

    const simulateUpdate = () => {
      if (!this.isMonitoring) return;

      // Simulate GPS reading
      const gpsReading: GPSReading = {
        latitude: 41.8781,
        longitude: -87.6298,
        speed: 0, // Stationary
        speedAccuracy: 1,
        accuracy: 10,
        timestamp: Date.now(),
      };

      this.handleGPSUpdate(gpsReading);

      // Schedule next update
      setTimeout(simulateUpdate, this.config.gpsUpdateIntervalMs);
    };

    // Start simulation
    setTimeout(simulateUpdate, 1000);
  }

  /**
   * Production implementation would look like this:
   *
   * async startRealMonitoring() {
   *   // Accelerometer
   *   Accelerometer.setUpdateInterval(this.config.accelerometerUpdateIntervalMs);
   *   this.accelerometerSubscription = Accelerometer.addListener(data => {
   *     this.handleAccelerometerUpdate({
   *       ...data,
   *       timestamp: Date.now()
   *     });
   *   });
   *
   *   // GPS
   *   this.locationSubscription = await Location.watchPositionAsync(
   *     {
   *       accuracy: Location.Accuracy.High,
   *       timeInterval: this.config.gpsUpdateIntervalMs,
   *       distanceInterval: this.config.gpsDistanceFilter,
   *     },
   *     location => {
   *       this.handleGPSUpdate({
   *         latitude: location.coords.latitude,
   *         longitude: location.coords.longitude,
   *         speed: location.coords.speed,
   *         speedAccuracy: location.coords.speedAccuracy,
   *         accuracy: location.coords.accuracy,
   *         timestamp: location.timestamp,
   *       });
   *     }
   *   );
   * }
   */
}

// Singleton instance
export const motionService = new MotionService();

export default motionService;
