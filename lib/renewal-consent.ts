// Helpers for managing per-renewal consent records. Used by the renewal
// reminder cron to create pending requests, by the user-facing authorize
// page to grant/decline, and by the automation runner to consume.

import { randomBytes } from 'crypto';
import { supabaseAdmin as typedSupabase } from './supabase';
import { logRenewalAudit } from './renewal-audit';

// renewal_purchase_consents is a new table not yet in the generated types.
// Cast at the supabase reference so all queries below skip the typegen.
const supabaseAdmin = typedSupabase as any;

export type RenewalType = 'city_sticker' | 'license_plate';
export type ConsentStatus = 'pending' | 'granted' | 'declined' | 'expired' | 'consumed' | 'failed';

export interface ConsentRecord {
  id: string;
  user_id: string;
  renewal_type: RenewalType;
  license_plate: string | null;
  license_state: string | null;
  gov_amount_cents: number;
  service_fee_cents: number;
  total_amount_cents: number;
  consent_token: string;
  status: ConsentStatus;
  expires_at: string;
  granted_at: string | null;
  granted_ip: string | null;
  declined_at: string | null;
  consumed_at: string | null;
  purchase_result: unknown;
  failure_reason: string | null;
  created_at: string;
}

export interface CreateConsentInput {
  userId: string;
  renewalType: RenewalType;
  licensePlate?: string | null;
  licenseState?: string | null;
  govAmountCents: number;
  serviceFeeCents?: number;
  expiresInDays?: number;
  /**
   * When true, the consent is created with status='granted' immediately
   * (default-compliant flow — user has already opted in via /settings).
   * granted_at is set; granted_ip/UA stay null. auto_granted=true is recorded
   * so audit + support tooling can distinguish from per-renewal Authorize clicks.
   */
  autoGrant?: boolean;
}

export function generateConsentToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function createConsentRequest(input: CreateConsentInput): Promise<ConsentRecord> {
  const fee = input.serviceFeeCents ?? 0;
  const total = input.govAmountCents + fee;
  const expires = new Date(Date.now() + (input.expiresInDays ?? 30) * 24 * 60 * 60 * 1000);
  const token = generateConsentToken();

  const insertRow: Record<string, unknown> = {
    user_id: input.userId,
    renewal_type: input.renewalType,
    license_plate: input.licensePlate ?? null,
    license_state: input.licenseState ?? null,
    gov_amount_cents: input.govAmountCents,
    service_fee_cents: fee,
    total_amount_cents: total,
    consent_token: token,
    status: input.autoGrant ? 'granted' : 'pending',
    expires_at: expires.toISOString(),
  };
  if (input.autoGrant) {
    insertRow.granted_at = new Date().toISOString();
    insertRow.auto_granted = true;
  }

  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .insert(insertRow)
    .select()
    .single();

  if (error) throw new Error(`createConsentRequest: ${error.message}`);
  const record = data as unknown as ConsentRecord;
  await logRenewalAudit({
    action: input.autoGrant ? 'renewal_consent_auto_granted' : 'renewal_consent_created',
    userId: record.user_id,
    consentId: record.id,
    details: {
      renewal_type: record.renewal_type,
      license_plate: record.license_plate,
      total_amount_cents: record.total_amount_cents,
      expires_at: record.expires_at,
      auto_granted: Boolean(input.autoGrant),
    },
  });
  return record;
}

export async function getConsentByToken(token: string): Promise<ConsentRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .select('*')
    .eq('consent_token', token)
    .maybeSingle();
  if (error) throw new Error(`getConsentByToken: ${error.message}`);
  return (data as unknown as ConsentRecord) ?? null;
}

