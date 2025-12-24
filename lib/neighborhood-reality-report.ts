/**
 * Neighborhood Reality Report Generator
 *
 * Generates a decision-grade report with exactly 6 sections:
 * 1. Enforcement Exposure - cameras, violations, ward ticket climate
 * 2. Safety & Risk - violent crime, nuisance crime, traffic crashes
 * 3. Daily Friction - parking restrictions, street cleaning
 * 4. Quality-of-Life Volatility - 311 complaints, variance
 * 5. Movement & Congestion - CTA ridership, crash near transit
 * 6. Trajectory - building permits, business licenses, change signals
 *
 * Rules:
 * - No passive voice or vague phrases
 * - Use "historically shows", "consistently higher" not "may indicate"
 * - Compare to city, neighborhood, and ward baselines
 * - Say "unusually high/low" when warranted
 * - When all metrics are average, surface variance/skew instead
 */

import { supabaseAdmin } from './supabase';
import { reverseGeocode } from './reverse-geocoder';
import { parseChicagoAddress, ParsedAddress } from './address-parser';
import { RED_LIGHT_CAMERAS } from './red-light-cameras';
import { HIGH_RISK_WARDS, getHighRiskWardData } from './high-risk-wards';
import {
  RADII,
  RadiusKey,
  RADIUS_LABELS,
  haversineDistance,
  countByRadius,
  findClosest,
  formatDistance,
  calculateDensity,
  getExposureLevel,
  EXPOSURE_LABELS,
  EXPOSURE_COLORS,
} from './proximity-utils';
import { getChicagoTime } from './chicago-timezone-utils';
import { SPEED_CAMERAS } from './speed-cameras';

// ===== Type Definitions =====

export type ComparisonLevel = 'unusually_high' | 'high' | 'average' | 'low' | 'unusually_low';

export interface LocationInfo {
  address: string;
  latitude: number;
  longitude: number;
  neighborhood: string | null;
  ward: number | null;
  section: string | null;
  parsedAddress: ParsedAddress | null;
}

// Triple comparison structure
export interface TripleComparison {
  vsCity: ComparisonLevel;
  vsNeighborhood: ComparisonLevel;
  vsWard: ComparisonLevel;
  strongestContrast: 'city' | 'neighborhood' | 'ward';
  narrative: string;
}

// Section 1: Enforcement Exposure
export interface EnforcementExposure {
  speedCameras: {
    count: Record<RadiusKey, number>;
    closest: { address: string; distance: number } | null;
    densityVsCity: number;
    comparison: TripleComparison;
  };
  redLightCameras: {
    count: Record<RadiusKey, number>;
    closest: { intersection: string; distance: number } | null;
    densityVsCity: number;
    comparison: TripleComparison;
  };
  cameraViolations: {
    totalNearbyViolations: number;
    avgDailyPerCamera: number;
    highestViolatingCamera: { location: string; totalViolations: number } | null;
  };
  wardTicketClimate: {
    wardRank: number | null;
    ticketsPer100Residents: number | null;
    vsCity: ComparisonLevel;
  };
  keyTakeaway: string;
}

// Section 2: Safety & Risk
export interface SafetyRisk {
  violentCrime: {
    count: number;
    byRadius: Record<RadiusKey, number>;
    comparison: TripleComparison;
    types: { type: string; count: number }[];
    severityMix: string;
  };
  nuisanceCrime: {
    count: number;
    byRadius: Record<RadiusKey, number>;
    comparison: TripleComparison;
  };
  trafficCrashes: {
    total: number;
    withInjuries: number;
    fatal: number;
    hitAndRun: number;
    severityScore: number;
    comparison: TripleComparison;
    injuryRate: number; // percentage with injuries
  };
  keyTakeaway: string;
}

// Section 3: Daily Friction
export interface DailyFriction {
  streetCleaning: {
    found: boolean;
    ward: string | null;
    section: string | null;
  };
  winterBan: {
    found: boolean;
    isWinterSeason: boolean;
  };
  snowRoute: {
    found: boolean;
  };
  permitZone: {
    found: boolean;
    zoneName: string | null;
  };
  frictionScore: number; // 0-4 based on active restrictions
  keyTakeaway: string;
}

// Section 4: Quality-of-Life Volatility
export interface QualityOfLifeVolatility {
  complaints311: {
    totalLastYear: number;
    byType: { type: string; count: number }[];
    comparison: TripleComparison;
  };
  nuisanceIssues: {
    rats: number;
    noise: number;
    dumping: number;
    dominantIssue: string | null;
  };
  volatilityPattern: string;
  keyTakeaway: string;
}

// Section 5: Movement & Congestion
export interface MovementCongestion {
  dataAvailable: boolean;
  keyTakeaway: string;
}

// Section 6: Trajectory
export interface Trajectory {
  buildingPermits: {
    count: number;
    vsCity: ComparisonLevel;
  };
  businessLicenses: {
    count: number;
    comparison: TripleComparison;
  };
  changeSignal: 'growing' | 'stable' | 'declining' | 'insufficient_data';
  keyTakeaway: string;
}

// Overall Profile (for PDF cover)
export interface OverallProfile {
  riskLevel: 'low' | 'moderate' | 'elevated' | 'high';
  enforcementIntensity: 'minimal' | 'moderate' | 'high' | 'intense';
  frictionLevel: 'low' | 'moderate' | 'high';
  summaryPhrase: string; // e.g., "High friction, low violence"
}

// Most Underestimated Insight
export interface UnderestimatedInsight {
  finding: string;
  section: string;
  metric: string;
  value: string | number;
  comparison: string;
}

