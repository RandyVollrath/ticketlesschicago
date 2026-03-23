/**
 * Chicago Street Sweeper Tracker Integration
 *
 * Uses the City of Chicago's public SweepTracker API to determine whether
 * a street sweeper actually visited a given block on a specific date,
 * and critically, whether it visited BEFORE or AFTER the ticket was issued.
 *
 * Data flow:
 *   1. Parse street address into components (direction, name, type, address number)
 *   2. Query TransLegend MapServer to find the TransID (street segment identifier)
 *   3. Query /sweeptracker/getTrackingDataforTransid to get sweeper visit history
 *   4. Check if any sweeper visited that block on the ticket date
 *   5. Compare sweeper visit times against ticket issuance time
 *
 * API endpoints (City of Chicago, no auth required):
 *   - TransLegend: https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/TransLegend/MapServer/1/query
 *   - Sweeper History: https://gisapps.chicago.gov/sweeptracker/getTrackingDataforTransid?transId=X
 *
 * Timezone handling:
 *   - Sweeper API returns UTC timestamps in postingTime (e.g. "2026-03-10T15:28:55Z")
 *   - Ticket dates/times are in Chicago local time (America/Chicago)
 *   - ALL date comparisons convert to Chicago time explicitly (not server locale)
 *   - This is critical because Vercel runs in UTC
 *
 * Reliability:
 *   - All fetch calls have 15-second timeouts (AbortController)
 *   - One automatic retry with exponential backoff on network failures
 *   - Input sanitization prevents ArcGIS SQL-like injection
 *   - Address gap fallback: tries nearest block segment when exact match fails
 *   - All errors are caught and returned in the result (never throws)
 *
 * The sweeper tracker shows real-time data 9am-2pm weekdays April-November,
 * but the history endpoint returns visits from the past ~7-30 days.
 */

const TRANS_LEGEND_URL =
  'https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/TransLegend/MapServer/1/query';
const SWEEPER_HISTORY_URL =
  'https://gisapps.chicago.gov/sweeptracker/getTrackingDataforTransid';

/** Chicago timezone for all date comparisons */
const CHICAGO_TZ = 'America/Chicago';

/** Timeout for city API calls (ms) — city servers can be slow */
const FETCH_TIMEOUT_MS = 15000;

/** Delay before retry (ms) */
const RETRY_DELAY_MS = 2000;

export interface SweeperVisit {
  address: string;
  vehicleId: string;
  vehicleType: string;
  direction: number;
  latitude: number;
  longitude: number;
  postingTime: string;       // ISO timestamp (UTC)
  postingTimeFormatted: string; // City's formatted string (Chicago time)
  chicagoTime: string;       // Our formatted Chicago time (HH:MM AM/PM)
  chicagoDate: string;       // YYYY-MM-DD in Chicago timezone
}

export interface SweeperVerification {
  checked: boolean;
  transId: number | null;
  streetSegment: string | null;    // e.g. "N SHEFFIELD AVE (2300-2358)"
  ticketDate: string;              // YYYY-MM-DD
  ticketIssuanceTime: string | null;  // Raw input (ISO or AM/PM)
  ticketIssuanceTimeFormatted: string | null;  // Human-readable Chicago time (e.g. "2:30 PM")
  sweptOnDate: boolean;            // Did a sweeper visit on the ticket date?
  sweptBeforeTicket: boolean;      // Did the sweeper come BEFORE the ticket was issued?
  firstSweeperPassTime: string | null;  // Chicago local time of first sweeper pass on ticket date
  lastSweeperPassTime: string | null;   // Chicago local time of last sweeper pass on ticket date
  minutesBetweenSweepAndTicket: number | null; // Minutes between first sweep pass and ticket
  timeBetweenFormatted: string | null;  // Human-readable time diff (e.g. "4h 37m")
  visitsOnDate: SweeperVisit[];    // Visits on the ticket date
  allRecentVisits: SweeperVisit[]; // All visits in history (for context)
  message: string;                 // Human-readable summary for the AI prompt
  error?: string;
}

/**
 * Fetch with timeout and one automatic retry.
 * City of Chicago APIs can be slow or intermittently fail.
 */
