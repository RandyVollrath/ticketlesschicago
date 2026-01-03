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

// ============================================
// BUILDING PERMITS
// ============================================
export interface PermitBlock {
  lat: number;
  lng: number;
  count: number;
  score: number;
  categories: Record<string, number>;
  ward: string;
  address: string;
  totalCost: number;
  recentCount: number;
}

export interface PermitsData {
  meta: {
    date: string;
    total: number;
    blocks: number;
  };
  cats: Record<string, { n: string; c: string }>;
  data: [number, number, number, number, Record<string, number>, string, string, number, number][];
}

export const PERMIT_CATEGORIES = {
  new_construction: {
    name: "New Construction",
    shortName: "New Build",
    description: "New building construction",
    color: "#22c55e",
    priority: 1,
  },
  renovation: {
    name: "Renovation",
    shortName: "Renovation",
    description: "Renovation and alteration work",
    color: "#3b82f6",
    priority: 2,
  },
  electrical: {
    name: "Electrical",
    shortName: "Electrical",
    description: "Electrical permits",
    color: "#eab308",
    priority: 3,
  },
  plumbing: {
    name: "Plumbing",
    shortName: "Plumbing",
    description: "Plumbing permits",
    color: "#0ea5e9",
    priority: 4,
  },
  signs: {
    name: "Signs",
    shortName: "Signs",
    description: "Sign permits",
    color: "#8b5cf6",
    priority: 5,
  },
  demolition: {
    name: "Demolition",
    shortName: "Demo",
    description: "Demolition permits",
    color: "#ef4444",
    priority: 6,
  },
  other: {
    name: "Other",
    shortName: "Other",
    description: "Other permits",
    color: "#6b7280",
    priority: 7,
  },
} as const;

export type PermitCategoryKey = keyof typeof PERMIT_CATEGORIES;

export function parsePermitsData(raw: PermitsData): PermitBlock[] {
  return raw.data.map(([lat, lng, count, score, categories, ward, address, totalCost, recentCount]) => ({
    lat,
    lng,
    count,
    score,
    categories,
    ward,
    address,
    totalCost,
    recentCount,
  }));
}

// ============================================
// BUSINESS LICENSES
// ============================================
export interface LicenseBlock {
  lat: number;
  lng: number;
  count: number;
  score: number;
  categories: Record<string, number>;
  ward: string;
  address: string;
  activeCount: number;
}

export interface LicensesData {
  meta: {
    date: string;
    total: number;
    blocks: number;
  };
  cats: Record<string, { n: string; c: string }>;
  data: [number, number, number, number, Record<string, number>, string, string, number][];
}

export const LICENSE_CATEGORIES = {
  food: {
    name: "Food/Restaurant",
    shortName: "Food",
    description: "Food service, restaurants, taverns",
    color: "#f97316",
    priority: 1,
  },
  retail: {
    name: "Retail",
    shortName: "Retail",
    description: "Retail sales",
    color: "#3b82f6",
    priority: 2,
  },
  service: {
    name: "Services",
    shortName: "Services",
    description: "Service businesses, salons, repairs",
    color: "#22c55e",
    priority: 3,
  },
  entertainment: {
    name: "Entertainment",
    shortName: "Entertainment",
    description: "Entertainment venues",
    color: "#8b5cf6",
    priority: 4,
  },
  tobacco: {
    name: "Tobacco",
    shortName: "Tobacco",
    description: "Tobacco retailers",
    color: "#6b7280",
    priority: 5,
  },
  other: {
    name: "Other",
    shortName: "Other",
    description: "Other business types",
    color: "#94a3b8",
    priority: 6,
  },
} as const;

export type LicenseCategoryKey = keyof typeof LICENSE_CATEGORIES;

export function parseLicensesData(raw: LicensesData): LicenseBlock[] {
  return raw.data.map(([lat, lng, count, score, categories, ward, address, activeCount]) => ({
    lat,
    lng,
    count,
    score,
    categories,
    ward,
    address,
    activeCount,
  }));
}

