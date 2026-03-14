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
 * Data source: City of Chicago Dept. of Finance FOIA F126827-020326 (March 2026)
 * 4,849 payboxes with official rates, enforcement schedules, rush hour windows,
 * Sunday hours, seasonal restrictions, and rate zones.
 * GPS coordinates preserved from original chicagometers.com scrape.
 */

import { supabaseAdmin } from './supabase';
import { parseChicagoAddress, ParsedAddress } from './address-parser';

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
  /** Rate zone (1-5) from FOIA data */
  rateZone: number | null;
  /** Whether this is a seasonal meter (Memorial Day–Labor Day only) */
  isSeasonal: boolean;
  /** Rush hour details if applicable */
  rushHourInfo: string | null;
  /** Whether currently in a rush hour window */
  isRushHour: boolean;
  /** Full enforcement schedule breakdown */
  scheduleText: string;
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
// Enforcement schedule parser (FOIA-upgraded)
// ---------------------------------------------------------------------------

interface EnforcementInfo {
  isEnforced: boolean;
  scheduleText: string;
  isRushHour: boolean;
  rushHourInfo: string | null;
  isSeasonal: boolean;
}

/**
 * Parse hour from "12 AM" / "10 PM" / "11:59 PM" format → 0–23.
 */
function parseHour(hourStr: string, ampm: string): number {
  let h = parseInt(hourStr, 10);
  const ap = ampm.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h;
}

/**
 * Check if a day-of-week (0=Sun..6=Sat) falls within a day range string.
 */
function isDayInRange(day: number, dayRange: string): boolean {
  const dr = dayRange.toLowerCase().trim();
  if (dr === 'mon-sun') return true;
  if (dr === 'mon-sat') return day >= 1 && day <= 6;
  if (dr === 'mon-fri') return day >= 1 && day <= 5;
  if (dr === 'sat-sun' || dr === 'sat–sun') return day === 0 || day === 6;
  if (dr === 'sun') return day === 0;
  if (dr === 'sat') return day === 6;
  if (dr === 'fri') return day === 5;
  // Handle individual day names
  const dayNames: { [k: string]: number } = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  if (dayNames[dr] !== undefined) return day === dayNames[dr];
  return false;
}

/**
 * Parse the enforcement schedule from the meter's rate_description.
 *
 * Handles all FOIA formats including:
 *   "$2.50, Mon-Sat 8 AM-10 PM, 2 hr POS"
 *   "$2.50, Mon-Sat 8 AM-10 PM, Sun 10 AM-8 PM, 2 hr POS"
 *   "$14.00, Mon-Sun 12 AM-11:59 PM, RH1: Mon-Fri 7 AM-9 AM, RH2: Mon-Fri 4 PM-6 PM, 2 hr POS"
 *   "$0.50, Fri 6 PM-11 PM, Sat-Sun 8 AM-11 PM, 10 hr POS - Between Memorial Day and Labor Day Only"
 *   "$2.50, Mon-Sat 12 AM-12 AM, Sun 10 AM-8 PM, 6 hr POS, LOT"
 */
