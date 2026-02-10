/**
 * Find My Car Service
 *
 * Helps users find their parked car with saved location,
 * photo, notes, and walking directions.
 *
 * FEATURE FLAG: smartFeatures.findMyCar
 */

import { StreetSegment } from '../parking-map/types';
import { distanceMeters } from '../../utils/geo';

// =============================================================================
// Types
// =============================================================================

export interface ParkedCarLocation {
  coordinates: [number, number]; // [longitude, latitude]
  timestamp: Date;
  address: string;
  photoUrl?: string; // User can take photo of parking spot
  notes?: string; // "Level 3, near elevator"
  segment?: StreetSegment;
  parkingMeterExpiry?: Date;
  garageInfo?: {
    name: string;
    level?: string;
    spot?: string;
  };
}

export interface DirectionsResult {
  distance: number; // meters
  duration: number; // seconds
  steps: DirectionStep[];
  polyline?: string; // Encoded polyline for map
}

export interface DirectionStep {
  instruction: string;
  distance: number; // meters
  duration: number; // seconds
  startLocation: [number, number];
  endLocation: [number, number];
}

// =============================================================================
// Storage Keys
// =============================================================================

const STORAGE_KEYS = {
  PARKED_CAR: 'parked-car',
  PARKING_HISTORY: 'parking-history',
};

// =============================================================================
// Find My Car Service
// =============================================================================

class FindMyCarService {
  private currentLocation: ParkedCarLocation | null = null;

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // Load saved location from storage
    await this.loadSavedLocation();
    console.log('[FindMyCar] Initialized');
  }

  /**
   * Save the current parking location
   */
  async saveLocation(location: ParkedCarLocation): Promise<void> {
    this.currentLocation = location;

    // In production, save to AsyncStorage
    console.log('[FindMyCar] Saved location:', {
      coordinates: location.coordinates,
      address: location.address,
      notes: location.notes,
    });

    // Also save to history
    await this.addToHistory(location);
  }

  /**
   * Get the saved parking location
   */
  async getLocation(): Promise<ParkedCarLocation | null> {
    return this.currentLocation;
  }

  /**
   * Clear the saved parking location
   */
  async clearLocation(): Promise<void> {
    this.currentLocation = null;
    console.log('[FindMyCar] Location cleared');
  }

  /**
   * Update photo for the saved location
   */
  async updatePhoto(photoUrl: string): Promise<void> {
    if (this.currentLocation) {
      this.currentLocation.photoUrl = photoUrl;
      console.log('[FindMyCar] Photo updated');
    }
  }

  /**
   * Update notes for the saved location
   */
  async updateNotes(notes: string): Promise<void> {
    if (this.currentLocation) {
      this.currentLocation.notes = notes;
      console.log('[FindMyCar] Notes updated:', notes);
    }
  }

  /**
   * Set parking meter expiry time
   */
  async setMeterExpiry(expiryTime: Date): Promise<void> {
    if (this.currentLocation) {
      this.currentLocation.parkingMeterExpiry = expiryTime;
      console.log('[FindMyCar] Meter expiry set:', expiryTime.toISOString());
    }
  }

  /**
   * Get walking directions to the parked car
   */
  async getDirections(
    fromLocation: [number, number]
  ): Promise<DirectionsResult | null> {
    const parked = this.currentLocation;

    if (!parked) {
      return null;
    }

    // In production, this would call Google Maps Directions API
    // For now, return a stub response
    // Tuples are [lng, lat] (GeoJSON order) — distanceMeters expects (lat, lng)
    const distance = distanceMeters(
      fromLocation[1], fromLocation[0],
      parked.coordinates[1], parked.coordinates[0]
    );
    const walkingSpeed = 1.4; // meters per second
    const duration = distance / walkingSpeed;

    return {
      distance,
      duration,
      steps: [
        {
          instruction: `Walk towards ${parked.address}`,
          distance,
          duration,
          startLocation: fromLocation,
          endLocation: parked.coordinates,
        },
      ],
    };
  }

  /**
   * Get time parked
   */
  getTimeParked(): number | null {
    if (!this.currentLocation) {
      return null;
    }

    return Date.now() - this.currentLocation.timestamp.getTime();
  }

  /**
   * Get formatted time parked string
   */
  getTimeParkedFormatted(): string | null {
    const milliseconds = this.getTimeParked();
    if (milliseconds === null) {
      return null;
    }

    const minutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }

    return `${minutes}m`;
  }

  /**
   * Check if meter is about to expire
   */
  getMeterStatus(): 'active' | 'expiring-soon' | 'expired' | null {
    if (!this.currentLocation?.parkingMeterExpiry) {
      return null;
    }

    const now = Date.now();
    const expiry = this.currentLocation.parkingMeterExpiry.getTime();
    const minutesUntilExpiry = (expiry - now) / 60000;

    if (minutesUntilExpiry <= 0) {
      return 'expired';
    }

    if (minutesUntilExpiry <= 15) {
      return 'expiring-soon';
    }

    return 'active';
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private async loadSavedLocation(): Promise<void> {
    // In production, load from AsyncStorage
    this.currentLocation = null;
  }

  private async addToHistory(location: ParkedCarLocation): Promise<void> {
    // In production, save to parking history in AsyncStorage
    console.log('[FindMyCar] Added to history');
  }

  // Distance calculation moved to shared geo utility (src/utils/geo.ts)
}

// Singleton instance
export const findMyCarService = new FindMyCarService();

export default findMyCarService;
