#!/usr/bin/env npx tsx
/**
 * Live smoke test for external data integrations.
 * Hits real Chicago Open Data + CTA datasets. Not free-free — each
 * invocation is one HTTP call per module; runs serially to avoid rate
 * limits.
 *
 * Run: npx tsx scripts/smoke-test-external-data.ts
 */

import { getCameraMalfunctionSignal } from '../lib/camera-malfunction-detector';
import { getCtaBusActivityFinding } from '../lib/cta-bus-activity';
import { getResidentialPermitZoneFinding } from '../lib/residential-permit-zone-check';

function log(name: string, detail: any) {
  console.log(`\n— ${name} —`);
  console.log(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
}

async function main() {
  // ── Camera malfunction: red light ──
  // Use a known red-light camera address from the dataset.
  const rlRecent = await getCameraMalfunctionSignal(
    'red_light',
    '2400 W LAWRENCE AVENUE',   // Real camera address per dataset
    '2026-04-07',               // Latest published date
  );
  log('red_light @ 2400 W LAWRENCE on 2026-04-07 (published date)', rlRecent);

  const rlToday = await getCameraMalfunctionSignal(
    'red_light',
    '2400 W LAWRENCE AVENUE',
    '2026-04-21',               // Today — city likely hasn't backfilled yet
  );
  log('red_light @ 2400 W LAWRENCE on 2026-04-21 (too fresh)', rlToday);

  // ── Camera malfunction: speed camera ──
  const scOld = await getCameraMalfunctionSignal(
    'speed_camera',
    '10318 S INDIANAPOLIS',     // Real camera from dataset
    '2026-03-12',               // Latest published date
  );
  log('speed_camera @ 10318 S INDIANAPOLIS on 2026-03-12', scOld);

  const scRecent = await getCameraMalfunctionSignal(
    'speed_camera',
    '10318 S INDIANAPOLIS',
    '2026-04-15',               // Within speed-camera's ~40-day lag
  );
  log('speed_camera @ 10318 S INDIANAPOLIS on 2026-04-15 (too fresh)', scRecent);

  // ── CTA bus stop lookup ──
  // Known downtown Chicago coordinates with lots of bus stops nearby
  const stopNearLoop = await getCtaBusActivityFinding(41.8819, -87.6278, '2026-04-01T14:30:00');
  log('CTA @ downtown Loop (41.8819, -87.6278) — should find stop', stopNearLoop);

  // Middle of Lake Michigan — should find no stops
  const stopInLake = await getCtaBusActivityFinding(41.8500, -87.5500, '2026-04-01T14:30:00');
  log('CTA @ Lake Michigan (41.85, -87.55) — should find zero stops in box', stopInLake);

  // ── Residential permit zones ──
  // 1856 N Kenmore Ave is in zone 143 per dataset probe.
  const zone1 = await getResidentialPermitZoneFinding(
    '1856 N Kenmore Ave, Chicago, IL',
    '1856 N Kenmore Ave, Chicago, IL',
  );
  log('Permit zone for 1856 N Kenmore (known zone-143 address)', zone1);

  // Travis's address
  const zone2 = await getResidentialPermitZoneFinding(
    '2511 W Le Moyne St, Chicago, IL',
    '2511 W Le Moyne St, Chicago, IL',
  );
  log('Permit zone for 2511 W Le Moyne (Travis home)', zone2);

  // Mismatch case
  const zone3 = await getResidentialPermitZoneFinding(
    '1856 N Kenmore Ave, Chicago, IL',  // user lives in zone 143
    '2511 W Le Moyne St, Chicago, IL',   // ticket elsewhere
  );
  log('Mismatch scenario (user in 143, ticket elsewhere)', zone3);

  console.log('\n✓ done — manual review of outputs above');
}

main().catch(e => { console.error(e); process.exit(1); });