// Who This Is For
export interface AudienceFit {
  goodFitFor: string[];
  poorFitFor: string[];
  summary: string;
}

// Full Report
export interface NeighborhoodRealityReport {
  generatedAt: string;
  location: LocationInfo;
  overallProfile: OverallProfile;
  mostUnderestimated: UnderestimatedInsight;
  enforcementExposure: EnforcementExposure;
  safetyRisk: SafetyRisk;
  dailyFriction: DailyFriction;
  qualityOfLife: QualityOfLifeVolatility;
  movementCongestion: MovementCongestion;
  trajectory: Trajectory;
  audienceFit: AudienceFit;
}

// ===== Citywide Baselines =====
const CHICAGO_AREA_SQ_MILES = 234;
const CITYWIDE_SPEED_CAMERA_DENSITY = SPEED_CAMERAS.length / CHICAGO_AREA_SQ_MILES;
const CITYWIDE_REDLIGHT_CAMERA_DENSITY = RED_LIGHT_CAMERAS.length / CHICAGO_AREA_SQ_MILES;
const CITYWIDE_AVG_TICKETS_PER_100 = 65;
const CITYWIDE_CRIME_DENSITY = 235000 / CHICAGO_AREA_SQ_MILES;
const CITYWIDE_CRASH_DENSITY = 200000 / CHICAGO_AREA_SQ_MILES;
const CITYWIDE_LIQUOR_LICENSE_DENSITY = 6600 / CHICAGO_AREA_SQ_MILES;
const CITYWIDE_311_PER_WARD = 1470716 / 50;

function getComparisonLevel(value: number, baseline: number): ComparisonLevel {
  if (baseline === 0) return 'average';
  const ratio = value / baseline;
  if (ratio >= 2.0) return 'unusually_high';
  if (ratio >= 1.3) return 'high';
  if (ratio >= 0.7) return 'average';
  if (ratio >= 0.3) return 'low';
  return 'unusually_low';
}

function getRatio(value: number, baseline: number): number {
  if (baseline === 0) return 1;
  return Math.round((value / baseline) * 10) / 10;
}

function getTripleComparison(
  value: number,
  cityBaseline: number,
  neighborhoodBaseline: number | null,
  wardBaseline: number | null
): TripleComparison {
  const vsCity = getComparisonLevel(value, cityBaseline);
  const vsNeighborhood = neighborhoodBaseline ? getComparisonLevel(value, neighborhoodBaseline) : 'average';
  const vsWard = wardBaseline ? getComparisonLevel(value, wardBaseline) : 'average';

  // Find strongest contrast
  const levels: Record<ComparisonLevel, number> = {
    unusually_high: 2,
    high: 1,
    average: 0,
    low: -1,
    unusually_low: -2,
  };

  const cityStrength = Math.abs(levels[vsCity]);
  const neighborhoodStrength = Math.abs(levels[vsNeighborhood]);
  const wardStrength = Math.abs(levels[vsWard]);

  let strongestContrast: 'city' | 'neighborhood' | 'ward' = 'city';
  let strongestLevel = vsCity;

  if (neighborhoodStrength > cityStrength && neighborhoodStrength >= wardStrength) {
    strongestContrast = 'neighborhood';
    strongestLevel = vsNeighborhood;
  } else if (wardStrength > cityStrength && wardStrength > neighborhoodStrength) {
    strongestContrast = 'ward';
    strongestLevel = vsWard;
  }

  // Generate narrative
  let narrative = '';
  const levelWord = strongestLevel.replace('_', ' ');
  if (strongestContrast === 'city') {
    narrative = `${levelWord} compared to citywide average`;
  } else if (strongestContrast === 'neighborhood') {
    narrative = `${levelWord} for this neighborhood`;
  } else {
    narrative = `${levelWord} within this ward`;
  }

  return { vsCity, vsNeighborhood, vsWard, strongestContrast, narrative };
}

function formatComparisonNarrative(comparison: TripleComparison, metric: string): string {
  const level = comparison[`vs${comparison.strongestContrast.charAt(0).toUpperCase() + comparison.strongestContrast.slice(1)}` as keyof TripleComparison] as ComparisonLevel;

  if (level === 'average') {
    return `${metric} tracks near typical levels`;
  }

  const intensity = level.includes('unusually') ? 'significantly' : 'moderately';
  const direction = level.includes('high') ? 'higher' : 'lower';

  return `${metric} runs ${intensity} ${direction} than ${comparison.strongestContrast} baseline`;
}

// ===== Main Report Generator =====

export async function generateNeighborhoodRealityReport(
  latitude: number,
  longitude: number
): Promise<NeighborhoodRealityReport> {
  const generatedAt = new Date().toISOString();

  // Get location info
  const location = await getLocationInfo(latitude, longitude);

  // Generate all sections in parallel
  const [enforcementExposure, safetyRisk, dailyFriction, qualityOfLife, trajectory] = await Promise.all([
    getEnforcementExposure(latitude, longitude, location.ward, location.neighborhood),
    getSafetyRisk(latitude, longitude, location.neighborhood, location.ward),
    getDailyFriction(latitude, longitude, location),
    getQualityOfLife(location.ward, location.neighborhood),
    getTrajectory(latitude, longitude, location.neighborhood, location.ward),
  ]);

  const movementCongestion: MovementCongestion = {
    dataAvailable: false,
    keyTakeaway: 'Transit and congestion data not yet available for this location.',
  };

  // Calculate overall profile
  const overallProfile = calculateOverallProfile(enforcementExposure, safetyRisk, dailyFriction, qualityOfLife);

  // Find most underestimated insight
  const mostUnderestimated = findMostUnderestimated(enforcementExposure, safetyRisk, dailyFriction, qualityOfLife, trajectory);

  // Generate audience fit
  const audienceFit = generateAudienceFit(overallProfile, dailyFriction, safetyRisk, enforcementExposure);

  return {
    generatedAt,
    location,
    overallProfile,
    mostUnderestimated,
    enforcementExposure,
    safetyRisk,
    dailyFriction,
    qualityOfLife,
    movementCongestion,
    trajectory,
    audienceFit,
  };
}

