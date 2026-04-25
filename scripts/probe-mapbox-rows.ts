#!/usr/bin/env npx tsx
/**
 * Probe-only: dump the raw mapbox section of recent parking_diagnostics rows
 * so we can see what Mapbox is actually returning (matched, street, confidence,
 * skip_reason) — not just the aggregated stats.
 *
 * Run: node -r dotenv/config node_modules/.bin/tsx scripts/probe-mapbox-rows.ts dotenv_config_path=.env.local [hours=24]
 */

import { createClient } from '@supabase/supabase-js';

async function main() {
  const hours = Number(process.argv.find(a => /^hours=/.test(a))?.split('=')[1]) || 24;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing supabase env');
  const s = createClient(url, key, { auth: { persistSession: false } });

  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await s
    .from('parking_diagnostics')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  console.log(`# parking_diagnostics rows in last ${hours}h: ${data?.length ?? 0}\n`);
  for (const r of data ?? []) {
    const mb = (r.native_meta as any)?.mapbox ?? null;
    console.log(`-- row ${r.id} @ ${r.created_at}`);
    console.log(`   raw: ${(r as any).raw_lat},${(r as any).raw_lng} acc=${(r as any).raw_accuracy_meters}m`);
    console.log(`   snap_street: ${(r as any).snap_street_name} dist=${(r as any).snap_distance_meters} src=${(r as any).snap_source}`);
    if (mb) {
      console.log(`   mapbox: ${JSON.stringify(mb, null, 2).split('\n').join('\n   ')}`);
    } else {
      console.log(`   mapbox: <none>`);
    }
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
