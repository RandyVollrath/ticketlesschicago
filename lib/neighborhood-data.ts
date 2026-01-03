// Neighborhood data types and utilities for 311, Crimes, and Crashes layers

// ============================================
// 311 SERVICE REQUESTS
// ============================================
export interface ServiceRequestBlock {
  lat: number;
  lng: number;
  count: number;
  score: number;  // activity score 0-100
  categories: Record<string, number>;
  ward: string;
  address: string;
  recentCount: number;  // last 90 days
}

export interface ServiceRequestsData {
  meta: {
    date: string;
    total: number;
    blocks: number;
  };
  cats: Record<string, { n: string; c: string }>;
  data: [number, number, number, number, Record<string, number>, string, string, number][];
}

export const SERVICE_REQUEST_CATEGORIES = {
  infrastructure: {
    name: "Infrastructure",
    shortName: "Roads/Lights",
    description: "Potholes, street lights, traffic signals, sidewalks",
    color: "#6b7280",
    priority: 1,
  },
  sanitation: {
    name: "Sanitation",
    shortName: "Sanitation",
    description: "Graffiti, garbage, fly dumping, dead animals",
    color: "#84cc16",
    priority: 2,
  },
  pests: {
    name: "Pests",
    shortName: "Pests",
    description: "Rodents, stray animals",
    color: "#f97316",
    priority: 3,
  },
  vehicles: {
    name: "Abandoned Vehicles",
    shortName: "Vehicles",
    description: "Abandoned vehicle complaints",
    color: "#8b5cf6",
    priority: 4,
  },
  trees: {
    name: "Trees & Vegetation",
    shortName: "Trees",
    description: "Tree trimming, debris, weeds",
    color: "#22c55e",
    priority: 5,
  },
  water: {
    name: "Water/Sewer",
    shortName: "Water",
    description: "Water on street, sewer, leaks",
    color: "#0ea5e9",
    priority: 6,
  },
} as const;

export type ServiceRequestCategoryKey = keyof typeof SERVICE_REQUEST_CATEGORIES;

export function parseServiceRequestsData(raw: ServiceRequestsData): ServiceRequestBlock[] {
  return raw.data.map(([lat, lng, count, score, categories, ward, address, recentCount]) => ({
    lat,
    lng,
    count,
    score,
    categories,
    ward,
    address,
    recentCount,
  }));
}

// ============================================
// CRIMES
// ============================================
export interface CrimeBlock {
  lat: number;
  lng: number;
  count: number;
  score: number;  // severity score 0-100
  categories: Record<string, number>;
  ward: string;
  address: string;
  arrests: number;
}

export interface CrimesData {
  meta: {
    date: string;
    total: number;
    blocks: number;
    period: string;
  };
  cats: Record<string, { n: string; c: string }>;
  data: [number, number, number, number, Record<string, number>, string, string, number][];
}

export const CRIME_CATEGORIES = {
  violent: {
    name: "Violent Crime",
    shortName: "Violent",
    description: "Homicide, robbery, assault, battery, sexual assault",
    color: "#dc2626",
    priority: 1,
  },
  property: {
    name: "Property Crime",
    shortName: "Property",
    description: "Theft, burglary, motor vehicle theft, criminal damage",
    color: "#f59e0b",
    priority: 2,
  },
  drugs: {
    name: "Narcotics",
    shortName: "Drugs",
    description: "Drug-related offenses",
    color: "#8b5cf6",
    priority: 3,
  },
  weapons: {
    name: "Weapons",
    shortName: "Weapons",
    description: "Weapons violations",
    color: "#1f2937",
    priority: 4,
  },
  other: {
    name: "Other",
    shortName: "Other",
    description: "Other offenses, deceptive practice, trespass",
    color: "#6b7280",
    priority: 5,
  },
} as const;

export type CrimeCategoryKey = keyof typeof CRIME_CATEGORIES;

export function parseCrimesData(raw: CrimesData): CrimeBlock[] {
  return raw.data.map(([lat, lng, count, score, categories, ward, address, arrests]) => ({
    lat,
    lng,
    count,
    score,
    categories,
    ward,
    address,
    arrests,
  }));
}