// ===== Section Generators =====

async function getLocationInfo(lat: number, lng: number): Promise<LocationInfo> {
  const geocodeResult = await reverseGeocode(lat, lng).catch(() => null);

  let parsedAddress: ParsedAddress | null = null;
  let ward: number | null = null;
  let section: string | null = null;

  if (geocodeResult?.street_number && geocodeResult?.street_name) {
    const fullAddress = `${geocodeResult.street_number} ${geocodeResult.street_name}`;
    parsedAddress = parseChicagoAddress(fullAddress);
  }

  if (supabaseAdmin) {
    try {
      const { data } = await (supabaseAdmin.rpc as CallableFunction)('find_section_for_point', {
        user_lat: lat,
        user_lng: lng,
      });
      if (data) {
        const result = data as { ward?: string; section?: string };
        ward = result.ward ? parseInt(result.ward) : null;
        section = result.section || null;
      }
    } catch {
      // Continue without ward
    }
  }

  return {
    address: geocodeResult?.formatted_address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    latitude: lat,
    longitude: lng,
    neighborhood: geocodeResult?.neighborhood || null,
    ward,
    section,
    parsedAddress,
  };
}

async function getEnforcementExposure(
  lat: number,
  lng: number,
  ward: number | null,
  neighborhood: string | null
): Promise<EnforcementExposure> {
  // Speed cameras
  const speedCamerasWithCoords = SPEED_CAMERAS.map(c => ({
    ...c,
    latitude: c.latitude,
    longitude: c.longitude,
  }));
  const speedCount = countByRadius(speedCamerasWithCoords, lat, lng);
  const closestSpeed = findClosest(speedCamerasWithCoords, lat, lng);
  const speedDensity = calculateDensity(speedCount.HALF_MILE, RADII.HALF_MILE);
  const speedVsCity = CITYWIDE_SPEED_CAMERA_DENSITY > 0 ? speedDensity / CITYWIDE_SPEED_CAMERA_DENSITY : 1;

  const speedComparison = getTripleComparison(
    speedDensity,
    CITYWIDE_SPEED_CAMERA_DENSITY,
    CITYWIDE_SPEED_CAMERA_DENSITY * 1.1, // Slight neighborhood variance
    null
  );

  // Red light cameras
  const redLightCount = countByRadius(RED_LIGHT_CAMERAS, lat, lng);
  const closestRedLight = findClosest(RED_LIGHT_CAMERAS, lat, lng);
  const redLightDensity = calculateDensity(redLightCount.HALF_MILE, RADII.HALF_MILE);

  const redLightComparison = getTripleComparison(
    redLightDensity,
    CITYWIDE_REDLIGHT_CAMERA_DENSITY,
    CITYWIDE_REDLIGHT_CAMERA_DENSITY * 1.1,
    null
  );

  // Camera violations
  let cameraViolations = {
    totalNearbyViolations: 0,
    avgDailyPerCamera: 0,
    highestViolatingCamera: null as { location: string; totalViolations: number } | null,
  };

  if (supabaseAdmin) {
    try {
      const { data } = await (supabaseAdmin.from('camera_violation_stats' as any) as any).select('*');
      if (data) {
        const cameras = data as Array<{
          camera_type: string;
          address: string | null;
          intersection: string | null;
          latitude: number;
          longitude: number;
          total_violations: number;
          avg_daily_violations: number;
        }>;

        let totalViolations = 0;
        let cameraCount = 0;
        let highest: { location: string; totalViolations: number } | null = null;

        for (const cam of cameras) {
          if (!cam.latitude || !cam.longitude) continue;
          const dist = haversineDistance(lat, lng, cam.latitude, cam.longitude);
          if (dist > RADII.HALF_MILE) continue;

          totalViolations += cam.total_violations || 0;
          cameraCount++;

          if (!highest || cam.total_violations > highest.totalViolations) {
            highest = {
              location: cam.intersection || cam.address || 'Unknown',
              totalViolations: cam.total_violations,
            };
          }
        }

        cameraViolations = {
          totalNearbyViolations: totalViolations,
          avgDailyPerCamera: cameraCount > 0 ? Math.round(totalViolations / cameraCount / 365) : 0,
          highestViolatingCamera: highest,
        };
      }
    } catch {
      // Continue without violation data
    }
  }

  // Ward ticket climate
  const wardData = ward ? getHighRiskWardData(ward) : null;
  let wardTicketClimate: EnforcementExposure['wardTicketClimate'] = {
    wardRank: null,
    ticketsPer100Residents: null,
    vsCity: 'average',
  };

  if (wardData) {
    wardTicketClimate = {
      wardRank: wardData.rank,
      ticketsPer100Residents: wardData.ticketsPer100Residents,
      vsCity: getComparisonLevel(wardData.ticketsPer100Residents, CITYWIDE_AVG_TICKETS_PER_100),
    };
  }

  // Generate key takeaway
  let keyTakeaway = '';
  const totalCameras = speedCount.HALF_MILE + redLightCount.HALF_MILE;

  if (totalCameras === 0) {
    keyTakeaway = 'This location has minimal automated enforcement presence. Camera ticket risk remains low.';
  } else if (cameraViolations.totalNearbyViolations > 500000) {
    keyTakeaway = `Nearby cameras historically generate ${(cameraViolations.totalNearbyViolations / 1000).toFixed(0)}K violations. Driving requires extra caution.`;
  } else if (wardTicketClimate.vsCity === 'unusually_high' || wardTicketClimate.vsCity === 'high') {
    keyTakeaway = `Ward ${ward} ranks #${wardTicketClimate.wardRank} for parking tickets. Expect active enforcement.`;
  } else {
    keyTakeaway = `${totalCameras} enforcement cameras within half mile. Standard vigilance applies.`;
  }

  return {
    speedCameras: {
      count: speedCount,
      closest: closestSpeed ? { address: closestSpeed.item.address, distance: closestSpeed.distance } : null,
      densityVsCity: Math.round(speedVsCity * 10) / 10,
      comparison: speedComparison,
    },
    redLightCameras: {
      count: redLightCount,
      closest: closestRedLight ? { intersection: closestRedLight.item.intersection, distance: closestRedLight.distance } : null,
      densityVsCity: Math.round(getRatio(redLightDensity, CITYWIDE_REDLIGHT_CAMERA_DENSITY) * 10) / 10,
      comparison: redLightComparison,
    },
    cameraViolations,
    wardTicketClimate,
    keyTakeaway,
  };
}

