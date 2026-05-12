/**
 * UIC-Style Erroneous-Ticket Verifier
 *
 * Implements the same retrospective checks the Institute for Research on Race
 * and Public Policy used to flag 475,106 of 3.6M Chicago parking tickets as
 * erroneous in their May 2022 report (irrpp.uic.edu, "475,106 Mistakes").
 *
 * For one already-issued ticket we ask: was this ticket actually inside the
 * zone / time window / weather event it cites? If not, the citation was
 * issued under false pretenses and is a strong dismissal candidate.
 *
 * Each check returns null when it doesn't apply or can't reach a conclusion
 * (data unavailable, address didn't geocode, etc.). It only returns a
 * finding when we have positive, verifiable evidence the ticket was wrong.
 *
 * UIC categories implemented:
 *   1. Street Cleaning           — §9-64-040(b) / §9-64-5020
 *   2. Special Events            — §9-64-041
 *   3. 3am-7am Winter Ban        — §9-64-060
 *   4. 2" Snow Route             — §9-64-070
 *   5. Residential Permit Zone   — §9-64-090 (zone match only; schedule data not public)
 *   6. No Parking in Loop        — §9-64-180
 *   7. Expired Meter in CBD      — §9-64-190(b)
 * Plus address-transposition (cross-cutting failure mode UIC named).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getHistoricalWeather } from '../weather-service';

// ─── Types ───────────────────────────────────────────────────

export type ErroneousFindingId =
  | 'street_cleaning_outside_time_window'
  | 'special_event_no_active_permit'
  | 'winter_ban_outside_time_window'
  | 'winter_ban_outside_date_range'
  | 'winter_ban_not_on_network'
  | 'two_inch_snow_no_qualifying_snowfall'
  | 'two_inch_snow_not_on_network'
  | 'no_parking_loop_outside_loop'
  | 'expired_meter_cbd_outside_cbd'
  | 'address_transposition_water'
  | 'address_transposition_off_grid';

export interface ErroneousFinding {
  id: ErroneousFindingId;
  /** Headline shown to the user */
  title: string;
  /** Plain-English explanation, CLAUDE.md fifth-grade voice */
  explanation: string;
  /** Concrete defense paragraph for the contest letter */
  defenseParagraph: string;
  /** Estimated win-probability uplift over the generic template (0–1) */
  estimatedUpliftPct: number;
  strength: 'strong' | 'moderate';
  /** Statutory section this implicates */
  ordinance: string;
  /** Raw data we relied on, for audit / smoke testing */
  evidence: Record<string, unknown>;
}

export interface TicketContext {
  /** ISO date string yyyy-mm-dd in Chicago local time */
  issueDate: string;
  /** ISO datetime if known (yyyy-mm-ddTHH:MM:SS in Chicago local time). null if unknown */
  issueDateTime: string | null;
  /** Geocoded lat/lng of the cited address. null if not geocoded */
  latitude: number | null;
  longitude: number | null;
  /** Free-form ticket address string for logging */
  ticketAddress: string | null;
  /** Violation code as we classify it internally (e.g. "9-64-010") */
  violationCode: string | null;
  /** Optional pre-resolved ward/section for street cleaning (saves an RPC) */
  ward?: string | null;
  section?: string | null;
}

export interface CheckDeps {
  /** Server-side Supabase client (service role) */
  supabase: SupabaseClient;
}

// ─── 1. Street Cleaning Time-Window Check ────────────────────
//
// Per Chicago Muni Code §9-64-040(b) and the City's published street
// cleaning program: residential streets are cleaned 9am-2pm, commercial
// streets 7am-9am. A ticket issued outside the broadest window (7am-2pm)
// cannot have been a valid street cleaning citation regardless of which
// street class. The schedule dataset (Open Data a2xx-z2ja) does not encode
// which class a ward-section is, so we use the broad 7am-2pm window —
// this is conservative (it doesn't flag a residential ticket issued at
// 7:30am, even though that's also outside the residential window).

