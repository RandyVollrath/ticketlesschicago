#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const { spawnSync } = require('child_process');

const logPath = process.argv[2] || 'TicketlessChicagoMobile/logs/parking_detection.log';
const MAX_PARKING_MISS_RATE = Number(process.env.MAX_PARKING_MISS_RATE || 0.25);
const MAX_UNWIND_RATE = Number(process.env.MAX_UNWIND_RATE || 0.12);
const MAX_CAMERA_FALLBACKS_PER_ALERT = Number(process.env.MAX_CAMERA_FALLBACKS_PER_ALERT || 0.4);

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

const missRate = (drivingStarted - parkingConfirmed) / drivingStarted;
if (missRate > MAX_PARKING_MISS_RATE) {
  fail(`parking miss rate too high: ${missRate.toFixed(3)} > ${MAX_PARKING_MISS_RATE}`);
}

const unwindRate = parkingConfirmed > 0 ? postConfirmUnwound / parkingConfirmed : 0;
if (unwindRate > MAX_UNWIND_RATE) {
  fail(`post-confirm unwind rate too high: ${unwindRate.toFixed(3)} > ${MAX_UNWIND_RATE}`);
}

const fallbackPerAlert = cameraAlerts > 0 ? cameraFallbacks / cameraAlerts : 0;
if (fallbackPerAlert > MAX_CAMERA_FALLBACKS_PER_ALERT) {
  fail(`camera audio fallback rate too high: ${fallbackPerAlert.toFixed(3)} > ${MAX_CAMERA_FALLBACKS_PER_ALERT}`);
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

