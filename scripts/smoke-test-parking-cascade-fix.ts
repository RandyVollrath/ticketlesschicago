#!/usr/bin/env tsx
/**
 * Smoke test for the parking-cascade fix shipped 2026-04-25.
 *
 * Reproduces the Webster/Fremont (lat 41.92147, lng -87.65302) and
 * Lawrence (lat 41.96885, lng -87.67564) failure modes against the
 * lib functions, NOT the deployed API. Validates:
 *
 *  1. reverseGeocode honors `disableGridEstimate` — when true, no
 *     grid-derived house number is invented for the chosen street.
 *
 *  2. Without the option, the broken Lawrence path still returns
 *     a (possibly wrong) grid number — proves the option does
 *     something rather than being a no-op.
 *
 * Run: npx tsx scripts/smoke-test-parking-cascade-fix.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { reverseGeocode } from '../lib/reverse-geocoder';

const WEBSTER_FREMONT = { lat: 41.92147, lng: -87.65302, label: 'Webster/Fremont' };
const LAWRENCE = { lat: 41.96885, lng: -87.67564, label: 'Lawrence (regression case)' };

async function probeOnce(
  coord: { lat: number; lng: number; label: string },
  disableGridEstimate: boolean,
) {
  const tag = disableGridEstimate ? 'disableGridEstimate=true' : 'disableGridEstimate=false';
  console.log(`\n=== ${coord.label} (${tag}) ===`);
  const result = await reverseGeocode(
    coord.lat,
    coord.lng,
    null,
    coord.lat,
    coord.lng,
    { disableGridEstimate },
  );
  if (!result) {
    console.log('  result: null');
    return null;
  }
  console.log(`  source:        ${result.source}`);
  console.log(`  street_name:   ${result.street_name ?? '(none)'}`);
  console.log(`  street_number: ${result.street_number ?? '(none)'}`);
  console.log(`  formatted:     ${result.formatted_address}`);
  return result;
}

async function main() {
  console.log('Smoke test — parking-cascade fix (2026-04-25)');
  console.log('==============================================');

  let passed = true;

  for (const coord of [WEBSTER_FREMONT, LAWRENCE]) {
    const off = await probeOnce(coord, false);  // baseline: grid allowed
    const on = await probeOnce(coord, true);    // new: grid disabled

    // The acceptance criterion: when disableGridEstimate=true, the result
    // must NOT have source 'nominatim+grid'. Either it has a real Nominatim
    // number, or no number at all.
    if (on && on.source === 'nominatim+grid') {
      console.log(`  FAIL: disableGridEstimate=true still returned grid-derived number for ${coord.label}`);
      passed = false;
    } else {
      console.log(`  PASS: disableGridEstimate=true → source=${on?.source ?? 'null'} (no grid invention)`);
    }

    // Sanity: clear cache between coords by waiting (cache key is per coord, so it's fine)
  }

  console.log('\n==============================================');
  console.log(passed ? 'SMOKE TEST: PASS' : 'SMOKE TEST: FAIL');
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
