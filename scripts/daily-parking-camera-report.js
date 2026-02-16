#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const logPath = process.argv[2] || 'TicketlessChicagoMobile/logs/parking_detection.log';
const outDir = process.argv[3] || 'TicketlessChicagoMobile/logs';

if (!fs.existsSync(logPath)) {
  console.error(`Missing log file: ${logPath}`);
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
const today = new Date();
const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

const counts = {
  drivingStarted: 0,
  parkingConfirmed: 0,
  blockedHotspot: 0,
  blockedLockout: 0,
  blockedLowConfidence: 0,
  finalizationCancelled: 0,
  cameraAlertFired: 0,
  cameraRejected: 0,
};

const reasonCounts = {
  cameraReject: Object.create(null),
  finalizationCancel: Object.create(null),
};

for (const line of lines) {
  if (!line) continue;
  if (line.includes('Driving started (')) counts.drivingStarted += 1;
  if (line.includes('PARKING CONFIRMED')) counts.parkingConfirmed += 1;
  if (line.includes('confirm_parking_blocked_hotspot')) counts.blockedHotspot += 1;
  if (line.includes('confirm_parking_blocked_lockout')) counts.blockedLockout += 1;
  if (line.includes('confirm_parking_blocked_low_confidence')) counts.blockedLowConfidence += 1;
  if (line.includes('parking_finalization_cancelled') || line.includes('Parking finalization cancelled:')) {
    counts.finalizationCancelled += 1;
    const m = line.match(/"reason"\s*:\s*"([^"]+)"|Parking finalization cancelled:\s*(.+)$/);
    const reason = (m && (m[1] || m[2])) ? String(m[1] || m[2]).trim() : 'unknown';
    reasonCounts.finalizationCancel[reason] = (reasonCounts.finalizationCancel[reason] || 0) + 1;
  }
  if (line.includes('native_camera_alert_fired') || line.includes('NATIVE CAMERA ALERT:')) counts.cameraAlertFired += 1;
  if (line.includes('native_camera_candidate_rejected') || line.includes('CAMERA CANDIDATE REJECTED(js)')) {
    counts.cameraRejected += 1;
    const m = line.match(/"reason"\s*:\s*"([^"]+)"|reason=([a-z_]+)/i);
    const reason = (m && (m[1] || m[2])) ? String(m[1] || m[2]).trim() : 'unknown';
    reasonCounts.cameraReject[reason] = (reasonCounts.cameraReject[reason] || 0) + 1;
  }
}

function topReason(map) {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return ['none', 0];
  return rows[0];
}

const [topCameraReason, topCameraReasonCount] = topReason(reasonCounts.cameraReject);
const [topCancelReason, topCancelReasonCount] = topReason(reasonCounts.finalizationCancel);

const suggestions = [];
if (counts.cameraRejected > counts.cameraAlertFired && topCameraReason !== 'none') {
  suggestions.push(`Camera tuning priority: ${topCameraReason} (${topCameraReasonCount})`);
}
if (counts.blockedLowConfidence > 0) {
  suggestions.push(`Parking confidence guard blocked ${counts.blockedLowConfidence} candidates. Review low-confidence thresholds.`);
}
if (counts.finalizationCancelled > 0 && topCancelReason !== 'none') {
  suggestions.push(`Top finalization cancel reason: ${topCancelReason} (${topCancelReasonCount})`);
}
if (suggestions.length === 0) {
  suggestions.push('No immediate threshold changes recommended from this log sample.');
}

const md = [
  '# Daily Parking/Camera Threshold Report',
  '',
  `Generated: ${today.toISOString()}`,
  `Source log: ${path.resolve(logPath)}`,
  '',
  '## Summary',
  `- Driving started: ${counts.drivingStarted}`,
  `- Parking confirmed: ${counts.parkingConfirmed}`,
  `- Parking blocked (hotspot): ${counts.blockedHotspot}`,
  `- Parking blocked (lockout): ${counts.blockedLockout}`,
  `- Parking blocked (low confidence): ${counts.blockedLowConfidence}`,
  `- Finalization cancelled: ${counts.finalizationCancelled}`,
  `- Camera alerts fired: ${counts.cameraAlertFired}`,
  `- Camera candidate rejected: ${counts.cameraRejected}`,
  '',
  '## Top Reasons',
  `- Camera reject: ${topCameraReason} (${topCameraReasonCount})`,
  `- Finalization cancel: ${topCancelReason} (${topCancelReasonCount})`,
  '',
  '## Suggested Adjustments',
  ...suggestions.map((s) => `- ${s}`),
  '',
].join('\n');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `daily_parking_camera_report_${stamp}.md`);
fs.writeFileSync(outPath, md);

console.log(`Report written: ${outPath}`);
console.log(suggestions.map((s) => `- ${s}`).join('\n'));
