/**
 * FilterPanel Component
 *
 * Allows users to filter which restriction types are shown on the map,
 * and set user context like permits and vehicle type.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  ViewStyle,
} from 'react-native';
import { LAYER_COLORS } from '../../services/parking-map/types';

// =============================================================================
// Types
// =============================================================================

export interface MapFilters {
  showStreetCleaning: boolean;
  showSnowRoutes: boolean;
  showPermitZones: boolean;
  showMeters: boolean;
  showLoadingZones: boolean;
  showTowZones: boolean;
  showGarages: boolean;
}

export interface UserFilterContext {
  permits: string[];
  vehicleType: 'car' | 'motorcycle' | 'commercial' | 'oversized';
  hasDisabledPlacard: boolean;
}

export interface FilterPanelProps {
  filters: MapFilters;
  userContext: UserFilterContext;
  onFiltersChange: (filters: MapFilters) => void;
  onUserContextChange: (context: UserFilterContext) => void;
  style?: ViewStyle;
  onClose?: () => void;
}

// =============================================================================
// Default Values
// =============================================================================

export const DEFAULT_MAP_FILTERS: MapFilters = {
  showStreetCleaning: true,
  showSnowRoutes: true,
  showPermitZones: true,
  showMeters: true,
  showLoadingZones: false,
  showTowZones: true,
  showGarages: false,
};

export const DEFAULT_USER_CONTEXT: UserFilterContext = {
  permits: [],
  vehicleType: 'car',
  hasDisabledPlacard: false,
};

// =============================================================================
// Filter Items Configuration
// =============================================================================

interface FilterItem {
  key: keyof MapFilters;
  label: string;
  color: string;
  icon: string;
}

const FILTER_ITEMS: FilterItem[] = [
  {
    key: 'showStreetCleaning',
    label: 'Street Cleaning',
    color: LAYER_COLORS.restricted,
    icon: '🧹',
  },
  {
    key: 'showSnowRoutes',
    label: 'Snow Routes',
    color: LAYER_COLORS.conditional,
    icon: '❄',
  },
  {
    key: 'showPermitZones',
    label: 'Permit Zones',
    color: LAYER_COLORS.permitRequired,
    icon: '🅿',
  },
  {
    key: 'showMeters',
    label: 'Meters',
    color: LAYER_COLORS.metered,
    icon: '🪙',
  },
  {
    key: 'showTowZones',
    label: 'Tow Zones',
    color: LAYER_COLORS.towZone,
    icon: '🚛',
  },
  {
    key: 'showLoadingZones',
    label: 'Loading Zones',
    color: '#f59e0b',
    icon: '📦',
  },
  {
    key: 'showGarages',
    label: 'Garages',
    color: '#6366f1',
    icon: '🏢',
  },
];

// =============================================================================
// Vehicle Types
// =============================================================================

interface VehicleTypeOption {
  value: UserFilterContext['vehicleType'];
  label: string;
  icon: string;
}

const VEHICLE_TYPES: VehicleTypeOption[] = [
  { value: 'car', label: 'Car', icon: '🚗' },
  { value: 'motorcycle', label: 'Motorcycle', icon: '🏍' },
  { value: 'commercial', label: 'Commercial', icon: '🚐' },
  { value: 'oversized', label: 'Oversized', icon: '🚛' },
];

// =============================================================================
// Component
// =============================================================================

export function FilterPanel({
  filters,
  userContext,
  onFiltersChange,
  onUserContextChange,
  style,
  onClose,
}: FilterPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleFilter = (key: keyof MapFilters) => {
    onFiltersChange({
      ...filters,
      [key]: !filters[key],
    });
  };

  const setVehicleType = (type: UserFilterContext['vehicleType']) => {
    onUserContextChange({
      ...userContext,
      vehicleType: type,
    });
  };

  const toggleDisabledPlacard = () => {
    onUserContextChange({
      ...userContext,
      hasDisabledPlacard: !userContext.hasDisabledPlacard,
    });
  };

  return (
    <View style={[styles.container, style]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Map Filters</Text>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Layer Toggles */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Show on Map</Text>
          {FILTER_ITEMS.map((item) => (
            <View key={item.key} style={styles.filterRow}>
              <View style={styles.filterInfo}>
                <View
                  style={[styles.colorIndicator, { backgroundColor: item.color }]}
                />
                <Text style={styles.filterIcon}>{item.icon}</Text>
                <Text style={styles.filterLabel}>{item.label}</Text>
              </View>
              <Switch
                value={filters[item.key]}
                onValueChange={() => toggleFilter(item.key)}
                trackColor={{ false: '#d1d5db', true: '#3b82f6' }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </View>

        {/* Advanced Toggle */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <Text style={styles.advancedToggleText}>
            {showAdvanced ? 'Hide' : 'Show'} Advanced Options
          </Text>
          <Text style={styles.advancedToggleIcon}>
            {showAdvanced ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {/* Advanced Options */}
        {showAdvanced && (
          <>
            {/* Vehicle Type */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Vehicle</Text>
              <View style={styles.vehicleGrid}>
                {VEHICLE_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.value}
                    style={[
                      styles.vehicleButton,
                      userContext.vehicleType === type.value &&
                        styles.vehicleButtonActive,
                    ]}
                    onPress={() => setVehicleType(type.value)}
                  >
                    <Text style={styles.vehicleIcon}>{type.icon}</Text>
                    <Text
                      style={[
                        styles.vehicleLabel,
                        userContext.vehicleType === type.value &&
                          styles.vehicleLabelActive,
                      ]}
                    >
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Disabled Placard */}
            <View style={styles.section}>
              <View style={styles.filterRow}>
                <View style={styles.filterInfo}>
                  <Text style={styles.filterIcon}>♿</Text>
                  <Text style={styles.filterLabel}>Disabled Placard</Text>
                </View>
                <Switch
                  value={userContext.hasDisabledPlacard}
                  onValueChange={toggleDisabledPlacard}
                  trackColor={{ false: '#d1d5db', true: '#3b82f6' }}
                  thumbColor="#fff"
                />
              </View>
              {userContext.hasDisabledPlacard && (
                <Text style={styles.placardNote}>
                  Note: SF tow zones have NO disabled placard exemption
                </Text>
              )}
            </View>

            {/* Permits */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Permits</Text>
              {userContext.permits.length === 0 ? (
                <Text style={styles.noPermitsText}>
                  No permits added. Add your parking permits to see personalized
                  parking info.
                </Text>
              ) : (
                userContext.permits.map((permit, index) => (
                  <View key={index} style={styles.permitItem}>
                    <Text style={styles.permitText}>Zone {permit}</Text>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.addPermitButton}>
                <Text style={styles.addPermitText}>+ Add Permit</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            Always verify with posted signs. Data may not reflect recent changes.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    maxHeight: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  closeButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#3b82f6',
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  filterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  colorIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  filterIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  filterLabel: {
    fontSize: 15,
    color: '#374151',
  },
  advancedToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  advancedToggleText: {
    fontSize: 14,
    color: '#6b7280',
    marginRight: 4,
  },
  advancedToggleIcon: {
    fontSize: 10,
    color: '#6b7280',
  },
  vehicleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  vehicleButton: {
    width: '48%',
    marginHorizontal: '1%',
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  vehicleButtonActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
  },
  vehicleIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  vehicleLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  vehicleLabelActive: {
    color: '#3b82f6',
    fontWeight: '500',
  },
  placardNote: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 4,
    marginLeft: 32,
  },
  noPermitsText: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  permitItem: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  permitText: {
    fontSize: 14,
    color: '#374151',
  },
  addPermitButton: {
    paddingVertical: 8,
  },
  addPermitText: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '500',
  },
  disclaimer: {
    backgroundColor: '#fef3c7',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#92400e',
    textAlign: 'center',
  },
});

export default FilterPanel;