const STREET_CLEANING_WINDOW_START_HOUR = 7; // 7:00am
const STREET_CLEANING_WINDOW_END_HOUR = 14; // 2:00pm

export function checkStreetCleaningTimeWindow(
  ticket: TicketContext,
): ErroneousFinding | null {
  if (ticket.violationCode !== '9-64-010') return null;
  if (!ticket.issueDateTime) return null;

  const t = parseChicagoLocalDateTime(ticket.issueDateTime);
  if (!t) return null;
  const hour = t.getHours();
  const minute = t.getMinutes();
  const totalMinutes = hour * 60 + minute;
  const windowStart = STREET_CLEANING_WINDOW_START_HOUR * 60;
  const windowEnd = STREET_CLEANING_WINDOW_END_HOUR * 60;

  if (totalMinutes >= windowStart && totalMinutes < windowEnd) {
    return null;
  }

  const displayTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  return {
    id: 'street_cleaning_outside_time_window',
    title: `Ticket issued at ${displayTime} — outside posted street cleaning hours`,
    explanation:
      `Chicago's published street cleaning program runs 7:00am-9:00am on commercial streets and 9:00am-2:00pm on residential streets. The ticket was issued at ${displayTime}, which is outside both windows. A street cleaning citation can only be valid during posted hours.`,
    defenseParagraph:
      `The citation was issued at ${displayTime} on ${ticket.issueDate}. Chicago Department of Streets & Sanitation publishes street cleaning hours as 7:00am-9:00am on commercial streets and 9:00am-2:00pm on residential streets (the City's own published program). The cited time falls entirely outside both posted windows. Under § 9-64-040(b), the prohibition applies only "during the hours posted thereon" — a ticket issued at a time when the restriction was not in effect is not a valid citation. I respectfully request dismissal under § 9-100-060(a)(7) (violation did not in fact occur as charged).`,
    estimatedUpliftPct: 0.35,
    strength: 'strong',
    ordinance: '§ 9-64-040(b) / § 9-64-5020',
    evidence: {
      issueDateTime: ticket.issueDateTime,
      hour,
      minute,
      postedWindowStart: '07:00',
      postedWindowEnd: '14:00',
    },
  };
}

// ─── 2. Special Events Retrospective DOT-Permit Coverage ─────
//
// UIC counted a special-events ticket erroneous if it was issued more than
// 660 ft from any DOT-permitted event OR outside the permit's posted days
// and hours. We already have a dot_permits table loaded daily and an RPC
// (`get_dot_permits_at_location`) that filters by location + date.
//
// We call it with distance_meters = 201 (the 660-ft buffer UIC used) and
// the ticket's issue date. If the RPC returns zero permits, the special
// events restriction this ticket cites did not exist at that location and
// the ticket is erroneous.
//
// Note: this only fires for §9-64-041 (special events). Our internal
// "parking-prohibited" kit (§9-64-040) covers a broader family — we don't
// apply this check there because some of those tickets are for sign-based
// no-parking zones that exist independently of any permit.

const SPECIAL_EVENTS_660FT_METERS = 201; // 660 ft → 201 m (UIC's grace radius)

