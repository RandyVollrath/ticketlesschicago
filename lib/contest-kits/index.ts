/**
 * Contest Kits Index
 *
 * Central export point for all contest kits and the policy engine.
 *
 * Win rates from FOIA data (1.18M records, decided cases, all contest methods):
 * - Expired Plates: 76%
 * - Double Parking: 72%
 * - City Sticker: 72%
 * - Parking in Alley: 71%
 * - Handicapped Zone: 69%
 * - Expired Meter (CBD): 68%
 * - Expired Meter (non-CBD): 67%
 * - Commercial Loading: 60%
 * - Bus/Taxi Stand: 59%
 * - No Standing/Time Restricted: 59%
 * - No Parking Anytime: 57%
 * - Bus Lane: 56%
 * - Missing Plate: 55%
 * - Residential Permit: 54%
 * - Bike Lane: 50%
 * - Fire Hydrant: 46%
 * - Rush Hour: 38%
 * - Snow Route: 38%
 * - Street Cleaning: 34%
 * - Red Light Camera: 21%
 * - Speed Camera (11+ over): 20%
 * - Speed Camera (6-10 over): 17%
 * - Overall: 55%
 */

// Type exports
export * from './types';

// Policy engine exports
export { evaluateContest, getRecommendedArgument } from './policy-engine';

// Kit exports - Original 5
export { streetCleaningKit } from './street-cleaning';
export { cityStickerKit } from './city-sticker';
export { residentialPermitKit } from './residential-permit';
export { snowRouteKit } from './snow-route';
export { expiredMeterKit } from './expired-meter';

// Kit exports - New kits
export { fireHydrantKit } from './fire-hydrant';
export { busStopKit } from './bus-stop';
export { bikeLaneKit } from './bike-lane';
export { handicappedZoneKit } from './handicapped-zone';
export { parkingAlleyKit } from './parking-alley';
export { expiredPlatesKit } from './expired-plates';
export { noStandingKit } from './no-standing';
export { doubleParkingKit } from './double-parking';
export { commercialLoadingKit } from './commercial-loading';
export { missingPlateKit } from './missing-plate';
export { busLaneKit } from './bus-lane';

// Kit exports - Camera enforcement
export { redLightKit } from './red-light';
export { speedCameraKit } from './speed-camera';

// Import kits for the registry
import { streetCleaningKit } from './street-cleaning';
import { cityStickerKit } from './city-sticker';
import { residentialPermitKit } from './residential-permit';
import { snowRouteKit } from './snow-route';
import { expiredMeterKit } from './expired-meter';
import { fireHydrantKit } from './fire-hydrant';
import { busStopKit } from './bus-stop';
import { bikeLaneKit } from './bike-lane';
import { handicappedZoneKit } from './handicapped-zone';
import { parkingAlleyKit } from './parking-alley';
import { expiredPlatesKit } from './expired-plates';
import { noStandingKit } from './no-standing';
import { doubleParkingKit } from './double-parking';
import { commercialLoadingKit } from './commercial-loading';
import { missingPlateKit } from './missing-plate';
import { busLaneKit } from './bus-lane';
import { redLightKit } from './red-light';
import { speedCameraKit } from './speed-camera';
import { ContestKit } from './types';

/**
 * Registry of all available contest kits by violation code
 */
export const CONTEST_KITS: Record<string, ContestKit> = {
  // Original 5 kits
  '9-64-010': streetCleaningKit,
  '9-64-125': cityStickerKit,   // Correct violation code for no city sticker
  '9-100-010': cityStickerKit,  // Legacy alias (9-100-010 is the chapter, not the violation)
  '9-64-070': residentialPermitKit,
  '9-64-100': snowRouteKit,
  '9-64-170': expiredMeterKit,

  // New kits
  '9-64-130': fireHydrantKit,
  '9-64-050': busStopKit,
  '9-64-090': bikeLaneKit,
  '9-64-180': handicappedZoneKit,
  '9-64-020': parkingAlleyKit,
  '9-76-160': expiredPlatesKit,
  '9-80-190': expiredPlatesKit, // Alias for expired registration
  '9-64-140': noStandingKit,
  '9-64-110': doubleParkingKit,
  '9-64-160': commercialLoadingKit,
  '9-80-040': missingPlateKit,

  // Bus lane (Smart Streets automated enforcement)
  '9-12-060': busLaneKit,
  '9-12-060(b)': busLaneKit, // Subsection alias

  // Camera enforcement
  '9-102-010': redLightKit,
  '9-102-020': speedCameraKit,
  '9-101-020': speedCameraKit, // Alias for speed violation codes
};

