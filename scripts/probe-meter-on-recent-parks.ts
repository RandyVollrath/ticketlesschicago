#!/usr/bin/env npx tsx
/**
 * Take the last few parked-vehicle coords from production and run
 * checkMeteredParking on each — if any return inMeteredZone=true, then
 * the in-prod save-parked-location isn't actually invoking the checker
 * (or its result isn't flowing into the insert).
 *
 * Run: node -r dotenv/config node_modules/.bin/tsx scripts/probe-meter-on-recent-parks.ts dotenv_config_path=.env.local
 */
import { createClient } from '@supabase/supabase-js';
import { checkMeteredParking } from '../lib/metered-parking-checker';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const s = createClient(url, key, { auth: { persistSession: false } });

  const { data: recent } = await s
    .from('user_parked_vehicles')
    .select('id, address, latitude, longitude, parked_at, meter_zone_active')
    .order('parked_at', { ascending: false })
    .limit(15);

  console.log('Probing checkMeteredParking on last 15 parks…\n');
  for (const r of recent ?? []) {
    if (r.latitude == null || r.longitude == null) {
      console.log(`  · ${r.address?.slice(0, 50)}  (no coords)`);
      continue;
    }
    try {
      const result = await checkMeteredParking(r.latitude, r.longitude);
      const flag = result.inMeteredZone ? '✓METER' : '·';
      const stored = r.meter_zone_active === true ? 'STORED:T' : r.meter_zone_active === false ? 'STORED:F' : 'STORED:NULL';
      console.log(`  ${flag} ${stored}  ${r.address?.slice(0, 50)}  → inMeteredZone=${result.inMeteredZone}, max=${result.timeLimitMinutes}m, enforced=${result.isEnforcedNow}, sched="${result.scheduleText}"`);
    } catch (e: any) {
      console.log(`  ⚠ ${r.address?.slice(0, 50)}  → error: ${e.message}`);
    }
    // Be polite to Nominatim
    await new Promise(r => setTimeout(r, 1100));
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