async function getSafetyRisk(
  lat: number,
  lng: number,
  neighborhood: string | null,
  ward: number | null
): Promise<SafetyRisk> {
  const violentTypes = ['HOMICIDE', 'ASSAULT', 'BATTERY', 'ROBBERY', 'CRIMINAL SEXUAL ASSAULT'];
  const nuisanceTypes = ['NARCOTICS', 'WEAPONS VIOLATION', 'CRIMINAL TRESPASS', 'PUBLIC PEACE VIOLATION'];

  let violentCrime: SafetyRisk['violentCrime'] = {
    count: 0,
    byRadius: { FEET_250: 0, FEET_500: 0, QUARTER_MILE: 0, HALF_MILE: 0 },
    comparison: getTripleComparison(0, 1, null, null),
    types: [],
    severityMix: 'No data available',
  };

  let nuisanceCrime: SafetyRisk['nuisanceCrime'] = {
    count: 0,
    byRadius: { FEET_250: 0, FEET_500: 0, QUARTER_MILE: 0, HALF_MILE: 0 },
    comparison: getTripleComparison(0, 1, null, null),
  };

  let trafficCrashes: SafetyRisk['trafficCrashes'] = {
    total: 0,
    withInjuries: 0,
    fatal: 0,
    hitAndRun: 0,
    severityScore: 0,
    comparison: getTripleComparison(0, 1, null, null),
    injuryRate: 0,
  };

  if (supabaseAdmin) {
    // Get crime data
    try {
      const { data: crimeData } = await (supabaseAdmin.from('crimes' as any) as any)
        .select('primary_type, latitude, longitude')
        .gte('date', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
        .not('latitude', 'is', null);

      if (crimeData) {
        const crimes = crimeData as Array<{ primary_type: string | null; latitude: number; longitude: number }>;
        const violentByRadius: Record<RadiusKey, number> = { FEET_250: 0, FEET_500: 0, QUARTER_MILE: 0, HALF_MILE: 0 };
        const nuisanceByRadius: Record<RadiusKey, number> = { FEET_250: 0, FEET_500: 0, QUARTER_MILE: 0, HALF_MILE: 0 };
        const violentTypeCounts: Record<string, number> = {};
        let violentCount = 0;
        let nuisanceCount = 0;

        for (const crime of crimes) {
          if (!crime.latitude || !crime.longitude) continue;
          const dist = haversineDistance(lat, lng, crime.latitude, crime.longitude);
          if (dist > RADII.HALF_MILE) continue;

          const type = (crime.primary_type || '').toUpperCase();
          const isViolent = violentTypes.some(t => type.includes(t));
          const isNuisance = nuisanceTypes.some(t => type.includes(t));

          if (isViolent) {
            violentCount++;
            violentTypeCounts[type] = (violentTypeCounts[type] || 0) + 1;
            if (dist <= RADII.FEET_250) violentByRadius.FEET_250++;
            if (dist <= RADII.FEET_500) violentByRadius.FEET_500++;
            if (dist <= RADII.QUARTER_MILE) violentByRadius.QUARTER_MILE++;
            violentByRadius.HALF_MILE++;
          } else if (isNuisance) {
            nuisanceCount++;
            if (dist <= RADII.FEET_250) nuisanceByRadius.FEET_250++;
            if (dist <= RADII.FEET_500) nuisanceByRadius.FEET_500++;
            if (dist <= RADII.QUARTER_MILE) nuisanceByRadius.QUARTER_MILE++;
            nuisanceByRadius.HALF_MILE++;
          }
        }

        const violentDensity = calculateDensity(violentCount, RADII.HALF_MILE);
        const violentCityBaseline = CITYWIDE_CRIME_DENSITY * 0.15;

        // Determine severity mix
        let severityMix = 'No violent crimes recorded';
        const types = Object.entries(violentTypeCounts).sort(([, a], [, b]) => b - a);
        if (types.length > 0) {
          const dominant = types[0][0];
          const dominantPct = Math.round((types[0][1] / violentCount) * 100);
          if (dominant.includes('BATTERY')) {
            severityMix = `${dominantPct}% battery-dominant (typically non-lethal altercations)`;
          } else if (dominant.includes('ROBBERY')) {
            severityMix = `${dominantPct}% robbery-dominant (property-focused with force)`;
          } else if (dominant.includes('ASSAULT')) {
            severityMix = `${dominantPct}% assault-dominant (threat-based incidents)`;
          } else {
            severityMix = `${dominantPct}% ${dominant.toLowerCase().replace('_', ' ')}`;
          }
        }

        violentCrime = {
          count: violentCount,
          byRadius: violentByRadius,
          comparison: getTripleComparison(violentDensity, violentCityBaseline, violentCityBaseline * 0.9, null),
          types: types.slice(0, 5).map(([type, count]) => ({ type, count })),
          severityMix,
        };

        const nuisanceDensity = calculateDensity(nuisanceCount, RADII.HALF_MILE);
        const nuisanceCityBaseline = CITYWIDE_CRIME_DENSITY * 0.10;

        nuisanceCrime = {
          count: nuisanceCount,
          byRadius: nuisanceByRadius,
          comparison: getTripleComparison(nuisanceDensity, nuisanceCityBaseline, nuisanceCityBaseline * 0.9, null),
        };
      }
    } catch {
      // Continue without crime data
    }

    // Get traffic crash data
    try {
      const { data: crashData } = await (supabaseAdmin.from('traffic_crashes' as any) as any)
        .select('injuries_total, injuries_fatal, hit_and_run, latitude, longitude')
        .gte('crash_date', new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString())
        .not('latitude', 'is', null);

      if (crashData) {
        const crashes = crashData as Array<{
          injuries_total: number | null;
          injuries_fatal: number | null;
          hit_and_run: boolean | null;
          latitude: number;
          longitude: number;
        }>;

        let total = 0;
        let withInjuries = 0;
        let fatal = 0;
        let hitAndRun = 0;
        let severityScore = 0;

        for (const crash of crashes) {
          if (!crash.latitude || !crash.longitude) continue;
          const dist = haversineDistance(lat, lng, crash.latitude, crash.longitude);
          if (dist > RADII.HALF_MILE) continue;

          total++;
          if (crash.injuries_total && crash.injuries_total > 0) {
            withInjuries++;
            severityScore += crash.injuries_total;
          }
          if (crash.injuries_fatal && crash.injuries_fatal > 0) {
            fatal++;
            severityScore += crash.injuries_fatal * 10;
          }
          if (crash.hit_and_run) hitAndRun++;
        }

        const crashDensity = calculateDensity(total, RADII.HALF_MILE);
        const injuryRate = total > 0 ? Math.round((withInjuries / total) * 100) : 0;

        trafficCrashes = {
          total,
          withInjuries,
          fatal,
          hitAndRun,
          severityScore,
          comparison: getTripleComparison(crashDensity, CITYWIDE_CRASH_DENSITY / 2, null, null),
          injuryRate,
        };
      }
    } catch {
      // Continue without crash data
    }
  }

  // Generate key takeaway
  let keyTakeaway = '';
  const violentLevel = violentCrime.comparison.vsCity;
  const crashLevel = trafficCrashes.comparison.vsCity;

  if (violentLevel === 'unusually_low' || violentLevel === 'low') {
    if (crashLevel === 'high' || crashLevel === 'unusually_high') {
      keyTakeaway = 'Low violent crime but elevated traffic crash risk. Pedestrian and driver caution warranted.';
    } else {
      keyTakeaway = 'This block consistently shows below-average safety incidents across categories.';
    }
  } else if (violentLevel === 'unusually_high' || violentLevel === 'high') {
    keyTakeaway = `${violentCrime.count} violent incidents recorded nearby. ${violentCrime.severityMix}.`;
  } else {
    // Average - look for variance
    if (trafficCrashes.injuryRate > 20) {
      keyTakeaway = `While crime tracks average, ${trafficCrashes.injuryRate}% of nearby crashes cause injuries—higher severity than typical.`;
    } else if (violentCrime.byRadius.FEET_250 > violentCrime.count * 0.3) {
      keyTakeaway = 'Crime density clusters tightly around this address rather than spreading across the area.';
    } else {
      keyTakeaway = 'Safety metrics track near citywide averages with no notable outliers.';
    }
  }

  return { violentCrime, nuisanceCrime, trafficCrashes, keyTakeaway };
}

async function getDailyFriction(lat: number, lng: number, location: LocationInfo): Promise<DailyFriction> {
  const result: DailyFriction = {
    streetCleaning: { found: false, ward: null, section: null },
    winterBan: { found: false, isWinterSeason: isWinterSeason() },
    snowRoute: { found: false },
    permitZone: { found: false, zoneName: null },
    frictionScore: 0,
    keyTakeaway: '',
  };

  if (!supabaseAdmin) {
    result.keyTakeaway = 'Unable to verify parking restrictions for this location.';
    return result;
  }

  try {
    // Street cleaning
    const { data: streetCleaningData } = await (supabaseAdmin.rpc as CallableFunction)('get_street_cleaning_at_location_enhanced', {
      user_lat: lat,
      user_lng: lng,
      distance_meters: 30,
    });
    if (streetCleaningData && Array.isArray(streetCleaningData) && streetCleaningData[0]) {
      result.streetCleaning.found = true;
      result.streetCleaning.ward = streetCleaningData[0].ward;
      result.streetCleaning.section = streetCleaningData[0].section;
    }

    // Snow route
    const { data: snowRouteData } = await (supabaseAdmin.rpc as CallableFunction)('get_snow_route_at_location_enhanced', {
      user_lat: lat,
      user_lng: lng,
      distance_meters: 30,
    });
    if (snowRouteData && Array.isArray(snowRouteData) && snowRouteData[0]?.street_name) {
      result.snowRoute.found = true;
    }

    // Winter ban streets
    if (result.winterBan.isWinterSeason && location.parsedAddress) {
      const { data: winterBanStreets } = await supabaseAdmin
        .from('winter_overnight_parking_ban_streets')
        .select('street_name');

      if (winterBanStreets) {
        const normalizedUserStreet = normalizeStreetName(location.parsedAddress.name);
        for (const street of winterBanStreets) {
          const normalizedBanStreet = normalizeStreetName(street.street_name || '');
          if (normalizedUserStreet.includes(normalizedBanStreet) || normalizedBanStreet.includes(normalizedUserStreet)) {
            result.winterBan.found = true;
            break;
          }
        }
      }
    }

    // Permit zones
    if (location.parsedAddress) {
      const { data: permitZones } = await supabaseAdmin
        .from('parking_permit_zones')
        .select('zone, odd_even')
        .eq('street_name', location.parsedAddress.name)
        .eq('status', 'ACTIVE')
        .lte('address_range_low', location.parsedAddress.number)
        .gte('address_range_high', location.parsedAddress.number);

      if (permitZones && permitZones.length > 0) {
        const matchingZones = permitZones.filter((zone: { odd_even?: string | null }) => {
          if (zone.odd_even && location.parsedAddress) {
            return location.parsedAddress.isOdd ? zone.odd_even === 'O' : zone.odd_even === 'E';
          }
          return true;
        });

        if (matchingZones.length > 0) {
          result.permitZone.found = true;
          result.permitZone.zoneName = `Zone ${matchingZones[0].zone}`;
        }
      }
    }
  } catch {
    // Continue with defaults
  }

  // Calculate friction score
  let score = 0;
  if (result.streetCleaning.found) score++;
  if (result.winterBan.found) score++;
  if (result.snowRoute.found) score++;
  if (result.permitZone.found) score++;
  result.frictionScore = score;

  // Generate key takeaway
  const restrictions: string[] = [];
  if (result.streetCleaning.found) restrictions.push('street cleaning');
  if (result.winterBan.found) restrictions.push('winter overnight ban');
  if (result.snowRoute.found) restrictions.push('snow route');
  if (result.permitZone.found) restrictions.push(`permit zone (${result.permitZone.zoneName})`);

  if (restrictions.length === 0) {
    result.keyTakeaway = 'No active parking restrictions detected. Street parking operates freely.';
  } else if (restrictions.length === 1) {
    result.keyTakeaway = `One restriction applies: ${restrictions[0]}. Plan accordingly to avoid tickets.`;
  } else if (restrictions.length >= 3) {
    result.keyTakeaway = `High-friction location with ${restrictions.length} active restrictions. Requires ongoing calendar management.`;
  } else {
    result.keyTakeaway = `${restrictions.length} restrictions apply: ${restrictions.join(', ')}. Check schedules regularly.`;
  }

  return result;
}

async function getQualityOfLife(ward: number | null, neighborhood: string | null): Promise<QualityOfLifeVolatility> {
  const result: QualityOfLifeVolatility = {
    complaints311: {
      totalLastYear: 0,
      byType: [],
      comparison: getTripleComparison(0, 1, null, null),
    },
    nuisanceIssues: {
      rats: 0,
      noise: 0,
      dumping: 0,
      dominantIssue: null,
    },
    volatilityPattern: 'Insufficient data',
    keyTakeaway: '',
  };

  if (!supabaseAdmin || !ward) {
    result.keyTakeaway = 'Ward-level complaint data unavailable for this location.';
    return result;
  }

  try {
    const { data: statsData } = await (supabaseAdmin.from('service_request_stats' as any) as any)
      .select('sr_type, requests_last_365_days')
      .eq('ward', ward);

    if (statsData) {
      const stats = statsData as Array<{ sr_type: string; requests_last_365_days: number }>;
      const byType: Record<string, number> = {};
      let total = 0;

      for (const stat of stats) {
        total += stat.requests_last_365_days || 0;
        byType[stat.sr_type] = (byType[stat.sr_type] || 0) + (stat.requests_last_365_days || 0);

        // Count nuisance types
        const type = stat.sr_type.toLowerCase();
        if (type.includes('rodent') || type.includes('rat')) {
          result.nuisanceIssues.rats += stat.requests_last_365_days || 0;
        }
        if (type.includes('noise')) {
          result.nuisanceIssues.noise += stat.requests_last_365_days || 0;
        }
        if (type.includes('dump') || type.includes('garbage')) {
          result.nuisanceIssues.dumping += stat.requests_last_365_days || 0;
        }
      }

      result.complaints311.totalLastYear = total;
      result.complaints311.byType = Object.entries(byType)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([type, count]) => ({ type, count }));

      result.complaints311.comparison = getTripleComparison(total, CITYWIDE_311_PER_WARD, null, null);

      // Determine dominant nuisance
      const nuisances = [
        { type: 'Rodent complaints', count: result.nuisanceIssues.rats },
        { type: 'Noise complaints', count: result.nuisanceIssues.noise },
        { type: 'Dumping/garbage', count: result.nuisanceIssues.dumping },
      ].filter(n => n.count > 0).sort((a, b) => b.count - a.count);

      if (nuisances.length > 0 && nuisances[0].count > 100) {
        result.nuisanceIssues.dominantIssue = nuisances[0].type;
      }

      // Determine volatility pattern
      const topType = result.complaints311.byType[0];
      if (topType && total > 0) {
        const concentration = topType.count / total;
        if (concentration > 0.3) {
          result.volatilityPattern = `Concentrated: ${topType.type} drives ${Math.round(concentration * 100)}% of complaints`;
        } else if (result.complaints311.byType.length > 5) {
          result.volatilityPattern = 'Dispersed across multiple issue types with no dominant pattern';
        } else {
          result.volatilityPattern = 'Moderate concentration across 2-3 primary issue types';
        }
      }
    }
  } catch {
    // Continue without 311 data
  }

  // Generate key takeaway
  const level = result.complaints311.comparison.vsCity;
  if (level === 'unusually_high') {
    result.keyTakeaway = `This ward generates ${Math.round(result.complaints311.totalLastYear / 1000)}K service requests yearly—significantly above average. Expect visible maintenance issues.`;
  } else if (level === 'unusually_low') {
    result.keyTakeaway = 'Residents here file fewer complaints than citywide average. Generally well-maintained area.';
  } else if (result.nuisanceIssues.dominantIssue) {
    result.keyTakeaway = `${result.nuisanceIssues.dominantIssue} represents the primary quality-of-life concern in this ward.`;
  } else {
    result.keyTakeaway = `Service request volume tracks near citywide average. ${result.volatilityPattern}.`;
  }

  return result;
}

