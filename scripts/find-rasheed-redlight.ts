import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const redLightTicketId = '8bedd5a9-7035-47f0-b7d7-4d96c6a3603d';
  const ticketNumber = '7012587110';
  const userId = 'ee53192e-6f9a-465b-b465-0a787896631c';

  // Red-light ticket specifically
  console.log('=== detected_tickets by id ===');
  const { data: dt } = await s.from('detected_tickets').select('*').eq('id', redLightTicketId);
  console.log(JSON.stringify(dt, null, 2));

  console.log('\n=== detected_tickets by ticket_number ===');
  const { data: dt2 } = await s.from('detected_tickets').select('*').eq('ticket_number', ticketNumber);
  console.log(JSON.stringify(dt2, null, 2));

  // camera_evidence
  console.log('\n=== camera_evidence by ticket_id ===');
  const { data: ce } = await s.from('camera_evidence').select('*').eq('ticket_id', redLightTicketId);
  console.log(JSON.stringify(ce, null, 2));

  console.log('\n=== camera_evidence by ticket_number ===');
  const { data: ce2 } = await s.from('camera_evidence').select('*').eq('ticket_number', ticketNumber);
  console.log(JSON.stringify(ce2, null, 2));

  // Anything with this user_id in camera_evidence
  console.log('\n=== all camera_evidence by user ===');
  const { data: ce3 } = await s.from('camera_evidence').select('*').eq('user_id', userId);
  console.log(JSON.stringify(ce3, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
