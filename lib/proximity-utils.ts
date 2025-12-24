/**
 * Proximity Utilities for Neighborhood Reality Report
 *
 * Calculates exposure metrics within defined radii (250ft, 500ft, 0.25mi, 0.5mi)
 * using the Haversine formula for accurate distance calculations.
 */

// Distance constants in meters
export const RADII = {
  FEET_250: 76.2,    // 250 feet in meters
  FEET_500: 152.4,   // 500 feet in meters
  QUARTER_MILE: 402.336, // 0.25 miles in meters
  HALF_MILE: 804.672,    // 0.5 miles in meters
} as const;

export type RadiusKey = keyof typeof RADII;

export const RADIUS_LABELS: Record<RadiusKey, string> = {
  FEET_250: '250 feet',
  FEET_500: '500 feet',
  QUARTER_MILE: '¼ mile',
  HALF_MILE: '½ mile',
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Filter items by distance from a central point
 */
export function filterByDistance<T extends { latitude: number; longitude: number }>(
  items: T[],
  centerLat: number,
  centerLon: number,
  radiusMeters: number
): T[] {
  return items.filter(item =>
    haversineDistance(centerLat, centerLon, item.latitude, item.longitude) <= radiusMeters
  );
}

/**
 * Count items within each radius band
 */
export function countByRadius<T extends { latitude: number; longitude: number }>(
  items: T[],
  centerLat: number,
  centerLon: number
): Record<RadiusKey, number> {
  return {
    FEET_250: filterByDistance(items, centerLat, centerLon, RADII.FEET_250).length,
    FEET_500: filterByDistance(items, centerLat, centerLon, RADII.FEET_500).length,
    QUARTER_MILE: filterByDistance(items, centerLat, centerLon, RADII.QUARTER_MILE).length,
    HALF_MILE: filterByDistance(items, centerLat, centerLon, RADII.HALF_MILE).length,
  };
}

/**
 * Find the closest item and its distance
 */
export function findClosest<T extends { latitude: number; longitude: number }>(
  items: T[],
  centerLat: number,
  centerLon: number
): { item: T; distance: number } | null {
  if (items.length === 0) return null;

  let closest: T = items[0];
  let minDistance = haversineDistance(centerLat, centerLon, items[0].latitude, items[0].longitude);

  for (let i = 1; i < items.length; i++) {
    const dist = haversineDistance(centerLat, centerLon, items[i].latitude, items[i].longitude);
    if (dist < minDistance) {
      minDistance = dist;
      closest = items[i];
    }
  }

  return { item: closest, distance: minDistance };
}

/**
 * Get items sorted by distance from center
 */
export function sortByDistance<T extends { latitude: number; longitude: number }>(
  items: T[],
  centerLat: number,
  centerLon: number
): Array<T & { distance: number }> {
  return items
    .map(item => ({
      ...item,
      distance: haversineDistance(centerLat, centerLon, item.latitude, item.longitude),
    }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 152.4) { // Less than 500 feet
    const feet = Math.round(meters * 3.28084);
    return `${feet} ft`;
  } else if (meters < 1609.34) { // Less than 1 mile
    const miles = meters / 1609.34;
    if (miles < 0.3) {
      return `${Math.round(meters * 3.28084)} ft`;
    }
    return `${miles.toFixed(2)} mi`;
  } else {
    return `${(meters / 1609.34).toFixed(1)} mi`;
  }
}

/**
 * Calculate density (items per square mile) for a given count and radius
 */
export function calculateDensity(count: number, radiusMeters: number): number {
  // Area in square meters
  const areaSqMeters = Math.PI * radiusMeters * radiusMeters;
  // Convert to square miles (1 sq mile = 2,589,988 sq meters)
  const areaSqMiles = areaSqMeters / 2589988;
  // Return density (items per square mile)
  return count / areaSqMiles;
}

/**
 * Get exposure level based on density percentile
 */
export function getExposureLevel(
  density: number,
  citywideDensity: number
): 'very_high' | 'high' | 'moderate' | 'low' | 'very_low' {
  const ratio = density / citywideDensity;

  if (ratio >= 3) return 'very_high';
  if (ratio >= 2) return 'high';
  if (ratio >= 1) return 'moderate';
  if (ratio >= 0.5) return 'low';
  return 'very_low';
}

export const EXPOSURE_LABELS = {
  very_high: 'Very High',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
  very_low: 'Very Low',
};

export const EXPOSURE_COLORS = {
  very_high: '#dc2626',  // red-600
  high: '#ea580c',       // orange-600
  moderate: '#ca8a04',   // yellow-600
  low: '#16a34a',        // green-600
  very_low: '#2563eb',   // blue-600
};