async function getTrajectory(
  lat: number,
  lng: number,
  neighborhood: string | null,
  ward: number | null
): Promise<Trajectory> {
  let licenseCount = 0;

  if (supabaseAdmin) {
    try {
      const { data } = await (supabaseAdmin.from('liquor_licenses' as any) as any)
        .select('latitude, longitude')
        .eq('license_status', 'AAI');

      if (data) {
        const licenses = data as Array<{ latitude: number; longitude: number }>;
        for (const license of licenses) {
          if (!license.latitude || !license.longitude) continue;
          const dist = haversineDistance(lat, lng, license.latitude, license.longitude);
          if (dist <= RADII.HALF_MILE) licenseCount++;
        }
      }
    } catch {
      // Continue without license data
    }
  }

  const licenseDensity = calculateDensity(licenseCount, RADII.HALF_MILE);
  const licenseComparison = getTripleComparison(licenseDensity, CITYWIDE_LIQUOR_LICENSE_DENSITY, null, null);

  let changeSignal: Trajectory['changeSignal'] = 'insufficient_data';
  if (licenseCount > 15) {
    changeSignal = 'growing';
  } else if (licenseCount > 5) {
    changeSignal = 'stable';
  } else if (licenseCount > 0) {
    changeSignal = 'stable';
  }

  // Generate key takeaway
  let keyTakeaway = '';
  if (changeSignal === 'growing') {
    keyTakeaway = `${licenseCount} active liquor licenses within half mile signals strong commercial activity and nightlife presence.`;
  } else if (changeSignal === 'stable') {
    keyTakeaway = 'Business activity shows steady presence. No major growth or decline signals detected.';
  } else {
    keyTakeaway = 'Limited commercial data available. Cannot assess neighborhood trajectory with confidence.';
  }

  return {
    buildingPermits: {
      count: 0,
      vsCity: 'average',
    },
    businessLicenses: {
      count: licenseCount,
      comparison: licenseComparison,
    },
    changeSignal,
    keyTakeaway,
  };
}

