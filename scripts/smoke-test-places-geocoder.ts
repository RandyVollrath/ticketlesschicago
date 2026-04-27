// Smoke test for the production Places-API-based geocoder.
//
// Ship rule (CLAUDE.md): "compiles + a subagent says it works" is not the
// same as "I saw it work." This hits real production endpoints with known
// Chicago grid addresses where the legacy Geocoding API used to land a
// block off, asserts the returned ward+section is correct, and exits
// non-zero on regression. Run after any change that touches geocoding:
//
//   npx tsx scripts/smoke-test-places-geocoder.ts
//
// Defaults to https://www.autopilotamerica.com — override with
//   SMOKE_BASE_URL=https://your-deploy-url.vercel.app npx tsx ...
//
// What gets asserted:
// - find-section returns expected ward/section/lng for the Fullerton/Lakewood
//   block (the canonical Fullerton-bug regression case)
// - find-section also resolves a few other grid streets to non-null wards
// - validate-address returns valid:true for Chicago and valid:false with the
//   "appears to be in {city}, not Chicago" message for an out-of-city address
// - Exit code 0 on full pass, 1 on any failure

const BASE = process.env.SMOKE_BASE_URL || 'https://www.autopilotamerica.com';

interface FindSectionResp {
  ward?: string;
  section?: string;
  coordinates?: { lat: number; lng: number };
  nextCleaningDate?: string | null;
  error?: string;
}

interface ValidateAddressResp {
  valid: boolean;
  ward?: string | number;
  section?: string;
  message?: string;
  coordinates?: { lat: number; lng: number };
}

let passes = 0;
let failures = 0;
const failed: string[] = [];

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passes++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
    failed.push(name);
  }
}

async function findSection(address: string): Promise<FindSectionResp> {
  const url = `${BASE}/api/find-section?address=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  return res.json();
}

async function validateAddress(address: string): Promise<ValidateAddressResp> {
  const res = await fetch(`${BASE}/api/validate-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  return res.json();
}

async function main() {
  console.log(`smoke-test-places-geocoder against ${BASE}\n`);

  // The canonical Fullerton case. Legacy API returned -87.6537 (Sheffield/
  // Fullerton, Ward 43). Correct answer is -87.6599xx (Lakewood block, Ward 2).
  console.log('find-section: 1237 W Fullerton Ave (Fullerton-bug regression)');
  const fullerton = await findSection('1237 W Fullerton Ave, Chicago, IL');
  assert('ward is "2"', fullerton.ward === '2', `got ward=${fullerton.ward}`);
  assert('section is "1"', fullerton.section === '1', `got section=${fullerton.section}`);
  assert(
    'lng is west of -87.659 (real building, not interpolated -87.6537)',
    typeof fullerton.coordinates?.lng === 'number' && fullerton.coordinates.lng < -87.658,
    `got lng=${fullerton.coordinates?.lng}`,
  );

  // Smoke a few more grid addresses — just confirm they resolve to a ward.
  // These are sanity checks for "did we break the common case."
  const grid = [
    '2200 N Lakewood Ave',
    '1234 N State St',
    '4500 N Lincoln Ave',
    '1600 N Damen Ave',
  ];
  console.log('\nfind-section: other grid addresses');
  for (const addr of grid) {
    const r = await findSection(addr);
    assert(`${addr} returns a ward`, !!r.ward, `got ward=${r.ward}, error=${r.error || ''}`);
    assert(`${addr} returns a section`, !!r.section, `got section=${r.section}`);
  }

  // validate-address Chicago path
  console.log('\nvalidate-address: 1237 W Fullerton Ave (in Chicago)');
  const va1 = await validateAddress('1237 W Fullerton Ave');
  assert('valid:true', va1.valid === true, JSON.stringify(va1));
  assert('coordinates land in Lakewood (lng < -87.658)', typeof va1.coordinates?.lng === 'number' && va1.coordinates.lng < -87.658, `got lng=${va1.coordinates?.lng}`);

  // validate-address NOT_CHICAGO path
  console.log('\nvalidate-address: 1900 Sherman Ave, Evanston, IL (not in Chicago)');
  const va2 = await validateAddress('1900 Sherman Ave, Evanston, IL');
  assert('valid:false', va2.valid === false);
  assert(
    'rejection mentions Evanston',
    typeof va2.message === 'string' && /evanston/i.test(va2.message),
    `got: ${va2.message}`,
  );

  console.log(`\nResult: ${passes} passed, ${failures} failed`);
  if (failures) {
    console.log('Failed cases:');
    for (const f of failed) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('smoke-test crashed:', err);
  process.exit(1);
});
