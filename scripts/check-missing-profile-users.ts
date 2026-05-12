/**
 * Quick check: for each user_id flagged by the audit, see if auth.users still
 * has them. If auth row is gone the customer was deleted (likely a test).
 * If auth row exists but user_profiles is missing the customer paid and never
 * got provisioned — needs manual grant.
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const FLAGGED = [
  { id: '0fb5cb5d-7182-4f6c-bbbf-2a462745f1e8', email: 'heyliberalname@gmail.com', amount: '$0', date: '2026-04-29' },
  { id: 'bf15abf3-7944-4a82-8591-375f986bf42b', email: 'hellodolldarlings@gmail.com', amount: '$10', date: '2026-04-22' },
  { id: '84e90387-db0f-4ceb-aaab-7b8f265e93ab', email: 'countluigivampa@gmail.com', amount: '$1', date: '2026-04-20' },
  { id: '837b19ff-fc10-4815-b1e1-ecb209df4ac3', email: 'heyliberalname@gmail.com', amount: '$49', date: '2026-04-10' },
];

async function main() {
  for (const f of FLAGGED) {
    const { data: authData, error } = await supabase.auth.admin.getUserById(f.id);
    const auth = authData?.user;
    const status = error
      ? `ERROR: ${error.message}`
      : auth
        ? `AUTH EXISTS — email=${auth.email}, created=${auth.created_at}`
        : 'AUTH ROW GONE (likely deleted as test)';
    console.log(`${f.email}  ${f.amount}  ${f.date}`);
    console.log(`  user_id=${f.id}`);
    console.log(`  ${status}`);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