// ============================================
// POTHOLES PATCHED
// ============================================
export interface PotholeBlock {
  lat: number;
  lng: number;
  repairCount: number;
  potholesFilled: number;
  score: number;
  address: string;
  recentCount: number;
}

export interface PotholesData {
  meta: {
    date: string;
    total_repairs: number;
    total_potholes: number;
    blocks: number;
  };
  data: [number, number, number, number, number, string, number][];
}

export function parsePotholesData(raw: PotholesData): PotholeBlock[] {
  return raw.data.map(([lat, lng, repairCount, potholesFilled, score, address, recentCount]) => ({
    lat,
    lng,
    repairCount,
    potholesFilled,
    score,
    address,
    recentCount,
  }));
}

// ============================================
// CAMERA VIOLATIONS (Red Light + Speed)
// ============================================
export interface CameraViolation {
  lat: number;
  lng: number;
  violations: number;
  cameraId: string;
  location: string;
}

export interface CameraViolationsData {
  meta: {
    date: string;
    cameras: number;
    total_violations: number;
  };
  data: [number, number, number, string, string][];
}

export function parseCameraViolationsData(raw: CameraViolationsData): CameraViolation[] {
  return raw.data.map(([lat, lng, violations, cameraId, location]) => ({
    lat,
    lng,
    violations,
    cameraId,
    location,
  }));
}

// ============================================
// AGGREGATE FUNCTIONS FOR NEW DATA
// ============================================

export function aggregatePermitStats(blocks: PermitBlock[]): {
  totalPermits: number;
  totalBlocks: number;
  totalCost: number;
  recentPermits: number;
} {
  let totalPermits = 0;
  let totalCost = 0;
  let recentPermits = 0;

  for (const block of blocks) {
    totalPermits += block.count;
    totalCost += block.totalCost;
    recentPermits += block.recentCount;
  }

  return {
    totalPermits,
    totalBlocks: blocks.length,
    totalCost,
    recentPermits,
  };
}

export function aggregateLicenseStats(blocks: LicenseBlock[]): {
  totalLicenses: number;
  totalBlocks: number;
  activeLicenses: number;
  topCategory: string;
} {
  let totalLicenses = 0;
  let activeLicenses = 0;
  const categoryTotals: Record<string, number> = {};

  for (const block of blocks) {
    totalLicenses += block.count;
    activeLicenses += block.activeCount;
    for (const [cat, count] of Object.entries(block.categories)) {
      categoryTotals[cat] = (categoryTotals[cat] || 0) + count;
    }
  }

  const topCategory = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  return {
    totalLicenses,
    totalBlocks: blocks.length,
    activeLicenses,
    topCategory,
  };
}

export function aggregatePotholeStats(blocks: PotholeBlock[]): {
  totalRepairs: number;
  totalPotholes: number;
  totalBlocks: number;
  recentRepairs: number;
} {
  let totalRepairs = 0;
  let totalPotholes = 0;
  let recentRepairs = 0;

  for (const block of blocks) {
    totalRepairs += block.repairCount;
    totalPotholes += block.potholesFilled;
    recentRepairs += block.recentCount;
  }

  return {
    totalRepairs,
    totalPotholes,
    totalBlocks: blocks.length,
    recentRepairs,
  };
}

export function getPermitScoreColor(score: number): string {
  if (score >= 70) return '#22c55e';  // green - high development
  if (score >= 40) return '#3b82f6';  // blue - moderate
  return '#94a3b8';  // gray - lower activity
}

export function getLicenseScoreColor(score: number): string {
  if (score >= 70) return '#f97316';  // orange - high business density
  if (score >= 40) return '#3b82f6';  // blue - moderate
  return '#94a3b8';  // gray - lower density
}

export function getPotholeScoreColor(score: number): string {
  if (score >= 70) return '#dc2626';  // red - many potholes
  if (score >= 40) return '#f59e0b';  // amber - moderate
  return '#22c55e';  // green - fewer issues
}
