import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const [lettersRes, staleRes, autopayReadyRes, autopayFailedRes] = await Promise.all([
    (supabase.from('contest_letters') as any)
      .select('id, lifecycle_status, autopay_status'),
    (supabase.from('contest_letters') as any)
      .select('id, ticket_id, user_id, lifecycle_status, lifecycle_status_changed_at')
      .eq('lifecycle_status', 'under_review')
      .lt('lifecycle_status_changed_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .limit(20),
    (supabase.from('contest_letters') as any)
      .select('id, ticket_id, user_id, lifecycle_status, final_amount, autopay_status, autopay_mode')
      .in('lifecycle_status', ['lost', 'reduced'])
      .eq('autopay_status', 'eligible')
      .is('paid_at', null)
      .limit(20),
    (supabase.from('contest_letters') as any)
      .select('id, ticket_id, user_id, lifecycle_status, autopay_status, autopay_attempted_at')
      .eq('autopay_status', 'failed')
      .limit(20),
  ]);

  if (lettersRes.error) throw new Error(lettersRes.error.message);
  if (staleRes.error) throw new Error(staleRes.error.message);
  if (autopayReadyRes.error) throw new Error(autopayReadyRes.error.message);
  if (autopayFailedRes.error) throw new Error(autopayFailedRes.error.message);

  const byLifecycle: Record<string, number> = {};
  const byAutopay: Record<string, number> = {};
  for (const row of lettersRes.data || []) {
    const lifecycle = row.lifecycle_status || 'unknown';
    const autopay = row.autopay_status || 'unset';
    byLifecycle[lifecycle] = (byLifecycle[lifecycle] || 0) + 1;
    byAutopay[autopay] = (byAutopay[autopay] || 0) + 1;
  }

  console.log(JSON.stringify({
    totalLetters: (lettersRes.data || []).length,
    byLifecycle,
    byAutopay,
    staleUnderReview: staleRes.data || [],
    autopayReady: autopayReadyRes.data || [],
    autopayFailed: autopayFailedRes.data || [],
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
