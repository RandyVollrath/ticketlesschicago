// Core orchestration logic for processing a granted renewal consent —
// extracted out of pages/api/cron/process-granted-renewals.ts so a
// worker-machine script (where the card env vars live) can drive it.
//
// One worker process at a time:
//   - claimGrantedConsent(workerId)  → atomically pick up one granted row
//   - processConsent(consent)        → charge + automation + receipt + cleanup
//   - releaseClaim(consent.id)       → only used by detector cron for stuck rows

import { supabaseAdmin as typedSupabase } from './supabase';
import type { ConsentRecord, RenewalType } from './renewal-consent';
import { chargeRenewalConsent, refundRenewalCharge } from './renewal-charge';
import { runCitySticerRenewal } from './city-sticker-purchase';
import { runPlateStickerRenewal } from './plate-sticker-automation';
import { isCircuitTripped } from './renewal-failure-recovery';
import {
  uploadRenewalScreenshot,
  sendUserRenewalReceiptEmail,
  sendAdminRenewalNotice,
  sendUserRenewalFailedEmail,
} from './renewal-receipts';
import { isAutoRenewalGloballyEnabled } from './auto-renewal-gate';

const supabaseAdmin = typedSupabase as any;

export function isDryRun(): boolean {
  const v = (process.env.RENEWAL_DRY_RUN || '').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function mapFailureReason(
  stoppedAt?: string,
): 'invalid_credentials' | 'card_declined' | 'site_changed' | 'circuit_breaker' | 'other' {
  switch (stoppedAt) {
    case 'invalid_credentials':
    case 'missing_credentials':
      return 'invalid_credentials';
    case 'akamai_block':
    case 'login_form_changed':
    case 'payment_form':
    case 'vehicle_search':
    case 'login':
      return 'site_changed';
    case 'gate':
      return 'circuit_breaker';
    default:
      return 'other';
  }
}

interface UserVehicle {
  email: string;
  license_plate: string | null;
  license_state: string | null;
  vin: string | null;
  last_name: string | null;
}

async function loadUserVehicle(userId: string): Promise<UserVehicle | null> {
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('email, license_plate, license_state, vin, last_name')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as UserVehicle) ?? null;
}

/**
 * Atomically claim one granted-and-unclaimed consent for processing.
 * Returns null if none available. Skips consents whose renewal_type
 * circuit breaker is currently tripped.
 */
