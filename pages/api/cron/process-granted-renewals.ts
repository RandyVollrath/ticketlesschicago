// REPURPOSED — this cron USED to do the orchestration itself, but that
// has moved to the worker machine (scripts/run-renewal-queue.ts) so the
// CITY_PAYMENT_CARD_* env vars never sit in Vercel. This cron now just
// monitors the worker's health:
//
//   - alerts when a consent has been claimed > 1 hour with no consumed_at
//     (worker crashed mid-processing, manual recovery needed)
//   - alerts when no consent has been consumed in > 24 hours AND there
//     are unclaimed granted consents waiting (worker is down or stalled)

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin as typedSupabase } from '../../../lib/supabase';
import { sendRenewalOperatorAlert } from '../../../lib/renewal-alerts';
import { isAutoRenewalGloballyEnabled } from '../../../lib/auto-renewal-gate';

const supabaseAdmin = typedSupabase as any;

function isAuthorizedCron(req: NextApiRequest): boolean {
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!isAutoRenewalGloballyEnabled()) {
    return res.status(200).json({ skipped: true, reason: 'AUTO_RENEWAL_GLOBALLY_ENABLED not true' });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: stuck } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .select('id, renewal_type, user_id, claimed_at, claimed_by')
    .lt('claimed_at', oneHourAgo)
    .is('consumed_at', null)
    .limit(20);

  const { data: waiting } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .select('id')
    .eq('status', 'granted')
    .is('claimed_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(20);

  const { data: lastConsumed } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .select('consumed_at')
    .not('consumed_at', 'is', null)
    .order('consumed_at', { ascending: false })
    .limit(1);

  const lastConsumedAt = (lastConsumed?.[0]?.consumed_at as string) || null;
  const workerSilent =
    Array.isArray(waiting) && waiting.length > 0 && (!lastConsumedAt || lastConsumedAt < dayAgo);

  const alerts: string[] = [];

  if (Array.isArray(stuck) && stuck.length > 0) {
    alerts.push(
      `${stuck.length} consent(s) claimed > 1h ago with no consumed_at — worker likely crashed mid-job:\n` +
        stuck
          .map((s: any) => `  - ${s.id} (${s.renewal_type}) claimed by ${s.claimed_by} at ${s.claimed_at}`)
          .join('\n'),
    );
  }

  if (workerSilent) {
    alerts.push(
      `${waiting!.length} granted consents waiting, but no consumption in > 24h. Last consumed_at: ${lastConsumedAt || '(never)'}. Worker likely down — check scripts/run-renewal-queue.ts on the ops box.`,
    );
  }

  if (alerts.length > 0) {
    await sendRenewalOperatorAlert({
      subject: 'Renewal worker health degraded',
      severity: 'warning',
      body: alerts.join('\n\n'),
    });
  }

  return res.status(200).json({
    ok: alerts.length === 0,
    stuck_count: stuck?.length ?? 0,
    waiting_count: waiting?.length ?? 0,
    last_consumed_at: lastConsumedAt,
    worker_silent: workerSilent,
  });
}
