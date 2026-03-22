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
 * The sweeper tracker shows real-time data 9am-2pm weekdays April-November,
 * but the history endpoint returns visits from the past ~7-30 days.
 */

const TRANS_LEGEND_URL =
  'https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/TransLegend/MapServer/1/query';
const SWEEPER_HISTORY_URL =
  'https://gisapps.chicago.gov/sweeptracker/getTrackingDataforTransid';

/** Chicago timezone for all date comparisons */
const CHICAGO_TZ = 'America/Chicago';

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
  ticketIssuanceTime: string | null;  // ISO datetime of ticket issuance (Chicago local)
  sweptOnDate: boolean;            // Did a sweeper visit on the ticket date?
  sweptBeforeTicket: boolean;      // Did the sweeper come BEFORE the ticket was issued?
  firstSweeperPassTime: string | null;  // Chicago local time of first sweeper pass on ticket date
  lastSweeperPassTime: string | null;   // Chicago local time of last sweeper pass on ticket date
  minutesBetweenSweepAndTicket: number | null; // Minutes between first sweep pass and ticket
  visitsOnDate: SweeperVisit[];    // Visits on the ticket date
  allRecentVisits: SweeperVisit[]; // All visits in history (for context)
  message: string;                 // Human-readable summary for the AI prompt
  error?: string;
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
 * Ticket times come from the portal as "2026-02-07T21:07:00" (no timezone suffix = Chicago local).
 * Also handles YYYY-MM-DD format (date-only).
 */
function parseChicagoTime(dateTimeStr: string): Date | null {
  if (!dateTimeStr) return null;
  try {
    // If it has a T and no Z, it's Chicago local time from the portal
    if (dateTimeStr.includes('T') && !dateTimeStr.endsWith('Z')) {
      // Create a date interpreting it as Chicago local time
      // We do this by appending the Chicago UTC offset
      const d = new Date(dateTimeStr);
      // The Date constructor interprets no-timezone strings as local time,
      // which is correct if the server is in Chicago, but WRONG on Vercel (UTC).
      // Instead, we use a reliable method:
      const parts = dateTimeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/);
      if (!parts) return null;
      // Create in Chicago timezone by using a formatter trick
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: CHICAGO_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
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
      // Fallback: just parse it (works if server is in Chicago)
      return new Date(dateTimeStr);
    }
    // If it ends with Z, it's already UTC
    if (dateTimeStr.endsWith('Z')) {
      return new Date(dateTimeStr);
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
      name: match[3].trim(),
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
          name: parts.slice(0, -1).join(' '),
          type: lastWord,
        };
      }
    }
    return {
      number: parseInt(matchNoType[1], 10),
      dir: matchNoType[2],
      name: matchNoType[3].trim(),
      type: '',
    };
  }

  return null;
}

/**
 * Look up the TransID (street segment identifier) for a Chicago address.
 * The TransID uniquely identifies a block segment in Chicago's street network.
 */
async function lookupTransId(
  address: string
): Promise<{ transId: number; segment: string } | null> {
  const parsed = parseAddress(address);
  if (!parsed) {
    console.log(`  Sweeper: Could not parse address "${address}"`);
    return null;
  }

  // Build WHERE clause with AND between each condition
  const where = `STREET_NAME='${parsed.name}' AND PRE_DIR='${parsed.dir}' AND ((L_F_ADD <= ${parsed.number} AND L_T_ADD >= ${parsed.number}) OR (R_F_ADD <= ${parsed.number} AND R_T_ADD >= ${parsed.number}))`;

  const params = new URLSearchParams({
    where,
    outFields: 'TRANS_ID,PRE_DIR,STREET_NAME,STREET_TYPE,L_F_ADD,L_T_ADD,R_F_ADD,R_T_ADD',
    returnGeometry: 'false',
    f: 'json',
  });

  try {
    const response = await fetch(`${TRANS_LEGEND_URL}?${params.toString()}`);
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
      console.log(`  Sweeper: No TransID found for "${address}" (query: ${where})`);
      return null;
    }

    const feature = data.features[0].attributes;
    const segment = `${feature.PRE_DIR} ${feature.STREET_NAME} ${feature.STREET_TYPE || ''} (${feature.L_F_ADD}-${feature.L_T_ADD})`.trim();
    console.log(`  Sweeper: Found TransID ${feature.TRANS_ID} for segment ${segment}`);

    return {
      transId: feature.TRANS_ID,
      segment,
    };
  } catch (err) {
    console.error('  Sweeper: TransLegend lookup error:', err);
    return null;
  }
}

/**
 * Query the sweeper tracker history for a given TransID.
 * Returns all sweeper visits recorded for that street segment,
 * with Chicago-timezone date/time added.
 */
