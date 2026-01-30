/**
 * ParkingMap Component
 *
 * Interactive map showing color-coded street segments for parking availability.
 * Chicago-specific implementation using react-native-maps.
 *
 * HIDDEN BY FEATURE FLAG - Not visible to users until enabled.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Platform,
} from 'react-native';
// Note: react-native-maps needs to be installed: npm install react-native-maps
// For now, using conditional import to allow TypeScript compilation
let MapView: any;
let Polyline: any;
let PROVIDER_GOOGLE: any;
try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Polyline = maps.Polyline;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} catch {
  // Maps not installed - will be handled at runtime
}

interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

import { useParkingLayers } from '../../hooks/useParkingLayers';
import { useTimeSimulation } from '../../hooks/useTimeSimulation';
import {
  StreetSegment,
  ParkingStatus,
  CHICAGO_MAP_CONFIG,
  LAYER_COLORS,
} from '../../services/parking-map/types';

import TimeSlider from './TimeSlider';
import LayerToggles from './LayerToggles';
import Legend from './Legend';
import SegmentPopup from './SegmentPopup';

// =============================================================================
// Types
// =============================================================================

export interface ParkingMapProps {
  userPermits?: string[];
  showControls?: boolean;
  onSegmentSelect?: (segment: StreetSegment | null) => void;
  onSetReminder?: (segment: StreetSegment) => void;
  initialRegion?: Region;
}

// =============================================================================
// Component
// =============================================================================

export function ParkingMap({
  userPermits = [],
  showControls = true,
  onSegmentSelect,
  onSetReminder,
  initialRegion,
}: ParkingMapProps) {
  const mapRef = useRef<any>(null);
  const [selectedSegment, setSelectedSegment] = useState<StreetSegment | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Time simulation
  const {
    simulatedTime,
    setSimulatedTime,
    offsetHours,
    setOffsetHours,
    resetToNow,
    isLive,
    formattedTime,
    formattedDate,
    timeRange,
  } = useTimeSimulation();

  // Parking layers
  const {
    layers,
    loading,
    error,
    toggleLayer,
    weatherConditions,
  } = useParkingLayers(simulatedTime, userPermits);

  // Default region (Chicago)
  const defaultRegion: Region = initialRegion || {
    latitude: 41.8781,
    longitude: -87.6298,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  /**
   * Handle segment press
   */
  const handleSegmentPress = useCallback(
    (segment: StreetSegment) => {
      setSelectedSegment(segment);
      onSegmentSelect?.(segment);
    },
    [onSegmentSelect]
  );

  /**
   * Close segment popup
   */
  const handleClosePopup = useCallback(() => {
    setSelectedSegment(null);
    onSegmentSelect?.(null);
  }, [onSegmentSelect]);

  /**
   * Handle set reminder
   */
  const handleSetReminder = useCallback(
    (segment: StreetSegment) => {
      onSetReminder?.(segment);
      handleClosePopup();
    },
    [onSetReminder, handleClosePopup]
  );

  /**
   * Get color for parking status
   */
  const getStatusColor = useCallback((status: ParkingStatus): string => {
    switch (status) {
      case 'allowed':
        return LAYER_COLORS.allowed;
      case 'restricted':
        return LAYER_COLORS.restricted;
      case 'warning':
        return LAYER_COLORS.warning;
      default:
        return LAYER_COLORS.unknown;
    }
  }, []);

  /**
   * Render street segment polylines
   */
  const renderSegments = useCallback(() => {
    const polylines: React.ReactNode[] = [];

    for (const layer of layers) {
      if (layer.visibility !== 'visible' || !layer.data) continue;

      for (const segment of layer.data.features) {
        const { geometry, properties } = segment;
        if (geometry.type !== 'LineString') continue;

        const coordinates = geometry.coordinates.map(([lng, lat]) => ({
          latitude: lat,
          longitude: lng,
        }));

        const color = getStatusColor(properties.currentStatus);

        polylines.push(
          <Polyline
            key={properties.segmentId}
            coordinates={coordinates}
            strokeColor={color}
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
            tappable
            onPress={() => handleSegmentPress(segment)}
          />
        );
      }
    }

    return polylines;
  }, [layers, getStatusColor, handleSegmentPress]);

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={defaultRegion}
        onMapReady={() => setMapReady(true)}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {mapReady && renderSegments()}
      </MapView>

      {/* Snow Emergency Banner */}
      {weatherConditions?.snowEmergencyActive && (
        <View style={styles.emergencyBanner}>
          <Text style={styles.emergencyText}>
            ⚠️ Snow Emergency Active - 2" ban in effect
          </Text>
        </View>
      )}

      {/* Time indicator (when not live) */}
      {!isLive && (
        <View style={styles.timeIndicator}>
          <Text style={styles.timeIndicatorText}>
            Viewing: {formattedDate} {formattedTime}
          </Text>
        </View>
      )}

      {/* Controls */}
      {showControls && (
        <>
          <LayerToggles
            layers={layers}
            onToggle={toggleLayer}
            style={styles.layerToggles}
          />

          <TimeSlider
            offsetHours={offsetHours}
            maxHours={timeRange.maxHours}
            onOffsetChange={setOffsetHours}
            onReset={resetToNow}
            formattedTime={formattedTime}
            formattedDate={formattedDate}
            isLive={isLive}
            style={styles.timeSlider}
          />

          <Legend style={styles.legend} />
        </>
      )}

      {/* Segment Popup */}
      {selectedSegment && (
        <SegmentPopup
          segment={selectedSegment}
          time={simulatedTime}
          onClose={handleClosePopup}
          onSetReminder={handleSetReminder}
        />
      )}

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading parking data...</Text>
        </View>
      )}

      {/* Error Message */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>
            Error loading data. Pull down to retry.
          </Text>
        </View>
      )}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  map: {
    flex: 1,
  },
  emergencyBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ef4444',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  emergencyText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  timeIndicator: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  timeIndicatorText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  layerToggles: {
    position: 'absolute',
    top: 100,
    right: 16,
  },
  timeSlider: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
  },
  legend: {
    position: 'absolute',
    bottom: 16,
    left: 16,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#374151',
  },
  errorBanner: {
    position: 'absolute',
    bottom: 200,
    left: 16,
    right: 16,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    color: '#991b1b',
    textAlign: 'center',
  },
});

export default ParkingMap;
