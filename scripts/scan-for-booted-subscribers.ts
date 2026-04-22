/**
 * One-shot scanner: runs the boot-eligibility probe against every paid
 * subscriber and prints a report. Does NOT send alerts — use this to
 * manually check the current state before the next scheduled autopilot run.
 *
 * Usage:
 *   npx tsx scripts/scan-for-booted-subscribers.ts           # scan all paid
 *   npx tsx scripts/scan-for-booted-subscribers.ts --dry     # same, prints more
 *   npx tsx scripts/scan-for-booted-subscribers.ts --plate FA81246 IL ALMUBAED
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { lookupPlateOnPortal } from '../lib/chicago-portal-scraper';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const args = process.argv.slice(2);
  const plateIdx = args.indexOf('--plate');

  type Subscriber = { user_id: string; email: string | null; plate: string; state: string; lastName: string };
  let subscribers: Subscriber[];

  if (plateIdx >= 0) {
    const [plate, state, lastName] = args.slice(plateIdx + 1);
    if (!plate || !state || !lastName) {
      console.error('--plate requires: <plate> <state> <lastName>');
      process.exit(1);
    }
    subscribers = [{ user_id: 'manual', email: null, plate, state, lastName }];
  } else {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id, email, license_plate, license_state, last_name')
      .eq('is_paid', true)
      .not('license_plate', 'is', null)
      .not('last_name', 'is', null);
    if (error) { console.error(error); process.exit(1); }
    subscribers = (data || [])
      .filter(r => r.license_plate && r.last_name)
      .map(r => ({
        user_id: r.user_id,
        email: r.email,
        plate: String(r.license_plate).toUpperCase(),
        state: (r.license_state || 'IL').toUpperCase(),
        lastName: String(r.last_name),
      }));
  }

  console.log(`Scanning ${subscribers.length} subscriber(s) for boots...\n`);

  const booted: any[] = [];
  const errors: any[] = [];
  for (const sub of subscribers) {
    process.stdout.write(`  ${sub.plate} (${sub.state}) / ${sub.lastName.padEnd(20).slice(0, 20)} ... `);
    try {
      const r = await lookupPlateOnPortal(sub.plate, sub.state, sub.lastName);
      const be = r.boot_eligibility;
      if (r.error) {
        console.log(`ERR: ${r.error}`);
        errors.push({ sub, error: r.error });
      } else if (be?.is_booted) {
        console.log(`BOOTED — tow-eligible ${be.tow_eligible_date} (ext=${be.tow_extension_eligible})`);
        booted.push({ sub, be });
      } else {
        console.log(`clean (${r.tickets.length} tickets)`);
      }
    } catch (err: any) {
      console.log(`THROW: ${err.message}`);
      errors.push({ sub, error: err.message });
    }
  }

  console.log('\n=== REPORT ===');
  console.log(`Scanned:  ${subscribers.length}`);
  console.log(`Booted:   ${booted.length}`);
  console.log(`Errors:   ${errors.length}`);
  if (booted.length > 0) {
    console.log('\nBooted subscribers:');
    for (const b of booted) {
      console.log(`  ${b.sub.plate}  ${b.sub.email ?? '(no email)'}  tow_eligible=${b.be.tow_eligible_date}  ext_eligible=${b.be.tow_extension_eligible}`);
    }
  }
  if (errors.length > 0) {
    console.log('\nErrors:');
    for (const e of errors) console.log(`  ${e.sub.plate}  ${e.error}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
