#!/usr/bin/env node

const fs = require('fs');

function usage() {
  console.log('Usage: node scripts/analyze-parking-decisions.js <parking_decisions.ndjson>');
}

const file = process.argv[2];
if (!file) {
  usage();
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);

const counters = {
  totalEvents: 0,
  tripSummaries: 0,
  parkingConfirmed: 0,
  parkingBlockedHotspot: 0,
  healthRecovered: 0,
  cameraAlertFired: 0,
  gpsGatePassed: 0,
  gpsGateWait: 0,
  unknownFallbackPassed: 0,
};

const tripSummaries = [];

for (const line of lines) {
  let row;
  try {
    row = JSON.parse(line);
  } catch (_) {
    continue;
  }

  counters.totalEvents += 1;
  const event = row.event || '';

  if (event === 'trip_summary') {
    counters.tripSummaries += 1;
    tripSummaries.push(row);
  } else if (event === 'parking_confirmed') {
    counters.parkingConfirmed += 1;
  } else if (event === 'confirm_parking_blocked_hotspot') {
    counters.parkingBlockedHotspot += 1;
  } else if (event === 'health_recovered') {
    counters.healthRecovered += 1;
  } else if (event === 'native_camera_alert_fired') {
    counters.cameraAlertFired += 1;
  } else if (event === 'gps_coremotion_gate_passed') {
    counters.gpsGatePassed += 1;
  } else if (event === 'gps_coremotion_gate_wait') {
    counters.gpsGateWait += 1;
  } else if (event === 'gps_unknown_fallback_passed') {
    counters.unknownFallbackPassed += 1;
  }
}

console.log('\n=== Parking Decision Summary ===');
console.log(`Events: ${counters.totalEvents}`);
console.log(`Trip summaries: ${counters.tripSummaries}`);
console.log(`Parking confirmed: ${counters.parkingConfirmed}`);
console.log(`Camera alerts fired: ${counters.cameraAlertFired}`);
console.log(`GPS gate passed: ${counters.gpsGatePassed}`);
console.log(`GPS gate wait: ${counters.gpsGateWait}`);
console.log(`Unknown fallback passed: ${counters.unknownFallbackPassed}`);
console.log(`Hotspot blocks: ${counters.parkingBlockedHotspot}`);
console.log(`Health recoveries: ${counters.healthRecovered}`);

if (tripSummaries.length === 0) {
  console.log('\nNo trip_summary events found.');
  process.exit(0);
}

const outcomeCount = new Map();
const camOutcomeCount = new Map();
const guardOutcomeCount = new Map();
let avgUnknownDur = 0;
let avgWatchdog = 0;
let avgCamAlerts = 0;

for (const t of tripSummaries) {
  const o = t.outcome || 'unknown';
  outcomeCount.set(o, (outcomeCount.get(o) || 0) + 1);

  const co = t.cameraAlertOutcome || 'unknown';
  camOutcomeCount.set(co, (camOutcomeCount.get(co) || 0) + 1);

  const go = t.parkingGuardOutcome || 'unknown';
  guardOutcomeCount.set(go, (guardOutcomeCount.get(go) || 0) + 1);

  avgUnknownDur += Number(t.motionUnknownDurationSec || 0);
  avgWatchdog += Number(t.watchdogRecoveries || 0);
  avgCamAlerts += Number(t.cameraAlertCount || 0);
}

avgUnknownDur /= tripSummaries.length;
avgWatchdog /= tripSummaries.length;
avgCamAlerts /= tripSummaries.length;

function printMap(title, map) {
  console.log(`\n${title}`);
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of entries) {
    console.log(`- ${k}: ${v}`);
  }
}

printMap('Trip outcomes', outcomeCount);
printMap('Camera outcomes', camOutcomeCount);
printMap('Parking guard outcomes', guardOutcomeCount);

console.log('\nAverages per trip');
console.log(`- Unknown motion duration: ${avgUnknownDur.toFixed(1)}s`);
console.log(`- Watchdog recoveries: ${avgWatchdog.toFixed(2)}`);
console.log(`- Camera alerts fired: ${avgCamAlerts.toFixed(2)}`);

console.log('\nRecent trip summaries (last 8)');
for (const t of tripSummaries.slice(-8)) {
  const id = String(t.tripId || '').slice(0, 8);
  const outcome = t.outcome || 'unknown';
  const cam = t.cameraAlertOutcome || 'unknown';
  const guard = t.parkingGuardOutcome || 'unknown';
  const dur = Number(t.durationSec || 0).toFixed(0);
  const unknown = Number(t.motionUnknownDurationSec || 0).toFixed(0);
  const watchdog = Number(t.watchdogRecoveries || 0).toFixed(0);
  console.log(`- trip=${id} outcome=${outcome} cam=${cam} guard=${guard} dur=${dur}s unknown=${unknown}s watchdog=${watchdog}`);
}
