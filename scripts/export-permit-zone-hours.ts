#!/usr/bin/env npx tsx
/**
 * Export the Supabase permit_zone_hours table to a local JSON file
 * so it can be compared against the ordinance-scraped data.
 *
 * Writes to ~/Documents/Permit Zones/metadata/supabase_permit_zone_hours.json
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('no SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, KEY);

(async () => {
  let all: any[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('permit_zone_hours')
      .select('*')
      .order('zone', { ascending: true })
      .range(from, from + page - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < page) break;
    from += page;
  }
  const outPath = path.join(os.homedir(), 'Documents', 'Permit Zones', 'metadata', 'supabase_permit_zone_hours.json');
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`Exported ${all.length} rows → ${outPath}`);
  // Print schema summary
  if (all.length) {
    console.log(`\nColumns: ${Object.keys(all[0]).join(', ')}`);
    console.log(`\nSample row:`, JSON.stringify(all[0], null, 2));
  }
})();
