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
 * Uses Google Directions API to geocode street segments
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

    // Try to geocode each street segment using Google Directions API
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
        const origin = `${street.from_location} and ${street.street_name}, Chicago, IL`;
        const destination = `${street.to_location} and ${street.street_name}, Chicago, IL`;

        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=driving&key=${googleApiKey}`;

        const response = await fetch(directionsUrl);
        const data = await response.json();

        if (data.status === 'OK' && data.routes && data.routes.length > 0) {
          // Decode the polyline to get coordinates
          const encodedPolyline = data.routes[0].overview_polyline.points;
          const coordinates = decodePolyline(encodedPolyline);

          const geom = {
            type: 'LineString',
            coordinates: coordinates
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
          console.log(`Could not geocode: ${street.street_name} from ${street.from_location} to ${street.to_location}`);
          routesWithGeometry.push({
            type: 'Feature',
            geometry: null,
            properties: {
              street_name: street.street_name,
              from_location: street.from_location,
              to_location: street.to_location,
              restriction: 'Winter Overnight Ban (3AM-7AM, Dec 1 - Apr 1)',
              geocodeError: data.status
            }
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

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

/**
 * Decode Google's encoded polyline format
 */
function decodePolyline(encoded: string): number[][] {
  const coordinates: number[][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    // GeoJSON uses [lng, lat] format
    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
}
