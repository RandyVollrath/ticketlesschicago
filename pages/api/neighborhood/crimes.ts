import type { NextApiRequest, NextApiResponse } from 'next';

// Chicago Data Portal - Crimes API
// Dataset: Crimes - One Year Prior to Present
// API: https://data.cityofchicago.org/resource/ijzp-q8t2.json

interface CrimeRecord {
  id: string;
  case_number: string;
  date: string;
  block: string;
  primary_type: string;
  description: string;
  location_description: string;
  arrest: boolean;
  domestic: boolean;
  beat: string;
  district: string;
  ward: string;
  community_area: string;
  latitude: string;
  longitude: string;
}

interface CrimeDetail {
  id: string;
  caseNumber: string;
  date: string;
  time: string;
  type: string;
  description: string;
  location: string;
  locationType: string;
  arrest: boolean;
  domestic: boolean;
  distance: number;  // feet from search point
  ward: string;
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

  // Validate coordinates are in Chicago area
  if (latitude < 41.6 || latitude > 42.1 || longitude < -88.0 || longitude > -87.5) {
    return res.status(400).json({ error: 'Coordinates must be within Chicago' });
  }

  try {
    // Calculate bounding box for the query
    // 1 degree of latitude ≈ 69 miles
    // 1 degree of longitude ≈ 53 miles at Chicago's latitude
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / 53;

    const minLat = latitude - latDelta;
    const maxLat = latitude + latDelta;
    const minLng = longitude - lngDelta;
    const maxLng = longitude + lngDelta;

    // Calculate date for last 12 months
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const dateFilter = oneYearAgo.toISOString().split('T')[0];

    // Query Chicago Data Portal
    // Using SoQL (Socrata Query Language)
    // Increase limit to get more results, we'll filter by exact distance
    const query = `$where=latitude between '${minLat}' and '${maxLat}' AND longitude between '${minLng}' and '${maxLng}' AND date > '${dateFilter}T00:00:00'&$order=date DESC&$limit=1000`;

    const url = `https://data.cityofchicago.org/resource/ijzp-q8t2.json?${query}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Chicago Data Portal error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch crime data from Chicago Data Portal' });
    }

    const crimes: CrimeRecord[] = await response.json();

    // Process and filter by exact distance
    const radiusFeet = radiusMiles * 5280;
    const crimeDetails: CrimeDetail[] = [];

    for (const crime of crimes) {
      const crimeLat = parseFloat(crime.latitude);
      const crimeLng = parseFloat(crime.longitude);

      if (isNaN(crimeLat) || isNaN(crimeLng)) continue;

      // Calculate distance in feet
      const distance = haversineDistanceFeet(latitude, longitude, crimeLat, crimeLng);

      if (distance <= radiusFeet) {
        // Parse date and time
        const dateObj = new Date(crime.date);
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

        crimeDetails.push({
          id: crime.id,
          caseNumber: crime.case_number,
          date: dateStr,
          time: timeStr,
          type: formatCrimeType(crime.primary_type),
          description: formatDescription(crime.description),
          location: crime.block,
          locationType: formatLocationType(crime.location_description),
          arrest: crime.arrest === true || crime.arrest === 'true' as unknown as boolean,
          domestic: crime.domestic === true || crime.domestic === 'true' as unknown as boolean,
          distance: Math.round(distance),
          ward: crime.ward,
        });
      }
    }

    // Sort by date (most recent first)
    crimeDetails.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB.getTime() - dateA.getTime();
    });

    // Categorize crimes
    const categories = {
      violent: crimeDetails.filter(c => isViolentCrime(c.type)).length,
      property: crimeDetails.filter(c => isPropertyCrime(c.type)).length,
      drugs: crimeDetails.filter(c => c.type.includes('NARCOTICS')).length,
      other: 0,
    };
    categories.other = crimeDetails.length - categories.violent - categories.property - categories.drugs;

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      total: crimeDetails.length,
      categories,
      crimes: crimeDetails,
      location: {
        latitude,
        longitude,
        radiusFeet: Math.round(radiusFeet),
      },
    });

  } catch (error) {
    console.error('Error fetching crime data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Haversine formula to calculate distance in feet
function haversineDistanceFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902000; // Earth radius in feet
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

function formatCrimeType(type: string): string {
  if (!type) return 'Unknown';
  return type
    .split(' ')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function formatDescription(desc: string): string {
  if (!desc) return '';
  return desc
    .split(' ')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function formatLocationType(loc: string): string {
  if (!loc) return 'Unknown';
  return loc
    .split(' ')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function isViolentCrime(type: string): boolean {
  const violentTypes = ['HOMICIDE', 'ROBBERY', 'ASSAULT', 'BATTERY', 'CRIMINAL SEXUAL ASSAULT', 'KIDNAPPING'];
  return violentTypes.some(v => type.toUpperCase().includes(v));
}

function isPropertyCrime(type: string): boolean {
  const propertyTypes = ['THEFT', 'BURGLARY', 'MOTOR VEHICLE THEFT', 'CRIMINAL DAMAGE', 'ARSON'];
  return propertyTypes.some(p => type.toUpperCase().includes(p));
}
