#!/usr/bin/env tsx
/**
 * Smoke test: the Android driving-GPS tier picker behaves correctly.
 *
 * Validates the speed-adaptive + spatial-gating logic that was added to
 * BackgroundTaskService for battery optimization:
 *   - 'high' (1 Hz / 5 m) near any Chicago camera OR at highway speed
 *   - 'medium' (2 s / 10 m) at city speeds outside camera radius
 *   - 'low'  (5 s / 25 m) at slow speed AND far from any camera
 *
 * This is a pure-logic test — no native modules, no AsyncStorage. It mirrors
 * the constants and pickAndroidGpsTier() inside BackgroundTaskService.ts so
 * we can exercise the decision matrix without booting React Native.
 *
 * If this test drifts from the production logic, update both together.
 *
 * Run: npx tsx scripts/smoke-test-battery-gps-tier.ts
 */

// ---- Mirror constants from BackgroundTaskService.ts ------------------------
const CAMERA_PROXIMITY_HIGH_M = 500;
const CAMERA_PROXIMITY_MEDIUM_M = 1500;
const SPEED_HIGH_MPS = 11.18;   // ≈ 25 mph
const SPEED_MEDIUM_MPS = 4.47;  // ≈ 10 mph

type Tier = 'high' | 'medium' | 'low';

function pickTier(speedMps: number, nearestCameraM: number): Tier {
  if (nearestCameraM < CAMERA_PROXIMITY_HIGH_M) return 'high';
  if (speedMps >= SPEED_HIGH_MPS) return 'high';
  if (nearestCameraM < CAMERA_PROXIMITY_MEDIUM_M || speedMps >= SPEED_MEDIUM_MPS) return 'medium';
  return 'low';
}

// ---- Flat-earth distance helper (mirrors nearestCameraMeters) --------------
function distMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const LAT_TO_M = 111000;
  const LNG_TO_M = 82800; // cos(41.88°) * 111000
  const dLat = (lat2 - lat1) * LAT_TO_M;
  const dLng = (lng2 - lng1) * LNG_TO_M;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ---- Cases -----------------------------------------------------------------
interface Case {
  name: string;
  speedMps: number;
  nearestCameraM: number;
  expected: Tier;
}

const cases: Case[] = [
  // Camera proximity dominates
  { name: 'stopped at red light next to camera',     speedMps: 0,    nearestCameraM: 50,   expected: 'high' },
  { name: 'creeping in traffic 300m from camera',    speedMps: 2,    nearestCameraM: 300,  expected: 'high' },
  { name: 'at 499m from camera, slow',               speedMps: 1,    nearestCameraM: 499,  expected: 'high' },
  // Just past the high-proximity ring but still inside the medium ring — drops
  // from 'high' to 'medium', not all the way to 'low'.
  { name: 'at 501m from camera, slow (medium ring)', speedMps: 1,    nearestCameraM: 501,  expected: 'medium' },

  // Highway speed forces high regardless of camera
  { name: 'highway speed far from any camera',       speedMps: 27,   nearestCameraM: 5000, expected: 'high' },
  { name: 'highway speed near camera',               speedMps: 27,   nearestCameraM: 100,  expected: 'high' },

  // Middle band
  { name: 'city street speed (~15 mph) far away',    speedMps: 6.7,  nearestCameraM: 5000, expected: 'medium' },
  { name: 'in 1500m radius of camera, slow',         speedMps: 1,    nearestCameraM: 1200, expected: 'medium' },
  { name: 'at 1499m, walking pace',                  speedMps: 1,    nearestCameraM: 1499, expected: 'medium' },

  // Low tier
  { name: 'walking 2 km from camera',                speedMps: 1,    nearestCameraM: 2000, expected: 'low' },
  { name: 'stopped far from cameras (red light)',    speedMps: 0,    nearestCameraM: 3000, expected: 'low' },

  // Boundary at SPEED_MEDIUM_MPS
  { name: 'exactly at 10 mph threshold, far away',   speedMps: 4.47, nearestCameraM: 3000, expected: 'medium' },
  { name: 'just below 10 mph, far away',             speedMps: 4.46, nearestCameraM: 3000, expected: 'low' },

  // Boundary at SPEED_HIGH_MPS
  { name: 'exactly at 25 mph threshold, far away',   speedMps: 11.18, nearestCameraM: 3000, expected: 'high' },
  { name: 'just below 25 mph, far away',             speedMps: 11.17, nearestCameraM: 3000, expected: 'medium' },
];

let failed = 0;
for (const c of cases) {
  const got = pickTier(c.speedMps, c.nearestCameraM);
  const ok = got === c.expected;
  console.log(`${ok ? 'OK ' : 'FAIL'}  speed=${c.speedMps.toFixed(2)} m/s  camDist=${c.nearestCameraM}m  → ${got}  (expected ${c.expected})  — ${c.name}`);
  if (!ok) failed++;
}

// ---- Distance sanity check (Loop → O'Hare ≈ 27 km) -------------------------
const loopLat = 41.8781, loopLng = -87.6298;
const ohareLat = 41.9786, ohareLng = -87.9048;
const d = distMeters(loopLat, loopLng, ohareLat, ohareLng);
const expectedKm = 27;
const okDist = Math.abs(d / 1000 - expectedKm) < 4; // within 4km — flat-earth at this scale
console.log(`${okDist ? 'OK ' : 'FAIL'}  Loop → O'Hare flat-earth distance = ${(d / 1000).toFixed(1)} km (expected ~${expectedKm} km)`);
if (!okDist) failed++;

// Short-distance accuracy (Belmont → Fullerton on Sheffield ≈ 1.6 km)
const belmont = { lat: 41.9395, lng: -87.6537 };
const fullerton = { lat: 41.9252, lng: -87.6537 };
const dShort = distMeters(belmont.lat, belmont.lng, fullerton.lat, fullerton.lng);
const okShort = Math.abs(dShort - 1590) < 100; // within 100m
console.log(`${okShort ? 'OK ' : 'FAIL'}  Belmont → Fullerton flat-earth distance = ${dShort.toFixed(0)} m (expected ~1590 m)`);
if (!okShort) failed++;

// ---- Rescan skip math ------------------------------------------------------
const RESCAN_SKIP_MS = 24 * 60 * 60 * 1000;
const parkedAt = Date.now() - 6 * 60 * 60 * 1000; // 6 hours ago
const ageMs = Date.now() - parkedAt;
const wouldSkip_NotSnow_6h = ageMs < RESCAN_SKIP_MS;
const okSkip = wouldSkip_NotSnow_6h === true;
console.log(`${okSkip ? 'OK ' : 'FAIL'}  6h-parked non-snow-route → rescan skipped (age=${(ageMs/3600000).toFixed(1)}h < 24h)`);
if (!okSkip) failed++;

const parkedLong = Date.now() - 36 * 60 * 60 * 1000; // 36 hours ago
const ageLong = Date.now() - parkedLong;
const wouldSkip_NotSnow_36h = ageLong < RESCAN_SKIP_MS;
const okSkipLong = wouldSkip_NotSnow_36h === false;
console.log(`${okSkipLong ? 'OK ' : 'FAIL'}  36h-parked non-snow-route → rescan runs (age=${(ageLong/3600000).toFixed(1)}h >= 24h)`);
if (!okSkipLong) failed++;

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length + 4} cases passed.`);
