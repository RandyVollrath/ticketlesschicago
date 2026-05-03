import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const r = await s.auth.admin.generateLink({ type: 'magiclink', email: 'qa-bot@autopilotamerica.com' });
if (r.error) { console.error('link:', r.error.message); process.exit(1); }
const t = r.data?.properties?.hashed_token;
const v = await s.auth.verifyOtp({ type: 'magiclink', token_hash: t });
if (v.error || !v.data?.session) { console.error('verify:', v.error?.message); process.exit(1); }
process.stdout.write(v.data.session.access_token);
