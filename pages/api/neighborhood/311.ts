import type { NextApiRequest, NextApiResponse } from 'next';

// Chicago Data Portal - 311 Service Requests API
// Dataset: 311 Service Requests
// API: https://data.cityofchicago.org/resource/v6vf-nfxy.json

interface ServiceRequestRecord {
  sr_number: string;
  sr_type: string;
  sr_short_code: string;
  created_date: string;
  last_modified_date: string;
  closed_date: string;
  status: string;
  owner_department: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  ward: string;
  police_district: string;
  community_area: string;
  latitude: string;
  longitude: string;
}

interface ServiceRequestDetail {
  id: string;
  type: string;
  shortCode: string;
  createdDate: string;
  createdTime: string;
  status: string;
  address: string;
  ward: string;
  department: string;
  distance: number;
  category: string;
}

// Categories matching our neighborhood data
const CATEGORY_MAPPING: Record<string, string[]> = {
  'infrastructure': [
    'Pothole', 'Street Light', 'Alley Light', 'Traffic Signal',
    'Sign Repair', 'Sidewalk', 'Street Cut', 'Cave-in'
  ],
  'sanitation': [
    'Graffiti', 'Garbage', 'Fly Dumping', 'Sanitation', 'Dead Animal',
    'Recycling', 'Yard Waste', 'Bulk'
  ],
  'pests': ['Rodent', 'Rat', 'Stray Animal', 'Animal'],
  'vehicles': ['Abandoned Vehicle', 'Vehicle'],
  'trees': ['Tree', 'Weed', 'Forestry'],
  'water': ['Water', 'Sewer', 'Leak', 'Flood', 'Drain'],
};

function getCategory(srType: string): string {
  const upper = srType.toUpperCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_MAPPING)) {
    for (const kw of keywords) {
      if (upper.includes(kw.toUpperCase())) {
        return cat;
      }
    }
  }
  return 'other';
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

    // Increase limit to get more results, we'll filter by exact distance
    const query = `$where=latitude between '${minLat}' and '${maxLat}' AND longitude between '${minLng}' and '${maxLng}' AND created_date > '${dateFilter}T00:00:00'&$order=created_date DESC&$limit=1000`;

    const url = `https://data.cityofchicago.org/resource/v6vf-nfxy.json?${query}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Chicago Data Portal error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch 311 data from Chicago Data Portal' });
    }

    const requests: ServiceRequestRecord[] = await response.json();

    const radiusFeet = radiusMiles * 5280;
    const requestDetails: ServiceRequestDetail[] = [];

    for (const sr of requests) {
      const srLat = parseFloat(sr.latitude);
      const srLng = parseFloat(sr.longitude);

      if (isNaN(srLat) || isNaN(srLng)) continue;

      const distance = haversineDistanceFeet(latitude, longitude, srLat, srLng);

      if (distance <= radiusFeet) {
        const dateObj = new Date(sr.created_date);
        const dateStr = dateObj.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        const timeStr = dateObj.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });

        requestDetails.push({
          id: sr.sr_number,
          type: formatServiceType(sr.sr_type),
          shortCode: sr.sr_short_code || '',
          createdDate: dateStr,
          createdTime: timeStr,
          status: formatStatus(sr.status),
          address: sr.street_address || 'Unknown address',
          ward: sr.ward || '',
          department: sr.owner_department || '',
          distance: Math.round(distance),
          category: getCategory(sr.sr_type),
        });
      }
    }

    requestDetails.sort((a, b) => {
      const dateA = new Date(a.createdDate);
      const dateB = new Date(b.createdDate);
      return dateB.getTime() - dateA.getTime();
    });

    // Categorize
    const categories: Record<string, number> = {};
    requestDetails.forEach(r => {
      categories[r.category] = (categories[r.category] || 0) + 1;
    });

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      total: requestDetails.length,
      categories,
      requests: requestDetails,
      location: { latitude, longitude, radiusFeet: Math.round(radiusFeet) },
    });

  } catch (error) {
    console.error('Error fetching 311 data:', error);
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

function formatServiceType(type: string): string {
  if (!type) return 'Unknown';
  return type
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  const statusMap: Record<string, string> = {
    'OPEN': 'Open',
    'COMPLETED': 'Completed',
    'CLOSED': 'Closed',
    'CANCELLED': 'Cancelled',
    'DUPLICATE': 'Duplicate',
  };
  return statusMap[status.toUpperCase()] || status;
}
