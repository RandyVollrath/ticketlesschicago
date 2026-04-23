#!/usr/bin/env npx tsx
// Compare Mapbox map-matching results against snap+Nominatim winners for
// recent parks. Run after a few drives to see whether Mapbox is winning often
// enough to promote from shadow mode to primary.
//
// Usage: npx tsx -r dotenv/config scripts/compare-mapbox-vs-snap.ts dotenv_config_path=.env.local [hours=24]

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const hoursArg = process.argv.find((a) => /^hours=/.test(a));
  const hours = Number(hoursArg?.split('=')[1]) || 24;
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from('parking_diagnostics')
    .select('id, created_at, resolved_street_name, resolved_address, snap_street_name, nominatim_street, native_meta')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const rows = (data ?? []).filter((r: any) => r.native_meta?.mapbox);
  console.log(`Found ${rows.length} parks with Mapbox shadow data in last ${hours}h\n`);

  if (rows.length === 0) {
    console.log('No rows with mapbox data yet. Make sure MAPBOX_ACCESS_TOKEN is set in Vercel and drive + park at least once.');
    return;
  }

  let mbMatched = 0;
  let mbAgreedWithResolved = 0;
  let mbDisagreedWithResolved = 0;

  for (const r of rows) {
    const mb = r.native_meta.mapbox;
    const mbStreet = mb.street as string | null;
    const resolved = r.resolved_street_name as string | null;
    const snapStreet = r.snap_street_name as string | null;

    const matched = Boolean(mb.matched);
    if (matched) mbMatched++;

    const normalize = (s: string | null) =>
      (s ?? '').toLowerCase().replace(/\b(north|south|east|west|n|s|e|w|ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place)\b/g, '').replace(/[^a-z]+/g, ' ').trim();

    const mbNorm = normalize(mbStreet);
    const resolvedNorm = normalize(resolved);
    let agreed: boolean | null = null;
    if (matched && mbNorm && resolvedNorm) {
      agreed = mbNorm.includes(resolvedNorm) || resolvedNorm.includes(mbNorm);
      if (agreed) mbAgreedWithResolved++;
      else mbDisagreedWithResolved++;
    }

    const flag = agreed == null ? '   ' : agreed ? ' ✓ ' : '≠≠≠';
    console.log(`${flag} ${r.created_at}  id=${r.id}`);
    console.log(`       resolved: ${r.resolved_address ?? resolved ?? 'none'}`);
    console.log(`       snap:     ${snapStreet ?? 'none'}`);
    console.log(`       nominatim: ${r.nominatim_street ?? 'none'}`);
    console.log(`       mapbox:   ${mbStreet ?? 'none'} (conf=${mb.confidence ?? 'n/a'}, matched ${mb.matched_count}/${mb.input_count})${mb.skip_reason ? ` [skip: ${mb.skip_reason}]` : ''}`);
    console.log();
  }

  console.log(`\nSummary (last ${hours}h):`);
  console.log(`  Mapbox matched:       ${mbMatched}/${rows.length}`);
  console.log(`  Agreed with resolved: ${mbAgreedWithResolved}/${mbMatched}`);
  console.log(`  Disagreed (different street): ${mbDisagreedWithResolved}/${mbMatched}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
