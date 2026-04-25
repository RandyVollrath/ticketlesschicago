#!/usr/bin/env npx tsx
/**
 * Smoke test for lib/mapbox-reverse-geocode.
 *
 * Verifies the Geocoding v6 /reverse endpoint actually returns useful street
 * names for real parking-spot coordinates (the failure mode of the current
 * map-matching path is empty street + 0 confidence).
 *
 * Required env: MAPBOX_ACCESS_TOKEN
 *
 * Run:
 *   node -r dotenv/config node_modules/.bin/tsx \
 *     scripts/smoke-test-mapbox-reverse.ts dotenv_config_path=.env.local
 *
 * If MAPBOX_ACCESS_TOKEN isn't in .env.local (it's typically only in Vercel
 * production), set it inline:
 *   MAPBOX_ACCESS_TOKEN=pk.xxx node_modules/.bin/tsx \
 *     scripts/smoke-test-mapbox-reverse.ts
 *
 * Coordinates below are from real parking_diagnostics rows where the broken
 * map-matching path returned matched=true but with empty street name. Reverse
 * geocoding should return proper Chicago street names.
 */

import { mapboxReverseGeocode } from '../lib/mapbox-reverse-geocode';

interface Probe {
  label: string;
  lat: number;
  lng: number;
  expectStreet: RegExp;
}

const PROBES: Probe[] = [
  // row 50 - N Wolcott Ave (snap got it right at 6.6m, Mapbox map-match returned "")
  { label: 'N Wolcott Ave (row 50)', lat: 41.9685220198643, lng: -87.6761162690139, expectStreet: /wolcott/i },
  // row 48 - W Foster Ave (snap got it right at 11.7m, Mapbox map-match returned "")
  { label: 'W Foster Ave (row 48)', lat: 41.9759952186095, lng: -87.6893677710952, expectStreet: /foster/i },
  // row 56 - W Lawrence Ave (Metra ride per user, but coord still useful as a smoke probe)
  { label: 'W Lawrence Ave (row 56)', lat: 41.9689055784393, lng: -87.6757064344392, expectStreet: /lawrence|wolcott|foster/i },
];

async function main() {
  if (!process.env.MAPBOX_ACCESS_TOKEN) {
    console.error('FAIL: MAPBOX_ACCESS_TOKEN not set. Pull from Vercel or set inline.');
    process.exit(1);
  }

  let pass = 0;
  let fail = 0;
  for (const probe of PROBES) {
    process.stdout.write(`probe: ${probe.label} ... `);
    const t0 = Date.now();
    const r = await mapboxReverseGeocode(probe.lat, probe.lng);
    const ms = Date.now() - t0;
    const ok = r.matched && r.streetName != null && r.streetName !== '' && probe.expectStreet.test(r.streetName);
    if (ok) {
      console.log(`PASS (${ms}ms): ${r.streetName} #${r.houseNumber ?? '?'} [${r.featureType}, ${r.matchConfidence}]`);
      pass++;
    } else {
      console.log(`FAIL (${ms}ms): matched=${r.matched} street="${r.streetName ?? ''}" reason=${r.skipReason ?? 'street-mismatch'}`);
      console.log(`  full: ${JSON.stringify(r)}`);
      fail++;
    }
  }

  console.log(`\n${pass}/${pass + fail} probes passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('crash:', e); process.exit(1); });
