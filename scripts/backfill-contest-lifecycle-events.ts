import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { recordContestStatusEvent } from '../lib/contest-lifecycle';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const write = process.argv.includes('--write');

async function main() {
  const { data: letters, error } = await (supabase.from('contest_letters') as any)
    .select(`
      id,
      ticket_id,
      user_id,
      status,
      lifecycle_status,
      lifecycle_status_changed_at,
      submission_channel,
      submission_state,
      submission_confirmed_at,
      last_status_source,
      city_case_status_raw,
      final_amount,
      disposition,
      disposition_date,
      autopay_status,
      paid_at
    `)
    .order('created_at', { ascending: true })
    .limit(1000);

  if (error) throw new Error(error.message);

  const { data: existingEvents, error: eventsErr } = await (supabase.from('contest_status_events') as any)
    .select('contest_letter_id');

  if (eventsErr) throw new Error(eventsErr.message);

  const existing = new Set((existingEvents || []).map((e: any) => e.contest_letter_id));
  const candidates = (letters || []).filter((l: any) => !existing.has(l.id));

  const summary = {
    totalLetters: (letters || []).length,
    existingEventLetters: existing.size,
    missingEventLetters: candidates.length,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!write) {
    console.log('Dry run only. Re-run with --write to insert bootstrap events.');
    return;
  }

  let inserted = 0;
  for (const letter of candidates) {
    await recordContestStatusEvent(supabase as any, {
      contestLetterId: letter.id,
      ticketId: letter.ticket_id,
      userId: letter.user_id,
      eventType: 'lifecycle_bootstrap',
      source: letter.last_status_source || 'bootstrap',
      normalizedStatus: letter.lifecycle_status || letter.status || 'draft',
      rawStatus: letter.city_case_status_raw || letter.disposition || letter.submission_state || letter.status || null,
      details: {
        submissionChannel: letter.submission_channel,
        submissionState: letter.submission_state,
        submissionConfirmedAt: letter.submission_confirmed_at,
        disposition: letter.disposition,
        dispositionDate: letter.disposition_date,
        finalAmount: letter.final_amount,
        autopayStatus: letter.autopay_status,
        paidAt: letter.paid_at,
      },
      observedAt: letter.lifecycle_status_changed_at || letter.submission_confirmed_at || new Date().toISOString(),
    });
    inserted++;
  }

  console.log(`Inserted ${inserted} bootstrap contest lifecycle event(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
