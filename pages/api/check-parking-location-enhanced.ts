import type { NextApiRequest, NextApiResponse } from 'next';
import { matchStreetCleaningSchedule } from '../../lib/street-cleaning-schedule-matcher';
import { checkWinterOvernightBan } from '../../lib/winter-overnight-ban-checker';
import { checkLocationTwoInchSnowBan } from '../../lib/two-inch-snow-ban-checker';
import { getFormattedAddress } from '../../lib/reverse-geocoder';
import {
  formatStreetCleaningRestriction,
  formatWinterOvernightBanRestriction,
  formatTwoInchSnowBanRestriction,
  formatCombinedRestrictions,
  type FormattedRestriction,
} from '../../lib/parking-restriction-formatter';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  try {
    // Run all checks in parallel for performance
    const [streetCleaningMatch, winterOvernightBanStatus, twoInchSnowBanStatus, address] = await Promise.all([
      matchStreetCleaningSchedule(latitude, longitude),
      checkWinterOvernightBan(latitude, longitude),
      checkLocationTwoInchSnowBan(latitude, longitude),
      getFormattedAddress(latitude, longitude),
    ]);

    // Format restrictions
    const restrictions: FormattedRestriction[] = [];

    const streetCleaningRestriction = formatStreetCleaningRestriction(streetCleaningMatch);
    if (streetCleaningRestriction) {
      restrictions.push(streetCleaningRestriction);
    }

    const winterOvernightRestriction = formatWinterOvernightBanRestriction(winterOvernightBanStatus);
    if (winterOvernightRestriction) {
      restrictions.push(winterOvernightRestriction);
    }

    const twoInchSnowRestriction = formatTwoInchSnowBanRestriction(twoInchSnowBanStatus);
    if (twoInchSnowRestriction) {
      restrictions.push(twoInchSnowRestriction);
    }

    // Note: Permit zones not fully implemented yet (no geometry data)
    // Would be added here when available

    // Combine all restrictions
    const combined = formatCombinedRestrictions(restrictions);

    // Build response
    return res.status(200).json({
      success: true,
      location: {
        latitude,
        longitude,
        address: address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      },
      restrictions: {
        found: restrictions.length > 0,
        count: restrictions.length,
        highest_severity: combined.highestSeverity,
        summary: {
          title: combined.combinedTitle,
          message: combined.combinedMessage,
        },
        details: restrictions,
      },
      raw_data: {
        street_cleaning: streetCleaningMatch,
        winter_overnight_ban: winterOvernightBanStatus,
        two_inch_snow_ban: twoInchSnowBanStatus,
      },
    });
  } catch (error) {
    console.error('Error checking parking location:', error);
    return res.status(500).json({
      error: 'Failed to check parking location',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