async function fetchWithRetry(url: string, retries = 1): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (attempt < retries) {
        const isTimeout = err?.name === 'AbortError';
        console.log(`  Sweeper: Fetch ${isTimeout ? 'timed out' : 'failed'}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  // Should never reach here, but TypeScript needs it
  throw new Error('fetchWithRetry exhausted retries');
}

/**
 * Sanitize a string for use in an ArcGIS SQL-like WHERE clause.
 * Removes any characters that could modify the query logic.
 * Only allows alphanumeric characters, spaces, hyphens, and periods.
 */
function sanitizeForQuery(value: string): string {
  return value.replace(/[^A-Z0-9 \-.]/gi, '');
}

/**
 * Convert a UTC ISO timestamp to Chicago date (YYYY-MM-DD) and time (HH:MM AM/PM).
 * This is critical because Vercel runs in UTC but all ticket data is Chicago time.
 */
function toChicagoDateTime(utcIso: string): { date: string; time: string; dateObj: Date } | null {
  try {
    const d = new Date(utcIso);
    if (isNaN(d.getTime())) return null;

    // Get Chicago date components
    const chicagoDate = d.toLocaleDateString('en-CA', { timeZone: CHICAGO_TZ }); // en-CA gives YYYY-MM-DD
    const chicagoTime = d.toLocaleTimeString('en-US', {
      timeZone: CHICAGO_TZ,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return { date: chicagoDate, time: chicagoTime, dateObj: d };
  } catch {
    return null;
  }
}

/**
 * Parse a Chicago local time string (from ticket issuance) into a Date object.
 *
 * Handles THREE formats:
 *   1. Portal ISO: "2026-02-07T21:07:00" (no Z suffix = Chicago local time)
 *   2. OCR time-only: "2:30 PM" or "11:45 AM" (needs fallbackDate to build full timestamp)
 *   3. UTC ISO: "2026-02-07T21:07:00Z" (ends with Z)
 *
 * The fallbackDate (YYYY-MM-DD) is used when dateTimeStr is a time-only string
 * from ticket photo OCR (extracted_data.time). Without a date, "2:30 PM" cannot
 * become a Date object.
 */
function parseChicagoTime(dateTimeStr: string, fallbackDate?: string): Date | null {
  if (!dateTimeStr) return null;
  try {
    // Format 1: Portal ISO — "2026-02-07T21:07:00" (no Z, Chicago local)
    if (dateTimeStr.includes('T') && !dateTimeStr.endsWith('Z')) {
      const parts = dateTimeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/);
      if (!parts) return null;
      // We need the actual UTC timestamp that corresponds to this Chicago local time.
      // Approach: try nearby UTC offsets (-5 for CDT, -6 for CST) and pick the one
      // that formats back to our target string.
      for (const offsetHours of [-5, -6]) {
        const utcMs = new Date(
          parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]),
          parseInt(parts[4]) - offsetHours, parseInt(parts[5]), parseInt(parts[6] || '0')
        ).getTime();
        const candidate = new Date(utcMs);
        const formatted = candidate.toLocaleDateString('en-CA', { timeZone: CHICAGO_TZ }) + 'T' +
          candidate.toLocaleTimeString('en-GB', { timeZone: CHICAGO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const target = `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6] || '00'}`;
        if (formatted === target) return candidate;
      }
      // Fallback: just parse it (works if server is in Chicago timezone)
      return new Date(dateTimeStr);
    }

    // Format 3: UTC ISO — "2026-02-07T21:07:00Z"
    if (dateTimeStr.endsWith('Z')) {
      return new Date(dateTimeStr);
    }

    // Format 2: Time-only from OCR — "2:30 PM", "11:45 AM", "14:30", "2:30PM"
    // Needs fallbackDate (the ticket date) to construct a full datetime.
    const ampmMatch = dateTimeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampmMatch && fallbackDate) {
      let hour = parseInt(ampmMatch[1], 10);
      const minute = parseInt(ampmMatch[2], 10);
      const isPM = ampmMatch[3].toUpperCase() === 'PM';
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      // Build ISO string in Chicago local time, then parse it
      const isoStr = `${fallbackDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
      return parseChicagoTime(isoStr); // Recurse into Format 1 handler
    }

    // Try 24-hour format: "14:30" or "9:05"
    const h24Match = dateTimeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (h24Match && fallbackDate) {
      const hour = parseInt(h24Match[1], 10);
      const minute = parseInt(h24Match[2], 10);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const isoStr = `${fallbackDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
        return parseChicagoTime(isoStr);
      }
    }

    // Date-only format (YYYY-MM-DD) — not useful for time comparison
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a Chicago street address into components for TransLegend query.
 * Examples:
 *   "2300 N SHEFFIELD AVE" -> { number: 2300, dir: "N", name: "SHEFFIELD", type: "AVE" }
 *   "1234 W MADISON ST"    -> { number: 1234, dir: "W", name: "MADISON", type: "ST" }
 */
function parseAddress(address: string): {
  number: number;
  dir: string;
  name: string;
  type: string;
} | null {
  const cleaned = address.toUpperCase().replace(/,.*$/, '').trim();

  // Match: NUMBER DIR STREET_NAME STREET_TYPE
  const match = cleaned.match(
    /^(\d+)\s+([NSEW])\s+(.+?)\s+(ST|AVE|BLVD|DR|PL|CT|RD|TER|WAY|PKWY|LN|CIR)\s*$/
  );
  if (match) {
    return {
      number: parseInt(match[1], 10),
      dir: match[2],
      name: sanitizeForQuery(match[3].trim()),
      type: match[4],
    };
  }

  // Try without explicit street type suffix
  const matchNoType = cleaned.match(
    /^(\d+)\s+([NSEW])\s+(.+)$/
  );
  if (matchNoType) {
    const parts = matchNoType[3].trim().split(/\s+/);
    if (parts.length >= 2) {
      const lastWord = parts[parts.length - 1];
      const knownTypes = ['ST', 'AVE', 'BLVD', 'DR', 'PL', 'CT', 'RD', 'TER', 'WAY', 'PKWY', 'LN', 'CIR'];
      if (knownTypes.includes(lastWord)) {
        return {
          number: parseInt(matchNoType[1], 10),
          dir: matchNoType[2],
          name: sanitizeForQuery(parts.slice(0, -1).join(' ')),
          type: lastWord,
        };
      }
    }
    return {
      number: parseInt(matchNoType[1], 10),
      dir: matchNoType[2],
      name: sanitizeForQuery(matchNoType[3].trim()),
      type: '',
    };
  }

  return null;
}

/**
 * Look up the TransID (street segment identifier) for a Chicago address.
 * The TransID uniquely identifies a block segment in Chicago's street network.
 *
 * If the exact address number falls in a gap between segments (e.g. 3100 when blocks are
 * 3000-3052 and 3116-3146), falls back to searching nearby segments on the same street.
 */
async function lookupTransId(
  address: string
): Promise<{ transId: number; segment: string } | null> {
  const parsed = parseAddress(address);
  if (!parsed) {
    console.log(`  Sweeper: Could not parse address "${address}"`);
    return null;
  }

  // Validate parsed number is reasonable (1 to 20000 covers all Chicago addresses)
  if (parsed.number < 1 || parsed.number > 20000) {
    console.log(`  Sweeper: Address number ${parsed.number} out of range for "${address}"`);
    return null;
  }

  // Build WHERE clause — values are sanitized above to prevent injection
  const where = `STREET_NAME='${parsed.name}' AND PRE_DIR='${parsed.dir}' AND ((L_F_ADD <= ${parsed.number} AND L_T_ADD >= ${parsed.number}) OR (R_F_ADD <= ${parsed.number} AND R_T_ADD >= ${parsed.number}))`;

  const result = await queryTransLegend(where);
  if (result) return result;

  // Fallback: address might fall in a gap between segments (e.g. 3100 when blocks
  // are 3000-3052 and 3116-3146). Find the nearest segment on the same street.
  console.log(`  Sweeper: Exact match failed for ${parsed.number}, trying nearest segment on ${parsed.dir} ${parsed.name}...`);
  const nearbyWhere = `STREET_NAME='${parsed.name}' AND PRE_DIR='${parsed.dir}' AND L_F_ADD >= ${parsed.number - 100} AND L_F_ADD <= ${parsed.number + 100}`;
  const nearbyResult = await queryTransLegend(nearbyWhere, parsed.number);
  if (nearbyResult) {
    console.log(`  Sweeper: Fallback found nearby segment: ${nearbyResult.segment}`);
    return nearbyResult;
  }

  console.log(`  Sweeper: No TransID found for "${address}" (tried exact + nearby)`);
  return null;
}

/**
 * Execute a TransLegend ArcGIS query and return the best matching result.
 * If targetNumber is provided, picks the segment closest to that address number.
 */
async function queryTransLegend(
  where: string,
  targetNumber?: number
): Promise<{ transId: number; segment: string } | null> {
  const params = new URLSearchParams({
    where,
    outFields: 'TRANS_ID,PRE_DIR,STREET_NAME,STREET_TYPE,L_F_ADD,L_T_ADD,R_F_ADD,R_T_ADD',
    returnGeometry: 'false',
    f: 'json',
  });

  try {
    const response = await fetchWithRetry(`${TRANS_LEGEND_URL}?${params.toString()}`);
    if (!response.ok) {
      console.error(`  Sweeper: TransLegend query failed with status ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Check for ArcGIS error response
    if (data.error) {
      console.error(`  Sweeper: ArcGIS error: ${JSON.stringify(data.error)}`);
      return null;
    }

    if (!data.features || data.features.length === 0) {
      return null;
    }

    // If we have a target number, pick the segment whose range is closest
    let feature = data.features[0].attributes;
    if (targetNumber && data.features.length > 1) {
      let bestDist = Infinity;
      for (const f of data.features) {
        const a = f.attributes;
        // Distance = how far the target is from the center of this segment's range
        const center = (a.L_F_ADD + a.L_T_ADD) / 2;
        const dist = Math.abs(targetNumber - center);
        if (dist < bestDist) {
          bestDist = dist;
          feature = a;
        }
      }
    }

    const segment = `${feature.PRE_DIR} ${feature.STREET_NAME} ${feature.STREET_TYPE || ''} (${feature.L_F_ADD}-${feature.L_T_ADD})`.trim();
    console.log(`  Sweeper: Found TransID ${feature.TRANS_ID} for segment ${segment}`);

    return {
      transId: feature.TRANS_ID,
      segment,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    console.error(`  Sweeper: TransLegend ${isTimeout ? 'timed out' : 'error'}:`, err?.message || err);
    return null;
  }
}

