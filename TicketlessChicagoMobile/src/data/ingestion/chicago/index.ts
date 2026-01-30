/**
 * Chicago Data Ingestion Pipeline
 *
 * Orchestrates ingestion of all Chicago parking data:
 * - Street cleaning schedules
 * - Snow routes (2" ban)
 * - Winter overnight ban
 * - Permit parking zones
 */

export { default as ingestStreetCleaning } from './street-cleaning';
export type { RawStreetCleaningRow } from './street-cleaning';
export { default as ingestSnowRoutes, ingestSnowRoutesFromFlat } from './snow-routes';
export { default as ingestWinterBan, ingestWinterBanFromFlat } from './winter-ban';
export { default as ingestPermitZones, ingestPermitZonesFromFlat } from './permit-zones';

import ingestStreetCleaning, { RawStreetCleaningRow } from './street-cleaning';
import ingestSnowRoutes from './snow-routes';
import ingestWinterBan from './winter-ban';
import ingestPermitZones from './permit-zones';

import { StreetSegmentCollection } from '../../../services/parking-map/types';

// =============================================================================
// Combined Ingestion
// =============================================================================

export interface ChicagoRawData {
  streetCleaning?: RawStreetCleaningRow[];
  snowRoutes?: any; // GeoJSON FeatureCollection
  winterBan?: any; // GeoJSON FeatureCollection
  permitZones?: any; // GeoJSON FeatureCollection
}

export interface ChicagoProcessedData {
  streetCleaning: StreetSegmentCollection;
  snowRoutes: StreetSegmentCollection;
  winterBan: StreetSegmentCollection;
  permitZones: StreetSegmentCollection;
}

/**
 * Ingest all Chicago parking data
 */
export function ingestAllChicagoData(rawData: ChicagoRawData): ChicagoProcessedData {
  return {
    streetCleaning: rawData.streetCleaning
      ? ingestStreetCleaning(rawData.streetCleaning)
      : emptyCollection(),
    snowRoutes: rawData.snowRoutes
      ? ingestSnowRoutes(rawData.snowRoutes)
      : emptyCollection(),
    winterBan: rawData.winterBan
      ? ingestWinterBan(rawData.winterBan)
      : emptyCollection(),
    permitZones: rawData.permitZones
      ? ingestPermitZones(rawData.permitZones)
      : emptyCollection(),
  };
}

/**
 * Create empty feature collection
 */
function emptyCollection(): StreetSegmentCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

/**
 * Merge multiple segment collections into one
 */
export function mergeSegmentCollections(
  collections: StreetSegmentCollection[]
): StreetSegmentCollection {
  const allFeatures = collections.flatMap((c) => c.features);

  return {
    type: 'FeatureCollection',
    features: allFeatures,
  };
}

/**
 * Get statistics about processed data
 */
export function getDataStats(data: ChicagoProcessedData): Record<string, number> {
  return {
    streetCleaningSegments: data.streetCleaning.features.length,
    snowRouteSegments: data.snowRoutes.features.length,
    winterBanSegments: data.winterBan.features.length,
    permitZoneSegments: data.permitZones.features.length,
    totalSegments:
      data.streetCleaning.features.length +
      data.snowRoutes.features.length +
      data.winterBan.features.length +
      data.permitZones.features.length,
  };
}

export default {
  ingestStreetCleaning,
  ingestSnowRoutes,
  ingestWinterBan,
  ingestPermitZones,
  ingestAllChicagoData,
  mergeSegmentCollections,
  getDataStats,
};
