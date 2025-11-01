import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { SDStreetSweepingSchedule } from '../../lib/sd-street-sweeping';

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
      address + ', San Diego, CA'
    )}&key=${googleApiKey}`;

    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();

    if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    const location = geocodeData.results[0].geometry.location;
    const { lat, lng } = location;

    // Extract street name from address components
    const addressComponents = geocodeData.results[0].address_components;
    const routeComponent = addressComponents.find((c: any) => c.types.includes('route'));

    if (!routeComponent) {
      return res.status(404).json({ error: 'Could not determine street name' });
    }

    const streetName = routeComponent.long_name;

    // Find all segments matching this street name
    const { data: allMatches, error: matchError } = await supabaseAdmin
      .from('sd_street_sweeping')
      .select('*')
      .ilike('rd20full', `%${streetName}%`)
      .limit(100);

    if (matchError) {
      console.error('Error fetching schedules:', matchError);
      return res.status(500).json({ error: 'Failed to fetch schedules' });
    }

    if (!allMatches || allMatches.length === 0) {
      return res.status(404).json({ error: 'No street sweeping schedule found for this address' });
    }

    // Calculate distance to each segment (using midpoint of address range)
    const segmentsWithDistance: Array<{ schedule: SDStreetSweepingSchedule; distance: number }> = [];

    for (const segment of allMatches) {
      // Calculate midpoint of segment address range
      const leftLow = parseInt(segment.llowaddr) || 0;
      const leftHigh = parseInt(segment.lhighaddr) || 0;
      const rightLow = parseInt(segment.rlowaddr) || 0;
      const rightHigh = parseInt(segment.rhighaddr) || 0;

      const avgLat = lat;
      const avgLng = lng;

      // Use cached geocoded location if available, otherwise estimate
      let segmentLat = segment.segment_lat;
      let segmentLng = segment.segment_lng;

      if (!segmentLat || !segmentLng) {
        // If no geocoded location, we'll still include it but with a higher distance
        segmentLat = avgLat;
        segmentLng = avgLng;
      }

      // Haversine distance
      const R = 6371e3; // Earth radius in meters
      const φ1 = (avgLat * Math.PI) / 180;
      const φ2 = (segmentLat * Math.PI) / 180;
      const Δφ = ((segmentLat - avgLat) * Math.PI) / 180;
      const Δλ = ((segmentLng - avgLng) * Math.PI) / 180;

      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;

      segmentsWithDistance.push({ schedule: segment, distance });
    }

    // Sort by distance
    segmentsWithDistance.sort((a, b) => a.distance - b.distance);

    // Take segments within 200m (San Diego blocks can be longer)
    const nearbySchedules = segmentsWithDistance
      .filter((item) => item.distance <= 200)
      .map((item) => item.schedule);

    if (nearbySchedules.length === 0) {
      // If no segments within 200m, take the closest one
      nearbySchedules.push(segmentsWithDistance[0].schedule);
    }

    return res.status(200).json({ schedules: nearbySchedules });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