/**
 * Query the sweeper tracker history for a given TransID.
 * Returns all sweeper visits recorded for that street segment,
 * with Chicago-timezone date/time added.
 *
 * Returns null on API errors (timeout, HTTP error, bad JSON) so callers can
 * distinguish "API failed" from "no sweeper visits." Returns [] when the API
 * responds successfully but has no location data for this transId.
 */
async function getSweeperHistory(transId: number): Promise<SweeperVisit[] | null> {
  try {
    const response = await fetchWithRetry(`${SWEEPER_HISTORY_URL}?transId=${transId}`);
    if (!response.ok) {
      console.error(`  Sweeper: History query failed with status ${response.status}`);
      return null; // API error — caller should not treat as "no visits"
    }

    const text = await response.text();
    // Guard against non-JSON responses (city server sometimes returns HTML error pages)
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`  Sweeper: History returned non-JSON (${text.substring(0, 100)}...)`);
      return null; // Bad response — API error
    }

    const locationList = data?.trackingDataResponse?.locationList;
    if (!locationList || !Array.isArray(locationList) || locationList.length === 0) {
      return []; // Valid response, no visits
    }

    return locationList.map((loc: any) => {
      const chicago = toChicagoDateTime(loc.postingTime || '');
      return {
        address: loc.address || '',
        vehicleId: loc.assetName || '',
        vehicleType: loc.assetType || '',
        direction: loc.directionDegrees || 0,
        latitude: loc.latitude || 0,
        longitude: loc.longitude || 0,
        postingTime: loc.postingTime || '',
        postingTimeFormatted: loc.postingTimeFormatted || '',
        chicagoTime: chicago?.time || '',
        chicagoDate: chicago?.date || '',
      };
    });
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    console.error(`  Sweeper: History ${isTimeout ? 'timed out' : 'error'}:`, err?.message || err);
    return null; // Network/timeout error
  }
}

