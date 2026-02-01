/**
 * Parking Evidence Lookup
 *
 * Connects the mobile app's parking location history to the ticket contest system.
 * When a user contests a ticket, this module searches their parking history for
 * GPS-verified evidence that can strengthen their defense.
 *
 * Evidence types:
 * 1. DEPARTURE PROOF - GPS shows user left the spot before the ticket was issued
 * 2. PARKING DURATION - GPS shows how long user was parked (for time-limited zones)
 * 3. RESTRICTION MISMATCH - App detected different restrictions than what ticket cites
 * 4. LOCATION PATTERN - User regularly parks at this location (proves familiarity/residency)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Types

export interface ParkingEvidenceResult {
  /** Whether any relevant parking evidence was found */
  hasEvidence: boolean;
  /** Departure proof - GPS-verified evidence user left before ticket time */
  departureProof: DepartureProof | null;
  /** Duration evidence - how long user was parked */
  parkingDuration: ParkingDurationEvidence | null;
  /** Restriction data the app captured at this location */
  restrictionCapture: RestrictionCapture | null;
  /** Pattern of parking at this location */
  locationPattern: LocationPattern | null;
  /** Human-readable summary for the AI letter generator */
  evidenceSummary: string;
  /** How strong this evidence is (0-1) */
  evidenceStrength: number;
}

export interface DepartureProof {
  /** When the user parked at this location */
  parkedAt: string;
  /** When the app detected user leaving (Bluetooth disconnect / driving started) */
  clearedAt: string;
  /** When GPS confirmed departure (user was physically away from spot) */
  departureConfirmedAt: string;
  /** How far user moved from parking spot (meters) */
  departureDistanceMeters: number;
  /** GPS accuracy of departure reading */
  departureAccuracyMeters: number | null;
  /** Whether departure is conclusive (moved 50+ meters) */
  isConclusive: boolean;
  /** Address where user was parked */
  address: string | null;
  /** Minutes between departure and ticket time (positive = left before ticket) */
  minutesBeforeTicket: number;
  /** Formatted time string for the letter */
  departureTimeFormatted: string;
}

export interface ParkingDurationEvidence {
  /** When user parked */
  parkedAt: string;
  /** When user left */
  clearedAt: string;
  /** Total parking duration in minutes */
  durationMinutes: number;
  /** Formatted duration string */
  durationFormatted: string;
}

export interface RestrictionCapture {
  /** Street cleaning date detected by app */
  streetCleaningDate: string | null;
  /** Street cleaning ward */
  streetCleaningWard: string | null;
  /** Was on snow route */
  onSnowRoute: boolean;
  /** Snow route name */
  snowRouteName: string | null;
  /** Was on winter ban street */
  onWinterBanStreet: boolean;
  /** Winter ban street name */
  winterBanStreetName: string | null;
  /** Permit zone detected */
  permitZone: string | null;
  /** Permit restriction schedule */
  permitSchedule: string | null;
  /** Whether the restriction data conflicts with the ticket violation */
  hasConflict: boolean;
  /** Description of the conflict */
  conflictDescription: string | null;
}

export interface LocationPattern {
  /** How many times user has parked at/near this location */
  totalVisits: number;
  /** How many visits in the last 30 days */
  recentVisits: number;
  /** First time parked here */
  firstVisit: string;
  /** Shows user is familiar with this area */
  isRegularLocation: boolean;
}

// Violation codes where location evidence is relevant
const DEPARTURE_RELEVANT_VIOLATIONS: Record<string, string> = {
  '9-64-010': 'street_cleaning',
  '9-64-100': 'snow_route',
  '9-64-170': 'expired_meter',
  '9-64-140': 'no_standing',
};

const PERMIT_RELEVANT_VIOLATIONS = ['9-64-070']; // Residential permit
const DURATION_RELEVANT_VIOLATIONS = ['9-64-140', '9-64-170']; // No standing, expired meter

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Format a timestamp to a readable time string in Chicago timezone
 */
function formatChicagoTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format duration in minutes to a human-readable string
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} minutes`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${hours} hour${hours > 1 ? 's' : ''} and ${mins} minute${mins > 1 ? 's' : ''}`;
}

/**
 * Look up parking evidence for a ticket contest.
 *
 * Searches the user's parking_location_history for GPS records that match
 * the ticket's location and date, then builds evidence that can strengthen
 * the contest letter.
 */