function parseEnforcementSchedule(rateDescription: string): EnforcementInfo {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
  );
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sun … 6 = Sat

  // --- Seasonal check ---
  const isSeasonal = /Memorial Day|Labor Day/i.test(rateDescription);
  if (isSeasonal) {
    // Memorial Day is last Monday of May, Labor Day is first Monday of September
    const month = now.getMonth(); // 0-indexed: May=4, Sep=8
    // Rough: active June–August, edge months depend on exact dates
    // Memorial Day: late May. Labor Day: early Sep.
    const isInSeason = month >= 4 && month <= 8; // May through September (generous)
    if (!isInSeason) {
      return {
        isEnforced: false,
        scheduleText: 'Seasonal (Memorial Day–Labor Day only)',
        isRushHour: false,
        rushHourInfo: null,
        isSeasonal: true,
      };
    }
  }

  // --- 24/7 meters ---
  if (rateDescription.includes('24/7') || /12\s*AM\s*-\s*11:59\s*PM/i.test(rateDescription)) {
    // Check rush hours even for 24/7 meters
    const rh = parseRushHours(rateDescription, day, hour);
    return {
      isEnforced: true,
      scheduleText: '24/7',
      isRushHour: rh.isInRushHour,
      rushHourInfo: rh.info,
      isSeasonal,
    };
  }

  // --- "12 AM-12 AM" = 24 hours (midnight to midnight) ---
  if (/12\s*AM\s*-\s*12\s*AM/i.test(rateDescription)) {
    // This is 24-hour enforcement. Check if there's a Sunday override.
    const sundayMatch = rateDescription.match(
      /Sun\s+(\d{1,2})\s*(AM|PM)\s*-\s*(\d{1,2})\s*(AM|PM)/i,
    );

    if (day === 0 && sundayMatch) {
      // Sunday with specific hours
      const sunStart = parseHour(sundayMatch[1], sundayMatch[2]);
      const sunEnd = parseHour(sundayMatch[3], sundayMatch[4]);
      const rh = parseRushHours(rateDescription, day, hour);
      return {
        isEnforced: hour >= sunStart && hour < sunEnd,
        scheduleText: `Mon–Sat 24hr, Sun ${sundayMatch[1]}${sundayMatch[2].toLowerCase()}–${sundayMatch[3]}${sundayMatch[4].toLowerCase()}`,
        isRushHour: rh.isInRushHour,
        rushHourInfo: rh.info,
        isSeasonal,
      };
    }

    // Weekday 24hr enforcement
    const dayRangeMatch = rateDescription.match(/(Mon-Sat|Mon-Fri)/i);
    const mainRange = dayRangeMatch ? dayRangeMatch[1] : 'Mon-Sat';
    const mainDayInRange = isDayInRange(day, mainRange);
    const rh = parseRushHours(rateDescription, day, hour);

    return {
      isEnforced: mainDayInRange,
      scheduleText: `${mainRange} 24hr`,
      isRushHour: rh.isInRushHour,
      rushHourInfo: rh.info,
      isSeasonal,
    };
  }

  // --- Standard format: "DayRange StartTime-EndTime" ---
  // Match all schedule segments (there can be multiple: weekday + Sunday)
  const schedulePattern =
    /(Mon-Sat|Mon-Fri|Mon-Sun|Sat-Sun|Sun|Sat|Fri)\s+(\d{1,2})\s*(AM|PM)\s*-\s*(\d{1,2})\s*(AM|PM)/gi;

  const segments: Array<{
    dayRange: string;
    startHour: number;
    endHour: number;
    text: string;
  }> = [];

  let match;
  while ((match = schedulePattern.exec(rateDescription)) !== null) {
    // Skip rush hour segments (they start with "RH")
    const prefix = rateDescription.substring(Math.max(0, match.index - 5), match.index);
    if (/RH\d*:\s*$/i.test(prefix)) continue;

    const startH = parseHour(match[2], match[3]);
    const endH = parseHour(match[4], match[5]);
    segments.push({
      dayRange: match[1],
      startHour: startH,
      endHour: endH,
      text: `${match[1]} ${match[2]}${match[3].toLowerCase()}–${match[4]}${match[5].toLowerCase()}`,
    });
  }

  if (segments.length === 0) {
    // No parseable schedule — default to Mon-Sat 8am-10pm
    if (day === 0) {
      return {
        isEnforced: false,
        scheduleText: 'Mon–Sat 8am–10pm (default)',
        isRushHour: false,
        rushHourInfo: null,
        isSeasonal,
      };
    }
    return {
      isEnforced: hour >= 8 && hour < 22,
      scheduleText: 'Mon–Sat 8am–10pm (default)',
      isRushHour: false,
      rushHourInfo: null,
      isSeasonal,
    };
  }

  // Check if current time falls within any segment
  let isEnforced = false;
  const scheduleTexts: string[] = [];

  for (const seg of segments) {
    scheduleTexts.push(seg.text);
    if (isDayInRange(day, seg.dayRange)) {
      // Handle overnight/wrap-around schedules (e.g., "8 AM-12 AM" = 8 to 0,
      // or "7 AM-2 AM" = 7 to 2). When endHour <= startHour, the schedule
      // wraps past midnight: enforce if hour >= start OR hour < end.
      if (seg.endHour <= seg.startHour) {
        // Overnight: e.g., 8→0 means 8am to midnight, 7→2 means 7am to 2am
        if (hour >= seg.startHour || hour < seg.endHour) {
          isEnforced = true;
        }
      } else {
        // Normal: e.g., 8→22 means 8am to 10pm
        if (hour >= seg.startHour && hour < seg.endHour) {
          isEnforced = true;
        }
      }
    }
  }

  const rh = parseRushHours(rateDescription, day, hour);

  return {
    isEnforced,
    scheduleText: scheduleTexts.join(', '),
    isRushHour: rh.isInRushHour,
    rushHourInfo: rh.info,
    isSeasonal,
  };
}

/**
 * Parse rush hour windows from rate description.
 *
 * Examples:
 *   "RH1: Mon-Fri 7 AM-9 AM"
 *   "RH1: Mon-Fri 7 AM-9 AM, RH2: Mon-Fri 4 PM-6 PM"
 *   "RH1: Mon-Fri 7 AM-9 AM, RH2: Mon-Fri 4 PM-6 PM, RH3: Mon-Sun 11 PM-5 AM"
 */