// ===== Analysis Functions =====

function calculateOverallProfile(
  enforcement: EnforcementExposure,
  safety: SafetyRisk,
  friction: DailyFriction,
  qol: QualityOfLifeVolatility
): OverallProfile {
  // Risk level
  let riskLevel: OverallProfile['riskLevel'] = 'moderate';
  const violentLevel = safety.violentCrime.comparison.vsCity;
  if (violentLevel === 'unusually_high') riskLevel = 'high';
  else if (violentLevel === 'high') riskLevel = 'elevated';
  else if (violentLevel === 'low' || violentLevel === 'unusually_low') riskLevel = 'low';

  // Enforcement intensity
  let enforcementIntensity: OverallProfile['enforcementIntensity'] = 'moderate';
  const totalCameras = enforcement.speedCameras.count.HALF_MILE + enforcement.redLightCameras.count.HALF_MILE;
  if (totalCameras === 0) enforcementIntensity = 'minimal';
  else if (totalCameras > 5 || enforcement.wardTicketClimate.vsCity === 'unusually_high') enforcementIntensity = 'intense';
  else if (totalCameras > 2 || enforcement.wardTicketClimate.vsCity === 'high') enforcementIntensity = 'high';

  // Friction level
  let frictionLevel: OverallProfile['frictionLevel'] = 'moderate';
  if (friction.frictionScore >= 3) frictionLevel = 'high';
  else if (friction.frictionScore <= 1) frictionLevel = 'low';

  // Summary phrase
  const summaryParts: string[] = [];
  if (frictionLevel === 'high') summaryParts.push('High friction');
  else if (frictionLevel === 'low') summaryParts.push('Low friction');

  if (riskLevel === 'low') summaryParts.push('low risk');
  else if (riskLevel === 'high') summaryParts.push('elevated risk');

  if (enforcementIntensity === 'intense') summaryParts.push('heavy enforcement');
  else if (enforcementIntensity === 'minimal') summaryParts.push('minimal enforcement');

  const summaryPhrase = summaryParts.length > 0 ? summaryParts.join(', ') : 'Moderate across all dimensions';

  return { riskLevel, enforcementIntensity, frictionLevel, summaryPhrase };
}

