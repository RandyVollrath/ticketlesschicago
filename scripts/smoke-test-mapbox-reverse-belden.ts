// Smoke-test: confirm Mapbox Geocoding v6 reverse returns 1035 W Belden
// for row #71's GPS (the parking event the user reported as "spot on map,
// wrong street number 1139").
//
// Acceptance criteria:
//   1. mbRev.matched === true
//   2. mbRev.featureType === 'address'
//   3. mbRev.streetName matches "Belden"
//   4. mbRev.houseNumber parses to a positive integer in the 1000-1099 block
//      (i.e., the same block as Kenmore Ave / Belden), NOT 1139.
//
// Exit code 0 = pass, 1 = fail.

import 'dotenv/config';
import { mapboxReverseGeocode } from '../lib/mapbox-reverse-geocode';

async function main() {
  // Coordinates from parking_diagnostics row #71 (2026-04-27 00:40:53 UTC).
  // User parked just east of Kenmore on Belden.
  const lat = 41.923482566459;
  const lng = -87.6545456412439;

  const result = await mapboxReverseGeocode(lat, lng);
  console.log('Mapbox-reverse result:', JSON.stringify(result, null, 2));

  const failures: string[] = [];
  if (!result.matched) failures.push('mbRev.matched is false');
  if (result.featureType !== 'address') failures.push(`featureType=${result.featureType}, expected 'address'`);
  if (!result.streetName || !/belden/i.test(result.streetName)) failures.push(`streetName=${result.streetName}, expected to contain 'Belden'`);

  const num = result.houseNumber ? Number.parseInt(result.houseNumber, 10) : NaN;
  if (!Number.isFinite(num) || num <= 0) {
    failures.push(`houseNumber=${result.houseNumber} did not parse to a positive integer`);
  } else if (num >= 1100) {
    failures.push(`houseNumber=${num} is in the 1100+ block (grid-estimator error reproduced); expected 1000-1099 near Kenmore`);
  } else {
    console.log(`✓ houseNumber=${num} is in the 1000-1099 block — confirms Mapbox-reverse beats grid-estimator's 1139.`);
  }

  if (failures.length > 0) {
    console.error('\nFAIL:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nPASS: Mapbox-reverse returns a usable house number for row #71 coordinates.');
}

main().catch((e) => { console.error(e); process.exit(1); });
