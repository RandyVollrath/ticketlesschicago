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
  // We use a random suburban location with no permits to ensure the "no
  // permit found" path fires. This is a real call to the real RPC.
  assertFires('No permit at distant address — should fire', await checkSpecialEventsPermitCoverage({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T18:00:00',
    latitude: 41.7000,  // South Side, away from any typical event
    longitude: -87.6500,
    ticketAddress: '6300 S WENTWORTH AVE',
    violationCode: '9-64-041',
  }, { supabase }));
  // Different violation code — must NOT fire
  assertSilent('non-special-events code should not fire', await checkSpecialEventsPermitCoverage({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T18:00:00',
    latitude: 41.8781,
    longitude: -87.6298,
    ticketAddress: '100 N STATE ST',
    violationCode: '9-64-040',
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
  // Bad: ticket issued on a summer day with zero snowfall in prior 3 days
  assertFires('July ticket — no snowfall', await checkTwoInchSnowRoute({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T08:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-100',
  }));
  // Wrong violation code — must NOT fire
  assertSilent('non-snow-route code should not fire', await checkTwoInchSnowRoute({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T08:00:00',
    latitude: 41.96, longitude: -87.66,
    ticketAddress: '1234 W BELMONT AVE',
    violationCode: '9-64-010',
  }));

  console.log('\n=== 5. No Parking in Loop check ===');
  // Bad: a No-Loop ticket issued in Edison Park (per UIC, this happened)
  assertFires('Edison Park location — outside the Loop', await checkNoParkingInLoop({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.9929,  // Edison Park, far NW
    longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '9-64-180',
  }));
  // Good: a real Loop address
  assertSilent('100 W Adams (in the Loop) — should be silent', await checkNoParkingInLoop({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.8794,
    longitude: -87.6312,
    ticketAddress: '100 W ADAMS ST',
    violationCode: '9-64-180',
  }));
  // Wrong code — silent
  assertSilent('non-loop code should not fire', await checkNoParkingInLoop({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.9929,
    longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '9-64-010',
  }));

  console.log('\n=== 6. Expired Meter in CBD check ===');
  // Bad: CBD ticket issued in Hyde Park (south of Roosevelt Rd)
  assertFires('Hyde Park CBD ticket — outside CBD', checkExpiredMeterCBD({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.7886,
    longitude: -87.5987,
    ticketAddress: '5300 S HYDE PARK BLVD',
    violationCode: '9-64-190',
  }));
  // Good: CBD ticket issued inside CBD
  assertSilent('Inside CBD bounds — silent', checkExpiredMeterCBD({
    issueDate: '2025-06-15',
    issueDateTime: '2025-06-15T13:00:00',
    latitude: 41.8800,
    longitude: -87.6280,
    ticketAddress: '100 W ADAMS ST',
    violationCode: '9-64-190',
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
  const findings = await runAllUICChecks({
    issueDate: '2025-07-15',
    issueDateTime: '2025-07-15T04:30:00',
    latitude: 41.9929,
    longitude: -87.8146,
    ticketAddress: '6800 N OLIPHANT AVE',
    violationCode: '9-64-180',
  }, { supabase });
  console.log(`  ${findings.length} finding(s):`, findings.map(f => f.id).join(', '));
  if (findings.length === 0) {
    failures++;
    console.error('  FAIL: expected at least 1 finding (the Loop-outside check)');
  } else {
    console.log('  PASS: end-to-end aggregator returns findings');
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