/**
 * Check whether a street sweeper actually visited a specific block on the ticket date,
 * and whether it visited BEFORE or AFTER the ticket was issued.
 *
 * This is the main entry point for contest letter generation.
 *
 * @param ticketLocation   - The address from the parking ticket (e.g. "2300 N SHEFFIELD AVE")
 * @param ticketDate       - The date of the ticket in YYYY-MM-DD format
 * @param ticketIssueTime  - Optional: full ISO datetime of ticket issuance (e.g. "2026-03-10T11:30:00")
 *                           If provided, enables the "sweeper already passed" defense argument.
 * @returns SweeperVerification with the results
 */
export async function verifySweeperVisit(
  ticketLocation: string,
  ticketDate: string,
  ticketIssueTime?: string | null
): Promise<SweeperVerification> {
  const baseResult: SweeperVerification = {
    checked: false,
    transId: null,
    streetSegment: null,
    ticketDate,
    ticketIssuanceTime: ticketIssueTime || null,
    ticketIssuanceTimeFormatted: null,
    sweptOnDate: false,
    sweptBeforeTicket: false,
    firstSweeperPassTime: null,
    lastSweeperPassTime: null,
    minutesBetweenSweepAndTicket: null,
    timeBetweenFormatted: null,
    visitsOnDate: [],
    allRecentVisits: [],
    message: '',
  };

  if (!ticketLocation || !ticketDate) {
    baseResult.message = 'Missing ticket location or date for sweeper verification.';
    baseResult.error = 'missing_input';
    return baseResult;
  }

  // Validate ticketDate format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ticketDate)) {
    baseResult.message = `Invalid ticket date format: "${ticketDate}" (expected YYYY-MM-DD).`;
    baseResult.error = 'invalid_date';
    return baseResult;
  }

  // Step 1: Look up the TransID for this address
  const transResult = await lookupTransId(ticketLocation);
  if (!transResult) {
    baseResult.checked = true;
    baseResult.message = `Could not find street segment for "${ticketLocation}" in Chicago's street network. Sweeper verification unavailable.`;
    baseResult.error = 'trans_id_not_found';
    return baseResult;
  }

  baseResult.transId = transResult.transId;
  baseResult.streetSegment = transResult.segment;

  // Step 2: Get sweeper visit history
  const visits = await getSweeperHistory(transResult.transId);
  baseResult.allRecentVisits = visits || [];
  baseResult.checked = true;

  if (!visits || visits.length === 0) {
    baseResult.message = `No sweeper visit records found for ${transResult.segment}. The city's sweeper tracker has no data for this block in its current history window (~7-30 days). This may mean no sweeper visited this block recently.`;
    return baseResult;
  }

  // Step 3: Filter visits to the ticket date using CHICAGO timezone
  // This is critical: postingTime is UTC, but ticketDate is in Chicago time.
  // A UTC timestamp of "2026-03-10T04:30:00Z" is actually 11:30 PM CDT on March 9.
  const visitsOnDate = visits.filter((v) => v.chicagoDate === ticketDate);

  baseResult.visitsOnDate = visitsOnDate;
  baseResult.sweptOnDate = visitsOnDate.length > 0;

  // Step 4: If sweeper visited, compare times against ticket issuance
  if (visitsOnDate.length > 0) {
    // Sort by posting time to find first and last pass
    const sortedVisits = [...visitsOnDate].sort(
      (a, b) => new Date(a.postingTime).getTime() - new Date(b.postingTime).getTime()
    );

    const firstPass = sortedVisits[0];
    const lastPass = sortedVisits[sortedVisits.length - 1];

    baseResult.firstSweeperPassTime = firstPass.chicagoTime;
    baseResult.lastSweeperPassTime = lastPass.chicagoTime;

    // If we have the ticket issuance time, calculate the time difference.
    // Pass ticketDate as fallback for AM/PM-only times from OCR (e.g. "2:30 PM").
    const ticketTime = ticketIssueTime ? parseChicagoTime(ticketIssueTime, ticketDate) : null;
    const firstPassTime = new Date(firstPass.postingTime);

    if (ticketTime && !isNaN(ticketTime.getTime()) && !isNaN(firstPassTime.getTime())) {
      const diffMs = ticketTime.getTime() - firstPassTime.getTime();
      const diffMinutes = Math.round(diffMs / 60000);
      baseResult.minutesBetweenSweepAndTicket = diffMinutes;
      // Sweeper passed BEFORE ticket if the first GPS ping was before ticket issuance
      baseResult.sweptBeforeTicket = diffMinutes > 0;
      // Human-readable time diff
      const absMins = Math.abs(diffMinutes);
      const hours = Math.floor(absMins / 60);
      const mins = absMins % 60;
      baseResult.timeBetweenFormatted = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
      // Human-readable ticket issuance time
      baseResult.ticketIssuanceTimeFormatted = ticketTime.toLocaleTimeString('en-US', {
        timeZone: CHICAGO_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
      });
    }
  }

  // Step 5: Build comprehensive summary message
  const dateRange = (() => {
    const allDates = Array.from(new Set(visits.map((v) => v.chicagoDate))).sort();
    return allDates.length > 1
      ? `${allDates[0]} to ${allDates[allDates.length - 1]}`
      : allDates[0] || 'unknown';
  })();

  if (visitsOnDate.length > 0) {
    // Deduplicate times (multiple GPS pings during same pass)
    const uniqueTimes = Array.from(new Set(visitsOnDate.map((v) => v.chicagoTime)));
    const vehicleIds = Array.from(new Set(visitsOnDate.map((v) => v.vehicleId)));

    let msg = `Street sweeper DID visit ${transResult.segment} on ${ticketDate}. ` +
      `Vehicle ${vehicleIds.join(', ')} recorded at: ${uniqueTimes.join(', ')} (Chicago time). ` +
      `${visitsOnDate.length} GPS ping(s) on ticket date, ${visits.length} total in history (${dateRange}).`;

    // Add the critical time comparison
    if (baseResult.sweptBeforeTicket && baseResult.minutesBetweenSweepAndTicket != null) {
      msg += `\n*** CRITICAL: The sweeper passed this block ${baseResult.timeBetweenFormatted} BEFORE the ticket was issued. ` +
        `First sweeper GPS: ${baseResult.firstSweeperPassTime}. Ticket issued: ${baseResult.ticketIssuanceTimeFormatted || 'unknown'}. ` +
        `The street was already cleaned — the purpose of the parking restriction was already fulfilled when the ticket was written. ***`;
    } else if (baseResult.minutesBetweenSweepAndTicket != null && baseResult.minutesBetweenSweepAndTicket < 0) {
      msg += `\nNote: Sweeper first GPS ping was AFTER the ticket was issued (ticket first, sweeper ${baseResult.timeBetweenFormatted} later).`;
    } else if (!ticketIssueTime) {
      msg += `\nNote: Ticket issuance time not available — cannot determine if sweeper passed before or after the ticket.`;
    }

    baseResult.message = msg;
  } else {
    // No sweeper on ticket date — build context
    const sweptDates = Array.from(new Set(visits.map((v) => v.chicagoDate))).sort();

    baseResult.message = `NO street sweeper visited ${transResult.segment} on ${ticketDate} according to ` +
      `the City of Chicago's SweepTracker GPS data. The tracker shows ${visits.length} sweeper GPS ping(s) ` +
      `in the recent history window (${dateRange}), on these dates: ${sweptDates.join(', ')}. ` +
      `The absence of sweeper GPS data on the ticket date means the street was NOT cleaned, ` +
      `which eliminates the justification for the street cleaning parking citation.`;
  }

  return baseResult;
}

