import type { NextApiRequest, NextApiResponse } from 'next';
import { RED_LIGHT_CAMERAS } from '../../../lib/red-light-cameras';

// Speed camera data from Chicago Data Portal
const SPEED_CAMERAS = [
  { id: "195", address: "3450 W 71st St", latitude: 41.7644, longitude: -87.7097 },
  { id: "232", address: "6247 W Fullerton Ave", latitude: 41.9236, longitude: -87.7825 },
  { id: "233", address: "6250 W Fullerton Ave", latitude: 41.9238, longitude: -87.7826 },
  { id: "227", address: "5509 W Fullerton Ave", latitude: 41.9239, longitude: -87.7639 },
  { id: "226", address: "5446 W Fullerton Ave", latitude: 41.9241, longitude: -87.763 },
  { id: "243", address: "4843 W Fullerton Ave", latitude: 41.9241, longitude: -87.748 },
  { id: "242", address: "3843 W 111th St", latitude: 41.6912, longitude: -87.7172 },
  { id: "213", address: "6523 N Western Ave", latitude: 42.0003, longitude: -87.6898 },
  { id: "239", address: "4433 N Western Ave", latitude: 41.9623, longitude: -87.6886 },
  { id: "228", address: "7739 S Western Ave", latitude: 41.7526, longitude: -87.6828 },
  { id: "229", address: "7738 S Western Ave", latitude: 41.75269, longitude: -87.6831 },
  { id: "231", address: "2550 W 79th St", latitude: 41.7502, longitude: -87.6874 },
  { id: "217", address: "5529 S Western Ave", latitude: 41.79249, longitude: -87.6839 },
  { id: "218", address: "5530 S Western Ave", latitude: 41.7925, longitude: -87.6835 },
  { id: "203", address: "4350 S Western Ave", latitude: 41.81627, longitude: -87.6844 },
  { id: "204", address: "4355 S Western Ave", latitude: 41.81618, longitude: -87.6847 },
  { id: "205", address: "4701 S Western Ave", latitude: 41.80857, longitude: -87.6845 },
  { id: "206", address: "4706 S Western Ave", latitude: 41.8086, longitude: -87.6848 },
  { id: "209", address: "3945 W Chicago Ave", latitude: 41.89526, longitude: -87.7256 },
  { id: "210", address: "3948 W Chicago Ave", latitude: 41.89534, longitude: -87.7258 },
  { id: "230", address: "2553 W 79th St", latitude: 41.75021, longitude: -87.6877 },
  { id: "220", address: "115 N Pulaski Rd", latitude: 41.88252, longitude: -87.7271 },
  { id: "221", address: "130 N Pulaski Rd", latitude: 41.88286, longitude: -87.7274 },
  { id: "222", address: "3146 W Lawrence Ave", latitude: 41.9682, longitude: -87.7068 },
  { id: "223", address: "3147 W Lawrence Ave", latitude: 41.96817, longitude: -87.7067 },
  { id: "224", address: "8900 S Stony Island Ave", latitude: 41.73266, longitude: -87.5859 },
  { id: "225", address: "8901 S Stony Island Ave", latitude: 41.73266, longitude: -87.5862 },
  { id: "234", address: "4500 S Cicero Ave", latitude: 41.81238, longitude: -87.7462 },
  { id: "235", address: "4501 S Cicero Ave", latitude: 41.81247, longitude: -87.7465 },
  { id: "236", address: "8359 S Pulaski Rd", latitude: 41.74368, longitude: -87.7232 },
  { id: "237", address: "8360 S Pulaski Rd", latitude: 41.74367, longitude: -87.7235 },
  { id: "238", address: "4434 N Western Ave", latitude: 41.96234, longitude: -87.6889 },
  { id: "240", address: "3215 N Ashland Ave", latitude: 41.93919, longitude: -87.6686 },
  { id: "241", address: "3220 N Ashland Ave", latitude: 41.93911, longitude: -87.6689 },
  { id: "244", address: "8158 S Kedzie Ave", latitude: 41.74697, longitude: -87.7037 },
  { id: "245", address: "8159 S Kedzie Ave", latitude: 41.74696, longitude: -87.704 },
  { id: "246", address: "1849 N Cicero Ave", latitude: 41.91406, longitude: -87.7461 },
  { id: "247", address: "1850 N Cicero Ave", latitude: 41.91408, longitude: -87.7463 },
  { id: "248", address: "5730 W Division St", latitude: 41.90278, longitude: -87.7725 },
  { id: "249", address: "5731 W Division St", latitude: 41.9028, longitude: -87.7727 },
  { id: "250", address: "3158 W Peterson Ave", latitude: 41.99014, longitude: -87.7063 },
  { id: "251", address: "3159 W Peterson Ave", latitude: 41.99015, longitude: -87.7065 },
  { id: "252", address: "3601 W 26th St", latitude: 41.84455, longitude: -87.7156 },
  { id: "253", address: "3602 W 26th St", latitude: 41.84454, longitude: -87.7158 },
  { id: "254", address: "5400 S Pulaski Rd", latitude: 41.79578, longitude: -87.7236 },
  { id: "255", address: "5401 S Pulaski Rd", latitude: 41.79579, longitude: -87.7238 },
  { id: "256", address: "5901 W Madison St", latitude: 41.88032, longitude: -87.7738 },
  { id: "257", address: "5902 W Madison St", latitude: 41.88033, longitude: -87.774 },
  { id: "258", address: "4200 W 63rd St", latitude: 41.77917, longitude: -87.7314 },
  { id: "259", address: "4201 W 63rd St", latitude: 41.77918, longitude: -87.7316 },
];

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
    const radiusFeet = radiusMiles * 5280;

    // Find nearby speed cameras
    const nearbySpeedCameras = SPEED_CAMERAS
      .map(cam => ({
        ...cam,
        distance: haversineDistanceFeet(latitude, longitude, cam.latitude, cam.longitude),
        type: 'speed'
      }))
      .filter(cam => cam.distance <= radiusFeet)
      .sort((a, b) => a.distance - b.distance);

    // Find nearby red light cameras
    const nearbyRedLightCameras = RED_LIGHT_CAMERAS
      .map(cam => ({
        id: cam.intersection,
        address: cam.intersection,
        latitude: cam.latitude,
        longitude: cam.longitude,
        distance: haversineDistanceFeet(latitude, longitude, cam.latitude, cam.longitude),
        type: 'redlight'
      }))
      .filter(cam => cam.distance <= radiusFeet)
      .sort((a, b) => a.distance - b.distance);

    const total = nearbySpeedCameras.length + nearbyRedLightCameras.length;

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      total,
      speed: nearbySpeedCameras.length,
      redLight: nearbyRedLightCameras.length,
      speedCameras: nearbySpeedCameras.slice(0, 10),
      redLightCameras: nearbyRedLightCameras.slice(0, 10),
      location: { latitude, longitude, radiusFeet: Math.round(radiusFeet) },
    });

  } catch (error) {
    console.error('Error fetching camera data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

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
