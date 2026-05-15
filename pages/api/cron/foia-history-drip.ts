/**
 * Cron: FOIA-submitter drip campaign
 *
 * Flyer/QR users who submit a FOIA via /ticket-history don't have user_profiles,
 * so they're not in the main drip_campaign_status pipeline. This cron sends them:
 *
 *   Day 3 — educational, no pitch (Chicago ticket math)
 *   Day 7 — soft pitch ($99/yr Autopilot)
 *
 * State is tracked on foia_history_requests.drip_day3_sent_at / drip_day7_sent_at
 * (see migration 20260512_add_foia_drip_columns.sql).
 *
 * Schedule: once daily at 14:00 UTC (9 AM CT) — same window as the existing drip.
 * Backfill window: only sends to FOIAs created in the last 21 days, so we don't
 * surprise-mail people who FOIA'd months ago when this feature shipped.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendFoiaDripDay3, sendFoiaDripDay7 } from '../../../lib/foia-drip-emails';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = { maxDuration: 120 };

const BACKFILL_WINDOW_DAYS = 21;
const PER_RUN_LIMIT = 100;
const PAUSE_BETWEEN_SENDS_MS = 600; // stay under Resend's 2 req/sec
const DAY3_GAP_MS = 24 * 60 * 60 * 1000; // require ≥24h between day-3 and day-7 to avoid same-day blast

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

  const results = { day3Sent: 0, day7Sent: 0, errors: [] as string[] };
  let budget = PER_RUN_LIMIT;

  try {
    // ── Day 3: created 3-21 days ago, day3 never sent, not unsubscribed ──
    const day3Query = supabaseAdmin
      .from('foia_history_requests' as any)
      .select('id, email, name, license_plate, license_state, status, drip_day3_sent_at, drip_unsubscribed')
      .lte('created_at', day3Threshold)
      .gte('created_at', backfillFloor)
      .is('drip_day3_sent_at', null)
      .eq('drip_unsubscribed', false)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true })
      .limit(budget);
    const { data: day3Due, error: day3Err } = await day3Query;

    if (day3Err) {
      console.error('Day 3 query failed:', day3Err.message);
      results.errors.push(`day3 query: ${day3Err.message}`);
    }

    for (const row of (day3Due || []) as any[]) {
      if (budget <= 0) break;
      try {
        await sendFoiaDripDay3({
          email: row.email,
          name: row.name,
          licensePlate: row.license_plate,
          licenseState: row.license_state,
        });
        await supabaseAdmin
          .from('foia_history_requests')
          .update({ drip_day3_sent_at: new Date().toISOString() } as any)
          .eq('id', row.id);
        results.day3Sent++;
        budget--;
        await new Promise(r => setTimeout(r, PAUSE_BETWEEN_SENDS_MS));
      } catch (err: any) {
        console.error(`day3 send failed for ${row.email}: ${err.message}`);
        results.errors.push(`day3:${row.email}: ${err.message}`);
      }
    }

    // ── Day 7: created 7-21 days ago, day7 never sent, day3 sent ≥24h ago, not unsubscribed ──
    const day7Query = supabaseAdmin
      .from('foia_history_requests' as any)
      .select('id, email, name, license_plate, license_state, status, ticket_count, total_fines, drip_day3_sent_at, drip_day7_sent_at, drip_unsubscribed')
      .lte('created_at', day7Threshold)
      .gte('created_at', backfillFloor)
      .is('drip_day7_sent_at', null)
      .not('drip_day3_sent_at', 'is', null)
      .lte('drip_day3_sent_at', day7GapThreshold)
      .eq('drip_unsubscribed', false)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true })
      .limit(budget);
    const { data: day7Due, error: day7Err } = await day7Query;

    if (day7Err) {
      console.error('Day 7 query failed:', day7Err.message);
      results.errors.push(`day7 query: ${day7Err.message}`);
    }

    for (const row of (day7Due || []) as any[]) {
      if (budget <= 0) break;
      try {
        await sendFoiaDripDay7({
          email: row.email,
          name: row.name,
          licensePlate: row.license_plate,
          licenseState: row.license_state,
          ticketCount: row.ticket_count ?? null,
          totalFines: row.total_fines ?? null,
          status: row.status,
        });
        await supabaseAdmin
          .from('foia_history_requests')
          .update({ drip_day7_sent_at: new Date().toISOString() } as any)
          .eq('id', row.id);
        results.day7Sent++;
        budget--;
        await new Promise(r => setTimeout(r, PAUSE_BETWEEN_SENDS_MS));
      } catch (err: any) {
        console.error(`day7 send failed for ${row.email}: ${err.message}`);
        results.errors.push(`day7:${row.email}: ${err.message}`);
      }
    }

    console.log(`FOIA drip complete: ${results.day3Sent} day3, ${results.day7Sent} day7, ${results.errors.length} errors`);
    return res.status(200).json(results);
  } catch (err: any) {
    console.error('FOIA drip crashed:', err.message);
    return res.status(500).json({ error: sanitizeErrorMessage(err), partial: results });
  }
}
