#!/usr/bin/env ts-node
/**
 * generate-test-gpx-routes.ts
 *
 * Generates GPX files for iOS Simulator testing of camera alerts and parking
 * detection. Each GPX file represents a drive route that passes through known
 * camera locations in Chicago. Load these into Xcode's Simulator to replay
 * GPS coordinates without physically driving.
 *
 * Usage:
 *   npx ts-node scripts/generate-test-gpx-routes.ts
 *
 * Output:
 *   TicketlessChicagoMobile/ios/test-routes/*.gpx
 *
 * In Xcode:
 *   Debug → Simulate Location → Add GPX File to Project → select a .gpx file
 *   Or: Product → Scheme → Edit Scheme → Run → Options → Allow Location Simulation → pick GPX
 *
 * For Android:
 *   Enable Developer Options → Select Mock Location App → use a GPX replay app
 *   Or: `adb emu geo fix <longitude> <latitude>` in a loop
 */

import * as fs from 'fs';
import * as path from 'path';

// Inline the camera data to avoid import issues with .ts files
// We just need a few representative cameras for route generation
interface Camera {
  type: 'speed' | 'redlight';
  address: string;
  latitude: number;
  longitude: number;
  approaches: string[];
}

// Representative cameras for test routes
const TEST_CAMERAS: Camera[] = [
  // Speed cameras
  { type: 'speed', address: '6247 W Fullerton Ave', latitude: 41.9236, longitude: -87.7825, approaches: ['EB'] },
  { type: 'speed', address: '115 N Ogden Ave', latitude: 41.8832, longitude: -87.6641, approaches: ['NB', 'SB'] },
  { type: 'speed', address: '4843 W Fullerton Ave', latitude: 41.9241, longitude: -87.748, approaches: ['EB', 'WB'] },
  { type: 'speed', address: '2721 W Montrose Ave', latitude: 41.9611, longitude: -87.697, approaches: ['EB', 'WB'] },
  { type: 'speed', address: '901 N Clark St', latitude: 41.8988, longitude: -87.6313, approaches: ['SB'] },
  // Red-light cameras (first few from dataset)
  { type: 'redlight', address: 'Western & Belmont', latitude: 41.9391, longitude: -87.6876, approaches: ['NB', 'SB', 'EB', 'WB'] },
  { type: 'redlight', address: 'Ashland & Division', latitude: 41.9032, longitude: -87.6684, approaches: ['NB', 'SB', 'EB', 'WB'] },
  { type: 'redlight', address: 'Halsted & 79th', latitude: 41.7502, longitude: -87.6439, approaches: ['NB', 'SB'] },
];

const APPROACH_TO_HEADING: Record<string, number> = {
  NB: 0, NEB: 45, EB: 90, SEB: 135, SB: 180, SWB: 225, WB: 270, NWB: 315,
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

interface RoutePoint {
  lat: number;
  lon: number;
  time: Date;
  speed?: number; // m/s
}

function offsetPoint(
  lat: number, lng: number,
  bearingDeg: number, distanceMeters: number
): { lat: number; lng: number } {
  const R = 6371000;
  const bearingRad = toRad(bearingDeg);
  const latRad = toRad(lat);
  const lngRad = toRad(lng);
  const d = distanceMeters / R;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(d) +
    Math.cos(latRad) * Math.sin(d) * Math.cos(bearingRad)
  );
  const newLngRad = lngRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(newLatRad)
  );

  return {
    lat: newLatRad * (180 / Math.PI),
    lng: newLngRad * (180 / Math.PI),
  };
}

