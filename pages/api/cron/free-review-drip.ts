/**
 * Cron: Free-review drip campaign
 *
 * /free-ticket-review submitters give us an email but don't create a
 * user_profile, so they're not in the main drip_campaign pipeline. This
 * cron sends them:
 *
 *   Day 3 — educational, no pitch (Chicago ticket math)
 *   Day 7 — soft pitch ($99/yr Autopilot)
 *
 * State is tracked on free_review_requests.drip_day3_sent_at /
 * drip_day7_sent_at (see migration 20260515_free_review_source_and_drip.sql).
 *
 * Silent skip when the email is already a paid Autopilot customer — we
 * flip drip_unsubscribed=true on those rows so we never bother them again
 * (same pattern as the weekly recheck cron's became_paid stop).
 *
 * Schedule: daily 14:00 UTC (9 AM CT) — same window as the FOIA drip.
 * Backfill window: only sends to free-reviews created in the last 21 days,
 * so we don't surprise-mail people from months ago when this feature ships.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  sendFreeReviewDripDay3,
  sendFreeReviewDripDay7,
} from '../../../lib/free-review-drip-emails';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { maxDuration: 120 };

const BACKFILL_WINDOW_DAYS = 21;
const PER_RUN_LIMIT = 100;
const PAUSE_BETWEEN_SENDS_MS = 600; // stay under Resend's 2 req/sec
const DAY3_GAP_MS = 24 * 60 * 60 * 1000; // require ≥24h between day 3 and day 7

/**
 * Returns true if this email is a paid Autopilot customer right now. Used
 * to silent-skip them and permanently mark drip_unsubscribed=true so we
 * don't re-evaluate next time.
 */
async function isEmailPaidCustomer(email: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, is_paid')
    .eq('email', email)
    .eq('is_paid', true)
    .limit(1);
  return (data?.length || 0) > 0;
}

async function silentStopAsPaid(rowId: string): Promise<void> {
  await supabaseAdmin
    .from('free_review_requests')
    .update({ drip_unsubscribed: true })
    .eq('id', rowId);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: 'Server misconfiguration' });
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const now = Date.now();
  const day3Threshold = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
  const day7Threshold = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const day7GapThreshold = new Date(now - DAY3_GAP_MS).toISOString();
  const backfillFloor = new Date(now - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const results = { day3Sent: 0, day7Sent: 0, paidSilentSkipped: 0, errors: [] as string[] };
  let budget = PER_RUN_LIMIT;

  try {
    // ── Day 3: completed reviews from 3-21 days ago, day 3 never sent, not unsubscribed ──
    const { data: day3Due, error: day3Err } = await supabaseAdmin
      .from('free_review_requests')
      .select('id, email, license_plate:plate, license_state:state, status, drip_day3_sent_at, drip_unsubscribed, unsubscribe_token')
      .lte('created_at', day3Threshold)
      .gte('created_at', backfillFloor)
      .is('drip_day3_sent_at', null)
      .eq('drip_unsubscribed', false)
      .eq('status', 'done')
      .not('email', 'is', null)
      .order('created_at', { ascending: true })
      .limit(budget);

    if (day3Err) {
      console.error('Day 3 query failed:', day3Err.message);
      results.errors.push(`day3 query: ${day3Err.message}`);
    }

    for (const row of (day3Due || []) as any[]) {
      if (budget <= 0) break;
      try {
        // Silent skip + permanent stop if they've become a paid customer.
        if (await isEmailPaidCustomer(row.email)) {
          await silentStopAsPaid(row.id);
          results.paidSilentSkipped++;
          continue;
        }
        await sendFreeReviewDripDay3({
          email: row.email,
          licensePlate: row.license_plate,
          licenseState: row.license_state,
          reviewId: row.id,
          unsubscribeToken: row.unsubscribe_token,
        });
        await supabaseAdmin
          .from('free_review_requests')
          .update({ drip_day3_sent_at: new Date().toISOString() })
          .eq('id', row.id);
        results.day3Sent++;
        budget--;
        await new Promise(r => setTimeout(r, PAUSE_BETWEEN_SENDS_MS));
      } catch (err: any) {
        console.error(`day3 send failed for ${row.email}: ${err?.message || err}`);
        results.errors.push(`day3:${row.email}: ${err?.message || err}`);
      }
    }

    // ── Day 7: completed 7-21d ago, day7 null, day3 sent ≥24h ago, not unsubscribed ──
    const { data: day7Due, error: day7Err } = await supabaseAdmin
      .from('free_review_requests')
      .select('id, email, license_plate:plate, license_state:state, status, drip_day3_sent_at, drip_day7_sent_at, drip_unsubscribed, unsubscribe_token')
      .lte('created_at', day7Threshold)
      .gte('created_at', backfillFloor)
      .is('drip_day7_sent_at', null)
      .not('drip_day3_sent_at', 'is', null)
      .lte('drip_day3_sent_at', day7GapThreshold)
      .eq('drip_unsubscribed', false)
      .eq('status', 'done')
      .not('email', 'is', null)
      .order('created_at', { ascending: true })
      .limit(budget);

    if (day7Err) {
      console.error('Day 7 query failed:', day7Err.message);
      results.errors.push(`day7 query: ${day7Err.message}`);
    }

    for (const row of (day7Due || []) as any[]) {
      if (budget <= 0) break;
      try {
        if (await isEmailPaidCustomer(row.email)) {
          await silentStopAsPaid(row.id);
          results.paidSilentSkipped++;
          continue;
        }
        await sendFreeReviewDripDay7({
          email: row.email,
          licensePlate: row.license_plate,
          licenseState: row.license_state,
          reviewId: row.id,
          unsubscribeToken: row.unsubscribe_token,
        });
        await supabaseAdmin
          .from('free_review_requests')
          .update({ drip_day7_sent_at: new Date().toISOString() })
          .eq('id', row.id);
        results.day7Sent++;
        budget--;
        await new Promise(r => setTimeout(r, PAUSE_BETWEEN_SENDS_MS));
      } catch (err: any) {
        console.error(`day7 send failed for ${row.email}: ${err?.message || err}`);
        results.errors.push(`day7:${row.email}: ${err?.message || err}`);
      }
    }

    console.log(
      `free-review drip complete: ${results.day3Sent} day3, ${results.day7Sent} day7, ` +
      `${results.paidSilentSkipped} paid-silent-skipped, ${results.errors.length} errors`,
    );
    return res.status(200).json(results);
  } catch (err: any) {
    console.error('free-review drip crashed:', err?.message || err);
    return res.status(500).json({ error: sanitizeErrorMessage(err), partial: results });
  }
}