export async function grantConsent(token: string, meta: { ip?: string; userAgent?: string }): Promise<ConsentRecord> {
  const existing = await getConsentByToken(token);
  if (!existing) throw new Error('Consent record not found');
  if (existing.status !== 'pending') throw new Error(`Cannot grant — status is ${existing.status}`);
  if (new Date(existing.expires_at) < new Date()) {
    await supabaseAdmin
      .from('renewal_purchase_consents')
      .update({ status: 'expired', updated_at: new Date().toISOString() } as any)
      .eq('id', existing.id);
    throw new Error('Consent window has expired');
  }
  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .update({
      status: 'granted',
      granted_at: new Date().toISOString(),
      granted_ip: meta.ip ?? null,
      granted_user_agent: meta.userAgent ?? null,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw new Error(`grantConsent: ${error.message}`);
  const record = data as unknown as ConsentRecord;
  await logRenewalAudit({
    action: 'renewal_consent_granted',
    userId: record.user_id,
    consentId: record.id,
    details: { renewal_type: record.renewal_type, total_amount_cents: record.total_amount_cents },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return record;
}

export async function declineConsent(token: string): Promise<ConsentRecord> {
  const existing = await getConsentByToken(token);
  if (!existing) throw new Error('Consent record not found');
  if (existing.status !== 'pending') throw new Error(`Cannot decline — status is ${existing.status}`);
  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .update({
      status: 'declined',
      declined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw new Error(`declineConsent: ${error.message}`);
  const record = data as unknown as ConsentRecord;
  await logRenewalAudit({
    action: 'renewal_consent_declined',
    userId: record.user_id,
    consentId: record.id,
    details: { renewal_type: record.renewal_type },
  });
  return record;
}

/**
 * Revoke a previously-granted consent before the worker picks it up. If the
 * worker has already claimed the row, revocation fails because the
 * automation may be mid-flight. Atomic — only succeeds if status='granted'
 * AND claimed_at IS NULL.
 */
export async function revokeGrantedConsent(token: string): Promise<ConsentRecord> {
  const existing = await getConsentByToken(token);
  if (!existing) throw new Error('Consent record not found');
  if (existing.status !== 'granted') throw new Error(`Cannot revoke — status is ${existing.status}`);
  if ((existing as any).claimed_at) {
    throw new Error('Cannot revoke — automation already in progress (contact support if you need a refund)');
  }
  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .update({
      status: 'declined',
      declined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', existing.id)
    .eq('status', 'granted')
    .is('claimed_at', null)
    .select()
    .maybeSingle();
  if (error) throw new Error(`revokeGrantedConsent: ${error.message}`);
  if (!data) throw new Error('Cannot revoke — worker has just claimed this consent. Contact support.');
  const record = data as unknown as ConsentRecord;
  await logRenewalAudit({
    action: 'renewal_consent_revoked',
    userId: record.user_id,
    consentId: record.id,
    details: { renewal_type: record.renewal_type },
  });
  return record;
}

export async function consumeConsent(
  id: string,
  result: { success: boolean; data?: unknown; failureReason?: string }
): Promise<ConsentRecord> {
  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .update({
      status: result.success ? 'consumed' : 'failed',
      consumed_at: new Date().toISOString(),
      purchase_result: result.data ?? null,
      failure_reason: result.failureReason ?? null,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`consumeConsent: ${error.message}`);
  const record = data as unknown as ConsentRecord;
  await logRenewalAudit({
    action: result.success ? 'renewal_consent_consumed_success' : 'renewal_consent_consumed_failure',
    userId: record.user_id,
    consentId: record.id,
    details: {
      renewal_type: record.renewal_type,
      purchase_result: result.data ?? null,
    },
    status: result.success ? 'success' : 'failure',
    errorMessage: result.failureReason ?? null,
  });
  return record;
}

/**
 * Returns the active (granted, not consumed, not expired) consent for a user+renewal
 * pair, or null. Used by the automation runner to verify it's OK to proceed.
 */
export async function findActiveGrantedConsent(
  userId: string,
  renewalType: RenewalType
): Promise<ConsentRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .select('*')
    .eq('user_id', userId)
    .eq('renewal_type', renewalType)
    .eq('status', 'granted')
    .gt('expires_at', new Date().toISOString())
    .order('granted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findActiveGrantedConsent: ${error.message}`);
  return (data as unknown as ConsentRecord) ?? null;
}
