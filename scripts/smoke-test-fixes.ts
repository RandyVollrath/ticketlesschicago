// Smoke-test the three fixes against the two real failure cases:
//   - Row #71 Belden+Kenmore (41.923483, -87.654546)
//   - Row #73 Lakewood-south-of-Fullerton (41.924949, -87.660748)
//
// Acceptance criteria for each:
//   1. snap_to_nearest_street within 80m includes the correct street.
//   2. With Fix #2 (radius 50m) + Fix #3 (toCenterlineFormat), the building
//      lookup returns a real address on the correct street.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Mirror toCenterlineFormat from check-parking.ts for the test.
function toCenterlineFormat(name: string): string {
  if (!name) return name;
  const upper = name.toUpperCase().trim();
  const DIR_FULL: Record<string, string> = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
  const TYPE_FULL: Record<string, string> = {
    AVENUE: 'AVE', STREET: 'ST', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR',
    PLACE: 'PL', COURT: 'CT', LANE: 'LN', PARKWAY: 'PKWY', HIGHWAY: 'HWY',
    TERRACE: 'TER', CIRCLE: 'CIR', SQUARE: 'SQ', PLAZA: 'PLZ', CROSSING: 'XING',
    EXPRESSWAY: 'EXPY', TRAIL: 'TRL', BRANCH: 'BR',
  };
  const tokens = upper.replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return upper;
  if (DIR_FULL[tokens[0]]) tokens[0] = DIR_FULL[tokens[0]];
  const last = tokens.length - 1;
  if (TYPE_FULL[tokens[last]]) tokens[last] = TYPE_FULL[tokens[last]];
  return tokens.join(' ');
}

const cases = [
  {
    label: 'Belden+Kenmore (row #71)',
    lat: 41.923482566459,
    lng: -87.6545456412439,
    nominatimStreet: 'West Belden Avenue',
    expectStreet: 'BELDEN',
    expectMaxNumber: 1099,
    expectMinNumber: 1000,
  },
  {
    label: 'Lakewood-south-of-Fullerton (row #73)',
    lat: 41.9249490105481,
    lng: -87.6607481023701,
    nominatimStreet: 'North Lakewood Avenue',
    expectStreet: 'LAKEWOOD',
    expectMaxNumber: 2399,
    expectMinNumber: 2300,
  },
];

async function main() {
  let failures = 0;

  for (const tc of cases) {
    console.log(`\n=== ${tc.label} ===`);
    console.log(`Nominatim says: "${tc.nominatimStreet}"`);
    console.log(`After toCenterlineFormat: "${toCenterlineFormat(tc.nominatimStreet)}"`);

    // 1. Initial snap (mimics check-parking 80m search).
    const { data: snapData } = await sb.rpc('snap_to_nearest_street', {
      user_lat: tc.lat,
      user_lng: tc.lng,
      search_radius_meters: 80,
    });
    const candidates = (snapData ?? []).filter((c: any) => c.was_snapped);
    console.log(`Initial snap candidates: ${candidates.map((c: any) => `${c.street_name}@${c.snap_distance_meters?.toFixed(1)}m`).join(', ')}`);

    // 2. Simulate Fix #3 (normalized find).
    const normChicagoStreet = (s: string) => s.toLowerCase()
      .replace(/^\s*(north|south|east|west|n|s|e|w)\s+/, '')
      .replace(/\s+(ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane|pkwy|parkway|hwy|highway|ter|terrace|way|cir|circle)\.?\s*$/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const target = normChicagoStreet(tc.nominatimStreet);
    const matched = candidates.find((c: any) => normChicagoStreet(c.street_name) === target);
    if (!matched) {
      console.log(`  ✗ FAIL: normalized find missed — target="${target}"`);
      failures++;
    } else {
      console.log(`  ✓ Fix #3 finds candidate: ${matched.street_name} @ ${matched.snap_distance_meters?.toFixed(1)}m`);
    }

    // 3. Simulate Fix #1 + #2: building lookup with centerline format + 50m radius.
    const expectedFmt = toCenterlineFormat(tc.nominatimStreet);
    const { data: bld } = await sb.rpc('nearest_address_point', {
      user_lat: tc.lat,
      user_lng: tc.lng,
      search_radius_meters: 50,
      expected_street: expectedFmt,
      expected_parity: null,
    });
    if (!bld || bld.length === 0) {
      console.log(`  ✗ FAIL: building lookup with expected_street="${expectedFmt}" r=50m → no match`);
      failures++;
    } else {
      const r = bld[0];
      const onRightStreet = r.full_street_name?.toUpperCase().includes(tc.expectStreet);
      const inRange = r.house_number >= tc.expectMinNumber && r.house_number <= tc.expectMaxNumber;
      const ok = onRightStreet && inRange;
      console.log(`  ${ok ? '✓' : '✗'} Building lookup: ${r.house_number} ${r.full_street_name} @ ${r.distance_meters?.toFixed(1)}m`);
      if (!ok) {
        console.log(`    on ${tc.expectStreet}=${onRightStreet}, in ${tc.expectMinNumber}-${tc.expectMaxNumber}=${inRange}`);
        failures++;
      }
    }
  }

  console.log(`\n=== ${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failure(s) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
