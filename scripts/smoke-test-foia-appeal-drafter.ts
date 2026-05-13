/**
 * Smoke test: run the FOIA appeal drafter against the existing
 * fulfilled_denial history FOIA (b3782800) and print the resulting letter.
 *
 * This is the per-CLAUDE.md "I saw it work" check before claiming the appeal
 * flow is shipped. Inserts a draft row, so after running this the next admin
 * digest will surface the draft with a real magic-link Send button.
 *
 * Usage:
 *   npx tsx scripts/smoke-test-foia-appeal-drafter.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { draftHistoryFoiaAppeal } from '../lib/foia-appeal-drafter';

const DENIED_REQUEST_ID = 'b3782800-5d0b-48f0-a694-b8d1c67ff74e';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  const sb = createClient(url, key);

  const { data: req, error } = await sb
    .from('foia_history_requests')
    .select('*')
    .eq('id', DENIED_REQUEST_ID)
    .maybeSingle();
  if (error || !req) throw new Error(`request fetch failed: ${error?.message}`);

  console.log(`→ Drafting appeal for ${req.license_state} ${req.license_plate} (ref ${req.reference_id})`);

  const denialBody = (req.response_data as any)?.body_preview || '';
  const denialFrom = (req.response_data as any)?.from || 'chicagoil@govqa.us';
  const denialReceivedAt = req.response_received_at || new Date().toISOString();

  const result = await draftHistoryFoiaAppeal(sb as any, {
    historyRequest: {
      id: req.id,
      license_state: req.license_state,
      license_plate: req.license_plate,
      name: req.name,
      email: req.email,
      reference_id: req.reference_id,
      created_at: req.created_at,
    },
    denialBody,
    denialFrom,
    denialReceivedAt,
  });

  if (!result) {
    console.error('FAIL: drafter returned null');
    process.exit(1);
  }

  console.log(`\n✅ Draft saved as appeal id ${result.appealId}\n`);
  console.log('SUBJECT:', result.draftSubject, '\n');
  console.log('BODY:');
  console.log('────────────────────────────────────────');
  console.log(result.draftBody);
  console.log('────────────────────────────────────────');
}

main().catch(e => { console.error(e); process.exit(1); });
