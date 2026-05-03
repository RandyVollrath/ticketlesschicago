#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function main() {
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data, error } = await s
    .from('registration_evidence_receipts' as any)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) { console.log('ERROR:', error.message); return; }
  console.log('Most recent 3 receipts (any user):');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
