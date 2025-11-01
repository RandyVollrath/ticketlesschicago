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

    // Extract street number from the address
    const streetNumberComponent = addressComponents.find((c: any) => c.types.includes('street_number'));
    const streetNumber = streetNumberComponent ? parseInt(streetNumberComponent.long_name) : null;

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

    // Filter segments by address range matching
    const matchingSegments: SDStreetSweepingSchedule[] = [];

    if (streetNumber !== null) {
      // Match by address range
      for (const segment of allMatches) {
        const leftLow = parseInt(segment.llowaddr) || 0;
        const leftHigh = parseInt(segment.lhighaddr) || 0;
        const rightLow = parseInt(segment.rlowaddr) || 0;
        const rightHigh = parseInt(segment.rhighaddr) || 0;

        // Check if street number falls within either left or right side range
        const inLeftRange = streetNumber >= leftLow && streetNumber <= leftHigh;
        const inRightRange = streetNumber >= rightLow && streetNumber <= rightHigh;

        if (inLeftRange || inRightRange) {
          matchingSegments.push(segment);
        }
      }
    }

    // If no address range matches, fall back to closest segments by lat/lng
    if (matchingSegments.length === 0) {
      console.log(`No address range match for ${streetNumber} ${streetName}, falling back to distance`);

      const segmentsWithDistance: Array<{ schedule: SDStreetSweepingSchedule; distance: number }> = [];

      for (const segment of allMatches) {
        // Use lat/lng if available, otherwise skip
        if (segment.segment_lat && segment.segment_lng) {
          const R = 6371e3; // Earth radius in meters
          const φ1 = (lat * Math.PI) / 180;
          const φ2 = (segment.segment_lat * Math.PI) / 180;
          const Δφ = ((segment.segment_lat - lat) * Math.PI) / 180;
          const Δλ = ((segment.segment_lng - lng) * Math.PI) / 180;

          const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = R * c;

          segmentsWithDistance.push({ schedule: segment, distance });
        }
      }

      if (segmentsWithDistance.length > 0) {
        segmentsWithDistance.sort((a, b) => a.distance - b.distance);

        // Take segments within 200m
        const nearby = segmentsWithDistance
          .filter((item) => item.distance <= 200)
          .map((item) => item.schedule);

        if (nearby.length > 0) {
          matchingSegments.push(...nearby);
        } else {
          // Take closest segment if none within 200m
          matchingSegments.push(segmentsWithDistance[0].schedule);
        }
      } else {
        // No geocoded segments, take first few as fallback
        matchingSegments.push(...allMatches.slice(0, 3));
      }
    }

    console.log(`Matched ${matchingSegments.length} segments for ${streetNumber} ${streetName}`);

    return res.status(200).json({ schedules: matchingSegments });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
