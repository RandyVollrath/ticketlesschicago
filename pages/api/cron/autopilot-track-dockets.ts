/**
 * Docket tracker cron — runs daily, polls AHMS for every contest_letters
 * row that has been mailed (status='sent') and has a captured docket
 * number. Updates hearing_date, pulls any city-supplied evidence images,
 * and records the final disposition once it appears.
 *
 * Coverage limits:
 *   - Letters without a docket_number are skipped. The docket comes from
 *     (a) an inbound email/letter from the city that our existing FOIA /
 *     resend-incoming-email webhook logic extracts, (b) user-uploaded
 *     notice photos (OCR'd for docket number), or (c) manual admin
 *     entry. This cron doesn't invent dockets.
 *   - Only sent / mailed letters are polled (paper contests or hearings
 *     don't produce a docket before the letter arrives at the city).
 *
 * Schedule: daily at 14:30 UTC (vercel.json).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { fetchAhmsDocketDetails } from '../../../lib/ahms-fetcher';

export const config = { maxDuration: 120 };

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  const results = { checked: 0, updated: 0, closed: 0, errors: [] as string[] };

  // Eligibility: letter has been mailed, we know the docket, and either
  // we've never polled OR it's been at least 24h since the last poll.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: letters, error } = await supabaseAdmin
    .from('contest_letters')
    .select('id, ticket_id, user_id, docket_number, ahms_last_checked_at, disposition')
    .eq('status', 'sent')
    .not('docket_number', 'is', null)
    .is('disposition', null) // stop polling once we have a final outcome
    .or(`ahms_last_checked_at.is.null,ahms_last_checked_at.lt.${dayAgo}`)
    .limit(100);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  for (const letter of letters || []) {
    results.checked++;

    try {
      // Need violation address + zip to hit AHMS. Pull from the ticket.
      const { data: ticket } = await supabaseAdmin
        .from('detected_tickets')
        .select('location, plate')
        .eq('id', letter.ticket_id)
        .maybeSingle();
      const address = ticket?.location;
      if (!address) {
        // No violation address on file yet — can't query AHMS. Stamp the
        // last-checked-at so we don't re-try every hour.
        await supabaseAdmin
          .from('contest_letters')
          .update({ ahms_last_checked_at: new Date().toISOString() })
          .eq('id', letter.id);
        continue;
      }
      // Pull zip from mailing address or parse from the ticket location.
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('mailing_zip')
        .eq('user_id', letter.user_id)
        .maybeSingle();
      const zip = profile?.mailing_zip || (address.match(/\b\d{5}\b/)?.[0] ?? '');
      if (!zip) {
        await supabaseAdmin
          .from('contest_letters')
          .update({ ahms_last_checked_at: new Date().toISOString() })
          .eq('id', letter.id);
        continue;
      }

      const details = await fetchAhmsDocketDetails({
        docketNumber: letter.docket_number!,
        violationAddress: address,
        zipCode: zip,
      });

      const updatePayload: Record<string, any> = {
        ahms_last_checked_at: new Date().toISOString(),
      };

      if (details) {
        updatePayload.ahms_payload = details.raw || null;
        if (details.hearingDate) updatePayload.hearing_date = details.hearingDate;
        // Pull disposition out of the AHMS payload if present.
        // Field name varies across datasets — check a few common keys.
        const disposition =
          details.raw?.documentsResponse?.data?.disposition ||
          details.raw?.documentsResponse?.data?.hearing_disposition ||
          null;
        const dispositionDate =
          details.raw?.documentsResponse?.data?.disposition_date ||
          details.raw?.documentsResponse?.data?.hearing_end_date ||
          null;
        if (disposition) {
          updatePayload.disposition = disposition;
          updatePayload.disposition_date = dispositionDate;
          results.closed++;
        }
        results.updated++;
      }

      await supabaseAdmin
        .from('contest_letters')
        .update(updatePayload)
        .eq('id', letter.id);

    } catch (e: any) {
      results.errors.push(`${letter.id}: ${e?.message || String(e)}`);
    }
  }

  return res.status(200).json({ success: true, ...results });
}
