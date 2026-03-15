#!/usr/bin/env npx tsx
/**
 * Camera Alert Simulation Test
 *
 * Simulates driving past all 510 Chicago cameras from every approach direction.
 * For each camera + approach combination, generates a simulated GPS track
 * approaching the camera from 400m away at 35 mph, steps toward it in 30m
 * increments, and verifies the detection pipeline would fire an alert.
 *
 * This replicates the EXACT detection logic from CameraAlertService.ts:
 *   1. Bounding box pre-filter (BBOX_DEGREES = 0.0025)
 *   2. Haversine distance check (alertRadius = speed * 10, clamped 150-250m)
 *   3. Heading match (±45° tolerance)
 *   4. Bearing-ahead filter (camera must be within ±30° cone ahead)
 *
 * Usage:
 *   npx tsx scripts/test-camera-alerts.ts              # Run all cameras
 *   npx tsx scripts/test-camera-alerts.ts --verbose     # Show each step
 *   npx tsx scripts/test-camera-alerts.ts --failures    # Only show failures
 *   npx tsx scripts/test-camera-alerts.ts --camera 42   # Test camera index 42
 */

// ---------------------------------------------------------------------------
// Camera data — imported directly from the app
// ---------------------------------------------------------------------------
import path from 'path';

// We can't import .ts with React Native types, so read the raw data
const camerasPath = path.resolve(__dirname, '../TicketlessChicagoMobile/src/data/chicago-cameras.ts');
const fs = require('fs');
const cameraFileContent = fs.readFileSync(camerasPath, 'utf-8');

interface CameraLocation {
  type: 'speed' | 'redlight';
  address: string;
  latitude: number;
  longitude: number;
  approaches: string[];
  speedLimitMph?: number;
}

// Parse camera data from the TS file
function parseCameras(): CameraLocation[] {
  // Extract the array content between the first [ and last ];
  const match = cameraFileContent.match(/const RAW_CHICAGO_CAMERAS:\s*CameraLocation\[\]\s*=\s*\[([\s\S]*?)\];/);
  if (!match) throw new Error('Could not find RAW_CHICAGO_CAMERAS array in camera data file');
  const arrayContent = match[1];

  // Parse each camera entry
  const cameras: CameraLocation[] = [];
  const entryRegex = /\{\s*type:\s*"(speed|redlight)",\s*address:\s*"([^"]+)",\s*latitude:\s*([\d.-]+),\s*longitude:\s*([\d.-]+),\s*approaches:\s*\[([^\]]*)\](?:,\s*speedLimitMph:\s*(\d+))?\s*\}/g;
  let m;
  while ((m = entryRegex.exec(arrayContent)) !== null) {
    cameras.push({
      type: m[1] as 'speed' | 'redlight',
      address: m[2],
      latitude: parseFloat(m[3]),
      longitude: parseFloat(m[4]),
      approaches: m[5] ? m[5].replace(/"/g, '').split(',').map(s => s.trim()).filter(Boolean) : [],
      ...(m[6] ? { speedLimitMph: parseInt(m[6]) } : {}),
    });
  }
  return cameras;
}

// Also check for the deduplication logic at the bottom of the file
function parseDeduplication(): { deduped: boolean; count?: number } {
  if (cameraFileContent.includes('CHICAGO_CAMERAS')) {
    const dedupeMatch = cameraFileContent.match(/export const CHICAGO_CAMERAS/);
    if (dedupeMatch) {
      return { deduped: true };
    }
  }
  return { deduped: false };
}

// ---------------------------------------------------------------------------
// Detection constants — must match CameraAlertService.ts EXACTLY
// ---------------------------------------------------------------------------
const BASE_ALERT_RADIUS_METERS = 150;
const MAX_ALERT_RADIUS_METERS = 250;
const TARGET_WARNING_SECONDS = 10;
const BBOX_DEGREES = 0.0025;
const HEADING_TOLERANCE_DEGREES = 45;
const MAX_BEARING_OFF_HEADING_DEGREES = 30;
const MIN_SPEED_SPEED_CAM_MPS = 3.2;
const MIN_SPEED_REDLIGHT_MPS = 1.0;
const EARTH_RADIUS_METERS = 6371000;
const HEADING_BUFFER_SIZE = 5;

// Speed-adaptive tolerance functions — match CameraAlertService.ts
function getHeadingTolerance(speed: number): number {
  if (speed < 0) return HEADING_TOLERANCE_DEGREES;
  if (speed < 5.0) return 75;
  if (speed < 8.0) return 60;
  return HEADING_TOLERANCE_DEGREES;
}

function getBearingTolerance(speed: number): number {
  if (speed < 0) return MAX_BEARING_OFF_HEADING_DEGREES;
  if (speed < 5.0) return 50;
  if (speed < 8.0) return 40;
  return MAX_BEARING_OFF_HEADING_DEGREES;
}

