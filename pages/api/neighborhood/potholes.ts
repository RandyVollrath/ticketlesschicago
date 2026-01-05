import type { NextApiRequest, NextApiResponse } from 'next';

// Chicago Data Portal - Potholes Patched API
// Dataset: Potholes Patched - Historical
// API: https://data.cityofchicago.org/resource/wqdh-9gek.json

interface PotholeRecord {
  service_request_number: string;
  creation_date: string;
  completion_date: string;
  status: string;
  number_of_potholes_filled_on_block: string;
  street_address: string;
  zip: string;
  ward: string;
  police_district: string;
  community_area: string;
  latitude: string;
  longitude: string;
}

interface PotholeDetail {
  id: string;
  createdDate: string;
  completedDate: string;
  status: string;
  potholesFilled: number;
  address: string;
  ward: string;
  distance: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng parameters are required' });
  }

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lng as string);
  const radiusMiles = parseFloat((radius as string) || '0.1');

  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ error: 'Invalid lat/lng values' });
  }

  if (latitude < 41.6 || latitude > 42.1 || longitude < -88.0 || longitude > -87.5) {
    return res.status(400).json({ error: 'Coordinates must be within Chicago' });
  }

  try {
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / 53;

    const minLat = latitude - latDelta;
    const maxLat = latitude + latDelta;
    const minLng = longitude - lngDelta;
    const maxLng = longitude + lngDelta;

    // Last 12 months
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const dateFilter = oneYearAgo.toISOString().split('T')[0];

    const query = `$where=latitude between '${minLat}' and '${maxLat}' AND longitude between '${minLng}' and '${maxLng}' AND creation_date > '${dateFilter}T00:00:00'&$order=creation_date DESC&$limit=1000`;

    const url = `https://data.cityofchicago.org/resource/wqdh-9gek.json?${query}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Chicago Data Portal error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch pothole data from Chicago Data Portal' });
    }

    const potholes: PotholeRecord[] = await response.json();

    const radiusFeet = radiusMiles * 5280;
    const potholeDetails: PotholeDetail[] = [];

    for (const p of potholes) {
      const pLat = parseFloat(p.latitude);
      const pLng = parseFloat(p.longitude);

      if (isNaN(pLat) || isNaN(pLng)) continue;

      const distance = haversineDistanceFeet(latitude, longitude, pLat, pLng);

      if (distance <= radiusFeet) {
        const createdDate = new Date(p.creation_date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

        let completedDate = '';
        if (p.completion_date) {
          completedDate = new Date(p.completion_date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });
        }

        potholeDetails.push({
          id: p.service_request_number,
          createdDate,
          completedDate,
          status: formatStatus(p.status),
          potholesFilled: parseInt(p.number_of_potholes_filled_on_block) || 0,
          address: p.street_address || 'Unknown address',
          ward: p.ward || '',
          distance: Math.round(distance),
        });
      }
    }

    potholeDetails.sort((a, b) => {
      const dateA = new Date(a.createdDate);
      const dateB = new Date(b.createdDate);
      return dateB.getTime() - dateA.getTime();
    });

    const summary = {
      total: potholeDetails.length,
      totalFilled: potholeDetails.reduce((sum, p) => sum + p.potholesFilled, 0),
      completed: potholeDetails.filter(p => p.status === 'Completed').length,
    };

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      ...summary,
      potholes: potholeDetails,
      location: { latitude, longitude, radiusFeet: Math.round(radiusFeet) },
    });

  } catch (error) {
    console.error('Error fetching pothole data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function haversineDistanceFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  const statusMap: Record<string, string> = {
    'COMPLETED': 'Completed',
    'OPEN': 'Open',
    'OPEN - DUP': 'Duplicate',
  };
  return statusMap[status.toUpperCase()] || status;
}
