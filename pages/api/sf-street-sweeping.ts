import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * API endpoint to fetch SF street sweeping schedules
 *
 * Query parameters:
 * - address: Address to geocode and find nearest streets
 * - street: Street name to search for
 * - bounds: Map bounds in format "swLat,swLng,neLat,neLng" to fetch visible segments
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address, street, bounds } = req.query;

  try {
    // Case 1: Fetch by map bounds (for rendering on map)
    if (bounds) {
      const [swLat, swLng, neLat, neLng] = (bounds as string).split(',').map(Number);

      const { data, error } = await supabase.rpc('get_sf_streets_in_bounds', {
        sw_lat: swLat,
        sw_lng: swLng,
        ne_lat: neLat,
        ne_lng: neLng
      });

      if (error) {
        console.error('Error fetching SF streets by bounds:', error);
        return res.status(500).json({ error: 'Failed to fetch street data' });
      }

      return res.status(200).json({ schedules: data || [] });
    }

    // Case 2: Fetch by street name
    if (street) {
      const { data, error } = await supabase
        .from('sf_street_sweeping')
        .select('*')
        .ilike('corridor', `%${street}%`)
        .order('corridor', { ascending: true })
        .limit(50);

      if (error) {
        console.error('Error fetching SF streets by name:', error);
        return res.status(500).json({ error: 'Failed to fetch street data' });
      }

      return res.status(200).json({ schedules: data || [] });
    }

    // Case 3: Fetch by address (geocoding)
    if (address) {
      const googleApiKey = process.env.GOOGLE_API_KEY;

      if (!googleApiKey) {
        return res.status(500).json({ error: 'Google API key not configured' });
      }

      // Geocode the address
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address + ', San Francisco, CA')}&key=${googleApiKey}`;

      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json();

      if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
        return res.status(404).json({ error: 'Address not found' });
      }

      const location = geocodeData.results[0].geometry.location;
      const { lat, lng } = location;

      // Find nearest street segments
      const { data, error } = await supabase.rpc('find_nearest_sf_street', {
        lat,
        lng,
        max_distance_meters: 100
      });

      if (error) {
        console.error('Error finding nearest SF street:', error);
        return res.status(500).json({ error: 'Failed to find nearby streets' });
      }

      return res.status(200).json({
        schedules: data || [],
        geocoded: {
          lat,
          lng,
          formattedAddress: geocodeData.results[0].formatted_address
        }
      });
    }

    // No query parameters provided
    return res.status(400).json({ error: 'Missing required parameter: address, street, or bounds' });

  } catch (err) {
    console.error('Unexpected error in SF street sweeping API:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
