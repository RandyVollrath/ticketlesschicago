/**
 * Map a CHI PAY portal `violation_description` string to a violation code
 * (and the contest-kit it maps to).
 *
 * The portal exposes descriptions like "STREET CLEANING", "EXP. METER",
 * "NO CITY STICKER VEH UNDER/EQUAL 16,000 LBS." — these aren't structured
 * codes, so we match by prefix. The patterns here mirror the FOIA bucket
 * logic in scripts/foia-win-rates-by-type.sh which is the canonical
 * source for description → violation type mapping (verified against the
 * Administrative Hearings dataset of 1.2M rows).
 */

export interface ClassifiedViolation {
  violationCode: string | null;
  violationName: string;
  ticketCategory: 'parking' | 'camera' | 'unknown';
}

/**
 * Match a portal description to a violation code.
 *
 * Returns null violationCode when we can't confidently map it — the
 * caller should fall back to the generic contest path (no kit).
 */
export function classifyPortalViolation(
  description: string | null | undefined,
  portalTicketType?: string | null,
): ClassifiedViolation {
  const desc = (description || '').toUpperCase().trim();

  // Camera-enforcement tickets first — these have distinct descriptions
  // and the portal sets ticket_type to "red_light" or "speed_camera".
  if (portalTicketType === 'red_light' || desc.includes('RED LIGHT VIOLATION') || desc === 'RED LIGHT') {
    return { violationCode: '9-102-010', violationName: 'Red Light Camera', ticketCategory: 'camera' };
  }
  if (portalTicketType === 'speed_camera' || desc.startsWith('SPEED VIOLATION') || desc.includes('AUTOMATED SPEED')) {
    return { violationCode: '9-102-020', violationName: 'Speed Camera', ticketCategory: 'camera' };
  }

  // Parking enforcement — match the FOIA bucket patterns
  if (desc.startsWith('STREET CLEAN')) {
    return { violationCode: '9-64-010', violationName: 'Street Cleaning', ticketCategory: 'parking' };
  }
  if (desc.startsWith('NO CITY STICKER') || desc.includes('CITY STICKER')) {
    return { violationCode: '9-64-125', violationName: 'No City Sticker', ticketCategory: 'parking' };
  }
  if (desc.startsWith('EXP. METER') || desc.startsWith('EXPIRED METER') || desc.includes('EXP MTR')) {
    return { violationCode: '9-64-170', violationName: 'Expired Meter', ticketCategory: 'parking' };
  }
  if (desc.startsWith('EXPIRED PLATE') || desc.includes('EXP. PLATE') || desc.includes('EXPIRED REGISTRATION')) {
    return { violationCode: '9-76-160', violationName: 'Expired Plates', ticketCategory: 'parking' };
  }
  if (desc.startsWith('RESIDENTIAL PERMIT')) {
    return { violationCode: '9-64-070', violationName: 'Residential Permit', ticketCategory: 'parking' };
  }
  if (desc.includes('SNOW ROUTE')) {
    return { violationCode: '9-64-100', violationName: 'Snow Route', ticketCategory: 'parking' };
  }
  if (desc.startsWith('DISABLED') || desc.includes('HANDICAP')) {
    return { violationCode: '9-64-180', violationName: 'Disabled / Handicapped Zone', ticketCategory: 'parking' };
  }
  if (desc.startsWith('NO STANDING') || desc.includes('TIME RESTRICT')) {
    return { violationCode: '9-64-140', violationName: 'No Standing / Time-Restricted', ticketCategory: 'parking' };
  }
  if (desc.startsWith('PARKING/STANDING PROHIBITED') || desc.includes('PROHIBITED ANYTIME')) {
    return { violationCode: '9-64-040', violationName: 'Parking Prohibited', ticketCategory: 'parking' };
  }
  if (desc.includes('FIRE HYDRANT')) {
    return { violationCode: '9-64-130', violationName: 'Fire Hydrant', ticketCategory: 'parking' };
  }
  if (desc.includes('BUS LANE')) {
    return { violationCode: '9-12-060', violationName: 'Bus Lane', ticketCategory: 'camera' };
  }
  if (desc.startsWith('DOUBLE PARKING') || desc.includes('DBL PRKG')) {
    return { violationCode: '9-64-110', violationName: 'Double Parking', ticketCategory: 'parking' };
  }
  if (desc.includes('BIKE LANE')) {
    return { violationCode: '9-64-090', violationName: 'Bike Lane', ticketCategory: 'parking' };
  }
  if (desc.includes('BUS STAND') || desc.startsWith('BUS STOP')) {
    return { violationCode: '9-64-050', violationName: 'Bus Stop / Stand', ticketCategory: 'parking' };
  }
  if (desc.includes('ALLEY')) {
    return { violationCode: '9-64-020', violationName: 'Parking in Alley', ticketCategory: 'parking' };
  }
  if (desc.startsWith('MISSING') || desc.includes('NON-COMPLIANT PLATE') || desc.includes('MISSING PLATE')) {
    return { violationCode: '9-80-040', violationName: 'Missing / Non-Compliant Plate', ticketCategory: 'parking' };
  }
  if (desc.includes('COMMERCIAL') || desc.includes('CURB LOADING') || desc.includes('LOADING ZONE')) {
    return { violationCode: '9-64-160', violationName: 'Commercial Loading', ticketCategory: 'parking' };
  }
  if (desc.includes('RUSH HOUR') || desc.includes('RUSH-HOUR')) {
    return { violationCode: '9-64-190', violationName: 'Rush Hour', ticketCategory: 'parking' };
  }
  if (desc.includes('WINTER OVERNIGHT') || desc.includes('WINTER PARKING')) {
    return { violationCode: '9-64-081', violationName: 'Winter Parking Ban', ticketCategory: 'parking' };
  }

  return {
    violationCode: null,
    violationName: description?.trim() || 'Unknown Violation',
    ticketCategory: portalTicketType === 'parking' ? 'parking' : 'unknown',
  };
}
