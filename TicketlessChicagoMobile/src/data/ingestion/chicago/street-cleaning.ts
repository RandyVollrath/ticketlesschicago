/**
 * Chicago Street Cleaning Data Ingestion
 *
 * Parses street cleaning schedule data from Chicago Data Portal.
 * Converts raw CSV/JSON to GeoJSON format with restriction data.
 *
 * Expected input format (from Chicago Data Portal):
 * - WARD, SECTION, STREET, START_ADDR, END_ADDR
 * - SIDE (N/S/E/W)
 * - MONTH_START, MONTH_END (4-11 for April-November)
 * - WEEKDAY (MONDAY, TUESDAY, etc.)
 * - START_TIME, END_TIME (HH:MM)
 * - Geometry data (coordinates)
 */

import {
  StreetSegment,
  StreetSegmentCollection,
  Restriction,
  GeoJSONLineString,
} from '../../../services/parking-map/types';

// =============================================================================
// Raw Data Interface (from Chicago Data Portal)
// =============================================================================

export interface RawStreetCleaningRow {
  WARD?: string;
  SECTION?: string;
  STREET?: string;
  STREET_NAME?: string;
  START_ADDR?: string;
  END_ADDR?: string;
  SIDE?: string;
  MONTH_START?: string;
  MONTH_END?: string;
  WEEKDAY?: string;
  DAY?: string;
  START_TIME?: string;
  END_TIME?: string;
  WEEK_OF_MONTH?: string;
  // Geometry fields
  the_geom?: string;
  geometry?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
  START_LAT?: string;
  START_LON?: string;
  END_LAT?: string;
  END_LON?: string;
}

// =============================================================================
// Ingestion Functions
// =============================================================================

/**
 * Ingest street cleaning data from raw rows
 */
export function ingestStreetCleaning(
  rawData: RawStreetCleaningRow[]
): StreetSegmentCollection {
  const segments: StreetSegment[] = [];

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const segment = parseStreetCleaningRow(row, i);
    if (segment) {
      segments.push(segment);
    }
  }

  return {
    type: 'FeatureCollection',
    features: segments,
  };
}

/**
 * Parse a single street cleaning row into a StreetSegment
 */
function parseStreetCleaningRow(
  row: RawStreetCleaningRow,
  index: number
): StreetSegment | null {
  // Extract geometry
  const geometry = parseGeometry(row);
  if (!geometry) {
    console.warn(`[StreetCleaning] No geometry for row ${index}`);
    return null;
  }

  // Extract street info
  const streetName = row.STREET || row.STREET_NAME || 'Unknown';
  const blockStart = row.START_ADDR || '';
  const blockEnd = row.END_ADDR || '';

  // Parse schedule
  const restriction = parseStreetCleaningRestriction(row);

  return {
    type: 'Feature',
    geometry,
    properties: {
      segmentId: generateSegmentId(row, index),
      streetName,
      blockStart,
      blockEnd,
      side: parseSide(row.SIDE),
      ward: row.WARD,
      route: row.SECTION,
      restrictions: [restriction],
      currentStatus: 'unknown',
      dataConfidence: 'high',
    },
  };
}

/**
 * Parse street cleaning restriction from row
 */
function parseStreetCleaningRestriction(row: RawStreetCleaningRow): Restriction {
  return {
    type: 'street-cleaning',
    schedule: {
      daysOfWeek: parseWeekday(row.WEEKDAY || row.DAY),
      startTime: normalizeTime(row.START_TIME) || '09:00',
      endTime: normalizeTime(row.END_TIME) || '15:00',
      startDate: formatSeasonDate(row.MONTH_START, 1),
      endDate: formatSeasonDate(row.MONTH_END, 30),
      weekOfMonth: parseWeekOfMonth(row.WEEK_OF_MONTH),
    },
  };
}

// =============================================================================
// Parsing Helpers
// =============================================================================

/**
 * Parse geometry from various formats
 */
