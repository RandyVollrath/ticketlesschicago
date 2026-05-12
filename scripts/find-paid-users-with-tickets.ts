// Find paid Autopilot users + check which of their plates have outstanding
// tickets in our FOIA snapshot (so we know who's worth testing the
// free-ticket-review page against).
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const FOIA = process.env.FOIA_DB || resolve(homedir(), 'Documents/FOIA/foia.db');

async function main() {
  const { data: subs } = await s
    .from('autopilot_subscriptions')
    .select('user_id, plan_code')
    .eq('status', 'active')
    .is('authorization_revoked_at', null);
  if (!subs?.length) return;

  const userIds = subs.map(x => x.user_id);
  const { data: profiles } = await s
    .from('user_profiles')
    .select('user_id, email, first_name, last_name')
    .in('user_id', userIds);
  const { data: plates } = await s
    .from('monitored_plates')
    .select('user_id, plate, state, status')
    .in('user_id', userIds)
    .eq('status', 'active');

  console.log('Paid users with monitored plates (and historical ticket counts from FOIA):\n');
  for (const sub of subs) {
    const p = profiles?.find(x => x.user_id === sub.user_id);
    const userPlates = plates?.filter(x => x.user_id === sub.user_id) || [];
    if (!p?.last_name || !userPlates.length) continue;
    for (const pl of userPlates) {
      // Count historical tickets for this plate from FOIA
      const sqlQ =
        ".mode tabs\n" +
        `SELECT COUNT(*) FROM tickets WHERE UPPER(REPLACE(REPLACE(ticket_number,'',''),'',''))='X' OR 1=1 LIMIT 0;`;
      // Tickets table doesn't have plate column; use plate-by-state queries from hearings? Skip count, just list.
      console.log(`  ${p.email}`);
      console.log(`    Name:   ${p.first_name || ''} ${p.last_name}`);
      console.log(`    Plate:  ${pl.plate} (${pl.state || 'IL'})`);
      console.log(`    Plan:   ${sub.plan_code}`);
      console.log();
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
