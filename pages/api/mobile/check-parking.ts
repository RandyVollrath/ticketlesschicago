/**
 * Mobile Check Parking API
 *
 * Optimized endpoint for mobile app parking location checks.
 * Uses unified checker for efficiency:
 * - ONE reverse geocode call
 * - ONE batch of database queries
 * - Checks all 4 restriction types
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkAllParkingRestrictions, UnifiedParkingResult } from '../../../lib/unified-parking-checker';
import { checkMeteredParking, MeteredParkingStatus } from '../../../lib/metered-parking-checker';
import type { SnapGeometry } from '../../../lib/chicago-grid-estimator';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { getChicagoDateISO } from '../../../lib/chicago-timezone-utils';
import { supabaseAdmin } from '../../../lib/supabase';
import { parseChicagoAddress } from '../../../lib/address-parser';

/** Enforcement risk data from FOIA ticket analysis */
interface EnforcementRisk {
  /** 0-100 risk score */
  risk_score: number;
  /** 3-tier urgency: low (informational), medium (enforcement likely today), high (peak window NOW) */
  urgency: 'low' | 'medium' | 'high';
  /** Whether we have block-specific historical data */
  has_block_data: boolean;
  /** Normalized block address used for lookup */
  block_address: string;
  /** Total historical tickets on this block */
  total_block_tickets?: number;
  /** City-wide rank (1 = most ticketed block) */
  city_rank?: number;
  /** Whether current time is in the peak enforcement window */
  in_peak_window?: boolean;
  /** Peak enforcement window details */
  peak_window?: {
    start_hour: number;
    end_hour: number;
    hours_remaining: number;
  };
  /** % of this block's tickets that happen at the current hour */
  current_hour_pct?: number;
  /** Cumulative % of tickets issued by this hour */
  cumulative_pct?: number;
  /** Hourly ticket distribution {0: count, 1: count, ...} */
  hourly_histogram?: Record<string, number>;
  /** Day-of-week ticket distribution {0: count, ...} (0=Sun) */
  dow_histogram?: Record<string, number>;
  /** Most common violation type on this block */
  top_violation?: string;
  /** Human-readable risk insight */
  insight: string;
  /** Estimated total ticket revenue on this block from FOIA data */
  estimated_block_revenue?: number;
  /** Year range of the FOIA data (e.g., "2024-2025") */
  data_year_range?: string;
}

interface MobileCheckParkingResponse {
  success: boolean;
  address: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  streetCleaning: {
    hasRestriction: boolean;
    message: string;
    timing?: 'NOW' | 'TODAY' | 'UPCOMING' | 'NONE';
    nextDate?: string;
    schedule?: string;
    severity?: 'critical' | 'warning' | 'info' | 'none';
  };
  winterOvernightBan: {
    found: boolean;
    active: boolean;
    message: string;
    severity?: 'critical' | 'warning' | 'info' | 'none';
    streetName?: string;
    startTime?: string;
    endTime?: string;
  };
  twoInchSnowBan: {
    found: boolean;
    active: boolean;
    message: string;
    severity?: 'critical' | 'warning' | 'info' | 'none';
    streetName?: string;
    reason?: string;
  };
  permitZone: {
    inPermitZone: boolean;
    message: string;
    zoneName?: string;
    zoneType?: 'residential' | 'industrial';
    permitRequired?: boolean;
    severity?: 'critical' | 'warning' | 'info' | 'none';
    restrictionSchedule?: string;
    /**
     * Hours until enforcement becomes active. 0 when permitRequired is true
     * (already active). 999 when no schedule data is known. The mobile UI
     * uses this for the "active now / active later today / not active"
     * tier display so the user sees "starts in 4h" instead of just a
     * generic schedule string.
     */
    hoursUntilRestriction?: number;
  };
  meteredParking: {
    inMeteredZone: boolean;
    message: string;
    severity?: 'warning' | 'info' | 'none';
    nearestMeterDistanceM?: number;
    nearestMeterAddress?: string;
    timeLimitMinutes?: number;
    isEnforcedNow?: boolean;
    estimatedRate?: string;
    isRushHour?: boolean;
    rushHourInfo?: string;
    scheduleText?: string;
    isSeasonal?: boolean;
    rateZone?: number;
    /**
     * Secondary, less-prominent label rendered under the main address in the
     * mobile UI: the actual block range the meter covers. Useful for partial-
     * block meters (e.g., 4804-4810 Wolcott) so the user understands why the
     * alert fired even if the main displayed address falls outside that range.
     */
    blockRangeLabel?: string;
  };
  dotPermit: {
    hasActivePermit: boolean;
    message: string;
    severity?: 'critical' | 'warning' | 'info' | 'none';
    permitType?: string;
    startDate?: string;
    endDate?: string;
    streetClosure?: string;
    meterBagging?: boolean;
    description?: string;
    isActiveNow?: boolean;
  };
  /** Enforcement risk scoring based on 1.18M FOIA ticket records */
  enforcementRisk?: EnforcementRisk;
  /**
   * Confidence in the address identification, 0-100.
   *
   * Aggregates independent signals: snap distance, snap+Nominatim agreement,
   * trajectory vote consistency, compass+GPS heading agreement, Mapbox
   * promotion, user-anchor lock. Mobile UI can use this to decide whether
   * to surface a "verify this" prompt — e.g. show the Wrong street? modal
   * pre-opened when confidence < 70.
   *
   * Rough thresholds:
   *   90-100  high confidence, no friction
   *   70-89   show subtle hint
   *   <70     prompt user to verify
   */
  addressConfidence?: number;
  /** Human-readable factors that drove the confidence score (debug-friendly). */
  addressConfidenceReasons?: string[];
  /**
   * Up to 2 plausible alternate parking addresses when the snap pipeline had
   * a genuinely competitive runner-up street/segment. Empty when the winner
   * was clear (e.g. closest candidate is 3x closer than next). The mobile
   * "Wrong street?" modal renders these as one-tap correction buttons so the
   * user doesn't have to type the cross-street name.
   *
   * Only populated when:
   *   - candidate #2 is within 1.5x the distance of candidate #1 + 5m, AND
   *   - candidate #2 is itself within 50m of raw GPS
   * (Same threshold for #3.) These were tuned against real Chicago events
   * — Lawrence/Wolcott (3.6x ratio) won't trigger; Webster/Sheffield
   * (1.25x ratio) will.
   */
  addressAlternates?: Array<{
    /** Display label, e.g. "1820 W Lawrence Ave" — block midpoint when address ranges available, else street name only. */
    label: string;
    /** Full address string ready to submit as a street correction. */
    address: string;
    /** Raw street name from centerlines, useful for analytics. */
    streetName: string;
    /** Distance from raw GPS to this candidate's centerline, in meters. */
    distanceM: number;
  }>;
  /** Map-snap metadata - if the GPS coordinate was snapped to a known street */
  locationSnap?: {
    wasSnapped: boolean;
    snapDistanceMeters: number;
    streetName: string | null;
    snapSource: string | null;
    /** The original (pre-snap) coordinates */
    originalCoordinates: { latitude: number; longitude: number };
  };
  /**
   * Set when the result was locked to a previously-confirmed user anchor
   * (a "Wrong street?" correction or pin-drag confirmation within 50m of
   * this spot in the last 180 days). When present, the displayed address
   * came from the user's own correction, not the cascade. The mobile UI
   * surfaces a small "📍 Anchored" badge so the user knows their prior
   * correction is being honored.
   */
  parkingAnchor?: {
    lockedByUserAnchor: boolean;
    street?: string;
    ageDays?: number;
  };
  timestamp: string;
  error?: string;
}

/**
 * Normalize a Chicago street name so the same street in PostGIS
 * ("W LAWRENCE AVE") and Nominatim ("West Lawrence Avenue") forms
 * compares equal. Strips a leading direction word and a trailing
 * street-type word, then collapses any remaining punctuation /
 * whitespace.
 *
 * Anchored at start/end so direction/type words that appear MID-name
 * (e.g. "North Avenue" at 1600N where "North" IS the street name)
 * survive — without anchors a naive global strip would empty those
 * names out and produce false matches.
 *
 * Type list covers every suffix that appears in Chicago's street
 * centerlines + OSM data (incl. CIR, XING, SQ, ALY, ROW, WALK, PATH,
 * TRL, PIKE, PASS, RUN, BR, EXPY, EXT, GRN, HTS, etc.). Any new suffix
 * that shows up later just needs to be appended here.
 */
/** Haversine distance in meters between two lat/lng points. */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Look up this user's most-recent confirmed or corrected parking address near
 * the given coordinates. Returns the bare street name (e.g. "fremont") that
 * the snap pipeline can preferentially match against.
 *
 * Why: most parking is repeat parking — home, work, friend's house. Once the
 * user has tapped "I parked here" or used "Wrong street?" at a spot, future
 * detections within 50m of that exact lat/lng should trust the previously-
 * confirmed answer over whatever the snap cascade comes up with this time.
 *
 * The 50m window keeps it tight (a single Chicago block face) so an anchor
 * for one spot doesn't bleed into the next block over. We pull recent
 * candidates in a bbox first (uses existing user_id index) then filter by
 * Haversine for true 50m radius.
 */
async function lookupUserParkingAnchor(
  supabase: NonNullable<typeof supabaseAdmin>,
  userId: string,
  lat: number,
  lng: number,
): Promise<{ street: string; address: string; eventType: string; ageMs: number } | null> {
  const ANCHOR_RADIUS_M = 50;
  const ANCHOR_HORIZON_DAYS = 180;
  // Bbox slightly wider than the radius so we don't miss boundary cases.
  const latRange = 0.0006;   // ~67m
  const lngRange = 0.0008;   // ~67m at Chicago latitude
  const since = new Date(Date.now() - ANCHOR_HORIZON_DAYS * 86400 * 1000).toISOString();

  try {
    // Cast query builder to any — Supabase's generated types choke on this
    // chain length with TS2589 ("excessively deep"). Same pattern used
    // elsewhere in this file for similar queries.
    const { data, error } = await (supabase as any)
      .from('mobile_ground_truth_events')
      .select('event_type, latitude, longitude, metadata, event_ts')
      .eq('user_id', userId)
      .in('event_type', ['parking_street_correction', 'parking_confirmed'])
      .gte('latitude', lat - latRange)
      .lte('latitude', lat + latRange)
      .gte('longitude', lng - lngRange)
      .lte('longitude', lng + lngRange)
      .gte('event_ts', since)
      .order('event_ts', { ascending: false })
      .limit(20);

    if (error || !data || data.length === 0) return null;

    for (const row of data as any[]) {
      if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') continue;
      const dist = haversineMeters(lat, lng, row.latitude, row.longitude);
      if (dist > ANCHOR_RADIUS_M) continue;

      const md = row.metadata ?? {};
      let address: string | null = null;
      if (row.event_type === 'parking_street_correction') {
        // Set by HomeScreen.submitStreetCorrection.
        address = md.corrected_address ?? null;
      } else if (row.event_type === 'parking_confirmed') {
        // Set by HomeScreen.confirmParkingHere (added 2026-04-25).
        address = md.confirmed_address ?? null;
      }
      if (!address || typeof address !== 'string') continue;

      const parsed = parseChicagoAddress(address);
      const streetName = parsed?.name;
      if (!streetName) continue;

      const street = normChicagoStreet(streetName);
      if (!street) continue;

      const ageMs = Date.now() - new Date(row.event_ts).getTime();
      return { street, address, eventType: row.event_type, ageMs };
    }
    return null;
  } catch (e) {
    console.warn('[check-parking] User anchor lookup failed (non-fatal):', e);
    return null;
  }
}