async function getSweeperHistory(transId: number): Promise<SweeperVisit[]> {
  try {
    const response = await fetch(`${SWEEPER_HISTORY_URL}?transId=${transId}`);
    if (!response.ok) {
      console.error(`  Sweeper: History query failed with status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const locationList = data?.trackingDataResponse?.locationList;
    if (!locationList || !Array.isArray(locationList) || locationList.length === 0) {
      return [];
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
  } catch (err) {
    console.error('  Sweeper: History query error:', err);
    return [];
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
    sweptOnDate: false,
    sweptBeforeTicket: false,
    firstSweeperPassTime: null,
    lastSweeperPassTime: null,
    minutesBetweenSweepAndTicket: null,
    visitsOnDate: [],
    allRecentVisits: [],
    message: '',
  };

  if (!ticketLocation || !ticketDate) {
    baseResult.message = 'Missing ticket location or date for sweeper verification.';
    baseResult.error = 'missing_input';
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
  baseResult.allRecentVisits = visits;
  baseResult.checked = true;

  if (visits.length === 0) {
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

    // If we have the ticket issuance time, calculate the time difference
    const ticketTime = ticketIssueTime ? parseChicagoTime(ticketIssueTime) : null;
    const firstPassTime = new Date(firstPass.postingTime);

    if (ticketTime) {
      const diffMs = ticketTime.getTime() - firstPassTime.getTime();
      const diffMinutes = Math.round(diffMs / 60000);
      baseResult.minutesBetweenSweepAndTicket = diffMinutes;
      // Sweeper passed BEFORE ticket if the first GPS ping was before ticket issuance
      baseResult.sweptBeforeTicket = diffMinutes > 0;
    }
  }

  // Step 5: Build comprehensive summary message
  const dateRange = (() => {
    const allDates = [...new Set(visits.map((v) => v.chicagoDate))].sort();
    return allDates.length > 1
      ? `${allDates[0]} to ${allDates[allDates.length - 1]}`
      : allDates[0] || 'unknown';
  })();

  if (visitsOnDate.length > 0) {
    // Deduplicate times (multiple GPS pings during same pass)
    const uniqueTimes = [...new Set(visitsOnDate.map((v) => v.chicagoTime))];
    const vehicleIds = [...new Set(visitsOnDate.map((v) => v.vehicleId))];

    let msg = `Street sweeper DID visit ${transResult.segment} on ${ticketDate}. ` +
      `Vehicle ${vehicleIds.join(', ')} recorded at: ${uniqueTimes.join(', ')} (Chicago time). ` +
      `${visitsOnDate.length} GPS ping(s) on ticket date, ${visits.length} total in history (${dateRange}).`;

    // Add the critical time comparison
    if (baseResult.sweptBeforeTicket && baseResult.minutesBetweenSweepAndTicket != null) {
      const hours = Math.floor(baseResult.minutesBetweenSweepAndTicket / 60);
      const mins = baseResult.minutesBetweenSweepAndTicket % 60;
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
      msg += `\n*** CRITICAL: The sweeper passed this block ${timeStr} BEFORE the ticket was issued. ` +
        `First sweeper GPS: ${baseResult.firstSweeperPassTime}. Ticket issued: ${new Date(ticketIssueTime!).toLocaleTimeString('en-US', { timeZone: CHICAGO_TZ, hour: 'numeric', minute: '2-digit', hour12: true })}. ` +
        `The street was already cleaned — the purpose of the parking restriction was already fulfilled when the ticket was written. ***`;
    } else if (baseResult.minutesBetweenSweepAndTicket != null && baseResult.minutesBetweenSweepAndTicket < 0) {
      msg += `\nNote: Sweeper first GPS ping was AFTER the ticket was issued (ticket first, sweeper ${Math.abs(baseResult.minutesBetweenSweepAndTicket)} minutes later).`;
    } else if (!ticketIssueTime) {
      msg += `\nNote: Ticket issuance time not available — cannot determine if sweeper passed before or after the ticket.`;
    }

    baseResult.message = msg;
  } else {
    // No sweeper on ticket date — build context
    const sweptDates = [...new Set(visits.map((v) => v.chicagoDate))].sort();

    baseResult.message = `NO street sweeper visited ${transResult.segment} on ${ticketDate} according to ` +
      `the City of Chicago's SweepTracker GPS data. The tracker shows ${visits.length} sweeper GPS ping(s) ` +
      `in the recent history window (${dateRange}), on these dates: ${sweptDates.join(', ')}. ` +
      `The absence of sweeper GPS data on the ticket date means the street was NOT cleaned, ` +
      `which eliminates the justification for the street cleaning parking citation.`;
  }

  return baseResult;
}
