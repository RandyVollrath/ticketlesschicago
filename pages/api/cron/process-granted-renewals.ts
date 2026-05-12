// Hourly cron: finds granted renewal_purchase_consents rows and runs the
// full automation against each one. This is the orchestration point
// between user-authorized-the-renewal and we-actually-did-it.
//
// Flow per granted consent:
//   1. Gate checks (already enforced inside the runners — defense in depth)
//   2. Lookup user vehicle + email
//   3. Stripe charge via chargeRenewalConsent
//      - On failure: mark consent failed, no gov-side attempt, alert admin
//   4. Run the matching automation (city or plate)
//      - On success: capture screenshot → bucket, send user receipt
//      - On failure: refund the Stripe charge, mark consent failed,
//        alert admin
//   5. Consent is marked consumed/failed by the runner itself; this cron
//      just kicks them off
//
// Constraints:
//   - Processes at most BATCH_SIZE consents per run (5 by default) so a
//     bad day doesn't blow through the breaker invisibly
//   - Runs serial, not parallel — both gov sites are flaky enough that
//     concurrent sessions could rate-limit us
//   - Skips consents whose renewal type's circuit breaker is tripped

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin as typedSupabase } from '../../../lib/supabase';
import type { ConsentRecord, RenewalType } from '../../../lib/renewal-consent';
import { chargeRenewalConsent, refundRenewalCharge } from '../../../lib/renewal-charge';
import { runCitySticerRenewal } from '../../../lib/city-sticker-purchase';
import { runPlateStickerRenewal } from '../../../lib/plate-sticker-automation';
import { isCircuitTripped } from '../../../lib/renewal-failure-recovery';
import { uploadRenewalScreenshot, sendUserRenewalReceiptEmail, sendAdminRenewalNotice } from '../../../lib/renewal-receipts';
import { sendRenewalOperatorAlert } from '../../../lib/renewal-alerts';
import { isAutoRenewalGloballyEnabled } from '../../../lib/auto-renewal-gate';

const supabaseAdmin = typedSupabase as any;
const BATCH_SIZE = 5;

function isAuthorizedCron(req: NextApiRequest): boolean {
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
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

async function processOne(consent: ConsentRecord): Promise<{ outcome: string; detail?: string }> {
  const user = await loadUserVehicle(consent.user_id);
  if (!user || !user.email) {
    return { outcome: 'skipped_no_user', detail: 'user_profiles row missing' };
  }

  // Stripe charge first. If the user's card declines, no point hitting the gov site.
  const charge = await chargeRenewalConsent({ consent, userEmail: user.email });
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
    return { outcome: 'charge_failed', detail: charge.error };
  }

  // Run automation
  let result;
  if (consent.renewal_type === 'city_sticker') {
    if (!user.license_plate || !user.vin || !user.last_name) {
      await refundRenewalCharge(charge.paymentIntentId!, 'missing vehicle data');
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
      dryRun: false,
    });
  } else {
    result = await runPlateStickerRenewal({
      consent,
      userEmail: user.email,
      dryRun: false,
    });
  }

  if (!result.success) {
    // Best-effort refund. Don't block on refund result.
    if (charge.paymentIntentId) {
      await refundRenewalCharge(charge.paymentIntentId, `automation: ${result.stoppedAt || 'unknown'}: ${result.error || 'failed'}`);
    }
    await sendAdminRenewalNotice({
      consent,
      userEmail: user.email,
      amountChargedCents: charge.amountChargedCents ?? 0,
      success: false,
      error: `${result.stoppedAt}: ${result.error}`,
    });
    return { outcome: `automation_failed_${result.stoppedAt}`, detail: result.error };
  }

  // Success path: upload last screenshot, send receipt.
  let signedUrl: string | null = null;
  if (result.screenshotPaths.length > 0) {
    try {
      const upload = await uploadRenewalScreenshot(consent, result.screenshotPaths[result.screenshotPaths.length - 1]);
      signedUrl = upload.signedUrl;
    } catch (e) {
      console.error('[process-granted-renewals] screenshot upload failed', e);
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
  return { outcome: 'success' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'unauthorized' });

  // Defense in depth: global kill switch must be ON or this whole cron is a no-op.
  if (!isAutoRenewalGloballyEnabled()) {
    return res.status(200).json({ skipped: true, reason: 'AUTO_RENEWAL_GLOBALLY_ENABLED is not true' });
  }

  // Pick up to BATCH_SIZE granted consents.
  const { data: consents, error: listErr } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .select('*')
    .eq('status', 'granted')
    .gt('expires_at', new Date().toISOString())
    .order('granted_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (listErr) {
    await sendRenewalOperatorAlert({
      subject: 'process-granted-renewals query failed',
      severity: 'warning',
      body: `Could not list granted consents: ${listErr.message}`,
    });
    return res.status(500).json({ error: listErr.message });
  }

  const results: Array<{ id: string; type: RenewalType; outcome: string; detail?: string }> = [];

  for (const c of (consents as ConsentRecord[]) ?? []) {
    // Skip if this type's breaker is tripped.
    if (await isCircuitTripped(c.renewal_type)) {
      results.push({ id: c.id, type: c.renewal_type, outcome: 'skipped_breaker_tripped' });
      continue;
    }
    try {
      const r = await processOne(c);
      results.push({ id: c.id, type: c.renewal_type, ...r });
    } catch (e: any) {
      results.push({ id: c.id, type: c.renewal_type, outcome: 'exception', detail: e?.message || String(e) });
      await sendRenewalOperatorAlert({
        subject: `Unhandled exception processing consent ${c.id}`,
        severity: 'emergency',
        body: e?.stack || String(e),
      });
    }
  }

  return res.status(200).json({ ok: true, processed: results.length, results });
}
