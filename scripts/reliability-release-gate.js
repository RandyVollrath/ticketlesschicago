#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const { spawnSync } = require('child_process');

const logPath = process.argv[2] || 'TicketlessChicagoMobile/logs/parking_detection.log';
const MAX_PARKING_MISS_RATE = Number(process.env.MAX_PARKING_MISS_RATE || 0.25);
const MAX_UNWIND_RATE = Number(process.env.MAX_UNWIND_RATE || 0.12);
const MAX_CAMERA_FALLBACKS_PER_ALERT = Number(process.env.MAX_CAMERA_FALLBACKS_PER_ALERT || 0.4);

// Minimum sample sizes. Without these, the rate thresholds are
// mathematically unreachable on small logs — e.g., with only 4 parking
// confirms, a single unwind is 25%, which trips a 12% threshold even
// though 1 event is noise, not signal. Setting these to 10 means you
// need at least 2 anomalies out of 10 before the gate fires — which is
// actually a rate worth acting on.
const MIN_DRIVING_STARTS = Number(process.env.MIN_DRIVING_STARTS || 10);
const MIN_PARKING_CONFIRMED = Number(process.env.MIN_PARKING_CONFIRMED || 10);
const MIN_CAMERA_ALERTS = Number(process.env.MIN_CAMERA_ALERTS || 10);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(2);
}

if (!fs.existsSync(logPath)) {
  fail(`log file missing: ${logPath}`);
}

const harness = spawnSync('node', ['scripts/camera-drive-harness.js'], { encoding: 'utf8' });
if (harness.status !== 0) {
  console.error(harness.stdout || '');
  console.error(harness.stderr || '');
  fail('camera-drive-harness failed');
}

const logText = fs.readFileSync(logPath, 'utf8');
const lines = logText.split(/\r?\n/);

let drivingStarted = 0;
let parkingConfirmed = 0;
let postConfirmUnwound = 0;
let cameraAlerts = 0;
let cameraFallbacks = 0;

for (const line of lines) {
  if (!line) continue;
  if (line.includes('Driving started (')) drivingStarted += 1;
  if (line.includes('PARKING CONFIRMED (source:')) parkingConfirmed += 1;
  if (line.includes('parking_post_confirm_unwound')) postConfirmUnwound += 1;
  if (line.includes('CAMERA ALERT:')) cameraAlerts += 1;
  if (line.includes('[CameraDeliveryFallback] mode=fallback_audio')) cameraFallbacks += 1;
}

if (drivingStarted === 0) {
  fail('no driving sessions found in log');
}

const skipped = [];

const missRate = (drivingStarted - parkingConfirmed) / drivingStarted;
if (drivingStarted < MIN_DRIVING_STARTS) {
  skipped.push(`parking miss rate (only ${drivingStarted}/${MIN_DRIVING_STARTS} driving sessions)`);
} else if (missRate > MAX_PARKING_MISS_RATE) {
  fail(`parking miss rate too high: ${missRate.toFixed(3)} > ${MAX_PARKING_MISS_RATE}`);
}

const unwindRate = parkingConfirmed > 0 ? postConfirmUnwound / parkingConfirmed : 0;
if (parkingConfirmed < MIN_PARKING_CONFIRMED) {
  skipped.push(`post-confirm unwind rate (only ${parkingConfirmed}/${MIN_PARKING_CONFIRMED} parking confirms)`);
} else if (unwindRate > MAX_UNWIND_RATE) {
  fail(`post-confirm unwind rate too high: ${unwindRate.toFixed(3)} > ${MAX_UNWIND_RATE}`);
}

const fallbackPerAlert = cameraAlerts > 0 ? cameraFallbacks / cameraAlerts : 0;
if (cameraAlerts < MIN_CAMERA_ALERTS) {
  skipped.push(`camera audio fallback rate (only ${cameraAlerts}/${MIN_CAMERA_ALERTS} camera alerts)`);
} else if (fallbackPerAlert > MAX_CAMERA_FALLBACKS_PER_ALERT) {
  fail(`camera audio fallback rate too high: ${fallbackPerAlert.toFixed(3)} > ${MAX_CAMERA_FALLBACKS_PER_ALERT}`);
}

for (const s of skipped) {
  console.log(`SKIP (insufficient sample): ${s}`);
}

console.log('PASS: reliability release gate');
console.log(
  JSON.stringify(
    {
      drivingStarted,
      parkingConfirmed,
      missRate: Number(missRate.toFixed(4)),
      postConfirmUnwound,
      unwindRate: Number(unwindRate.toFixed(4)),
      cameraAlerts,
      cameraFallbacks,
      fallbackPerAlert: Number(fallbackPerAlert.toFixed(4)),
    },
    null,
    2
  )
);

