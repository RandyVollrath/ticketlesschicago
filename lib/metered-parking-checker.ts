/**
 * Metered Parking Zone Checker — Street-Based Detection
 *
 * Uses reverse geocoding (Nominatim/OSM) to identify the user's street,
 * then matches against the metered_parking_locations DB by
 * street_name + direction + block range.
 *
 * This approach is immune to GPS drift across streets — a user on Belden Ave
 * will never match meters on nearby Sheffield or Fullerton.
 *
 * Data source: 4,312 active payboxes scraped from map.chicagometers.com (Feb 2026)
 * with block ranges from City of Chicago Schedule 10.
 * Includes per-meter time limits, rates, and enforcement schedules.
 */

import { supabaseAdmin } from './supabase';
import { parseChicagoAddress } from './address-parser';

export interface MeteredParkingStatus {
  /** Whether the user's street+block has metered parking */
  inMeteredZone: boolean;
  /** Distance to nearest meter (null for street-based matching) */
  nearestMeterDistanceM: number | null;
  /** Address of matched meter */
  nearestMeterAddress: string | null;
  /** Total metered spaces on this block */
  nearestMeterSpaces: number | null;
  /** Meter type (CWT = standard, CLZ = commercial loading zone) */
  meterType: string | null;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: 'warning' | 'info' | 'none';
  /** Actual time limit in minutes from meter data */
  timeLimitMinutes: number;
  /** Whether meters are currently enforced based on actual schedule */
  isEnforcedNow: boolean;
  /** Actual hourly rate from meter data */
  estimatedRate: string | null;
}

// ---------------------------------------------------------------------------
// Nominatim reverse-geocode cache (in-memory, per serverless instance)
// ---------------------------------------------------------------------------

const nominatimCache = new Map<string, { address: string; road: string; timestamp: number }>();
const NOMINATIM_CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface NominatimResult {
  /** Full address string like "1022 West Belden Avenue" */
  fullAddress: string;
  /** Raw road name from Nominatim like "West Belden Avenue" */
  road: string;
}

/**
 * Reverse-geocode GPS coordinates to a street address using Nominatim (OSM).
 * Free, no API key needed.  Rate limit: 1 req/sec — fine for parking checks.
 */
