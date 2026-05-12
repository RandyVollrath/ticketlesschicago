// Two-layer gate for the auto-renewal feature.
//
// Layer 1 (global): env var AUTO_RENEWAL_GLOBALLY_ENABLED. Defaults to OFF.
//   - One flip kills every automation regardless of per-user grants. Use this
//     if legal flags an issue, if we discover the feature is broken in prod,
//     or any time we need to halt all renewals immediately.
//
// Layer 2 (per-user): user_profiles.auto_renewal_authorized BOOLEAN.
//   - Default FALSE for every user. Admin must explicitly grant via
//     scripts/grant-auto-renewal.ts.
//
// EVERY automation cron and entrypoint MUST call assertAutoRenewalAllowed()
// before doing anything that touches a government website on a user's behalf.

import { supabaseAdmin } from './supabase';

export class AutoRenewalNotAllowedError extends Error {
  constructor(reason: string) {
    super(`Auto-renewal not allowed: ${reason}`);
    this.name = 'AutoRenewalNotAllowedError';
  }
}

export function isAutoRenewalGloballyEnabled(): boolean {
  const raw = (process.env.AUTO_RENEWAL_GLOBALLY_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export interface AutoRenewalGateCheck {
  allowed: boolean;
  reason?: string;
  user?: {
    authorized: boolean;
    authorized_at: string | null;
    authorized_by: string | null;
  };
}

export async function checkAutoRenewalAllowed(userId: string): Promise<AutoRenewalGateCheck> {
  if (!isAutoRenewalGloballyEnabled()) {
    return { allowed: false, reason: 'global kill switch is off (AUTO_RENEWAL_GLOBALLY_ENABLED)' };
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('auto_renewal_authorized, auto_renewal_authorized_at, auto_renewal_authorized_by' as any)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { allowed: false, reason: `user_profiles lookup failed: ${error.message}` };
  }
  if (!data) {
    return { allowed: false, reason: 'user_profiles row not found' };
  }

  const row = data as unknown as {
    auto_renewal_authorized: boolean;
    auto_renewal_authorized_at: string | null;
    auto_renewal_authorized_by: string | null;
  };

  if (!row.auto_renewal_authorized) {
    return {
      allowed: false,
      reason: 'user not authorized for auto-renewal',
      user: { authorized: false, authorized_at: null, authorized_by: null },
    };
  }
  return {
    allowed: true,
    user: {
      authorized: true,
      authorized_at: row.auto_renewal_authorized_at,
      authorized_by: row.auto_renewal_authorized_by,
    },
  };
}

export async function assertAutoRenewalAllowed(userId: string): Promise<void> {
  const check = await checkAutoRenewalAllowed(userId);
  if (!check.allowed) throw new AutoRenewalNotAllowedError(check.reason || 'unknown');
}