// Heading smoothing — circular mean of buffered headings
function smoothHeading(buffer: number[], rawHeading: number): number {
  if (rawHeading < 0) return rawHeading;
  buffer.push(rawHeading);
  while (buffer.length > HEADING_BUFFER_SIZE) buffer.shift();
  if (buffer.length < 2) return rawHeading;
  let sinSum = 0, cosSum = 0;
  for (const h of buffer) {
    sinSum += Math.sin(toRad(h));
    cosSum += Math.cos(toRad(h));
  }
  const mean = ((Math.atan2(sinSum / buffer.length, cosSum / buffer.length) * 180 / Math.PI) + 360) % 360;
  return mean;
}

const APPROACH_TO_HEADING: Record<string, number> = {
  NB: 0,
  NEB: 45,
  EB: 90,
  SEB: 135,
  SB: 180,
  SWB: 225,
  WB: 270,
  NWB: 315,
};

// ---------------------------------------------------------------------------
// Geo utilities — exact copies from the app
// ---------------------------------------------------------------------------
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function bearingTo(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  const bearingRad = Math.atan2(y, x);
  return ((bearingRad * 180) / Math.PI + 360) % 360;
}

function isHeadingMatch(heading: number, approaches: string[], tolerance: number = HEADING_TOLERANCE_DEGREES): boolean {
  if (heading < 0) return true;
  if (approaches.length === 0) return true;
  for (const approach of approaches) {
    const targetHeading = APPROACH_TO_HEADING[approach];
    if (targetHeading === undefined) return true;
    let diff = Math.abs(heading - targetHeading);
    if (diff > 180) diff = 360 - diff;
    if (diff <= tolerance) return true;
  }
  return false;
}

function isCameraAhead(userLat: number, userLng: number, camLat: number, camLng: number, heading: number, bearingTolerance: number = MAX_BEARING_OFF_HEADING_DEGREES): boolean {
  if (heading < 0) return true;
  const bearing = bearingTo(userLat, userLng, camLat, camLng);
  let diff = Math.abs(heading - bearing);
  if (diff > 180) diff = 360 - diff;
  return diff <= bearingTolerance;
}