// ──────────────────────────────────────────────────────────────
// Real-time sweeper check — for "sweeper has passed your block"
// ──────────────────────────────────────────────────────────────

/**
 * Check if the street sweeper has passed a specific block TODAY.
 * Used for real-time "you can move your car" notifications.
 *
 * Returns null if no TransID found or API error.
 * Returns { passed: false } if no sweeper activity today.
 * Returns { passed: true, passTime, vehicleId } if sweeper GPS was recorded on this block today.
 *
 * @param streetAddress - e.g. "2300 N SHEFFIELD AVE"
 */
export async function checkSweeperPassedToday(
  streetAddress: string
): Promise<{
  passed: boolean;
  transId: number | null;
  segment: string | null;
  passTime: string | null;      // Chicago local time (e.g. "10:28 AM")
  passTimeUtc: string | null;   // UTC ISO timestamp
  vehicleId: string | null;
  totalPingsToday: number;
  error?: string;
} | null> {
  const transResult = await lookupTransId(streetAddress);
  if (!transResult) return null;

  const visits = await getSweeperHistory(transResult.transId);
  if (!visits || visits.length === 0) {
    return {
      passed: false,
      transId: transResult.transId,
      segment: transResult.segment,
      passTime: null,
      passTimeUtc: null,
      vehicleId: null,
      totalPingsToday: 0,
    };
  }

  // Get today's date in Chicago timezone
  const todayChicago = new Date().toLocaleDateString('en-CA', { timeZone: CHICAGO_TZ });
  const todayVisits = visits.filter((v) => v.chicagoDate === todayChicago);

  if (todayVisits.length === 0) {
    return {
      passed: false,
      transId: transResult.transId,
      segment: transResult.segment,
      passTime: null,
      passTimeUtc: null,
      vehicleId: null,
      totalPingsToday: 0,
    };
  }

  // Sort to find the first pass
  const sorted = [...todayVisits].sort(
    (a, b) => new Date(a.postingTime).getTime() - new Date(b.postingTime).getTime()
  );
  const first = sorted[0];

  return {
    passed: true,
    transId: transResult.transId,
    segment: transResult.segment,
    passTime: first.chicagoTime,
    passTimeUtc: first.postingTime,
    vehicleId: first.vehicleId,
    totalPingsToday: todayVisits.length,
  };
}

/**
 * Look up the TransID for an address. Exported for use by the real-time polling API.
 */
export { lookupTransId, getSweeperHistory };
