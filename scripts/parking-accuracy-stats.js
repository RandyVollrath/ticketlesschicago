#!/usr/bin/env node
/**
 * Parking detection accuracy stats.
 *
 * Breaks down recent parking_diagnostics rows by:
 *   - gps_source (stop_start vs current_fallback vs etc) — tells us how often
 *     the native anchor held vs fell back to walk-away-risk GPS
 *   - snap outcome (street agreed with Nominatim, overridden, single-candidate)
 *   - heading source (compass, gps, none) — compass is more reliable at stop
 *   - near_intersection rate — where wrong-street errors cluster
 *   - user feedback (street_correct, side_correct) when users tap
 *     Correct/Wrong notification actions
 *
 * Usage:
 *   node scripts/parking-accuracy-stats.js                # last 7 days, all users
 *   node scripts/parking-accuracy-stats.js --days 30      # custom window
 *   node scripts/parking-accuracy-stats.js --user <email> # one user only
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const s = createClient(url, key, { auth: { persistSession: false } });

function parseArgs(argv) {
  const out = { days: 7 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--days') out.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--user') out.user = argv[++i];
  }
  return out;
}

function pct(n, total) {
  if (!total) return '  -  ';
  return `${((n / total) * 100).toFixed(1).padStart(4)}%`;
}

function histogram(rows, key, opts = {}) {
  const { label = key, showNull = true } = opts;
  const counts = new Map();
  for (const r of rows) {
    const v = r[key];
    if (v == null && !showNull) continue;
    const k = v == null ? '(null)' : String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  console.log(`\n${label}  (total=${total})`);
  console.log('─'.repeat(60));
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [v, n] of sorted) {
    console.log(`  ${pct(n, total)}  ${String(n).padStart(5)}  ${v}`);
  }
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

  let q = s.from('parking_diagnostics')
    .select('gps_source,heading_source,heading_orientation,nominatim_agreed,nominatim_overrode,heading_confirmed_snap,near_intersection,snap_source,snap_candidates_count,snap_distance_meters,street_correct,side_correct,user_confirmed_parking,walkaway_guard_fired,created_at,walkaway_details,native_meta')
    .gte('created_at', sinceISO);
  if (userId) q = q.eq('user_id', userId);
  const { data: rows, error } = await q.limit(20000);
  if (error) { console.error('query err:', error.message); process.exit(1); }

  console.log(`\nParking accuracy — last ${args.days} day${args.days === 1 ? '' : 's'}${args.user ? ` (${args.user})` : ' (all users)'}`);
  console.log(`Since ${sinceISO}`);
  console.log(`Rows: ${rows.length}`);

  // GPS source — the big one. stop_start/last_driving/pre-captured/driving-buffer are good.
  // current_fallback is bad. null = missing instrumentation (older build).
  const GOOD_SOURCES = new Set(['stop_start', 'last_driving', 'pre-captured', 'driving-buffer', 'recent_low_speed']);
  const MIXED_SOURCES = new Set(['current_refined']);
  const BAD_SOURCES = new Set(['current_fallback']);

  const sourceCounts = { good: 0, mixed: 0, bad: 0, unknown: 0 };
  for (const r of rows) {
    if (!r.gps_source) sourceCounts.unknown++;
    else if (GOOD_SOURCES.has(r.gps_source)) sourceCounts.good++;
    else if (MIXED_SOURCES.has(r.gps_source)) sourceCounts.mixed++;
    else if (BAD_SOURCES.has(r.gps_source)) sourceCounts.bad++;
    else sourceCounts.unknown++;
  }
  const sourceTotal = rows.length;
  console.log(`\nGPS capture quality`);
  console.log('─'.repeat(60));
  console.log(`  ${pct(sourceCounts.good, sourceTotal)}  ${String(sourceCounts.good).padStart(5)}  good (stop_start / last_driving / pre-captured / driving-buffer)`);
  console.log(`  ${pct(sourceCounts.mixed, sourceTotal)}  ${String(sourceCounts.mixed).padStart(5)}  mixed (current_refined — replaced stop_start with fresh GPS)`);
  console.log(`  ${pct(sourceCounts.bad, sourceTotal)}  ${String(sourceCounts.bad).padStart(5)}  bad  (current_fallback — walk-away-risk; now rejected client-side)`);
  console.log(`  ${pct(sourceCounts.unknown, sourceTotal)}  ${String(sourceCounts.unknown).padStart(5)}  unknown (older build, no native meta logged yet)`);

  histogram(rows, 'gps_source', { label: 'gps_source breakdown' });
  histogram(rows, 'snap_source', { label: 'snap_source' });
  histogram(rows, 'heading_source', { label: 'heading_source' });
  histogram(rows, 'heading_orientation', { label: 'heading_orientation' });

  // Nominatim / snap disagreement
  const agreed = rows.filter((r) => r.nominatim_agreed === true).length;
  const disagreedAndOverrode = rows.filter((r) => r.nominatim_overrode === true).length;
  const disagreedKeptSnap = rows.filter((r) => r.nominatim_agreed === false && r.nominatim_overrode === false).length;
  const nomTotal = agreed + disagreedAndOverrode + disagreedKeptSnap;
  console.log(`\nSnap vs Nominatim  (rows w/ both: ${nomTotal})`);
  console.log('─'.repeat(60));
  console.log(`  ${pct(agreed, nomTotal)}  ${String(agreed).padStart(5)}  agreed`);
  console.log(`  ${pct(disagreedAndOverrode, nomTotal)}  ${String(disagreedAndOverrode).padStart(5)}  disagreed → Nominatim won`);
  console.log(`  ${pct(disagreedKeptSnap, nomTotal)}  ${String(disagreedKeptSnap).padStart(5)}  disagreed → snap kept (heading confirmed)`);

  // Intersection + snap quality
  const nearInt = rows.filter((r) => r.near_intersection === true).length;
  const singleCand = rows.filter((r) => r.snap_candidates_count === 1).length;
  const multiCand = rows.filter((r) => r.snap_candidates_count > 1).length;
  console.log(`\nSnap geometry`);
  console.log('─'.repeat(60));
  console.log(`  ${pct(nearInt, rows.length)}  ${String(nearInt).padStart(5)}  near_intersection=true`);
  console.log(`  ${pct(singleCand, rows.length)}  ${String(singleCand).padStart(5)}  snap found 1 candidate only`);
  console.log(`  ${pct(multiCand, rows.length)}  ${String(multiCand).padStart(5)}  snap found 2+ candidates`);

  // User feedback (ground truth) — only exists for rows the user tapped on
  const withFeedback = rows.filter((r) => r.street_correct != null || r.side_correct != null);
  if (withFeedback.length > 0) {
    const streetCorrect = withFeedback.filter((r) => r.street_correct === true).length;
    const streetWrong = withFeedback.filter((r) => r.street_correct === false).length;
    const sideCorrect = withFeedback.filter((r) => r.side_correct === true).length;
    const sideWrong = withFeedback.filter((r) => r.side_correct === false).length;
    console.log(`\nUser feedback  (rated: ${withFeedback.length})`);
    console.log('─'.repeat(60));
    console.log(`  ${pct(streetCorrect, streetCorrect + streetWrong)}  ${String(streetCorrect).padStart(5)}  street correct`);
    console.log(`  ${pct(streetWrong, streetCorrect + streetWrong)}  ${String(streetWrong).padStart(5)}  street wrong`);
    if (sideCorrect + sideWrong > 0) {
      console.log(`  ${pct(sideCorrect, sideCorrect + sideWrong)}  ${String(sideCorrect).padStart(5)}  side correct`);
      console.log(`  ${pct(sideWrong, sideCorrect + sideWrong)}  ${String(sideWrong).padStart(5)}  side wrong`);
    }
  } else {
    console.log(`\nUser feedback: no rated rows in window`);
  }

  // Auto-label signal from departure snap. Noisy (car parked near intersection
  // and departs onto main street can flip the signal), but aggregated across
  // events it's a meaningful proxy for "how often did we probably get the
  // street wrong?" — especially when combined with other indicators.
  const autoLabeled = rows.filter((r) => r.native_meta?.auto_label?.source === 'departure_snap');
  if (autoLabeled.length > 0) {
    const matched = autoLabeled.filter((r) => r.native_meta.auto_label.street_matched === true).length;
    const unmatched = autoLabeled.filter((r) => r.native_meta.auto_label.street_matched === false).length;
    console.log(`\nDeparture-snap auto-label  (events: ${autoLabeled.length})`);
    console.log('─'.repeat(60));
    console.log(`  ${pct(matched, autoLabeled.length)}  ${String(matched).padStart(5)}  saved street matches departure snap`);
    console.log(`  ${pct(unmatched, autoLabeled.length)}  ${String(unmatched).padStart(5)}  saved street differs from departure snap (maybe wrong, maybe just departed onto cross street)`);
    console.log(`  ${''.padStart(6)}  Run: node scripts/auto-label-parking-accuracy.js  to refresh`);
  }

  // Nominatim-override accuracy — only meaningful for rows with user feedback
  const fbRows = rows.filter((r) => r.street_correct != null);
  if (fbRows.length > 0) {
    const buckets = {
      'agreed (nominatim+snap same)':        { total: 0, correct: 0 },
      'disagreed, nominatim won':            { total: 0, correct: 0 },
      'disagreed, snap kept (heading won)':  { total: 0, correct: 0 },
    };
    for (const r of fbRows) {
      let key;
      if (r.nominatim_agreed === true) key = 'agreed (nominatim+snap same)';
      else if (r.nominatim_overrode === true) key = 'disagreed, nominatim won';
      else if (r.nominatim_agreed === false) key = 'disagreed, snap kept (heading won)';
      else continue;
      buckets[key].total++;
      if (r.street_correct) buckets[key].correct++;
    }
    console.log(`\nNominatim-override street accuracy  (rated: ${fbRows.length})`);
    console.log('─'.repeat(60));
    for (const [k, v] of Object.entries(buckets)) {
      if (v.total === 0) continue;
      const acc = (v.correct / v.total * 100).toFixed(1);
      console.log(`  ${acc.padStart(5)}%  ${String(v.correct).padStart(3)}/${String(v.total).padStart(3)}  ${k}`);
    }
  }

  // Heading disagreement (GPS vs compass) — new native_meta field
  const disagreeRows = rows.filter((r) => r.native_meta?.headingDisagreementDeg != null);
  if (disagreeRows.length > 0) {
    const big = disagreeRows.filter((r) => r.native_meta.headingDisagreementDeg > 45);
    const huge = disagreeRows.filter((r) => r.native_meta.headingDisagreementDeg > 90);
    const preferredGps = disagreeRows.filter((r) => r.native_meta.headingPreferredSource === 'gps');
    console.log(`\nGPS vs compass heading agreement  (both available: ${disagreeRows.length})`);
    console.log('─'.repeat(60));
    console.log(`  ${pct(disagreeRows.length - big.length, disagreeRows.length)}  agree (<45° apart)`);
    console.log(`  ${pct(big.length - huge.length, disagreeRows.length)}  disagree 45-90°  → GPS preferred for disambiguation`);
    console.log(`  ${pct(huge.length, disagreeRows.length)}  disagree >90°    → GPS preferred`);
    console.log(`  (preferred GPS ${preferredGps.length} times)`);
  }

  // Walkaway drift (prefer new native_meta column, fall back to nested stash in walkaway_details)
  const drifts = [];
  for (const r of rows) {
    const d = r.native_meta?.driftFromParkingMeters ?? r.walkaway_details?.native_meta?.driftFromParkingMeters;
    if (typeof d === 'number' && d >= 0) drifts.push(d);
  }
  if (drifts.length > 0) {
    drifts.sort((a, b) => a - b);
    const p50 = drifts[Math.floor(drifts.length / 2)];
    const p90 = drifts[Math.floor(drifts.length * 0.9)];
    const p99 = drifts[Math.floor(drifts.length * 0.99)];
    const max = drifts[drifts.length - 1];
    console.log(`\nWalk-away distance at check time  (rows w/ data: ${drifts.length})`);
    console.log('─'.repeat(60));
    console.log(`  p50=${p50.toFixed(0)}m  p90=${p90.toFixed(0)}m  p99=${p99.toFixed(0)}m  max=${max.toFixed(0)}m`);
    console.log(`  (high drift = user had walked far from previously-saved spot by check time)`);
  }

  console.log('');
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
