// Admin-only status JSON for the auto-renewal pipeline.
// Same data as scripts/auto-renewal-status.ts but for the browser dashboard.

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin as typedSupabase, supabase } from '../../../lib/supabase';
import { getCircuitBreaker } from '../../../lib/renewal-failure-recovery';
import { isAutoRenewalGloballyEnabled } from '../../../lib/auto-renewal-gate';

const supa = typedSupabase as any;

const ADMIN_EMAILS = new Set([
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
]);

async function requireAdmin(req: NextApiRequest): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ') || !supabase) {
    return { ok: false, status: 401, error: 'Authorization required' };
  }
  const token = auth.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: 'Invalid token' };
  if (!user.email || !ADMIN_EMAILS.has(user.email)) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }
  return { ok: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await requireAdmin(req);
  if (auth.ok !== true) return res.status(auth.status).json({ error: auth.error });

  const [
    authedCount,
    credsCount,
    invalidCount,
    bothCount,
    breaker_city,
    breaker_plate,
  ] = await Promise.all([
    supa.from('user_profiles').select('user_id', { count: 'exact', head: true }).eq('auto_renewal_authorized', true),
    supa.from('user_profiles').select('user_id', { count: 'exact', head: true })
      .not('il_pin_encrypted', 'is', null).not('il_registration_id_encrypted', 'is', null),
    supa.from('user_profiles').select('user_id', { count: 'exact', head: true })
      .not('il_credentials_invalid_at', 'is', null),
    supa.from('user_profiles').select('user_id', { count: 'exact', head: true })
      .eq('auto_renewal_authorized', true).not('il_pin_encrypted', 'is', null),
    getCircuitBreaker('city_sticker'),
    getCircuitBreaker('license_plate'),
  ]);

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const statuses = ['pending', 'granted', 'declined', 'expired', 'consumed', 'failed'] as const;
  const consentCounts: Record<string, number> = {};
  for (const s of statuses) {
    const { count } = await supa.from('renewal_purchase_consents')
      .select('id', { count: 'exact', head: true }).eq('status', s).gt('created_at', since);
    consentCounts[s] = count ?? 0;
  }

  const { data: recentFailures } = await supa
    .from('renewal_purchase_consents')
    .select('id, renewal_type, status, failure_reason, updated_at, license_plate')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(10);

  const { data: lastConsumedRow } = await supa
    .from('renewal_purchase_consents')
    .select('consumed_at')
    .not('consumed_at', 'is', null)
    .order('consumed_at', { ascending: false })
    .limit(1);
  const lastConsumedAt = (lastConsumedRow?.[0]?.consumed_at as string) || null;

  return res.status(200).json({
    env: {
      global_kill_switch_on: isAutoRenewalGloballyEnabled(),
      credentials_encryption_key_set: Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY),
      ops_card_set: Boolean(
        process.env.CITY_PAYMENT_CARD_NUMBER &&
          process.env.CITY_PAYMENT_CARD_EXP &&
          process.env.CITY_PAYMENT_CARD_CVV,
      ),
      billing_info_set: Boolean(process.env.CITY_PAYMENT_BILLING_ADDRESS1 && process.env.CITY_PAYMENT_BILLING_ZIP),
    },
    users: {
      authorized: authedCount.count ?? 0,
      credentials_on_file: credsCount.count ?? 0,
      credentials_invalid: invalidCount.count ?? 0,
      both_authorized_and_credentialed: bothCount.count ?? 0,
    },
    circuit_breakers: { city_sticker: breaker_city, license_plate: breaker_plate },
    consents_last_7_days: consentCounts,
    last_consumed_at: lastConsumedAt,
    recent_failures: recentFailures ?? [],
  });
}