export async function claimGrantedConsent(workerId: string): Promise<ConsentRecord | null> {
  // Pull a small batch of candidates so we can filter out
  // breaker-tripped types before attempting the atomic claim.
  const { data: candidates } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .select('*')
    .eq('status', 'granted')
    .is('claimed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('granted_at', { ascending: true })
    .limit(10);

  for (const c of (candidates as ConsentRecord[]) ?? []) {
    if (await isCircuitTripped(c.renewal_type)) continue;

    // Atomic claim: only succeed if claimed_at is still null. If a
    // concurrent worker already grabbed this row the update affects 0 rows.
    const { data: claimed, error } = await supabaseAdmin
      .from('renewal_purchase_consents')
      .update({ claimed_at: new Date().toISOString(), claimed_by: workerId, updated_at: new Date().toISOString() })
      .eq('id', c.id)
      .is('claimed_at', null)
      .select()
      .maybeSingle();
    if (error) {
      console.error('[run-granted-consents] claim attempt failed', error);
      continue;
    }
    if (claimed) return claimed as ConsentRecord;
  }
  return null;
}

export async function releaseStaleClaim(consentId: string): Promise<void> {
  await supabaseAdmin
    .from('renewal_purchase_consents')
    .update({ claimed_at: null, claimed_by: null, updated_at: new Date().toISOString() })
    .eq('id', consentId);
}

export interface ProcessOutcome {
  outcome: string;
  detail?: string;
  paymentIntentId?: string | null;
  amountChargedCents?: number | null;
}

export async function processConsent(consent: ConsentRecord): Promise<ProcessOutcome> {
  const dryRun = isDryRun();
  const user = await loadUserVehicle(consent.user_id);
  if (!user || !user.email) {
    return { outcome: 'skipped_no_user', detail: 'user_profiles row missing' };
  }

  const charge = dryRun
    ? { success: true as const, paymentIntentId: null, amountChargedCents: consent.total_amount_cents }
    : await chargeRenewalConsent({ consent, userEmail: user.email });

  if (!charge.success) {
    await supabaseAdmin
      .from('renewal_purchase_consents')
      .update({
        status: 'failed',
        failure_reason: `stripe: ${charge.error || 'unknown'}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', consent.id);
    await sendAdminRenewalNotice({
      consent,
      userEmail: user.email,
      amountChargedCents: 0,
      success: false,
      error: `Stripe charge failed: ${charge.error}`,
    });
    await sendUserRenewalFailedEmail({ consent, userEmail: user.email, reason: 'card_declined', detail: charge.error });
    return { outcome: 'charge_failed', detail: charge.error };
  }

  let result;
  if (consent.renewal_type === 'city_sticker') {
    if (!user.license_plate || !user.vin || !user.last_name) {
      if (charge.paymentIntentId) await refundRenewalCharge(charge.paymentIntentId, 'missing vehicle data');
      await supabaseAdmin
        .from('renewal_purchase_consents')
        .update({ status: 'failed', failure_reason: 'missing license_plate / vin / last_name', updated_at: new Date().toISOString() })
        .eq('id', consent.id);
      await sendAdminRenewalNotice({ consent, userEmail: user.email, amountChargedCents: charge.amountChargedCents ?? 0, success: false, error: 'Missing vehicle data; refunded.' });
      return { outcome: 'missing_vehicle_data' };
    }
    result = await runCitySticerRenewal({
      consent,
      vehicle: {
        licensePlate: user.license_plate,
        vinLast6: user.vin.slice(-6),
        lastName: user.last_name,
        email: user.email,
      },
      dryRun,
    });
  } else {
    result = await runPlateStickerRenewal({ consent, userEmail: user.email, dryRun });
  }

  if (!result.success) {
    if (!dryRun && charge.paymentIntentId) {
      await refundRenewalCharge(charge.paymentIntentId, `automation: ${result.stoppedAt || 'unknown'}: ${result.error || 'failed'}`);
    }
    await sendAdminRenewalNotice({
      consent,
      userEmail: user.email,
      amountChargedCents: charge.amountChargedCents ?? 0,
      success: false,
      error: `${dryRun ? '[DRY RUN] ' : ''}${result.stoppedAt}: ${result.error}`,
    });
    if (!dryRun && result.stoppedAt !== 'payment_not_configured' && result.stoppedAt !== 'consent') {
      await sendUserRenewalFailedEmail({
        consent,
        userEmail: user.email,
        reason: mapFailureReason(result.stoppedAt),
        detail: result.error,
      });
    }
    return { outcome: `automation_failed_${result.stoppedAt}`, detail: result.error, paymentIntentId: charge.paymentIntentId, amountChargedCents: charge.amountChargedCents ?? null };
  }

  // Success — upload last screenshot, send receipt.
  let signedUrl: string | null = null;
  if (result.screenshotPaths.length > 0) {
    try {
      const upload = await uploadRenewalScreenshot(consent, result.screenshotPaths[result.screenshotPaths.length - 1]);
      signedUrl = upload.signedUrl;
    } catch (e) {
      console.error('[run-granted-consents] screenshot upload failed', e);
    }
  }

  await sendUserRenewalReceiptEmail({
    consent,
    userEmail: user.email,
    confirmationNumber: result.confirmationNumber || null,
    receiptUrl: signedUrl,
    amountChargedCents: charge.amountChargedCents ?? consent.total_amount_cents,
  });
  await sendAdminRenewalNotice({
    consent,
    userEmail: user.email,
    confirmationNumber: result.confirmationNumber || null,
    receiptUrl: signedUrl,
    amountChargedCents: charge.amountChargedCents ?? consent.total_amount_cents,
    success: true,
  });
  return { outcome: 'success', paymentIntentId: charge.paymentIntentId, amountChargedCents: charge.amountChargedCents ?? null };
}

export function isPipelineEnabled(): boolean {
  return isAutoRenewalGloballyEnabled();
}

export type { ConsentRecord, RenewalType };