export async function lookupParkingEvidence(
  supabase: SupabaseClient,
  userId: string,
  ticketLocation: string | null,
  ticketDate: string | null,
  ticketTime: string | null,
  violationCode: string | null,
  ticketLatitude?: number | null,
  ticketLongitude?: number | null,
): Promise<ParkingEvidenceResult> {
  const noEvidence: ParkingEvidenceResult = {
    hasEvidence: false,
    departureProof: null,
    parkingDuration: null,
    restrictionCapture: null,
    locationPattern: null,
    evidenceSummary: '',
    evidenceStrength: 0,
  };

  if (!ticketDate || !userId) {
    return noEvidence;
  }

  try {
    // Build a date range: ticket date +/- 1 day to catch edge cases
    const ticketDateObj = new Date(ticketDate);
    if (isNaN(ticketDateObj.getTime())) {
      return noEvidence;
    }

    const searchStart = new Date(ticketDateObj);
    searchStart.setDate(searchStart.getDate() - 1);
    const searchEnd = new Date(ticketDateObj);
    searchEnd.setDate(searchEnd.getDate() + 2);

    // Find parking history records near the ticket date
    const { data: records, error } = await supabase
      .from('parking_location_history')
      .select('*')
      .eq('user_id', userId)
      .gte('parked_at', searchStart.toISOString())
      .lt('parked_at', searchEnd.toISOString())
      .order('parked_at', { ascending: false });

    if (error || !records || records.length === 0) {
      return noEvidence;
    }

    // Try to match records to the ticket location
    // Strategy 1: If we have lat/lng for the ticket, use distance matching
    // Strategy 2: If we only have an address, do substring matching
    let matchedRecords = records;

    if (ticketLatitude && ticketLongitude) {
      // Find records within 200m of the ticket location
      matchedRecords = records.filter((r) => {
        const dist = calculateDistance(
          Number(r.latitude),
          Number(r.longitude),
          ticketLatitude,
          ticketLongitude
        );
        return dist <= 200;
      });
    } else if (ticketLocation) {
      // Fuzzy address matching - extract street name components
      const locationLower = ticketLocation.toLowerCase();
      const streetParts = locationLower
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((p) => p.length > 2 && !['and', 'the', 'ave', 'st', 'blvd', 'dr', 'rd', 'ct', 'pl', 'chicago', 'il'].includes(p));

      if (streetParts.length > 0) {
        matchedRecords = records.filter((r) => {
          if (!r.address) return false;
          const addrLower = r.address.toLowerCase();
          // Match if at least 2 street parts match, or 1 if it's specific enough
          const matchCount = streetParts.filter((p) => addrLower.includes(p)).length;
          return matchCount >= Math.min(2, streetParts.length);
        });
      }
    }

    // If no location-matched records, fall back to date-matched records on the ticket date
    if (matchedRecords.length === 0) {
      const ticketDay = ticketDateObj.toISOString().split('T')[0];
      matchedRecords = records.filter((r) => {
        const parkedDay = new Date(r.parked_at).toISOString().split('T')[0];
        return parkedDay === ticketDay;
      });
    }

    if (matchedRecords.length === 0) {
      return noEvidence;
    }

    // Use the best matching record (most recent on that day with departure data preferred)
    const bestRecord =
      matchedRecords.find((r) => r.departure_confirmed_at) || matchedRecords[0];

    // Build the ticket datetime for comparison
    let ticketDateTime: Date;
    if (ticketTime) {
      // Try to parse time like "2:30 PM" or "14:30"
      const timeStr = ticketTime.trim();
      const dateStr = ticketDateObj.toISOString().split('T')[0];
      ticketDateTime = new Date(`${dateStr}T${convertTo24Hour(timeStr)}`);
      if (isNaN(ticketDateTime.getTime())) {
        ticketDateTime = ticketDateObj;
      }
    } else {
      ticketDateTime = ticketDateObj;
    }

    // --- Build Evidence Components ---

    let departureProof: DepartureProof | null = null;
    let parkingDuration: ParkingDurationEvidence | null = null;
    let restrictionCapture: RestrictionCapture | null = null;
    let locationPattern: LocationPattern | null = null;
    let evidenceStrength = 0;
    const summaryParts: string[] = [];

    // 1. DEPARTURE PROOF
    if (bestRecord.departure_confirmed_at || bestRecord.cleared_at) {
      const departureTime = bestRecord.departure_confirmed_at || bestRecord.cleared_at;
      const departureDate = new Date(departureTime);
      const minutesBefore = (ticketDateTime.getTime() - departureDate.getTime()) / (1000 * 60);
      const distanceMeters = bestRecord.departure_distance_meters || 0;
      const isConclusive = distanceMeters >= 50;

      // Only include if user departed BEFORE the ticket was issued
      if (minutesBefore > 0) {
        departureProof = {
          parkedAt: bestRecord.parked_at,
          clearedAt: bestRecord.cleared_at || departureTime,
          departureConfirmedAt: departureTime,
          departureDistanceMeters: Math.round(distanceMeters),
          departureAccuracyMeters: bestRecord.departure_accuracy_meters || null,
          isConclusive,
          address: bestRecord.address,
          minutesBeforeTicket: Math.round(minutesBefore),
          departureTimeFormatted: formatChicagoTime(departureTime),
        };

        // Departure proof is the highest-value evidence
        if (isConclusive) {
          evidenceStrength += 0.45;
          summaryParts.push(
            `GPS DEPARTURE PROOF: The user's phone GPS confirms they departed from ${bestRecord.address || 'the ticket location'} at ${formatChicagoTime(departureTime)}, which is ${Math.round(minutesBefore)} minutes BEFORE the ticket was issued. The GPS shows the user moved ${Math.round(distanceMeters)} meters from their parking spot, providing conclusive proof of departure.`
          );
        } else if (bestRecord.cleared_at) {
          evidenceStrength += 0.25;
          summaryParts.push(
            `DEPARTURE DETECTED: The user's connected vehicle (via Bluetooth) shows the car started moving at ${formatChicagoTime(bestRecord.cleared_at)}, which is ${Math.round(minutesBefore)} minutes before the ticket was issued. The vehicle departed from ${bestRecord.address || 'the ticket location'}.`
          );
        }
      }
    }

    // 2. PARKING DURATION
    if (
      bestRecord.parked_at &&
      bestRecord.cleared_at &&
      DURATION_RELEVANT_VIOLATIONS.includes(violationCode || '')
    ) {
      const parkedDate = new Date(bestRecord.parked_at);
      const clearedDate = new Date(bestRecord.cleared_at);
      const durationMinutes = (clearedDate.getTime() - parkedDate.getTime()) / (1000 * 60);

      if (durationMinutes > 0 && durationMinutes < 1440) {
        parkingDuration = {
          parkedAt: bestRecord.parked_at,
          clearedAt: bestRecord.cleared_at,
          durationMinutes: Math.round(durationMinutes),
          durationFormatted: formatDuration(durationMinutes),
        };

        evidenceStrength += 0.15;
        summaryParts.push(
          `PARKING DURATION: GPS records show the user parked at ${formatChicagoTime(bestRecord.parked_at)} and left at ${formatChicagoTime(bestRecord.cleared_at)}, a total duration of ${formatDuration(durationMinutes)}.`
        );
      }
    }

    // 3. RESTRICTION CAPTURE
    const hasRestrictionData =
      bestRecord.street_cleaning_date ||
      bestRecord.on_snow_route ||
      bestRecord.on_winter_ban_street ||
      bestRecord.permit_zone;

    if (hasRestrictionData) {
      let hasConflict = false;
      let conflictDescription: string | null = null;

      // Check for conflicts between app data and ticket violation
      if (violationCode === '9-64-010' && !bestRecord.street_cleaning_date) {
        hasConflict = true;
        conflictDescription =
          'The app did not detect any street cleaning restriction at this location when the user parked, suggesting the restriction may not have been properly posted or was not in effect.';
      }
      if (violationCode === '9-64-100' && !bestRecord.on_snow_route) {
        hasConflict = true;
        conflictDescription =
          'The app did not detect this location as a snow route when the user parked.';
      }
      if (violationCode === '9-64-070' && bestRecord.permit_zone) {
        // User was in a permit zone - this actually SUPPORTS them if they have a permit for that zone
        conflictDescription = `The app detected this location is in permit zone ${bestRecord.permit_zone}. If the user has a valid permit for this zone, this supports their defense.`;
      }

      restrictionCapture = {
        streetCleaningDate: bestRecord.street_cleaning_date,
        streetCleaningWard: bestRecord.street_cleaning_ward,
        onSnowRoute: bestRecord.on_snow_route || false,
        snowRouteName: bestRecord.snow_route_name,
        onWinterBanStreet: bestRecord.on_winter_ban_street || false,
        winterBanStreetName: bestRecord.winter_ban_street_name,
        permitZone: bestRecord.permit_zone,
        permitSchedule: bestRecord.permit_restriction_schedule,
        hasConflict,
        conflictDescription,
      };

      if (hasConflict) {
        evidenceStrength += 0.20;
        summaryParts.push(`RESTRICTION DATA CONFLICT: ${conflictDescription}`);
      } else if (restrictionCapture.permitZone && violationCode === '9-64-070') {
        evidenceStrength += 0.10;
        summaryParts.push(
          `PERMIT ZONE DATA: The app confirmed this location is in permit zone ${restrictionCapture.permitZone}${restrictionCapture.permitSchedule ? ` with schedule: ${restrictionCapture.permitSchedule}` : ''}.`
        );
      }
    }

    // 4. LOCATION PATTERN
    // Look for how often the user parks near this location
    if (ticketLatitude && ticketLongitude) {
      // Use a broader search for pattern analysis - all time
      const { data: allRecords } = await supabase
        .from('parking_location_history')
        .select('parked_at, latitude, longitude')
        .eq('user_id', userId)
        .order('parked_at', { ascending: false })
        .limit(200);

      if (allRecords && allRecords.length > 0) {
        const nearbyRecords = allRecords.filter((r) => {
          const dist = calculateDistance(
            Number(r.latitude),
            Number(r.longitude),
            ticketLatitude,
            ticketLongitude
          );
          return dist <= 200;
        });

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentNearby = nearbyRecords.filter(
          (r) => new Date(r.parked_at) >= thirtyDaysAgo
        );

        if (nearbyRecords.length > 0) {
          locationPattern = {
            totalVisits: nearbyRecords.length,
            recentVisits: recentNearby.length,
            firstVisit: nearbyRecords[nearbyRecords.length - 1].parked_at,
            isRegularLocation: nearbyRecords.length >= 5,
          };

          if (locationPattern.isRegularLocation) {
            evidenceStrength += 0.10;
            summaryParts.push(
              `REGULAR PARKING LOCATION: GPS records show the user has parked at or near this location ${nearbyRecords.length} times (${recentNearby.length} times in the last 30 days), indicating they are a regular at this location and familiar with parking restrictions.`
            );
          }
        }
      }
    } else if (ticketLocation && bestRecord.address) {
      // Address-based pattern matching
      const { data: allRecords } = await supabase
        .from('parking_location_history')
        .select('parked_at, address')
        .eq('user_id', userId)
        .order('parked_at', { ascending: false })
        .limit(200);

      if (allRecords) {
        const addrLower = bestRecord.address.toLowerCase();
        // Extract street name for matching
        const streetMatch = addrLower.match(/\d+\s+(.+)/);
        const streetName = streetMatch ? streetMatch[1] : addrLower;

        const nearbyRecords = allRecords.filter((r) =>
          r.address?.toLowerCase().includes(streetName)
        );

        if (nearbyRecords.length > 1) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const recentNearby = nearbyRecords.filter(
            (r) => new Date(r.parked_at) >= thirtyDaysAgo
          );

          locationPattern = {
            totalVisits: nearbyRecords.length,
            recentVisits: recentNearby.length,
            firstVisit: nearbyRecords[nearbyRecords.length - 1].parked_at,
            isRegularLocation: nearbyRecords.length >= 5,
          };

          if (locationPattern.isRegularLocation) {
            evidenceStrength += 0.10;
            summaryParts.push(
              `REGULAR PARKING LOCATION: Records show the user has parked on this street ${nearbyRecords.length} times, indicating familiarity with the area.`
            );
          }
        }
      }
    }

    // Cap evidence strength at 1.0
    evidenceStrength = Math.min(evidenceStrength, 1.0);

    const hasEvidence = summaryParts.length > 0;
    const evidenceSummary = hasEvidence
      ? summaryParts.join('\n\n')
      : '';

    return {
      hasEvidence,
      departureProof,
      parkingDuration,
      restrictionCapture,
      locationPattern,
      evidenceSummary,
      evidenceStrength,
    };
  } catch (error) {
    console.error('Error looking up parking evidence:', error);
    return noEvidence;
  }
}

