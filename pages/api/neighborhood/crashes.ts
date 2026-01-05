import type { NextApiRequest, NextApiResponse } from 'next';

// Chicago Data Portal - Traffic Crashes API
// Dataset: Traffic Crashes - Crashes
// API: https://data.cityofchicago.org/resource/85ca-t3if.json

interface CrashRecord {
  crash_record_id: string;
  crash_date: string;
  posted_speed_limit: string;
  traffic_control_device: string;
  weather_condition: string;
  lighting_condition: string;
  first_crash_type: string;
  trafficway_type: string;
  roadway_surface_cond: string;
  road_defect: string;
  crash_type: string;
  prim_contributory_cause: string;
  sec_contributory_cause: string;
  street_no: string;
  street_direction: string;
  street_name: string;
  beat_of_occurrence: string;
  num_units: string;
  injuries_total: string;
  injuries_fatal: string;
  injuries_incapacitating: string;
  injuries_non_incapacitating: string;
  hit_and_run_i: string;
  latitude: string;
  longitude: string;
}

interface CrashDetail {
  id: string;
  date: string;
  time: string;
  location: string;
  crashType: string;
  primaryCause: string;
  weatherCondition: string;
  lightingCondition: string;
  roadCondition: string;
  speedLimit: number;
  injuries: number;
  fatal: number;
  hitAndRun: boolean;
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

    // Increase limit to get more results, we'll filter by exact distance
    const query = `$where=latitude between '${minLat}' and '${maxLat}' AND longitude between '${minLng}' and '${maxLng}' AND crash_date > '${dateFilter}T00:00:00'&$order=crash_date DESC&$limit=1000`;

    const url = `https://data.cityofchicago.org/resource/85ca-t3if.json?${query}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Chicago Data Portal error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch crash data from Chicago Data Portal' });
    }

    const crashes: CrashRecord[] = await response.json();

    const radiusFeet = radiusMiles * 5280;
    const crashDetails: CrashDetail[] = [];

    for (const crash of crashes) {
      const crashLat = parseFloat(crash.latitude);
      const crashLng = parseFloat(crash.longitude);

      if (isNaN(crashLat) || isNaN(crashLng)) continue;

      const distance = haversineDistanceFeet(latitude, longitude, crashLat, crashLng);

      if (distance <= radiusFeet) {
        const dateObj = new Date(crash.crash_date);
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

        const streetNo = crash.street_no || '';
        const streetDir = crash.street_direction || '';
        const streetName = crash.street_name || '';
        const location = `${streetNo} ${streetDir} ${streetName}`.trim() || 'Unknown location';

        crashDetails.push({
          id: crash.crash_record_id,
          date: dateStr,
          time: timeStr,
          location,
          crashType: formatText(crash.first_crash_type || crash.crash_type),
          primaryCause: formatText(crash.prim_contributory_cause),
          weatherCondition: formatText(crash.weather_condition),
          lightingCondition: formatText(crash.lighting_condition),
          roadCondition: formatText(crash.roadway_surface_cond),
          speedLimit: parseInt(crash.posted_speed_limit) || 0,
          injuries: parseInt(crash.injuries_total) || 0,
          fatal: parseInt(crash.injuries_fatal) || 0,
          hitAndRun: crash.hit_and_run_i === 'Y',
          distance: Math.round(distance),
        });
      }
    }

    crashDetails.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB.getTime() - dateA.getTime();
    });

    const summary = {
      total: crashDetails.length,
      withInjuries: crashDetails.filter(c => c.injuries > 0).length,
      fatal: crashDetails.filter(c => c.fatal > 0).length,
      hitAndRun: crashDetails.filter(c => c.hitAndRun).length,
    };

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      ...summary,
      crashes: crashDetails,
      location: { latitude, longitude, radiusFeet: Math.round(radiusFeet) },
    });

  } catch (error) {
    console.error('Error fetching crash data:', error);
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

function formatText(text: string): string {
  if (!text) return 'Unknown';
  return text
    .split(' ')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
