/**
 * Relocation Service
 *
 * Finds safe parking nearby when you need to move your car.
 * Evaluates street parking and nearby garages.
 */

import { StreetSegment, Restriction, UserContext } from '../parking-map/types';
import { computeParkingStatus, isRestrictionActive } from '../parking-map/compute';

// =============================================================================
// Types
// =============================================================================

export interface Location {
  latitude: number;
  longitude: number;
}

export interface RelocationSuggestion {
  id: string;
  location: Location;
  address: string;
  distance: number; // meters from current location
  walkingTime: number; // minutes

  parkingType: 'street' | 'garage' | 'lot';

  // For street parking
  restrictions?: Restriction[];
  safeUntil?: Date; // When is next restriction?
  safeForHours?: number;

  // For garage/lot
  garageInfo?: {
    name: string;
    hourlyRate?: number;
    dailyMax?: number;
    availability?: 'available' | 'limited' | 'full';
    amenities?: string[];
  };

  score: number; // 0-100, higher is better
}

export interface RelocationOptions {
  maxDistance: number; // meters
  minSafeHours: number; // minimum time until next restriction
  includeGarages: boolean;
  maxHourlyRate?: number; // for garages
}

export interface GarageInfo {
  id: string;
  name: string;
  address: string;
  location: Location;
  distance: number;
  hourlyRate?: number;
  dailyMax?: number;
  availability?: 'available' | 'limited' | 'full';
  amenities?: string[];
}

// =============================================================================
// Default Options
// =============================================================================

export const DEFAULT_RELOCATION_OPTIONS: RelocationOptions = {
  maxDistance: 800, // ~0.5 miles
  minSafeHours: 2,
  includeGarages: true,
};

// =============================================================================
// Relocation Service
// =============================================================================

class RelocationService {
  /**
   * Find safe parking nearby
   */
  async findSafeParking(
    currentLocation: Location,
    userContext: UserContext,
    options: Partial<RelocationOptions> = {}
  ): Promise<RelocationSuggestion[]> {
    const opts = { ...DEFAULT_RELOCATION_OPTIONS, ...options };
    const suggestions: RelocationSuggestion[] = [];
    const now = new Date();

    // Search nearby street segments
    const nearbySegments = await this.findSegmentsWithinRadius(
      currentLocation,
      opts.maxDistance
    );

    for (const segment of nearbySegments) {
      const status = await this.evaluateSegment(segment, now, userContext);

      if (status.canParkNow && status.safeForHours >= opts.minSafeHours) {
        const midpoint = this.getSegmentMidpoint(segment);
        const distance = this.calculateDistance(currentLocation, midpoint);

        suggestions.push({
          id: segment.properties.segmentId,
          location: midpoint,
          address: this.formatAddress(segment),
          distance,
          walkingTime: this.estimateWalkingTime(distance),
          parkingType: 'street',
          restrictions: segment.properties.restrictions,
          safeUntil: status.nextRestriction?.startTime,
          safeForHours: status.safeForHours,
          score: this.calculateStreetScore(segment, status, distance, userContext),
        });
      }
    }

    // Optionally include garages
    if (opts.includeGarages) {
      const garages = await this.findNearbyGarages(currentLocation, opts.maxDistance);

      for (const garage of garages) {
        if (!opts.maxHourlyRate || (garage.hourlyRate && garage.hourlyRate <= opts.maxHourlyRate)) {
          suggestions.push({
            id: garage.id,
            location: garage.location,
            address: garage.address,
            distance: garage.distance,
            walkingTime: this.estimateWalkingTime(garage.distance),
            parkingType: 'garage',
            garageInfo: {
              name: garage.name,
              hourlyRate: garage.hourlyRate,
              dailyMax: garage.dailyMax,
              availability: garage.availability,
              amenities: garage.amenities,
            },
            score: this.calculateGarageScore(garage, opts),
          });
        }
      }
    }

    // Sort by score (highest first)
    return suggestions.sort((a, b) => b.score - a.score);
  }

