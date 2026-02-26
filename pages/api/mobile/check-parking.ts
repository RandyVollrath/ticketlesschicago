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
import { sanitizeErrorMessage } from '../../../lib/error-utils';
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
    active: boolean;
    message: string;
    severity?: 'critical' | 'warning' | 'info' | 'none';
    startTime?: string;
    endTime?: string;
  };
  twoInchSnowBan: {
    active: boolean;
    message: string;
    severity?: 'critical' | 'warning' | 'info' | 'none';
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

  // Get coordinates from query params (GET) or body (POST)
  const lat = req.method === 'GET' ? req.query.lat : req.body.latitude;
  const lng = req.method === 'GET' ? req.query.lng : req.body.longitude;

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lng as string);

  if (isNaN(latitude) || isNaN(longitude)) {
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
  const hasHeading = !isNaN(headingDeg) && headingDeg >= 0 && headingDeg < 360;

  try {
    // Step 1: Attempt to snap GPS coordinate to nearest known street segment.
    // This corrects for urban canyon drift (10-30m) that can put you on the wrong block.
    // Only snap if accuracy is reasonable (under 75m) - very poor GPS shouldn't be "corrected".
    let checkLat = latitude;
    let checkLng = longitude;
    let snapResult: {
      wasSnapped: boolean;
      snapDistanceMeters: number;
      streetName: string | null;
      snapSource: string | null;
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
            user_lat: latitude,
            user_lng: longitude,
            search_radius_meters: searchRadius,
          }
        );

        if (!snapError && snapData && snapData.length > 0 && snapData[0].was_snapped) {
          let candidates = snapData.filter((s: any) => s.was_snapped);
          const maxSnapDistance = accuracyMeters ? Math.max(accuracyMeters, 30) : 40;

          // Filter by max snap distance
          candidates = candidates.filter((s: any) => s.snap_distance_meters <= maxSnapDistance);

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
            if (hasHeading && candidates.length > 1) {
              const headingIsNS = isHeadingNorthSouth(headingDeg);
              const headingDir = headingIsNS ? 'N-S' : 'E-W';

              for (const c of candidates) {
                const streetDir = getChicagoStreetOrientation(c.street_name);
                if (streetDir === headingDir) {
                  bestCandidate = c;
                  console.log(`[check-parking] Heading disambiguation: ${headingDeg.toFixed(0)}° (${headingDir}) → chose ${c.street_name} over ${candidates[0].street_name}`);
                  break;
                }
              }
            } else if (hasHeading && candidates.length === 1) {
              // Single candidate — verify heading alignment. If mismatched, SKIP the snap
              // entirely and use original coordinates. The reverse geocode (Nominatim/Google)
              // will determine the street from the raw GPS, which is often correct for the
              // street name even when offset by 10-30m.
              //
              // Example: Near Lawrence (E-W) & Wolcott (N-S) intersection:
              //   - Snap picks Lawrence (closest snow route at 8m)
              //   - Heading is 170° (south) → N-S street
              //   - Mismatch! Skip snap → reverse geocode finds "Wolcott Ave" ✓
              const streetDir = getChicagoStreetOrientation(candidates[0].street_name);
              const headingDir = isHeadingNorthSouth(headingDeg) ? 'N-S' : 'E-W';
              if (streetDir && streetDir !== headingDir) {
                console.log(`[check-parking] Heading mismatch: heading ${headingDeg.toFixed(0)}° (${headingDir}) but snap target is ${candidates[0].street_name} (${streetDir}). Skipping snap — using original coordinates for reverse geocode.`);
                // Don't apply this candidate — fall through with checkLat/checkLng unchanged
                bestCandidate = null as any;
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
              };
              console.log(`[check-parking] Snapped ${bestCandidate.snap_distance_meters.toFixed(1)}m to ${bestCandidate.street_name} (${bestCandidate.snap_source})`);
            }
          }
        }
      } catch (snapErr) {
        // Snap is optional - log and continue with original coordinates
        console.warn('[check-parking] Snap-to-street failed (non-fatal):', snapErr);
      }
    }

    // Step 2: Check all parking restrictions using (possibly snapped) coordinates
    // Run metered parking check in parallel with restriction checks
    const [result, meteredParkingResult] = await Promise.all([
      checkAllParkingRestrictions(checkLat, checkLng),
      checkMeteredParking(checkLat, checkLng),
    ]);

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

    // Transform to mobile API response format
    const response: MobileCheckParkingResponse = {
      success: true,
      address: result.location.address,
      coordinates: { latitude: checkLat, longitude: checkLng },

      streetCleaning: {
        hasRestriction: result.streetCleaning.found,
        message: result.streetCleaning.message,
        timing: result.streetCleaning.isActiveNow ? 'NOW' :
                result.streetCleaning.found ? 'UPCOMING' : 'NONE',
        nextDate: result.streetCleaning.nextCleaningDate || undefined,
        schedule: result.streetCleaning.schedule || undefined,
        severity: result.streetCleaning.severity,
      },

      winterOvernightBan: {
        active: result.winterBan.isBanHours && result.winterBan.found,
        message: result.winterBan.message,
        severity: result.winterBan.severity,
        startTime: '3:00 AM',
        endTime: '7:00 AM',
      },

      twoInchSnowBan: {
        active: result.snowBan.isBanActive,
        message: result.snowBan.message,
        severity: result.snowBan.severity,
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
        restrictionSchedule: undefined,
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
      },

      // Enforcement risk scoring from 1.18M FOIA ticket records
      enforcementRisk,

      // Include snap metadata so mobile app knows what happened
      locationSnap: snapResult ? {
        ...snapResult,
        originalCoordinates: { latitude, longitude },
      } : undefined,

      timestamp: result.timestamp,
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error checking parking location:', error);
    return res.status(500).json({
      success: false,
      address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      coordinates: { latitude, longitude },
      streetCleaning: { hasRestriction: false, message: 'Error checking restrictions' },
      winterOvernightBan: { active: false, message: 'Error checking restrictions' },
      twoInchSnowBan: { active: false, message: 'Error checking restrictions' },
      permitZone: { inPermitZone: false, message: 'Error checking restrictions' },
      meteredParking: { inMeteredZone: false, message: 'Error checking restrictions' },
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
