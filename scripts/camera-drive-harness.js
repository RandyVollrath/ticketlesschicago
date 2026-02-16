#!/usr/bin/env node
/* eslint-disable no-console */

const MIN_SPEED_SPEED_CAM_MPS = 3.2;
const MIN_SPEED_REDLIGHT_MPS = 1.0;
const BASE_ALERT_RADIUS_METERS = 150;
const MAX_ALERT_RADIUS_METERS = 250;
const TARGET_WARNING_SECONDS = 10;
const HEADING_TOLERANCE_DEGREES = 45;
const MAX_BEARING_OFF_HEADING_DEGREES = 30;

const APPROACH_TO_HEADING = {
  NB: 0,
  NEB: 45,
  EB: 90,
  SEB: 135,
  SB: 180,
  SWB: 225,
  WB: 270,
  NWB: 315,
};

function toRad(v) {
  return (v * Math.PI) / 180;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingTo(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  const bearingRad = Math.atan2(y, x);
  return ((bearingRad * 180) / Math.PI + 360) % 360;
}

function headingMatch(heading, approaches) {
  if (heading < 0 || !approaches || approaches.length === 0) return true;
  for (const approach of approaches) {
    const target = APPROACH_TO_HEADING[approach];
    if (target == null) return true;
    let diff = Math.abs(heading - target);
    if (diff > 180) diff = 360 - diff;
    if (diff <= HEADING_TOLERANCE_DEGREES) return true;
  }
  return false;
}

function cameraAhead(userLat, userLng, camLat, camLng, heading) {
  if (heading < 0) return true;
  const brg = bearingTo(userLat, userLng, camLat, camLng);
  let diff = Math.abs(heading - brg);
  if (diff > 180) diff = 360 - diff;
  return diff <= MAX_BEARING_OFF_HEADING_DEGREES;
}

function alertRadius(speed) {
  if (speed < 0) return BASE_ALERT_RADIUS_METERS;
  const dynamic = speed * TARGET_WARNING_SECONDS;
  return Math.max(BASE_ALERT_RADIUS_METERS, Math.min(dynamic, MAX_ALERT_RADIUS_METERS));
}

function shouldAlert(point, camera) {
  const minSpeed = camera.type === 'speed' ? MIN_SPEED_SPEED_CAM_MPS : MIN_SPEED_REDLIGHT_MPS;
  if (point.speed >= 0 && point.speed < minSpeed) return false;

  const dist = distanceMeters(point.lat, point.lng, camera.lat, camera.lng);
  if (dist > alertRadius(point.speed)) return false;
  if (!headingMatch(point.heading, camera.approaches)) return false;
  if (!cameraAhead(point.lat, point.lng, camera.lat, camera.lng, point.heading)) return false;
  return true;
}

const scenarios = [
  {
    name: 'Speed camera EB approach should alert',
    camera: { type: 'speed', lat: 41.9236, lng: -87.7825, approaches: ['EB'] },
    points: [
      { lat: 41.92358, lng: -87.7865, heading: 90, speed: 8.0 },
      { lat: 41.92360, lng: -87.7848, heading: 90, speed: 7.4 },
      { lat: 41.92360, lng: -87.7838, heading: 90, speed: 6.8 },
    ],
    expectAnyAlert: true,
  },
  {
    name: 'Red-light NB approach should alert at low speed',
    camera: { type: 'redlight', lat: 41.9610, lng: -87.68862, approaches: ['NB'] },
    points: [
      { lat: 41.9588, lng: -87.68862, heading: 0, speed: 2.2 },
      { lat: 41.9599, lng: -87.68862, heading: 0, speed: 2.0 },
      { lat: 41.9604, lng: -87.68862, heading: 0, speed: 1.8 },
    ],
    expectAnyAlert: true,
  },
  {
    name: 'Wrong heading should not alert',
    camera: { type: 'redlight', lat: 41.89543, lng: -87.6867, approaches: ['NB'] },
    points: [
      { lat: 41.8942, lng: -87.6867, heading: 180, speed: 6.0 },
      { lat: 41.8948, lng: -87.6867, heading: 180, speed: 5.5 },
    ],
    expectAnyAlert: false,
  },
  {
    name: 'Too slow for speed camera should not alert',
    camera: { type: 'speed', lat: 41.8771, lng: -87.7182, approaches: ['EB'] },
    points: [
      { lat: 41.8771, lng: -87.7200, heading: 90, speed: 1.2 },
      { lat: 41.8771, lng: -87.7195, heading: 90, speed: 1.4 },
    ],
    expectAnyAlert: false,
  },
];

let failed = 0;
console.log('\n=== Camera Synthetic Drive Harness ===');

for (const scenario of scenarios) {
  let alerts = 0;
  for (const point of scenario.points) {
    if (shouldAlert(point, scenario.camera)) alerts += 1;
  }
  const ok = scenario.expectAnyAlert ? alerts > 0 : alerts === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${scenario.name} (alerts=${alerts})`);
  if (!ok) failed += 1;
}

if (failed > 0) {
  console.error(`\nFAIL: ${failed} scenario(s) failed`);
  process.exit(2);
}

console.log('\nPASS: camera harness checks completed.');