function parseRushHours(
  rateDescription: string,
  day: number,
  hour: number,
): { isInRushHour: boolean; info: string | null } {
  const rhPattern =
    /RH\d+:\s*(Mon-Sat|Mon-Fri|Mon-Sun|Sat-Sun)\s+(\d{1,2})\s*(AM|PM)\s*-\s*(\d{1,2})\s*(AM|PM)/gi;

  const windows: Array<{ dayRange: string; startHour: number; endHour: number; text: string }> =
    [];
  let match;

  while ((match = rhPattern.exec(rateDescription)) !== null) {
    const startH = parseHour(match[2], match[3]);
    const endH = parseHour(match[4], match[5]);
    windows.push({
      dayRange: match[1],
      startHour: startH,
      endHour: endH,
      text: `${match[1]} ${match[2]}${match[3].toLowerCase()}–${match[4]}${match[5].toLowerCase()}`,
    });
  }

  if (windows.length === 0) return { isInRushHour: false, info: null };

  let isInRushHour = false;
  for (const w of windows) {
    if (isDayInRange(day, w.dayRange)) {
      // Handle overnight windows (e.g., 11 PM–5 AM)
      if (w.startHour > w.endHour) {
        if (hour >= w.startHour || hour < w.endHour) {
          isInRushHour = true;
        }
      } else if (hour >= w.startHour && hour < w.endHour) {
        isInRushHour = true;
      }
    }
  }

  const infoText = windows.map((w) => w.text).join(', ');
  return { isInRushHour, info: `Rush hours: ${infoText}` };
}

// ---------------------------------------------------------------------------
// Main checker
// ---------------------------------------------------------------------------

/**
 * Check if a location is in a metered parking zone.
 *
 * Algorithm:
 *  1. Use pre-resolved address (from shared Nominatim geocode), or fall back
 *     to internal Nominatim call if not provided
 *  2. Parse address → (number, direction, street_name)
 *  3. Query DB: street_name + direction + block_start ≤ number ≤ block_end
 *  4. Return actual time limit, rate, and enforcement status
 *
 * This replaces the old radius-based approach that could bleed across streets.
 *
 * @param preResolvedAddress  Optional pre-parsed address from the shared reverse
 *   geocoder. When provided, skips the internal Nominatim call — ensuring the
 *   metered parking check uses the SAME address as all other restriction checks.
 */
export async function checkMeteredParking(
  latitude: number,
  longitude: number,
  preResolvedAddress?: ParsedAddress | null,
): Promise<MeteredParkingStatus> {
  if (!supabaseAdmin) return makeNoMeterResult();

  try {
    let parsed: ParsedAddress | null;

    if (preResolvedAddress) {
      // Use the shared address from the unified geocoder — no separate geocode call
      parsed = preResolvedAddress;
      console.log(
        `[metered-parking] Using shared address: num=${parsed.number} dir=${parsed.direction} street=${parsed.name}`,
      );
    } else {
      // Fallback: internal Nominatim call (for standalone usage outside check-parking API)
      const geocoded = await reverseGeocodeNominatim(latitude, longitude);
      if (!geocoded) {
        console.log('[metered-parking] No address from reverse geocoding');
        return makeNoMeterResult();
      }

      parsed = parseChicagoAddress(geocoded.fullAddress);
      if (!parsed || !parsed.name) {
        console.log('[metered-parking] Could not parse address:', geocoded.fullAddress);
        return makeNoMeterResult();
      }

      console.log(
        `[metered-parking] Street match: "${geocoded.fullAddress}" → ` +
          `num=${parsed.number} dir=${parsed.direction} street=${parsed.name}`,
      );
    }

    // Step 3: Query DB by street name + direction + block range
    let query = supabaseAdmin
      .from('metered_parking_locations')
      .select(
        'address, spaces, time_limit_hours, rate, rate_description, is_clz, ' +
          'block_start, block_end, latitude, longitude, rate_zone, is_seasonal, ' +
          'rush_hour_schedule, sunday_schedule, side_of_street',
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
    // Meters only exist on one side — if parity doesn't match, user is on the
    // non-metered side and should not get meter notifications.
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
        // All meters are on the opposite side of the street — user is NOT in a metered zone
        console.log(
          `[metered-parking] Parity filter: user ${parsed.number} (${userParity ? 'odd' : 'even'}) ` +
            `is on the opposite side of the street from ${meters.length} meter(s); not in metered zone`,
        );
        return makeNoMeterResult();
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

    if (enforcement.isSeasonal && !enforcement.isEnforced) {
      message =
        `Seasonal metered parking (Memorial Day–Labor Day only). ` +
        `Free parking right now!`;
      severity = 'info';
    } else if (enforcement.isEnforced) {
      message =
        `Metered parking zone. ${rate}, ${timeLimitHours}-hour max. ` +
        `Feed the meter or risk a $50 ticket.`;
      // Add rush hour warning
      if (enforcement.isRushHour && enforcement.rushHourInfo) {
        message += ` Rush hour restrictions active.`;
      }
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
      rateZone: meter.rate_zone || null,
      isSeasonal: enforcement.isSeasonal,
      rushHourInfo: enforcement.rushHourInfo,
      isRushHour: enforcement.isRushHour,
      scheduleText: enforcement.scheduleText,
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
    rateZone: null,
    isSeasonal: false,
    rushHourInfo: null,
    isRushHour: false,
    scheduleText: '',
  };
}
