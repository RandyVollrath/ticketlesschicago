/**
 * Metered Parking Zone Checker
 *
 * Determines if a parked car is in a metered parking zone by finding
 * the nearest parking meter within 50m of the parking location.
 *
 * Data source: 4,638 active Chicago Parking Meters LLC payboxes.
 * Most meters have a 2-hour time limit; ~28% near entertainment venues
 * have 3-hour limits. Since we don't have per-meter time limit data,
 * we default to 2 hours (conservative — early warning for 3-hour meters
 * is still helpful, not harmful).
 *
 * Meter hours: Mon–Sat 8am–10pm (most), Sun varies.
 * Rates: $2.50/hr (neighborhoods), $4.75/hr (CBD), $7.00/hr (Loop).
 */

import { supabaseAdmin } from './supabase';

export interface MeteredParkingStatus {
  /** Whether a meter was found within proximity */
  inMeteredZone: boolean;
  /** Distance to nearest meter in meters */
  nearestMeterDistanceM: number | null;
  /** Address of nearest meter */
  nearestMeterAddress: string | null;
  /** Number of spaces at nearest meter */
  nearestMeterSpaces: number | null;
  /** Meter type (CWT, CLZ Virtual Terminal) */
  meterType: string | null;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: 'warning' | 'info' | 'none';
  /** Default time limit in minutes (120 = 2 hours) */
  timeLimitMinutes: number;
  /** Whether meters are currently enforced (Mon-Sat 8am-10pm) */
  isEnforcedNow: boolean;
  /** Estimated hourly rate based on location */
  estimatedRate: string | null;
}

/**
 * Haversine distance between two lat/lng points in meters.
 */
function haversineDistanceM(
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
 * Determine if meters are currently enforced.
 * Chicago meters: Mon–Sat 8am–10pm (most locations).
 * Some downtown meters are 24/7 but the majority follow this schedule.
 */
function areMetersEnforced(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun, 6=Sat

  // Sunday: meters are generally free (some exceptions downtown)
  if (day === 0) return false;

  // Mon-Sat: 8am to 10pm
  return hour >= 8 && hour < 22;
}

/**
 * Estimate the hourly rate based on rough location zones.
 * Loop (downtown core): $7.00/hr
 * Central Business District: $4.75/hr
 * Neighborhoods: $2.50/hr
 */
function estimateRate(lat: number, lng: number): string {
  // Rough Loop boundaries: bounded by the Chicago River and Congress Pkwy
  const isLoop = lat >= 41.875 && lat <= 41.886 && lng >= -87.639 && lng <= -87.621;
  if (isLoop) return '$7.00/hr';

  // Rough CBD: wider downtown area
  const isCBD = lat >= 41.867 && lat <= 41.895 && lng >= -87.650 && lng <= -87.615;
  if (isCBD) return '$4.75/hr';

  // Everything else is neighborhood rate
  return '$2.50/hr';
}

/**
 * Check if a location is in a metered parking zone.
 *
 * Uses a bounding box pre-filter (fast) then Haversine distance (accurate)
 * to find the nearest meter within 50m.
 */
export async function checkMeteredParking(
  latitude: number,
  longitude: number
): Promise<MeteredParkingStatus> {
  const SEARCH_RADIUS_M = 50; // meters — tight enough to avoid bleeding to adjacent parallel streets
  const DEFAULT_TIME_LIMIT_MIN = 120; // 2 hours (most common)

  if (!supabaseAdmin) {
    return {
      inMeteredZone: false,
      nearestMeterDistanceM: null,
      nearestMeterAddress: null,
      nearestMeterSpaces: null,
      meterType: null,
      message: 'Metered parking check unavailable',
      severity: 'none',
      timeLimitMinutes: DEFAULT_TIME_LIMIT_MIN,
      isEnforcedNow: false,
      estimatedRate: null,
    };
  }

  try {
    // Bounding box pre-filter: ~100m ≈ 0.001° latitude, 0.0013° longitude at Chicago's latitude
    const latDelta = SEARCH_RADIUS_M / 111000; // 1° lat ≈ 111km
    const lngDelta = SEARCH_RADIUS_M / (111000 * Math.cos(latitude * Math.PI / 180));

    const { data: meters, error } = await supabaseAdmin
      .from('metered_parking_locations')
      .select('meter_id, address, latitude, longitude, spaces, meter_type')
      .eq('status', 'Active')
      .gte('latitude', latitude - latDelta)
      .lte('latitude', latitude + latDelta)
      .gte('longitude', longitude - lngDelta)
      .lte('longitude', longitude + lngDelta)
      .limit(20); // Only need nearest, but fetch a few for accuracy

    if (error) {
      console.warn('[metered-parking] Query error:', error.message);
      return makeNoMeterResult();
    }

    if (!meters || meters.length === 0) {
      return makeNoMeterResult();
    }

    // Calculate actual distances and find the nearest
    let nearest: { meter: typeof meters[0]; distance: number } | null = null;

    for (const meter of meters) {
      if (!meter.latitude || !meter.longitude) continue;
      const dist = haversineDistanceM(latitude, longitude, meter.latitude, meter.longitude);
      if (dist <= SEARCH_RADIUS_M && (!nearest || dist < nearest.distance)) {
        nearest = { meter, distance: dist };
      }
    }

    if (!nearest) {
      return makeNoMeterResult();
    }

    const isEnforced = areMetersEnforced();
    const rate = estimateRate(latitude, longitude);
    const distStr = nearest.distance < 10
      ? 'right next to a meter'
      : `${Math.round(nearest.distance)}m from nearest meter`;

    let message: string;
    let severity: 'warning' | 'info';

    if (isEnforced) {
      message = `Metered parking zone (${distStr}). ${rate}, 2-hour max. Feed the meter or risk a $65 ticket.`;
      severity = 'warning';
    } else {
      message = `Metered parking zone (${distStr}). Meters not enforced right now. Enforcement: Mon–Sat 8am–10pm, ${rate}.`;
      severity = 'info';
    }

    return {
      inMeteredZone: true,
      nearestMeterDistanceM: Math.round(nearest.distance),
      nearestMeterAddress: nearest.meter.address,
      nearestMeterSpaces: nearest.meter.spaces,
      meterType: nearest.meter.meter_type,
      message,
      severity,
      timeLimitMinutes: DEFAULT_TIME_LIMIT_MIN,
      isEnforcedNow: isEnforced,
      estimatedRate: rate,
    };
  } catch (err) {
    console.warn('[metered-parking] Check failed:', err);
    return makeNoMeterResult();
  }
}

function makeNoMeterResult(): MeteredParkingStatus {
  return {
    inMeteredZone: false,
    nearestMeterDistanceM: null,
    nearestMeterAddress: null,
    nearestMeterSpaces: null,
    meterType: null,
    message: 'Not in a metered parking zone',
    severity: 'none',
    timeLimitMinutes: 120,
    isEnforcedNow: false,
    estimatedRate: null,
  };
}
