/**
 * Segment Colorizer
 *
 * Determines the color for street segments based on parking status,
 * user context, and current conditions.
 */

import {
  StreetSegment,
  ParkingStatus,
  UserContext,
  SegmentColorResult,
  LAYER_COLORS,
} from './types';
import { computeParkingStatus } from './compute';

// =============================================================================
// Color Configuration
// =============================================================================

interface ColorConfig {
  primary: string;
  opacity: number;
  dashPattern?: number[];
  pulseAnimation?: boolean;
}

const STATUS_COLOR_CONFIG: Record<ParkingStatus, ColorConfig> = {
  allowed: {
    primary: LAYER_COLORS.allowed,
    opacity: 0.8,
  },
  restricted: {
    primary: LAYER_COLORS.restricted,
    opacity: 0.8,
  },
  'tow-zone': {
    primary: LAYER_COLORS.towZone,
    opacity: 0.9,
  },
  warning: {
    primary: LAYER_COLORS.warning,
    opacity: 0.8,
    pulseAnimation: true,
  },
  'permit-required': {
    primary: LAYER_COLORS.permitRequired,
    opacity: 0.7,
  },
  metered: {
    primary: LAYER_COLORS.metered,
    opacity: 0.7,
  },
  conditional: {
    primary: LAYER_COLORS.conditional,
    opacity: 0.7,
    dashPattern: [4, 4],
  },
  unknown: {
    primary: LAYER_COLORS.unknown,
    opacity: 0.5,
    dashPattern: [2, 2],
  },
};

// =============================================================================
// Main Colorizer Function
// =============================================================================

/**
 * Get the color for a street segment based on parking status and user context
 */
export function getSegmentColor(
  segment: StreetSegment,
  time: Date,
  userContext: UserContext
): SegmentColorResult {
  const statusResult = computeParkingStatus(
    segment,
    time,
    userContext.permits || []
  );

  // Handle different statuses with special logic
  switch (statusResult.status) {
    case 'allowed':
      return STATUS_COLOR_CONFIG.allowed;

    case 'restricted':
      // Check if tow risk - use darker red
      const hasTowRisk = statusResult.reasons?.some((r) => r.towRisk);
      if (hasTowRisk) {
        return STATUS_COLOR_CONFIG['tow-zone'];
      }
      return STATUS_COLOR_CONFIG.restricted;

    case 'warning':
      return STATUS_COLOR_CONFIG.warning;

    case 'unknown':
    default:
      // Check specific restriction types for better coloring
      return getColorForRestrictionTypes(segment, userContext);
  }
}

/**
 * Get color based on restriction types when status is unknown or needs refinement
 */
function getColorForRestrictionTypes(
  segment: StreetSegment,
  userContext: UserContext
): SegmentColorResult {
  const restrictions = segment.properties.restrictions;

  // Check for permit zones
  const permitRestriction = restrictions.find((r) => r.type === 'permit-zone');
  if (permitRestriction) {
    // If user has the permit, show as allowed
    const permitZone = permitRestriction.schedule.permitZone;
    if (permitZone && userContext.permits?.includes(permitZone)) {
      return {
        primary: LAYER_COLORS.allowed,
        opacity: 0.8,
      };
    }
    return STATUS_COLOR_CONFIG['permit-required'];
  }

  // Check for metered parking
  const meteredRestriction = restrictions.find((r) => r.type === 'metered');
  if (meteredRestriction) {
    return STATUS_COLOR_CONFIG.metered;
  }

  // Check for conditional restrictions (snow routes, weather-dependent)
  const conditionalRestriction = restrictions.find(
    (r) =>
      r.type === 'snow-route' ||
      r.type === 'winter-ban' ||
      r.type === 'snow-emergency'
  );
  if (conditionalRestriction) {
    return STATUS_COLOR_CONFIG.conditional;
  }

  return STATUS_COLOR_CONFIG.unknown;
}

// =============================================================================
// Batch Processing
// =============================================================================

/**
 * Get colors for multiple segments at once (performance optimization)
 */
export function getSegmentColors(
  segments: StreetSegment[],
  time: Date,
  userContext: UserContext
): Map<string, SegmentColorResult> {
  const results = new Map<string, SegmentColorResult>();

  for (const segment of segments) {
    const segmentId = segment.properties.segmentId;
    const color = getSegmentColor(segment, time, userContext);
    results.set(segmentId, color);
  }

  return results;
}

// =============================================================================
// Color Utilities
// =============================================================================

/**
 * Get contrasting text color for a background color
 */
export function getContrastTextColor(backgroundColor: string): string {
  // Remove # if present
  const hex = backgroundColor.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Lighten a color by a percentage
 */
export function lightenColor(color: string, percent: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  const newR = Math.min(255, Math.round(r + (255 - r) * percent));
  const newG = Math.min(255, Math.round(g + (255 - g) * percent));
  const newB = Math.min(255, Math.round(b + (255 - b) * percent));

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

/**
 * Darken a color by a percentage
 */
export function darkenColor(color: string, percent: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  const newR = Math.max(0, Math.round(r * (1 - percent)));
  const newG = Math.max(0, Math.round(g * (1 - percent)));
  const newB = Math.max(0, Math.round(b * (1 - percent)));

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// =============================================================================
// Exports
// =============================================================================

export default {
  getSegmentColor,
  getSegmentColors,
  getContrastTextColor,
  lightenColor,
  darkenColor,
  STATUS_COLOR_CONFIG,
};
