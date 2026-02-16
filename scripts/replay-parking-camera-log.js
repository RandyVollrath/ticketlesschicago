#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2] || 'TicketlessChicagoMobile/logs/parking_detection.log';
const strict = process.argv.includes('--strict');

if (!fs.existsSync(inputPath)) {
  console.error(`Log file not found: ${inputPath}`);
  process.exit(1);
}

const text = fs.readFileSync(inputPath, 'utf8');
const lines = text.split(/\r?\n/);

const stats = {
  drivingStarted: 0,
  parkingConfirmed: 0,
  candidateReady: 0,
  finalizationCancelled: 0,
  lockoutBlocked: 0,
  hotspotBlocked: 0,
  cameraAlerts: 0,
  cameraRejected: 0,
  unknownFallbackParking: 0,
  parkedWhileAutomotiveWaitLines: 0,
};

const cameraRejectReasons = Object.create(null);
const finalizationCancelReasons = Object.create(null);

const trips = [];
let currentTrip = null;

function startTrip(line) {
  if (currentTrip) {
    currentTrip.outcome = currentTrip.outcome || 'replaced_by_new_drive';
    trips.push(currentTrip);
  }
  currentTrip = {
    startLine: line,
    cameraAlerts: 0,
    cameraRejects: 0,
    automotiveWaitLines: 0,
    finalizationCancelled: 0,
    outcome: null,
  };
}

function endTrip(outcome, line) {
  if (!currentTrip) return;
  currentTrip.outcome = outcome;
  currentTrip.endLine = line;
  trips.push(currentTrip);
  currentTrip = null;
}

for (const line of lines) {
  if (!line) continue;

  if (line.includes('Driving started (')) {
    stats.drivingStarted += 1;
    startTrip(line);
  }

  if (line.includes('PARKING CANDIDATE READY')) {
    stats.candidateReady += 1;
  }

  if (line.includes('PARKING CONFIRMED (source:')) {
    stats.parkingConfirmed += 1;
    if (line.includes('gps_unknown_fallback')) stats.unknownFallbackParking += 1;
    endTrip('parking_confirmed', line);
  }

  if (line.includes('confirmParking(') && line.includes('blocked by false-positive lockout')) {
    stats.lockoutBlocked += 1;
  }

  if (line.includes('Parking candidate blocked by hotspot guard')) {
    stats.hotspotBlocked += 1;
  }

  if (line.includes('Parking finalization cancelled:')) {
    stats.finalizationCancelled += 1;
    if (currentTrip) currentTrip.finalizationCancelled += 1;
    const reason = line.split('Parking finalization cancelled:')[1]?.trim() || 'unknown';
    finalizationCancelReasons[reason] = (finalizationCancelReasons[reason] || 0) + 1;
  }

  if (line.includes('CoreMotion still automotive') && line.includes('Waiting...')) {
    stats.parkedWhileAutomotiveWaitLines += 1;
    if (currentTrip) currentTrip.automotiveWaitLines += 1;
  }

  if (line.includes('NATIVE CAMERA ALERT:')) {
    stats.cameraAlerts += 1;
    if (currentTrip) currentTrip.cameraAlerts += 1;
  }

  if (line.includes('[DECISION] native_camera_candidate_rejected') || line.includes('native_camera_candidate_rejected')) {
    stats.cameraRejected += 1;
    if (currentTrip) currentTrip.cameraRejects += 1;

    const reasonMatch = line.match(/"reason"\s*:\s*"([^"]+)"|reason=([a-z_]+)/i);
    const reason = (reasonMatch && (reasonMatch[1] || reasonMatch[2])) || 'unknown';
    cameraRejectReasons[reason] = (cameraRejectReasons[reason] || 0) + 1;
  }
}

if (currentTrip) {
  currentTrip.outcome = currentTrip.outcome || 'open_trip_at_eof';
  trips.push(currentTrip);
}

const tripsWithNoParking = trips.filter((t) => t.outcome !== 'parking_confirmed').length;
const tripsWithNoCamera = trips.filter((t) => t.cameraAlerts === 0).length;

console.log('\n=== Parking/Camera Replay Summary ===');
console.log(`File: ${path.resolve(inputPath)}`);
console.log(`Driving started: ${stats.drivingStarted}`);
console.log(`Parking confirmed: ${stats.parkingConfirmed}`);
console.log(`Parking candidates: ${stats.candidateReady}`);
console.log(`Finalization cancelled: ${stats.finalizationCancelled}`);
console.log(`Hotspot blocked: ${stats.hotspotBlocked}`);
console.log(`Lockout blocked: ${stats.lockoutBlocked}`);
console.log(`Unknown fallback confirms: ${stats.unknownFallbackParking}`);
console.log(`Native camera alerts: ${stats.cameraAlerts}`);
console.log(`Native camera rejects: ${stats.cameraRejected}`);
console.log(`Automotive-wait lines: ${stats.parkedWhileAutomotiveWaitLines}`);
console.log(`Trips parsed: ${trips.length}`);
console.log(`Trips without parking confirm: ${tripsWithNoParking}`);
console.log(`Trips without camera alert: ${tripsWithNoCamera}`);

function topEntries(obj, n = 5) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}: ${v}`);
}

const topRejects = topEntries(cameraRejectReasons);
if (topRejects.length > 0) {
  console.log('\nTop camera reject reasons:');
  for (const row of topRejects) console.log(`- ${row}`);
}

const topCancels = topEntries(finalizationCancelReasons);
if (topCancels.length > 0) {
  console.log('\nTop finalization cancel reasons:');
  for (const row of topCancels) console.log(`- ${row}`);
}

let failed = false;

if (stats.drivingStarted === 0) {
  console.error('\nFAIL: no driving-start events found');
  failed = true;
}

if (stats.parkingConfirmed === 0) {
  console.error('\nFAIL: no parking-confirmed events found');
  failed = true;
}

if (strict) {
  if (tripsWithNoParking > Math.max(1, Math.floor(trips.length * 0.35))) {
    console.error(`\nFAIL(strict): too many trips without parking confirmation (${tripsWithNoParking}/${trips.length})`);
    failed = true;
  }
  if (stats.cameraAlerts === 0 && stats.cameraRejected > 0) {
    console.error('\nFAIL(strict): only camera rejects observed, no camera alerts fired');
    failed = true;
  }
}

if (failed) {
  process.exit(2);
}

console.log('\nPASS: replay checks completed.');
