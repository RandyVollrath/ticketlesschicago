/**
 * Chicago Street Sweeper Tracker Integration
 *
 * Uses the City of Chicago's public SweepTracker API to determine whether
 * a street sweeper actually visited a given block on a specific date.
 *
 * Data flow:
 *   1. Parse street address into components (direction, name, type, address number)
 *   2. Query TransLegend MapServer to find the TransID (street segment identifier)
 *   3. Query /sweeptracker/getTrackingDataforTransid to get sweeper visit history
 *   4. Check if any sweeper visited that block on the ticket date
 *
 * API endpoints (City of Chicago, no auth required):
 *   - TransLegend: https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/TransLegend/MapServer/1/query
 *   - Sweeper History: https://gisapps.chicago.gov/sweeptracker/getTrackingDataforTransid?transId=X
 *
 * The sweeper tracker shows real-time data 9am-2pm weekdays April-November,
 * but the history endpoint returns visits from the past ~30 days.
 */

const TRANS_LEGEND_URL =
  'https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/TransLegend/MapServer/1/query';
const SWEEPER_HISTORY_URL =
  'https://gisapps.chicago.gov/sweeptracker/getTrackingDataforTransid';

export interface SweeperVisit {
  address: string;
  vehicleId: string;
  vehicleType: string;
  direction: number;
  latitude: number;
  longitude: number;
  postingTime: string;       // ISO timestamp
  postingTimeFormatted: string;
}

export interface SweeperVerification {
  checked: boolean;
  transId: number | null;
  streetSegment: string | null;  // e.g. "N SHEFFIELD AVE (2300-2358)"
  ticketDate: string;
  sweptOnDate: boolean;          // Did a sweeper visit on the ticket date?
  visitsOnDate: SweeperVisit[];  // Visits that occurred on the ticket date
  allRecentVisits: SweeperVisit[];  // All visits in history (for context)
  message: string;               // Human-readable summary for the AI prompt
  error?: string;
}

/**
 * Parse a Chicago street address into components for TransLegend query.
 * Examples:
 *   "2300 N SHEFFIELD AVE" → { number: 2300, dir: "N", name: "SHEFFIELD", type: "AVE" }
 *   "1234 W MADISON ST"    → { number: 1234, dir: "W", name: "MADISON", type: "ST" }
 *   "456 S STATE ST"       → { number: 456, dir: "S", name: "STATE", type: "ST" }
 */
function parseAddress(address: string): {
  number: number;
  dir: string;
  name: string;
  type: string;
} | null {
  const cleaned = address.toUpperCase().replace(/,.*$/, '').trim();

  // Match: NUMBER DIR? STREET_NAME STREET_TYPE
  // Direction can be before or implied
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
    // Split last word as potential type
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
    // Use the whole thing as the name
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

  // Build query: find street segments where the address number falls within the range
  // Use both L (left) and R (right) address ranges
  const where = [
    `STREET_NAME='${parsed.name}'`,
    `PRE_DIR='${parsed.dir}'`,
    `(`,
    `  (L_F_ADD <= ${parsed.number} AND L_T_ADD >= ${parsed.number})`,
    `  OR`,
    `  (R_F_ADD <= ${parsed.number} AND R_T_ADD >= ${parsed.number})`,
    `)`,
  ].join(' ');

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
    if (!data.features || data.features.length === 0) {
      console.log(`  Sweeper: No TransID found for "${address}" (query: ${where})`);
      return null;
    }

    const feature = data.features[0].attributes;
    const segment = `${feature.PRE_DIR} ${feature.STREET_NAME} ${feature.STREET_TYPE} (${feature.L_F_ADD}-${feature.L_T_ADD})`;
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
 * Returns all sweeper visits recorded for that street segment.
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

    return locationList.map((loc: any) => ({
      address: loc.address || '',
      vehicleId: loc.assetName || '',
      vehicleType: loc.assetType || '',
      direction: loc.directionDegrees || 0,
      latitude: loc.latitude || 0,
      longitude: loc.longitude || 0,
      postingTime: loc.postingTime || '',
      postingTimeFormatted: loc.postingTimeFormatted || '',
    }));
  } catch (err) {
    console.error('  Sweeper: History query error:', err);
    return [];
  }
}

/**
 * Check whether a street sweeper actually visited a specific block on the ticket date.
 *
 * This is the main entry point for contest letter generation.
 *
 * @param ticketLocation - The address from the parking ticket (e.g. "2300 N SHEFFIELD AVE")
 * @param ticketDate     - The date of the ticket in YYYY-MM-DD format
 * @returns SweeperVerification with the results
 */
export async function verifySweeperVisit(
  ticketLocation: string,
  ticketDate: string
): Promise<SweeperVerification> {
  const baseResult: SweeperVerification = {
    checked: false,
    transId: null,
    streetSegment: null,
    ticketDate,
    sweptOnDate: false,
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

  // Step 3: Check if any visits occurred on the ticket date
  // The ticket date is YYYY-MM-DD, posting times are ISO timestamps
  const ticketDateObj = new Date(ticketDate + 'T00:00:00');
  const ticketMonth = ticketDateObj.getMonth() + 1;
  const ticketDay = ticketDateObj.getDate();
  const ticketYear = ticketDateObj.getFullYear();

  const visitsOnDate = visits.filter((v) => {
    try {
      const visitDate = new Date(v.postingTime);
      return (
        visitDate.getFullYear() === ticketYear &&
        visitDate.getMonth() + 1 === ticketMonth &&
        visitDate.getDate() === ticketDay
      );
    } catch {
      return false;
    }
  });

  baseResult.visitsOnDate = visitsOnDate;
  baseResult.sweptOnDate = visitsOnDate.length > 0;

  // Build summary message
  const dateRange = visits.length > 0
    ? (() => {
        const dates = visits.map((v) => new Date(v.postingTime)).sort((a, b) => a.getTime() - b.getTime());
        return `${dates[0].toLocaleDateString()} to ${dates[dates.length - 1].toLocaleDateString()}`;
      })()
    : 'unknown';

  if (visitsOnDate.length > 0) {
    const times = visitsOnDate.map((v) => {
      const d = new Date(v.postingTime);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    });
    baseResult.message = `Street sweeper DID visit ${transResult.segment} on ${ticketDate}. ` +
      `Vehicle ${visitsOnDate[0].vehicleId} was recorded at ${times.join(', ')}. ` +
      `History covers ${dateRange} with ${visits.length} total visit records.`;
  } else {
    // Build a list of dates when the block WAS swept for context
    const sweptDates = new Set<string>();
    visits.forEach((v) => {
      try {
        const d = new Date(v.postingTime);
        sweptDates.add(d.toLocaleDateString());
      } catch { /* skip */ }
    });

    baseResult.message = `NO street sweeper visited ${transResult.segment} on ${ticketDate} according to ` +
      `the City of Chicago's Sweeper Tracker GPS data. The tracker shows ${visits.length} sweeper visit(s) ` +
      `in the recent history window (${dateRange}), on these dates: ${[...sweptDates].join(', ')}. ` +
      `The absence of sweeper GPS data on the ticket date means the street may not have been cleaned, ` +
      `undermining the justification for the citation.`;
  }

  return baseResult;
}