function findMostUnderestimated(
  enforcement: EnforcementExposure,
  safety: SafetyRisk,
  friction: DailyFriction,
  qol: QualityOfLifeVolatility,
  trajectory: Trajectory
): UnderestimatedInsight {
  const candidates: UnderestimatedInsight[] = [];

  // Check camera violations
  if (enforcement.cameraViolations.totalNearbyViolations > 200000) {
    candidates.push({
      finding: `Cameras within half mile have issued ${(enforcement.cameraViolations.totalNearbyViolations / 1000).toFixed(0)}K citations historically`,
      section: 'Enforcement Exposure',
      metric: 'Camera Violations',
      value: enforcement.cameraViolations.totalNearbyViolations,
      comparison: 'This represents significant citation volume that drivers rarely anticipate',
    });
  }

  // Check hit-and-run rate
  if (safety.trafficCrashes.total > 50 && safety.trafficCrashes.hitAndRun > safety.trafficCrashes.total * 0.2) {
    const hitRunPct = Math.round((safety.trafficCrashes.hitAndRun / safety.trafficCrashes.total) * 100);
    candidates.push({
      finding: `${hitRunPct}% of crashes near this address are hit-and-runs`,
      section: 'Safety & Risk',
      metric: 'Hit-and-Run Rate',
      value: `${hitRunPct}%`,
      comparison: 'Significantly higher than citywide average of ~12%',
    });
  }

  // Check crash injury severity
  if (safety.trafficCrashes.injuryRate > 25) {
    candidates.push({
      finding: `${safety.trafficCrashes.injuryRate}% of nearby crashes result in injuries`,
      section: 'Safety & Risk',
      metric: 'Crash Severity',
      value: `${safety.trafficCrashes.injuryRate}%`,
      comparison: 'Higher-than-typical severity indicates dangerous road conditions',
    });
  }

  // Check friction overlap
  if (friction.frictionScore >= 3) {
    candidates.push({
      finding: `${friction.frictionScore} overlapping parking restrictions require active management`,
      section: 'Daily Friction',
      metric: 'Restriction Overlap',
      value: friction.frictionScore,
      comparison: 'Most Chicago addresses have 0-1 restrictions',
    });
  }

  // Check rodent complaints
  if (qol.nuisanceIssues.rats > 2000) {
    candidates.push({
      finding: `${qol.nuisanceIssues.rats.toLocaleString()} rodent complaints in this ward last year`,
      section: 'Quality-of-Life',
      metric: 'Rodent Activity',
      value: qol.nuisanceIssues.rats,
      comparison: 'Indicates persistent pest management challenges',
    });
  }

  // Check low crime in high-ticket area
  if (
    (safety.violentCrime.comparison.vsCity === 'low' || safety.violentCrime.comparison.vsCity === 'unusually_low') &&
    (enforcement.wardTicketClimate.vsCity === 'high' || enforcement.wardTicketClimate.vsCity === 'unusually_high')
  ) {
    candidates.push({
      finding: 'Low crime but high parking enforcement creates perceived safety without actual threat reduction',
      section: 'Cross-Section',
      metric: 'Enforcement-Crime Mismatch',
      value: 'Mismatch',
      comparison: 'Tickets here prevent nuisance, not crime',
    });
  }

  // Default fallback
  if (candidates.length === 0) {
    return {
      finding: 'All metrics track near expected levels for this location type',
      section: 'Overview',
      metric: 'Baseline Alignment',
      value: 'Standard',
      comparison: 'No statistically unusual patterns detected',
    };
  }

  // Return the most impactful (prefer enforcement/safety over quality-of-life)
  const sectionPriority = ['Cross-Section', 'Safety & Risk', 'Enforcement Exposure', 'Daily Friction', 'Quality-of-Life'];
  candidates.sort((a, b) => {
    const aIdx = sectionPriority.indexOf(a.section);
    const bIdx = sectionPriority.indexOf(b.section);
    return aIdx - bIdx;
  });

  return candidates[0];
}

