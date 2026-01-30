/**
 * City Detection Service
 *
 * HIDDEN SERVICE - No UI exposure
 *
 * Silently detects which city the user is in based on location.
 * Used for future multi-city expansion.
 *
 * Currently only Chicago is enabled - this service logs detection
 * for analytics purposes but does not affect app behavior.
 */

import { allCityConfigs, CityConfig, getEnabledCities } from '../cities';
import { getFeatureFlags } from '../config/feature-flags';

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface CityDetectionResult {
  detectedCity: CityConfig | null;
  isSupported: boolean;
  confidence: 'high' | 'medium' | 'low';
  distance?: number; // Distance to city center in km
}

/**
 * City Detection Service
 *
 * Silent service for detecting user's city based on location.
 * Does not affect UI or user experience until city is enabled.
 */
class CityDetectionService {
  private static instance: CityDetectionService;
  private lastDetectedCity: CityConfig | null = null;
  private lastDetectionTime: number = 0;
  private readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  public static getInstance(): CityDetectionService {
    if (!CityDetectionService.instance) {
      CityDetectionService.instance = new CityDetectionService();
    }
    return CityDetectionService.instance;
  }

  /**
   * Detect city from coordinates
   * Silent - does not throw errors or show UI
   */
  public detectCity(coords: Coordinate): CityDetectionResult {
    try {
      // Check cache first
      if (this.isCacheValid() && this.lastDetectedCity) {
        return {
          detectedCity: this.lastDetectedCity,
          isSupported: this.isCitySupported(this.lastDetectedCity.cityId),
          confidence: 'high',
        };
      }

      // Find closest city
      let closestCity: CityConfig | null = null;
      let minDistance = Infinity;

      for (const city of allCityConfigs) {
        if (!city.mapBounds?.center) continue;

        const distance = this.calculateDistance(
          coords,
          city.mapBounds.center
        );

        // Check if within city bounds
        if (this.isWithinBounds(coords, city.mapBounds)) {
          if (distance < minDistance) {
            minDistance = distance;
            closestCity = city;
          }
        }
      }

      // Update cache
      this.lastDetectedCity = closestCity;
      this.lastDetectionTime = Date.now();

      // Log for analytics (silent)
      this.logDetection(closestCity, coords);

      return {
        detectedCity: closestCity,
        isSupported: closestCity ? this.isCitySupported(closestCity.cityId) : false,
        confidence: closestCity ? this.getConfidence(minDistance) : 'low',
        distance: minDistance === Infinity ? undefined : minDistance,
      };
    } catch (error) {
      // Silent failure - return null result
      console.debug('[CityDetection] Detection failed silently:', error);
      return {
        detectedCity: null,
        isSupported: false,
        confidence: 'low',
      };
    }
  }

  /**
   * Check if user is in a supported city
   */
  public isInSupportedCity(coords: Coordinate): boolean {
    const result = this.detectCity(coords);
    return result.isSupported;
  }

  /**
   * Get the currently detected city (from cache)
   */
  public getCurrentCity(): CityConfig | null {
    return this.lastDetectedCity;
  }

  /**
   * Check if a specific city is supported (enabled)
   */
  private isCitySupported(cityId: string): boolean {
    const flags = getFeatureFlags();
    const cityFlags = flags.cities[cityId as keyof typeof flags.cities];
    return cityFlags?.mobileApp ?? false;
  }

  /**
   * Check if coordinates are within city bounds
   */
  private isWithinBounds(
    coords: Coordinate,
    bounds: CityConfig['mapBounds']
  ): boolean {
    if (!bounds) return false;

    return (
      coords.latitude >= bounds.south &&
      coords.latitude <= bounds.north &&
      coords.longitude >= bounds.west &&
      coords.longitude <= bounds.east
    );
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  private calculateDistance(
    point1: Coordinate,
    point2: Coordinate
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(point2.latitude - point1.latitude);
    const dLon = this.toRad(point2.longitude - point1.longitude);
    const lat1 = this.toRad(point1.latitude);
    const lat2 = this.toRad(point2.latitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Get confidence level based on distance to city center
   */
  private getConfidence(distanceKm: number): 'high' | 'medium' | 'low' {
    if (distanceKm < 10) return 'high';
    if (distanceKm < 25) return 'medium';
    return 'low';
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    return Date.now() - this.lastDetectionTime < this.CACHE_DURATION_MS;
  }

  /**
   * Log detection for analytics (silent, no errors)
   */
  private logDetection(city: CityConfig | null, coords: Coordinate): void {
    try {
      // Silent logging - for future analytics
      console.debug('[CityDetection] Detected city:', city?.cityId ?? 'unknown', {
        lat: coords.latitude.toFixed(4),
        lon: coords.longitude.toFixed(4),
        supported: city ? this.isCitySupported(city.cityId) : false,
      });
    } catch {
      // Silently ignore logging errors
    }
  }
}

export default CityDetectionService;
export const cityDetectionService = CityDetectionService.getInstance();
