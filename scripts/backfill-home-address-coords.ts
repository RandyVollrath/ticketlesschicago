// One-shot audit + optional backfill of user_profiles home address geocoding.
//
// Background — why this exists:
// Up until commit aa5b29... the server-side path that resolved a typed
// Chicago address to lat/lng/ward/section used the legacy Maps Geocoding
// API. On grid streets like Fullerton it interpolated along OSM segments
// and landed a full block off (e.g. "1237 W Fullerton" pinned at
// Sheffield/Fullerton lng=-87.6537 instead of Lakewood lng=-87.6599).
// That bad coord then got fed into find_section_for_point and stored as
// home_address_ward / home_address_section, so any user who signed up
// via the affected pipeline on a grid street has been receiving the
// wrong section's cleaning notifications. The Places API
// autocomplete+details fix landed today; this script audits historical
// rows and optionally rewrites them.
//
// Usage:
//   node -r dotenv/config node_modules/.bin/tsx scripts/backfill-home-address-coords.ts dotenv_config_path=.env.local
//   node -r dotenv/config node_modules/.bin/tsx scripts/backfill-home-address-coords.ts --apply dotenv_config_path=.env.local
//
// Default mode is dry-run (no writes). Pass --apply to actually update
// user_profiles.home_address_lat / _lng / _ward / _section.
//
// What does NOT get changed: home_address_full (the string itself).
// We're correcting derived fields; the user-typed address is left alone.

import { createClient } from '@supabase/supabase-js';
import { geocodeChicagoAddress } from '../lib/places-geocoder';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const arg = process.argv.find(a => a.startsWith('--limit='));
  return arg ? parseInt(arg.split('=')[1], 10) : 0;
})();
const CONCURRENCY = 4;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

interface Row {
  user_id: string;
  email: string | null;
  home_address_full: string | null;
  home_address_lat: number | null;
  home_address_lng: number | null;
  home_address_ward: string | null;
  home_address_section: string | null;
}

interface Outcome {
  user_id: string;
  email: string | null;
  address: string;
  oldLat: number | null;
  oldLng: number | null;
  oldWard: string | null;
  oldSection: string | null;
  newLat: number | null;
  newLng: number | null;
  newWard: string | null;
  newSection: string | null;
  classification:
    | 'unchanged'
    | 'coord_drift_only'
    | 'ward_section_drift'
    | 'newly_resolved'
    | 'no_geocode'
    | 'no_section';
  notes?: string;
}

async function findSectionFor(lat: number, lng: number): Promise<{ ward: string | null; section: string | null }> {
  const { data, error } = await (supa.rpc as any)('find_section_for_point', { lon: lng, lat });
  if (error || !data?.length) return { ward: null, section: null };
  return { ward: String(data[0].ward), section: String(data[0].section) };
}

function classify(o: Omit<Outcome, 'classification' | 'notes'>): Outcome['classification'] {
  if (o.newLat === null || o.newLng === null) return 'no_geocode';
  if (o.newWard === null) return 'no_section';
  if (o.oldWard === null && o.oldSection === null && o.oldLat === null) return 'newly_resolved';
  const wardChanged = String(o.oldWard ?? '') !== String(o.newWard ?? '');
  const sectionChanged = String(o.oldSection ?? '') !== String(o.newSection ?? '');
  if (wardChanged || sectionChanged) return 'ward_section_drift';

  const latDelta = Math.abs((o.oldLat ?? 0) - (o.newLat ?? 0));
  const lngDelta = Math.abs((o.oldLng ?? 0) - (o.newLng ?? 0));
  // ~0.001° lat/lng ≈ 110m. A whole block is ~150m so we flag drift over 0.0008.
  if (latDelta > 0.0008 || lngDelta > 0.0008) return 'coord_drift_only';
  return 'unchanged';
}

async function processRow(row: Row): Promise<Outcome> {
  const address = (row.home_address_full || '').trim();
  const baseOutcome: Omit<Outcome, 'classification' | 'notes'> = {
    user_id: row.user_id,
    email: row.email,
    address,
    oldLat: row.home_address_lat,
    oldLng: row.home_address_lng,
    oldWard: row.home_address_ward,
    oldSection: row.home_address_section,
    newLat: null,
    newLng: null,
    newWard: null,
    newSection: null,
  };

  if (!address) {
    return { ...baseOutcome, classification: 'no_geocode', notes: 'empty home_address_full' };
  }

  const geo = await geocodeChicagoAddress(address);
  if (geo.status !== 'OK' || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
    return {
      ...baseOutcome,
      classification: 'no_geocode',
      notes: `geocode status=${geo.status}${geo.errorMessage ? ` (${geo.errorMessage})` : ''}`,
    };
  }
  baseOutcome.newLat = geo.lat;
  baseOutcome.newLng = geo.lng;

  const { ward, section } = await findSectionFor(geo.lat, geo.lng);
  baseOutcome.newWard = ward;
  baseOutcome.newSection = section;

  return { ...baseOutcome, classification: classify(baseOutcome) };
}

