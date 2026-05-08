#!/usr/bin/env node
/**
 * Parking Source Attribution
 *
 * Shows the side-by-side voting record for one parking event:
 * what each independent source said, what the final answer was,
 * and (if user feedback exists) what the ground truth was.
 *
 * Run after parking somewhere the app got wrong, to see why.
 *
 * Usage:
 *   node scripts/parking-source-attribution.js                              # most recent diag
 *   node scripts/parking-source-attribution.js --id 12345                   # specific row
 *   node scripts/parking-source-attribution.js --user randyvollraths@gmail.com   # most recent for user
 *   node scripts/parking-source-attribution.js --user <email> --limit 5     # last 5 events
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

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i < process.argv.length - 1 ? process.argv[i + 1] : def;
}

const idArg = arg('id');
const userArg = arg('user');
const limit = Number.parseInt(arg('limit', '1'), 10) || 1;

async function findUserId(emailOrId) {
  if (!emailOrId.includes('@')) return emailOrId;
  const { data } = await s.from('user_profiles').select('user_id, email').eq('email', emailOrId).limit(1);
  if (!data?.length) {
    console.error(`No user with email ${emailOrId}`);
    process.exit(1);
  }
  return data[0].user_id;
}

async function fetchRows() {
  if (idArg) {
    const { data, error } = await s.from('parking_diagnostics').select('*').eq('id', idArg).limit(1);
    if (error) throw error;
    return data ?? [];
  }
  let q = s.from('parking_diagnostics').select('*').order('created_at', { ascending: false }).limit(limit);
  if (userArg) {
    const userId = await findUserId(userArg);
    q = q.eq('user_id', userId);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

function fmtCoord(n) {
  return typeof n === 'number' ? n.toFixed(6) : '—';
}

function fmtDist(n) {
  return typeof n === 'number' ? `${n.toFixed(1)}m` : '—';
}

function fmtHeading(deg) {
  if (typeof deg !== 'number' || deg < 0 || deg >= 360) return '—';
  const orient = (deg <= 45 || deg >= 315 || (deg >= 135 && deg <= 225)) ? 'N-S' : 'E-W';
  return `${deg.toFixed(0)}° (${orient})`;
}

function row(label, value, extra) {
  const v = value == null || value === '' ? '—' : String(value);
  const e = extra == null || extra === '' ? '' : `   ${extra}`;
  console.log(`  ${label.padEnd(22)} ${v}${e}`);
}

function describe(d) {
  const m = d.native_meta || {};
  const mb = m.mapbox_reverse || {};
  const mm = m.mapbox || {};
  const apple = m.apple || {};
  const pre = m.pre_nominatim_snap || {};
  const ev = new Date(d.created_at).toISOString();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`Diagnostic #${d.id} · ${ev} · user_id=${d.user_id ?? '—'}`);
  console.log(`Raw GPS: ${fmtCoord(d.raw_lat)}, ${fmtCoord(d.raw_lng)} (acc=${fmtDist(d.raw_accuracy_meters)})`);
  console.log('──────────────────────────────────────────────────────────────');

  console.log('FINAL ANSWER (what the user saw):');
  row('Address', d.resolved_address);
  row('Street', d.resolved_street_name);
  row('House #', d.resolved_house_number);
  row('Side', d.resolved_side, d.side_source ? `(via ${d.side_source})` : '');
  row('Snap source', d.snap_source);

  console.log('\nGROUND TRUTH (user feedback):');
  if (d.user_feedback_at) {
    row('Confirmed parking?', d.user_confirmed_parking);
    row('Confirmed block?', d.user_confirmed_block);
    row('Reported side', d.user_reported_side);
    row('Corrected addr', m.corrected_address || m.feedback_note);
    row('Note', m.feedback_note);
    row('Street correct?', d.street_correct);
    row('Side correct?', d.side_correct);
  } else {
    console.log('  (no user feedback recorded)');
  }

  console.log('\nSOURCE VOTES:');
  console.log('  Source                 Street                       Detail');
  console.log('  ──────                 ──────                       ──────');
  row(
    'Snap (initial)',
    pre.street || `(no override — final = ${d.snap_street_name || '—'})`,
    pre.distance_m != null ? `dist=${fmtDist(pre.distance_m)} src=${pre.source}` : '',
  );
  row(
    'Snap (final)',
    d.snap_street_name,
    `dist=${fmtDist(d.snap_distance_meters)} cands=${d.snap_candidates_count ?? '?'}`,
  );
  row('Nominatim (OSM)', d.nominatim_street, d.nominatim_overrode ? '→ OVERROD snap' : (d.nominatim_agreed ? '✓ agrees' : ''));
  row(
    'Mapbox reverse',
    mb.street ? `${mb.street}${mb.house_number ? ' #' + mb.house_number : ''}` : null,
    mb.match_confidence != null ? `conf=${mb.match_confidence}, type=${mb.feature_type}, agrees_snap=${mb.agrees_with_snap}, agrees_nom=${mb.agrees_with_nominatim}` : '',
  );
  row(
    'Mapbox map-match',
    mm.street,
    mm.confidence != null ? `conf=${(mm.confidence ?? 0).toFixed(2)}, matched=${mm.matched_count}/${mm.input_count}, promoted=${mm.promoted}` : (mm.skip_reason ? `skipped: ${mm.skip_reason}` : ''),
  );
  row(
    'Apple geocode',
    apple.thoroughfare || apple.street_resolved,
    apple.sub_thoroughfare ? `# ${apple.sub_thoroughfare}` : '',
  );

  console.log('\nHEADING SIGNALS:');
  row('GPS heading', fmtHeading(d.gps_heading), d.gps_source ? `src=${d.gps_source}` : '');
  row('Compass heading', fmtHeading(d.compass_heading), d.compass_confidence != null ? `±${d.compass_confidence.toFixed(0)}°` : '');
  row('Effective heading', fmtHeading(d.effective_heading), `chosen=${d.heading_source}, orient=${d.heading_orientation}`);
  row('Heading confirms snap?', d.heading_confirmed_snap);

  console.log('\nGEOMETRY / GUARDS:');
  row('Snapped point', `${fmtCoord(d.snapped_lat)}, ${fmtCoord(d.snapped_lng)}`);
  row('Near intersection?', d.near_intersection);
  row('Walkaway guard?', d.walkaway_guard_fired, d.walkaway_details || '');
  row('Location err', fmtDist(d.location_error_meters));
  row('Forced parity', d.parity_forced, d.forced_parity || '');
  row('Snap bearing', d.snap_bearing != null ? `${d.snap_bearing}°` : null);

  if (m.pre_nominatim_snap || m.confirmed_nominatim_override || m.promoted_over_nominatim) {
    console.log('\nOVERRIDE TRAIL:');
    if (m.pre_nominatim_snap) row('Pre-Nominatim snap', `${m.pre_nominatim_snap.street} (${fmtDist(m.pre_nominatim_snap.distance_m)})`);
    if (mb.confirmed_nominatim_override) row('Mapbox-rev confirms override?', true);
    if (mb.promoted_over_nominatim) row('Mapbox promoted over Nominatim?', true);
  }
  console.log('══════════════════════════════════════════════════════════════');
}

(async () => {
  const rows = await fetchRows();
  if (!rows.length) {
    console.log('No diagnostics found.');
    process.exit(0);
  }
  for (const d of rows) describe(d);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
