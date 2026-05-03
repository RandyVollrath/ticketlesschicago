import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { error: lettersErr } = await (supabase.from('contest_letters') as any)
    .select([
      'submission_channel',
      'submission_state',
      'submission_confirmed_at',
      'submission_confirmation_id',
      'submission_receipt_source',
      'submission_receipt_payload',
      'lifecycle_status',
      'lifecycle_status_changed_at',
      'last_status_source',
      'last_status_check_at',
      'city_case_status_raw',
      'city_case_payload',
      'contest_outcome',
      'contest_outcome_at',
      'final_amount',
      'autopay_opt_in',
      'autopay_mode',
      'autopay_cap_amount',
      'autopay_authorized_at',
      'autopay_payment_method_id',
      'autopay_status',
      'autopay_attempted_at',
      'autopay_result_payload',
      'paid_at',
      'payment_reference',
      'payment_amount',
      'payment_source',
    ].join(','))
    .limit(1);

  if (lettersErr) {
    throw new Error(`contest_letters schema check failed: ${lettersErr.message}`);
  }

  const { error: eventsErr } = await (supabase.from('contest_status_events') as any)
    .select('id, contest_letter_id, ticket_id, user_id, event_type, source, observed_at, normalized_status, raw_status, details')
    .limit(1);

  if (eventsErr) {
    throw new Error(`contest_status_events schema check failed: ${eventsErr.message}`);
  }

  console.log('contest lifecycle schema checks passed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
