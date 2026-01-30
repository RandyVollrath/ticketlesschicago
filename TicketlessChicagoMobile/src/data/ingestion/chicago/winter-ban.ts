/**
 * Chicago Winter Overnight Ban Data Ingestion
 *
 * Parses winter overnight parking ban data from Chicago Data Portal.
 * Winter ban: Dec 1 - Apr 1, 3am-7am on designated streets.
 *
 * Expected input: GeoJSON or shapefile with street geometry
 */

import {
  StreetSegment,
  StreetSegmentCollection,
  GeoJSONLineString,
} from '../../../services/parking-map/types';

// =============================================================================
// Raw Data Interface
// =============================================================================

export interface RawWinterBanFeature {
  type: 'Feature';
  geometry: GeoJSONLineString;
  properties: {
    OBJECTID?: number;
    STREET_NAM?: string;
    STREET_NAME?: string;
    STREET?: string;
    DIR?: string;
    DIRECTION?: string;
    FROM_STREE?: string;
    TO_STREET?: string;
    WARD?: string;
    [key: string]: any;
  };
}

export interface RawWinterBanCollection {
  type: 'FeatureCollection';
  features: RawWinterBanFeature[];
}

// =============================================================================
// Ingestion Functions
// =============================================================================

/**
 * Ingest winter ban streets from GeoJSON
 */
export function ingestWinterBan(
  rawData: RawWinterBanCollection
): StreetSegmentCollection {
  const segments: StreetSegment[] = [];

  for (let i = 0; i < rawData.features.length; i++) {
    const feature = rawData.features[i];
    const segment = parseWinterBanFeature(feature, i);
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
 * Parse a single winter ban feature
 */
function parseWinterBanFeature(
  feature: RawWinterBanFeature,
  index: number
): StreetSegment | null {
  const { geometry, properties } = feature;

  if (!geometry || geometry.type !== 'LineString') {
    console.warn(`[WinterBan] Invalid geometry for feature ${index}`);
    return null;
  }

  const streetName =
    properties.STREET_NAM ||
    properties.STREET_NAME ||
    properties.STREET ||
    'Unknown';

  const direction = properties.DIR || properties.DIRECTION;
  const fromStreet = properties.FROM_STREE || properties.FROM_STREET;
  const toStreet = properties.TO_STREET;

  return {
    type: 'Feature',
    geometry,
    properties: {
      segmentId: `chi-winter-${properties.OBJECTID || index}`,
      streetName: direction ? `${direction} ${streetName}` : streetName,
      blockStart: fromStreet || '',
      blockEnd: toStreet || '',
      side: 'both',
      ward: properties.WARD,
      restrictions: [
        {
          type: 'winter-ban',
          schedule: {
            startDate: '12-01', // December 1
            endDate: '04-01', // April 1
            startTime: '03:00', // 3am
            endTime: '07:00', // 7am
          },
          description: 'Winter overnight ban - No parking 3am-7am (Dec 1 - Apr 1)',
        },
      ],
      currentStatus: 'unknown',
      dataConfidence: 'high',
    },
  };
}

/**
 * Parse from flat data format
 */
export function ingestWinterBanFromFlat(
  rows: Record<string, any>[]
): StreetSegmentCollection {
  const segments: StreetSegment[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const geometry = parseGeometryFromRow(row);

    if (!geometry) {
      continue;
    }

    const streetName =
      row.STREET_NAM ||
      row.STREET_NAME ||
      row.STREET ||
      row.street_name ||
      'Unknown';

    segments.push({
      type: 'Feature',
      geometry,
      properties: {
        segmentId: `chi-winter-${row.OBJECTID || i}`,
        streetName,
        blockStart: row.FROM_STREE || row.from_street || '',
        blockEnd: row.TO_STREET || row.to_street || '',
        side: 'both',
        ward: row.WARD,
        restrictions: [
          {
            type: 'winter-ban',
            schedule: {
              startDate: '12-01',
              endDate: '04-01',
              startTime: '03:00',
              endTime: '07:00',
            },
          },
        ],
        currentStatus: 'unknown',
        dataConfidence: 'high',
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
        if (parsed.type === 'LineString') {
          return parsed;
        }
      } catch {
        const wkt = parseWKT(geomField);
        if (wkt) return wkt;
      }
    } else if (geomField.type === 'LineString') {
      return geomField;
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

/**
 * Parse WKT LineString
 */
function parseWKT(wkt: string): GeoJSONLineString | null {
  const match = wkt.match(/LINESTRING\s*\(([\d\s,.-]+)\)/i);
  if (!match) return null;

  const coordPairs = match[1].split(',').map((pair) => {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    return [lon, lat] as [number, number];
  });

  if (coordPairs.length < 2) return null;

  return {
    type: 'LineString',
    coordinates: coordPairs,
  };
}

export default ingestWinterBan;