function generateApproachRoute(
  camera: Camera,
  approachDir: string,
  speedMps: number,
  intervalSec: number = 1,
  approachDistM: number = 500,
  passDistM: number = 200,
): RoutePoint[] {
  const heading = APPROACH_TO_HEADING[approachDir];
  if (heading === undefined) throw new Error(`Unknown direction: ${approachDir}`);

  const reverseHeading = (heading + 180) % 360;
  const start = offsetPoint(camera.latitude, camera.longitude, reverseHeading, approachDistM);
  const end = offsetPoint(camera.latitude, camera.longitude, heading, passDistM);

  // Calculate total distance and number of points
  const totalDistM = approachDistM + passDistM;
  const durationSec = totalDistM / speedMps;
  const numPoints = Math.ceil(durationSec / intervalSec);

  const points: RoutePoint[] = [];
  const startTime = new Date();

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const lat = start.lat + (end.lat - start.lat) * t;
    const lon = start.lng + (end.lng - start.lng) * t;
    points.push({
      lat,
      lon,
      time: new Date(startTime.getTime() + i * intervalSec * 1000),
      speed: speedMps,
    });
  }

  return points;
}

function generateParkingRoute(
  parkLat: number, parkLng: number,
  drivingSpeedMps: number = 13.4,
): RoutePoint[] {
  const points: RoutePoint[] = [];
  const startTime = new Date();
  let t = 0;

  // Phase 1: Driving (30 seconds)
  const driveStart = offsetPoint(parkLat, parkLng, 180, 400); // Start 400m south
  for (let i = 0; i < 30; i++) {
    const frac = i / 30;
    points.push({
      lat: driveStart.lat + (parkLat - driveStart.lat) * frac,
      lon: driveStart.lng + (parkLng - driveStart.lng) * frac,
      time: new Date(startTime.getTime() + t * 1000),
      speed: drivingSpeedMps,
    });
    t++;
  }

  // Phase 2: Slowing down (10 seconds)
  for (let i = 0; i < 10; i++) {
    const speed = drivingSpeedMps * (1 - i / 10);
    const nudge = offsetPoint(parkLat, parkLng, 0, (10 - i) * 2);
    points.push({
      lat: nudge.lat,
      lon: nudge.lng,
      time: new Date(startTime.getTime() + t * 1000),
      speed,
    });
    t++;
  }

  // Phase 3: Parked (60 seconds of zero speed)
  for (let i = 0; i < 60; i++) {
    points.push({
      lat: parkLat + (Math.random() - 0.5) * 0.00001, // GPS jitter
      lon: parkLng + (Math.random() - 0.5) * 0.00001,
      time: new Date(startTime.getTime() + t * 1000),
      speed: 0,
    });
    t++;
  }

  // Phase 4: Departure (30 seconds of acceleration)
  for (let i = 0; i < 30; i++) {
    const speed = (drivingSpeedMps * i) / 30;
    const departure = offsetPoint(parkLat, parkLng, 0, i * speed * 0.5);
    points.push({
      lat: departure.lat,
      lon: departure.lng,
      time: new Date(startTime.getTime() + t * 1000),
      speed,
    });
    t++;
  }

  return points;
}