async function applyUpdate(o: Outcome) {
  if (o.newLat === null || o.newLng === null) return;
  const patch: Record<string, unknown> = {
    home_address_lat: o.newLat,
    home_address_lng: o.newLng,
  };
  if (o.newWard !== null) patch.home_address_ward = o.newWard;
  if (o.newSection !== null) patch.home_address_section = o.newSection;

  const { error } = await supa
    .from('user_profiles')
    .update(patch)
    .eq('user_id', o.user_id);
  if (error) {
    console.error(`  ! update failed for ${o.user_id}: ${error.message}`);
  }
}

async function main() {
  console.log(`backfill mode: ${APPLY ? 'APPLY (writes)' : 'dry-run (read-only)'}`);
  if (LIMIT) console.log(`limit: ${LIMIT}`);

  let query = supa
    .from('user_profiles')
    .select('user_id, email, home_address_full, home_address_lat, home_address_lng, home_address_ward, home_address_section')
    .not('home_address_full', 'is', null);
  if (LIMIT) query = query.limit(LIMIT);

  const { data: rows, error } = await query;
  if (error) {
    console.error('query failed:', error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log('no rows to audit');
    return;
  }
  console.log(`auditing ${rows.length} rows with ${CONCURRENCY}-way concurrency\n`);

  const outcomes: Outcome[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(r => processRow(r as Row)));
    outcomes.push(...results);
    if ((i / CONCURRENCY) % 10 === 0) {
      process.stdout.write(`  ${outcomes.length}/${rows.length}\r`);
    }
  }
  console.log(`  ${outcomes.length}/${rows.length} done`);

  // Summary by classification
  const counts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.classification] = (acc[o.classification] || 0) + 1;
    return acc;
  }, {});
  console.log('\nclassification:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(22)} ${v}`);

  // Show all ward/section drift cases — these are the customer-visible bug
  const drifts = outcomes.filter(o => o.classification === 'ward_section_drift');
  if (drifts.length > 0) {
    console.log(`\nward/section drift (${drifts.length} users get wrong cleaning notifications today):`);
    for (const d of drifts) {
      console.log(
        `  ${d.email || d.user_id}  "${d.address}"\n` +
        `    OLD: ward=${d.oldWard} section=${d.oldSection} lng=${d.oldLng}\n` +
        `    NEW: ward=${d.newWard} section=${d.newSection} lng=${d.newLng}`,
      );
    }
  }

  // Show a sample of coord drift cases (no ward change but coord moved)
  const coordDrifts = outcomes.filter(o => o.classification === 'coord_drift_only');
  if (coordDrifts.length > 0) {
    console.log(`\ncoord-only drift (${coordDrifts.length} rows, ward+section unchanged) — first 10:`);
    for (const c of coordDrifts.slice(0, 10)) {
      console.log(
        `  ${c.email || c.user_id}  "${c.address}"  ` +
        `lng ${c.oldLng?.toFixed(5) ?? 'null'} -> ${c.newLng?.toFixed(5)}`,
      );
    }
  }

  // Newly resolved (no prior coords/ward/section at all)
  const newlyResolved = outcomes.filter(o => o.classification === 'newly_resolved');
  if (newlyResolved.length > 0) {
    console.log(`\nnewly resolved (${newlyResolved.length} rows had no stored coords/ward) — first 10:`);
    for (const n of newlyResolved.slice(0, 10)) {
      console.log(
        `  ${n.email || n.user_id}  "${n.address}"  ` +
        `-> ward=${n.newWard} section=${n.newSection}`,
      );
    }
  }

  // Geocode failures — addresses we couldn't resolve at all
  const noGeocode = outcomes.filter(o => o.classification === 'no_geocode');
  if (noGeocode.length > 0) {
    console.log(`\nun-geocoded (${noGeocode.length} rows — cannot fix without manual intervention) — first 10:`);
    for (const n of noGeocode.slice(0, 10)) {
      console.log(`  ${n.email || n.user_id}  "${n.address}"  (${n.notes})`);
    }
  }

  // Apply the write phase
  if (APPLY) {
    const writable = outcomes.filter(
      o => o.classification === 'ward_section_drift' || o.classification === 'coord_drift_only' || o.classification === 'newly_resolved',
    );
    console.log(`\napplying updates to ${writable.length} rows...`);
    for (let i = 0; i < writable.length; i += CONCURRENCY) {
      const batch = writable.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(applyUpdate));
    }
    console.log('done');
  } else {
    const fixable = outcomes.filter(
      o => o.classification === 'ward_section_drift' || o.classification === 'coord_drift_only' || o.classification === 'newly_resolved',
    ).length;
    console.log(`\ndry-run complete. Re-run with --apply to update ${fixable} rows.`);
  }
}

main().catch(err => {
  console.error('crashed:', err);
  process.exit(1);
});
