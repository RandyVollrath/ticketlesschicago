import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Find recent paid users on monthly plan
  const { data: subs } = await s
    .from('autopilot_subscriptions')
    .select('user_id, plan_code, status, created_at, authorization_revoked_at')
    .order('created_at', { ascending: false })
    .limit(30);

  if (!subs?.length) { console.log('No subs'); return; }

  const userIds = subs.map(x => x.user_id);
  const { data: profiles } = await s
    .from('user_profiles')
    .select('user_id, email, first_name, last_name')
    .in('user_id', userIds);
  const { data: plates } = await s
    .from('monitored_plates')
    .select('user_id, plate, state, status')
    .in('user_id', userIds);

  console.log('Recent 30 subscriptions (newest first):\n');
  for (const sub of subs) {
    const p = profiles?.find(x => x.user_id === sub.user_id);
    const userPlates = plates?.filter(x => x.user_id === sub.user_id) || [];
    const name = `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
    console.log(`${sub.created_at}  plan=${sub.plan_code}  status=${sub.status}`);
    console.log(`  email: ${p?.email || '(no profile)'}`);
    console.log(`  name:  ${name || '(none)'}`);
    for (const pl of userPlates) {
      console.log(`  plate: ${pl.plate} ${pl.state || 'IL'} (${pl.status})`);
    }
    console.log();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
