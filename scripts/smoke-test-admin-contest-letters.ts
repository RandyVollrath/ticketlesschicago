import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_EMAIL = 'randyvollrath@gmail.com';

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let target: any = null;
  for (let page = 1; page <= 50 && !target; page++) {
    const { data: users, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) throw listErr;
    target = users.users.find(u => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    if (users.users.length < 200) break;
  }
  if (!target) throw new Error(`User ${ADMIN_EMAIL} not found`);
  console.log(`Found user ${ADMIN_EMAIL} id=${target.id}`);

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: ADMIN_EMAIL,
  });
  if (linkErr) throw linkErr;

  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) throw new Error('No hashed_token in generateLink response');

  const anonClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verifyData, error: verifyErr } = await anonClient.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyErr) throw verifyErr;
  const accessToken = verifyData.session?.access_token;
  if (!accessToken) throw new Error('No access_token after verifyOtp');

  console.log(`Got access token for ${ADMIN_EMAIL} (len=${accessToken.length})`);

  const url = 'https://www.autopilotamerica.com/api/admin/contest-letters?limit=2';
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  console.log(`HTTP ${r.status}`);
  const body = await r.text();
  console.log(body.slice(0, 800));
  if (!r.ok) process.exit(1);
}

main().catch(err => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
