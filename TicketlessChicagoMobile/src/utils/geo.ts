/**
 * Shared geographic utility functions.
 *
 * Consolidates the haversine distance calculation that was previously
 * duplicated across 6 files (BackgroundTaskService, LocationService,
 * CameraAlertService, FindMyCarService, CityDetectionService,
 * RelocationService).
 */

const EARTH_RADIUS_METERS = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the great-circle distance between two points in meters
 * using the Haversine formula.
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate distance in kilometers (convenience wrapper).
 */
export function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  return distanceMeters(lat1, lng1, lat2, lng2) / 1000;
}

/**
 * Check whether two coordinates are within a given radius (in meters).
 */
export function isWithinRadius(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radiusMeters: number
): boolean {
  return distanceMeters(lat1, lng1, lat2, lng2) <= radiusMeters;
}
