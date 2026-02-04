/**
 * Unified Parking Checker
 *
 * Efficiently checks all parking restrictions with:
 * - ONE reverse geocode call
 * - ONE combined database query for spatial data
 * - Address-based matching for permit zones + winter ban
 */

import { supabaseAdmin } from './supabase';
import { reverseGeocode, GeocodeResult } from './reverse-geocoder';
import { parseChicagoAddress, ParsedAddress } from './address-parser';
import { validatePermitZone } from './permit-zone-time-validator';
import { getChicagoTime } from './chicago-timezone-utils';

// Default permit zone restriction hours
const DEFAULT_PERMIT_RESTRICTION = 'Mon-Fri 6am-6pm';

export interface UnifiedParkingResult {
  // Location info (from single geocode call)
  location: {
    latitude: number;
    longitude: number;
    address: string;
    streetNumber: string | null;
    streetName: string | null;
    neighborhood: string | null;
    parsedAddress: ParsedAddress | null;
  };

  // Street Cleaning (spatial query)
  streetCleaning: {
    found: boolean;
    ward: string | null;
    section: string | null;
    nextCleaningDate: string | null;
    schedule: string | null;
    isActiveNow: boolean;
    severity: 'critical' | 'warning' | 'info' | 'none';
    message: string;
  };

  // Winter Overnight Ban (address match)
  winterBan: {
    found: boolean;
    streetName: string | null;
    isWinterSeason: boolean;
    isBanHours: boolean;
    hoursUntilBan: number;
    severity: 'critical' | 'warning' | 'info' | 'none';
    message: string;
  };

  // 2-Inch Snow Ban (spatial query)
  snowBan: {
    found: boolean;
    streetName: string | null;
    isBanActive: boolean;
    snowAmount: number | null;
    severity: 'critical' | 'warning' | 'info' | 'none';
    message: string;
  };

  // Permit Zone (address match - residential or industrial)
  permitZone: {
    found: boolean;
    zoneName: string | null;
    zoneType: 'residential' | 'industrial' | null;
    isCurrentlyRestricted: boolean;
    restrictionSchedule: string | null;
    hoursUntilRestriction: number;
    severity: 'critical' | 'warning' | 'info' | 'none';
    message: string;
  };

  timestamp: string;
}

/**
 * Check all parking restrictions with a single geocode + optimized queries
 */
