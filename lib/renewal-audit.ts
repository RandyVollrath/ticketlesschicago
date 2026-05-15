// Audit-log helper for renewal pipeline state transitions. Writes to the
// existing audit_logs table (schema: user_id, admin_user_id, action_type,
// entity_type, entity_id, action_details, status, error_message, ip_address,
// user_agent). Best-effort — a failed audit insert never blocks the
// underlying operation, only logs a warning.

import { supabaseAdmin as typedSupabase } from './supabase';

const supabaseAdmin = typedSupabase as any;

export type RenewalAuditAction =
  | 'renewal_consent_created'
  | 'renewal_consent_auto_granted'
  | 'renewal_consent_granted'
  | 'renewal_consent_declined'
  | 'renewal_consent_revoked'
  | 'renewal_consent_expired'
  | 'renewal_consent_consumed_success'
  | 'renewal_consent_consumed_failure'
  | 'renewal_circuit_breaker_tripped'
  | 'renewal_circuit_breaker_reset';

export interface RenewalAuditInput {
  action: RenewalAuditAction;
  userId: string | null;
  consentId: string | null;
  details?: Record<string, unknown>;
  status?: 'success' | 'failure';
  errorMessage?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  adminUserId?: string | null;
}

export async function logRenewalAudit(input: RenewalAuditInput): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: input.userId ?? null,
      admin_user_id: input.adminUserId ?? null,
      action_type: input.action,
      entity_type: input.consentId ? 'renewal_purchase_consent' : 'renewal_pipeline',
      entity_id: input.consentId ?? null,
      action_details: input.details ?? {},
      status: input.status ?? 'success',
      error_message: input.errorMessage ?? null,
      ip_address: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    });
  } catch (e: any) {
    console.warn('[renewal-audit] insert failed (non-blocking):', e?.message || e);
  }
}
