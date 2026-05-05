/**
 * One-time backfill: set lob_status='mailed' on previously-sent letters
 * that have a lob_letter_id but no lob_status.
 *
 * Background: the mailer cron used to write lob_letter_id/mailed_at after
 * Lob send but never set lob_status. The Lob webhook only wrote
 * delivery_status. Result: the admin contest-pipeline view (which reads
 * lob_status) showed null for every letter we'd ever physically mailed.
 *
 * Going forward, both the mailer and the webhook write lob_status. This
 * script just patches up the historical rows.
 *
 * Idempotent: only updates rows where lob_status IS NULL AND
 * lob_letter_id IS NOT NULL.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  'https://dzhqolbhuqdcpngdayuq.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: candidates, error: selErr } = await supabase
    .from('contest_letters')
    .select('id, lob_letter_id, status, mailed_at, lob_status, delivery_status')
    .is('lob_status', null)
    .not('lob_letter_id', 'is', null);
  if (selErr) throw selErr;

  console.log(`Found ${candidates?.length ?? 0} letters with lob_letter_id but no lob_status:`);
  for (const c of candidates || []) {
    // If the webhook already populated delivery_status (e.g. 'delivered'),
    // mirror that to lob_status. Otherwise mark as 'mailed' — we know it
    // physically went out via Lob.
    const newLobStatus = c.delivery_status || 'mailed';
    console.log(`  - ${c.id} (Lob ${c.lob_letter_id}, status=${c.status}, delivery=${c.delivery_status ?? 'null'}) → lob_status='${newLobStatus}'`);

    const { error: updErr } = await supabase
      .from('contest_letters')
      .update({ lob_status: newLobStatus })
      .eq('id', c.id);
    if (updErr) {
      console.error(`    update failed: ${updErr.message}`);
    }
  }

  console.log('Done.');
}
main().catch(e => { console.error(e); process.exit(1); });