async function reverseGeocodeNominatim(
  lat: number,
  lng: number,
): Promise<NominatimResult | null> {
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = nominatimCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < NOMINATIM_CACHE_TTL) {
    return { fullAddress: cached.address, road: cached.road };
  }

  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
      {
        headers: { 'User-Agent': 'TicketlessChicago/1.0 (parking-checker)' },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!resp.ok) return null;
    const data = await resp.json();

    const houseNumber: string | undefined = data.address?.house_number;
    const road: string | undefined = data.address?.road;

    if (!road) return null;

    const fullAddress = houseNumber ? `${houseNumber} ${road}` : road;

    // Evict oldest entries if cache is too big
    if (nominatimCache.size > 500) {
      const oldest = [...nominatimCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 100);
      oldest.forEach(([k]) => nominatimCache.delete(k));
    }
    nominatimCache.set(cacheKey, {
      address: fullAddress,
      road,
      timestamp: Date.now(),
    });

    return { fullAddress, road };
  } catch (err) {
    console.warn('[metered-parking] Nominatim reverse geocode failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Enforcement schedule parser
// ---------------------------------------------------------------------------

interface EnforcementInfo {
  isEnforced: boolean;
  scheduleText: string;
}

/**
 * Parse the enforcement schedule from the meter's rate_description.
 *
 * Examples:
 *   "$2.50, Mon-Sat 8 AM-10 PM, 2 hr POS"  → Mon-Sat 8am–10pm
 *   "$7.00, 24/7, 2 hr POS"                 → always enforced
 *   "$2.50, Mon-Sat 9 AM-6 PM, 2 hr POS"   → Mon-Sat 9am–6pm
 *   "$2.50, Mon-Fri 8 AM-6 PM, 2 hr POS"   → Mon-Fri 8am–6pm
 */
function parseEnforcementSchedule(rateDescription: string): EnforcementInfo {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
  );
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sun … 6 = Sat

  // 24/7 meters (some downtown)
  if (rateDescription.includes('24/7')) {
    return { isEnforced: true, scheduleText: '24/7' };
  }

  // Parse "Mon-Sat X AM-Y PM" / "Mon-Fri …" / "Mon-Sun …"
  const m = rateDescription.match(
    /(Mon-Sat|Mon-Fri|Mon-Sun)\s+(\d{1,2})\s*(AM|PM)\s*-\s*(\d{1,2})\s*(AM|PM)/i,
  );
  if (!m) {
    // Default: Mon-Sat 8am-10pm (most common Chicago schedule)
    if (day === 0) return { isEnforced: false, scheduleText: 'Mon–Sat 8am–10pm' };
    return { isEnforced: hour >= 8 && hour < 22, scheduleText: 'Mon–Sat 8am–10pm' };
  }

  const [, dayRange, startStr, startAP, endStr, endAP] = m;

  let startHour = parseInt(startStr, 10);
  if (startAP.toUpperCase() === 'PM' && startHour !== 12) startHour += 12;
  if (startAP.toUpperCase() === 'AM' && startHour === 12) startHour = 0;

  let endHour = parseInt(endStr, 10);
  if (endAP.toUpperCase() === 'PM' && endHour !== 12) endHour += 12;
  if (endAP.toUpperCase() === 'AM' && endHour === 12) endHour = 0;

  let dayInRange = false;
  switch (dayRange.toLowerCase()) {
    case 'mon-sat':
      dayInRange = day >= 1 && day <= 6;
      break;
    case 'mon-fri':
      dayInRange = day >= 1 && day <= 5;
      break;
    case 'mon-sun':
      dayInRange = true;
      break;
  }

  const isEnforced = dayInRange && hour >= startHour && hour < endHour;
  const scheduleText = `${dayRange} ${startStr}${startAP.toLowerCase()}–${endStr}${endAP.toLowerCase()}`;

  return { isEnforced, scheduleText };
}

// ---------------------------------------------------------------------------
// Main checker
// ---------------------------------------------------------------------------

/**
 * Check if a location is in a metered parking zone.
 *
 * Algorithm:
 *  1. Reverse-geocode GPS → street address  (Nominatim, free)
 *  2. Parse address → (number, direction, street_name)
 *  3. Query DB: street_name + direction + block_start ≤ number ≤ block_end
 *  4. Return actual time limit, rate, and enforcement status
 *
 * This replaces the old radius-based approach that could bleed across streets.
 */
export async function checkMeteredParking(
  latitude: number,
  longitude: number,
): Promise<MeteredParkingStatus> {
  if (!supabaseAdmin) return makeNoMeterResult();

  try {
    // Step 1: Reverse-geocode GPS → street address
    const geocoded = await reverseGeocodeNominatim(latitude, longitude);
    if (!geocoded) {
      console.log('[metered-parking] No address from reverse geocoding');
      return makeNoMeterResult();
    }

    // Step 2: Parse into components
    const parsed = parseChicagoAddress(geocoded.fullAddress);
    if (!parsed || !parsed.name) {
      console.log('[metered-parking] Could not parse address:', geocoded.fullAddress);
      return makeNoMeterResult();
    }

    console.log(
      `[metered-parking] Street match: "${geocoded.fullAddress}" → ` +
        `num=${parsed.number} dir=${parsed.direction} street=${parsed.name}`,
    );

    // Step 3: Query DB by street name + direction + block range
    let query = supabaseAdmin
      .from('metered_parking_locations')
      .select(
        'address, spaces, time_limit_hours, rate, rate_description, is_clz, ' +
          'block_start, block_end, latitude, longitude',
      )
      .eq('status', 'Active')
      .eq('street_name', parsed.name);

    if (parsed.direction) {
      query = query.eq('direction', parsed.direction);
    }

    // Block range: the user's address number must fall within the meter's block
    if (parsed.number) {
      query = query.lte('block_start', parsed.number).gte('block_end', parsed.number);
    }

    const { data: meters, error } = await query.limit(10);

    if (error) {
      console.warn('[metered-parking] DB query error:', error.message);
      return makeNoMeterResult();
    }

    if (!meters || meters.length === 0) {
      console.log(
        `[metered-parking] No meters on ${parsed.direction || ''} ${parsed.name} ` +
          `block ${parsed.number}`,
      );
      return makeNoMeterResult();
    }

    // Side-of-street guard:
    // Chicago address parity corresponds to side of street (even vs odd). Meter paybox
    // address numbers are generally assigned on the side the meters are on.
    //
    // If the user is across the street from the metered side, we should NOT warn.
    // We approximate this by requiring parity match when we have both numbers.
    let candidateMeters = meters;
    if (parsed.number) {
      const userParity = parsed.number % 2;
      const parityMatched = meters.filter((m: any) => {
        const meterParsed = parseChicagoAddress(String(m.address || ''));
        if (!meterParsed?.number) return false;
        return (meterParsed.number % 2) === userParity;
      });

      if (parityMatched.length > 0) {
        console.log(
          `[metered-parking] Parity filter: user ${parsed.number} (${userParity ? 'odd' : 'even'}) ` +
            `kept ${parityMatched.length}/${meters.length} meter candidates`,
        );
        candidateMeters = parityMatched;
      } else {
        console.log(
          `[metered-parking] Parity filter: user ${parsed.number} (${userParity ? 'odd' : 'even'}) ` +
            `kept 0/${meters.length} candidates; falling back to unfiltered meters`,
        );
      }
    }

    // Step 4: Build result with actual data from the matched meter(s)
    // Pick the meter with the most spaces as the representative paybox
    const meter = candidateMeters.reduce(
      (best, m) => ((m.spaces || 0) > (best.spaces || 0) ? m : best),
      candidateMeters[0],
    );

    const enforcement = parseEnforcementSchedule(meter.rate_description || '');
    const timeLimitHours = meter.time_limit_hours || 2;
    const rate = meter.rate ? `$${Number(meter.rate).toFixed(2)}/hr` : null;
    const totalSpaces = meters.reduce((sum, m) => sum + (m.spaces || 0), 0);

    let message: string;
    let severity: 'warning' | 'info';

    if (enforcement.isEnforced) {
      message =
        `Metered parking zone. ${rate}, ${timeLimitHours}-hour max. ` +
        `Feed the meter or risk a $65 ticket.`;
      severity = 'warning';
    } else {
      message =
        `Metered parking zone. Meters not enforced right now. ` +
        `Enforcement: ${enforcement.scheduleText}, ${rate}.`;
      severity = 'info';
    }

    return {
      inMeteredZone: true,
      nearestMeterDistanceM: null, // Street-based matching — distance not applicable
      nearestMeterAddress: meter.address,
      nearestMeterSpaces: totalSpaces,
      meterType: meter.is_clz ? 'CLZ' : 'CWT',
      message,
      severity,
      timeLimitMinutes: timeLimitHours * 60,
      isEnforcedNow: enforcement.isEnforced,
      estimatedRate: rate,
    };
  } catch (err) {
    console.warn('[metered-parking] Check failed:', err);
    return makeNoMeterResult();
  }
}

// ---------------------------------------------------------------------------
// Default "no meter" result
// ---------------------------------------------------------------------------

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