  /**
   * Evaluate a segment for parking suitability
   */
  private async evaluateSegment(
    segment: StreetSegment,
    now: Date,
    userContext: UserContext
  ): Promise<{
    canParkNow: boolean;
    safeForHours: number;
    nextRestriction?: { startTime: Date; restriction: Restriction };
  }> {
    // Check current status
    const status = computeParkingStatus(
      segment,
      now,
      userContext.permits || []
    );

    if (status.status === 'restricted') {
      return { canParkNow: false, safeForHours: 0 };
    }

    // Find next restriction
    let earliestRestriction: { startTime: Date; restriction: Restriction } | undefined;

    for (const restriction of segment.properties.restrictions) {
      const nextStart = this.getNextRestrictionStart(restriction, now);

      if (nextStart) {
        if (!earliestRestriction || nextStart < earliestRestriction.startTime) {
          earliestRestriction = {
            startTime: nextStart,
            restriction,
          };
        }
      }
    }

    // Calculate safe duration
    let safeForHours = 24; // Default to 24 hours if no upcoming restrictions
    if (earliestRestriction) {
      const hoursUntil =
        (earliestRestriction.startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      safeForHours = Math.max(0, hoursUntil);
    }

    return {
      canParkNow: true,
      safeForHours,
      nextRestriction: earliestRestriction,
    };
  }

  /**
   * Get next time a restriction becomes active
   */
  private getNextRestrictionStart(restriction: Restriction, from: Date): Date | null {
    const schedule = restriction.schedule;
    if (!schedule.daysOfWeek || !schedule.startTime) {
      return null;
    }

    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);

    // Check next 7 days
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(from);
      checkDate.setDate(checkDate.getDate() + i);
      const day = checkDate.getDay();

      if (schedule.daysOfWeek.includes(day)) {
        const candidate = new Date(checkDate);
        candidate.setHours(startHour, startMinute, 0, 0);

        // Check if restriction is already active
        if (candidate > from && !isRestrictionActive(restriction, from)) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Calculate score for street parking
   */
  private calculateStreetScore(
    segment: StreetSegment,
    status: { safeForHours: number },
    distance: number,
    userContext: UserContext
  ): number {
    let score = 50; // Base score

    // Closer is better (up to +30 points)
    // 0m = +30, 400m = +15, 800m = 0
    const distanceScore = Math.max(0, 30 - (distance / 800) * 30);
    score += distanceScore;

    // Longer safe time is better (up to +20 points)
    // 2 hours = +4, 5 hours = +10, 10+ hours = +20
    const timeScore = Math.min(20, status.safeForHours * 2);
    score += timeScore;

    // No restrictions at all is best (+10 points)
    if (segment.properties.restrictions.length === 0) {
      score += 10;
    }

    // User has permit for this zone (+15 points)
    const hasPermit = segment.properties.restrictions.some(
      (r) =>
        r.type === 'permit-zone' &&
        r.schedule.permitZone &&
        userContext.permits?.includes(r.schedule.permitZone)
    );
    if (hasPermit) {
      score += 15;
    }

    return Math.min(100, Math.round(score));
  }

  /**
   * Calculate score for garage parking
   */
  private calculateGarageScore(garage: GarageInfo, options: RelocationOptions): number {
    let score = 40; // Base score (lower than street because it costs money)

    // Closer is better (up to +25 points)
    const distanceScore = Math.max(0, 25 - (garage.distance / 800) * 25);
    score += distanceScore;

    // Cheaper is better (up to +15 points)
    if (garage.hourlyRate) {
      // Assume max reasonable rate is $20/hr
      const priceScore = Math.max(0, 15 - (garage.hourlyRate / 20) * 15);
      score += priceScore;
    } else {
      score += 7; // Unknown price - middle ground
    }

    // Availability bonus (+10 for available)
    if (garage.availability === 'available') {
      score += 10;
    } else if (garage.availability === 'limited') {
      score += 5;
    }

    // Amenities bonus (up to +10)
    if (garage.amenities) {
      if (garage.amenities.includes('covered')) score += 3;
      if (garage.amenities.includes('ev-charging')) score += 2;
      if (garage.amenities.includes('24-hour')) score += 3;
      if (garage.amenities.includes('security')) score += 2;
    }

    return Math.min(100, Math.round(score));
  }

  // =============================================================================
  // Geo Helpers
  // =============================================================================

  /**
   * Find segments within a radius of a location
   */
  private async findSegmentsWithinRadius(
    location: Location,
    radiusMeters: number
  ): Promise<StreetSegment[]> {
    // In production, query local segment database
    // For now, return empty array
    console.log(
      `[RelocationService] Finding segments within ${radiusMeters}m of`,
      location
    );
    return [];
  }

  /**
   * Find nearby garages
   */
  private async findNearbyGarages(
    location: Location,
    radiusMeters: number
  ): Promise<GarageInfo[]> {
    // In production, query SpotHero, ParkWhiz, etc.
    console.log(
      `[RelocationService] Finding garages within ${radiusMeters}m of`,
      location
    );
    return [];
  }

  /**
   * Get midpoint of a segment
   */
  private getSegmentMidpoint(segment: StreetSegment): Location {
    const coords = segment.geometry.coordinates;
    const midIndex = Math.floor(coords.length / 2);
    return {
      longitude: coords[midIndex][0],
      latitude: coords[midIndex][1],
    };
  }

  /**
   * Format address from segment
   */
  private formatAddress(segment: StreetSegment): string {
    const { streetName, blockStart, blockEnd } = segment.properties;
    return `${blockStart}-${blockEnd} ${streetName}`;
  }

  /**
   * Calculate distance between two locations in meters
   */
  private calculateDistance(from: Location, to: Location): number {
    const R = 6371e3; // Earth's radius in meters
    const lat1 = (from.latitude * Math.PI) / 180;
    const lat2 = (to.latitude * Math.PI) / 180;
    const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
    const deltaLon = ((to.longitude - from.longitude) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Estimate walking time in minutes
   */
  private estimateWalkingTime(distanceMeters: number): number {
    // Average walking speed: ~1.4 m/s = ~5 km/h
    const walkingSpeedMPS = 1.4;
    return Math.round(distanceMeters / walkingSpeedMPS / 60);
  }
}

// Singleton instance
export const relocationService = new RelocationService();

export default relocationService;
