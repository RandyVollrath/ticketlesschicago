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

  // Accept optional accuracy and confidence from mobile client
  const accuracyMeters = parseFloat(
    (req.method === 'GET' ? req.query.accuracy : req.body.accuracy_meters) as string
  ) || undefined;
  const confidence = (req.method === 'GET' ? req.query.confidence : req.body.confidence) as string || undefined;

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
          const snap = snapData[0];

          // Only apply snap if the correction is meaningful but not too large.
          // If snap distance > reported accuracy, GPS was probably right and we'd be making it worse.
          const maxSnapDistance = accuracyMeters ? Math.max(accuracyMeters, 30) : 40;

          if (snap.snap_distance_meters <= maxSnapDistance) {
            checkLat = snap.snapped_lat;
            checkLng = snap.snapped_lng;
            snapResult = {
              wasSnapped: true,
              snapDistanceMeters: snap.snap_distance_meters,
              streetName: snap.street_name,
              snapSource: snap.snap_source,
            };
            console.log(`[check-parking] Snapped ${snap.snap_distance_meters.toFixed(1)}m to ${snap.street_name} (${snap.snap_source})`);
          }
        }
      } catch (snapErr) {
        // Snap is optional - log and continue with original coordinates
        console.warn('[check-parking] Snap-to-street failed (non-fatal):', snapErr);
      }
    }

    // Step 2: Check all parking restrictions using (possibly snapped) coordinates
    const result = await checkAllParkingRestrictions(checkLat, checkLng);

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
        restrictionSchedule: result.permitZone.restrictionSchedule || undefined,
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
      timestamp: new Date().toISOString(),
      error: sanitizeErrorMessage(error),
    });
  }
}
