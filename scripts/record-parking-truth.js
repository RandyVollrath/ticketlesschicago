#!/usr/bin/env node
/**
 * Record Parking Truth
 *
 * Writes user-reported ground truth for a parking event into
 * parking_diagnostics so it becomes a labeled training/regression example.
 * Built so chat-session feedback ("I actually parked on Belden just east of
 * Kenmore") doesn't get lost — we drop a row of truth onto the most recent
 * diagnostic and the source-attribution audit picks it up.
 *
 * Usage:
 *   node scripts/record-parking-truth.js \
 *     --user randyvollrath@gmail.com \
 *     --truth "Belden just east of Kenmore" \
 *     [--id 173]                  # specific diag (default: most recent)
 *     [--street W BELDEN AVE]     # optional structured street
 *     [--house 1036]              # optional structured house number
 *     [--side N|S|E|W]            # optional side
 *     [--block-correct false]     # default: false (we're recording a miss)
 *     [--source chat]             # provenance — default 'chat'
 *
 * The unstructured `--truth` string is always saved verbatim under
 * native_meta.feedback_note so the user's original phrasing is preserved.
 *
 * After recording, run:
 *   node scripts/parking-source-attribution.js --id <id>
 * to see the side-by-side ledger including the new ground truth.
 */
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

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

const userArg = arg('user');
const idArg = arg('id');
const truth = arg('truth');
const streetArg = arg('street');
const houseArg = arg('house');
const sideArg = arg('side');
const blockCorrectArg = arg('block-correct', 'false');
const provenance = arg('source', 'chat');

if (!truth) {
  console.error('Missing --truth "<what the user actually said>"');
  process.exit(1);
}

(async () => {
  // Resolve the target row
  let row;
  if (idArg) {
    const { data, error } = await s
      .from('parking_diagnostics')
      .select('*')
      .eq('id', Number.parseInt(idArg, 10))
      .limit(1);
    if (error) throw error;
    row = data?.[0];
  } else {
    if (!userArg) {
      console.error('Need --user <email> when --id is not given');
      process.exit(1);
    }
    const u = await s.from('user_profiles').select('user_id, email').eq('email', userArg).limit(1);
    const userId = u.data?.[0]?.user_id;
    if (!userId) {
      console.error(`No user with email ${userArg}`);
      process.exit(1);
    }
    const { data, error } = await s
      .from('parking_diagnostics')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    row = data?.[0];
  }
  if (!row) {
    console.error('No matching parking_diagnostics row');
    process.exit(1);
  }

  // Build the update — preserve any existing feedback fields, then layer ours
  const blockCorrect = blockCorrectArg === 'true';
  const update = {
    user_feedback_at: new Date().toISOString(),
    user_confirmed_block: blockCorrect,
    street_correct: blockCorrect,
  };
  if (sideArg) {
    update.user_reported_side = sideArg.toUpperCase();
    if (row.resolved_side) {
      update.side_correct = sideArg.toUpperCase() === row.resolved_side;
    }
  }
  const existingMeta = (row.native_meta && typeof row.native_meta === 'object' && !Array.isArray(row.native_meta))
    ? row.native_meta
    : {};
  const groundTruth = {
    raw: truth,
    street: streetArg || null,
    house_number: houseArg ? Number.parseInt(houseArg, 10) : null,
    side: sideArg ? sideArg.toUpperCase() : null,
    recorded_at: new Date().toISOString(),
    source: provenance,
  };
  update.native_meta = {
    ...existingMeta,
    feedback_source: provenance,
    feedback_note: truth,
    corrected_address: streetArg
      ? `${houseArg ? houseArg + ' ' : ''}${streetArg}`.trim()
      : truth,
    ground_truth: groundTruth,
  };

  const { error: updateErr } = await s
    .from('parking_diagnostics')
    .update(update)
    .eq('id', row.id);
  if (updateErr) {
    console.error('Update failed:', updateErr.message);
    process.exit(1);
  }

  console.log(`Recorded truth on diag #${row.id}:`);
  console.log(`  resolved_address (app):  ${row.resolved_address}`);
  console.log(`  ground truth (user):     ${truth}`);
  if (streetArg) console.log(`  structured street:       ${streetArg}`);
  if (houseArg) console.log(`  structured house number: ${houseArg}`);
  if (sideArg) console.log(`  reported side:           ${sideArg.toUpperCase()}`);
  console.log(`  block correct?           ${blockCorrect}`);
  console.log('');
  console.log(`Audit:  node scripts/parking-source-attribution.js --id ${row.id}`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