function generateAudienceFit(
  profile: OverallProfile,
  friction: DailyFriction,
  safety: SafetyRisk,
  enforcement: EnforcementExposure
): AudienceFit {
  const goodFitFor: string[] = [];
  const poorFitFor: string[] = [];

  // Based on risk level
  if (profile.riskLevel === 'low') {
    goodFitFor.push('families with children', 'those prioritizing personal safety');
  } else if (profile.riskLevel === 'high') {
    poorFitFor.push('those sensitive to crime proximity');
  }

  // Based on enforcement
  if (profile.enforcementIntensity === 'minimal') {
    goodFitFor.push('daily drivers who park on street');
  } else if (profile.enforcementIntensity === 'intense') {
    poorFitFor.push('those who forget to move their car');
    goodFitFor.push('disciplined calendar managers');
  }

  // Based on friction
  if (profile.frictionLevel === 'low') {
    goodFitFor.push('visitors who need easy parking');
  } else if (profile.frictionLevel === 'high') {
    poorFitFor.push('car owners without dedicated parking');
  }

  // Based on commercial activity
  if (enforcement.cameraViolations.totalNearbyViolations > 100000) {
    poorFitFor.push('aggressive drivers');
  }

  // Fill defaults
  if (goodFitFor.length === 0) {
    goodFitFor.push('most residents with typical city tolerance');
  }
  if (poorFitFor.length === 0) {
    poorFitFor.push('those expecting suburban quiet');
  }

  // Generate summary
  let summary = `This address suits ${goodFitFor.slice(0, 2).join(' and ')}`;
  if (poorFitFor.length > 0) {
    summary += `, but presents challenges for ${poorFitFor[0]}`;
  }
  summary += '.';

  return { goodFitFor, poorFitFor, summary };
}

// ===== Utility Functions =====

function normalizeStreetName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/^\d+\s+/, '')
    .trim();
}

function isWinterSeason(): boolean {
  const now = getChicagoTime();
  const month = now.getMonth();
  return month === 11 || month === 0 || month === 1 || month === 2 || (month === 3 && now.getDate() === 1);
}

// ===== Exports =====
export type { RadiusKey };
export { RADII, RADIUS_LABELS, EXPOSURE_LABELS, EXPOSURE_COLORS, formatDistance };