function routeToGPX(points: RoutePoint[], name: string): string {
  const trackpoints = points.map(p => {
    const timeStr = p.time.toISOString();
    return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">
        <time>${timeStr}</time>${p.speed !== undefined ? `
        <speed>${p.speed.toFixed(2)}</speed>` : ''}
      </trkpt>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TicketlessChicago TestRouteGenerator"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <desc>Auto-generated test route for parking/camera detection testing</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`;
}

// ---------------------------------------------------------------------------
// Generate routes
// ---------------------------------------------------------------------------

const outputDir = path.join(__dirname, '..', 'TicketlessChicagoMobile', 'ios', 'test-routes');
fs.mkdirSync(outputDir, { recursive: true });

console.log('Generating test GPX routes...\n');

// 1. Individual camera approach routes
for (const cam of TEST_CAMERAS) {
  for (const approach of cam.approaches) {
    const speedMps = cam.type === 'speed' ? 13.4 : 8.9; // 30 mph / 20 mph
    const points = generateApproachRoute(cam, approach, speedMps);
    const safeName = cam.address.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `camera_${cam.type}_${safeName}_${approach}.gpx`;
    const gpx = routeToGPX(points, `${cam.type} camera: ${cam.address} (${approach})`);
    fs.writeFileSync(path.join(outputDir, filename), gpx);
    console.log(`  ✓ ${filename} (${points.length} points)`);
  }
}

// 2. Multi-camera drive route (drives past 3 speed cameras on Fullerton)
const multiCamRoute: RoutePoint[] = [];
const fullerton1 = TEST_CAMERAS[0]; // 6247 W Fullerton (EB)
const fullerton2 = TEST_CAMERAS[2]; // 4843 W Fullerton (EB)
const startTime = new Date();
let totalTime = 0;

// Start west of first camera, drive east past both
const routeStart = offsetPoint(fullerton1.latitude, fullerton1.longitude, 270, 800);
const routeEnd = offsetPoint(fullerton2.latitude, fullerton2.longitude, 90, 400);
const totalDist = 800 + Math.abs(fullerton2.longitude - fullerton1.longitude) * 111000 * Math.cos(toRad(41.924)) + 400;
const numPts = Math.ceil(totalDist / 13.4); // 1 point per second at 30 mph

for (let i = 0; i <= numPts; i++) {
  const frac = i / numPts;
  multiCamRoute.push({
    lat: routeStart.lat + (routeEnd.lat - routeStart.lat) * frac,
    lon: routeStart.lng + (routeEnd.lng - routeStart.lng) * frac,
    time: new Date(startTime.getTime() + i * 1000),
    speed: 13.4,
  });
}
fs.writeFileSync(
  path.join(outputDir, 'multi_camera_fullerton_EB.gpx'),
  routeToGPX(multiCamRoute, 'Multi-camera: Fullerton Ave EB (3 cameras)')
);
console.log(`  ✓ multi_camera_fullerton_EB.gpx (${multiCamRoute.length} points)`);

// 3. Parking detection route (drive → park → depart)
const parkingRoute = generateParkingRoute(41.9236, -87.7825); // Near Fullerton cam
fs.writeFileSync(
  path.join(outputDir, 'parking_drive_park_depart.gpx'),
  routeToGPX(parkingRoute, 'Parking test: drive → park → depart')
);
console.log(`  ✓ parking_drive_park_depart.gpx (${parkingRoute.length} points)`);

// 4. Slow crawl route (tests red-light at low speed)
const slowRoute = generateApproachRoute(TEST_CAMERAS[6], 'NB', 3.0, 1, 300, 100);
fs.writeFileSync(
  path.join(outputDir, 'slow_crawl_redlight_NB.gpx'),
  routeToGPX(slowRoute, 'Slow crawl past red-light camera (NB)')
);
console.log(`  ✓ slow_crawl_redlight_NB.gpx (${slowRoute.length} points)`);

// 5. Wrong direction route (should NOT alert)
const wrongDirRoute = generateApproachRoute(TEST_CAMERAS[0], 'EB', 13.4);
// Reverse all points to simulate driving WB past an EB-only camera
const reversedRoute = [...wrongDirRoute].reverse().map((p, i) => ({
  ...p,
  time: new Date(startTime.getTime() + i * 1000),
}));
fs.writeFileSync(
  path.join(outputDir, 'wrong_direction_WB_past_EB_camera.gpx'),
  routeToGPX(reversedRoute, 'Wrong direction: WB past EB-only speed camera (should NOT alert)')
);
console.log(`  ✓ wrong_direction_WB_past_EB_camera.gpx (${reversedRoute.length} points)`);

console.log(`\nGenerated ${fs.readdirSync(outputDir).filter(f => f.endsWith('.gpx')).length} GPX files in:`);
console.log(`  ${outputDir}\n`);
console.log('To use in iOS Simulator:');
console.log('  1. Open Xcode → Debug → Simulate Location → Add GPX File');
console.log('  2. Select a .gpx file from the test-routes/ directory');
console.log('  3. Run the app in Simulator — GPS will follow the route\n');
console.log('To use on Android:');
console.log('  1. Enable Developer Options → Mock Location');
console.log('  2. Use a GPX replay app or adb geo commands');