// ============================================
// TRAFFIC CRASHES
// ============================================
export interface CrashBlock {
  lat: number;
  lng: number;
  count: number;
  score: number;  // danger score 0-100
  injuries: number;
  fatal: number;
  hitAndRun: number;
  address: string;
}

export interface CrashesData {
  meta: {
    date: string;
    total: number;
    blocks: number;
    total_injuries: number;
    total_fatal: number;
  };
  data: [number, number, number, number, number, number, number, string][];
}

export function parseCrashesData(raw: CrashesData): CrashBlock[] {
  return raw.data.map(([lat, lng, count, score, injuries, fatal, hitAndRun, address]) => ({
    lat,
    lng,
    count,
    score,
    injuries,
    fatal,
    hitAndRun,
    address,
  }));
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function getScoreLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function getScoreColor(score: number): string {
  if (score >= 70) return '#dc2626';  // red
  if (score >= 40) return '#f59e0b';  // amber
  return '#22c55e';  // green
}

export function getCrimeScoreColor(score: number): string {
  if (score >= 70) return '#dc2626';  // red - high crime
  if (score >= 40) return '#f59e0b';  // amber - medium
  return '#3b82f6';  // blue - lower crime
}

export function getCrashScoreColor(score: number): string {
  if (score >= 70) return '#dc2626';  // red - dangerous
  if (score >= 40) return '#f59e0b';  // amber - moderate
  return '#22c55e';  // green - safer
}

// Get blocks near a location
export function getBlocksNearLocation<T extends { lat: number; lng: number }>(
  blocks: T[],
  lat: number,
  lng: number,
  radiusMiles: number
): T[] {
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

// Aggregate stats for crime blocks
export function aggregateCrimeStats(blocks: CrimeBlock[]): {
  totalCrimes: number;
  totalBlocks: number;
  violentCount: number;
  propertyCount: number;
  arrestRate: number;
} {
  let totalCrimes = 0;
  let violentCount = 0;
  let propertyCount = 0;
  let totalArrests = 0;

  for (const block of blocks) {
    totalCrimes += block.count;
    violentCount += block.categories['violent'] || 0;
    propertyCount += block.categories['property'] || 0;
    totalArrests += block.arrests;
  }

  return {
    totalCrimes,
    totalBlocks: blocks.length,
    violentCount,
    propertyCount,
    arrestRate: totalCrimes > 0 ? (totalArrests / totalCrimes) * 100 : 0,
  };
}

// Aggregate stats for crash blocks
export function aggregateCrashStats(blocks: CrashBlock[]): {
  totalCrashes: number;
  totalBlocks: number;
  totalInjuries: number;
  totalFatal: number;
  hitAndRunCount: number;
} {
  let totalCrashes = 0;
  let totalInjuries = 0;
  let totalFatal = 0;
  let hitAndRunCount = 0;

  for (const block of blocks) {
    totalCrashes += block.count;
    totalInjuries += block.injuries;
    totalFatal += block.fatal;
    hitAndRunCount += block.hitAndRun;
  }

  return {
    totalCrashes,
    totalBlocks: blocks.length,
    totalInjuries,
    totalFatal,
    hitAndRunCount,
  };
}

// Aggregate stats for 311 blocks
export function aggregateServiceRequestStats(blocks: ServiceRequestBlock[]): {
  totalRequests: number;
  totalBlocks: number;
  recentRequests: number;
  topCategory: string;
} {
  let totalRequests = 0;
  let recentRequests = 0;
  const categoryTotals: Record<string, number> = {};

  for (const block of blocks) {
    totalRequests += block.count;
    recentRequests += block.recentCount;
    for (const [cat, count] of Object.entries(block.categories)) {
      categoryTotals[cat] = (categoryTotals[cat] || 0) + count;
    }
  }

  const topCategory = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  return {
    totalRequests,
    totalBlocks: blocks.length,
    recentRequests,
    topCategory,
  };
}
