import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone';
  message: string;
  restriction: string;
  address: string;
}

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
    const rules: ParkingRule[] = [];

    // 1. Check for street cleaning restrictions
    // Use ST_DWithin to find nearby street segments (within ~30 meters)
    const { data: streetCleaningData, error: streetCleaningError } = await supabase.rpc(
      'get_street_cleaning_at_location',
      {
        user_lat: latitude,
        user_lng: longitude,
        distance_meters: 30
      }
    );

    if (streetCleaningError) {
      console.error('Street cleaning query error:', streetCleaningError);
    } else if (streetCleaningData && streetCleaningData.length > 0) {
      const segment = streetCleaningData[0];
      rules.push({
        type: 'street_cleaning',
        message: `You parked on ${segment.street_name || 'this street'} which has street cleaning ${segment.schedule || 'restrictions'}`,
        restriction: segment.schedule || 'Street cleaning active',
        address: segment.street_name || 'Unknown street'
      });
    }

    // 2. Check for snow route restrictions
    const { data: snowRouteData, error: snowRouteError } = await supabase.rpc(
      'get_snow_route_at_location',
      {
        user_lat: latitude,
        user_lng: longitude,
        distance_meters: 30
      }
    );

    if (snowRouteError) {
      console.error('Snow route query error:', snowRouteError);
    } else if (snowRouteData && snowRouteData.length > 0) {
      const route = snowRouteData[0];

      // Check if snow route is currently active
      const { data: statusData } = await supabase
        .from('snow_route_status')
        .select('is_active, activation_date')
        .single();

      if (statusData?.is_active) {
        rules.push({
          type: 'snow_route',
          message: `⚠️ SNOW ROUTE ACTIVE! You parked on ${route.street_name || 'a snow route'}. Parking is prohibited.`,
          restriction: 'No parking when snow route is active',
          address: route.street_name || 'Unknown street'
        });
      }
    }

    // 3. Check for permit parking zones
    const { data: permitZoneData, error: permitZoneError } = await supabase.rpc(
      'get_permit_zone_at_location',
      {
        user_lat: latitude,
        user_lng: longitude,
        distance_meters: 30
      }
    );

    if (permitZoneError) {
      console.error('Permit zone query error:', permitZoneError);
    } else if (permitZoneData && permitZoneData.length > 0) {
      const zone = permitZoneData[0];
      rules.push({
        type: 'permit_zone',
        message: `You parked in ${zone.zone_name || 'a permit zone'}. Permit required ${zone.hours || 'during restricted hours'}.`,
        restriction: zone.hours || 'Permit required',
        address: zone.street_name || 'Unknown street'
      });
    }

    // Reverse geocode to get street address if we have rules but no street name
    let address = '';
    if (rules.length > 0) {
      try {
        const geocodeResponse = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${process.env.GOOGLE_MAPS_API_KEY}`
        );
        const geocodeData = await geocodeResponse.json();
        if (geocodeData.results && geocodeData.results[0]) {
          address = geocodeData.results[0].formatted_address;
        }
      } catch (error) {
        console.error('Geocoding error:', error);
      }
    }

    return res.status(200).json({
      success: true,
      rules,
      address,
      coordinates: { latitude, longitude }
    });

  } catch (error) {
    console.error('Error checking parking location:', error);
    return res.status(500).json({
      error: 'Failed to check parking location',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
