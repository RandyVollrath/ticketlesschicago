#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2] || 'TicketlessChicagoMobile/logs/parking_detection.log';
if (!fs.existsSync(inputPath)) {
  console.error(`Log file not found: ${inputPath}`);
  process.exit(1);
}

const text = fs.readFileSync(inputPath, 'utf8');
const lines = text.split(/\r?\n/);

const stats = {
  drivingStarted: 0,
  parkingConfirmed: 0,
  intersectionBlocked: 0,
  lowConfidenceBlocked: 0,
  postConfirmUnwound: 0,
  cameraAlerts: 0,
  cameraFallbacks: 0,
  mediumConfidenceAlerts: 0,
  lowSuppressedAlerts: 0,
};

for (const line of lines) {
  if (!line) continue;
  if (line.includes('Driving started (')) stats.drivingStarted += 1;
  if (line.includes('PARKING CONFIRMED (source:')) stats.parkingConfirmed += 1;
  if (line.includes('confirm_parking_blocked_intersection_dwell')) stats.intersectionBlocked += 1;
  if (line.includes('confirm_parking_blocked_low_confidence')) stats.lowConfidenceBlocked += 1;
  if (line.includes('parking_post_confirm_unwound')) stats.postConfirmUnwound += 1;
  if (line.includes('CAMERA ALERT:')) stats.cameraAlerts += 1;
  if (line.includes('[CameraDeliveryFallback] mode=fallback_audio')) stats.cameraFallbacks += 1;
  if (line.includes('medium_confidence_notification_only')) stats.mediumConfidenceAlerts += 1;
  if (line.includes('suppressed_low_confidence')) stats.lowSuppressedAlerts += 1;
}

const parkingMissRate =
  stats.drivingStarted > 0
    ? (stats.drivingStarted - stats.parkingConfirmed) / stats.drivingStarted
    : 0;

const unwindRate =
  stats.parkingConfirmed > 0
    ? stats.postConfirmUnwound / stats.parkingConfirmed
    : 0;

let highThreshold = 75;
let mediumThreshold = 55;
let intersectionMinStopSec = 18;

if (unwindRate > 0.08) {
  highThreshold += 5;
  mediumThreshold += 5;
  intersectionMinStopSec += 2;
}
if (stats.cameraFallbacks > Math.max(2, stats.cameraAlerts * 0.25)) {
  highThreshold -= 3;
}
if (stats.lowSuppressedAlerts > stats.cameraAlerts * 0.9 && stats.cameraAlerts > 0) {
  mediumThreshold -= 3;
}

const recommendation = {
  generatedAt: new Date().toISOString(),
  logFile: path.resolve(inputPath),
  observed: {
    ...stats,
    parkingMissRate: Number(parkingMissRate.toFixed(4)),
    unwindRate: Number(unwindRate.toFixed(4)),
  },
  recommendedThresholds: {
    cameraHighConfidenceMin: Math.max(65, Math.min(90, highThreshold)),
    cameraMediumConfidenceMin: Math.max(45, Math.min(80, mediumThreshold)),
    intersectionDwellMinStopSec: Math.max(14, Math.min(26, intersectionMinStopSec)),
  },
};

console.log('\n=== Reliability Auto-Tune Recommendation ===');
console.log(JSON.stringify(recommendation, null, 2));

