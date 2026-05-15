/**
 * Seed permit_zone_collection_targets with the top-cited permit-parking blocks
 * from the local FOIA SQLite DB. Run once after the migration is applied.
 *
 * Usage:   npx tsx scripts/seed-permit-zone-targets.ts [TOP_N]
 *          TOP_N defaults to 500.
 */
import 'dotenv/config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local', override: true });

import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPA_URL || !SERVICE) { console.error('Missing Supabase env'); process.exit(1); }
const sb = createClient(SUPA_URL, SERVICE);

const TOP_N = Number(process.argv[2] || 500);
const FOIA_DB = `${process.env.HOME}/Documents/FOIA/foia.db`;

// Rough clustering by Chicago grid coordinates. Maps a (street_dir, street_name, block_low)
// tuple to a neighborhood label so the UI can group routes.
function clusterLabel(dir: string, name: string, lo: number): string {
  // Latitude proxy: north blocks (N + high numbers) or W + named cross streets
  // We approximate by north-block-number for N/S streets, west-block-number for E/W
  if (dir === 'N' && lo >= 3300 && lo <= 4000) return 'Lakeview';
  if (dir === 'N' && lo >= 4500 && lo <= 5400) return 'Uptown/Edgewater';
  if (dir === 'N' && lo >= 2000 && lo <= 2600) return 'Lincoln Park';
  if (dir === 'N' && lo >= 1100 && lo <= 1800) return 'River North/Old Town';
  if (dir === 'W' && lo >= 1100 && lo <= 1700 && ['ADDISON','EDDY','CORNELIA','BARRY','BELMONT','DIVERSEY','WELLINGTON','SCHOOL','ROSCOE','GRACE'].includes(name)) return 'Lakeview';
  if (dir === 'W' && ['ALEXANDER','VERNON','MONROE','WARREN','MADISON','RANDOLPH','LAKE'].includes(name)) return 'West Loop / Near West';
  if (dir === 'E' && (name === 'ELM' || name === 'CEDAR' || name === 'BELLEVUE' || name === 'OAK' || name === 'DIVISION')) return 'Gold Coast';
  if (dir === 'S' && lo >= 1800 && lo <= 2700) return 'Near South / Prairie Ave';
  if (dir === 'E' && (name === '21ST' || name === '22ND' || name === '23RD' || name === '24TH')) return 'South Loop / Chinatown';
  if (dir === 'S' && (name === 'WENTWORTH' || name === 'CANAL' || name === 'CLARK')) return 'Chinatown / Bridgeport';
  if (dir === 'E' && lo >= 7000 && lo <= 7900) return 'South Shore';
  if (dir === 'S' && name === 'ELLIS' && lo >= 8000) return 'South Shore';
  if (dir === 'N' && lo >= 4500 && (name === 'WINTHROP' || name === 'KENMORE' || name === 'MAGNOLIA')) return 'Uptown/Edgewater';
  if (dir === 'N' && lo >= 1100 && (name === 'PAULINA' || name === 'WOLCOTT' || name === 'MARSHFIELD' || name === 'PAULINA')) return 'Wicker Park / West Town';
  return 'Other';
}

async function main() {
  if (!fs.existsSync(FOIA_DB)) { console.error(`FOIA DB not found at ${FOIA_DB}`); process.exit(1); }

  const tsv = execFileSync('sqlite3', ['-separator', '\t', FOIA_DB, `
    SELECT street_dir, street_name, CAST(street_num AS INTEGER)/100*100 AS block_low, COUNT(*) AS tix
    FROM tickets
    WHERE violation_code='0964090E' AND street_num IS NOT NULL AND street_num != ''
    GROUP BY street_dir, street_name, block_low
    ORDER BY tix DESC
    LIMIT ${TOP_N};
  `]).toString();

  const rows = tsv.trim().split('\n').map((line, i) => {
    const [dir, nameFull, blockLow, tix] = line.split('\t');
    // street_name in tickets table is the bare name. street_type isn't in the tickets table;
    // we'll match to u9xt-hiju at form-fill time.
    return {
      rank: i + 1,
      street_dir: dir,
      street_name: nameFull,
      street_type: null,
      block_low: Number(blockLow),
      citation_count: Number(tix),
      cluster_label: clusterLabel(dir, nameFull, Number(blockLow)),
      status: 'pending',
    };
  });

  console.log(`Seeding ${rows.length} priority targets...`);

  // Wipe and re-insert (idempotent for re-runs)
  const { error: delErr } = await sb.from('permit_zone_collection_targets').delete().gte('rank', 0);
  if (delErr) { console.error('Delete failed:', delErr); process.exit(1); }

  // Insert in batches of 200
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await sb.from('permit_zone_collection_targets').insert(batch);
    if (error) { console.error(`Batch ${i} failed:`, error); process.exit(1); }
    console.log(`  inserted ${i + batch.length}/${rows.length}`);
  }

  // Summary by cluster
  const byCluster = new Map<string, number>();
  for (const r of rows) byCluster.set(r.cluster_label, (byCluster.get(r.cluster_label) || 0) + 1);
  console.log('\nCluster distribution:');
  for (const [c, n] of [...byCluster.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(28)} ${n} blocks`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
