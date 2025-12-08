import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface WinterBanStreet {
  id: string;
  street_name: string;
  from_location: string;
  to_location: string;
  geom?: any;
}

/**
 * Get winter ban routes with geometry for map display
 * Uses Google Geocoding API to get start/end coordinates
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all winter ban streets
    const { data: streets, error } = await supabase
      .from('winter_overnight_parking_ban_streets')
      .select('id, street_name, from_location, to_location');

    if (error) {
      console.error('Error fetching winter ban streets:', error);
      return res.status(500).json({ error: 'Failed to fetch winter ban streets' });
    }

    if (!streets || streets.length === 0) {
      return res.status(200).json({ routes: [], count: 0 });
    }

    // Try to geocode each street segment using Google Geocoding API
    const googleApiKey = process.env.GOOGLE_API_KEY;

    if (!googleApiKey) {
      console.error('Google API key not configured');
      // Return streets without geometry
      return res.status(200).json({
        routes: streets.map(s => ({
          type: 'Feature',
          geometry: null,
          properties: {
            street_name: s.street_name,
            from_location: s.from_location,
            to_location: s.to_location,
            restriction: 'Winter Overnight Ban (3AM-7AM, Dec 1 - Apr 1)'
          }
        })),
        count: streets.length,
        hasGeometry: false,
        error: 'No geometry - API key not configured'
      });
    }

    const routesWithGeometry: any[] = [];

    for (const street of streets) {
      try {
        // Build origin and destination addresses
        const originAddress = `${street.from_location} and ${street.street_name}, Chicago, IL`;
        const destAddress = `${street.to_location} and ${street.street_name}, Chicago, IL`;

        // Geocode origin
        const originUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(originAddress)}&key=${googleApiKey}`;
        const originResponse = await fetch(originUrl);
        const originData = await originResponse.json();

        // Geocode destination
        const destUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destAddress)}&key=${googleApiKey}`;
        const destResponse = await fetch(destUrl);
        const destData = await destResponse.json();

        if (originData.status === 'OK' && destData.status === 'OK' &&
            originData.results?.length > 0 && destData.results?.length > 0) {

          const originLoc = originData.results[0].geometry.location;
          const destLoc = destData.results[0].geometry.location;

          // Create a LineString from origin to destination
          // GeoJSON uses [lng, lat] format
          const geom = {
            type: 'LineString',
            coordinates: [
              [originLoc.lng, originLoc.lat],
              [destLoc.lng, destLoc.lat]
            ]
          };

          routesWithGeometry.push({
            type: 'Feature',
            geometry: geom,
            properties: {
              street_name: street.street_name,
              from_location: street.from_location,
              to_location: street.to_location,
              restriction: 'Winter Overnight Ban (3AM-7AM, Dec 1 - Apr 1)'
            }
          });
        } else {
          console.log(`Could not geocode: ${street.street_name} from ${street.from_location} to ${street.to_location}`,
            { originStatus: originData.status, destStatus: destData.status });
          routesWithGeometry.push({
            type: 'Feature',
            geometry: null,
            properties: {
              street_name: street.street_name,
              from_location: street.from_location,
              to_location: street.to_location,
              restriction: 'Winter Overnight Ban (3AM-7AM, Dec 1 - Apr 1)',
              geocodeError: `Origin: ${originData.status}, Dest: ${destData.status}`
            }
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (geocodeError: any) {
        console.error(`Error geocoding ${street.street_name}:`, geocodeError.message);
        routesWithGeometry.push({
          type: 'Feature',
          geometry: null,
          properties: {
            street_name: street.street_name,
            from_location: street.from_location,
            to_location: street.to_location,
            restriction: 'Winter Overnight Ban (3AM-7AM, Dec 1 - Apr 1)',
            error: geocodeError.message
          }
        });
      }
    }

    const successCount = routesWithGeometry.filter(r => r.geometry !== null).length;

    return res.status(200).json({
      routes: routesWithGeometry,
      count: routesWithGeometry.length,
      successfullyGeocoded: successCount,
      cached: false
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
