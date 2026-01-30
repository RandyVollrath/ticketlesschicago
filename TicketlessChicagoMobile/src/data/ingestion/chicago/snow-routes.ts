/**
 * Chicago Snow Routes Data Ingestion
 *
 * Parses snow route data (2" parking ban streets) from Chicago Data Portal.
 * Snow routes are streets where parking is banned when 2+ inches of snow falls.
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

export interface RawSnowRouteFeature {
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
    LENGTH?: number;
    [key: string]: any;
  };
}

export interface RawSnowRouteCollection {
  type: 'FeatureCollection';
  features: RawSnowRouteFeature[];
}

// =============================================================================
// Ingestion Functions
// =============================================================================

/**
 * Ingest snow routes from GeoJSON
 */
export function ingestSnowRoutes(
  rawData: RawSnowRouteCollection
): StreetSegmentCollection {
  const segments: StreetSegment[] = [];

  for (let i = 0; i < rawData.features.length; i++) {
    const feature = rawData.features[i];
    const segment = parseSnowRouteFeature(feature, i);
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
 * Parse a single snow route feature
 */
function parseSnowRouteFeature(
  feature: RawSnowRouteFeature,
  index: number
): StreetSegment | null {
  const { geometry, properties } = feature;

  if (!geometry || geometry.type !== 'LineString') {
    console.warn(`[SnowRoutes] Invalid geometry for feature ${index}`);
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
      segmentId: `chi-snow-${properties.OBJECTID || index}`,
      streetName: direction ? `${direction} ${streetName}` : streetName,
      blockStart: fromStreet || '',
      blockEnd: toStreet || '',
      side: 'both',
      restrictions: [
        {
          type: 'snow-route',
          schedule: {
            conditional: {
              type: 'snow',
              threshold: '2 inches',
            },
          },
          description: 'Snow route - No parking when 2"+ snow declared',
        },
      ],
      currentStatus: 'unknown',
      dataConfidence: 'high',
    },
  };
}

/**
 * Parse from shapefile-style flat data
 */
export function ingestSnowRoutesFromFlat(
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
        segmentId: `chi-snow-${row.OBJECTID || i}`,
        streetName,
        blockStart: row.FROM_STREE || row.from_street || '',
        blockEnd: row.TO_STREET || row.to_street || '',
        side: 'both',
        restrictions: [
          {
            type: 'snow-route',
            schedule: {
              conditional: {
                type: 'snow',
                threshold: '2 inches',
              },
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
 * Parse geometry from row with various formats
 */
function parseGeometryFromRow(row: Record<string, any>): GeoJSONLineString | null {
  // Try the_geom or geometry field
  const geomField = row.the_geom || row.geometry || row.shape;

  if (geomField) {
    if (typeof geomField === 'string') {
      try {
        const parsed = JSON.parse(geomField);
        if (parsed.type === 'LineString') {
          return parsed;
        }
      } catch {
        // Try WKT format
        const wkt = parseWKT(geomField);
        if (wkt) return wkt;
      }
    } else if (geomField.type === 'LineString') {
      return geomField;
    }
  }

  // Try coordinate fields
  if (row.coordinates) {
    return {
      type: 'LineString',
      coordinates: row.coordinates,
    };
  }

  return null;
}

/**
 * Parse WKT LineString format
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

export default ingestSnowRoutes;