export async function checkAllParkingRestrictions(
  latitude: number,
  longitude: number
): Promise<UnifiedParkingResult> {
  const timestamp = new Date().toISOString();

  // Default result structure
  const result: UnifiedParkingResult = {
    location: {
      latitude,
      longitude,
      address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      streetNumber: null,
      streetName: null,
      neighborhood: null,
      parsedAddress: null,
    },
    streetCleaning: {
      found: false,
      ward: null,
      section: null,
      nextCleaningDate: null,
      schedule: null,
      isActiveNow: false,
      severity: 'none',
      message: 'No street cleaning restrictions found',
    },
    winterBan: {
      found: false,
      streetName: null,
      isWinterSeason: false,
      isBanHours: false,
      hoursUntilBan: 999,
      severity: 'none',
      message: 'Not on a winter overnight ban street',
    },
    snowBan: {
      found: false,
      streetName: null,
      isBanActive: false,
      snowAmount: null,
      severity: 'none',
      message: 'Not on a snow route',
    },
    permitZone: {
      found: false,
      zoneName: null,
      zoneType: null,
      isCurrentlyRestricted: false,
      restrictionSchedule: null,
      hoursUntilRestriction: 999,
      severity: 'none',
      message: 'Not in a permit parking zone',
    },
    timestamp,
  };

  try {
    // ==========================================
    // STEP 1: ONE reverse geocode call
    // ==========================================
    const geocodeResult = await reverseGeocode(latitude, longitude).catch(() => null);

    if (geocodeResult) {
      result.location.address = geocodeResult.formatted_address || result.location.address;
      result.location.streetNumber = geocodeResult.street_number || null;
      result.location.streetName = geocodeResult.street_name || null;
      result.location.neighborhood = geocodeResult.neighborhood || null;

      // Parse address for database matching
      if (geocodeResult.street_number && geocodeResult.street_name) {
        const fullAddress = `${geocodeResult.street_number} ${geocodeResult.street_name}`;
        result.location.parsedAddress = parseChicagoAddress(fullAddress);
      }
    }

    if (!supabaseAdmin) {
      return result;
    }

    // ==========================================
    // STEP 2: Combined spatial queries (parallel)
    // ==========================================
    const [
      streetCleaningData,
      snowRouteData,
      snowBanStatus,
      winterBanData,
      permitZones,
      industrialZones,
      zoneHoursData,
    ] = await Promise.all([
      // Street cleaning spatial query
      supabaseAdmin.rpc('get_street_cleaning_at_location_enhanced', {
        user_lat: latitude,
        user_lng: longitude,
        distance_meters: 30,
      }).then(r => r.data?.[0] || null).catch(() => null),

      // Snow route spatial query
      supabaseAdmin.rpc('get_snow_route_at_location_enhanced', {
        user_lat: latitude,
        user_lng: longitude,
        distance_meters: 30,
      }).then(r => r.data?.[0] || null).catch(() => null),

      // Snow ban status (single row)
      supabaseAdmin
        .from('snow_route_status')
        .select('is_active, activation_date, snow_amount_inches')
        .eq('id', 1)
        .single()
        .then(r => r.data).catch(() => null),

      // Winter ban SPATIAL query (replaces address matching)
      supabaseAdmin.rpc('get_winter_ban_at_location', {
        user_lat: latitude,
        user_lng: longitude,
        distance_meters: 30,
      }).then(r => r.data?.[0] || null).catch(() => null),

      // Residential permit zones (address matching) - only if we have parsed address
      result.location.parsedAddress
        ? supabaseAdmin
            .from('parking_permit_zones')
            .select('zone, odd_even, address_range_low, address_range_high, street_direction, street_name, street_type')
            .eq('street_name', result.location.parsedAddress.name)
            .eq('status', 'ACTIVE')
            .lte('address_range_low', result.location.parsedAddress.number)
            .gte('address_range_high', result.location.parsedAddress.number)
            .then(r => r.data || []).catch(() => [])
        : Promise.resolve([]),

      // Industrial permit zones (address matching) - only if we have parsed address
      result.location.parsedAddress
        ? supabaseAdmin
            .from('industrial_parking_zones')
            .select('zone, street_name, street_direction, street_type, address_range_low, address_range_high, restriction_hours, restriction_days')
            .eq('street_name', result.location.parsedAddress.name)
            .eq('status', 'ACTIVE')
            .lte('address_range_low', result.location.parsedAddress.number)
            .gte('address_range_high', result.location.parsedAddress.number)
            .then(r => r.data || []).catch(() => [])
        : Promise.resolve([]),

      // Permit zone hours lookup (all zones - small table)
      supabaseAdmin
        .from('permit_zone_hours')
        .select('zone, zone_type, restriction_schedule')
        .eq('confidence', 'confirmed')
        .then(r => r.data || []).catch(() => []),
    ]);

    // ==========================================
    // STEP 3: Process results
    // ==========================================

    // --- Street Cleaning ---
    if (streetCleaningData) {
      result.streetCleaning.found = true;
      result.streetCleaning.ward = streetCleaningData.ward;
      result.streetCleaning.section = streetCleaningData.section;
      result.streetCleaning.nextCleaningDate = streetCleaningData.next_cleaning_date;

      // Check if cleaning is today or active now
      const now = getChicagoTime();
      const cleaningDate = streetCleaningData.next_cleaning_date
        ? new Date(streetCleaningData.next_cleaning_date)
        : null;

      if (cleaningDate && cleaningDate.toDateString() === now.toDateString()) {
        result.streetCleaning.severity = 'warning';
        result.streetCleaning.message = `Street cleaning scheduled today in Ward ${streetCleaningData.ward}, Section ${streetCleaningData.section}`;
      } else if (cleaningDate) {
        result.streetCleaning.severity = 'info';
        result.streetCleaning.message = `Next street cleaning: ${cleaningDate.toLocaleDateString()}`;
      }
    }

    // --- Snow Ban ---
    if (snowRouteData?.street_name) {
      result.snowBan.found = true;
      result.snowBan.streetName = snowRouteData.street_name;
      result.snowBan.isBanActive = snowBanStatus?.is_active || false;
      result.snowBan.snowAmount = snowBanStatus?.snow_amount_inches || null;

      if (result.snowBan.isBanActive) {
        result.snowBan.severity = 'critical';
        result.snowBan.message = `2-INCH SNOW BAN ACTIVE on ${snowRouteData.street_name}! 2"+ snow has fallen - move your car now to avoid $150+ tow!`;
      } else {
        result.snowBan.severity = 'info';
        result.snowBan.message = `${snowRouteData.street_name} is a 2-inch snow route. No parking when 2"+ snow accumulates.`;
      }
    }

    // --- Winter Overnight Ban (now using spatial query) ---
    const banHoursInfo = getBanHoursInfo();

    // winterBanData comes from spatial query - already filtered by location
    if (winterBanData?.street_name) {
      result.winterBan.found = true;
      result.winterBan.streetName = winterBanData.street_name;
      result.winterBan.isWinterSeason = winterBanData.is_winter_season || false;
      result.winterBan.isBanHours = winterBanData.is_winter_ban_hours || false;
      result.winterBan.hoursUntilBan = banHoursInfo.hoursUntilBan;

      if (winterBanData.is_winter_season) {
        if (winterBanData.is_winter_ban_hours) {
          result.winterBan.severity = 'critical';
          result.winterBan.message = `WINTER OVERNIGHT BAN ACTIVE on ${winterBanData.street_name}! No parking 3-7 AM (nightly Dec 1 - Apr 1). Move now!`;
        } else if (banHoursInfo.hoursUntilBan <= 7) {
          result.winterBan.severity = 'warning';
          result.winterBan.message = `Winter overnight ban starts in ${Math.round(banHoursInfo.hoursUntilBan)} hour(s) on ${winterBanData.street_name}. Move before 3 AM.`;
        } else {
          result.winterBan.severity = 'info';
          result.winterBan.message = `${winterBanData.street_name} has a winter overnight ban (no parking 3-7 AM nightly, Dec 1 - Apr 1)`;
        }
      } else {
        // Not winter season but on a winter ban street
        result.winterBan.severity = 'none';
        result.winterBan.message = `${winterBanData.street_name} has a winter overnight ban (3-7 AM, Dec 1 - Apr 1). Currently outside ban season.`;
      }
    } else {
      result.winterBan.isWinterSeason = isWinterSeason();
      result.winterBan.isBanHours = banHoursInfo.isBanHours;
      result.winterBan.hoursUntilBan = banHoursInfo.hoursUntilBan;
    }

    // --- Permit Zone (Residential) ---
    // Build a quick lookup map from permit_zone_hours table
    const zoneHoursMap = new Map<string, string>();
    for (const zh of zoneHoursData) {
      zoneHoursMap.set(`${zh.zone_type}:${zh.zone}`, zh.restriction_schedule);
    }

    if (permitZones.length > 0 && result.location.parsedAddress) {
      // Filter by odd/even if applicable
      const matchingZones = permitZones.filter(zone => {
        if (zone.odd_even && result.location.parsedAddress) {
          return result.location.parsedAddress.isOdd
            ? zone.odd_even === 'O'
            : zone.odd_even === 'E';
        }
        return true;
      });

      if (matchingZones.length > 0) {
        const zone = matchingZones[0];
        // Look up zone-specific hours, fall back to default
        const knownSchedule = zoneHoursMap.get(`residential:${zone.zone}`);
        const restrictionSchedule = knownSchedule || DEFAULT_PERMIT_RESTRICTION;
        const hasKnownHours = !!knownSchedule;

        result.permitZone.found = true;
        result.permitZone.zoneName = `Zone ${zone.zone}`;
        result.permitZone.zoneType = 'residential';
        result.permitZone.restrictionSchedule = restrictionSchedule;

        // Validate current time against restrictions
        const zoneStatus = validatePermitZone(zone.zone, restrictionSchedule);
        result.permitZone.isCurrentlyRestricted = zoneStatus.is_currently_restricted;
        result.permitZone.hoursUntilRestriction = zoneStatus.hours_until_restriction;

        // Note when using estimated hours vs confirmed sign data
        const hoursNote = hasKnownHours ? '' : ' (check posted signs for exact hours)';

        if (zoneStatus.is_currently_restricted) {
          result.permitZone.severity = 'critical';
          result.permitZone.message = `PERMIT REQUIRED - Zone ${zone.zone}. ${restrictionSchedule}. $75 ticket risk.${hoursNote}`;
        } else if (zoneStatus.hours_until_restriction <= 3) {
          result.permitZone.severity = 'warning';
          result.permitZone.message = `Zone ${zone.zone} - Permit enforcement starts in ${Math.round(zoneStatus.hours_until_restriction)} hour(s). ${restrictionSchedule}.${hoursNote}`;
        } else {
          result.permitZone.severity = 'info';
          result.permitZone.message = `Zone ${zone.zone} - ${restrictionSchedule}. No permit needed currently.${hoursNote}`;
        }
      }
    }

    // --- Industrial Permit Zone (only if no residential zone found) ---
    if (!result.permitZone.found && industrialZones.length > 0) {
      const iZone = industrialZones[0];
      // Check zone hours lookup first, then fall back to DB fields, then default
      const knownIndustrialSchedule = zoneHoursMap.get(`industrial:${iZone.zone}`);
      // DB stores "8:00 AM - 3:00 PM", validator expects "8am-3pm"
      const formatHours = (h: string) => h
        .replace(/(\d+):00\s*/g, '$1')
        .replace(/\s*AM/gi, 'am')
        .replace(/\s*PM/gi, 'pm')
        .replace(/\s*-\s*/g, '-');
      const restrictionSchedule = knownIndustrialSchedule
        || (iZone.restriction_hours && iZone.restriction_days
          ? `${iZone.restriction_days} ${formatHours(iZone.restriction_hours)}`
          : iZone.restriction_days
            ? `${iZone.restriction_days} 8am-3pm`
            : 'Mon-Fri 8am-3pm');

      result.permitZone.found = true;
      result.permitZone.zoneName = `Industrial Zone ${iZone.zone}`;
      result.permitZone.zoneType = 'industrial';
      result.permitZone.restrictionSchedule = restrictionSchedule;

      // Validate current time against industrial zone restrictions
      const zoneStatus = validatePermitZone(`Industrial Zone ${iZone.zone}`, restrictionSchedule);
      result.permitZone.isCurrentlyRestricted = zoneStatus.is_currently_restricted;
      result.permitZone.hoursUntilRestriction = zoneStatus.hours_until_restriction;

      if (zoneStatus.is_currently_restricted) {
        result.permitZone.severity = 'critical';
        result.permitZone.message = `INDUSTRIAL PERMIT REQUIRED - Zone ${iZone.zone}. ${restrictionSchedule}. No parking without industrial permit.`;
      } else if (zoneStatus.hours_until_restriction <= 3) {
        result.permitZone.severity = 'warning';
        result.permitZone.message = `Industrial Zone ${iZone.zone} - Restriction starts in ${Math.round(zoneStatus.hours_until_restriction)} hour(s). ${restrictionSchedule}.`;
      } else {
        result.permitZone.severity = 'info';
        result.permitZone.message = `Industrial Zone ${iZone.zone} - ${restrictionSchedule}. No industrial permit needed currently.`;
      }
    }

    return result;

  } catch (error) {
    console.error('Error in unified parking check:', error);
    return result;
  }
}

// Helper functions

function normalizeStreetName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/^\d+\s+/, '') // Remove leading numbers
    .trim();
}

function isWinterSeason(): boolean {
  const now = getChicagoTime();
  const month = now.getMonth(); // 0-11
  // Dec (11), Jan (0), Feb (1), Mar (2) up to April 1
  return month === 11 || month === 0 || month === 1 || month === 2 ||
         (month === 3 && now.getDate() === 1);
}

function getBanHoursInfo(): { isBanHours: boolean; hoursUntilBan: number } {
  const now = getChicagoTime();
  const hour = now.getHours();

  // Ban is 3 AM - 7 AM
  const isBanHours = hour >= 3 && hour < 7;

  let hoursUntilBan: number;
  if (hour >= 7) {
    // After 7 AM, ban starts at 3 AM next day
    hoursUntilBan = (24 - hour) + 3;
  } else if (hour < 3) {
    // Before 3 AM, ban starts at 3 AM today
    hoursUntilBan = 3 - hour;
  } else {
    // During ban hours
    hoursUntilBan = 0;
  }

  return { isBanHours, hoursUntilBan };
}
