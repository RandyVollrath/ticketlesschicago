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

  // Validate coordinates are within Chicago area (roughly)
  if (latitude < 41.6 || latitude > 42.1 || longitude < -88.0 || longitude > -87.5) {
    return res.status(400).json({
      error: 'outside_chicago',
      message: 'This app monitors Chicago parking restrictions. Your current location appears to be outside the Chicago area. Please use the app when parked in Chicago.',
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

  // Heading source preference:
  //   - Both available AND they disagree >45° → prefer GPS heading. The phone's
  //     compass reads the top-of-phone orientation, which doesn't always match
  //     the car's direction of travel (phone in cupholder sideways, bag, etc.).
  //     GPS heading captured while actually driving is ground-truth car direction.
  //     This is the Randy Lawrence bug: compass said 83° (E), GPS said 355° (N),
  //     car was on N-S Wolcott — GPS was right.
  //   - Only compass → use compass (car stopped, GPS heading goes invalid)
  //   - Only GPS → use GPS (compass has low confidence)
  //   - Neither → no disambiguation
  let headingDisagreementDeg: number | null = null;
  let headingPrefersGps = false;
  if (hasCompass && hasHeading) {
    const rawDiff = Math.abs(compassHeadingDeg - headingDeg);
    headingDisagreementDeg = Math.min(rawDiff, 360 - rawDiff);
    if (headingDisagreementDeg > 45) {
      headingPrefersGps = true;
    }
  }
  let effectiveHeading: number;
  let effectiveHeadingSource: 'compass' | 'gps' | 'none';
  if (headingPrefersGps && hasHeading) {
    effectiveHeading = headingDeg;
    effectiveHeadingSource = 'gps';
    console.log(`[check-parking] GPS vs compass heading disagreement ${headingDisagreementDeg!.toFixed(0)}° — preferring GPS ${headingDeg.toFixed(0)}° over compass ${compassHeadingDeg.toFixed(0)}° (compass likely reflects phone orientation, not car direction)`);
  } else if (hasCompass) {
    effectiveHeading = compassHeadingDeg;
    effectiveHeadingSource = 'compass';
    console.log(`[check-parking] Compass heading: ${compassHeadingDeg.toFixed(1)}° ±${compassConfidenceDeg.toFixed(1)}° — using as primary heading`);
  } else if (hasHeading) {
    effectiveHeading = headingDeg;
    effectiveHeadingSource = 'gps';
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
    } | null = null;

    const shouldSnap = !accuracyMeters || accuracyMeters <= 75;

    if (shouldSnap && supabaseAdmin) {
      try {
        // Use a search radius proportional to reported accuracy, clamped 25-50m
        const searchRadius = accuracyMeters
          ? Math.min(Math.max(accuracyMeters * 1.5, 25), 50)
          : 40;

        const { data: snapData, error: snapError } = await supabaseAdmin.rpc(
          'snap_to_nearest_street',
          {
            user_lat: correctedLat,
            user_lng: correctedLng,
            search_radius_meters: searchRadius,
          }
        );

        if (!snapError && snapData && snapData.length > 0 && snapData[0].was_snapped) {
          const allCandidates = snapData.filter((s: any) => s.was_snapped);
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

            // Heading-based street disambiguation using Chicago's grid system.
            // Chicago streets follow a strict grid: streets prefixed W/E run east-west,
            // streets prefixed N/S run north-south. If we have heading AND multiple
            // candidates (or a single candidate whose orientation doesn't match heading),
            // we can pick the right street.
            //
            // Example: User parked on Wolcott (N-S) near Lawrence (E-W).
            // If heading is ~0°/180° (N/S), prefer the N/S street.
            if (hasEffectiveHeading && candidates.length > 1) {
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
            } else if (hasEffectiveHeading && candidates.length === 1) {
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

            if (bestCandidate) {
              checkLat = bestCandidate.snapped_lat;
              checkLng = bestCandidate.snapped_lng;
              snapResult = {
                wasSnapped: true,
                snapDistanceMeters: bestCandidate.snap_distance_meters,
                streetName: bestCandidate.street_name,
                snapSource: bestCandidate.snap_source,
                streetBearing: bestCandidate.street_bearing,
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
                // Key question: did heading CONFIRM the snap's orientation?
                // If heading matched the snap (e.g., heading=89° E-W, snap=Belden E-W),
                // that's strong evidence the snap was correct and Nominatim is looking
                // at a walked-away GPS position. DON'T override in that case.
                const headingConfirmedSnap = hasEffectiveHeading && (
                  (snapOrientation === 'N-S' && isHeadingNorthSouth(effectiveHeading)) ||
                  (snapOrientation === 'E-W' && !isHeadingNorthSouth(effectiveHeading))
                );

                // Was this snap from the extended heading search (far away, heading-driven)?
                // If so, Nominatim disagreeing is strong evidence the heading was stale.
                // Extended search snaps are 30-150m away — much weaker than a close initial snap.
                const snapWasExtended = snapResult.snapSource?.includes('heading_extended') ||
                  (snapResult.snapDistanceMeters > 25);

                if (headingConfirmedSnap && !snapWasExtended) {
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
                  console.log(
                    `[check-parking] Nominatim cross-reference: extended snap says ${snapResult.streetName} (${snapOrientation}, ${snapResult.snapDistanceMeters?.toFixed(1)}m), ` +
                    `Nominatim says ${nominatimResult.street_name} (${nominatimOrientation}). ` +
                    `Heading ${effectiveHeading.toFixed(0)}° confirmed snap but snap was far/extended — ` +
                    `preferring Nominatim (heading likely stale after turn).`
                  );
                  diag.nominatim_street = nominatimResult.street_name;
                  diag.nominatim_orientation = nominatimOrientation;
                  diag.nominatim_agreed = false;
                  diag.nominatim_overrode = true;
                  diag.heading_confirmed_snap = false;
                  checkLat = latitude;
                  checkLng = longitude;
                  snapResult = {
                    wasSnapped: false,
                    snapDistanceMeters: 0,
                    streetName: nominatimResult.street_name,
                    snapSource: 'nominatim_override_extended',
                  };
                  if (hasHeading && !hasCompass) {
                    console.log(`[check-parking] Discarding GPS heading ${headingDeg.toFixed(0)}° — stale (extended snap overridden)`);
                    hasHeading = false;
                  }
                } else {
                  console.log(`[check-parking] Nominatim cross-reference: snap says ${snapResult.streetName} (${snapOrientation}), Nominatim says ${nominatimResult.street_name} (${nominatimOrientation}). Heading does NOT confirm snap — preferring Nominatim.`);
                  diag.nominatim_street = nominatimResult.street_name;
                  diag.nominatim_orientation = nominatimOrientation;
                  diag.nominatim_agreed = false;
                  diag.nominatim_overrode = true;
                  diag.heading_confirmed_snap = false;
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

    const result = await checkAllParkingRestrictions(
      checkLat, checkLng, snapResult?.streetName || undefined,
      snapGeometry, latitude, longitude,
    );

    // Step 2b: Metered parking check uses the shared parsed address from step 2.
    // Pass heading so the checker can determine which side of the street the user
    // is on and suppress meter warnings when parked on the non-metered side.
    const meteredParkingResult = await checkMeteredParking(
      checkLat,
      checkLng,
      result.location.parsedAddress,  // Pass shared address — no second geocode call
      hasEffectiveHeading ? effectiveHeading : undefined,
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
      address: result.location.address,
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
        resolved_address: result.location.address || null,
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