function normChicagoStreet(s: string): string {
  return s.toLowerCase()
    .replace(/^\s*(north|south|east|west|n|s|e|w)\s+/, '')
    .replace(
      /\s+(ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane|pkwy|parkway|hwy|highway|ter|terrace|way|cir|circle|xing|crossing|sq|square|aly|alley|row|walk|path|trl|trail|pike|pass|run|br|branch|expy|expressway|ext|extension|grn|green|hts|heights|spur|loop|plaza|plz|cv|cove|crk|creek|hl|hill|pt|point|rdg|ridge|vis|vista)\.?\s*$/,
      ''
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Convert any Chicago street name format to the centerline/building-footprint
 * canonical format ("N LAKEWOOD AVE", "W BELDEN AVE"). This lets us pass
 * snapResult.streetName — which can be either OSM friendly format ("North
 * Lakewood Avenue", post-Nominatim-override) or centerline format ("N
 * LAKEWOOD AVE", direct PostGIS snap) — to nearest_address_point without
 * the strict-equality miss the SQL-side comparison enforces.
 *
 * Until 20260427_normalize_nearest_address_point.sql is applied this is
 * the only thing keeping the building-footprint lookup working when the
 * snap winner came from a Nominatim override.
 */
function toCenterlineFormat(name: string): string {
  if (!name) return name;
  const upper = name.toUpperCase().trim();
  const DIR_FULL: Record<string, string> = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
  const TYPE_FULL: Record<string, string> = {
    AVENUE: 'AVE', STREET: 'ST', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR',
    PLACE: 'PL', COURT: 'CT', LANE: 'LN', PARKWAY: 'PKWY', HIGHWAY: 'HWY',
    TERRACE: 'TER', CIRCLE: 'CIR', SQUARE: 'SQ', PLAZA: 'PLZ', CROSSING: 'XING',
    EXPRESSWAY: 'EXPY', TRAIL: 'TRL', BRANCH: 'BR',
  };
  const tokens = upper.replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return upper;

  // Normalize leading direction.
  if (DIR_FULL[tokens[0]]) tokens[0] = DIR_FULL[tokens[0]];

  // Normalize trailing street type.
  const last = tokens.length - 1;
  if (TYPE_FULL[tokens[last]]) tokens[last] = TYPE_FULL[tokens[last]];

  return tokens.join(' ');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MobileCheckParkingResponse | { error: string }>
) {
  // Allow both GET and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate the caller — this endpoint makes expensive external API calls
  // (reverse geocoding, Gemini AI) and exposes detailed parking restriction data.
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
    authHeader.substring(7)
  );
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid authorization token' });
  }

  // Get coordinates from query params (GET) or body (POST)
  const lat = req.method === 'GET' ? req.query.lat : req.body.latitude;
  const lng = req.method === 'GET' ? req.query.lng : req.body.longitude;

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lng as string);

  if (isNaN(latitude) || isNaN(longitude) || !isFinite(latitude) || !isFinite(longitude)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }

  // Validate coordinates are within Chicago city limits.
  //
  // Actual Chicago boundaries (per city GIS + Wikipedia):
  //   - Northern border (Howard St at Rogers Park / Evanston line): 42.0222°
  //   - Southern border: ~41.6445°
  //   - Western border: ~-87.9402°
  //   - Eastern border: Lake Michigan shoreline, ~-87.5245°
  //
  // Previous bound was latitude > 42.1 which extended ~6 miles INTO Evanston,
  // letting Northwestern-area coords (e.g. 42.0506 at University Pl, 60208)
  // through as "inside Chicago" — then the snap pipeline failed because we
  // don't have Evanston street centerlines, producing confusing no-snap rows
  // in parking_diagnostics (homsy.r.m@gmail.com case, 2026-04-21).
  //
  // We use 42.023 (10m north of Howard St) for a small safety margin on
  // edge-of-border GPS jitter.
  if (latitude < 41.64 || latitude > 42.023 || longitude < -87.95 || longitude > -87.52) {
    return res.status(400).json({
      error: 'outside_chicago',
      message: 'This app monitors Chicago parking restrictions. Your current location appears to be outside Chicago city limits (e.g., Evanston, Oak Park, Cicero). We don\'t yet check parking rules for suburbs.',
    });
  }

  // Accept optional accuracy, confidence, and heading from mobile client
  const accuracyMeters = parseFloat(
    (req.method === 'GET' ? req.query.accuracy : req.body.accuracy_meters) as string
  ) || undefined;
  const confidence = (req.method === 'GET' ? req.query.confidence : req.body.confidence) as string || undefined;
  // Heading in degrees (0-360, clockwise from true north). Used for street disambiguation
  // at intersections: if heading is ~0/180 (N/S), the car is on a N-S street; if ~90/270 (E/W), E-W street.
  const headingDeg = parseFloat(
    (req.method === 'GET' ? req.query.heading : req.body.heading) as string
  );
  let hasHeading = !isNaN(headingDeg) && headingDeg >= 0 && headingDeg < 360;

  // Compass heading from device magnetometer — works at zero speed (unlike GPS heading).
  // More reliable than GPS heading at park time because it's captured when the car is
  // freshly stopped, not stale from the last driving moment.
  const compassHeadingDeg = parseFloat(
    (req.method === 'GET' ? req.query.compass_heading : req.body.compass_heading) as string
  );
  const compassConfidenceDeg = parseFloat(
    (req.method === 'GET' ? req.query.compass_confidence : req.body.compass_confidence) as string
  );
  const hasCompass = !isNaN(compassHeadingDeg) && compassHeadingDeg >= 0 && compassHeadingDeg < 360
    && !isNaN(compassConfidenceDeg) && compassConfidenceDeg < 40; // only trust if std < 40°

  // CarPlay context — when the iPhone was paired to a CarPlay head unit during
  // this drive, native captured the disconnect timestamp + GPS fix. We use
  // these as a sharper "parking moment" anchor than post-drift GPS, and to
  // truncate the trajectory vote at disconnect time so post-park walking
  // samples can't contaminate street disambiguation. Empty for non-CarPlay
  // drives — pipeline falls back to existing behavior.
  const cpDisconnectAtRaw = (req.method === 'GET' ? req.query.cp_disconnect_at : req.body.cp_disconnect_at) as string | number | undefined;
  const cpDisconnectLatRaw = (req.method === 'GET' ? req.query.cp_disconnect_lat : req.body.cp_disconnect_lat) as string | number | undefined;
  const cpDisconnectLngRaw = (req.method === 'GET' ? req.query.cp_disconnect_lng : req.body.cp_disconnect_lng) as string | number | undefined;
  const cpConnectedAtRaw = (req.method === 'GET' ? req.query.cp_connected_at : req.body.cp_connected_at) as string | number | undefined;
  const cpActiveDuringDriveRaw = (req.method === 'GET' ? req.query.cp_active_during_drive : req.body.cp_active_during_drive) as string | number | undefined;
  // Head unit identity from AVAudioSessionPortDescription. Apple does not
  // expose VIN/speed/fuel to third-party apps; portUid + portName are what
  // is actually obtainable without an entitlement, and portUid is stable
  // per CarPlay pairing — useful for "this car parked at this GPS on N
  // prior occasions" pattern matching analytics.
  const cpPortUidRaw = (req.method === 'GET' ? req.query.cp_port_uid : req.body.cp_port_uid) as string | undefined;
  const cpPortNameRaw = (req.method === 'GET' ? req.query.cp_port_name : req.body.cp_port_name) as string | undefined;
  const cpDisconnectAt = cpDisconnectAtRaw != null ? Number(cpDisconnectAtRaw) : NaN;
  const cpDisconnectLat = cpDisconnectLatRaw != null ? Number(cpDisconnectLatRaw) : NaN;
  const cpDisconnectLng = cpDisconnectLngRaw != null ? Number(cpDisconnectLngRaw) : NaN;
  const cpConnectedAt = cpConnectedAtRaw != null ? Number(cpConnectedAtRaw) : NaN;
  const hasCarPlayDisconnectCoords = Number.isFinite(cpDisconnectLat) && Number.isFinite(cpDisconnectLng)
    && cpDisconnectLat >= 41.64 && cpDisconnectLat <= 42.023
    && cpDisconnectLng >= -87.95 && cpDisconnectLng <= -87.52;
  const hasCarPlayDisconnectTs = Number.isFinite(cpDisconnectAt) && cpDisconnectAt > 0;
  const carPlayActiveDuringDrive = cpActiveDuringDriveRaw === '1' || cpActiveDuringDriveRaw === 1;
  // Cap incoming strings — defensive against malformed clients. Real CarPlay
  // uids are short (typically <64 chars); names are short user-visible labels.
  const carPlayPortUid = typeof cpPortUidRaw === 'string' && cpPortUidRaw.length > 0 && cpPortUidRaw.length <= 128
    ? cpPortUidRaw
    : undefined;
  const carPlayPortName = typeof cpPortNameRaw === 'string' && cpPortNameRaw.length > 0 && cpPortNameRaw.length <= 128
    ? cpPortNameRaw
    : undefined;

  // Heading source preference (updated 2026-04-21 after Randy's Wolcott/Lawrence park):
  //   - GPS heading is the default — it reflects actual direction of motion.
  //   - BUT GPS heading at park time is frequently STALE (last driving direction
  //     captured before a turn). A car that drove east on Lawrence, turned north
  //     onto Wolcott, and parked seconds later will still have GPS heading=east.
  //     That drives "heading disambiguation" into picking the wrong street.
  //   - When GPS and compass disagree by more than 30° AND classify to different
  //     Chicago-grid orientations (N-S vs E-W), one signal is structurally wrong.
  //     GPS-after-turn is wrong-by-~90° with high certainty; compass can be off
  //     by 0-180° but is captured at park time (fresh), so on average compass
  //     is the better orientation signal in a high-disagreement scenario.
  //     We PREFER COMPASS in that case, rather than blindly keeping stale GPS.
  //   - Small disagreement (<30°) → keep GPS as primary (compass has mount noise)
  //   - Only compass available → use compass (weak but fresh)
  //   - Neither → no heading-based disambiguation.
  let headingDisagreementDeg: number | null = null;
  if (hasCompass && hasHeading) {
    const rawDiff = Math.abs(compassHeadingDeg - headingDeg);
    headingDisagreementDeg = Math.min(rawDiff, 360 - rawDiff);
  }
  // Same helper as isHeadingNorthSouth (defined at the bottom of file) but
  // inlined here so we can compute orientation before that block is reached.
  const orient = (h: number): 'N-S' | 'E-W' => {
    const n = ((h % 360) + 360) % 360;
    return (n <= 45 || n >= 315 || (n >= 135 && n <= 225)) ? 'N-S' : 'E-W';
  };
  let effectiveHeading: number;
  let effectiveHeadingSource: 'compass' | 'gps' | 'none';
  const HEADING_STALE_DISAGREEMENT_DEG = 30;
  const gpsAndCompassClassifyDifferently =
    hasHeading && hasCompass && orient(headingDeg) !== orient(compassHeadingDeg);
  if (
    hasHeading && hasCompass &&
    headingDisagreementDeg != null &&
    headingDisagreementDeg > HEADING_STALE_DISAGREEMENT_DEG &&
    gpsAndCompassClassifyDifferently
  ) {
    // Large disagreement + different orientation categories. GPS is almost
    // certainly stale from before a turn. Prefer compass.
    effectiveHeading = compassHeadingDeg;
    effectiveHeadingSource = 'compass';
    console.log(`[check-parking] GPS ${headingDeg.toFixed(0)}° (${orient(headingDeg)}) vs compass ${compassHeadingDeg.toFixed(0)}° (${orient(compassHeadingDeg)}) disagree by ${headingDisagreementDeg.toFixed(0)}° AND classify to different grid orientations. GPS heading likely stale after turn — preferring compass for street orientation.`);
    hasHeading = false; // treat GPS heading as not present downstream
  } else if (hasHeading) {
    effectiveHeading = headingDeg;
    effectiveHeadingSource = 'gps';
    if (hasCompass && headingDisagreementDeg != null && headingDisagreementDeg > 15) {
      console.log(`[check-parking] GPS ${headingDeg.toFixed(0)}° vs compass ${compassHeadingDeg.toFixed(0)}° disagree by ${headingDisagreementDeg.toFixed(0)}° (same grid orientation). Using GPS.`);
    }
  } else if (trajectoryMeanHeadingDeg != null) {
    // Trajectory median is a car-truthful GPS heading (averaged over multiple
    // driving fixes), so we treat it as `gps` for downstream logic — that
    // means it's strong enough to pass the Belden walk-away protection check.
    // Preferred over compass because compass is phone orientation, not car.
    effectiveHeading = trajectoryMeanHeadingDeg;
    effectiveHeadingSource = 'gps';
    console.log(`[check-parking] No per-fix GPS heading — using trajectory median ${trajectoryMeanHeadingDeg.toFixed(1)}° from ${trajectoryMeanHeadingSampleCount} driving points (car-truthful, treated as gps source).`);
  } else if (hasCompass) {
    effectiveHeading = compassHeadingDeg;
    effectiveHeadingSource = 'compass';
    console.log(`[check-parking] No GPS heading — falling back to compass ${compassHeadingDeg.toFixed(1)}° ±${compassConfidenceDeg.toFixed(1)}° (phone orientation, weak signal)`);
  } else {
    effectiveHeading = NaN;
    effectiveHeadingSource = 'none';
  }
  const hasEffectiveHeading = !isNaN(effectiveHeading);

  // Native detection metadata — passthrough from iOS BackgroundLocationModule.
  // Tells us whether GPS was captured at car-stop-time (good) or at check-time
  // after the user walked (bad), plus driving-duration and walk-away distance.
  const nativeLocationSource = (req.method === 'GET' ? req.query.location_source : req.body.location_source) as string | undefined;
  const nativeDetectionSource = (req.method === 'GET' ? req.query.detection_source : req.body.detection_source) as string | undefined;
  const nativeDrivingDurationSec = parseFloat(
    (req.method === 'GET' ? req.query.driving_duration_sec : req.body.driving_duration_sec) as string,
  );
  // Accept the new 'distance' param name; keep '_m' as a back-compat alias so
  // older mobile builds still log the value correctly until they're updated.
  const nativeDriftMeters = parseFloat(
    (req.method === 'GET'
      ? (req.query.drift_from_parking_distance ?? req.query.drift_from_parking_m)
      : (req.body.drift_from_parking_distance ?? req.body.drift_from_parking_m)) as string,
  );
  const nativeTimestampMs = parseFloat(
    (req.method === 'GET' ? req.query.native_ts : req.body.native_ts) as string,
  );
  if (nativeLocationSource) {
    const driftStr = Number.isFinite(nativeDriftMeters) ? `, drift=${nativeDriftMeters.toFixed(0)}m` : '';
    const durStr = Number.isFinite(nativeDrivingDurationSec) ? `, driving=${nativeDrivingDurationSec.toFixed(0)}s` : '';
    console.log(`[check-parking] Native meta: locationSource=${nativeLocationSource}${nativeDetectionSource ? `, detectionSource=${nativeDetectionSource}` : ''}${durStr}${driftStr}`);
  }

  // Apple CLGeocoder result captured at park time on iOS. 4th independent
  // address signal — different DB than PostGIS snap / OSM Nominatim / Mapbox.
  // For v1 we just log it to native_meta.apple so we can measure agreement;
  // promotion to a disambiguation vote comes after we have data.
  let appleGeocode: { thoroughfare?: string; subThoroughfare?: string; subLocality?: string; name?: string; postalCode?: string } | null = null;
  const appleGeocodeRaw = (req.method === 'GET' ? req.query.apple_geocode : req.body.apple_geocode) as string | undefined;
  if (appleGeocodeRaw) {
    try {
      const parsed = JSON.parse(appleGeocodeRaw);
      if (parsed && typeof parsed === 'object') appleGeocode = parsed;
    } catch (e) {
      console.warn('[check-parking] Failed to parse apple_geocode:', e);
    }
  }

  // Drive trajectory — last ~10 GPS fixes while the car was moving. Used for
  // trajectory-based street disambiguation: if the car was on Wolcott for 6
  // blocks before stopping, every trajectory point will be near Wolcott's
  // centerline, not Lawrence's, even if the stop point's nearest centerline
  // happens to be Lawrence.
  // Trajectory tuple is 4-element [lat, lng, heading, speed]. Newer iOS
  // clients append a 5th element [..., timestampMs] which we use here to
  // truncate the trajectory at carPlay.disconnectAt (post-disconnect samples
  // are walking, not driving — they pollute the trajectory vote). The
  // downstream pipeline only reads indices 0-3, so we strip the timestamp
  // after filtering to keep the existing 4-tuple type.
  let driveTrajectory: Array<[number, number, number, number]> = [];
  let trajectoryDroppedByCarPlayTruncation = 0;
  const trajectoryRaw = (req.method === 'GET' ? req.query.drive_trajectory : req.body.drive_trajectory) as string | undefined;
  if (trajectoryRaw) {
    try {
      const parsed = JSON.parse(trajectoryRaw);
      if (Array.isArray(parsed)) {
        let valid = parsed
          .filter((p: any) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number');
        if (hasCarPlayDisconnectTs) {
          const before = valid.length;
          // 1.5s grace window — the disconnect notification can land
          // microseconds after the last legitimate driving fix; we don't want
          // to drop the final-block fix we want most.
          const cutoff = cpDisconnectAt + 1500;
          valid = valid.filter((p: any) => {
            const ts = typeof p[4] === 'number' ? p[4] : null;
            if (ts == null) return true; // older client — no timestamp, can't filter
            return ts <= cutoff;
          });
          trajectoryDroppedByCarPlayTruncation = before - valid.length;
        }
        driveTrajectory = valid.slice(-10).map((p: any) => [
          Number(p[0]), Number(p[1]), Number(p[2]), Number(p[3]),
        ] as [number, number, number, number]);
      }
    } catch (e) {
      console.warn('[check-parking] Failed to parse drive_trajectory:', e);
    }
  }
  if (trajectoryDroppedByCarPlayTruncation > 0) {
    console.log(`[check-parking] CarPlay trajectory truncation: dropped ${trajectoryDroppedByCarPlayTruncation} post-disconnect fixes`);
  }
  // Trajectory median heading — circular mean of the last few driving GPS
  // headings. This is a car-truthful direction signal even when the single
  // stop-point heading is invalid (CLLocation.course goes -1 below ~1 m/s)
  // OR when iOS fails to capture lastDrivingHeading entirely (regression
  // observed in v2.0.7 builds for Randy's Apr 22 parks). Used as a fallback
  // heading source when the per-fix `heading` body field is missing.
  let trajectoryMeanHeadingDeg: number | null = null;
  let trajectoryMeanHeadingSampleCount = 0;
  if (driveTrajectory.length > 0) {
    const headings = driveTrajectory.map((p) => p[2]).filter((h) => h >= 0 && h < 360);
    if (headings.length >= 3) {
      let sumX = 0, sumY = 0;
      for (const h of headings) {
        const r = (h * Math.PI) / 180;
        sumX += Math.cos(r);
        sumY += Math.sin(r);
      }
      trajectoryMeanHeadingDeg = ((Math.atan2(sumY, sumX) * 180) / Math.PI + 360) % 360;
      trajectoryMeanHeadingSampleCount = headings.length;
      console.log(`[check-parking] Trajectory median heading: ${trajectoryMeanHeadingDeg.toFixed(0)}° (from ${headings.length} driving points)`);
    }
  }

  try {
    // Diagnostic accumulator — captures the full decision chain for accuracy tracking.
    // Inserted into parking_diagnostics table at the end (non-blocking).
    const diag: Record<string, any> = {
      raw_lat: latitude,
      raw_lng: longitude,
      raw_accuracy_meters: accuracyMeters || null,
      gps_heading: hasHeading ? headingDeg : null,
      compass_heading: hasCompass ? compassHeadingDeg : null,
      compass_confidence: hasCompass ? compassConfidenceDeg : null,
      heading_source: effectiveHeadingSource,
      effective_heading: hasEffectiveHeading ? effectiveHeading : null,
      // gps_source identifies which native path captured the coords:
      //   'stop_start'       = locationAtStopStart (GOOD — car-stop-time GPS)
      //   'last_driving'     = lastDrivingLocation (OK — last GPS while moving)
      //   'current_refined'  = refined to current fresh GPS after proximity check (mixed)
      //   'current_fallback' = current GPS at finalize time (BAD — possibly walk-away)
      //   'driving-buffer'   = Android median of driving ring buffer (GOOD)
      //   'pre-captured'     = iOS native pre-captured (= stop_start from native side)
      //   undefined          = manual check-parking or rescan (not a park-time check)
      gps_source: nativeLocationSource || null,
    };

    // Stash native detection metadata inside walkaway_details (existing JSONB
    // column — no migration needed). Lets us see which capture path produced
    // the coords and how long native sat on them before the check fired.
    const nativeMeta: Record<string, any> = {};
    if (nativeLocationSource) nativeMeta.locationSource = nativeLocationSource;
    if (nativeDetectionSource) nativeMeta.detectionSource = nativeDetectionSource;
    if (Number.isFinite(nativeDrivingDurationSec)) nativeMeta.drivingDurationSec = nativeDrivingDurationSec;
    if (Number.isFinite(nativeDriftMeters)) nativeMeta.driftFromParkingMeters = nativeDriftMeters;
    if (Number.isFinite(nativeTimestampMs)) {
      nativeMeta.nativeTimestampMs = nativeTimestampMs;
      nativeMeta.serverReceivedMs = Date.now();
      nativeMeta.captureToServerDelaySec = (Date.now() - nativeTimestampMs) / 1000;
    }
    if (headingDisagreementDeg != null) {
      nativeMeta.headingDisagreementDeg = Math.round(headingDisagreementDeg);
      nativeMeta.headingPreferredSource = effectiveHeadingSource;
    }
    // CarPlay head unit identity — persisted in parking_diagnostics.native_meta
    // (JSONB) so future analytics can do "this same car parked at this same
    // GPS on N prior occasions" pattern matching. Apple does NOT expose VIN /
    // speed / fuel to third-party apps; portUid is what's actually obtainable
    // without an entitlement, and is stable per CarPlay pairing.
    if (carPlayPortUid) nativeMeta.carPlayPortUid = carPlayPortUid;
    if (carPlayPortName) nativeMeta.carPlayPortName = carPlayPortName;
    if (Object.keys(nativeMeta).length > 0) {
      diag.native_meta = nativeMeta;
    }

    // Step 0: Apply per-block GPS correction if available (Layer 4).
    // Single-roundtrip RPC: find_gps_correction does spatial proximity against
    // block_centroid_lat/lng (populated from meter averages) and returns the
    // nearest learned offset. Replaces the old in-JS half-broken grid math
    // that hardcoded the perpendicular axis to State/Madison and never matched.
    let correctedLat = latitude;
    let correctedLng = longitude;
    if (supabaseAdmin) {
      try {
        const { data: corrRows, error: corrErr } = await supabaseAdmin.rpc('find_gps_correction', {
          p_lat: latitude,
          p_lng: longitude,
        });
        if (corrErr) {
          console.warn('[check-parking] GPS correction RPC failed (non-fatal):', corrErr.message);
        } else if (Array.isArray(corrRows) && corrRows.length > 0) {
          const corr = corrRows[0];
          const correctionM = Math.sqrt(
            Math.pow(corr.offset_lat * 111000, 2) +
            Math.pow(corr.offset_lng * 111000 * Math.cos(latitude * Math.PI / 180), 2)
          );
          // Sanity cap. Plausible urban-canyon GPS bias is 10-30m. Anything
          // above ~50m is the aggregator getting fooled by snap miss-matches
          // (events resolved to the wrong block of the same street). Applying
          // a 400m "correction" would teleport the GPS half a kilometer off.
          // Found in production immediately after first cron run: W LAWRENCE
          // 2000 had a 401m offset from 5 mis-snapped events.
          const MAX_PLAUSIBLE_CORRECTION_M = 50;
          if (correctionM > MAX_PLAUSIBLE_CORRECTION_M) {
            console.warn(`[check-parking] GPS correction REJECTED: ${corr.street_direction} ${corr.street_name} ${corr.block_number} offset is ${correctionM.toFixed(0)}m (cap ${MAX_PLAUSIBLE_CORRECTION_M}m). Sample of ${corr.sample_count} events likely contained snap miss-matches.`);
            diag.gps_correction_rejected = true;
            diag.gps_correction_meters = correctionM;
          } else {
            correctedLat = latitude + corr.offset_lat;
            correctedLng = longitude + corr.offset_lng;
            console.log(`[check-parking] GPS correction applied: ${corr.street_direction} ${corr.street_name} ${corr.block_number} block, ${correctionM.toFixed(1)}m shift (${corr.sample_count} events, ${Number(corr.distance_m).toFixed(0)}m from centroid)`);
            diag.gps_correction_applied = true;
            diag.gps_correction_meters = correctionM;
          }
        }
      } catch (corrErr) {
        console.warn('[check-parking] GPS correction lookup failed (non-fatal):', corrErr);
      }
    }

    // CarPlay-anchored snap input: when CarPlay disconnect coords are present
    // and within 100m of the post-correction GPS, use them as the snap input.
    // This is the canonical "where the car was when the engine turned off"
    // location — sharper than the post-confirmation GPS, which can drift
    // 10-50m during the 10-20s parking confirmation window if the user starts
    // walking before confirmParking() fires. Empty for non-CarPlay drives —
    // pipeline keeps using correctedLat/Lng as before.
    let carPlaySnapAnchorApplied = false;
    if (hasCarPlayDisconnectCoords) {
      const driftFromCorrected = haversineMeters(correctedLat, correctedLng, cpDisconnectLat, cpDisconnectLng);
      if (driftFromCorrected <= 100) {
        console.log(`[check-parking] CarPlay-anchored snap: replacing (${correctedLat.toFixed(6)}, ${correctedLng.toFixed(6)}) with disconnect coords (${cpDisconnectLat.toFixed(6)}, ${cpDisconnectLng.toFixed(6)}) — drift ${driftFromCorrected.toFixed(1)}m`);
        correctedLat = cpDisconnectLat;
        correctedLng = cpDisconnectLng;
        carPlaySnapAnchorApplied = true;
        diag.carplay_snap_anchor_applied = true;
        diag.carplay_snap_anchor_drift_m = Math.round(driftFromCorrected * 10) / 10;
      } else {
        console.warn(`[check-parking] CarPlay disconnect coords ${driftFromCorrected.toFixed(0)}m from corrected GPS — too far, NOT using as snap anchor (likely stale or wrong-drive)`);
        diag.carplay_snap_anchor_rejected = true;
        diag.carplay_snap_anchor_drift_m = Math.round(driftFromCorrected * 10) / 10;
      }
    }
    if (carPlayActiveDuringDrive) diag.carplay_active_during_drive = true;
    if (Number.isFinite(cpConnectedAt)) diag.carplay_connected_at = cpConnectedAt;
    if (hasCarPlayDisconnectTs) diag.carplay_disconnect_at = cpDisconnectAt;
    if (trajectoryDroppedByCarPlayTruncation > 0) diag.carplay_trajectory_dropped = trajectoryDroppedByCarPlayTruncation;
    if (carPlayPortUid) diag.carplay_port_uid = carPlayPortUid;
    if (carPlayPortName) diag.carplay_port_name = carPlayPortName;

    // Step 1: Attempt to snap GPS coordinate to nearest known street segment.
    // This corrects for urban canyon drift (10-30m) that can put you on the wrong block.
    // Only snap if accuracy is reasonable (under 75m) - very poor GPS shouldn't be "corrected".
    let checkLat = correctedLat;
    let checkLng = correctedLng;
    let snapResult: {
      wasSnapped: boolean;
      snapDistanceMeters: number;
      streetName: string | null;
      snapSource: string | null;
      streetBearing?: number;
      // Address range + segment fraction for house-number interpolation.
      // Only populated when the migration 20260417_street_centerlines_address_ranges
      // has been applied AND the re-import has been run. Fall back to grid
      // estimator when these are null.
      segmentFraction?: number;
      lFromAddr?: number | null;
      lToAddr?: number | null;
      rFromAddr?: number | null;
      rToAddr?: number | null;
      interpolatedNumber?: number | null;
      onewayDir?: string | null;
      lParity?: string | null;
      rParity?: string | null;
    } | null = null;

    const shouldSnap = !accuracyMeters || accuracyMeters <= 75;

    // Hoisted so downstream building-footprint parity constraint can read it.
    let userSideFromGps: 'L' | 'R' | null = null;

    // Hoisted so the Nominatim cross-reference (later in this try) can check
    // whether OSM's identified street is one of the snap candidates we already
    // saw — two independent signals agreeing on the same street is stronger
    // than any single heading-based disambiguation.
    let allCandidates: any[] = [];

    // Mapbox Geocoding v6 reverse house number, captured later in the
    // mapbox-reverse block. Used as a 3rd-tier address-number source between
    // building footprint / segment interpolation and the grid-estimator
    // fallback. Only set when Mapbox returned a real `address`-type feature
    // whose street agrees with the post-override snap winner — so we don't
    // borrow a house number from a different street.
    //
    // Why this matters (Belden row #71, 2026-04-26): user parked at
    // Belden+Kenmore, snap got overridden by Nominatim, the wide centerline
    // recovery missed Belden, and segment interpolation never fired. With
    // both higher-precedence sources null, the grid estimator returned 1139
    // W Belden — over a block off — when Mapbox-reverse already had the
    // real "1035 W Belden Ave" sitting unused in diag.native_meta.
    let mapboxReverseAddressNumber: number | null = null;

    // Helper: adopt a street_centerlines candidate as the winning snap and run
    // block-aware segment interpolation. Used when the initial snap winner is
    // overridden by Nominatim or Mapbox — without this helper those override
    // paths drop address-range geometry and force downstream to fall back to
    // raw reverse-geocoding (which produces wrong house numbers off the block
    // start, e.g. "4755" when the user is actually ~4715 on the 4700 block).
    async function adoptCandidateAsSnap(candidate: any, snapSource: string): Promise<{
      snapResult: any;
      snappedLat: number;
      snappedLng: number;
      userSide: 'L' | 'R' | null;
    }> {
      // Derive user's side of centerline from raw GPS offset vs candidate bearing.
      let side: 'L' | 'R' | null = null;
      if (
        typeof candidate.snapped_lat === 'number' &&
        typeof candidate.snapped_lng === 'number' &&
        typeof candidate.street_bearing === 'number' &&
        candidate.street_bearing >= 0
      ) {
        const cosLat = Math.cos((latitude * Math.PI) / 180);
        const dE = (longitude - candidate.snapped_lng) * cosLat * 111000;
        const dN = (latitude - candidate.snapped_lat) * 111000;
        const br = (candidate.street_bearing * Math.PI) / 180;
        const rightDot = dE * Math.cos(br) - dN * Math.sin(br);
        const acc = typeof accuracyMeters === 'number' && accuracyMeters > 0 ? accuracyMeters : 5;
        const sideThreshold = Math.max(1, acc * 0.5);
        if (Math.abs(rightDot) >= sideThreshold) {
          side = rightDot > 0 ? 'R' : 'L';
        }
      }

      // Block-aware segment interpolation — mirrors the initial-snap branch.
      let interpolatedNumber: number | null = null;
      const frac = typeof candidate.segment_fraction === 'number' ? candidate.segment_fraction : null;
      const ranges = [
        { from: candidate.l_from_addr, to: candidate.l_to_addr, side: 'L' as const },
        { from: candidate.r_from_addr, to: candidate.r_to_addr, side: 'R' as const },
      ].filter((r) => typeof r.from === 'number' && typeof r.to === 'number' && r.from > 0 && r.to > 0);

      if (frac != null && ranges.length > 0 && supabaseAdmin) {
        let isStandardBlock = false;
        try {
          const { data: nextSeg } = await supabaseAdmin
            .from('street_centerlines')
            .select('l_from_addr')
            .eq('street_name', candidate.street_name)
            .gt('l_from_addr', candidate.l_from_addr)
            .order('l_from_addr', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (nextSeg?.l_from_addr) {
            const currentBase = Math.floor(candidate.l_from_addr / 100) * 100;
            const nextBase = Math.floor(nextSeg.l_from_addr / 100) * 100;
            isStandardBlock = nextBase - currentBase === 100;
          }
        } catch (e) { /* non-fatal */ }

        let pick: any = ranges[0];
        if (side) {
          const sideMatch = ranges.find((r) => r.side === side);
          if (sideMatch) pick = sideMatch;
        }
        if (pick === ranges[0] && !side) {
          pick = ranges.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))[0];
        }
        const parityTarget = pick.from % 2;
        const blockBase = Math.floor(pick.from / 100) * 100;
        const effectiveLow = pick.from;
        const effectiveHigh = isStandardBlock ? blockBase + (parityTarget === 0 ? 98 : 99) : pick.to;
        const raw = effectiveLow + (effectiveHigh - effectiveLow) * frac;
        let n = Math.round(raw);
        if (n % 2 !== parityTarget) n += n > raw ? -1 : 1;
        n = Math.min(Math.max(n, effectiveLow), effectiveHigh);
        interpolatedNumber = n;
        console.log(`[check-parking] adoptCandidateAsSnap interpolated (${snapSource}): side=${pick.side}, range=${pick.from}-${pick.to}, frac=${frac.toFixed(3)} → ${interpolatedNumber}`);
      }

      return {
        snapResult: {
          wasSnapped: true,
          snapDistanceMeters: candidate.snap_distance_meters,
          streetName: candidate.street_name,
          snapSource,
          streetBearing: candidate.street_bearing,
          segmentFraction: frac ?? undefined,
          lFromAddr: candidate.l_from_addr ?? null,
          lToAddr: candidate.l_to_addr ?? null,
          rFromAddr: candidate.r_from_addr ?? null,
          rToAddr: candidate.r_to_addr ?? null,
          interpolatedNumber,
          onewayDir: candidate.oneway_dir ?? null,
          lParity: candidate.l_parity ?? null,
          rParity: candidate.r_parity ?? null,
        },
        snappedLat: candidate.snapped_lat,
        snappedLng: candidate.snapped_lng,
        userSide: side,
      };
    }

    // Helper: find a street_centerlines segment on a specific street near the
    // user. Used when Nominatim identifies a street outside our 80m snap
    // candidate pool (walk-away drift, sparse-coverage blocks). A widened
    // 200m PostGIS lookup lets us still recover address-range geometry so
    // segment interpolation works end-to-end.
    async function findCenterlineSegmentByName(streetName: string): Promise<any | null> {
      if (!supabaseAdmin) return null;
      try {
        const { data, error } = await supabaseAdmin.rpc('snap_to_nearest_street', {
          user_lat: latitude,
          user_lng: longitude,
          search_radius_meters: 200,
        });
        if (error || !Array.isArray(data)) return null;

        const target = normChicagoStreet(streetName);
        const match = data.find((c: any) => c.was_snapped && normChicagoStreet(c.street_name) === target) ?? null;
        // Guard against adopting a segment that's very far away (wrong block
        // entirely). 150m is ~one block in Chicago's grid.
        if (match && typeof match.snap_distance_meters === 'number' && match.snap_distance_meters > 150) {
          return null;
        }
        return match;
      } catch (e) {
        return null;
      }
    }

    if (shouldSnap && supabaseAdmin) {
      try {
        // Search radius must be wide enough that the PERPENDICULAR street at
        // an intersection shows up as a candidate, not just the street whose
        // centerline happens to be closest to the raw GPS. Corner parking
        // (user ~3m from cross-street's centerline, ~45m from their own
        // street's centerline) is common and was producing wrong-street snaps
        // before. Floor at 50m so perpendicular candidates enter the pool.
        // Cap at 80m to avoid matching streets clearly out of range.
        const searchRadius = accuracyMeters
          ? Math.min(Math.max(accuracyMeters * 2.5, 50), 80)
          : 50;

        const { data: snapData, error: snapError } = await supabaseAdmin.rpc(
          'snap_to_nearest_street',
          {
            user_lat: correctedLat,
            user_lng: correctedLng,
            search_radius_meters: searchRadius,
          }
        );

        if (!snapError && snapData && snapData.length > 0 && snapData[0].was_snapped) {
          allCandidates = snapData.filter((s: any) => s.was_snapped);
          // Max distance for the "obvious best" filter. Keep close candidates
          // here; far perpendicular ones (30-60m) are still available in
          // allCandidates for heading/trajectory disambiguation below.
          const maxSnapDistance = accuracyMeters ? Math.max(accuracyMeters, 30) : 40;

          // Filter by max snap distance
          let candidates = allCandidates.filter((s: any) => s.snap_distance_meters <= maxSnapDistance);

          // Detect near-intersection: 2+ candidates AND they span both N-S and E-W
          // orientations, or 2+ candidates within ~25m of each other. Previously
          // near_intersection was never set server-side so it was stuck at 0%.
          if (candidates.length >= 2) {
            const orients = new Set<string>();
            for (const c of candidates) {
              const o = getChicagoStreetOrientation(c.street_name);
              if (o) orients.add(o);
            }
            const closeTogether = (candidates[1].snap_distance_meters - candidates[0].snap_distance_meters) < 25;
            if (orients.size >= 2 || closeTogether) {
              diag.near_intersection = true;
            }
          }

          if (candidates.length > 0) {
            let bestCandidate = candidates[0]; // Default: closest

            // ── HIGHEST PRECEDENCE: user anchor from prior corrections ──
            // Most parking is repeat parking (home, work, friend's). Once
            // the user has explicitly tapped "Wrong street?" or "I parked
            // here" at a spot, the address they confirmed is ground truth
            // for any future detection within 50m. The cascade can be
            // wrong; the user is not wrong about where they parked.
            //
            // We try the anchor street against three pools, widest first:
            //   1. allCandidates (≤80m PostGIS snap pool)
            //   2. extended findCenterlineSegmentByName (≤200m, then 150m
            //      sanity-distance cap)
            // If found, adopt the matching segment so block-aware
            // interpolation still produces a real house number.
            let lockedByUserAnchor = false;
            try {
              const anchor = await lookupUserParkingAnchor(supabaseAdmin!, user.id, latitude, longitude);
              if (anchor) {
                const anchorMatch = allCandidates.find((c: any) =>
                  normChicagoStreet(c.street_name) === anchor.street
                );
                let anchorCandidate: any = anchorMatch;
                if (!anchorCandidate) {
                  const ext = await findCenterlineSegmentByName(anchor.address);
                  if (ext) anchorCandidate = ext;
                }
                if (anchorCandidate) {
                  bestCandidate = anchorCandidate;
                  lockedByUserAnchor = true;
                  diag.locked_by_user_anchor = true;
                  diag.user_anchor_street = anchor.street;
                  diag.user_anchor_age_days = Math.round(anchor.ageMs / 86400000);
                  console.log(`[check-parking] ANCHOR LOCK: user previously confirmed "${anchor.address}" within 50m (${anchor.eventType}, ${diag.user_anchor_age_days}d ago) → snap to ${anchorCandidate.street_name} at ${anchorCandidate.snap_distance_meters.toFixed(1)}m. Skipping cascade.`);
                } else {
                  console.log(`[check-parking] User anchor "${anchor.address}" found but no matching centerline within 200m — falling through to normal pipeline.`);
                }
              }
            } catch (e) {
              console.warn('[check-parking] User anchor lookup failed (non-fatal):', e);
            }

            // ── EARLY LOCK: close snap + Nominatim agreement ──
            // When the closest snap is very close (≤15m) AND Nominatim
            // independently identifies the same street from raw GPS, we have
            // two-of-two close geometric agreement. Lock the answer and skip
            // ALL override paths (trajectory voting, heading-extended search,
            // Nominatim override). Those paths exist to recover from wrong
            // close snaps — but we don't have one, and stale post-turn heading
            // can otherwise drag a correct close snap onto a cross street
            // (Lawrence regression 2026-04-25: 11.5m close snap to Lawrence
            // was abandoned for Wolcott at 46.7m because heading 217° was
            // stale from before the final turn).
            //
            // Two-of-two beats heading every time. Result is cached for the
            // downstream Nominatim cross-reference block (built-in 1h TTL).
            let lockedByCloseSnap = false;
            const CLOSE_LOCK_THRESHOLD_M = 15;
            // Skip the close-snap lock if user anchor already locked the answer.
            if (!lockedByUserAnchor && candidates[0].snap_distance_meters <= CLOSE_LOCK_THRESHOLD_M) {
              try {
                const { reverseGeocode } = await import('../../../lib/reverse-geocoder');
                const earlyNom = await reverseGeocode(latitude, longitude);
                if (earlyNom?.street_name) {
                  if (normChicagoStreet(candidates[0].street_name) === normChicagoStreet(earlyNom.street_name)) {
                    lockedByCloseSnap = true;
                    bestCandidate = candidates[0];
                    console.log(`[check-parking] LOCK: close snap ${candidates[0].snap_distance_meters.toFixed(1)}m to ${candidates[0].street_name} agrees with Nominatim "${earlyNom.street_name}" — skipping cascade.`);
                    diag.locked_by_close_snap = true;
                  }
                }
              } catch (e) {
                console.warn('[check-parking] Early close-snap lock check failed (non-fatal):', e);
              }
            }

            // ── TRAJECTORY-BASED DISAMBIGUATION (turn-aware) ──
            // Skipped when locked by close-snap+Nominatim agreement: we
            // already know the street, no need to override.
            if (!lockedByCloseSnap && !lockedByUserAnchor) {
            // The car may have driven a long stretch on street A, then turned
            // onto street B and parked seconds later. Voting across the whole
            // trajectory would incorrectly pick A. We need to find the LAST
            // constant-heading run (the post-turn segment) and vote only on
            // those fixes — that's the actual parking street.
            //
            // Algorithm: walk backwards from the most recent driving fix.
            // Keep accumulating fixes as long as each one's heading is within
            // 30° of the previous. When a heading jump >30° appears, that's
            // the turn; stop walking back. Vote with just the post-turn fixes.
            // Run trajectory vote whenever we have trajectory data AND there's
            // more than one candidate in the widened pool (allCandidates). A
            // perpendicular street at an intersection is often outside the
            // tight distance filter (~30m) but within the search radius (50m);
            // trajectory can still identify the correct one.
            // Log trajectory buffer size even when vote can't run — so post-hoc
            // diagnostics show whether the client sent trajectory data at all,
            // and how much of it survived to be useful.
            diag.trajectory_total_len = driveTrajectory.length;
            if (driveTrajectory.length >= 2 && allCandidates.length > 1 && supabaseAdmin) {
              try {
                // Build the post-turn segment (most recent consecutive fixes
                // with consistent heading). Trajectory is oldest → newest.
                const postTurn: Array<[number, number, number, number]> = [];
                for (let i = driveTrajectory.length - 1; i >= 0; i--) {
                  const curr = driveTrajectory[i];
                  if (postTurn.length === 0) {
                    postTurn.unshift(curr);
                    continue;
                  }
                  const prev = postTurn[0];
                  // Both must have valid headings (≥0) to compare
                  if (prev[2] < 0 || curr[2] < 0) {
                    postTurn.unshift(curr);
                    continue;
                  }
                  const diff = Math.abs(prev[2] - curr[2]);
                  const delta = Math.min(diff, 360 - diff);
                  if (delta < 30) {
                    postTurn.unshift(curr);
                  } else {
                    // Heading jump — turn detected. Older fixes are on the
                    // previous street and irrelevant to the parking street.
                    console.log(`[check-parking] Trajectory turn detected at fix ${i}: heading jumped ${delta.toFixed(0)}° (${curr[2].toFixed(0)}°→${prev[2].toFixed(0)}°). Using ${postTurn.length} post-turn fixes.`);
                    break;
                  }
                }

                // Run trajectory vote when we have ≥2 post-turn fixes. Originally
                // gated at ≥3 out of caution, but the 2-second turn-and-park case
                // is common (right-turn at a stoplight → park immediately around
                // the corner) and at ~1 Hz GPS only yields 2-3 post-turn fixes.
                // Two fixes agreeing on the same street is a strong signal — and
                // if they disagree, the vote is declared inconclusive and we
                // fall through to heading-based disambiguation cleanly.
                if (postTurn.length >= 2) {
                  // Always log post-turn length so we can see what happened
                  // per event, even in the inconclusive-vote branch below.
                  diag.trajectory_post_turn_len = postTurn.length;
                  // Vote among ALL candidates (including perpendicular streets
                  // just outside the distance filter), not just the close ones.
                  const candidateNames = new Set(allCandidates.map((c: any) => c.street_name));
                  const snaps = await Promise.all(
                    postTurn.map(([plat, plng]) =>
                      supabaseAdmin!.rpc('snap_to_nearest_street', {
                        user_lat: plat, user_lng: plng, search_radius_meters: 25,
                      }),
                    ),
                  );
                  const votes = new Map<string, number>();
                  for (const snap of snaps) {
                    const winner = (snap.data || []).filter((c: any) => c.was_snapped)[0];
                    if (winner?.street_name && candidateNames.has(winner.street_name)) {
                      votes.set(winner.street_name, (votes.get(winner.street_name) || 0) + 1);
                    }
                  }
                  if (votes.size > 0) {
                    const sorted = Array.from(votes.entries()).sort((a, b) => b[1] - a[1]);
                    const [topStreet, topVotes] = sorted[0];
                    const runnerUpVotes = sorted[1]?.[1] ?? 0;
                    // Majority of post-turn fixes + clear lead
                    if (topVotes >= Math.ceil(postTurn.length * 0.5) && topVotes - runnerUpVotes >= 1) {
                      const trajWinner = allCandidates.find((c: any) => c.street_name === topStreet);
                      if (trajWinner && trajWinner !== bestCandidate) {
                        console.log(`[check-parking] Trajectory override: ${postTurn.length} post-turn points, votes=${JSON.stringify(Object.fromEntries(votes))} → ${topStreet} wins over ${bestCandidate.street_name}`);
                        bestCandidate = trajWinner;
                        diag.trajectory_override = true;
                        diag.trajectory_votes = Object.fromEntries(votes);
                        diag.trajectory_post_turn_len = postTurn.length;
                      } else if (trajWinner === bestCandidate) {
                        console.log(`[check-parking] Trajectory confirms snap pick: ${topStreet} (${topVotes}/${postTurn.length} post-turn points)`);
                        diag.trajectory_confirmed = true;
                        diag.trajectory_votes = Object.fromEntries(votes);
                      }
                    } else {
                      console.log(`[check-parking] Trajectory votes inconclusive: ${JSON.stringify(Object.fromEntries(votes))}`);
                    }
                  }
                } else {
                  console.log(`[check-parking] Only ${postTurn.length} post-turn fixes — insufficient for trajectory vote, falling back to heading.`);
                  diag.trajectory_post_turn_len = postTurn.length;
                }
              } catch (trajErr) {
                console.warn('[check-parking] Trajectory disambiguation failed (non-fatal):', trajErr);
              }
            }

            // Trajectory already picked a winner? Skip heading disambiguation —
            // trajectory is a stronger signal (based on the car's actual path
            // over multiple fixes) and shouldn't be overridden by a single
            // snap-point heading read.
            const trajectoryAlreadyPicked = diag.trajectory_override === true;

            // Heading-based street disambiguation using Chicago's grid system.
            // Chicago streets follow a strict grid: streets prefixed W/E run east-west,
            // streets prefixed N/S run north-south. If we have heading AND multiple
            // candidates (or a single candidate whose orientation doesn't match heading),
            // we can pick the right street.
            //
            // Example: User parked on Wolcott (N-S) near Lawrence (E-W).
            // If heading is ~0°/180° (N/S), prefer the N/S street.
            if (!trajectoryAlreadyPicked && hasEffectiveHeading && candidates.length > 1) {
              const headingIsNS = isHeadingNorthSouth(effectiveHeading);
              const headingDir = headingIsNS ? 'N-S' : 'E-W';
              const hdgSrc = hasCompass ? ', compass' : '';

              // First look within distance-filtered candidates
              let found = false;
              for (const c of candidates) {
                const streetDir = getChicagoStreetOrientation(c.street_name);
                if (streetDir === headingDir) {
                  bestCandidate = c;
                  console.log(`[check-parking] Heading disambiguation: ${effectiveHeading.toFixed(0)}° (${headingDir}${hdgSrc}) → chose ${c.street_name} over ${candidates[0].street_name}`);
                  found = true;
                  break;
                }
              }

              // If no heading match in distance-filtered candidates, search ALL candidates
              // (up to 50m). This catches the case where the heading-matching street was
              // just beyond the accuracy-based distance filter.
              if (!found) {
                for (const c of allCandidates) {
                  if (candidates.includes(c)) continue; // Already checked
                  const cDir = getChicagoStreetOrientation(c.street_name);
                  if (cDir === headingDir && c.snap_distance_meters <= 50) {
                    bestCandidate = c;
                    console.log(`[check-parking] Heading disambiguation (extended search): ${effectiveHeading.toFixed(0)}° (${headingDir}${hdgSrc}) → chose ${c.street_name} at ${c.snap_distance_meters.toFixed(1)}m`);
                    found = true;
                    break;
                  }
                }
              }
            } else if (!trajectoryAlreadyPicked && hasEffectiveHeading && candidates.length === 1) {
              // Single candidate — verify heading alignment. If mismatched, search ALL
              // snap candidates (including those beyond max distance) for a heading match.
              const streetDir = getChicagoStreetOrientation(candidates[0].street_name);
              const headingDir = isHeadingNorthSouth(effectiveHeading) ? 'N-S' : 'E-W';
              const hdgSrc = hasCompass ? ', compass' : '';
              if (streetDir && streetDir !== headingDir) {
                // Search ALL candidates (not just distance-filtered) for heading match
                let headingMatch = null;
                for (const c of allCandidates) {
                  const cDir = getChicagoStreetOrientation(c.street_name);
                  if (cDir === headingDir && c.snap_distance_meters <= 50) {
                    headingMatch = c;
                    break;
                  }
                }

                if (headingMatch) {
                  console.log(`[check-parking] Heading mismatch with closest (${candidates[0].street_name}, ${streetDir}), but found heading-matching candidate: ${headingMatch.street_name} at ${headingMatch.snap_distance_meters.toFixed(1)}m (heading ${effectiveHeading.toFixed(0)}° → ${headingDir}${hdgSrc})`);
                  bestCandidate = headingMatch;
                } else if (candidates[0].snap_distance_meters <= 15) {
                  // Close snap (< 15m) is strong geometric evidence even if heading disagrees.
                  // Heading can be stale after a turn (e.g., drove west on Webster, turned onto
                  // Clifton, heading still says west). A 6.8m snap to Clifton beats stale heading.
                  console.log(`[check-parking] Heading mismatch but closest snap is very close (${candidates[0].snap_distance_meters.toFixed(1)}m to ${candidates[0].street_name}). Keeping close snap — heading likely stale after turn.`);
                  bestCandidate = candidates[0];
                } else {
                  console.log(`[check-parking] Heading mismatch: heading ${effectiveHeading.toFixed(0)}° (${headingDir}${hdgSrc}) but snap target is ${candidates[0].street_name} (${streetDir}) at ${candidates[0].snap_distance_meters.toFixed(1)}m. No heading-matching candidate found. Skipping snap — using original coordinates for reverse geocode.`);
                  bestCandidate = null as any;
                }
              }
            }
            } // end if (!lockedByCloseSnap && !lockedByUserAnchor) — locks skip disambiguation

            if (bestCandidate) {
              checkLat = bestCandidate.snapped_lat;
              checkLng = bestCandidate.snapped_lng;

              // Block-aware, side-aware address interpolation.
              //
              // Randy pointed out the old code picked the larger-span side's
              // parity regardless of which physical side the user was on —
              // which could flip the parity and misidentify the side for
              // downstream one-way side detection.
              //
              // Fix: use the user's GPS offset from the centerline, combined
              // with the segment bearing, to determine which side they're on.
              // Then pick THAT side's address range and stretch it to the
              // full block when the next segment confirms a standard boundary.
              let interpolatedNumber: number | null = null;
              const frac = typeof bestCandidate.segment_fraction === 'number' ? bestCandidate.segment_fraction : null;
              const ranges = [
                { from: bestCandidate.l_from_addr, to: bestCandidate.l_to_addr, side: 'L' as const },
                { from: bestCandidate.r_from_addr, to: bestCandidate.r_to_addr, side: 'R' as const },
              ].filter((r) => typeof r.from === 'number' && typeof r.to === 'number' && r.from > 0 && r.to > 0);

              // Determine user's side of centerline from GPS offset.
              // Positive cross-product (east × north relative to bearing) = LEFT of segment direction.
              if (
                typeof bestCandidate.snapped_lat === 'number' &&
                typeof bestCandidate.snapped_lng === 'number' &&
                typeof bestCandidate.street_bearing === 'number' &&
                bestCandidate.street_bearing >= 0
              ) {
                const cosLat = Math.cos((latitude * Math.PI) / 180);
                const dE = (longitude - bestCandidate.snapped_lng) * cosLat * 111000;
                const dN = (latitude - bestCandidate.snapped_lat) * 111000;
                const br = (bestCandidate.street_bearing * Math.PI) / 180;
                // Unit right-of-direction vector: (cos(br), -sin(br))
                const rightDot = dE * Math.cos(br) - dN * Math.sin(br);
                // Adaptive threshold: trust the side determination when the
                // measured offset is at least half the GPS accuracy (but no
                // less than 1m). Rationale: a parallel-parked Chicago car is
                // typically 3-5m off the centerline, which is well above any
                // reasonable GPS noise floor. A static 2m threshold
                // unnecessarily abstained on ~15% of events when GPS was
                // slightly noisy on an otherwise clear offset. We still
                // abstain if GPS is particularly bad (e.g., 15m accuracy →
                // require ≥7.5m offset before trusting the sign).
                const acc = typeof accuracyMeters === 'number' && accuracyMeters > 0 ? accuracyMeters : 5;
                const sideThreshold = Math.max(1, acc * 0.5);
                if (Math.abs(rightDot) >= sideThreshold) {
                  userSideFromGps = rightDot > 0 ? 'R' : 'L';
                }
              }

              if (frac != null && ranges.length > 0 && supabaseAdmin) {
                // Detect standard block boundary for full-block stretch.
                let isStandardBlock = false;
                try {
                  const { data: nextSeg } = await supabaseAdmin
                    .from('street_centerlines')
                    .select('l_from_addr')
                    .eq('street_name', bestCandidate.street_name)
                    .gt('l_from_addr', bestCandidate.l_from_addr)
                    .order('l_from_addr', { ascending: true })
                    .limit(1)
                    .maybeSingle();
                  if (nextSeg?.l_from_addr) {
                    const currentBase = Math.floor(bestCandidate.l_from_addr / 100) * 100;
                    const nextBase = Math.floor(nextSeg.l_from_addr / 100) * 100;
                    isStandardBlock = nextBase - currentBase === 100;
                  }
                } catch (e) {
                  console.warn('[check-parking] Next-segment lookup failed:', e);
                }

                // Pick range by user-side-from-GPS, fall back to larger-span side.
                let pick: any = ranges[0];
                if (userSideFromGps) {
                  const sideMatch = ranges.find((r) => r.side === userSideFromGps);
                  if (sideMatch) pick = sideMatch;
                }
                if (pick === ranges[0] && !userSideFromGps) {
                  pick = ranges.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))[0];
                }
                const parityTarget = pick.from % 2;
                const blockBase = Math.floor(pick.from / 100) * 100;
                const effectiveLow = pick.from;
                const effectiveHigh = isStandardBlock ? blockBase + (parityTarget === 0 ? 98 : 99) : pick.to;
                const raw = effectiveLow + (effectiveHigh - effectiveLow) * frac;
                let n = Math.round(raw);
                if (n % 2 !== parityTarget) n += n > raw ? -1 : 1;
                n = Math.min(Math.max(n, effectiveLow), effectiveHigh);
                interpolatedNumber = n;
                console.log(`[check-parking] Address interpolated: picked_side=${pick.side}${userSideFromGps ? ' (from GPS offset)' : ' (larger-span fallback, no GPS offset signal)'}, range=${pick.from}-${pick.to}, effective=${effectiveLow}-${effectiveHigh} (standard_block=${isStandardBlock}), frac=${frac.toFixed(3)} → ${interpolatedNumber}`);
              }

              snapResult = {
                wasSnapped: true,
                snapDistanceMeters: bestCandidate.snap_distance_meters,
                streetName: bestCandidate.street_name,
                snapSource: bestCandidate.snap_source,
                streetBearing: bestCandidate.street_bearing,
                segmentFraction: frac ?? undefined,
                lFromAddr: bestCandidate.l_from_addr ?? null,
                lToAddr: bestCandidate.l_to_addr ?? null,
                rFromAddr: bestCandidate.r_from_addr ?? null,
                rToAddr: bestCandidate.r_to_addr ?? null,
                interpolatedNumber,
                onewayDir: bestCandidate.oneway_dir ?? null,
                lParity: bestCandidate.l_parity ?? null,
                rParity: bestCandidate.r_parity ?? null,
              };
              console.log(`[check-parking] Snapped ${bestCandidate.snap_distance_meters.toFixed(1)}m to ${bestCandidate.street_name} (${bestCandidate.snap_source}, bearing=${bestCandidate.street_bearing?.toFixed(0) ?? 'none'}°)`);
              diag.snap_candidates_count = allCandidates?.length || 0;
            }
          }
        }
        // --- Extended heading search (Failure Mode 1: GPS drift >50m) ---
        // If heading is available but NO snap candidate matched the heading direction,
        // the correct street may be beyond the initial search radius (e.g., GPS drifted
        // 100-170m north of Belden onto Kenmore's centerline). Do a wider search (150m)
        // specifically to find a heading-matching street.
        if (hasEffectiveHeading && !snapResult) {
          try {
            const headingDir = isHeadingNorthSouth(effectiveHeading) ? 'N-S' : 'E-W';
            console.log(`[check-parking] No heading-matching snap candidate within initial radius. Trying extended search (150m) for ${headingDir} street...`);

            const { data: extendedData, error: extendedError } = await supabaseAdmin.rpc(
              'snap_to_nearest_street',
              {
                user_lat: correctedLat,
                user_lng: correctedLng,
                search_radius_meters: 150,
              }
            );

            if (!extendedError && extendedData && extendedData.length > 0) {
              // Find closest candidate matching heading direction
              const headingMatch = extendedData
                .filter((s: any) => s.was_snapped)
                .find((s: any) => getChicagoStreetOrientation(s.street_name) === headingDir);

              if (headingMatch) {
                checkLat = headingMatch.snapped_lat;
                checkLng = headingMatch.snapped_lng;
                snapResult = {
                  wasSnapped: true,
                  snapDistanceMeters: headingMatch.snap_distance_meters,
                  streetName: headingMatch.street_name,
                  snapSource: `${headingMatch.snap_source}+heading_extended`,
                  streetBearing: headingMatch.street_bearing,
                };
                console.log(`[check-parking] Extended heading search found: ${headingMatch.street_name} at ${headingMatch.snap_distance_meters.toFixed(1)}m (heading ${effectiveHeading.toFixed(0)}° → ${headingDir}${hasCompass ? ', compass' : ''})`);
              } else {
                console.log(`[check-parking] Extended heading search: no ${headingDir} street found within 150m`);
              }
            }
          } catch (extErr) {
            console.warn('[check-parking] Extended heading search failed (non-fatal):', extErr);
          }
        }

        // --- Nominatim cross-reference (ALWAYS runs when snap produced a result) ---
        // Nominatim identifies the nearest road from OSM data using road geometry,
        // which can be more accurate than centerline-distance snapping at intersections.
        // This MUST run even when heading is available because heading can be STALE
        // after a turn (e.g., driving south on Kenmore → turn right onto Belden → park
        // quickly: lastDrivingHeading is still ~180° south = N-S = Kenmore's orientation,
        // so heading-based disambiguation actively picks the WRONG street).
        // Nominatim is ground truth from the GPS position — it doesn't care about heading.
        if (snapResult) {
          try {
            const { reverseGeocode } = await import('../../../lib/reverse-geocoder');
            const nominatimResult = await reverseGeocode(latitude, longitude);

            if (nominatimResult?.street_name) {
              const snapOrientation = getChicagoStreetOrientation(snapResult.streetName);
              const nominatimOrientation = getChicagoStreetOrientation(nominatimResult.street_name);

              if (snapOrientation && nominatimOrientation && snapOrientation !== nominatimOrientation) {
                // Snap and Nominatim disagree on which street we're on.
                //
                // Strongest cross-confirmation: Nominatim picks a street that's
                // ALSO in our snap candidates (PostGIS already saw it as a
                // nearby centerline). Two independent geometric signals agree.
                // Trust this over heading-based disambiguation UNLESS we have a
                // trustworthy driving heading that contradicts Nominatim's
                // orientation (the Belden walk-away case).
                //
                // Use normChicagoStreet for fuzzy matching — PostGIS stores
                // names as "N LAKEWOOD AVE" while Nominatim returns "North
                // Lakewood Avenue". Strict equality (the prior implementation)
                // never matched these so the wide-search fallback ran for
                // every override, sometimes timing out and dropping geometry
                // entirely (Belden row #71, Lakewood row #73 — both had the
                // correct candidate sitting in allCandidates within ~10m).
                const nomNormForCandidate = normChicagoStreet(nominatimResult.street_name);
                const nominatimCandidate = allCandidates.find((c: any) =>
                  normChicagoStreet(c.street_name) === nomNormForCandidate
                ) ?? null;
                const nominatimMatchesCandidate = nominatimCandidate !== null;
                // hasHeading == GPS driving heading present (not compass). If
                // the user was actively driving on Belden right before parking,
                // the GPS course will say E-W and protect the Belden snap from
                // being overridden by Nominatim's walked-away N-S read. Compass
                // is intentionally excluded — phone orientation isn't car
                // orientation, so compass agreement is too noisy to block OSM.
                const drivingHeadingContradictsNominatim = hasHeading && (
                  (nominatimOrientation === 'N-S' && !isHeadingNorthSouth(headingDeg)) ||
                  (nominatimOrientation === 'E-W' && isHeadingNorthSouth(headingDeg))
                );

                // Fallback to original logic for cases where Nominatim picked
                // a street outside our candidate set (likely walk-away drift).
                // Heading source restricted to GPS — compass agreement on
                // grid orientation alone is too weak to block Nominatim.
                const headingConfirmedSnap = hasEffectiveHeading && effectiveHeadingSource === 'gps' && (
                  (snapOrientation === 'N-S' && isHeadingNorthSouth(effectiveHeading)) ||
                  (snapOrientation === 'E-W' && !isHeadingNorthSouth(effectiveHeading))
                );

                // Was this snap from the extended heading search (far away, heading-driven)?
                // If so, Nominatim disagreeing is strong evidence the heading was stale.
                // Extended search snaps are 30-150m away — much weaker than a close initial snap.
                //
                // BUT: when the heading source is COMPASS (fresh magnetometer reading at
                // park time), a far snap is still trustworthy — compass isn't susceptible
                // to the "stale-after-turn" failure mode that makes GPS heading drive
                // extended searches to wrong streets. So we only treat "far snap" as
                // extended when GPS heading was the driver.
                const snapWasExtended = snapResult.snapSource?.includes('heading_extended') ||
                  (snapResult.snapDistanceMeters > 25 && effectiveHeadingSource !== 'compass');

                if (nominatimMatchesCandidate && !drivingHeadingContradictsNominatim && nominatimCandidate) {
                  // Two independent geometric signals agree: PostGIS snap saw
                  // this street as a candidate AND OSM identified it from the
                  // raw GPS. No driving heading contradicts. Override regardless
                  // of compass agreement on grid orientation.
                  //
                  // Adopt the matching candidate's full geometry (snap coords,
                  // address ranges, parity) so downstream segment interpolation
                  // produces a position-aware house number. Without this, the
                  // override dropped address-range fields and forced Nominatim's
                  // block-start reverse-geocode (the "4755 at ~4715" failure).
                  const adopted = await adoptCandidateAsSnap(nominatimCandidate, 'nominatim_override_candidate_match');
                  console.log(
                    `[check-parking] Nominatim cross-reference: ${nominatimResult.street_name} (${nominatimOrientation}) ` +
                    `is in snap candidate set and no driving heading contradicts — ` +
                    `overriding snap winner ${snapResult.streetName} (${snapOrientation}). ` +
                    `Adopted candidate geometry → interpolated ${adopted.snapResult.interpolatedNumber ?? 'n/a'}.`
                  );
                  diag.nominatim_street = nominatimResult.street_name;
                  diag.nominatim_orientation = nominatimOrientation;
                  diag.nominatim_agreed = false;
                  diag.nominatim_overrode = true;
                  diag.heading_confirmed_snap = false;
                  checkLat = adopted.snappedLat;
                  checkLng = adopted.snappedLng;
                  snapResult = adopted.snapResult;
                  if (adopted.userSide) userSideFromGps = adopted.userSide;
                  if (hasHeading && !hasCompass) {
                    console.log(`[check-parking] Discarding GPS heading ${headingDeg.toFixed(0)}° — Nominatim candidate-match override`);
                    hasHeading = false;
                  }
                } else if (headingConfirmedSnap && !snapWasExtended) {
                  // Close snap + heading agree, Nominatim disagrees.
                  // This is likely walk-away drift: the raw GPS point has moved toward
                  // a cross street, making Nominatim identify the wrong road.
                  // Trust close snap + heading over Nominatim.
                  console.log(
                    `[check-parking] Nominatim cross-reference: snap says ${snapResult.streetName} (${snapOrientation}), ` +
                    `Nominatim says ${nominatimResult.street_name} (${nominatimOrientation}). ` +
                    `BUT heading ${effectiveHeading.toFixed(0)}° confirms close snap (${snapResult.snapDistanceMeters?.toFixed(1)}m) — ` +
                    `keeping snap (likely walk-away drift on raw GPS).`
                  );
                  diag.nominatim_street = nominatimResult.street_name;
                  diag.nominatim_orientation = nominatimOrientation;
                  diag.nominatim_agreed = false;
                  diag.nominatim_overrode = false;
                  diag.heading_confirmed_snap = true;
                  // Keep snapResult as-is — don't override
                } else if (headingConfirmedSnap && snapWasExtended) {
                  // Extended/far snap + heading agree, but Nominatim disagrees.
                  // The heading likely drove the extended search to the WRONG street
                  // (stale heading from before a turn). Nominatim is more reliable here.
                  //
                  // Try to recover full geometry via a 200m PostGIS lookup on
                  // the Nominatim-identified street so interpolation still runs.
                  const wideCandidate = nominatimCandidate ?? await findCenterlineSegmentByName(nominatimResult.street_name);
                  const adopted = wideCandidate ? await adoptCandidateAsSnap(wideCandidate, 'nominatim_override_extended') : null;
                  console.log(
                    `[check-parking] Nominatim cross-reference: extended snap says ${snapResult.streetName} (${snapOrientation}, ${snapResult.snapDistanceMeters?.toFixed(1)}m), ` +
                    `Nominatim says ${nominatimResult.street_name} (${nominatimOrientation}). ` +
                    `Heading ${effectiveHeading.toFixed(0)}° confirmed snap but snap was far/extended — ` +
                    `preferring Nominatim (heading likely stale after turn).${adopted ? ` Adopted geometry → interpolated ${adopted.snapResult.interpolatedNumber ?? 'n/a'}.` : ' No matching centerline segment within 150m.'}`
                  );
                  diag.nominatim_street = nominatimResult.street_name;
                  diag.nominatim_orientation = nominatimOrientation;
                  diag.nominatim_agreed = false;
                  diag.nominatim_overrode = true;
                  diag.heading_confirmed_snap = false;
                  if (adopted) {
                    checkLat = adopted.snappedLat;
                    checkLng = adopted.snappedLng;
                    snapResult = adopted.snapResult;
                    if (adopted.userSide) userSideFromGps = adopted.userSide;
                  } else {
                    checkLat = latitude;
                    checkLng = longitude;
                    snapResult = {
                      wasSnapped: false,
                      snapDistanceMeters: 0,
                      streetName: nominatimResult.street_name,
                      snapSource: 'nominatim_override_extended',
                    };
                  }
                  if (hasHeading && !hasCompass) {
                    console.log(`[check-parking] Discarding GPS heading ${headingDeg.toFixed(0)}° — stale (extended snap overridden)`);
                    hasHeading = false;
                  }
                } else {
                  // Try to recover full geometry via a 200m PostGIS lookup so
                  // interpolation still runs. Without this, Nominatim's direct
                  // reverse-geocode produces the block-start house number
                  // ("4755" when the user is actually ~4715 on the 4700 block).
                  const wideCandidate = nominatimCandidate ?? await findCenterlineSegmentByName(nominatimResult.street_name);
                  const adopted = wideCandidate ? await adoptCandidateAsSnap(wideCandidate, 'nominatim_override') : null;
                  console.log(
                    `[check-parking] Nominatim cross-reference: snap says ${snapResult.streetName} (${snapOrientation}), Nominatim says ${nominatimResult.street_name} (${nominatimOrientation}). Heading does NOT confirm snap — preferring Nominatim.${adopted ? ` Adopted geometry → interpolated ${adopted.snapResult.interpolatedNumber ?? 'n/a'}.` : ' No matching centerline segment within 150m.'}`
                  );
                  diag.nominatim_street = nominatimResult.street_name;
                  diag.nominatim_orientation = nominatimOrientation;
                  diag.nominatim_agreed = false;
                  diag.nominatim_overrode = true;
                  diag.heading_confirmed_snap = false;
                  if (adopted) {
                    checkLat = adopted.snappedLat;
                    checkLng = adopted.snappedLng;
                    snapResult = adopted.snapResult;
                    if (adopted.userSide) userSideFromGps = adopted.userSide;
                  } else {
                    // Use original coords (not snapped) since Nominatim identified a different street.
                    checkLat = latitude;
                    checkLng = longitude;
                    snapResult = {
                      wasSnapped: false,
                      snapDistanceMeters: 0,
                      streetName: nominatimResult.street_name,
                      snapSource: 'nominatim_override',
                      // No streetBearing — snap was for a different street
                    };
                  }
                  // GPS heading is provably stale — discard it. But compass heading
                  // is fresh (captured at park time), so keep it.
                  if (hasHeading && !hasCompass) {
                    console.log(`[check-parking] Discarding GPS heading ${headingDeg.toFixed(0)}° — stale after Nominatim override`);
                    hasHeading = false;
                  } else if (hasHeading && hasCompass) {
                    console.log(`[check-parking] Nominatim override but keeping compass heading ${compassHeadingDeg.toFixed(0)}° (fresh)`);
                  }
                }
              } else if (snapOrientation && nominatimOrientation) {
                console.log(`[check-parking] Nominatim cross-reference confirms snap: both say ${snapOrientation} orientation (snap=${snapResult.streetName}, nominatim=${nominatimResult.street_name})`);
                diag.nominatim_street = nominatimResult.street_name;
                diag.nominatim_orientation = nominatimOrientation;
                diag.nominatim_agreed = true;
                diag.nominatim_overrode = false;
              } else {
                console.log(`[check-parking] Nominatim cross-reference: could not determine orientation (snap=${snapResult.streetName}/${snapOrientation}, nominatim=${nominatimResult.street_name}/${nominatimOrientation})`);
              }
            }
          } catch (nomErr) {
            console.warn('[check-parking] Nominatim cross-reference failed (non-fatal):', nomErr);
          }
        }

        // --- Mapbox Reverse Geocoding (Geocoding v6) ---
        // Single-point reverse lookup at the parking spot. Replaces the
        // map-matching block below as the primary Mapbox signal because
        // map-matching expects a moving trajectory and returns matched=true /
        // confidence=0 / street="" for stationary parked-car traces (verified
        // from rows 48/50/55 on 2026-04-23..24).
        //
        // Used here as a third independent voice next to snap and Nominatim:
        //   * Mapbox-reverse agrees with snap → record agreement only
        //   * Mapbox-reverse agrees with Nominatim against snap → CONFIRM
        //     a Nominatim override (mark `confirmed_by_mapbox: true`); we do
        //     not flip override direction on Mapbox alone, so this only
        //     strengthens existing two-of-three calls.
        try {
          const { mapboxReverseGeocode } = await import('../../../lib/mapbox-reverse-geocode');
          const mbRev = await mapboxReverseGeocode(latitude, longitude);
          if (!diag.native_meta) diag.native_meta = {};
          const normalize = (s: string) => s.toLowerCase()
            .replace(/\b(north|south|east|west|n|s|e|w|ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane)\b/g, '')
            .replace(/[^a-z]+/g, ' ')
            .trim();
          const snapNorm = snapResult ? normalize(snapResult.streetName) : '';
          const nomNorm = diag.nominatim_street ? normalize(diag.nominatim_street as string) : '';
          const mbNorm = mbRev.streetName ? normalize(mbRev.streetName) : '';

          const agreesWithSnap = !!mbNorm && !!snapNorm && mbNorm === snapNorm;
          const agreesWithNominatim = !!mbNorm && !!nomNorm && mbNorm === nomNorm;

          diag.native_meta.mapbox_reverse = {
            matched: mbRev.matched,
            street: mbRev.streetName,
            house_number: mbRev.houseNumber,
            full_address: mbRev.fullAddress,
            feature_type: mbRev.featureType,
            match_confidence: mbRev.matchConfidence,
            skip_reason: mbRev.skipReason ?? null,
            agrees_with_snap: agreesWithSnap,
            agrees_with_nominatim: agreesWithNominatim,
          };

          if (mbRev.matched && mbNorm) {
            console.log(
              `[check-parking] Mapbox reverse: ${mbRev.streetName}` +
              `${mbRev.houseNumber ? ` ${mbRev.houseNumber}` : ''}` +
              ` (${mbRev.matchConfidence ?? 'no-confidence'}, ${mbRev.featureType ?? 'no-type'})` +
              ` — snap=${snapResult?.streetName ?? 'none'}` +
              `${diag.nominatim_street ? `, nominatim=${diag.nominatim_street}` : ''}` +
              ` — agrees_snap=${agreesWithSnap}, agrees_nominatim=${agreesWithNominatim}`
            );
          } else {
            console.log(`[check-parking] Mapbox reverse: skipped (${mbRev.skipReason ?? 'unknown'})`);
          }

          // Confirm an existing Nominatim override when Mapbox-reverse agrees
          // with Nominatim against snap. We do NOT flip override here; this is
          // a strengthening signal recorded for future analysis.
          if (
            diag.nominatim_overrode === true &&
            agreesWithNominatim &&
            !agreesWithSnap
          ) {
            diag.native_meta.mapbox_reverse.confirmed_nominatim_override = true;
            console.log('[check-parking] Mapbox reverse CONFIRMS Nominatim override (2-of-3 against snap).');
          }

          // Capture Mapbox-reverse house number for use as a fallback
          // address-number source. Three guards:
          //   1. Real address feature (not a "street" or "block" centerline) —
          //      Mapbox returns address_number only on interpolated address
          //      features.
          //   2. House number is a valid positive integer.
          //   3. Mapbox-reverse street agrees with snap's POST-OVERRIDE winner
          //      (snapResult.streetName by this point). This avoids borrowing
          //      a number from the wrong street when snap and mapbox-reverse
          //      disagree.
          if (
            mbRev.matched &&
            mbRev.featureType === 'address' &&
            mbRev.houseNumber &&
            agreesWithSnap
          ) {
            const parsed = Number.parseInt(mbRev.houseNumber, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              mapboxReverseAddressNumber = parsed;
              console.log(`[check-parking] Captured Mapbox-reverse address number ${parsed} on ${mbRev.streetName} (agrees with snap winner ${snapResult?.streetName ?? 'none'}).`);
            }
          }
        } catch (mbRevErr) {
          console.warn('[check-parking] Mapbox reverse-geocode failed (non-fatal):', mbRevErr);
        }

        // --- Mapbox Map Matching (TRAJECTORY DISAMBIGUATION) ---
        // Demoted from PRIMARY: real-world data (rows 48/50/55) shows that
        // map-matching returns matched=true with empty street name and
        // confidence ≈ 0 for our typical parking traces. The Geocoding v6
        // reverse-lookup block above is now the primary Mapbox signal.
        // Map-matching stays for rare cases where the trajectory is genuinely
        // a long moving drive ending at the stop and the confidence threshold
        // can fire — keeping the promote path lets that path activate when it
        // actually does work.
        //
        // Submit the driving trajectory to Mapbox so it can identify the road
        // segment the car was on at the parking spot using the whole path,
        // not just the stop point's distance to centerlines.
        //
        // When Mapbox returns a confident match, we trust it as the
        // authoritative street. If Mapbox's street is also a snap candidate,
        // we adopt that candidate's PostGIS geometry so address interpolation
        // (house number, side-of-street parity) keeps working. Otherwise we
        // fall back to raw GPS + Mapbox street name and let the unified
        // parking checker reverse-geocode for the house number.
        //
        // Skipped silently when MAPBOX_ACCESS_TOKEN is not configured —
        // existing snap + Nominatim path remains the fallback.
        try {
          const { mapMatchTrajectory } = await import('../../../lib/mapbox-map-matching');

          // TIDIED TRAJECTORY: Mapbox map-matching identifies "what road
          // is the FINAL point on?" much more reliably when given only
          // the post-final-turn segment than when given a 90-fix path
          // that crossed multiple roads. Walk back from the most recent
          // fix while heading deltas stay within 30°; stop at the first
          // jump (the final turn). Send only the post-turn run + the
          // parking point. This is the same algorithm used for trajectory
          // voting against PostGIS centerlines.
          //
          // For Webster→Fremont kind of failures: pre-tidied, 90 fixes
          // mostly on Webster + 5 on Fremont let Mapbox match-match the
          // trajectory to Webster (where the bulk of points are). Tidied,
          // only the 5 Fremont fixes + parking point go in — Mapbox
          // unambiguously matches Fremont.
          let postTurnIdx = 0;
          for (let i = driveTrajectory.length - 1; i > 0; i--) {
            const curr = driveTrajectory[i];
            const prev = driveTrajectory[i - 1];
            if (curr[2] < 0 || prev[2] < 0) continue;
            const diff = Math.abs(curr[2] - prev[2]);
            const delta = Math.min(diff, 360 - diff);
            if (delta >= 30) { postTurnIdx = i; break; }
          }
          const tidiedTrajectory = driveTrajectory.slice(postTurnIdx);
          // Need at least 2 input points for Mapbox map-matching. If the
          // post-turn run is too short, fall through to the full trajectory.
          const inputTrajectory = tidiedTrajectory.length >= 2 ? tidiedTrajectory : driveTrajectory;
          if (postTurnIdx > 0) {
            console.log(`[check-parking] Mapbox tidied trajectory: using ${tidiedTrajectory.length}/${driveTrajectory.length} post-turn fixes (turn at index ${postTurnIdx}).`);
          }
          const fixes: Array<{ lat: number; lng: number; accuracyMeters?: number }> =
            inputTrajectory.map((p) => ({ lat: p[0], lng: p[1] }));
          // Append the actual parking location as the final point so Mapbox
          // identifies the road at the stop, not just the approach.
          fixes.push({ lat: latitude, lng: longitude, accuracyMeters: accuracyMeters });
          const mapboxResult = await mapMatchTrajectory(fixes);
          if (!diag.native_meta) diag.native_meta = {};
          diag.native_meta.mapbox = {
            matched: mapboxResult.matched,
            street: mapboxResult.finalStreetName,
            confidence: mapboxResult.confidence,
            matched_count: mapboxResult.matchedPointCount,
            input_count: mapboxResult.inputPointCount,
            skip_reason: mapboxResult.skipReason ?? null,
            // Pin the pre-Mapbox winners so we can audit overrides.
            pre_snap_winner: snapResult?.streetName ?? null,
            pre_nominatim_winner: diag.nominatim_street ?? null,
            promoted: false,
          };

          const MAPBOX_CONFIDENCE_THRESHOLD = 0.5;
          const confident = mapboxResult.matched
            && mapboxResult.finalStreetName != null
            && (mapboxResult.confidence ?? 0) >= MAPBOX_CONFIDENCE_THRESHOLD;

          if (confident) {
            // Normalize street names for matching against snap candidates.
            // Mapbox returns "North Wolcott Avenue"; PostGIS returns "N WOLCOTT AVE".
            const normalize = (s: string) => s.toLowerCase()
              .replace(/\b(north|south|east|west|n|s|e|w|ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane)\b/g, '')
              .replace(/[^a-z]+/g, ' ')
              .trim();
            const mbNorm = normalize(mapboxResult.finalStreetName!);

            // Try to find the matching snap candidate so we can keep address
            // interpolation, parity, and side-of-street logic working.
            const mapboxCandidate = allCandidates.find((c: any) =>
              normalize(c.street_name) === mbNorm
            );

            const previousStreet = snapResult?.streetName;

            if (mapboxCandidate) {
              // Re-snap to the Mapbox-identified candidate and run address
              // interpolation via the shared helper (so rule-match house
              // numbers are position-aware, not block-start from reverse-geocode).
              const adopted = await adoptCandidateAsSnap(mapboxCandidate, 'mapbox_match_candidate');
              checkLat = adopted.snappedLat;
              checkLng = adopted.snappedLng;
              snapResult = adopted.snapResult;
              if (adopted.userSide) userSideFromGps = adopted.userSide;
              console.log(`[check-parking] Mapbox PROMOTED: ${mapboxCandidate.street_name} (confidence=${mapboxResult.confidence?.toFixed(2)}, matched ${mapboxResult.matchedPointCount}/${mapboxResult.inputPointCount}). Was: ${previousStreet ?? 'none'}. Interpolated ${adopted.snapResult.interpolatedNumber ?? 'n/a'}.`);
              diag.native_meta.mapbox.promoted = true;
              diag.native_meta.mapbox.promoted_via = 'snap_candidate';
              diag.snap_street_name = mapboxCandidate.street_name;
              diag.snap_distance_meters = mapboxCandidate.snap_distance_meters;
              diag.snap_source = 'mapbox_match_candidate';
            } else {
              // Mapbox picked a street outside our candidate set. Trust it
              // anyway — Mapbox sees roads our 80m PostGIS search may have
              // missed (or has fresher OSM data). Use Mapbox's snapped point
              // so the downstream reverse-geocode lands on the right block.
              checkLat = mapboxResult.finalSnappedLat ?? latitude;
              checkLng = mapboxResult.finalSnappedLng ?? longitude;
              snapResult = {
                wasSnapped: false,
                snapDistanceMeters: 0,
                streetName: mapboxResult.finalStreetName!,
                snapSource: 'mapbox_match_off_grid',
              };
              console.log(`[check-parking] Mapbox PROMOTED (off-grid): ${mapboxResult.finalStreetName} (confidence=${mapboxResult.confidence?.toFixed(2)}). Was: ${previousStreet ?? 'none'}. No matching snap candidate — using Mapbox snapped coords.`);
              diag.native_meta.mapbox.promoted = true;
              diag.native_meta.mapbox.promoted_via = 'off_grid';
              diag.snap_street_name = mapboxResult.finalStreetName;
              diag.snap_source = 'mapbox_match_off_grid';
            }
          } else if (mapboxResult.matched) {
            console.log(`[check-parking] Mapbox match too weak to promote: ${mapboxResult.finalStreetName} (confidence=${mapboxResult.confidence?.toFixed(2)} < ${MAPBOX_CONFIDENCE_THRESHOLD}). Keeping snap winner ${snapResult?.streetName ?? 'none'}.`);
          } else if (mapboxResult.skipReason && mapboxResult.skipReason !== 'no_token') {
            console.log(`[check-parking] Mapbox map-match: no match (${mapboxResult.skipReason}, ${mapboxResult.inputPointCount} input points). Keeping snap winner ${snapResult?.streetName ?? 'none'}.`);
          }
        } catch (mbErr) {
          console.warn('[check-parking] Mapbox map-matching failed (non-fatal):', mbErr);
        }

      } catch (snapErr) {
        // Snap is optional - log and continue with original coordinates
        console.warn('[check-parking] Snap-to-street failed (non-fatal):', snapErr);
      }
    }

    // Step 2: Check all parking restrictions using (possibly snapped) coordinates.
    // The unified checker does ONE reverse geocode (Nominatim-first + grid estimation).
    // We then pass the parsed address to the metered parking checker so it uses the
    // SAME street identification — eliminating the dual-geocoder bug where Google and
    // Nominatim disagreed on which street the user was on.
    // Build snap geometry for side-of-street parity forcing.
    // The grid estimator uses this to determine which side of the street centerline
    // the raw GPS point is on, preventing the ±1 rounding that flips odd↔even.
    const snapGeometry: SnapGeometry | null = (snapResult?.wasSnapped && snapResult.streetBearing != null && snapResult.streetBearing >= 0)
      ? { snappedLat: checkLat, snappedLng: checkLng, streetBearing: snapResult.streetBearing }
      : null;

    // Step 1.9: Run the building-footprint lookup BEFORE the unified checker so
    // we can pass the authoritative house number into it. Permit zone and
    // address-range queries inside unified-parking-checker must use the right
    // number — otherwise a grid-estimator miss (e.g., 2070 W Ainslie instead of
    // Randy's actual 1901) falls outside every permit zone's range and silently
    // suppresses legitimate permit alerts.
    let buildingFootprintResult: any = null;
    let expectedParity: 'O' | 'E' | null = null;
    if (userSideFromGps === 'L' && snapResult?.lParity) {
      expectedParity = (snapResult.lParity === 'E' ? 'E' : 'O');
    } else if (userSideFromGps === 'R' && snapResult?.rParity) {
      expectedParity = (snapResult.rParity === 'E' ? 'E' : 'O');
    }

    if (snapResult?.streetName && supabaseAdmin) {
      try {
        // 50m radius covers corner parking on blocks where the nearest
        // registered Chicago building footprint is set back from the curb
        // (e.g., DePaul-area Lakewood: closest building 75m away; Belden +
        // Kenmore: 31m). 25m was too tight in those cases — the lookup
        // returned nothing and we fell through to grid math. The parity
        // constraint still prevents wrong-side hits when we know the user's
        // side; without parity we still get the closest match on the
        // resolved street so the address lands on the right block.
        // Convert street name to centerline format ("West Belden Avenue" →
        // "W BELDEN AVE") so the SQL-side strict equality matches the row
        // format stored in chicago_building_addresses.
        const expectedStreetCenterlineFmt = toCenterlineFormat(snapResult.streetName);
        const { data: bld, error: bldErr } = await supabaseAdmin.rpc('nearest_address_point', {
          user_lat: latitude,
          user_lng: longitude,
          search_radius_meters: 50,
          expected_street: expectedStreetCenterlineFmt,
          expected_parity: expectedParity,
        });
        if (!bldErr && bld && bld.length > 0 && bld[0].house_number > 0) {
          buildingFootprintResult = bld[0];
          if (expectedParity) {
            console.log(`[check-parking] Building lookup (parity-constrained to ${expectedParity}, user on ${userSideFromGps} side): ${bld[0].house_number} ${bld[0].full_street_name} (${bld[0].distance_meters.toFixed(1)}m)`);
          } else {
            console.log(`[check-parking] Building lookup (no parity constraint — insufficient GPS offset or missing parity data): ${bld[0].house_number} ${bld[0].full_street_name} (${bld[0].distance_meters.toFixed(1)}m)`);
          }
        } else if (expectedParity) {
          console.log(`[check-parking] Building lookup: no ${expectedParity}-parity building within 50m on ${snapResult.streetName} — will fall back to segment interpolation`);
        }
      } catch (bldErr) {
        console.warn('[check-parking] Building footprint lookup failed (non-fatal):', bldErr);
      }
    }

    // Split "rule-match number" from "display number":
    //
    // Rule-match number (for permit-zone / meter / block queries) prefers
    //   segment interpolation first. On clustered-address blocks (e.g., all
    //   buildings bunched at one end), the interpolated number reflects the
    //   user's ACTUAL physical position along the block more accurately than
    //   the nearest registered building's address — which matters for narrow
    //   sub-block meter ranges like Wolcott's 4804-4810 meter at Lawrence.
    //
    // Display number (what we show the user) prefers the building footprint.
    //   That's an address that really exists on a house/business the user can
    //   see. Builds trust, matches signage.
    //
    // When only one source is available, both fall through to that.
    //
    // Mapbox-reverse address number is the 3rd tier: only used when neither
    // building footprint nor segment interpolation produced a number. It is
    // a real interpolated address from Mapbox's address database — strictly
    // better than the grid estimator on blocks where the Chicago grid math
    // diverges from the actual numbering (e.g., Lincoln Park's Belden where
    // the longitude→address scale runs ~100 numbers off).
    const ruleMatchNumber: number | null =
      snapResult?.interpolatedNumber ??
      buildingFootprintResult?.house_number ??
      mapboxReverseAddressNumber ??
      null;
    const displayNumber: number | null =
      buildingFootprintResult?.house_number ??
      snapResult?.interpolatedNumber ??
      mapboxReverseAddressNumber ??
      null;

    // Look up the snapped street's class (1=expressway, 2=arterial, 3=collector,
    // 4=residential). Drives adaptive spatial radius inside the unified checker.
    let snapStreetClass: string | null = null;
    if (snapResult?.streetName && supabaseAdmin) {
      try {
        const { data: cls } = await supabaseAdmin
          .from('street_centerlines')
          .select('class')
          .eq('street_name', snapResult.streetName)
          .not('class', 'is', null)
          .limit(1)
          .maybeSingle();
        snapStreetClass = cls?.class ?? null;
      } catch (e) {
        // non-fatal
      }
    }

    // NOW run the unified checker with the RULE-MATCH number + street class.
    // Display number override happens AFTER, on the final address string only.
    //
    // disableGridEstimate fires when the snap pipeline produced a streetName
    // via Nominatim/Mapbox override but couldn't recover real centerline
    // geometry (snapResult.wasSnapped === false). In that case the GPS point
    // may not actually be on the chosen street — grid math anchored on the
    // wrong-street position invents fake house numbers (Lawrence regression
    // 2026-04-25: 2030 W Lawrence at coords that segment-interpolate to 1866
    // when the real Lawrence centerline is found).
    const overrideWithoutGeometry = !!snapResult && snapResult.wasSnapped === false && !!snapResult.streetName;
    const result = await checkAllParkingRestrictions(
      checkLat, checkLng, snapResult?.streetName || undefined,
      snapGeometry, latitude, longitude,
      ruleMatchNumber,
      snapStreetClass,
      overrideWithoutGeometry,
    );

    // Step 2b: Metered parking check uses the shared parsed address from step 2.
    // Now uses the corrected number so meters on the right block + side are found.
    const meteredParkingResult = await checkMeteredParking(
      checkLat,
      checkLng,
      result.location.parsedAddress,  // Pass shared address — no second geocode call
      hasEffectiveHeading ? effectiveHeading : undefined,
      snapResult
        ? {
            isOneWay: !!snapResult.onewayDir,
            // Building-footprint numbers come from Chicago's registered address
            // file — the house's physical location + parity are ground truth.
            // Tell the side-detection logic to prefer parity over heading in
            // that case, since heading can fail (U-turns, cross-street approach).
            numberIsHighConfidence: !!buildingFootprintResult,
          }
        : undefined,
    );

    // Step 3: Compute enforcement risk score from FOIA ticket data.
    // Uses the parsed address (street number + direction + name) to look up
    // block-level enforcement profiles and combine with citywide hour/dow baselines.
    let enforcementRisk: EnforcementRisk | undefined;
    if (result.location.parsedAddress && supabaseAdmin) {
      try {
        const chicagoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const currentHour = chicagoNow.getHours();
        const currentDow = chicagoNow.getDay(); // 0=Sun matches Postgres DOW

        const { data: riskData, error: riskError } = await supabaseAdmin.rpc(
          'compute_parking_risk',
          {
            p_street_number: String(result.location.parsedAddress.number),
            p_street_direction: result.location.parsedAddress.direction || '',
            p_street_name: result.location.parsedAddress.name || '',
            p_current_hour: currentHour,
            p_current_dow: currentDow,
          }
        );

        if (!riskError && riskData) {
          enforcementRisk = riskData as EnforcementRisk;
        }
      } catch (riskErr) {
        // Risk scoring is non-critical — log and continue
        console.warn('[check-parking] Risk scoring failed (non-fatal):', riskErr);
      }
    }

    // Step 4: Enrich with block_enforcement_stats (revenue, violation breakdown)
    // from the FOIA ticket data aggregation table (645K tickets, ~40K blocks)
    // Note: FOIA data stores street_name as "ARCHER AVE" (name + type), while
    // the address parser separates them (name="ARCHER", type="AVE"). We must
    // concatenate name + type for the lookup, with a fallback to name-only.
    if (result.location.parsedAddress && supabaseAdmin) {
      try {
        const addr = result.location.parsedAddress;
        const streetNum = String(addr.number);
        const blockNum = Math.floor(parseInt(streetNum) / 100) * 100;
        const direction = (addr.direction || '').toUpperCase().trim();
        const namePart = (addr.name || '').toUpperCase().trim();
        const typePart = (addr.type || '').toUpperCase().trim();
        // FOIA data format: "ARCHER AVE", so combine name + type
        const streetNameWithType = typePart ? `${namePart} ${typePart}` : namePart;

        // Try with type first (most FOIA records include it)
        let { data: blockData, error: blockError } = await supabaseAdmin
          .from('block_enforcement_stats')
          .select('estimated_revenue, total_tickets, city_rank, peak_hour_start, peak_hour_end, top_violation_code, top_violation_pct, year_range, violation_breakdown')
          .eq('block_number', blockNum)
          .eq('street_direction', direction)
          .eq('street_name', streetNameWithType)
          .limit(1)
          .maybeSingle();

        // Fallback: try without type (some addresses like "53RD" don't have a type)
        if (!blockData && !blockError && typePart && namePart !== streetNameWithType) {
          const fallback = await supabaseAdmin
            .from('block_enforcement_stats')
            .select('estimated_revenue, total_tickets, city_rank, peak_hour_start, peak_hour_end, top_violation_code, top_violation_pct, year_range, violation_breakdown')
            .eq('block_number', blockNum)
            .eq('street_direction', direction)
            .eq('street_name', namePart)
            .limit(1)
            .maybeSingle();
          blockData = fallback.data;
          blockError = fallback.error;
        }

        if (!blockError && blockData) {
          // Merge block stats into enforcementRisk (create if needed)
          if (!enforcementRisk) {
            enforcementRisk = {
              risk_score: 0,
              urgency: 'low',
              has_block_data: true,
              block_address: `${blockNum} ${direction} ${streetNameWithType}`.trim(),
              insight: '',
            };
          }
          enforcementRisk.estimated_block_revenue = blockData.estimated_revenue;
          enforcementRisk.data_year_range = blockData.year_range;

          // Override ticket count and rank with FOIA data if available
          if (blockData.total_tickets) {
            enforcementRisk.total_block_tickets = blockData.total_tickets;
            enforcementRisk.has_block_data = true;
          }
          if (blockData.city_rank) {
            enforcementRisk.city_rank = blockData.city_rank;
          }

          console.log(`[check-parking] Block stats: ${blockNum} ${direction} ${streetNameWithType} — $${blockData.estimated_revenue?.toLocaleString()} (${blockData.total_tickets} tickets, rank #${blockData.city_rank})`);
        }
      } catch (blockErr) {
        // Block stats are non-critical
        console.warn('[check-parking] Block stats lookup failed (non-fatal):', blockErr);
      }
    }

    // Address-number precedence for the DISPLAY string, best → fallback:
    //   1. Building footprint (already queried at Step 2a)
    //   2. Block-aware segment interpolation (already computed on snapResult)
    //   3. Mapbox Geocoding v6 reverse address feature (captured above)
    //   4. unified-parking-checker's address (grid estimator / Nominatim)
    let finalAddress = result.location.address;
    let addressNumberSource: 'building_footprint' | 'segment_interpolation' | 'mapbox_reverse_address' | 'fallback' = 'fallback';
    if (buildingFootprintResult) {
      const b = buildingFootprintResult;
      const zipMatch = (result.location.address || '').match(/\b(\d{5})\b/);
      const zip = zipMatch ? ` ${zipMatch[1]}` : '';
      finalAddress = `${b.house_number} ${b.full_street_name}, Chicago, IL${zip}`;
      addressNumberSource = 'building_footprint';
      console.log(`[check-parking] Display address from building footprint: ${finalAddress} (${b.distance_meters.toFixed(1)}m to building centroid)`);
    } else if (snapResult?.interpolatedNumber && result.location.streetName) {
      const streetForDisplay = result.location.streetName;
      const zipMatch = (result.location.address || '').match(/\b(\d{5})\b/);
      const zip = zipMatch ? ` ${zipMatch[1]}` : '';
      finalAddress = `${snapResult.interpolatedNumber} ${streetForDisplay}, Chicago, IL${zip}`;
      addressNumberSource = 'segment_interpolation';
      console.log(`[check-parking] Display address from block-aware interpolation: ${finalAddress}`);
    } else if (mapboxReverseAddressNumber != null && result.location.streetName) {
      // Mapbox returned a real interpolated address feature on the same
      // street as the resolved snap winner. Strictly better than the grid
      // estimator's longitude/latitude math on blocks where the Chicago
      // grid scale is off (Lincoln Park, parts of the South Side).
      const streetForDisplay = result.location.streetName;
      const zipMatch = (result.location.address || '').match(/\b(\d{5})\b/);
      const zip = zipMatch ? ` ${zipMatch[1]}` : '';
      finalAddress = `${mapboxReverseAddressNumber} ${streetForDisplay}, Chicago, IL${zip}`;
      addressNumberSource = 'mapbox_reverse_address';
      console.log(`[check-parking] Display address from Mapbox-reverse: ${finalAddress} (no building footprint or segment interpolation available).`);
    }
    // Log which source we ended up using for the house number + side-detection.
    const nm: Record<string, any> = diag.native_meta || {};
    nm.address_number_source = addressNumberSource;        // display source
    nm.display_number = displayNumber;                      // shown to user
    nm.rule_match_number = ruleMatchNumber;                 // used for permit/meter/block queries
    nm.user_side_from_gps = userSideFromGps;                // 'L' | 'R' | null
    nm.expected_parity = expectedParity;                    // 'O' | 'E' | null
    nm.snap_oneway_dir = snapResult?.onewayDir || null;
    nm.snap_l_parity = snapResult?.lParity || null;
    nm.snap_r_parity = snapResult?.rParity || null;
    nm.building_constrained_match = buildingFootprintResult ? (expectedParity ? 'parity_constrained' : 'no_parity_constraint') : 'no_building_in_range';
    nm.display_and_rule_match_numbers_differ = (displayNumber != null && ruleMatchNumber != null && displayNumber !== ruleMatchNumber);
    if (snapResult?.interpolatedNumber) {
      nm.interpolated_number = snapResult.interpolatedNumber;
      nm.segment_fraction = snapResult.segmentFraction;
      nm.segment_l_range = snapResult.lFromAddr != null ? [snapResult.lFromAddr, snapResult.lToAddr] : null;
      nm.segment_r_range = snapResult.rFromAddr != null ? [snapResult.rFromAddr, snapResult.rToAddr] : null;
      nm.grid_estimator_address = result.location.address;
    }
    diag.native_meta = nm;

    // ── Address-confidence score ──
    // Combine independent signals into a 0-100 confidence. Mobile UI can
    // surface a "Verify this" prompt when low. Each factor is additive,
    // capped at 100. Rationale per factor in the comment.
    let addressConfidence = 0;
    const confidenceReasons: string[] = [];
    if (diag.locked_by_user_anchor) {
      // User has previously confirmed/corrected this exact spot — strongest signal we have.
      addressConfidence += 60;
      confidenceReasons.push('user-anchor');
    }
    if (diag.locked_by_close_snap) {
      // Close snap (≤15m) AND Nominatim agree on the same street.
      addressConfidence += 50;
      confidenceReasons.push('close-snap+nominatim-agree');
    }
    if (snapResult?.wasSnapped) {
      const d = snapResult.snapDistanceMeters ?? 999;
      if (d <= 5)        { addressConfidence += 30; confidenceReasons.push('snap≤5m'); }
      else if (d <= 10)  { addressConfidence += 22; confidenceReasons.push('snap≤10m'); }
      else if (d <= 15)  { addressConfidence += 15; confidenceReasons.push('snap≤15m'); }
      else if (d <= 25)  { addressConfidence += 8;  confidenceReasons.push('snap≤25m'); }
      else               { addressConfidence += 2;  confidenceReasons.push(`snap@${d.toFixed(0)}m`); }
    } else if (snapResult?.streetName) {
      // Override-without-geometry path — we have a street name but no centerline match.
      addressConfidence -= 25;
      confidenceReasons.push('override-no-geometry');
    } else {
      addressConfidence -= 10;
      confidenceReasons.push('no-snap');
    }
    if (diag.nominatim_agreed === true) {
      addressConfidence += 15;
      confidenceReasons.push('nominatim-agrees');
    } else if (diag.nominatim_overrode === true) {
      addressConfidence -= 5;
      confidenceReasons.push('nominatim-overrode');
    }
    if (diag.trajectory_confirmed === true) {
      addressConfidence += 15;
      confidenceReasons.push('trajectory-confirms');
    } else if (diag.trajectory_override === true) {
      addressConfidence += 5;
      confidenceReasons.push('trajectory-override');
    }
    if (diag.native_meta?.mapbox?.promoted === true) {
      addressConfidence += 15;
      confidenceReasons.push('mapbox-promoted');
    }
    if (diag.near_intersection === true) {
      addressConfidence -= 10;
      confidenceReasons.push('intersection-ambiguity');
    }
    if (typeof accuracyMeters === 'number' && accuracyMeters > 25) {
      addressConfidence -= 15;
      confidenceReasons.push(`gps-accuracy-${Math.round(accuracyMeters)}m`);
    }
    // CarPlay agreement bump: when the snap winner sits within 20m of where
    // CarPlay actually disconnected, we have two independent strong signals
    // agreeing on the location — the GPS at engine-off matches a real
    // centerline. Worth more than a generic accuracy bonus because it rules
    // out the post-park-walking-drift class of errors.
    if (carPlaySnapAnchorApplied && snapResult?.snapDistanceMeters != null && snapResult.snapDistanceMeters <= 20) {
      addressConfidence += 12;
      confidenceReasons.push('carplay-anchored');
    }
    // CarPlay-active-drive bump: when CarPlay was paired for the whole drive,
    // the trajectory is 100% in-vehicle by construction (no walking samples
    // could have entered). That makes the snap winner more trustworthy
    // independent of whether we used the disconnect coords as the snap
    // anchor (which only fires when disconnect drift is ≤ 100m). Smaller
    // than the anchor bonus because it's a weaker per-fix signal — but
    // still meaningful and additive.
    if (carPlayActiveDuringDrive) {
      addressConfidence += 4;
      confidenceReasons.push('carplay-active-drive');
    }
    addressConfidence = Math.max(0, Math.min(100, addressConfidence));
    diag.address_confidence = addressConfidence;
    diag.address_confidence_reasons = confidenceReasons;

    // Surface the runner-up candidates as one-tap correction options for the
    // mobile "Wrong street?" modal. Only emitted when there's genuine
    // ambiguity — a clear winner means we don't need to prompt the user.
    //
    // Threshold tuned against real Randy parkings: Lawrence/Wolcott at 1866
    // (11.5m vs 41.7m, ratio 3.6x) is a clear winner and stays empty;
    // Webster/Sheffield at 1075 (30.8m vs 38.4m, ratio 1.25x) is genuinely
    // close and surfaces Sheffield as an alternate. The +5m floor stops us
    // from spamming alternates when both candidates are very close (e.g.
    // 4m vs 7m at the same intersection).
    //
    // Uses the multi-block snap RPC (snap_to_nearest_street_with_blocks) so
    // wrong-block-of-Wolcott shows up as a tappable alternate, not just
    // wrong-street. Falls back to allCandidates (street-only) when the new
    // RPC isn't available — graceful degradation if migration not applied.
    const addressAlternates: NonNullable<MobileCheckParkingResponse['addressAlternates']> = [];
    try {
      let altCandidates: any[] = [];
      if (supabaseAdmin) {
        try {
          const { data: blockSnap, error: blockSnapErr } = await supabaseAdmin.rpc(
            'snap_to_nearest_street_with_blocks',
            {
              user_lat: correctedLat,
              user_lng: correctedLng,
              search_radius_meters: 80,
              max_per_street: 2,
              max_total: 8,
            }
          );
          if (!blockSnapErr && Array.isArray(blockSnap) && blockSnap.length > 0) {
            altCandidates = (blockSnap as any[]).filter((s: any) => s.was_snapped);
            diag.alternates_source = 'multi_block_rpc';
          } else if (blockSnapErr) {
            console.warn('[check-parking] snap_to_nearest_street_with_blocks failed (likely migration not yet applied), falling back to allCandidates:', blockSnapErr.message);
            diag.alternates_source = 'fallback_all_candidates';
          }
        } catch (e) {
          console.warn('[check-parking] snap_to_nearest_street_with_blocks call threw, falling back to allCandidates:', e);
          diag.alternates_source = 'fallback_all_candidates';
        }
      }
      if (altCandidates.length === 0) altCandidates = allCandidates;

      // Cross-source dedup: snap_to_nearest_street_with_blocks can return both
      // a street_centerlines row and a snow_route row for the same physical
      // block (e.g. W LAWRENCE AVE appearing twice — once with [1801-1837]
      // address range, once with NULL ranges from snow_routes). The original
      // snap_to_nearest_street collapsed these via DISTINCT ON. We replicate
      // that here without losing genuine multi-block diversity: when the same
      // street has both a ranged row and a no-range row very close to each
      // other (≤5m distance gap), drop the no-range one. Different BLOCKS of
      // the same street keep BOTH rows because they have different ranges.
      altCandidates = (() => {
        const out: any[] = [];
        for (const c of altCandidates) {
          if (c?.l_from_addr == null) {
            const sameNameRanged = out.find((o) =>
              normChicagoStreet(o?.street_name || '') === normChicagoStreet(c?.street_name || '')
              && o?.l_from_addr != null
              && Math.abs((o?.snap_distance_meters ?? 0) - (c?.snap_distance_meters ?? 0)) <= 5
            );
            if (sameNameRanged) continue;
          }
          out.push(c);
        }
        return out;
      })();

      if (altCandidates.length >= 2) {
        const COMPETITIVE_RATIO = 1.5;
        const COMPETITIVE_FLOOR_M = 5;
        const COMPETITIVE_MAX_M = 50;
        const winnerName = normChicagoStreet(snapResult?.streetName || '');
        // Block-aware dedup key: same street + same address range = same block.
        // This lets us surface a DIFFERENT block of the same street as a
        // tappable alternate (the wrong-block-of-Wolcott case) while still
        // skipping the actual winning block we already returned.
        const blockKey = (c: any) =>
          `${normChicagoStreet(c?.street_name || '')}|${c?.l_from_addr ?? ''}|${c?.l_to_addr ?? ''}`;
        const winnerBlockKey = `${winnerName}|${snapResult?.lFromAddr ?? ''}|${snapResult?.lToAddr ?? ''}`;
        const winnerDist = altCandidates[0]?.snap_distance_meters ?? 0;
        for (const c of altCandidates) {
          if (addressAlternates.length >= 2) break;
          if (!c?.street_name) continue;
          if (blockKey(c) === winnerBlockKey) continue;
          const d = Number(c.snap_distance_meters);
          if (!Number.isFinite(d)) continue;
          if (d > COMPETITIVE_MAX_M) continue;
          if (d > winnerDist * COMPETITIVE_RATIO + COMPETITIVE_FLOOR_M) continue;

          // Block midpoint via segment_fraction + l/r ranges. Falls back to
          // street-name-only when address ranges aren't available (snow_route
          // candidates have NULL ranges).
          let approxNum: number | null = null;
          const frac = Number(c.segment_fraction);
          if (Number.isFinite(frac)) {
            const lFrom = c.l_from_addr, lTo = c.l_to_addr;
            const rFrom = c.r_from_addr, rTo = c.r_to_addr;
            const lMid = (lFrom != null && lTo != null) ? lFrom + Math.round((lTo - lFrom) * frac) : null;
            const rMid = (rFrom != null && rTo != null) ? rFrom + Math.round((rTo - rFrom) * frac) : null;
            if (lMid != null && rMid != null) approxNum = Math.round((lMid + rMid) / 2);
            else if (lMid != null) approxNum = lMid;
            else if (rMid != null) approxNum = rMid;
          }
          const cleanName = String(c.street_name).trim().replace(/\s+/g, ' ');
          const label = approxNum ? `${approxNum} ${cleanName}` : cleanName;
          const address = `${label}, Chicago, IL`;
          addressAlternates.push({
            label,
            address,
            streetName: cleanName,
            distanceM: Math.round(d * 10) / 10,
          });
        }
      }
    } catch (e) {
      console.warn('[check-parking] addressAlternates computation failed (non-fatal):', e);
    }
    if (addressAlternates.length > 0) {
      diag.native_meta = { ...(diag.native_meta || {}), address_alternates: addressAlternates };
    }

    // Transform to mobile API response format
    const streetCleaningTiming: 'NOW' | 'TODAY' | 'UPCOMING' | 'NONE' =
      result.streetCleaning.isActiveNow || result.streetCleaning.severity === 'critical'
        ? 'NOW'
        : result.streetCleaning.nextCleaningDate === getChicagoDateISO()
          ? 'TODAY'
          : result.streetCleaning.found
            ? 'UPCOMING'
            : 'NONE';

    const response: MobileCheckParkingResponse = {
      success: true,
      address: finalAddress,
      coordinates: { latitude: checkLat, longitude: checkLng },
      addressConfidence,
      addressConfidenceReasons: confidenceReasons,
      addressAlternates: addressAlternates.length > 0 ? addressAlternates : undefined,
      parkingAnchor: diag.locked_by_user_anchor
        ? {
            lockedByUserAnchor: true,
            street: typeof diag.user_anchor_street === 'string' ? diag.user_anchor_street : undefined,
            ageDays: typeof diag.user_anchor_age_days === 'number' ? diag.user_anchor_age_days : undefined,
          }
        : undefined,

      streetCleaning: {
        hasRestriction: result.streetCleaning.found,
        message: result.streetCleaning.message,
        timing: streetCleaningTiming,
        nextDate: result.streetCleaning.nextCleaningDate || undefined,
        schedule: result.streetCleaning.schedule || undefined,
        severity: result.streetCleaning.severity,
      },

      winterOvernightBan: {
        found: result.winterBan.found,
        active: result.winterBan.isBanHours && result.winterBan.found,
        message: result.winterBan.message,
        severity: result.winterBan.severity,
        streetName: result.winterBan.streetName || undefined,
        startTime: '3:00 AM',
        endTime: '7:00 AM',
      },

      twoInchSnowBan: {
        found: result.snowBan.found,
        active: result.snowBan.isBanActive,
        message: result.snowBan.message,
        severity: result.snowBan.severity,
        streetName: result.snowBan.streetName || undefined,
        reason: result.snowBan.snowAmount
          ? `${result.snowBan.snowAmount}" snowfall`
          : undefined,
      },

      permitZone: {
        inPermitZone: result.permitZone.found,
        message: result.permitZone.message,
        zoneName: result.permitZone.zoneName || undefined,
        zoneType: result.permitZone.zoneType || undefined,
        permitRequired: result.permitZone.isCurrentlyRestricted,
        severity: result.permitZone.severity,
        restrictionSchedule: result.permitZone.restrictionSchedule || undefined,
        hoursUntilRestriction: result.permitZone.hoursUntilRestriction,
      },

      meteredParking: {
        inMeteredZone: meteredParkingResult.inMeteredZone,
        message: meteredParkingResult.message,
        severity: meteredParkingResult.severity,
        nearestMeterDistanceM: meteredParkingResult.nearestMeterDistanceM || undefined,
        nearestMeterAddress: meteredParkingResult.nearestMeterAddress || undefined,
        timeLimitMinutes: meteredParkingResult.timeLimitMinutes,
        isEnforcedNow: meteredParkingResult.isEnforcedNow,
        estimatedRate: meteredParkingResult.estimatedRate || undefined,
        isRushHour: meteredParkingResult.isRushHour || undefined,
        rushHourInfo: meteredParkingResult.rushHourInfo || undefined,
        scheduleText: meteredParkingResult.scheduleText || undefined,
        isSeasonal: meteredParkingResult.isSeasonal || undefined,
        rateZone: meteredParkingResult.rateZone || undefined,
        blockRangeLabel: meteredParkingResult.blockRangeLabel || undefined,
      },

      dotPermit: {
        hasActivePermit: result.dotPermit.found,
        message: result.dotPermit.message,
        severity: result.dotPermit.severity,
        permitType: result.dotPermit.permitType || undefined,
        startDate: result.dotPermit.startDate || undefined,
        endDate: result.dotPermit.endDate || undefined,
        streetClosure: result.dotPermit.streetClosure || undefined,
        meterBagging: result.dotPermit.meterBagging || undefined,
        description: result.dotPermit.description || undefined,
        isActiveNow: result.dotPermit.isActiveNow || undefined,
      },

      // Enforcement risk scoring from 1.18M FOIA ticket records
      enforcementRisk,

      // Include snap metadata so mobile app knows what happened
      locationSnap: snapResult ? {
        ...snapResult,
        originalCoordinates: { latitude, longitude },
      } : undefined,

      // Parsed address used for all restriction checks (for debugging)
      parsedAddress: result.location.parsedAddress ? {
        number: result.location.parsedAddress.number,
        direction: result.location.parsedAddress.direction,
        name: result.location.parsedAddress.name,
        type: result.location.parsedAddress.type,
      } : undefined,

      timestamp: result.timestamp,
    };

    // --- Log diagnostic row (non-blocking, fire-and-forget) ---
    if (supabaseAdmin) {
      const pa = result.location.parsedAddress;

      // Apple CLGeocoder vote — record what Apple's address DB thought the
      // street was at park time, plus whether it agreed with our resolved
      // street. 4th independent signal alongside snap / Nominatim / Mapbox.
      // Stored under native_meta.apple so we can measure agreement before
      // promoting it to a disambiguation vote.
      if (appleGeocode) {
        if (!diag.native_meta) diag.native_meta = {};
        const appleStreet = (appleGeocode.thoroughfare || appleGeocode.name || '').trim();
        const resolvedStreet = (pa?.name || '').trim();
        const normalize = (s: string) => s.toLowerCase()
          .replace(/\b(north|south|east|west|n|s|e|w|ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane|pkwy|parkway)\b/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        const appleNorm = normalize(appleStreet);
        const resolvedNorm = normalize(resolvedStreet);
        const agreed = appleNorm.length > 0 && resolvedNorm.length > 0 && appleNorm === resolvedNorm;
        diag.native_meta.apple = {
          thoroughfare: appleGeocode.thoroughfare ?? null,
          subThoroughfare: appleGeocode.subThoroughfare ?? null,
          subLocality: appleGeocode.subLocality ?? null,
          name: appleGeocode.name ?? null,
          postalCode: appleGeocode.postalCode ?? null,
          agreed_with_resolved: agreed,
          resolved_street: resolvedStreet || null,
        };
        console.log(`[check-parking] Apple geocode: street="${appleStreet}" #=${appleGeocode.subThoroughfare ?? '?'} agreed=${agreed} (resolved="${resolvedStreet}")`);
      }

      supabaseAdmin.from('parking_diagnostics').insert({
        user_id: user?.id || null,
        raw_lat: latitude,
        raw_lng: longitude,
        raw_accuracy_meters: accuracyMeters || null,
        gps_heading: hasHeading ? headingDeg : null,
        compass_heading: hasCompass ? compassHeadingDeg : null,
        compass_confidence: hasCompass ? compassConfidenceDeg : null,
        gps_source: diag.gps_source || null,
        snap_street_name: snapResult?.streetName || null,
        snap_distance_meters: snapResult?.snapDistanceMeters || null,
        snap_source: snapResult?.snapSource || null,
        snap_bearing: snapResult?.streetBearing || null,
        snapped_lat: snapResult?.wasSnapped ? checkLat : null,
        snapped_lng: snapResult?.wasSnapped ? checkLng : null,
        heading_source: effectiveHeadingSource,
        effective_heading: hasEffectiveHeading ? effectiveHeading : null,
        heading_orientation: hasEffectiveHeading ? (isHeadingNorthSouth(effectiveHeading) ? 'N-S' : 'E-W') : null,
        nominatim_street: diag.nominatim_street || null,
        nominatim_orientation: diag.nominatim_orientation || null,
        nominatim_agreed: diag.nominatim_agreed ?? null,
        nominatim_overrode: diag.nominatim_overrode ?? false,
        heading_confirmed_snap: diag.heading_confirmed_snap ?? null,
        resolved_address: finalAddress || null,
        resolved_street_name: pa?.name || null,
        resolved_street_direction: pa?.direction || null,
        resolved_house_number: pa?.number || null,
        resolved_side: diag.resolved_side || null,
        side_source: diag.side_source || null,
        walkaway_guard_fired: diag.walkaway_guard_fired ?? false,
        walkaway_details: diag.walkaway_details || null,
        parity_forced: diag.parity_forced ?? false,
        forced_parity: diag.forced_parity || null,
        metered_block: meteredParkingResult.inMeteredZone,
        meters_on_user_side: diag.meters_on_user_side ?? null,
        meters_on_opposite_side: diag.meters_on_opposite_side ?? null,
        near_intersection: diag.near_intersection ?? false,
        snap_candidates_count: diag.snap_candidates_count ?? null,
        native_meta: diag.native_meta || null,
      }).then(({ error }) => {
        if (error) console.warn('[diagnostics] Insert failed (non-fatal):', error.message);
        else console.log('[diagnostics] Parking diagnostic logged');
      });
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error checking parking location:', error);
    return res.status(500).json({
      success: false,
      address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      coordinates: { latitude, longitude },
      streetCleaning: { hasRestriction: false, message: 'Error checking restrictions' },
      winterOvernightBan: { found: false, active: false, message: 'Error checking restrictions' },
      twoInchSnowBan: { found: false, active: false, message: 'Error checking restrictions' },
      permitZone: { inPermitZone: false, message: 'Error checking restrictions' },
      meteredParking: { inMeteredZone: false, message: 'Error checking restrictions' },
      dotPermit: { hasActivePermit: false, message: 'Error checking restrictions' },
      timestamp: new Date().toISOString(),
      error: sanitizeErrorMessage(error),
    });
  }
}

