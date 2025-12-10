/**
 * Mobile Check Parking API
 *
 * Optimized endpoint for mobile app parking location checks.
 * Supports GET requests with query params and returns address + restrictions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { matchStreetCleaningSchedule } from '../../../lib/street-cleaning-schedule-matcher';
import { checkWinterOvernightBan } from '../../../lib/winter-overnight-ban-checker';
import { checkLocationTwoInchSnowBan } from '../../../lib/two-inch-snow-ban-checker';
import { getStreetAddress, reverseGeocode } from '../../../lib/reverse-geocoder';

interface StreetCleaningResponse {
  hasRestriction: boolean;
  message: string;
  timing?: 'NOW' | 'TODAY' | 'UPCOMING' | 'NONE';
  nextDate?: string;
  schedule?: string;
}

interface WinterBanResponse {
  active: boolean;
  message: string;
  severity?: 'critical' | 'warning' | 'info';
  startTime?: string;
  endTime?: string;
}

interface SnowBanResponse {
  active: boolean;
  message: string;
  severity?: 'critical' | 'warning' | 'info';
  reason?: string;
}

interface PermitZoneResponse {
  inPermitZone: boolean;
  message: string;
  zoneName?: string;
  permitRequired?: boolean;
}

interface MobileCheckParkingResponse {
  success: boolean;
  address: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  streetCleaning: StreetCleaningResponse;
  winterOvernightBan: WinterBanResponse;
  twoInchSnowBan: SnowBanResponse;
  permitZone: PermitZoneResponse;
  timestamp: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MobileCheckParkingResponse | { error: string }>
) {
  // Allow both GET and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get coordinates from query params (GET) or body (POST)
  const lat = req.method === 'GET' ? req.query.lat : req.body.latitude;
  const lng = req.method === 'GET' ? req.query.lng : req.body.longitude;

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lng as string);

  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }

  // Validate coordinates are within Chicago area (roughly)
  if (latitude < 41.6 || latitude > 42.1 || longitude < -88.0 || longitude > -87.5) {
    return res.status(400).json({ error: 'Coordinates must be within Chicago area' });
  }

  try {
    // Run all checks in parallel for performance
    const [
      streetCleaningMatch,
      winterOvernightBanStatus,
      twoInchSnowBanStatus,
      geocodeResult,
    ] = await Promise.all([
      matchStreetCleaningSchedule(latitude, longitude).catch(err => {
        console.error('Street cleaning check error:', err);
        return null;
      }),
      checkWinterOvernightBan(latitude, longitude).catch(err => {
        console.error('Winter ban check error:', err);
        return null;
      }),
      checkLocationTwoInchSnowBan(latitude, longitude).catch(err => {
        console.error('Two inch snow ban check error:', err);
        return null;
      }),
      reverseGeocode(latitude, longitude).catch(err => {
        console.error('Reverse geocode error:', err);
        return null;
      }),
    ]);

    // Format address
    let address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    if (geocodeResult) {
      if (geocodeResult.street_number && geocodeResult.street_name) {
        address = `${geocodeResult.street_number} ${geocodeResult.street_name}`;
        if (geocodeResult.neighborhood) {
          address += `, ${geocodeResult.neighborhood}`;
        }
      } else if (geocodeResult.formatted_address) {
        address = geocodeResult.formatted_address;
      }
    }

    // Format street cleaning response
    const streetCleaning: StreetCleaningResponse = {
      hasRestriction: false,
      message: 'No street cleaning restrictions found',
      timing: 'NONE',
    };

    if (streetCleaningMatch && streetCleaningMatch.match) {
      streetCleaning.hasRestriction = true;
      streetCleaning.schedule = streetCleaningMatch.schedule?.days_and_times || '';

      // Determine timing based on the match data
      const now = new Date();
      const matchDate = streetCleaningMatch.nextCleaningDate
        ? new Date(streetCleaningMatch.nextCleaningDate)
        : null;

      if (streetCleaningMatch.isActiveNow) {
        streetCleaning.timing = 'NOW';
        streetCleaning.message = `STREET CLEANING IN PROGRESS on ${geocodeResult?.street_name || 'this street'}. Move your car immediately!`;
      } else if (matchDate && matchDate.toDateString() === now.toDateString()) {
        streetCleaning.timing = 'TODAY';
        streetCleaning.message = `Street cleaning scheduled today: ${streetCleaningMatch.schedule?.days_and_times || 'Check signage'}`;
      } else if (matchDate) {
        streetCleaning.timing = 'UPCOMING';
        streetCleaning.nextDate = matchDate.toISOString();
        streetCleaning.message = `Street cleaning: ${streetCleaningMatch.schedule?.days_and_times || 'See schedule'}`;
      } else {
        streetCleaning.message = `Street cleaning on this block: ${streetCleaningMatch.schedule?.days_and_times || 'Check signage'}`;
      }
    }

    // Format winter overnight ban response
    const winterOvernightBan: WinterBanResponse = {
      active: false,
      message: 'No winter overnight ban at this location',
    };

    if (winterOvernightBanStatus && winterOvernightBanStatus.isOnWinterBanStreet) {
      winterOvernightBan.active = winterOvernightBanStatus.banActiveNow || false;
      winterOvernightBan.startTime = '3:00 AM';
      winterOvernightBan.endTime = '7:00 AM';

      if (winterOvernightBanStatus.banActiveNow) {
        winterOvernightBan.severity = 'critical';
        winterOvernightBan.message = 'WINTER OVERNIGHT BAN ACTIVE NOW! No parking 3 AM - 7 AM (Dec 1 - Apr 1)';
      } else {
        winterOvernightBan.severity = 'warning';
        winterOvernightBan.message = 'This street has winter overnight parking ban (3 AM - 7 AM, Dec 1 - Apr 1)';
      }
    }

    // Format 2-inch snow ban response
    const twoInchSnowBan: SnowBanResponse = {
      active: false,
      message: 'No snow ban active',
    };

    if (twoInchSnowBanStatus && twoInchSnowBanStatus.isOnSnowRoute) {
      if (twoInchSnowBanStatus.banActive) {
        twoInchSnowBan.active = true;
        twoInchSnowBan.severity = 'critical';
        twoInchSnowBan.reason = twoInchSnowBanStatus.snowfall ? `${twoInchSnowBanStatus.snowfall}" snowfall` : 'Snow emergency declared';
        twoInchSnowBan.message = `SNOW BAN ACTIVE! ${twoInchSnowBan.reason}. No parking on this snow route until cleared.`;
      } else {
        twoInchSnowBan.severity = 'info';
        twoInchSnowBan.message = 'This is a snow route. No parking when 2"+ snow falls.';
      }
    }

    // Format permit zone response (placeholder - would need permit zone data)
    const permitZone: PermitZoneResponse = {
      inPermitZone: false,
      message: 'Not in a permit zone',
    };

    // TODO: Add permit zone checking when geometry data is available
    // if (permitZoneStatus && permitZoneStatus.inZone) {
    //   permitZone.inPermitZone = true;
    //   permitZone.zoneName = permitZoneStatus.zoneName;
    //   permitZone.permitRequired = permitZoneStatus.isEnforced;
    //   permitZone.message = `Permit Zone ${permitZoneStatus.zoneName}. ${permitZoneStatus.hours}`;
    // }

    return res.status(200).json({
      success: true,
      address,
      coordinates: { latitude, longitude },
      streetCleaning,
      winterOvernightBan,
      twoInchSnowBan,
      permitZone,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error checking parking location:', error);
    return res.status(500).json({
      success: false,
      address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      coordinates: { latitude, longitude },
      streetCleaning: { hasRestriction: false, message: 'Error checking restrictions' },
      winterOvernightBan: { active: false, message: 'Error checking restrictions' },
      twoInchSnowBan: { active: false, message: 'Error checking restrictions' },
      permitZone: { inPermitZone: false, message: 'Error checking restrictions' },
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
