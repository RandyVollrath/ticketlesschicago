import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const dayStart = '2026-05-09T05:00:00Z';
const dayEnd   = '2026-05-10T05:00:00Z';
const weekAgoStart = '2026-05-02T05:00:00Z';

async function main() {
  const { data: foiaY, error: e1 } = await supabase
    .from('foia_history_requests')
    .select('id, source, created_at, license_plate, license_state, email')
    .gte('created_at', dayStart).lt('created_at', dayEnd)
    .order('created_at');
  console.log('--- FOIA history requests yesterday (Sat May 9 Chicago) ---');
  if (e1) console.error(e1); else console.log(`count=${foiaY?.length ?? 0}`);
  foiaY?.forEach(r => console.log(`  ${r.created_at}  ${r.source}  ${r.license_state}-${r.license_plate}  ${r.email}`));

  const { data: foia7 } = await supabase
    .from('foia_history_requests')
    .select('id, source, created_at')
    .gte('created_at', weekAgoStart).lt('created_at', dayStart);
  const dailyMap: Record<string, number> = {};
  foia7?.forEach(r => {
    const d = new Date(r.created_at).toISOString().slice(0,10);
    dailyMap[d] = (dailyMap[d] ?? 0) + 1;
  });
  console.log('\n--- Prior 7-day FOIA history baseline ---');
  Object.entries(dailyMap).sort().forEach(([d,c]) => console.log(`  ${d}: ${c}`));
  const total7 = (foia7?.length ?? 0);
  console.log(`  7-day total: ${total7} (avg ${(total7/7).toFixed(1)}/day)`);

  const { data: paidY, error: e3 } = await supabase
    .from('user_profiles')
    .select('user_id, email, is_paid, created_at')
    .gte('created_at', dayStart).lt('created_at', dayEnd)
    .order('created_at');
  console.log('\n--- New user_profiles yesterday ---');
  if (e3) console.error(e3); else console.log(`count=${paidY?.length ?? 0}, paid=${paidY?.filter(u=>u.is_paid).length ?? 0}`);
  paidY?.forEach(r => console.log(`  ${r.created_at}  paid=${r.is_paid}  ${r.email}`));
}
main().catch(e => { console.error(e); process.exit(1); });
