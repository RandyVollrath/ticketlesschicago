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
  /** Map-snap metadata - if the GPS coordinate was snapped to a known street */
  locationSnap?: {
    wasSnapped: boolean;
    snapDistanceMeters: number;
    streetName: string | null;
    snapSource: string | null;
    /** The original (pre-snap) coordinates */
    originalCoordinates: { latitude: number; longitude: number };
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

  // Drive trajectory — last ~10 GPS fixes while the car was moving. Used for
  // trajectory-based street disambiguation: if the car was on Wolcott for 6
  // blocks before stopping, every trajectory point will be near Wolcott's
  // centerline, not Lawrence's, even if the stop point's nearest centerline
  // happens to be Lawrence.
  let driveTrajectory: Array<[number, number, number, number]> = [];
  const trajectoryRaw = (req.method === 'GET' ? req.query.drive_trajectory : req.body.drive_trajectory) as string | undefined;
  if (trajectoryRaw) {
    try {
      const parsed = JSON.parse(trajectoryRaw);
      if (Array.isArray(parsed)) {
        driveTrajectory = parsed
          .filter((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
          .slice(-10); // defensive cap
      }
    } catch (e) {
      console.warn('[check-parking] Failed to parse drive_trajectory:', e);
    }
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
    if (Object.keys(nativeMeta).length > 0) {
      diag.native_meta = nativeMeta;
    }

    // Step 0: Apply per-block GPS correction if available (Layer 4).
    // The correction model learns systematic GPS offset per block from meter locations
    // and user feedback. Applied before snap-to-street to shift the GPS point closer
    // to the actual street, making snap more reliable.
    let correctedLat = latitude;
    let correctedLng = longitude;
    if (supabaseAdmin) {
      try {
        // Quick lookup: find correction for any block near this GPS point.
        // We don't know the block yet, so we look up by proximity.
        const { data: corrections } = await supabaseAdmin
          .from('gps_block_corrections')
          .select('offset_lat, offset_lng, sample_count, street_direction, street_name, block_number')
          .gte('sample_count', 3); // Only use corrections with enough data

        if (corrections && corrections.length > 0) {
          // Find the nearest block correction by estimating which block we're on
          // Use a simple grid estimate to narrow down candidates
          let bestCorr = null;
          let bestDist = Infinity;
          for (const c of corrections) {
            // Rough distance check using grid math
            const blockLat = 41.88185 + (c.street_direction === 'N' ? 1 : c.street_direction === 'S' ? -1 : 0) * (c.block_number + 50) / 55700;
            const blockLng = -87.62755 - (c.street_direction === 'W' ? 1 : c.street_direction === 'E' ? -1 : 0) * (c.block_number + 50) / 42200;
            const dist = Math.sqrt(Math.pow((latitude - blockLat) * 111000, 2) + Math.pow((longitude - blockLng) * 85000, 2));
            if (dist < 200 && dist < bestDist) { // Within 200m
              bestDist = dist;
              bestCorr = c;
            }
          }
          if (bestCorr) {
            correctedLat = latitude + bestCorr.offset_lat;
            correctedLng = longitude + bestCorr.offset_lng;
            const correctionM = Math.sqrt(Math.pow(bestCorr.offset_lat * 111000, 2) + Math.pow(bestCorr.offset_lng * 85000, 2));
            console.log(`[check-parking] GPS correction applied: ${bestCorr.street_direction} ${bestCorr.street_name} ${bestCorr.block_number} block, ${correctionM.toFixed(1)}m shift (${bestCorr.sample_count} samples)`);
            diag.gps_correction_applied = true;
            diag.gps_correction_meters = correctionM;
          }
        }
      } catch (corrErr) {
        // Correction is optional — don't block parking check
        console.warn('[check-parking] GPS correction lookup failed (non-fatal):', corrErr);
      }
    }

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
            if (candidates[0].snap_distance_meters <= CLOSE_LOCK_THRESHOLD_M) {
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
            if (!lockedByCloseSnap) {
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
            } // end if (!lockedByCloseSnap) — close lock skips disambiguation

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
                const nominatimCandidate = allCandidates.find((c: any) =>
                  c.street_name === nominatimResult.street_name
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
          const fixes: Array<{ lat: number; lng: number; accuracyMeters?: number }> =
            driveTrajectory.map((p) => ({ lat: p[0], lng: p[1] }));
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
        const { data: bld, error: bldErr } = await supabaseAdmin.rpc('nearest_address_point', {
          user_lat: latitude,
          user_lng: longitude,
          search_radius_meters: 25,
          expected_street: snapResult.streetName,
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
          console.log(`[check-parking] Building lookup: no ${expectedParity}-parity building within 25m on ${snapResult.streetName} — will fall back to segment interpolation`);
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
    const ruleMatchNumber: number | null =
      snapResult?.interpolatedNumber ??
      buildingFootprintResult?.house_number ??
      null;
    const displayNumber: number | null =
      buildingFootprintResult?.house_number ??
      snapResult?.interpolatedNumber ??
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
    //   3. unified-parking-checker's address (grid estimator / Nominatim)
    let finalAddress = result.location.address;
    let addressNumberSource: 'building_footprint' | 'segment_interpolation' | 'fallback' = 'fallback';
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
