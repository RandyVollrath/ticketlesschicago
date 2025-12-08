import { NextApiRequest, NextApiResponse } from 'next';
import winterBanData from '../../data/winter-ban-routes.json';

interface WinterBanRoute {
  street_name: string;
  from_location: string;
  to_location: string;
  coordinates: number[][][]; // MultiLineString format
}

/**
 * Get winter ban routes with official city geometry for map display
 * Data source: City of Chicago Winter Overnight Parking Restrictions
 * Returns GeoJSON features for the 20 official winter overnight parking ban streets
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const routes = (winterBanData as WinterBanRoute[]).map(street => ({
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: street.coordinates
      },
      properties: {
        street_name: street.street_name,
        from_location: street.from_location,
        to_location: street.to_location,
        restriction: 'Winter Overnight Ban (3AM-7AM, Dec 1 - Apr 1)'
      }
    }));

    return res.status(200).json({
      routes,
      count: routes.length,
      successfullyGeocoded: routes.length,
      source: 'City of Chicago Official Data'
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
