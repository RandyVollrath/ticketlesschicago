#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (match) {
    env[match[1]] = match[2].trim();
  }
}

const supabase = createClient('https://dzhqolbhuqdcpngdayuq.supabase.co', env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Get zones from permit_zone_hours that aren't in parking_permit_zones
  const { data: hoursData } = await supabase.from('permit_zone_hours').select('zone, zone_type, source, reported_address');
  const { data: zonesData } = await supabase.from('parking_permit_zones').select('zone').eq('status', 'ACTIVE');

  const zonesSet = new Set(zonesData?.map(r => r.zone) || []);
  const extra = (hoursData || []).filter(h => !zonesSet.has(h.zone));

  console.log('Sample zones in permit_zone_hours but NOT in parking_permit_zones:');
  console.log('Zone | Type | Source | Address');
  console.log('-'.repeat(100));
  for (const row of extra.slice(0, 30)) {
    console.log(`${row.zone.padEnd(6)} | ${row.zone_type.padEnd(12)} | ${(row.source || 'N/A').padEnd(20)} | ${row.reported_address || 'N/A'}`);
  }

  // Check zone number ranges
  const extraZones = extra.map(e => parseInt(e.zone)).filter(n => !isNaN(n)).sort((a,b) => a-b);
  console.log(`\nZone number range in extra zones: ${extraZones[0]} to ${extraZones[extraZones.length-1]}`);

  const activeZones = Array.from(zonesSet).map(z => parseInt(z)).filter(n => !isNaN(n)).sort((a,b) => a-b);
  console.log(`Zone number range in parking_permit_zones: ${activeZones[0]} to ${activeZones[activeZones.length-1]}`);

  // Check if extra zones are mostly in the 1000+ range
  const over1000 = extraZones.filter(z => z >= 1000).length;
  console.log(`\nExtra zones >= 1000: ${over1000} / ${extraZones.length} (${(over1000/extraZones.length*100).toFixed(1)}%)`);

  // Check what sources these came from
  const sourceCounts = new Map<string, number>();
  for (const row of extra) {
    const src = row.source || 'UNKNOWN';
    sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
  }

  console.log('\nSource breakdown for extra zones:');
  for (const [source, count] of Array.from(sourceCounts.entries()).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }
}

main();