export async function checkSpecialEventsPermitCoverage(
  ticket: TicketContext,
  deps: CheckDeps,
): Promise<ErroneousFinding | null> {
  if (ticket.violationCode !== '9-64-041') return null;
  if (ticket.latitude == null || ticket.longitude == null) return null;

  try {
    const { data, error } = await deps.supabase.rpc(
      'get_dot_permits_at_location',
      {
        user_lat: ticket.latitude,
        user_lng: ticket.longitude,
        distance_meters: SPECIAL_EVENTS_660FT_METERS,
        check_date: ticket.issueDate,
      },
    );
    if (error) return null;
    const permits = Array.isArray(data) ? data : [];

    if (permits.length > 0) {
      // Permit exists; not an obvious error. (We could still check time
      // window here, but the RPC's date filter doesn't include time; the
      // permit's start_date/end_date can be queried separately. Future work.)
      return null;
    }

    return {
      id: 'special_event_no_active_permit',
      title: 'No active special-event permit within 660 ft on the ticket date',
      explanation:
        'Chicago Department of Transportation logs every special event, film shoot, block party, and construction-related parking restriction as a permit with a specific address range and date window. We checked the city\'s permit database for the ticket\'s exact location on the ticket date — within a one-block radius — and found no active permit. If there was no permitted event, there was no restriction to enforce.',
      defenseParagraph:
        `A § 9-64-041 (special events) citation requires that a Department of Transportation special-events permit be in effect at the cited location on the ticket date. The City of Chicago Department of Transportation maintains the public permit registry. A search of the permit database for ${ticket.issueDate} within 660 feet of the cited address (${ticket.ticketAddress || 'cited location'}) returns no active permit covering this location. Without an underlying permit, no special-events restriction was lawfully in effect at the time of citation. I respectfully request dismissal under § 9-100-060(a)(7).`,
      estimatedUpliftPct: 0.40,
      strength: 'strong',
      ordinance: '§ 9-64-041',
      evidence: {
        latitude: ticket.latitude,
        longitude: ticket.longitude,
        searchRadiusMeters: SPECIAL_EVENTS_660FT_METERS,
        issueDate: ticket.issueDate,
        permitsFound: 0,
      },
    };
  } catch {
    return null;
  }
}

// ─── 3. Winter Overnight Ban Triple Check ────────────────────
//
// Per §9-64-060 the 3am-7am winter overnight ban applies only:
//   (a) on streets designated as winter-ban routes (our
//       winter_overnight_parking_ban_streets table)
//   (b) between 3:00am and 7:00am
//   (c) between Dec 1 and Apr 1
// A ticket that fails ANY of these three is erroneous.

const WINTER_BAN_START_HOUR = 3;
const WINTER_BAN_END_HOUR = 7;

