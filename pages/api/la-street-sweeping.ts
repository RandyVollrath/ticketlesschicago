import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { LAStreetSweepingSchedule } from '../../lib/la-street-sweeping';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Address is required' });
  }

  try {
    // Geocode the address using Google Maps API
    const googleApiKey = process.env.GOOGLE_API_KEY;

    if (!googleApiKey) {
      return res.status(500).json({ error: 'Google API key not configured' });
    }

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address + ', Los Angeles, CA'
    )}&key=${googleApiKey}`;

    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();

    if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    const location = geocodeData.results[0].geometry.location;
    const { lat, lng } = location;

    // Use PostGIS function to find route containing this point
    const { data: routes, error: routeError } = await supabaseAdmin.rpc('find_la_route_for_point', {
      lat,
      lng
    });

    if (routeError) {
      console.error('Error finding route:', routeError);

      // Fallback to text-based boundary matching
      const addressComponents = geocodeData.results[0].address_components;
      const routeComponent = addressComponents.find((c: any) => c.types.includes('route'));

      if (!routeComponent) {
        return res.status(404).json({ error: 'Could not determine street name' });
      }

      const streetName = routeComponent.long_name;

      const { data: fallbackRoutes, error: fallbackError } = await supabaseAdmin
        .from('la_street_sweeping')
        .select('*')
        .ilike('boundaries', `%${streetName}%`)
        .limit(10);

      if (fallbackError || !fallbackRoutes || fallbackRoutes.length === 0) {
        return res.status(404).json({
          error: 'No street sweeping schedule found for this address',
          message: 'Los Angeles uses posted street sweeping routes. Your street may not be on a posted route, or you may need to check the posted signs on your block.'
        });
      }

      return res.status(200).json({ schedules: fallbackRoutes });
    }

    if (!routes || routes.length === 0) {
      return res.status(404).json({
        error: 'No street sweeping schedule found for this address',
        message: 'Los Angeles uses posted street sweeping routes. Your street may not be on a posted route, or you may need to check the posted signs on your block.'
      });
    }

    // Return all matching routes
    return res.status(200).json({ schedules: routes });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
