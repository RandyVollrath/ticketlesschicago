import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const email = 'homsy.r.m@gmail.com';
  const { data: profile } = await s
    .from('user_profiles')
    .select('user_id, email, first_name, last_name, phone')
    .eq('email', email)
    .single();
  console.log('Profile:', profile);
  if (!profile) return;

  const { data: plates } = await s
    .from('monitored_plates')
    .select('*')
    .eq('user_id', profile.user_id);
  console.log('\nPlates:', JSON.stringify(plates, null, 2));

  // Look for tickets in our DB
  const tables = ['outstanding_tickets', 'tickets', 'ticket_findings', 'portal_tickets', 'user_tickets', 'contest_letters'];
  for (const t of tables) {
    try {
      const { data, error } = await s.from(t).select('*').eq('user_id', profile.user_id).limit(20);
      if (error) { continue; }
      if (data?.length) {
        console.log(`\n=== ${t} (${data.length} rows) ===`);
        console.log(JSON.stringify(data, null, 2));
      }
    } catch {}
  }

  // also try by plate
  if (plates?.length) {
    for (const pl of plates) {
      for (const t of ['outstanding_tickets', 'portal_tickets', 'tickets']) {
        try {
          const { data, error } = await s.from(t).select('*').eq('plate', pl.plate).limit(20);
          if (error) continue;
          if (data?.length) {
            console.log(`\n=== ${t} by plate ${pl.plate} (${data.length} rows) ===`);
            console.log(JSON.stringify(data, null, 2));
          }
        } catch {}
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