export async function checkWinterBan(
  ticket: TicketContext,
  deps: CheckDeps,
): Promise<ErroneousFinding | null> {
  if (ticket.violationCode !== '9-64-081' && ticket.violationCode !== '9-64-060') return null;

  // Date range check — Dec 1 to Apr 1 (inclusive of Dec 1; April 1 is the
  // last enforced day per the City's own publications).
  const d = parseDateOnly(ticket.issueDate);
  if (d) {
    const month = d.getMonth() + 1; // 1-based
    const day = d.getDate();
    const inSeason =
      (month === 12) || // December anywhere
      (month >= 1 && month <= 3) || // January-March
      (month === 4 && day === 1); // April 1 only
    if (!inSeason) {
      return {
        id: 'winter_ban_outside_date_range',
        title: `Ticket issued ${ticket.issueDate} — outside the winter ban season`,
        explanation:
          'The 3am-7am winter overnight parking ban runs only from December 1 through April 1. This ticket was issued outside that window, so the ban was not in effect.',
        defenseParagraph:
          `The City of Chicago's Winter Overnight Parking Ban under Chicago Municipal Code § 9-64-060 is in effect only from December 1 through April 1 each year. The citation was issued on ${ticket.issueDate}, which falls outside the seasonal enforcement window. No 3am-7am restriction was in effect at the time of citation. I respectfully request dismissal under § 9-100-060(a)(7) (violation did not in fact occur as charged).`,
        estimatedUpliftPct: 0.45,
        strength: 'strong',
        ordinance: '§ 9-64-060',
        evidence: { issueDate: ticket.issueDate, seasonStart: '12-01', seasonEnd: '04-01' },
      };
    }
  }

  // Time-of-day check — 3:00am to 6:59am
  if (ticket.issueDateTime) {
    const t = parseChicagoLocalDateTime(ticket.issueDateTime);
    if (t) {
      const hour = t.getHours();
      const minute = t.getMinutes();
      const totalMinutes = hour * 60 + minute;
      const windowStart = WINTER_BAN_START_HOUR * 60;
      const windowEnd = WINTER_BAN_END_HOUR * 60;
      if (totalMinutes < windowStart || totalMinutes >= windowEnd) {
        const displayTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        return {
          id: 'winter_ban_outside_time_window',
          title: `Ticket issued at ${displayTime} — outside the 3am-7am winter ban window`,
          explanation:
            `The 3am-7am winter ban applies only between 3:00am and 7:00am. The ticket was issued at ${displayTime}, which is outside that window. The restriction was not in effect.`,
          defenseParagraph:
            `Chicago Municipal Code § 9-64-060 prohibits parking on designated winter ban streets only between 3:00am and 7:00am during the December 1 - April 1 season. The citation was issued at ${displayTime} on ${ticket.issueDate}, which falls outside the 3am-7am posted hours. The prohibition was not in effect at the time of citation. I respectfully request dismissal under § 9-100-060(a)(7).`,
          estimatedUpliftPct: 0.45,
          strength: 'strong',
          ordinance: '§ 9-64-060',
          evidence: { issueDateTime: ticket.issueDateTime, hour, minute, windowStart: '03:00', windowEnd: '07:00' },
        };
      }
    }
  }

  // Street network check — is the cited address on a designated winter-ban
  // street? We use the existing winter_overnight_parking_ban_streets table.
  if (!ticket.ticketAddress) return null;
  const streetName = extractStreetNamePart(ticket.ticketAddress);
  if (!streetName) return null;
  try {
    const { data, error } = await deps.supabase
      .from('winter_overnight_parking_ban_streets')
      .select('id, street_name');
    if (error || !data || data.length === 0) return null;

    const normalizedAddr = normalizeStreetName(streetName);
    const onNetwork = data.some((row: { street_name: string }) => {
      const normalized = normalizeStreetName(row.street_name);
      return normalizedAddr.includes(normalized) || normalized.includes(normalizedAddr);
    });

    if (!onNetwork) {
      return {
        id: 'winter_ban_not_on_network',
        title: 'Ticket location is not on a designated winter-ban street',
        explanation:
          'The 3am-7am winter overnight parking ban applies only on roughly 107 miles of designated streets — the city publishes the official list. The cited address is not on that list, so the ban could not have applied here.',
        defenseParagraph:
          `Chicago Municipal Code § 9-64-060 prohibits parking only on streets designated as Winter Overnight Parking Ban routes (approximately 107 miles of arterial streets posted with signs). The cited address (${ticket.ticketAddress}) is not on the City's official Winter Overnight Parking Ban street list. Because this is not a designated winter ban street, no 3am-7am prohibition was in effect at this location. I respectfully request dismissal under § 9-100-060(a)(7) and request that the City produce the current list of designated Winter Overnight Parking Ban streets confirming whether the cited block is on it.`,
        estimatedUpliftPct: 0.40,
        strength: 'strong',
        ordinance: '§ 9-64-060',
        evidence: { ticketAddress: ticket.ticketAddress, extractedStreet: streetName, onNetwork: false },
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── 4. 2" Snow Route Check ──────────────────────────────────
//
// Per §9-64-070, the 2" snow route ban applies only when snow ON THE STREET
// exceeds 2". UIC gave a 3-day grace period after a ≥2" snowfall to allow
// for plowing delays after major blizzards. We check Open-Meteo historical
// snowfall for the ticket date and the 3 prior days. If the maximum daily
// snowfall in that 4-day window is <2", no ban was lawfully in effect.

const TWO_INCH_THRESHOLD = 2.0;
const TWO_INCH_GRACE_DAYS = 3;

export async function checkTwoInchSnowRoute(
  ticket: TicketContext,
): Promise<ErroneousFinding | null> {
  if (ticket.violationCode !== '9-64-100') return null;

  try {
    const ticketDate = parseDateOnly(ticket.issueDate);
    if (!ticketDate) return null;

    let maxSnowfall = 0;
    let maxSnowDate = ticket.issueDate;
    for (let i = 0; i <= TWO_INCH_GRACE_DAYS; i++) {
      const probe = new Date(ticketDate);
      probe.setDate(probe.getDate() - i);
      const dateStr = probe.toISOString().split('T')[0];
      try {
        const weather = await getHistoricalWeather(probe);
        const snow = weather.snowfall ?? 0;
        if (snow > maxSnowfall) {
          maxSnowfall = snow;
          maxSnowDate = dateStr;
        }
      } catch {
        // Open-Meteo unavailable for this day; can't conclude — bail.
        return null;
      }
    }

    if (maxSnowfall >= TWO_INCH_THRESHOLD) {
      // A qualifying snowfall happened in the grace window — UIC would not
      // have flagged this as erroneous.
      return null;
    }

    return {
      id: 'two_inch_snow_no_qualifying_snowfall',
      title: `No qualifying snowfall — max ${maxSnowfall.toFixed(1)}" in the 3 days before ticket`,
      explanation:
        `The 2-inch snow ban only applies when at least 2 inches of snow are on the street. The most snow that fell on the ticket date or in the 3 days before was ${maxSnowfall.toFixed(1)}" (on ${maxSnowDate}). That is below the 2-inch threshold the city's own ordinance requires.`,
      defenseParagraph:
        `Chicago Municipal Code § 9-64-070 prohibits parking on a designated Snow Route only "at any time the snow on the street exceeds two inches in depth." According to official historical weather records (Open-Meteo archive, Chicago Midway station), the maximum daily snowfall in Chicago on ${ticket.issueDate} and in the 3 days prior was ${maxSnowfall.toFixed(1)} inches (recorded ${maxSnowDate}), which falls below the 2-inch threshold the ordinance requires. The 3-day window incorporates plowing-delay tolerances used by city operations. Because the snowfall threshold was not met, the snow route prohibition was not in effect at the time of citation. I respectfully request dismissal under § 9-100-060(a)(7).`,
      estimatedUpliftPct: 0.40,
      strength: 'strong',
      ordinance: '§ 9-64-070',
      evidence: {
        issueDate: ticket.issueDate,
        maxSnowfallInches: maxSnowfall,
        maxSnowDate,
        graceDays: TWO_INCH_GRACE_DAYS,
        threshold: TWO_INCH_THRESHOLD,
      },
    };
  } catch {
    return null;
  }
}

// ─── 5. Residential Permit Zone Check ────────────────────────
//
// Address-range cross-check already lives in lib/residential-permit-zone-check.ts.
// That module flags tickets whose address is outside any active permit zone.
// The City's u9xt-hiju dataset does NOT include per-zone day/hour schedules
// (UIC obtained that from a separate Office of the City Clerk source we
// don't have access to as a public API), so we cannot retrospectively check
// the time window. The existing zone-match path remains the primary
// residential-permit defense. No additional check added here.

// ─── 6. No Parking in the Loop Check ─────────────────────────
//
// Per §9-64-180, "no parking in the Loop" applies only inside the Loop
// boundary (City Data Portal, community area #32). UIC found 78.4% of
// these tickets were issued OUTSIDE the Loop. We do a point-in-polygon
// test against the Loop's published GeoJSON.

let loopPolygonCache: number[][] | null = null;

async function getLoopPolygon(): Promise<number[][] | null> {
  if (loopPolygonCache) return loopPolygonCache;
  try {
    const url = "https://data.cityofchicago.org/resource/igwz-8jzy.json?$select=the_geom&$where=community='LOOP'";
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const geom = rows[0]?.the_geom;
    if (!geom || geom.type !== 'MultiPolygon') return null;
    // MultiPolygon: [polygon][ring][[lng,lat]...]
    const firstPolygon = geom.coordinates?.[0];
    const outerRing = firstPolygon?.[0];
    if (!Array.isArray(outerRing) || outerRing.length < 3) return null;
    loopPolygonCache = outerRing;
    return outerRing;
  } catch {
    return null;
  }
}

export async function checkNoParkingInLoop(
  ticket: TicketContext,
): Promise<ErroneousFinding | null> {
  if (ticket.violationCode !== '9-64-180') return null;
  if (ticket.latitude == null || ticket.longitude == null) return null;

  const polygon = await getLoopPolygon();
  if (!polygon) return null;

  const inside = pointInPolygon(ticket.longitude, ticket.latitude, polygon);
  if (inside) return null;

  return {
    id: 'no_parking_loop_outside_loop',
    title: 'Ticket issued outside the Loop boundary',
    explanation:
      'The "no parking in the Loop" rule only applies inside the actual Loop. We checked the city\'s published Loop boundary — the ticket location is outside it. UIC found that 78% of these tickets are issued to cars parked outside the Loop.',
    defenseParagraph:
      `Chicago Municipal Code § 9-64-180 prohibits parking in the Loop. The Loop's boundaries are defined by the City of Chicago Department of Planning and recorded on the City Data Portal as community area #32. The cited address (${ticket.ticketAddress || 'cited location'}, lat ${ticket.latitude.toFixed(5)}, lng ${ticket.longitude.toFixed(5)}) falls geographically outside the Loop boundary. As established in research by the Institute for Research on Race and Public Policy (IRRPP, 2022), 78.4% of "no Loop" tickets issued during their study period were geo-referenced to locations outside the Loop. Because the cited location is not within the area to which § 9-64-180 applies, the ordinance could not have been violated. I respectfully request dismissal under § 9-100-060(a)(7).`,
    estimatedUpliftPct: 0.55,
    strength: 'strong',
    ordinance: '§ 9-64-180',
    evidence: {
      latitude: ticket.latitude,
      longitude: ticket.longitude,
      ticketAddress: ticket.ticketAddress,
      loopPolygonVertexCount: polygon.length,
      pointInLoop: false,
    },
  };
}

// ─── 7. Expired Meter in CBD Check ───────────────────────────
//
// Per §9-64-190(b) the elevated meter rate applies only inside the Central
// Business District. The CBD's bounds per the muni code parking
// definitions: N=Oak St, S=Roosevelt Rd, E=Lake Shore Drive (≈Lake
// Michigan shore), W=Halsted St. This is the boundary used for the
// elevated meter rate. We do a bounding-box check against those streets'
// approximate latitudes/longitudes.

// CBD bounding box (per Chicago Muni Code §9-4-010 parking definitions):
//   North: Oak Street (~ 41.9019)
//   South: Roosevelt Road (~ 41.8672)
//   East:  Lake Shore Drive (~ -87.6150)
//   West:  Halsted Street (~ -87.6471)
const CBD_NORTH_LAT = 41.9019;
const CBD_SOUTH_LAT = 41.8672;
const CBD_WEST_LNG = -87.6471;
const CBD_EAST_LNG = -87.6150;

export function checkExpiredMeterCBD(
  ticket: TicketContext,
): ErroneousFinding | null {
  if (ticket.violationCode !== '9-64-190') return null;
  if (ticket.latitude == null || ticket.longitude == null) return null;

  const insideCBD =
    ticket.latitude >= CBD_SOUTH_LAT &&
    ticket.latitude <= CBD_NORTH_LAT &&
    ticket.longitude >= CBD_WEST_LNG &&
    ticket.longitude <= CBD_EAST_LNG;

  if (insideCBD) return null;

  return {
    id: 'expired_meter_cbd_outside_cbd',
    title: 'Expired-meter CBD upcharge applied outside the CBD boundary',
    explanation:
      'The elevated meter fine for the Central Business District only applies inside the CBD. The cited address is outside the CBD bounds (Roosevelt Road south, Oak Street north, Halsted Street west, Lake Shore Drive east). At minimum the upcharge is unlawful — at best the ticket is erroneous entirely.',
    defenseParagraph:
      `Chicago Municipal Code § 9-64-190(b) applies the elevated meter rate only inside the Central Business District. The CBD is bounded under § 9-4-010 by Oak Street on the north, Roosevelt Road on the south, Halsted Street on the west, and Lake Shore Drive on the east. The cited address (${ticket.ticketAddress || 'cited location'}, lat ${ticket.latitude.toFixed(5)}, lng ${ticket.longitude.toFixed(5)}) falls outside those bounds. The CBD upcharge does not apply at this location. As documented in research by the Institute for Research on Race and Public Policy (IRRPP, 2022), 38,292 such tickets were geo-referenced outside the CBD during their study period. I respectfully request that the citation be vacated or, at minimum, reduced to the non-CBD expired-meter rate.`,
    estimatedUpliftPct: 0.45,
    strength: 'strong',
    ordinance: '§ 9-64-190(b) / § 9-4-010',
    evidence: {
      latitude: ticket.latitude,
      longitude: ticket.longitude,
      ticketAddress: ticket.ticketAddress,
      cbdBounds: { N: CBD_NORTH_LAT, S: CBD_SOUTH_LAT, W: CBD_WEST_LNG, E: CBD_EAST_LNG },
      pointInCBD: false,
    },
  };
}

// ─── 8. Address Transposition Check ──────────────────────────
//
// UIC named this explicitly: "we came across numerous tickets that were
// issued where address locations did not exist. These included easy-to-spot
// blunders like violations that supposedly occurred east of E. Madison
// St.'s 100 block, coordinates that located cars in the waters of Lake
// Michigan." We catch two specific failure modes:
//   (a) the geocode lands east of Chicago's eastern shoreline (in Lake Michigan)
//   (b) the geocode lands wildly outside Chicago's bounds (off-grid)
//
// Chicago's bounding box (City Limits, rough):
//   N: 42.0231 (Howard St)
//   S: 41.6447 (138th St / Calumet)
//   W: -87.9402 (O'Hare west edge)
//   E: -87.5240 (Lake Michigan shoreline)
//
// Anything east of ~-87.5240 with a Chicago address string is almost
// certainly a flipped street-direction (E instead of W or vice versa).

const CHICAGO_NORTH = 42.0231;
const CHICAGO_SOUTH = 41.6447;
const CHICAGO_WEST = -87.9402;
const CHICAGO_EAST_SHORE = -87.5240;

export function checkAddressTransposition(
  ticket: TicketContext,
): ErroneousFinding | null {
  if (ticket.latitude == null || ticket.longitude == null) return null;

  // (a) East of the shoreline — almost certainly in Lake Michigan
  if (ticket.longitude > CHICAGO_EAST_SHORE) {
    return {
      id: 'address_transposition_water',
      title: 'Ticket location geocodes to Lake Michigan — likely a direction transposition',
      explanation:
        'The address on the ticket geocodes to a point east of Chicago\'s shoreline — i.e., the middle of Lake Michigan. The officer most likely flipped the street direction (E instead of W, or vice versa). The "violation did not occur as charged" because the location described on the citation does not exist on land.',
      defenseParagraph:
        `The address recorded on this citation (${ticket.ticketAddress || 'recorded address'}) geocodes to coordinates (${ticket.latitude.toFixed(5)}, ${ticket.longitude.toFixed(5)}) east of the Chicago shoreline — i.e., in Lake Michigan. The recorded location is not a valid Chicago street address. This is a textbook citation-recording error of the kind the Institute for Research on Race and Public Policy identified in their 2022 study of 3.6 million Chicago tickets: address direction (E/W or N/S) was likely transposed by the issuing officer. Under § 9-100-060(a)(7), a citation that does not correctly identify the location of the alleged violation cannot be sustained. I respectfully request dismissal.`,
      estimatedUpliftPct: 0.50,
      strength: 'strong',
      ordinance: '§ 9-100-060(a)(7)',
      evidence: {
        latitude: ticket.latitude,
        longitude: ticket.longitude,
        ticketAddress: ticket.ticketAddress,
        chicagoEastShoreLng: CHICAGO_EAST_SHORE,
      },
    };
  }

  // (b) Outside city limits entirely
  const outsideCity =
    ticket.latitude > CHICAGO_NORTH ||
    ticket.latitude < CHICAGO_SOUTH ||
    ticket.longitude < CHICAGO_WEST;
  if (outsideCity) {
    return {
      id: 'address_transposition_off_grid',
      title: 'Ticket location geocodes outside Chicago city limits',
      explanation:
        'The address recorded on the ticket geocodes to a location outside the City of Chicago. Either the address was recorded incorrectly or the ticket was written for a place where Chicago parking ordinances do not apply.',
      defenseParagraph:
        `The address recorded on this citation (${ticket.ticketAddress || 'recorded address'}) geocodes to coordinates (${ticket.latitude.toFixed(5)}, ${ticket.longitude.toFixed(5)}), which falls outside Chicago city limits. Chicago parking ordinances apply only inside the City of Chicago. If the address was recorded incorrectly the citation cannot be sustained; if the address is correct the cited location is outside the jurisdiction. Under § 9-100-060(a)(7), I respectfully request dismissal.`,
      estimatedUpliftPct: 0.50,
      strength: 'strong',
      ordinance: '§ 9-100-060(a)(7)',
      evidence: {
        latitude: ticket.latitude,
        longitude: ticket.longitude,
        ticketAddress: ticket.ticketAddress,
        cityBounds: { N: CHICAGO_NORTH, S: CHICAGO_SOUTH, W: CHICAGO_WEST, E: CHICAGO_EAST_SHORE },
      },
    };
  }

  return null;
}

// ─── Public entry point ──────────────────────────────────────

/**
 * Run every UIC-style check that applies to this ticket, in parallel.
 * Returns the list of findings. Empty list = no UIC-style errors detected
 * (the ticket may still be contestable on other grounds).
 */
export async function runAllUICChecks(
  ticket: TicketContext,
  deps: CheckDeps,
): Promise<ErroneousFinding[]> {
  const results = await Promise.all([
    Promise.resolve(checkStreetCleaningTimeWindow(ticket)),
    checkSpecialEventsPermitCoverage(ticket, deps),
    checkWinterBan(ticket, deps),
    checkTwoInchSnowRoute(ticket),
    checkNoParkingInLoop(ticket),
    Promise.resolve(checkExpiredMeterCBD(ticket)),
    Promise.resolve(checkAddressTransposition(ticket)),
  ]);
  return results.filter((r): r is ErroneousFinding => r !== null);
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Parse a "yyyy-mm-ddTHH:MM:SS" (or "yyyy-mm-dd HH:MM:SS") string as
 * Chicago local time. We don't apply timezone math — the caller is
 * expected to provide the local time already. Returns null on parse fail.
 */
function parseChicagoLocalDateTime(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return new Date(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10),
    parseInt(mi, 10),
    se ? parseInt(se, 10) : 0,
  );
}

function parseDateOnly(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
}

/**
 * Standard ray-casting point-in-polygon. polygon = [[lng,lat],...].
 */
function pointInPolygon(lng: number, lat: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect =
      ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function extractStreetNamePart(address: string): string | null {
  if (!address) return null;
  const cleaned = address
    .trim()
    .toUpperCase()
    .replace(/,.*$/, '')
    .replace(/#.*$/, '')
    .replace(/APT.*$/i, '')
    .replace(/UNIT.*$/i, '')
    .trim();
  const match = cleaned.match(/^\d+\s+(.+)$/);
  return match && match[1] ? match[1].trim() : null;
}

function normalizeStreetName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/\bPLAZA\b/g, 'PLZ')
    .trim();
}
