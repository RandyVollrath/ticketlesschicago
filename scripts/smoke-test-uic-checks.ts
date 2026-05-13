#!/usr/bin/env npx tsx
/**
 * Smoke test for lib/contest-review/uic-erroneous-checks.ts
 *
 * Per CLAUDE.md ship rule #2: "Live smoke test is the acceptance criterion."
 * Each UIC-style check is exercised against a known-good (should NOT fire)
 * and a known-bad (SHOULD fire) ticket fixture. Real Open-Meteo + Supabase
 * + Chicago Data Portal calls — no mocks, so this verifies the actual data
 * sources behave the way the code expects.
 *
 * Exit code 0 only when every assertion passes.
 *
 * Run:  npx tsx scripts/smoke-test-uic-checks.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load local env so SUPABASE_SERVICE_ROLE_KEY is available
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createClient } from '@supabase/supabase-js';
import {
  checkStreetCleaningTimeWindow,
  checkSpecialEventsPermitCoverage,
  checkWinterBan,
  checkTwoInchSnowRoute,
  checkNoParkingInLoop,
  checkExpiredMeterCBD,
  checkAddressTransposition,
  runAllUICChecks,
  type TicketContext,
} from '../lib/contest-review/uic-erroneous-checks';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE env vars — bailing.');
  process.exit(2);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

let failures = 0;
function assertFires(label: string, finding: unknown) {
  if (finding === null || finding === undefined) {
    failures++;
    console.error(`  FAIL: ${label} — expected finding to FIRE, got null`);
  } else {
    console.log(`  PASS: ${label} — fired`);
  }
}
function assertSilent(label: string, finding: unknown) {
  if (finding !== null && finding !== undefined) {
    failures++;
    console.error(`  FAIL: ${label} — expected SILENT, got finding:`, JSON.stringify(finding).slice(0, 200));
  } else {
    console.log(`  PASS: ${label} — silent`);
  }
}

async function main() {
  console.log('\n=== 1. Street Cleaning time-window check ===');
  // Bad: 5:30am — well before 7am window
  assertFires('5:30am ticket should fire', checkStreetCleaningTimeWindow({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T05:30:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-010',
  }));
  // Bad: 3:15pm — well after 2pm window
  assertFires('3:15pm ticket should fire', checkStreetCleaningTimeWindow({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T15:15:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-010',
  }));
  // Good: 10:30am — squarely inside the residential window
  assertSilent('10:30am ticket should be silent', checkStreetCleaningTimeWindow({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T10:30:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-010',
  }));
  // Different violation code — must NOT fire
  assertSilent('non-street-cleaning code should not fire', checkStreetCleaningTimeWindow({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T05:30:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-170',
  }));

  console.log('\n=== 2. Special Events permit-coverage check ===');
  // Use today's date — the freshness guard requires (a) ticket <30 days
  // old AND (b) dot_permits table populated for that date. With an empty
  // table the check should ABSTAIN (return null), which is the safe
  // behavior. When the sync cron runs it will start firing on real
  // mismatches.
  const todayISO = new Date().toISOString().slice(0, 10);
  // With table empty today the check is silent — that's the correct,
  // non-false-positive behavior we want.
  assertSilent('Empty dot_permits table — abstains (no false positive)', await checkSpecialEventsPermitCoverage({
    issueDate: todayISO,
    issueDateTime: `${todayISO}T18:00:00`,
    latitude: 41.7000, longitude: -87.6500,
    ticketAddress: '6300 S WENTWORTH AVE',
    violationCode: '0964041B',
    violationDescription: 'SPECIAL EVENTS RESTRICTION',
  }, { supabase }));
  // Stale ticket (>30 days old) — always abstains regardless of table state
  assertSilent('Stale ticket (>30 days) — abstains', await checkSpecialEventsPermitCoverage({
    issueDate: '2024-06-15',
    issueDateTime: '2024-06-15T18:00:00',
    latitude: 41.7000, longitude: -87.6500,
    ticketAddress: '6300 S WENTWORTH AVE',
    violationCode: '0964041B',
    violationDescription: 'SPECIAL EVENTS RESTRICTION',
  }, { supabase }));
  // Different violation type — must NOT fire
  assertSilent('Parking-prohibited without special-event desc — silent', await checkSpecialEventsPermitCoverage({
    issueDate: todayISO,
    issueDateTime: `${todayISO}T18:00:00`,
    latitude: 41.7000, longitude: -87.6500,
    ticketAddress: '6300 S WENTWORTH AVE',
    violationCode: '9-64-040',
    violationDescription: 'PARKING/STANDING PROHIBITED ANYTIME',
  }, { supabase }));

  console.log('\n=== 3. Winter Ban triple check ===');
  // Bad: July ticket (outside Dec 1-Apr 1 season)
  assertFires('July ticket — outside winter season', await checkWinterBan({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T04:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-081',
  }, { supabase }));
  // Bad: 9:00am winter ticket (outside 3-7am window)
  assertFires('9am Jan ticket — outside time window', await checkWinterBan({
    issueDate: '2025-01-15',
    issueDateTime: '2025-01-15T09:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-081',
  }, { supabase }));
  // Bad: 4am Jan ticket on a non-winter-ban street
  assertFires('Random residential street, in-season + in-window', await checkWinterBan({
    issueDate: '2025-01-15',
    issueDateTime: '2025-01-15T04:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W THORNDALE PRIVATE WAY ABC',
    violationCode: '9-64-081',
  }, { supabase }));
  // Wrong violation code — must NOT fire
  assertSilent('non-winter-ban code should not fire', await checkWinterBan({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T04:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-010',
  }, { supabase }));

  console.log('\n=== 4. 2-inch Snow Route check ===');
  // Bad: 0964070 real code on a summer day at a non-snow-route address.
  // Network check fires first; weather check is the fallback.
  assertFires('0964070 random street + summer — fires', await checkTwoInchSnowRoute({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T08:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '0964070',
    violationDescription: "SNOW ROUTE: 2'' OF SNOW OR MORE",
  }, { supabase }));
  // Wrong type — silent
  assertSilent('Street cleaning ticket — silent', await checkTwoInchSnowRoute({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T08:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-010',
    violationDescription: 'STREET CLEANING',
  }, { supabase }));

  console.log('\n=== 5. No Parking in Loop check ===');
  // Bad: FOIA real code 0964180A in Edison Park
  assertFires('0964180A Edison Park — fires (real FOIA code)', await checkNoParkingInLoop({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.9929, longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '0964180A',
    violationDescription: 'NO PARKING IN LOOP',
  }));
  // Bad: Description-only path (no FOIA code on a fresh portal ticket)
  assertFires('Description "NO PARKING IN LOOP" without FOIA code — fires', await checkNoParkingInLoop({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.9929, longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '9-64-040',
    violationDescription: 'NO PARKING IN LOOP',
  }));
  // Good: real Loop address with Loop ticket
  assertSilent('Loop ticket at 100 W Adams (inside Loop) — silent', await checkNoParkingInLoop({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.8794, longitude: -87.6312,
    ticketAddress: '100 W ADAMS ST',
    violationCode: '0964180A',
    violationDescription: 'NO PARKING IN LOOP',
  }));
  // REGRESSION GUARD: our internal "9-64-180" = Handicapped Zone. Must NOT
  // fire on a handicapped ticket even though the address is outside the Loop.
  assertSilent('REGRESSION: 9-64-180 Handicapped ticket — silent (was bug)', await checkNoParkingInLoop({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.9929, longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '9-64-180',
    violationDescription: 'DISABLED PARKING WITHOUT PERMIT',
  }));

  console.log('\n=== 6. Expired Meter in CBD check ===');
  // Bad: FOIA real CBD code outside the CBD bounds
  assertFires('0964190B Hyde Park — fires', checkExpiredMeterCBD({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.7886, longitude: -87.5987,
    ticketAddress: '5300 S HYDE PARK BLVD',
    violationCode: '0964190B',
    violationDescription: 'EXPIRED METER CENTRAL BUSINESS DISTRICT',
  }));
  // Bad: Description path (portal scraper, no FOIA code yet)
  assertFires('Description "CBD" outside CBD — fires', checkExpiredMeterCBD({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.7886, longitude: -87.5987,
    ticketAddress: '5300 S HYDE PARK BLVD',
    violationCode: '9-64-170',
    violationDescription: 'EXP. METER CBD',
  }));
  // Good: CBD ticket inside the CBD
  assertSilent('CBD ticket inside CBD — silent', checkExpiredMeterCBD({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.8800, longitude: -87.6280,
    ticketAddress: '100 W ADAMS ST',
    violationCode: '0964190B',
    violationDescription: 'EXPIRED METER CENTRAL BUSINESS DISTRICT',
  }));
  // REGRESSION GUARD: our internal "9-64-190" = Rush Hour. Must NOT fire.
  assertSilent('REGRESSION: 9-64-190 Rush Hour ticket — silent (was bug)', checkExpiredMeterCBD({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T08:00:00',
    latitude: 41.7886, longitude: -87.5987,
    ticketAddress: '5300 S HYDE PARK BLVD',
    violationCode: '9-64-190',
    violationDescription: 'RUSH HOUR PARKING',
  }));
  // REGRESSION: non-CBD expired meter (0964190A) outside CBD must NOT fire
  assertSilent('REGRESSION: 0964190A non-CBD expired meter — silent', checkExpiredMeterCBD({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.7886, longitude: -87.5987,
    ticketAddress: '5300 S HYDE PARK BLVD',
    violationCode: '0964190A',
    violationDescription: 'EXP. METER NON-CENTRAL BUSINESS DISTRICT',
  }));

  console.log('\n=== 7. Address Transposition check ===');
  // Bad: geocode lands in Lake Michigan
  assertFires('Lake Michigan coordinates — flagged as water transposition', checkAddressTransposition({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.8781,
    longitude: -87.4000,  // ~5 miles offshore
    ticketAddress: '500 E MADISON ST',
    violationCode: '9-64-010',
  }));
  // Bad: Suburb (Skokie) coordinates
  assertFires('Skokie coordinates — outside city', checkAddressTransposition({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 42.0334,
    longitude: -87.7330,
    ticketAddress: '8000 N LINCOLN AVE',
    violationCode: '9-64-010',
  }));
  // Good: Real Chicago coordinates
  assertSilent('Real Chicago coordinates — silent', checkAddressTransposition({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.8781,
    longitude: -87.6298,
    ticketAddress: '100 W ADAMS ST',
    violationCode: '9-64-010',
  }));

  console.log('\n=== 8. End-to-end runAllUICChecks ===');
  // Loop ticket in Edison Park: should fire no_parking_loop_outside_loop.
  const findings = await runAllUICChecks({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T13:00:00',
    latitude: 41.9929, longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '0964180A',
    violationDescription: 'NO PARKING IN LOOP',
  }, { supabase });
  const ids = findings.map(f => f.id);
  console.log(`  ${findings.length} finding(s):`, ids.join(', '));
  if (!ids.includes('no_parking_loop_outside_loop')) {
    failures++;
    console.error('  FAIL: expected no_parking_loop_outside_loop in findings');
  } else {
    console.log('  PASS: end-to-end aggregator includes Loop-outside finding');
  }

  // Cross-fire regression: a Handicapped ticket (9-64-180 in OUR system)
  // should NOT trip the Loop check or any other UIC-style finding by code
  // collision alone.
  const cross = await runAllUICChecks({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T13:00:00',
    latitude: 41.9929, longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '9-64-180',  // internal = handicapped
    violationDescription: 'DISABLED PARKING WITHOUT PERMIT',
  }, { supabase });
  const crossIds = cross.map(f => f.id);
  const badLoop = crossIds.includes('no_parking_loop_outside_loop');
  const badCBD = crossIds.includes('expired_meter_cbd_outside_cbd');
  if (badLoop || badCBD) {
    failures++;
    console.error('  FAIL: Handicapped ticket misfired UIC checks:', crossIds.join(', '));
  } else {
    console.log('  PASS: Handicapped ticket does not misfire (cross-collision guard)');
  }

  console.log('\n──────────────────────────────────');
  if (failures === 0) {
    console.log(`ALL CHECKS PASSED.`);
    process.exit(0);
  } else {
    console.log(`${failures} FAILURE(S).`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Smoke test threw:', err);
  process.exit(1);
});