// =====================================================
// Heading-based street disambiguation helpers
// =====================================================

/**
 * Determine if heading (0-360°, clockwise from north) indicates N-S travel.
 * N-S: heading within 45° of 0° (north) or 180° (south)
 * E-W: heading within 45° of 90° (east) or 270° (west)
 */
function isHeadingNorthSouth(headingDeg: number): boolean {
  // Normalize to 0-360
  const h = ((headingDeg % 360) + 360) % 360;
  // N-S if within 45° of 0/360 or 180
  return (h <= 45 || h >= 315 || (h >= 135 && h <= 225));
}

/**
 * Determine a Chicago street's orientation from its name.
 * Chicago grid convention:
 *   - Streets prefixed "W " or "E " run EAST-WEST (e.g., "W LAWRENCE AVE")
 *   - Streets prefixed "N " or "S " run NORTH-SOUTH (e.g., "N WOLCOTT AVE")
 *   - Some streets lack a prefix — check common known patterns
 *
 * Returns 'N-S', 'E-W', or null if unknown.
 */
function getChicagoStreetOrientation(streetName: string | null): 'N-S' | 'E-W' | null {
  if (!streetName) return null;
  const name = streetName.trim().toUpperCase();

  // Chicago directional prefix convention
  if (name.startsWith('W ') || name.startsWith('E ')) return 'E-W';
  if (name.startsWith('N ') || name.startsWith('S ')) return 'N-S';

  // Some streets in the data may use full words
  if (name.startsWith('WEST ') || name.startsWith('EAST ')) return 'E-W';
  if (name.startsWith('NORTH ') || name.startsWith('SOUTH ')) return 'N-S';

  // Fallback: major Chicago streets with known orientations
  // (These are streets that might appear without direction prefix in some data sources)
  const ewStreets = [
    'MADISON', 'WASHINGTON', 'RANDOLPH', 'LAKE', 'FULTON',
    'CHICAGO', 'DIVISION', 'NORTH', 'ARMITAGE', 'FULLERTON',
    'DIVERSEY', 'BELMONT', 'ADDISON', 'IRVING PARK', 'MONTROSE',
    'LAWRENCE', 'FOSTER', 'BRYN MAWR', 'DEVON', 'TOUHY',
    'HOWARD', 'ROOSEVELT', 'CERMAK', 'PERSHING', '31ST',
    '35TH', '43RD', '47TH', '51ST', '55TH', '63RD', '67TH',
    '71ST', '75TH', '79TH', '83RD', '87TH', '95TH', '103RD',
    '111TH', '115TH', '119TH', '127TH', 'GRAND', 'KINZIE',
    'HUBBARD', 'ERIE', 'OHIO', 'ONTARIO', 'HURON', 'SUPERIOR',
    'AUGUSTA', 'CORTEZ', 'THOMAS', 'HADDON', 'HIRSCH', 'LEMOYNE',
    'WABANSIA', 'BLOOMINGDALE', 'CORTLAND', 'SHAKESPEARE', 'DICKENS',
    'WEBSTER', 'BELDEN', 'GRANT', 'WRIGHTWOOD', 'LILL',
    'BARRY', 'NELSON', 'WELLINGTON', 'SCHOOL', 'ROSCOE',
    'HENDERSON', 'CORNELIA', 'EDDY', 'PATTERSON', 'BYRON',
    'GRACE', 'WARNER', 'BERTEAU', 'BELLE PLAINE', 'CUYLER',
    'SUNNYSIDE', 'AINSLIE', 'ARGYLE', 'WINONA', 'CARMEN',
    'BALMORAL', 'CATALPA', 'RASCHER', 'OLIVE', 'GLENLAKE',
    'GRANVILLE', 'ROSEMONT', 'FARRAGUT', 'PETERSON', 'THORNDALE',
  ];
  const nsStreets = [
    'STATE', 'DEARBORN', 'CLARK', 'LASALLE', 'WELLS',
    'FRANKLIN', 'WABASH', 'MICHIGAN', 'HALSTED', 'GREEN',
    'PEORIA', 'SANGAMON', 'MORGAN', 'RACINE', 'ASHLAND',
    'PAULINA', 'HERMITAGE', 'WOOD', 'WOLCOTT', 'DAMEN',
    'HOYNE', 'LEAVITT', 'OAKLEY', 'WESTERN', 'CALIFORNIA',
    'FAIRFIELD', 'WASHTENAW', 'SACRAMENTO', 'RICHMOND', 'FRANCISCO',
    'MOZART', 'KEDZIE', 'SPAULDING', 'CHRISTIANA', 'ST LOUIS',
    'DRAKE', 'CENTRAL PARK', 'LAWNDALE', 'HAMLIN', 'AVERS',
    'SPRINGFIELD', 'HOMAN', 'TRUMBULL', 'KARLOV', 'PULASKI',
    'KEELER', 'TRIPP', 'KILDARE', 'KOSTNER', 'KOLMAR',
    'KILPATRICK', 'LARAMIE', 'CICERO', 'LAVERGNE', 'LOCKWOOD',
    'LONG', 'PINE', 'LOTUS', 'LEAMINGTON', 'LECLAIRE',
    'LAPORTE', 'MENARD', 'AUSTIN', 'MASON', 'NEVA',
    'NEWLAND', 'OAK PARK', 'HARLEM', 'CUMBERLAND', 'CANFIELD',
    'CENTRAL', 'NAGLE', 'NORDICA', 'OKETO', 'ORIOLE',
    'OVERHILL', 'SAYRE', 'SHEFFIELD', 'SEMINARY', 'KENMORE',
    'WINTHROP', 'BROADWAY', 'SHERIDAN', 'LAKE SHORE',
    'SOUTHPORT', 'GREENVIEW', 'BOSWORTH', 'WAYNE', 'CLIFTON',
    'MAGNOLIA', 'MALDEN', 'BEACON', 'MARSHFIELD', 'LINCOLN',
  ];

  for (const st of ewStreets) {
    if (name.includes(st)) return 'E-W';
  }
  for (const st of nsStreets) {
    if (name.includes(st)) return 'N-S';
  }

  return null;
}
