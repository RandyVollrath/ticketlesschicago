/**
 * LayerToggles Component
 *
 * Toggle buttons for showing/hiding parking restriction layers.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { ParkingRestrictionLayer } from '../../services/parking-map/types';

// =============================================================================
// Types
// =============================================================================

export interface LayerTogglesProps {
  layers: ParkingRestrictionLayer[];
  onToggle: (layerId: string) => void;
  style?: ViewStyle;
}

// =============================================================================
// Component
// =============================================================================

export function LayerToggles({ layers, onToggle, style }: LayerTogglesProps) {
  const [expanded, setExpanded] = useState(false);

  // Layer icons
  const layerIcons: Record<string, string> = {
    'street-cleaning': '🧹',
    'snow-routes': '❄️',
    'winter-ban': '🌙',
    'permit-zones': '🅿️',
  };

  return (
    <View style={[styles.container, style]}>
      {/* Toggle Button */}
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        style={styles.toggleButton}
      >
        <Text style={styles.toggleIcon}>🗺️</Text>
        <Text style={styles.toggleText}>Layers</Text>
        <Text style={styles.chevron}>{expanded ? '▼' : '◀'}</Text>
      </TouchableOpacity>

      {/* Layer List */}
      {expanded && (
        <View style={styles.layerList}>
          {layers.map((layer) => (
            <TouchableOpacity
              key={layer.id}
              onPress={() => onToggle(layer.id)}
              style={[
                styles.layerItem,
                layer.enabled && styles.layerItemActive,
              ]}
            >
              <Text style={styles.layerIcon}>
                {layerIcons[layer.type] || '📍'}
              </Text>
              <Text
                style={[
                  styles.layerName,
                  !layer.enabled && styles.layerNameDisabled,
                ]}
              >
                {layer.name}
              </Text>
              <View
                style={[
                  styles.checkbox,
                  layer.enabled && styles.checkboxActive,
                ]}
              >
                {layer.enabled && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>
          ))}
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
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  toggleIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    flex: 1,
  },
  chevron: {
    fontSize: 10,
    color: '#6b7280',
  },
  layerList: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  layerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  layerItemActive: {
    backgroundColor: '#f0f9ff',
  },
  layerIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  layerName: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  layerNameDisabled: {
    color: '#9ca3af',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default LayerToggles;
