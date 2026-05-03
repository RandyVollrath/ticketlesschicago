#!/usr/bin/env npx tsx
/**
 * Probes the LIVE production check-parking endpoint with the Wolcott
 * coordinates from row 50, signs in as qa-bot, and reads back the new
 * parking_diagnostics row to confirm `native_meta.mapbox_reverse` is
 * populated with a real (non-empty) street name.
 *
 * Run: node -r dotenv/config node_modules/.bin/tsx \
 *        scripts/probe-live-mapbox-reverse.ts dotenv_config_path=.env.local
 */

import { createClient } from '@supabase/supabase-js';

const SITE_URL = (process.env.QA_SITE_URL || 'https://www.autopilotamerica.com').replace(/\/$/, '');
const BOT_EMAIL = process.env.QA_BOT_EMAIL || 'qa-bot@autopilotamerica.com';
// row 50 — N Wolcott Ave parking spot from real parking_diagnostics
const LAT = 41.9685220198643;
const LNG = -87.6761162690139;

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Generate a magic link, parse the verify_token, exchange for a session.
  const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: BOT_EMAIL,
    options: { redirectTo: `${SITE_URL}/dashboard` },
  });
  if (linkErr || !link) throw new Error(`generateLink failed: ${linkErr?.message}`);
  const token = (link.properties as any).hashed_token as string;
  if (!token) throw new Error('no hashed_token in link');

  // verifyOtp returns a real session for the bot.
  const { data: sess, error: verifyErr } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: token,
  });
  if (verifyErr || !sess?.session?.access_token) {
    throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  }
  const accessToken = sess.session.access_token;
  console.log(`signed in as ${BOT_EMAIL}`);

  // Note the highest existing parking_diagnostics id BEFORE the call so we
  // can find the NEW row written by check-parking.
  const { data: before } = await supabase
    .from('parking_diagnostics')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  const beforeId = before?.[0]?.id ?? 0;

  console.log(`hitting check-parking at ${LAT},${LNG} (last diag id was ${beforeId})`);
  const url = `${SITE_URL}/api/mobile/check-parking?lat=${LAT}&lng=${LNG}&accuracy=3.6`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const status = resp.status;
  const body = await resp.text();
  if (status !== 200) {
    console.error(`check-parking returned ${status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  const json = JSON.parse(body);
  console.log(`check-parking ok: street=${json.parsedAddress?.name} address=${json.address}`);

  // Read back the new diagnostics row.
  await new Promise((r) => setTimeout(r, 1500));
  const { data: after, error: afterErr } = await supabase
    .from('parking_diagnostics')
    .select('id, created_at, snap_street_name, snap_distance_meters, snap_source, native_meta')
    .gt('id', beforeId)
    .order('id', { ascending: false })
    .limit(1);
  if (afterErr) throw afterErr;
  const row = after?.[0];
  if (!row) {
    console.warn('no new parking_diagnostics row found — diagnostics may not write for QA bot');
    process.exit(2);
  }

  console.log(`\n=== diag row ${row.id} ===`);
  console.log(`snap: ${row.snap_street_name} (${row.snap_distance_meters}m via ${row.snap_source})`);
  const mbRev = (row.native_meta as any)?.mapbox_reverse;
  const mbMatch = (row.native_meta as any)?.mapbox;
  console.log(`mapbox_match: ${JSON.stringify(mbMatch)}`);
  console.log(`mapbox_reverse: ${JSON.stringify(mbRev, null, 2)}`);

  if (!mbRev) {
    console.error('\nFAIL: native_meta.mapbox_reverse is missing — the new code did not run.');
    process.exit(1);
  }
  if (!mbRev.matched || !mbRev.street || mbRev.street === '') {
    console.error('\nFAIL: mapbox_reverse did not return a real street name.');
    process.exit(1);
  }
  if (!/wolcott/i.test(mbRev.street)) {
    console.error(`\nFAIL: mapbox_reverse returned ${mbRev.street}, expected something matching /wolcott/i.`);
    process.exit(1);
  }
  console.log(`\nPASS: mapbox_reverse returned "${mbRev.street}" #${mbRev.house_number ?? '?'}`);
}

main().catch((e) => { console.error('crash:', e); process.exit(1); });