/**
 * Convert a time string like "2:30 PM" or "14:30" to "14:30:00" format
 */
function convertTo24Hour(timeStr: string): string {
  // Already in 24h format
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr) && !timeStr.toLowerCase().includes('am') && !timeStr.toLowerCase().includes('pm')) {
    const parts = timeStr.split(':');
    return `${parts[0].padStart(2, '0')}:${parts[1]}:${parts[2] || '00'}`;
  }

  // Parse AM/PM format
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = match[3].toLowerCase();

    if (period === 'pm' && hours !== 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
  }

  // Fallback - try noon
  return '12:00:00';
}

/**
 * Generate a violation-specific evidence paragraph for the contest letter.
 * This creates tailored text based on the violation type and available evidence.
 */
export function generateEvidenceParagraph(
  evidence: ParkingEvidenceResult,
  violationCode: string | null,
): string {
  if (!evidence.hasEvidence) return '';

  const paragraphs: string[] = [];

  // Departure proof paragraph - highest value
  if (evidence.departureProof) {
    const dp = evidence.departureProof;
    const violationType = violationCode ? DEPARTURE_RELEVANT_VIOLATIONS[violationCode] : null;

    if (dp.isConclusive) {
      switch (violationType) {
        case 'street_cleaning':
          paragraphs.push(
            `Furthermore, I have GPS-verified evidence from my vehicle's connected mobile application showing that I departed from the parking location at ${dp.departureTimeFormatted}, which is ${dp.minutesBeforeTicket} minutes before this citation was issued. The GPS data confirms I moved ${dp.departureDistanceMeters} meters from my parking spot, providing conclusive proof that my vehicle was no longer at this location during street cleaning operations. This timestamped departure data serves as digital evidence that my vehicle did not obstruct street cleaning.`
          );
          break;
        case 'snow_route':
          paragraphs.push(
            `Additionally, GPS data from my vehicle's connected mobile application confirms I moved my vehicle from this location at ${dp.departureTimeFormatted}, ${dp.minutesBeforeTicket} minutes before this citation was written. The GPS verified I traveled ${dp.departureDistanceMeters} meters from the parking spot. My vehicle was not present on this snow route at the time of citation and did not interfere with snow removal operations.`
          );
          break;
        case 'expired_meter':
          paragraphs.push(
            `GPS records from my vehicle's connected application confirm I departed from the metered parking spot at ${dp.departureTimeFormatted}, ${dp.minutesBeforeTicket} minutes before this citation was issued. The GPS data shows I moved ${dp.departureDistanceMeters} meters from the spot, proving my vehicle had already vacated the space.`
          );
          break;
        default:
          paragraphs.push(
            `I have GPS-verified evidence from my vehicle's connected mobile application confirming I departed from the cited location at ${dp.departureTimeFormatted}, which is ${dp.minutesBeforeTicket} minutes before this citation was issued. The GPS shows I moved ${dp.departureDistanceMeters} meters from the parking spot, providing conclusive proof my vehicle was not at this location when the ticket was written.`
          );
      }
    } else if (dp.minutesBeforeTicket > 0) {
      // Non-conclusive but still valuable
      paragraphs.push(
        `My vehicle's connected mobile application detected that I began driving away from this location at ${dp.departureTimeFormatted}, ${dp.minutesBeforeTicket} minutes before this citation was issued. This provides evidence that my vehicle was in the process of departing when the citation was written.`
      );
    }
  }

  // Duration evidence paragraph
  if (evidence.parkingDuration && violationCode === '9-64-140') {
    const pd = evidence.parkingDuration;
    paragraphs.push(
      `GPS records confirm my vehicle was parked at this location for ${pd.durationFormatted} (from ${formatChicagoTime(pd.parkedAt)} to ${formatChicagoTime(pd.clearedAt)}). This documented parking duration demonstrates compliance with posted time restrictions.`
    );
  }

  // Restriction conflict paragraph
  if (evidence.restrictionCapture?.hasConflict) {
    paragraphs.push(
      `Notably, when I parked at this location, my vehicle's parking restriction detection system did not identify the restriction cited on this ticket. ${evidence.restrictionCapture.conflictDescription} This discrepancy suggests the restriction may not have been adequately posted or communicated.`
    );
  }

  // Permit zone support
  if (evidence.restrictionCapture?.permitZone && violationCode === '9-64-070') {
    paragraphs.push(
      `My parking application confirmed this location is in permit zone ${evidence.restrictionCapture.permitZone}${evidence.restrictionCapture.permitSchedule ? ` with the following schedule: ${evidence.restrictionCapture.permitSchedule}` : ''}, consistent with my residential permit for this zone.`
    );
  }

  // Location pattern - subtle mention
  if (evidence.locationPattern?.isRegularLocation) {
    paragraphs.push(
      `I regularly park at this location and am familiar with the parking regulations in this area. My parking records confirm I have parked here on numerous occasions without incident, further supporting that the circumstances of this citation are unusual and likely due to an error or miscommunication.`
    );
  }

  return paragraphs.join('\n\n');
}
