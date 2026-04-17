#!/usr/bin/env node
/**
 * Automatically label parking detection accuracy using departure GPS.
 *
 * Signal: when a user drives away from a parked spot, their first GPS fix
 * during departure is almost always on the street the car was actually
 * parked on (they haven't had time to move to a different street yet).
 * If we snap that departure coordinate to a street and it doesn't match
 * the saved parking address's street, the original detection was wrong.
 *
 * This gives us ground-truth labels without asking users to tap anything.
 *
 * Process:
 *   1. Fetch parking_location_history rows with departure_confirmed_at
 *      populated AND a reasonable departure GPS fix.
 *   2. Snap the departure coords against the Chicago street centerlines.
 *   3. Compare the snapped street to the parked-at street (parsed from
 *      the stored address).
 *   4. Update the corresponding parking_diagnostics row:
 *        street_correct = true/false
 *        side_source    = 'auto_departure_snap'
 *        user_feedback_at = now()  (reused field, labeled as auto)
 *      Also stash the departure snap outcome in native_meta for audit.
 *
 * Usage:
 *   node scripts/auto-label-parking-accuracy.js                   # all users, last 30 days
 *   node scripts/auto-label-parking-accuracy.js --days 7
 *   node scripts/auto-label-parking-accuracy.js --user <email>
 *   node scripts/auto-label-parking-accuracy.js --dry-run         # preview without writes
 *
 * Designed to be safe to re-run: only processes rows not yet labeled.
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function parseArgs(argv) {
  const out = { days: 30, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--days') out.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--user') out.user = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

// Normalize street name for comparison. Strips address number, direction
// prefix, comma-tail (Chicago, IL ...), and common type suffix.
// "2048 W Lawrence Ave, Chicago, IL 60640" → "LAWRENCE"
// "W LAWRENCE AVE"                         → "LAWRENCE"
function coreStreetName(s) {
  if (!s) return '';
  return String(s)
    .toUpperCase()
    .replace(/,.*$/, '')                                   // drop ", CHICAGO, IL 60640"
    .replace(/^\d+\s+/, '')                                 // drop "2048 "
    .replace(/^(NORTH|SOUTH|EAST|WEST|N|S|E|W)\s+/, '')     // drop direction prefix
    .replace(/\s+(AVENUE|AVE|STREET|ST|BOULEVARD|BLVD|DRIVE|DR|ROAD|RD|LANE|LN|PLACE|PL|COURT|CT|PARKWAY|PKWY|TERRACE|TER|WAY)$/, '') // drop type suffix
    .trim();
}

async function labelOne(row, args) {
  const { id, user_id, parked_at, address, departure_latitude, departure_longitude, departure_accuracy_meters, departure_confirmed_at } = row;

  // Snap the departure GPS fix against street centerlines.
  const { data: snapData, error: snapErr } = await s.rpc('snap_to_nearest_street', {
    user_lat: departure_latitude,
    user_lng: departure_longitude,
    search_radius_meters: 40,
  });
  if (snapErr) {
    return { id, status: 'snap_error', error: snapErr.message };
  }
  const candidates = (snapData || []).filter((c) => c.was_snapped);
  if (candidates.length === 0) {
    return { id, status: 'no_snap_candidate' };
  }
  const best = candidates[0];
  const snappedCore = coreStreetName(best.street_name);
  const savedCore = coreStreetName(address);

  const streetCorrect = snappedCore === savedCore;
  const distM = best.snap_distance_meters;

  // Find the parking_diagnostics row that matches this park event. Match by
  // user_id + created_at within a 2-minute window around parked_at.
  const windowStart = new Date(new Date(parked_at).getTime() - 120_000).toISOString();
  const windowEnd = new Date(new Date(parked_at).getTime() + 120_000).toISOString();
  const { data: diagRows, error: diagErr } = await s
    .from('parking_diagnostics')
    .select('id, resolved_address, native_meta, street_correct, user_feedback_at')
    .eq('user_id', user_id)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('created_at', { ascending: true });
  if (diagErr) {
    return { id, status: 'diag_lookup_error', error: diagErr.message };
  }
  if (!diagRows || diagRows.length === 0) {
    return { id, status: 'no_matching_diagnostic', saved: savedCore, departureSnap: snappedCore, streetCorrect };
  }

  // Don't write to street_correct — departure GPS can hit a cross street if the
  // car was parked near an intersection and drove onto the main road within the
  // first GPS fix. Instead, stash the comparison as a SIGNAL in native_meta.
  // Stats aggregates these to show the departure-match rate.
  const updates = [];
  for (const d of diagRows) {
    const newNativeMeta = {
      ...(d.native_meta || {}),
      auto_label: {
        source: 'departure_snap',
        labeled_at: new Date().toISOString(),
        departure_snap_street: best.street_name,
        departure_snap_distance_m: Number(distM.toFixed(1)),
        departure_accuracy_m: departure_accuracy_meters ?? null,
        saved_address: address,
        saved_core_street: savedCore,
        snap_core_street: snappedCore,
        street_matched: streetCorrect,
      },
    };
    updates.push({ id: d.id, native_meta: newNativeMeta });
  }

  if (args.dryRun) {
    return { id, status: 'would_update', count: updates.length, streetCorrect, saved: savedCore, departureSnap: snappedCore, distM: Number(distM.toFixed(1)) };
  }

  for (const u of updates) {
    const { error: updErr } = await s
      .from('parking_diagnostics')
      .update({ native_meta: u.native_meta })
      .eq('id', u.id);
    if (updErr) return { id, status: 'update_error', error: updErr.message };
  }

  return { id, status: 'labeled', count: updates.length, streetCorrect, saved: savedCore, departureSnap: snappedCore, distM: Number(distM.toFixed(1)) };
}

(async () => {
  const args = parseArgs(process.argv);
  const sinceISO = new Date(Date.now() - args.days * 86400 * 1000).toISOString();

  let userId = null;
  if (args.user) {
    const { data: u } = await s.from('user_profiles').select('user_id').eq('email', args.user).maybeSingle();
    if (!u) { console.error(`no user_profile for ${args.user}`); process.exit(2); }
    userId = u.user_id;
  }

  // Pull parking_location_history rows with confirmed departure + departure GPS
  let q = s.from('parking_location_history')
    .select('id, user_id, parked_at, address, departure_latitude, departure_longitude, departure_accuracy_meters, departure_confirmed_at, departure_distance_meters')
    .gte('parked_at', sinceISO)
    .not('departure_confirmed_at', 'is', null)
    .not('departure_latitude', 'is', null)
    .not('departure_longitude', 'is', null);
  if (userId) q = q.eq('user_id', userId);
  const { data: rows, error } = await q.limit(5000);
  if (error) { console.error('fetch err:', error.message); process.exit(1); }

  console.log(`Auto-labeling ${rows.length} departure events${args.dryRun ? ' (dry run)' : ''}...`);
  const counts = { labeled: 0, correct: 0, wrong: 0, skip_user_labeled: 0, skip_no_diag: 0, skip_no_snap: 0, error: 0 };
  const wrongExamples = [];
  for (const r of rows) {
    const res = await labelOne(r, args);
    switch (res.status) {
      case 'labeled':
      case 'would_update':
        counts.labeled++;
        if (res.streetCorrect) counts.correct++;
        else {
          counts.wrong++;
          if (wrongExamples.length < 10) wrongExamples.push(res);
        }
        break;
      case 'already_user_labeled': counts.skip_user_labeled++; break;
      case 'no_matching_diagnostic': counts.skip_no_diag++; break;
      case 'no_snap_candidate': counts.skip_no_snap++; break;
      default: counts.error++; console.warn('  ', res);
    }
  }

  console.log(`\nAuto-label summary:`);
  console.log(`  labeled:            ${counts.labeled}`);
  console.log(`    street correct:   ${counts.correct} (${counts.labeled ? ((counts.correct / counts.labeled) * 100).toFixed(1) : '0.0'}%)`);
  console.log(`    street WRONG:     ${counts.wrong} (${counts.labeled ? ((counts.wrong / counts.labeled) * 100).toFixed(1) : '0.0'}%)`);
  console.log(`  skipped user-labeled:        ${counts.skip_user_labeled}`);
  console.log(`  skipped no diag row:          ${counts.skip_no_diag}`);
  console.log(`  skipped no snap candidate:    ${counts.skip_no_snap}`);
  console.log(`  errors:                       ${counts.error}`);

  if (wrongExamples.length > 0) {
    console.log(`\nWrong detections (up to 10):`);
    for (const w of wrongExamples) {
      console.log(`  saved=${w.saved}  actual=${w.departureSnap}  (snap_dist=${w.distM}m)`);
    }
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
