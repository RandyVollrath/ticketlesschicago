#!/usr/bin/env npx tsx
/**
 * Calls the LIVE production check-parking endpoint with the exact
 * coordinates from rows 49, 50, 55, 62 (Randy's ground-truth events)
 * so we can read back diag.native_meta.mapbox_reverse for each and see
 * whether Mapbox would have produced a more-accurate or less-accurate
 * answer than what we shipped.
 *
 * The new diag rows are NOT real parks — they are probe rows. Their
 * snap_street/resolved fields will mirror the originals because the
 * raw GPS is identical. The only thing we care about is what Mapbox
 * Geocoding v6 returns at each coord.
 */

import { createClient } from '@supabase/supabase-js';

const SITE = (process.env.QA_SITE_URL || 'https://www.autopilotamerica.com').replace(/\/$/, '');
const BOT = process.env.QA_BOT_EMAIL || 'qa-bot@autopilotamerica.com';

const PROBES = [
  { label: 'row 49 — 4/23 8:15PM AUTO (Randy: ~4715, system said 4755)', lat: 41.9672192746907, lng: -87.6762011712221 },
  { label: 'row 50 — 4/23 8:22PM MANUAL (Randy: 4785, system said 4785)', lat: 41.9685220198643, lng: -87.6761162690139 },
  { label: 'row 55 — 4/24 4:56PM METRA (system said 2032 Lawrence — both wrong)', lat: 41.9689055784393, lng: -87.6757064344392 },
  { label: 'row 62 — 4/25 4:18PM (system said 2030 Lawrence)', lat: 41.9688488351809, lng: -87.6756437209912 },
];

async function getBotToken() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const link = await s.auth.admin.generateLink({ type: 'magiclink', email: BOT });
  if (link.error) throw link.error;
  const t = link.data.properties?.hashed_token;
  const v = await s.auth.verifyOtp({ type: 'magiclink', token_hash: t! });
  if (v.error || !v.data?.session) throw new Error(`verify: ${v.error?.message}`);
  return v.data.session.access_token;
}

async function main() {
  const tok = await getBotToken();
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  for (const p of PROBES) {
    const { data: before } = await s.from('parking_diagnostics').select('id').order('id', { ascending: false }).limit(1);
    const beforeId = before?.[0]?.id ?? 0;

    const resp = await fetch(`${SITE}/api/mobile/check-parking`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: p.lat,
        longitude: p.lng,
        accuracy_meters: 4,
        heading: 270,
        compass_heading: 270,
        compass_confidence: 0.9,
      }),
    });
    if (resp.status !== 200) {
      console.log(`\n${p.label}\n  HTTP ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
      continue;
    }
    const json = await resp.json();
    await new Promise((r) => setTimeout(r, 1500));
    const { data: after } = await s
      .from('parking_diagnostics')
      .select('id, native_meta, snap_street_name, resolved_address')
      .gt('id', beforeId)
      .order('id', { ascending: false })
      .limit(1);
    const row = after?.[0];
    const mb = (row?.native_meta as any)?.mapbox_reverse;
    console.log(`\n${p.label}`);
    console.log(`  resolved by current system: ${row?.resolved_address}`);
    console.log(`  mapbox_reverse: ${mb?.street ?? '<no street>'} #${mb?.house_number ?? '?'} (${mb?.feature_type ?? '?'}, full="${mb?.full_address ?? ''}")`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
