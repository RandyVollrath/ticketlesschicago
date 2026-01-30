/**
 * Chicago Permit Parking Zones Data Ingestion
 *
 * Parses residential permit parking zone data from Chicago Data Portal.
 * Permit zones restrict non-permit parking during specified hours.
 *
 * Expected input: GeoJSON with polygon boundaries or street segments
 */

import {
  StreetSegment,
  StreetSegmentCollection,
  GeoJSONLineString,
  GeoJSONPolygon,
} from '../../../services/parking-map/types';

// =============================================================================
// Raw Data Interface
// =============================================================================

export interface RawPermitZoneFeature {
  type: 'Feature';
  geometry: GeoJSONPolygon | GeoJSONLineString;
  properties: {
    OBJECTID?: number;
    ZONE?: string;
    ZONE_NUM?: string;
    PERMIT_ZONE?: string;
    HOURS?: string;
    PERMIT_HOURS?: string;
    STREET_NAM?: string;
    STREET_NAME?: string;
    STREET?: string;
    FROM_STREE?: string;
    TO_STREET?: string;
    SIDE?: string;
    [key: string]: any;
  };
}

export interface RawPermitZoneCollection {
  type: 'FeatureCollection';
  features: RawPermitZoneFeature[];
}

// =============================================================================
// Ingestion Functions
// =============================================================================

/**
 * Ingest permit zones from GeoJSON
 */
export function ingestPermitZones(
  rawData: RawPermitZoneCollection
): StreetSegmentCollection {
  const segments: StreetSegment[] = [];

  for (let i = 0; i < rawData.features.length; i++) {
    const feature = rawData.features[i];
    const segment = parsePermitZoneFeature(feature, i);
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
 * Parse a single permit zone feature
 */
function parsePermitZoneFeature(
  feature: RawPermitZoneFeature,
  index: number
): StreetSegment | null {
  const { geometry, properties } = feature;

  if (!geometry) {
    console.warn(`[PermitZones] No geometry for feature ${index}`);
    return null;
  }

  // Convert polygon to representative line if needed
  const lineGeometry = convertToLineString(geometry);
  if (!lineGeometry) {
    console.warn(`[PermitZones] Could not convert geometry for feature ${index}`);
    return null;
  }

  const zoneNumber =
    properties.ZONE ||
    properties.ZONE_NUM ||
    properties.PERMIT_ZONE ||
    'Unknown';

  const permitHours =
    properties.HOURS ||
    properties.PERMIT_HOURS ||
    '6pm-6am'; // Default permit hours

  const streetName =
    properties.STREET_NAM ||
    properties.STREET_NAME ||
    properties.STREET ||
    `Zone ${zoneNumber}`;

  return {
    type: 'Feature',
    geometry: lineGeometry,
    properties: {
      segmentId: `chi-permit-${zoneNumber}-${properties.OBJECTID || index}`,
      streetName,
      blockStart: properties.FROM_STREE || '',
      blockEnd: properties.TO_STREET || '',
      side: parseSide(properties.SIDE),
      restrictions: [
        {
          type: 'permit-zone',
          schedule: {
            permitZone: zoneNumber,
            permitHours: normalizePermitHours(permitHours),
          },
          description: `Permit Zone ${zoneNumber} - ${permitHours}`,
        },
      ],
      currentStatus: 'unknown',
      dataConfidence: 'medium', // Permit zones can have block-level variations
    },
  };
}

/**
 * Convert polygon to linestring (use boundary)
 */
function convertToLineString(
  geometry: GeoJSONPolygon | GeoJSONLineString
): GeoJSONLineString | null {
  if (geometry.type === 'LineString') {
    return geometry;
  }

  if (geometry.type === 'Polygon') {
    // Use the outer ring as a linestring
    const outerRing = geometry.coordinates[0];
    if (outerRing && outerRing.length >= 2) {
      return {
        type: 'LineString',
        coordinates: outerRing,
      };
    }
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
 * Normalize permit hours to consistent format
 */
function normalizePermitHours(hours: string): string {
  // Already in expected format
  if (/\d+(am|pm)-\d+(am|pm)/i.test(hours)) {
    return hours.toLowerCase();
  }

  // Try to parse various formats
  // "6 PM - 6 AM" -> "6pm-6am"
  const match = hours.match(/(\d+)\s*(am|pm)?\s*[-to]+\s*(\d+)\s*(am|pm)?/i);
  if (match) {
    const start = match[1];
    const startPeriod = (match[2] || 'pm').toLowerCase();
    const end = match[3];
    const endPeriod = (match[4] || 'am').toLowerCase();
    return `${start}${startPeriod}-${end}${endPeriod}`;
  }

  return '6pm-6am'; // Default
}

/**
 * Parse from flat data format
 */
export function ingestPermitZonesFromFlat(
  rows: Record<string, any>[]
): StreetSegmentCollection {
  const segments: StreetSegment[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const geometry = parseGeometryFromRow(row);

    if (!geometry) {
      continue;
    }

    const zoneNumber =
      row.ZONE ||
      row.ZONE_NUM ||
      row.PERMIT_ZONE ||
      row.zone ||
      'Unknown';

    const permitHours =
      row.HOURS ||
      row.PERMIT_HOURS ||
      row.hours ||
      '6pm-6am';

    segments.push({
      type: 'Feature',
      geometry,
      properties: {
        segmentId: `chi-permit-${zoneNumber}-${row.OBJECTID || i}`,
        streetName:
          row.STREET_NAM ||
          row.STREET_NAME ||
          row.STREET ||
          `Zone ${zoneNumber}`,
        blockStart: row.FROM_STREE || '',
        blockEnd: row.TO_STREET || '',
        side: parseSide(row.SIDE),
        restrictions: [
          {
            type: 'permit-zone',
            schedule: {
              permitZone: zoneNumber,
              permitHours: normalizePermitHours(permitHours),
            },
          },
        ],
        currentStatus: 'unknown',
        dataConfidence: 'medium',
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features: segments,
  };
}

/**
 * Parse geometry from row
 */
function parseGeometryFromRow(row: Record<string, any>): GeoJSONLineString | null {
  const geomField = row.the_geom || row.geometry || row.shape;

  if (geomField) {
    if (typeof geomField === 'string') {
      try {
        const parsed = JSON.parse(geomField);
        return convertToLineString(parsed);
      } catch {
        // Could be WKT
      }
    } else {
      return convertToLineString(geomField);
    }
  }

  if (row.coordinates) {
    return {
      type: 'LineString',
      coordinates: row.coordinates,
    };
  }

  return null;
}

export default ingestPermitZones;