function parseGeometry(row: RawStreetCleaningRow): GeoJSONLineString | null {
  // Try pre-parsed geometry
  if (row.the_geom) {
    try {
      const geom = JSON.parse(row.the_geom);
      if (geom.type === 'LineString') {
        return geom as GeoJSONLineString;
      }
    } catch {
      // Continue to other methods
    }
  }

  if (row.geometry) {
    try {
      const geom = JSON.parse(row.geometry);
      if (geom.type === 'LineString') {
        return geom as GeoJSONLineString;
      }
    } catch {
      // Continue to other methods
    }
  }

  // Try start/end coordinates
  if (row.START_LAT && row.START_LON && row.END_LAT && row.END_LON) {
    return {
      type: 'LineString',
      coordinates: [
        [parseFloat(row.START_LON), parseFloat(row.START_LAT)],
        [parseFloat(row.END_LON), parseFloat(row.END_LAT)],
      ],
    };
  }

  // Try single point (create short segment)
  if (row.LONGITUDE && row.LATITUDE) {
    const lon = parseFloat(row.LONGITUDE);
    const lat = parseFloat(row.LATITUDE);
    return {
      type: 'LineString',
      coordinates: [
        [lon - 0.0005, lat],
        [lon + 0.0005, lat],
      ],
    };
  }

  return null;
}

/**
 * Parse side of street
 */
function parseSide(
  side?: string
): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
  if (!side) return 'both';

  const sideMap: Record<string, 'north' | 'south' | 'east' | 'west' | 'odd' | 'even'> = {
    N: 'north',
    NORTH: 'north',
    S: 'south',
    SOUTH: 'south',
    E: 'east',
    EAST: 'east',
    W: 'west',
    WEST: 'west',
    ODD: 'odd',
    EVEN: 'even',
  };

  return sideMap[side.toUpperCase()] || 'both';
}

/**
 * Parse weekday string to day number array
 */
function parseWeekday(day?: string): number[] {
  if (!day) return [1]; // Default to Monday

  const dayMap: Record<string, number> = {
    SUNDAY: 0,
    SUN: 0,
    MONDAY: 1,
    MON: 1,
    TUESDAY: 2,
    TUE: 2,
    WEDNESDAY: 3,
    WED: 3,
    THURSDAY: 4,
    THU: 4,
    FRIDAY: 5,
    FRI: 5,
    SATURDAY: 6,
    SAT: 6,
  };

  const dayNum = dayMap[day.toUpperCase()];
  return dayNum !== undefined ? [dayNum] : [1];
}

/**
 * Parse week of month (e.g., "1,3" or "1ST,3RD")
 */
function parseWeekOfMonth(week?: string): number[] | undefined {
  if (!week) return undefined;

  const weeks: number[] = [];
  const parts = week.split(/[,\s]+/);

  for (const part of parts) {
    const match = part.match(/(\d)/);
    if (match) {
      const weekNum = parseInt(match[1]);
      if (weekNum >= 1 && weekNum <= 5) {
        weeks.push(weekNum);
      }
    }
  }

  return weeks.length > 0 ? weeks : undefined;
}

/**
 * Normalize time string to HH:MM format
 */
function normalizeTime(time?: string): string | undefined {
  if (!time) return undefined;

  // Already in HH:MM format
  if (/^\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  // Handle "9:00 AM" format
  const match = time.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (match) {
    let hour = parseInt(match[1]);
    const min = match[2] || '00';
    const period = match[3]?.toUpperCase();

    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    return `${hour.toString().padStart(2, '0')}:${min}`;
  }

  return undefined;
}

/**
 * Format season date from month number
 */
function formatSeasonDate(month?: string, day: number = 1): string | undefined {
  if (!month) return undefined;

  const monthNum = parseInt(month);
  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return undefined;
  }

  return `${monthNum.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/**
 * Generate unique segment ID
 */
function generateSegmentId(row: RawStreetCleaningRow, index: number): string {
  const ward = row.WARD || 'X';
  const section = row.SECTION || 'X';
  const street = (row.STREET || row.STREET_NAME || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '-');

  return `chi-sc-${ward}-${section}-${street}-${index}`;
}

export default ingestStreetCleaning;
