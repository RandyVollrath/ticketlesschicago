import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data, error } = await supabase
    .from('contest_letters')
    .select(`
      id,
      ticket_id,
      user_id,
      letter_text,
      letter_pdf_url,
      status,
      lob_letter_id,
      lob_status,
      lob_expected_delivery,
      delivery_status,
      expected_delivery_date,
      delivered_at,
      returned_at,
      last_tracking_update,
      defense_type,
      evidence_integrated,
      evidence_integrated_at,
      mailed_at,
      econtest_status,
      econtest_submitted_at,
      econtest_confirmation_id,
      econtest_response,
      submission_channel,
      submission_state,
      submission_confirmed_at,
      lifecycle_status,
      lifecycle_status_changed_at,
      last_status_source,
      last_status_check_at,
      city_case_status_raw,
      final_amount,
      autopay_opt_in,
      autopay_mode,
      autopay_cap_amount,
      autopay_payment_method_id,
      autopay_status,
      autopay_attempted_at,
      payment_amount,
      payment_reference,
      paid_at,
      disposition,
      disposition_reason,
      disposition_date,
      created_at,
      updated_at
    `)
    .order('created_at', { ascending: false })
    .range(0, 1);

  if (error) {
    console.error('QUERY ERROR:', JSON.stringify(error, null, 2));
    process.exit(1);
  }
  console.log(`OK — ${data?.length || 0} rows`);
  console.log(JSON.stringify(data?.[0], null, 2)?.slice(0, 500));

  const { data: tickets, error: tErr } = await supabase
    .from('ticket_contests')
    .select('id, ticket_number, violation_code, violation_description, ticket_amount, ticket_location')
    .limit(1);
  if (tErr) {
    console.error('TICKET_CONTESTS QUERY ERROR:', JSON.stringify(tErr, null, 2));
    process.exit(1);
  }
  console.log(`ticket_contests OK — ${tickets?.length || 0} rows`);

  const { data: receipts, error: rErr } = await supabase
    .from('red_light_receipts')
    .select('id, user_id, device_timestamp, camera_address, full_stop_detected, full_stop_duration_sec, approach_speed_mph, min_speed_mph, speed_delta_mph, evidence_hash')
    .limit(1);
  if (rErr) {
    console.error('RED_LIGHT_RECEIPTS QUERY ERROR:', JSON.stringify(rErr, null, 2));
    process.exit(1);
  }
  console.log(`red_light_receipts OK — ${receipts?.length || 0} rows`);
}

main().catch(e => { console.error(e); process.exit(1); });