/**
 * Map of violation type names to codes (for lookup by name)
 */
export const VIOLATION_NAME_TO_CODE: Record<string, string> = {
  'street_cleaning': '9-64-010',
  'no_city_sticker': '9-64-125',
  'residential_permit': '9-64-070',
  'snow_route': '9-64-100',
  'expired_meter': '9-64-170',
  'fire_hydrant': '9-64-130',
  'bus_stop': '9-64-050',
  'bike_lane': '9-64-090',
  'disabled_zone': '9-64-180',
  'handicapped_zone': '9-64-180',
  'parking_alley': '9-64-020',
  'expired_plates': '9-76-160',
  'expired_registration': '9-80-190',
  'no_standing_time_restricted': '9-64-140',
  'double_parking': '9-64-110',
  'commercial_loading': '9-64-160',
  'missing_plate': '9-80-040',
  'parking_prohibited': '9-64-140', // Same as no standing
  'bus_lane': '9-12-060',
  'red_light': '9-102-010',
  'speed_camera': '9-102-020',
};

/**
 * Get a contest kit by violation code
 */
export function getContestKit(violationCode: string): ContestKit | null {
  return CONTEST_KITS[violationCode] || null;
}

/**
 * Get a contest kit by violation type name
 */
export function getContestKitByName(violationName: string): ContestKit | null {
  const code = VIOLATION_NAME_TO_CODE[violationName];
  if (!code) return null;
  return CONTEST_KITS[code] || null;
}

/**
 * Check if a violation code has a contest kit
 */
export function hasContestKit(violationCode: string): boolean {
  return violationCode in CONTEST_KITS;
}

/**
 * Check if a violation name has a contest kit
 */
export function hasContestKitByName(violationName: string): boolean {
  const code = VIOLATION_NAME_TO_CODE[violationName];
  return code ? code in CONTEST_KITS : false;
}

/**
 * Get all available contest kits
 */
export function getAllContestKits(): ContestKit[] {
  // Deduplicate (some codes map to same kit)
  const seen = new Set<string>();
  return Object.values(CONTEST_KITS).filter(kit => {
    if (seen.has(kit.violationCode)) return false;
    seen.add(kit.violationCode);
    return true;
  });
}

/**
 * Get contest kits sorted by win rate (highest first)
 */
export function getKitsByWinRate(): ContestKit[] {
  return getAllContestKits().sort((a, b) => b.baseWinRate - a.baseWinRate);
}

/**
 * Get kits grouped by category
 */
export function getKitsByCategory(): Record<string, ContestKit[]> {
  const kits = getAllContestKits();
  const byCategory: Record<string, ContestKit[]> = {};

  for (const kit of kits) {
    if (!byCategory[kit.category]) {
      byCategory[kit.category] = [];
    }
    byCategory[kit.category].push(kit);
  }

  return byCategory;
}

/**
 * Get summary statistics about available kits
 */
export function getKitStats(): {
  totalKits: number;
  averageWinRate: number;
  highestWinRate: ContestKit;
  lowestWinRate: ContestKit;
  byCategory: Record<string, number>;
} {
  const kits = getAllContestKits();
  const sorted = getKitsByWinRate();

  const totalWinRate = kits.reduce((sum, kit) => sum + kit.baseWinRate, 0);
  const byCategory: Record<string, number> = {};

  for (const kit of kits) {
    byCategory[kit.category] = (byCategory[kit.category] || 0) + 1;
  }

  return {
    totalKits: kits.length,
    averageWinRate: Math.round((totalWinRate / kits.length) * 100) / 100,
    highestWinRate: sorted[0],
    lowestWinRate: sorted[sorted.length - 1],
    byCategory,
  };
}
