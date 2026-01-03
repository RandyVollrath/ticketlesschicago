// Violation data types and utilities
// Data sourced from Chicago Data Portal - Building Violations

export interface ViolationCategory {
  n: string;  // name
  c: string;  // color
}

export interface ViolationBlock {
  lat: number;
  lng: number;
  count: number;
  severity: number;  // 0-100
  categories: Record<string, number>;
  ward: string;
  address: string;
}

export interface ViolationsData {
  meta: {
    date: string;
    total: number;
    blocks: number;
  };
  cats: Record<string, ViolationCategory>;
  data: [number, number, number, number, Record<string, number>, string, string][];
}

// Full category definitions with descriptions
export const VIOLATION_CATEGORIES = {
  safety: {
    name: "Critical Safety",
    shortName: "Safety",
    description: "Fire safety, heating, exits, CO/smoke detectors",
    color: "#dc2626",
    priority: 1,
  },
  struct: {
    name: "Structural",
    shortName: "Structural",
    description: "Walls, roofs, foundations, chimneys, parapets",
    color: "#ea580c",
    priority: 2,
  },
  porch: {
    name: "Porch & Stairs",
    shortName: "Porch",
    description: "Exterior stairs, porches, railings",
    color: "#f59e0b",
    priority: 3,
  },
  elec: {
    name: "Electrical",
    shortName: "Electrical",
    description: "Wiring, outlets, lighting fixtures",
    color: "#eab308",
    priority: 4,
  },
  window: {
    name: "Windows & Doors",
    shortName: "Windows",
    description: "Glass, frames, locks, security hardware",
    color: "#0ea5e9",
    priority: 5,
  },
  plumb: {
    name: "Plumbing",
    shortName: "Plumbing",
    description: "Water supply, drainage, hot water",
    color: "#3b82f6",
    priority: 6,
  },
  maint: {
    name: "Maintenance",
    shortName: "Maintenance",
    description: "Upkeep, cleanliness, pest control",
    color: "#8b5cf6",
    priority: 7,
  },
  permit: {
    name: "Permits & Registration",
    shortName: "Permits",
    description: "Administrative and permit violations",
    color: "#6b7280",
    priority: 8,
  },
  public: {
    name: "Public Way",
    shortName: "Public",
    description: "Snow removal, sidewalks, public areas",
    color: "#14b8a6",
    priority: 9,
  },
} as const;

export type ViolationCategoryKey = keyof typeof VIOLATION_CATEGORIES;

// Parse raw data into structured blocks
export function parseViolationsData(raw: ViolationsData): ViolationBlock[] {
  return raw.data.map(([lat, lng, count, severity, categories, ward, address]) => ({
    lat,
    lng,
    count,
    severity,
    categories,
    ward,
    address,
  }));
}

// Get severity level (high, medium, low) from score
export function getSeverityLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// Get severity color based on score
export function getSeverityColor(score: number): string {
  if (score >= 70) return '#dc2626';  // red
  if (score >= 40) return '#f59e0b';  // amber
  return '#22c55e';  // green
}

// Get top categories for a block
export function getTopCategories(
  categories: Record<string, number>,
  limit = 3
): { key: ViolationCategoryKey; count: number; name: string; color: string }[] {
  return Object.entries(categories)
    .filter(([key]) => key in VIOLATION_CATEGORIES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => {
      const cat = VIOLATION_CATEGORIES[key as ViolationCategoryKey];
      return {
        key: key as ViolationCategoryKey,
        count,
        name: cat.shortName,
        color: cat.color,
      };
    });
}

// Calculate total violations from categories
export function getTotalViolations(categories: Record<string, number>): number {
  return Object.values(categories).reduce((sum, count) => sum + count, 0);
}

// Filter blocks by category
export function filterBlocksByCategory(
  blocks: ViolationBlock[],
  category: ViolationCategoryKey | 'all'
): ViolationBlock[] {
  if (category === 'all') return blocks;
  return blocks.filter(block => (block.categories[category] || 0) > 0);
}

// Filter blocks by minimum count
export function filterBlocksByCount(
  blocks: ViolationBlock[],
  minCount: number
): ViolationBlock[] {
  return blocks.filter(block => block.count >= minCount);
}

// Get blocks near a location
export function getBlocksNearLocation(
  blocks: ViolationBlock[],
  lat: number,
  lng: number,
  radiusMiles: number
): ViolationBlock[] {
  const R = 3959; // Earth radius in miles

  return blocks.filter(block => {
    const dLat = (block.lat - lat) * Math.PI / 180;
    const dLng = (block.lng - lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat * Math.PI / 180) * Math.cos(block.lat * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance <= radiusMiles;
  });
}

// Aggregate statistics for a set of blocks
export function aggregateBlockStats(blocks: ViolationBlock[]): {
  totalViolations: number;
  totalBlocks: number;
  categoryTotals: Record<string, number>;
  avgSeverity: number;
  highSeverityCount: number;
} {
  const categoryTotals: Record<string, number> = {};
  let totalViolations = 0;
  let severitySum = 0;
  let highSeverityCount = 0;

  for (const block of blocks) {
    totalViolations += block.count;
    severitySum += block.severity;
    if (block.severity >= 70) highSeverityCount++;

    for (const [cat, count] of Object.entries(block.categories)) {
      categoryTotals[cat] = (categoryTotals[cat] || 0) + count;
    }
  }

  return {
    totalViolations,
    totalBlocks: blocks.length,
    categoryTotals,
    avgSeverity: blocks.length > 0 ? severitySum / blocks.length : 0,
    highSeverityCount,
  };
}