function getAlertRadius(speed: number): number {
  if (speed < 0) return BASE_ALERT_RADIUS_METERS;
  const dynamicRadius = speed * TARGET_WARNING_SECONDS;
  return Math.max(BASE_ALERT_RADIUS_METERS, Math.min(dynamicRadius, MAX_ALERT_RADIUS_METERS));
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Given a camera position and an approach heading, compute a start point
 * ~startDistanceM meters away in the OPPOSITE direction (i.e., the driver
 * hasn't reached the camera yet and is traveling toward it).
 */
function computeStartPoint(
  camLat: number,
  camLng: number,
  approachHeading: number,
  startDistanceM: number
): { lat: number; lng: number } {
  // The driver is approaching FROM the opposite direction
  const reverseHeading = (approachHeading + 180) % 360;
  const R = EARTH_RADIUS_METERS;
  const d = startDistanceM / R;
  const brng = toRad(reverseHeading);
  const lat1 = toRad(camLat);
  const lng1 = toRad(camLng);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 =
    lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

interface SimulationStep {
  stepNum: number;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  distToCamera: number;
  alertRadius: number;
  inBbox: boolean;
  inRadius: boolean;
  headingMatch: boolean;
  cameraAhead: boolean;
  wouldAlert: boolean;
  rejectReason?: string;
}

interface SimulationResult {
  cameraIndex: number;
  camera: CameraLocation;
  approach: string;
  approachHeading: number;
  steps: SimulationStep[];
  alertFired: boolean;
  alertDistance?: number;
  alertStepNum?: number;
  failReason?: string;
}

function simulateApproach(
  cameras: CameraLocation[],
  cameraIndex: number,
  approach: string,
  speedMps: number = 15.6, // 35 mph
  startDistanceM: number = 400,
  stepSizeM: number = 25,
  verbose: boolean = false,
): SimulationResult {
  const camera = cameras[cameraIndex];
  const approachHeading = APPROACH_TO_HEADING[approach];
  if (approachHeading === undefined) {
    return {
      cameraIndex,
      camera,
      approach,
      approachHeading: -1,
      steps: [],
      alertFired: false,
      failReason: `Unknown approach code: ${approach}`,
    };
  }

  const alertRadius = getAlertRadius(speedMps);
  const startPoint = computeStartPoint(camera.latitude, camera.longitude, approachHeading, startDistanceM);

  const steps: SimulationStep[] = [];
  let alertFired = false;
  let alertDistance: number | undefined;
  let alertStepNum: number | undefined;

  // Step toward the camera
  const totalSteps = Math.ceil(startDistanceM / stepSizeM) + 5; // overshoot past camera
  for (let s = 0; s <= totalSteps; s++) {
    // Interpolate position along the approach line
    const fraction = (s * stepSizeM) / startDistanceM;
    const lat = startPoint.lat + (camera.latitude - startPoint.lat) * fraction;
    const lng = startPoint.lng + (camera.longitude - startPoint.lng) * fraction;

    const distToCamera = distanceMeters(lat, lng, camera.latitude, camera.longitude);

    // Bounding box check
    const latMin = lat - BBOX_DEGREES;
    const latMax = lat + BBOX_DEGREES;
    const lngMin = lng - BBOX_DEGREES;
    const lngMax = lng + BBOX_DEGREES;
    const inBbox =
      camera.latitude >= latMin && camera.latitude <= latMax &&
      camera.longitude >= lngMin && camera.longitude <= lngMax;

    // Distance check
    const inRadius = distToCamera <= alertRadius;

    // Heading match
    const headingMatch = isHeadingMatch(approachHeading, camera.approaches);

    // Bearing-ahead check
    const cameraAhead = isCameraAhead(lat, lng, camera.latitude, camera.longitude, approachHeading);

    // Would alert?
    const wouldAlert = inBbox && inRadius && headingMatch && cameraAhead;

    let rejectReason: string | undefined;
    if (!wouldAlert) {
      if (!inBbox) rejectReason = 'outside_bbox';
      else if (!inRadius) rejectReason = 'outside_radius';
      else if (!headingMatch) rejectReason = 'heading_mismatch';
      else if (!cameraAhead) rejectReason = 'camera_not_ahead';
    }

    const step: SimulationStep = {
      stepNum: s,
      lat,
      lng,
      heading: approachHeading,
      speed: speedMps,
      distToCamera,
      alertRadius,
      inBbox,
      inRadius,
      headingMatch,
      cameraAhead,
      wouldAlert,
      rejectReason,
    };
    steps.push(step);

    if (wouldAlert && !alertFired) {
      alertFired = true;
      alertDistance = distToCamera;
      alertStepNum = s;
    }

    // Stop if we've passed the camera by a lot
    if (distToCamera < 10 && s > 5) break;
  }

  let failReason: string | undefined;
  if (!alertFired) {
    // Find the closest step where the camera was in bbox but didn't alert
    const closestInBbox = steps.filter(s => s.inBbox).sort((a, b) => a.distToCamera - b.distToCamera);
    if (closestInBbox.length === 0) {
      failReason = 'Never entered bounding box';
    } else {
      const closest = closestInBbox[0];
      if (!closest.inRadius) {
        failReason = `Closest distance ${closest.distToCamera.toFixed(0)}m > alertRadius ${alertRadius.toFixed(0)}m`;
      } else if (!closest.headingMatch) {
        failReason = `Heading ${closest.heading}° doesn't match approaches [${camera.approaches.join(',')}]`;
      } else if (!closest.cameraAhead) {
        const bearing = bearingTo(closest.lat, closest.lng, camera.latitude, camera.longitude);
        let diff = Math.abs(closest.heading - bearing);
        if (diff > 180) diff = 360 - diff;
        failReason = `Camera not ahead: bearing=${bearing.toFixed(0)}° heading=${closest.heading}° diff=${diff.toFixed(0)}° (max ±${MAX_BEARING_OFF_HEADING_DEGREES}°)`;
      } else {
        failReason = 'Unknown reason';
      }
    }
  }

  return {
    cameraIndex,
    camera,
    approach,
    approachHeading,
    steps,
    alertFired,
    alertDistance,
    alertStepNum,
    failReason,
  };
}

// ---------------------------------------------------------------------------
// Speed filter validation
// ---------------------------------------------------------------------------
interface SpeedFilterResult {
  cameraIndex: number;
  camera: CameraLocation;
  testSpeed: number;
  minRequired: number;
  shouldAlert: boolean;
  label: string;
}

function testSpeedFilters(cameras: CameraLocation[]): SpeedFilterResult[] {
  const results: SpeedFilterResult[] = [];

  // Test edge cases for each camera type
  const speedTestCases = [
    { speed: 0, label: 'standing still' },
    { speed: 0.5, label: '~1 mph (slow walk)' },
    { speed: 1.0, label: '~2.2 mph (walk)' },
    { speed: 1.5, label: '~3.4 mph (brisk walk)' },
    { speed: 3.0, label: '~6.7 mph (jogging)' },
    { speed: 3.2, label: '~7 mph (speed cam threshold)' },
    { speed: 5.0, label: '~11 mph (slow driving)' },
    { speed: 13.4, label: '~30 mph' },
  ];

  // Test first speed camera and first redlight camera
  const firstSpeed = cameras.findIndex(c => c.type === 'speed');
  const firstRedlight = cameras.findIndex(c => c.type === 'redlight');

  for (const tc of speedTestCases) {
    if (firstSpeed >= 0) {
      const minRequired = MIN_SPEED_SPEED_CAM_MPS;
      results.push({
        cameraIndex: firstSpeed,
        camera: cameras[firstSpeed],
        testSpeed: tc.speed,
        minRequired,
        shouldAlert: tc.speed >= minRequired,
        label: tc.label,
      });
    }
    if (firstRedlight >= 0) {
      const minRequired = MIN_SPEED_REDLIGHT_MPS;
      results.push({
        cameraIndex: firstRedlight,
        camera: cameras[firstRedlight],
        testSpeed: tc.speed,
        minRequired,
        shouldAlert: tc.speed >= minRequired,
        label: tc.label,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const failuresOnly = args.includes('--failures');
  const cameraArgIdx = args.indexOf('--camera');
  const singleCameraIdx = cameraArgIdx >= 0 ? parseInt(args[cameraArgIdx + 1]) : -1;

  console.log('========================================');
  console.log('  Camera Alert Simulation Test');
  console.log('========================================\n');

  // Parse cameras
  const cameras = parseCameras();
  console.log(`Loaded ${cameras.length} cameras from chicago-cameras.ts`);

  const speedCount = cameras.filter(c => c.type === 'speed').length;
  const redlightCount = cameras.filter(c => c.type === 'redlight').length;
  console.log(`  Speed cameras: ${speedCount}`);
  console.log(`  Red light cameras: ${redlightCount}`);

  // Validate approaches
  const unknownApproaches = new Set<string>();
  for (const cam of cameras) {
    for (const a of cam.approaches) {
      if (APPROACH_TO_HEADING[a] === undefined) {
        unknownApproaches.add(a);
      }
    }
  }
  if (unknownApproaches.size > 0) {
    console.log(`\n  WARNING: Unknown approach codes: ${[...unknownApproaches].join(', ')}`);
    console.log('  These cameras will fail-open (always alert)');
  }

  const noApproachCameras = cameras.filter(c => c.approaches.length === 0);
  if (noApproachCameras.length > 0) {
    console.log(`\n  WARNING: ${noApproachCameras.length} cameras have no approach data`);
  }

  // ========================================================================
  // Test 1: Approach simulation for all cameras
  // ========================================================================
  console.log('\n----------------------------------------');
  console.log('  Test 1: Approach simulation');
  console.log('  Speed: 35 mph (15.6 m/s), step: 25m');
  console.log('----------------------------------------\n');

  const results: SimulationResult[] = [];
  const startIdx = singleCameraIdx >= 0 ? singleCameraIdx : 0;
  const endIdx = singleCameraIdx >= 0 ? singleCameraIdx + 1 : cameras.length;

  for (let i = startIdx; i < endIdx; i++) {
    const cam = cameras[i];
    if (cam.approaches.length === 0) {
      // Camera with no approaches — test from all 4 cardinal directions
      for (const dir of ['NB', 'EB', 'SB', 'WB']) {
        const result = simulateApproach(cameras, i, dir, 15.6, 400, 25, verbose);
        results.push(result);
      }
    } else {
      for (const approach of cam.approaches) {
        const result = simulateApproach(cameras, i, approach, 15.6, 400, 25, verbose);
        results.push(result);
      }
    }
  }

  // Aggregate results
  const passed = results.filter(r => r.alertFired);
  const failed = results.filter(r => !r.alertFired);

  // Print results
  if (!failuresOnly) {
    for (const r of passed) {
      console.log(
        `  PASS  [${r.cameraIndex.toString().padStart(3)}] ${r.camera.type.padEnd(8)} ${r.approach.padEnd(3)} ` +
        `${r.camera.address.padEnd(35)} alert@${r.alertDistance!.toFixed(0)}m (radius=${getAlertRadius(15.6).toFixed(0)}m)`
      );
    }
  }

  for (const r of failed) {
    console.log(
      `  FAIL  [${r.cameraIndex.toString().padStart(3)}] ${r.camera.type.padEnd(8)} ${r.approach.padEnd(3)} ` +
      `${r.camera.address.padEnd(35)} ${r.failReason}`
    );

    if (verbose) {
      console.log(`    Camera: ${r.camera.latitude.toFixed(5)}, ${r.camera.longitude.toFixed(5)}`);
      console.log(`    Approach heading: ${r.approachHeading}° (${r.approach})`);
      console.log(`    Steps:`);
      for (const s of r.steps) {
        if (s.inBbox || s.distToCamera < 300) {
          console.log(
            `      step ${s.stepNum.toString().padStart(2)}: dist=${s.distToCamera.toFixed(0).padStart(4)}m ` +
            `bbox=${s.inBbox ? 'Y' : 'N'} radius=${s.inRadius ? 'Y' : 'N'} ` +
            `heading=${s.headingMatch ? 'Y' : 'N'} ahead=${s.cameraAhead ? 'Y' : 'N'} ` +
            `${s.rejectReason || 'ALERT!'}`
          );
        }
      }
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('  Results Summary');
  console.log('========================================');
  console.log(`  Total approach scenarios: ${results.length}`);
  console.log(`  Passed (alert fires):     ${passed.length} (${(passed.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  Failed (no alert):        ${failed.length} (${(failed.length / results.length * 100).toFixed(1)}%)`);

  if (failed.length > 0) {
    // Breakdown by failure reason
    const reasonCounts: Record<string, number> = {};
    for (const r of failed) {
      const reason = r.failReason?.split(':')[0] || 'Unknown';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    console.log('\n  Failure breakdown:');
    for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason}: ${count}`);
    }

    // Show unique cameras that failed
    const uniqueFailedCameras = new Set(failed.map(r => r.cameraIndex));
    console.log(`\n  Unique cameras with at least one failing approach: ${uniqueFailedCameras.size}`);
  }

  // Alert distance statistics
  const alertDistances = passed.map(r => r.alertDistance!).sort((a, b) => a - b);
  if (alertDistances.length > 0) {
    const median = alertDistances[Math.floor(alertDistances.length / 2)];
    const min = alertDistances[0];
    const max = alertDistances[alertDistances.length - 1];
    const avg = alertDistances.reduce((sum, d) => sum + d, 0) / alertDistances.length;
    console.log('\n  Alert distance stats (meters):');
    console.log(`    Min:    ${min.toFixed(0)}m`);
    console.log(`    Median: ${median.toFixed(0)}m`);
    console.log(`    Avg:    ${avg.toFixed(0)}m`);
    console.log(`    Max:    ${max.toFixed(0)}m`);

    // Warning time at 35 mph
    const avgWarningTime = avg / 15.6;
    const minWarningTime = min / 15.6;
    console.log(`    Avg warning: ${avgWarningTime.toFixed(1)}s at 35 mph`);
    console.log(`    Min warning: ${minWarningTime.toFixed(1)}s at 35 mph`);
  }

  // ========================================================================
  // Test 2: Speed filter validation
  // ========================================================================
  console.log('\n----------------------------------------');
  console.log('  Test 2: Speed filter validation');
  console.log('----------------------------------------\n');

  const speedResults = testSpeedFilters(cameras);
  let speedTestPass = 0;
  let speedTestFail = 0;

  for (const sr of speedResults) {
    const icon = sr.shouldAlert ? 'ALERT' : 'SKIP ';
    const typeLabel = sr.camera.type.padEnd(8);
    const speedLabel = `${sr.testSpeed.toFixed(1)} m/s (${sr.label})`.padEnd(35);
    const threshold = `min=${sr.minRequired.toFixed(1)} m/s`;

    // Verify the threshold is correct
    const expectedMin = sr.camera.type === 'speed' ? MIN_SPEED_SPEED_CAM_MPS : MIN_SPEED_REDLIGHT_MPS;
    const thresholdCorrect = sr.minRequired === expectedMin;
    const shouldAlertCorrect = sr.shouldAlert === (sr.testSpeed >= expectedMin);

    if (thresholdCorrect && shouldAlertCorrect) {
      speedTestPass++;
      if (!failuresOnly) {
        console.log(`  PASS  ${typeLabel} ${icon} @ ${speedLabel} ${threshold}`);
      }
    } else {
      speedTestFail++;
      console.log(`  FAIL  ${typeLabel} ${icon} @ ${speedLabel} ${threshold} (expected min=${expectedMin})`);
    }
  }

  console.log(`\n  Speed filter tests: ${speedTestPass} passed, ${speedTestFail} failed`);

  // ========================================================================
  // Test 3: Multi-speed approach test (representative camera)
  // ========================================================================
  console.log('\n----------------------------------------');
  console.log('  Test 3: Alert radius vs speed');
  console.log('----------------------------------------\n');

  const testSpeeds = [
    { mps: 5.0,  label: '11 mph' },
    { mps: 8.9,  label: '20 mph' },
    { mps: 13.4, label: '30 mph' },
    { mps: 15.6, label: '35 mph' },
    { mps: 20.1, label: '45 mph' },
    { mps: 26.8, label: '60 mph' },
  ];

  // Pick a camera with a simple approach
  const testCamIdx = cameras.findIndex(c => c.type === 'speed' && c.approaches.length === 1);
  if (testCamIdx >= 0) {
    const testCam = cameras[testCamIdx];
    console.log(`  Test camera: [${testCamIdx}] ${testCam.address} (${testCam.approaches.join(',')})`);
    console.log();

    for (const ts of testSpeeds) {
      const expectedRadius = getAlertRadius(ts.mps);
      const result = simulateApproach(cameras, testCamIdx, testCam.approaches[0], ts.mps, 400, 15);
      const status = result.alertFired ? 'PASS' : 'FAIL';
      const alertDist = result.alertFired ? `${result.alertDistance!.toFixed(0)}m` : 'N/A';
      const warningTime = result.alertFired ? `${(result.alertDistance! / ts.mps).toFixed(1)}s` : 'N/A';
      console.log(
        `  ${status}  ${ts.label.padEnd(8)} (${ts.mps.toFixed(1)} m/s) ` +
        `radius=${expectedRadius.toFixed(0).padStart(3)}m ` +
        `alert@${alertDist.padStart(5)} ` +
        `warning=${warningTime.padStart(5)}`
      );
    }
  }

  // ========================================================================
  // Test 4: Heading edge cases
  // ========================================================================
  console.log('\n----------------------------------------');
  console.log('  Test 4: Heading edge cases');
  console.log('  (±45° tolerance around approach)');
  console.log('----------------------------------------\n');

  // Test NB camera (0°) with various headings
  const nbCamIdx = cameras.findIndex(c => c.approaches.includes('NB') && c.approaches.length === 1);
  if (nbCamIdx >= 0) {
    const nbCam = cameras[nbCamIdx];
    console.log(`  Test camera: [${nbCamIdx}] ${nbCam.address} (NB → target 0°)`);

    const headingTests = [
      { heading: 0,   expect: true,  label: 'exact NB' },
      { heading: 44,  expect: true,  label: '44° (within tolerance)' },
      { heading: 45,  expect: true,  label: '45° (at boundary)' },
      { heading: 46,  expect: false, label: '46° (outside tolerance)' },
      { heading: 90,  expect: false, label: '90° (eastbound)' },
      { heading: 315, expect: true,  label: '315° (just within via wrap)' },
      { heading: 314, expect: false, label: '314° (outside via wrap)' },
      { heading: 180, expect: false, label: '180° (southbound, opposite)' },
    ];

    for (const ht of headingTests) {
      const match = isHeadingMatch(ht.heading, ['NB']);
      const correct = match === ht.expect;
      const status = correct ? 'PASS' : 'FAIL';
      const matchStr = match ? 'MATCH' : 'NO   ';
      console.log(`  ${status}  heading=${ht.heading.toString().padStart(3)}°  ${matchStr}  ${ht.label}`);
    }
  }

  // ========================================================================
  // Test 5: Bearing-ahead edge cases
  // ========================================================================
  console.log('\n----------------------------------------');
  console.log('  Test 5: Bearing-ahead (camera in ±30° cone)');
  console.log('----------------------------------------\n');

  // Create synthetic test: place a camera 100m ahead and to the side
  const baseLat = 41.9;
  const baseLng = -87.7;
  const testHeading = 0; // NB

  // Camera directly ahead (should pass)
  const aheadCam = computeStartPoint(baseLat, baseLng, (testHeading + 180) % 360, 100);
  const aheadResult = isCameraAhead(baseLat, baseLng, aheadCam.lat, aheadCam.lng, testHeading);
  console.log(`  ${aheadResult ? 'PASS' : 'FAIL'}  Camera 100m directly ahead: ${aheadResult ? 'AHEAD' : 'NOT AHEAD'} (expected: AHEAD)`);

  // Camera 25° off heading (should pass)
  const off25 = computeStartPoint(baseLat, baseLng, (testHeading + 180 + 25) % 360, 100);
  const off25Result = isCameraAhead(baseLat, baseLng, off25.lat, off25.lng, testHeading);
  console.log(`  ${off25Result ? 'PASS' : 'FAIL'}  Camera 100m, 25° off heading: ${off25Result ? 'AHEAD' : 'NOT AHEAD'} (expected: AHEAD)`);

  // Camera 29° off heading (just within ±30° cone)
  const off29 = computeStartPoint(baseLat, baseLng, (testHeading + 180 + 29) % 360, 100);
  const bearingOff29 = bearingTo(baseLat, baseLng, off29.lat, off29.lng);
  let diff29 = Math.abs(testHeading - bearingOff29);
  if (diff29 > 180) diff29 = 360 - diff29;
  const off29Result = isCameraAhead(baseLat, baseLng, off29.lat, off29.lng, testHeading);
  console.log(`  ${off29Result ? 'PASS' : 'FAIL'}  Camera 100m, ~29° off heading: ${off29Result ? 'AHEAD' : 'NOT AHEAD'} (bearing diff=${diff29.toFixed(1)}°, expected: AHEAD)`);

  // Camera 45° off heading (should fail)
  const off45 = computeStartPoint(baseLat, baseLng, (testHeading + 180 + 45) % 360, 100);
  const off45Result = isCameraAhead(baseLat, baseLng, off45.lat, off45.lng, testHeading);
  console.log(`  ${!off45Result ? 'PASS' : 'FAIL'}  Camera 100m, 45° off heading: ${off45Result ? 'AHEAD' : 'NOT AHEAD'} (expected: NOT AHEAD)`);

  // Camera 90° off heading (parallel street, should fail)
  const off90 = computeStartPoint(baseLat, baseLng, (testHeading + 180 + 90) % 360, 100);
  const off90Result = isCameraAhead(baseLat, baseLng, off90.lat, off90.lng, testHeading);
  console.log(`  ${!off90Result ? 'PASS' : 'FAIL'}  Camera 100m, 90° off heading: ${off90Result ? 'AHEAD' : 'NOT AHEAD'} (expected: NOT AHEAD, parallel street)`);

  // Camera directly behind (should fail)
  const behind = computeStartPoint(baseLat, baseLng, testHeading, 100);
  const behindResult = isCameraAhead(baseLat, baseLng, behind.lat, behind.lng, testHeading);
  console.log(`  ${!behindResult ? 'PASS' : 'FAIL'}  Camera 100m directly behind: ${behindResult ? 'AHEAD' : 'NOT AHEAD'} (expected: NOT AHEAD)`);

  // ========================================================================
  // Test 6: Speed-adaptive tolerance verification
  // ========================================================================
  console.log('\n----------------------------------------');
  console.log('  Test 6: Speed-adaptive tolerances');
  console.log('  (wider tolerances at low GPS speeds)');
  console.log('----------------------------------------\n');

  let adaptivePass = 0;
  let adaptiveFail = 0;

  // Verify getHeadingTolerance returns correct values
  const htCases = [
    { speed: -1, expected: 45, label: 'negative speed → default 45°' },
    { speed: 0,  expected: 75, label: '0 m/s → wide 75°' },
    { speed: 3.0, expected: 75, label: '3 m/s (<5) → wide 75°' },
    { speed: 4.9, expected: 75, label: '4.9 m/s (<5) → wide 75°' },
    { speed: 5.0, expected: 60, label: '5.0 m/s (≥5, <8) → medium 60°' },
    { speed: 7.9, expected: 60, label: '7.9 m/s (<8) → medium 60°' },
    { speed: 8.0, expected: 45, label: '8.0 m/s (≥8) → standard 45°' },
    { speed: 15.6, expected: 45, label: '15.6 m/s (35 mph) → standard 45°' },
  ];

  for (const tc of htCases) {
    const got = getHeadingTolerance(tc.speed);
    const ok = got === tc.expected;
    if (ok) adaptivePass++; else adaptiveFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  headingTol(${tc.speed.toFixed(1)}) = ${got}° ${!ok ? `(expected ${tc.expected}°)` : ''} ${tc.label}`);
  }

  const btCases = [
    { speed: -1, expected: 30, label: 'negative speed → default 30°' },
    { speed: 0,  expected: 50, label: '0 m/s → wide 50°' },
    { speed: 3.0, expected: 50, label: '3 m/s (<5) → wide 50°' },
    { speed: 4.9, expected: 50, label: '4.9 m/s (<5) → wide 50°' },
    { speed: 5.0, expected: 40, label: '5.0 m/s (≥5, <8) → medium 40°' },
    { speed: 7.9, expected: 40, label: '7.9 m/s (<8) → medium 40°' },
    { speed: 8.0, expected: 30, label: '8.0 m/s (≥8) → standard 30°' },
    { speed: 15.6, expected: 30, label: '15.6 m/s (35 mph) → standard 30°' },
  ];

  for (const tc of btCases) {
    const got = getBearingTolerance(tc.speed);
    const ok = got === tc.expected;
    if (ok) adaptivePass++; else adaptiveFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  bearingTol(${tc.speed.toFixed(1)}) = ${got}° ${!ok ? `(expected ${tc.expected}°)` : ''} ${tc.label}`);
  }

  // Verify that wider tolerances accept headings rejected by standard tolerances
  // A heading 50° off from NB (0°) should fail at 45° but pass at 75°
  const headingDiff50 = isHeadingMatch(50, ['NB'], 45);  // should fail
  const headingDiff50Wide = isHeadingMatch(50, ['NB'], 75);  // should pass
  {
    const ok = !headingDiff50 && headingDiff50Wide;
    if (ok) adaptivePass++; else adaptiveFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  50° off NB: standard(45°)=${headingDiff50 ? 'match' : 'reject'}, wide(75°)=${headingDiff50Wide ? 'match' : 'accept'}`);
  }

  // A bearing 35° off heading should fail at 30° but pass at 50°
  const bearingOff35 = computeStartPoint(baseLat, baseLng, (testHeading + 180 + 35) % 360, 100);
  const bearingOff35Narrow = isCameraAhead(baseLat, baseLng, bearingOff35.lat, bearingOff35.lng, testHeading, 30);
  const bearingOff35Wide = isCameraAhead(baseLat, baseLng, bearingOff35.lat, bearingOff35.lng, testHeading, 50);
  {
    const ok = !bearingOff35Narrow && bearingOff35Wide;
    if (ok) adaptivePass++; else adaptiveFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  35° off-axis bearing: standard(30°)=${bearingOff35Narrow ? 'ahead' : 'reject'}, wide(50°)=${bearingOff35Wide ? 'ahead' : 'accept'}`);
  }

  // Full approach sim at low speed (3 m/s) — should still fire using wider tolerances
  if (testCamIdx >= 0) {
    const testCam = cameras[testCamIdx];
    const lowSpeedResult = simulateApproach(cameras, testCamIdx, testCam.approaches[0], 3.5, 400, 15);
    const ok = lowSpeedResult.alertFired;
    if (ok) adaptivePass++; else adaptiveFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Low-speed approach (3.5 m/s): ${ok ? 'alert fires' : 'NO ALERT'}`);
  }

  console.log(`\n  Speed-adaptive tolerance tests: ${adaptivePass} passed, ${adaptiveFail} failed`);

  // ========================================================================
  // Test 7: Heading smoothing verification
  // ========================================================================
  console.log('\n----------------------------------------');
  console.log('  Test 7: Heading smoothing (circular mean)');
  console.log('----------------------------------------\n');

  let smoothPass = 0;
  let smoothFail = 0;

  // Test 1: Negative heading passes through unchanged
  {
    const buf: number[] = [];
    const result = smoothHeading(buf, -1);
    const ok = result === -1;
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Negative heading (-1) → ${result} (expected -1, pass-through)`);
  }

  // Test 2: Single reading returns raw (buffer < 2)
  {
    const buf: number[] = [];
    const result = smoothHeading(buf, 90);
    const ok = result === 90 && buf.length === 1;
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Single reading (90°) → ${result.toFixed(1)}° (expected 90°, buffer=${buf.length})`);
  }

  // Test 3: Two identical readings = same value
  {
    const buf: number[] = [45];
    const result = smoothHeading(buf, 45);
    const ok = Math.abs(result - 45) < 0.1;
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Two identical (45°, 45°) → ${result.toFixed(1)}° (expected ~45°)`);
  }

  // Test 4: Wrap-around averaging (350° + 10°) should give ~0°, NOT 180°
  {
    const buf: number[] = [350];
    const result = smoothHeading(buf, 10);
    // Result should be near 0° (or 360°), NOT near 180°
    let diffFrom0 = Math.abs(result);
    if (diffFrom0 > 180) diffFrom0 = 360 - diffFrom0;
    const ok = diffFrom0 < 5; // within 5° of 0°/360°
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Wrap-around (350°, 10°) → ${result.toFixed(1)}° (expected ~0°/360°, diff=${diffFrom0.toFixed(1)}°)`);
  }

  // Test 5: Another wrap-around (5°, 355°) → ~0°
  {
    const buf: number[] = [5];
    const result = smoothHeading(buf, 355);
    let diffFrom0 = Math.abs(result);
    if (diffFrom0 > 180) diffFrom0 = 360 - diffFrom0;
    const ok = diffFrom0 < 5;
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Wrap-around (5°, 355°) → ${result.toFixed(1)}° (expected ~0°/360°, diff=${diffFrom0.toFixed(1)}°)`);
  }

  // Test 6: Buffer fills to 5 then drops oldest
  {
    const buf: number[] = [];
    smoothHeading(buf, 90);   // buf: [90]
    smoothHeading(buf, 92);   // buf: [90, 92]
    smoothHeading(buf, 88);   // buf: [90, 92, 88]
    smoothHeading(buf, 91);   // buf: [90, 92, 88, 91]
    smoothHeading(buf, 89);   // buf: [90, 92, 88, 91, 89]
    const ok5 = buf.length === 5;
    smoothHeading(buf, 93);   // buf: [92, 88, 91, 89, 93] — oldest dropped
    const ok6 = buf.length === 5 && buf[0] === 92; // 90 was dropped
    const ok = ok5 && ok6;
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Buffer cap: after 6 readings, size=${buf.length} (expected 5), oldest dropped=${buf[0] === 92 ? 'yes' : 'no'}`);
  }

  // Test 7: Smoothing reduces noise (90° ± jitter → near 90°)
  {
    const buf: number[] = [];
    smoothHeading(buf, 85);
    smoothHeading(buf, 95);
    smoothHeading(buf, 88);
    smoothHeading(buf, 92);
    const result = smoothHeading(buf, 90);
    const diffFrom90 = Math.abs(result - 90);
    const ok = diffFrom90 < 3; // smoothed should be within 3° of 90°
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Noisy NB (85,95,88,92,90) → ${result.toFixed(1)}° (expected ~90°, diff=${diffFrom90.toFixed(1)}°)`);
  }

  // Test 8: Smoothing near 180° (no wrap-around issue here)
  {
    const buf: number[] = [];
    smoothHeading(buf, 175);
    smoothHeading(buf, 185);
    smoothHeading(buf, 178);
    smoothHeading(buf, 182);
    const result = smoothHeading(buf, 180);
    const diffFrom180 = Math.abs(result - 180);
    const ok = diffFrom180 < 3;
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Noisy SB (175,185,178,182,180) → ${result.toFixed(1)}° (expected ~180°, diff=${diffFrom180.toFixed(1)}°)`);
  }

  // Test 9: Extreme wrap-around with 5 readings near 0°/360°
  {
    const buf: number[] = [];
    smoothHeading(buf, 358);
    smoothHeading(buf, 2);
    smoothHeading(buf, 359);
    smoothHeading(buf, 1);
    const result = smoothHeading(buf, 0);
    let diffFrom0 = result;
    if (diffFrom0 > 180) diffFrom0 = 360 - diffFrom0;
    const ok = diffFrom0 < 3;
    if (ok) smoothPass++; else smoothFail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  Noisy NB near 0° (358,2,359,1,0) → ${result.toFixed(1)}° (expected ~0°, diff=${diffFrom0.toFixed(1)}°)`);
  }

  console.log(`\n  Heading smoothing tests: ${smoothPass} passed, ${smoothFail} failed`);

  // ========================================================================
  // Final report
  // ========================================================================
  console.log('\n========================================');
  console.log('  FINAL REPORT');
  console.log('========================================');

  const totalTests = results.length + speedResults.length + adaptivePass + adaptiveFail + smoothPass + smoothFail;
  const totalPassed = passed.length + speedTestPass + adaptivePass + smoothPass;
  const totalFailed = failed.length + speedTestFail + adaptiveFail + smoothFail;

  console.log(`  Total tests:  ${totalTests}`);
  console.log(`  Passed:       ${totalPassed}`);
  console.log(`  Failed:       ${totalFailed}`);
  console.log(`  Pass rate:    ${(totalPassed / totalTests * 100).toFixed(1)}%`);
  console.log();

  if (totalFailed > 0) {
    console.log('  Status: FAILURES DETECTED');
    console.log('  Run with --verbose for detailed step output');
    console.log('  Run with --failures to show only failures');
    process.exit(1);
  } else {
    console.log('  Status: ALL TESTS PASSED');
    process.exit(0);
  }
}

main();
