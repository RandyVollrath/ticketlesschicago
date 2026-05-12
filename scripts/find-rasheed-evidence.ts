import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const userId = 'ee53192e-6f9a-465b-b465-0a787896631c';
  const redLightTicketId = '8bedd5a9-7035-47f0-b7d7-4d96c6a3603d';
  const ticketNumber = '7012587110';

  // detected_tickets
  const { data: dt } = await s.from('detected_tickets').select('*').eq('user_id', userId);
  console.log('=== detected_tickets ===');
  console.log(JSON.stringify(dt, null, 2));

  // camera_evidence (try by ticket_id and by ticket_number)
  for (const sel of [['ticket_id', redLightTicketId], ['ticket_number', ticketNumber]]) {
    const { data, error } = await s.from('camera_evidence').select('*').eq(sel[0], sel[1]);
    if (!error && data?.length) {
      console.log(`\n=== camera_evidence by ${sel[0]} (${data.length}) ===`);
      console.log(JSON.stringify(data, null, 2));
    } else if (error) {
      console.log(`camera_evidence query err (${sel[0]}):`, error.message);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
