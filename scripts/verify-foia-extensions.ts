import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envFile = fs.readFileSync(path.join('/home/randy-vollrath/ticketless-chicago', '.env.local'), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // ticket id in FOIA row
  const ticketId = '8b541b87-f3a2-459e-98da-2ef89ad4e367';

  // Try detected_tickets table
  console.log('=== detected_tickets lookup ===');
  const { data: dt, error: dte } = await supabase
    .from('detected_tickets')
    .select('*')
    .eq('id', ticketId)
    .maybeSingle();
  if (dte) console.error('err:', dte.message);
  console.log('row:', JSON.stringify(dt, null, 2));

  if (dt?.user_id) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, full_name, phone')
      .eq('id', dt.user_id)
      .maybeSingle();
    console.log('profile:', JSON.stringify(prof, null, 2));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
