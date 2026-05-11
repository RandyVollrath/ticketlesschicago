import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: subs } = await s
    .from('autopilot_subscriptions')
    .select('user_id, plan_code, created_at')
    .eq('status', 'active')
    .is('authorization_revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!subs?.length) return console.log('No active subs');

  const { data: profiles } = await s
    .from('user_profiles')
    .select('user_id, email, last_name, first_name')
    .in('user_id', subs.map(x => x.user_id));

  const { data: plates } = await s
    .from('monitored_plates')
    .select('user_id, plate, state, status')
    .in('user_id', subs.map(x => x.user_id))
    .eq('status', 'active');

  console.log('=== Paid Autopilot users with plates ===\n');
  for (const sub of subs) {
    const p = profiles?.find(x => x.user_id === sub.user_id);
    const userPlates = plates?.filter(x => x.user_id === sub.user_id) || [];
    if (p?.last_name && userPlates.length > 0) {
      console.log(`${p.email}`);
      console.log(`  Name: ${p.first_name || ''} ${p.last_name}`);
      console.log(`  Plan: ${sub.plan_code}`);
      for (const pl of userPlates) {
        console.log(`  Plate: ${pl.plate} (${pl.state || 'IL'})`);
      }
      console.log();
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
