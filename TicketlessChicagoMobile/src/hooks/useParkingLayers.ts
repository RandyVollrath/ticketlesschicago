/**
 * useParkingLayers Hook
 *
 * Manages parking restriction layer data and visibility.
 * Fetches and updates layer data based on time and user permits.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ParkingRestrictionLayer,
  StreetSegmentCollection,
  DEFAULT_LAYERS,
  WeatherConditions,
} from '../services/parking-map/types';
import { updateSegmentStatus } from '../services/parking-map/compute';
import { snowEmergencyService } from '../services/parking-map/SnowEmergencyService';

// =============================================================================
// Types
// =============================================================================

export interface UseParkingLayersOptions {
  simulatedTime: Date;
  userPermits?: string[];
  enabledLayerIds?: string[];
}

export interface UseParkingLayersResult {
  layers: ParkingRestrictionLayer[];
  loading: boolean;
  error: Error | null;
  toggleLayer: (layerId: string) => void;
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  refreshLayers: () => Promise<void>;
  weatherConditions: WeatherConditions | null;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useParkingLayers(
  simulatedTime: Date,
  userPermits: string[] = []
): UseParkingLayersResult {
  const [layers, setLayers] = useState<ParkingRestrictionLayer[]>(() =>
    DEFAULT_LAYERS.map((layer) => ({
      ...layer,
      data: undefined,
    }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [weatherConditions, setWeatherConditions] = useState<WeatherConditions | null>(null);

  /**
   * Load layer data
   * In production, this would fetch from API or local storage
   */
  const loadLayerData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Load weather conditions
      const weather = await snowEmergencyService.getWeatherConditions();
      setWeatherConditions(weather);

      // In production, fetch data from API or local storage
      // For now, we'll use placeholder empty data
      // The actual data would be loaded via:
      // const streetCleaningData = await fetch('/api/map/layers/street-cleaning/geojson');

      // Placeholder: layers start with no data until data is loaded
      setLayers((currentLayers) =>
        currentLayers.map((layer) => ({
          ...layer,
          // data would be populated here from API
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load layer data'));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Update segment statuses when time changes
   */
  useEffect(() => {
    if (!weatherConditions) return;

    setLayers((currentLayers) =>
      currentLayers.map((layer) => {
        if (!layer.data) return layer;

        // Update each segment's status
        const updatedFeatures = layer.data.features.map((segment) =>
          updateSegmentStatus(segment, simulatedTime, userPermits, weatherConditions)
        );

        return {
          ...layer,
          data: {
            ...layer.data,
            features: updatedFeatures,
          },
        };
      })
    );
  }, [simulatedTime, userPermits, weatherConditions]);

  /**
   * Toggle layer visibility
   */
  const toggleLayer = useCallback((layerId: string) => {
    setLayers((currentLayers) =>
      currentLayers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              visibility: layer.visibility === 'visible' ? 'none' : 'visible',
              enabled: !layer.enabled,
            }
          : layer
      )
    );
  }, []);

  /**
   * Set specific layer visibility
   */
  const setLayerVisibility = useCallback((layerId: string, visible: boolean) => {
    setLayers((currentLayers) =>
      currentLayers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              visibility: visible ? 'visible' : 'none',
              enabled: visible,
            }
          : layer
      )
    );
  }, []);

  /**
   * Refresh all layer data
   */
  const refreshLayers = useCallback(async () => {
    await loadLayerData();
  }, [loadLayerData]);

  // Initial load
  useEffect(() => {
    loadLayerData();
  }, [loadLayerData]);

  return {
    layers,
    loading,
    error,
    toggleLayer,
    setLayerVisibility,
    refreshLayers,
    weatherConditions,
  };
}

export default useParkingLayers;
