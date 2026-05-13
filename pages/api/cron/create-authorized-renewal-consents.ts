// Daily cron — for users who are admin-authorized AND have credentials on
// file AND have a renewal approaching, create a pending consent record and
// email them the /renewal/authorize/<token> link. The user clicks to grant;
// the hourly orchestration cron then executes.
//
// Eligibility (per renewal type):
//   city_sticker:
//     - auto_renewal_authorized = true
//     - has license_plate + vin + last_name (the only EzBuy auth fields)
//     - city_sticker_expiry between today+30 and today+45
//     - no consent for (user, city_sticker) with status in
//       (pending, granted, consumed) created in the last 60 days
//   license_plate:
//     - auto_renewal_authorized = true
//     - il_pin_encrypted + il_registration_id_encrypted both set
//     - il_credentials_invalid_at IS NULL
//     - license_plate_expiry between today+30 and today+45
//     - no consent for (user, license_plate) similar
//     - emissions_completed = true OR emissions_date IS NULL  (block
//       plate renewal until emissions is done, per existing
//       check_emissions_blocks_renewal helper)

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin as typedSupabase } from '../../../lib/supabase';
import { createConsentRequest } from '../../../lib/renewal-consent';
import { isAutoRenewalGloballyEnabled } from '../../../lib/auto-renewal-gate';
import { estimateCityStickerCents, estimatePlateStickerCents } from '../../../lib/sticker-fees';

const supabaseAdmin = typedSupabase as any;
const ADMIN_EMAIL = 'randyvollrath@gmail.com';

const WINDOW_MIN_DAYS = 30;
const WINDOW_MAX_DAYS = 45;
const DUPLICATE_LOOKBACK_DAYS = 60;

// Service fee per renewal. Configurable via env, defaults to 0.
function serviceFeeCents(): number {
  const v = parseInt(process.env.RENEWAL_SERVICE_FEE_CENTS || '0', 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function isAuthorizedCron(req: NextApiRequest): boolean {
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

function siteBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://www.autopilotamerica.com';
}

interface CandidateRow {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  license_plate: string | null;
  license_state: string | null;
  vin: string | null;
  city_sticker_expiry: string | null;
  license_plate_expiry: string | null;
  license_plate_type: string | null;
  license_plate_renewal_cost: number | null;
  il_pin_encrypted: string | null;
  il_registration_id_encrypted: string | null;
  il_credentials_invalid_at: string | null;
  emissions_completed: boolean | null;
  emissions_date: string | null;
}

function inWindow(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const expires = new Date(dateStr);
  if (Number.isNaN(expires.getTime())) return false;
  const days = (expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days >= WINDOW_MIN_DAYS && days <= WINDOW_MAX_DAYS;
}

async function hasRecentConsent(
  userId: string,
  type: 'city_sticker' | 'license_plate',
  plateId?: string | null,
): Promise<boolean> {
  const since = new Date(Date.now() - DUPLICATE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let q = supabaseAdmin
    .from('renewal_purchase_consents')
    .select('id')
    .eq('user_id', userId)
    .eq('renewal_type', type)
    .in('status', ['pending', 'granted', 'consumed'])
    .gt('created_at', since);
  // Scope by plate_id if provided, otherwise check for any (legacy primary).
  q = plateId ? q.eq('plate_id', plateId) : q.is('plate_id', null);
  const { data } = await q.limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function sendAuthorizeEmail(params: {
  email: string;
  firstName: string | null;
  type: 'city_sticker' | 'license_plate';
  plate: string | null;
  totalCents: number;
  token: string;
  expiryDate: string | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const url = `${siteBaseUrl()}/renewal/authorize/${params.token}`;
  const label = params.type === 'city_sticker' ? 'Chicago city sticker' : 'Illinois plate sticker';
  const greet = params.firstName ? `Hi ${params.firstName},` : 'Hi,';
  const dollars = `$${(params.totalCents / 100).toFixed(2)}`;
  const expiryLabel = params.expiryDate ? new Date(params.expiryDate).toLocaleDateString() : 'soon';

  const lines = [
    greet,
    '',
    `Your ${label} renewal is coming up around ${expiryLabel}. We can handle it for you for ${dollars}.`,
    '',
    `Authorize this renewal: ${url}`,
    '',
    `Nothing is charged until you click Authorize. If you'd rather skip and renew yourself, just ignore this email.`,
    '',
    `Plate: ${params.plate || '(on file)'}`,
    '',
    `— Autopilot America`,
  ];

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Autopilot America <renewals@autopilotamerica.com>',
      to: [params.email],
      bcc: [ADMIN_EMAIL],
      subject: `Authorize your ${label} renewal`,
      text: lines.join('\n'),
    }),
  }).catch((e) => console.error('[create-authorized-renewal-consents] resend error', e));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!isAutoRenewalGloballyEnabled()) {
    return res.status(200).json({ skipped: true, reason: 'AUTO_RENEWAL_GLOBALLY_ENABLED not true' });
  }

  // Pull all authorized users with at least one upcoming expiration
  const { data: rows, error } = await supabaseAdmin
    .from('user_profiles')
    .select(
      'user_id, email, first_name, last_name, license_plate, license_state, vin, city_sticker_expiry, license_plate_expiry, license_plate_type, license_plate_renewal_cost, il_pin_encrypted, il_registration_id_encrypted, il_credentials_invalid_at, emissions_completed, emissions_date',
    )
    .eq('auto_renewal_authorized', true);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const created: Array<{ user_id: string; type: string; token: string; total_cents: number }> = [];
  const skipped: Array<{ user_id: string; reason: string }> = [];
  const fee = serviceFeeCents();

  for (const row of (rows as CandidateRow[]) ?? []) {
    if (!row.email) {
      skipped.push({ user_id: row.user_id, reason: 'no email' });
      continue;
    }

    // City sticker eligibility
    if (inWindow(row.city_sticker_expiry)) {
      if (!row.license_plate || !row.vin || !row.last_name) {
        skipped.push({ user_id: row.user_id, reason: 'city: missing plate/vin/last_name' });
      } else if (await hasRecentConsent(row.user_id, 'city_sticker')) {
        skipped.push({ user_id: row.user_id, reason: 'city: recent consent exists' });
      } else {
        const govCents = estimateCityStickerCents(row.license_plate_type);
        const consent = await createConsentRequest({
          userId: row.user_id,
          renewalType: 'city_sticker',
          licensePlate: row.license_plate,
          licenseState: row.license_state || 'IL',
          govAmountCents: govCents,
          serviceFeeCents: fee,
          expiresInDays: 21,
        });
        await sendAuthorizeEmail({
          email: row.email,
          firstName: row.first_name,
          type: 'city_sticker',
          plate: row.license_plate,
          totalCents: govCents + fee,
          token: consent.consent_token,
          expiryDate: row.city_sticker_expiry,
        });
        created.push({ user_id: row.user_id, type: 'city_sticker', token: consent.consent_token, total_cents: govCents + fee });
      }
    }

    // Plate sticker eligibility
    if (inWindow(row.license_plate_expiry)) {
      const emissionsBlocks = row.emissions_date && !row.emissions_completed;
      if (!row.il_pin_encrypted || !row.il_registration_id_encrypted) {
        skipped.push({ user_id: row.user_id, reason: 'plate: no IL creds on file' });
      } else if (row.il_credentials_invalid_at) {
        skipped.push({ user_id: row.user_id, reason: 'plate: IL creds marked invalid' });
      } else if (emissionsBlocks) {
        skipped.push({ user_id: row.user_id, reason: 'plate: emissions not completed' });
      } else if (await hasRecentConsent(row.user_id, 'license_plate')) {
        skipped.push({ user_id: row.user_id, reason: 'plate: recent consent exists' });
      } else {
        const govCents = estimatePlateStickerCents(row.license_plate_renewal_cost, row.license_plate_type);
        const consent = await createConsentRequest({
          userId: row.user_id,
          renewalType: 'license_plate',
          licensePlate: row.license_plate,
          licenseState: row.license_state || 'IL',
          govAmountCents: govCents,
          serviceFeeCents: fee,
          expiresInDays: 21,
        });
        await sendAuthorizeEmail({
          email: row.email,
          firstName: row.first_name,
          type: 'license_plate',
          plate: row.license_plate,
          totalCents: govCents + fee,
          token: consent.consent_token,
          expiryDate: row.license_plate_expiry,
        });
        created.push({ user_id: row.user_id, type: 'license_plate', token: consent.consent_token, total_cents: govCents + fee });
      }
    }
  }

  // Second pass: monitored_plates rows with per-plate expiry data and IL creds.
  // Each such plate becomes its own consent, linked via plate_id. Users with
  // 0 multi-vehicle data on monitored_plates see no change from this pass.
  const { data: plates } = await (supabaseAdmin as any)
    .from('monitored_plates')
    .select('id, user_id, plate, state, vin, last_name, city_sticker_expiry, license_plate_expiry, license_plate_type, license_plate_renewal_cost, il_pin_encrypted, il_registration_id_encrypted, il_credentials_invalid_at')
    .eq('status', 'active')
    .or('city_sticker_expiry.not.is.null,license_plate_expiry.not.is.null');

  // Build a quick lookup of (user_id -> profile) so we can check auto_renewal_authorized + email.
  const userMap = new Map<string, CandidateRow>();
  for (const r of (rows as CandidateRow[]) ?? []) userMap.set(r.user_id, r);

  for (const pl of (plates as any[]) ?? []) {
    const parent = userMap.get(pl.user_id);
    if (!parent || !parent.email) continue; // user not in the authorized set
    // City sticker per-plate
    if (inWindow(pl.city_sticker_expiry)) {
      if (!pl.plate || !pl.vin || !pl.last_name) {
        skipped.push({ user_id: pl.user_id, reason: `plate ${pl.id}: city missing plate/vin/last_name` });
      } else if (await hasRecentConsent(pl.user_id, 'city_sticker', pl.id)) {
        skipped.push({ user_id: pl.user_id, reason: `plate ${pl.id}: city recent consent` });
      } else {
        const govCents = estimateCityStickerCents(pl.license_plate_type);
        const consent = await createConsentRequest({
          userId: pl.user_id,
          renewalType: 'city_sticker',
          licensePlate: pl.plate,
          licenseState: pl.state || 'IL',
          govAmountCents: govCents,
          serviceFeeCents: fee,
          expiresInDays: 21,
        });
        await (supabaseAdmin as any)
          .from('renewal_purchase_consents')
          .update({ plate_id: pl.id, updated_at: new Date().toISOString() })
          .eq('id', consent.id);
        await sendAuthorizeEmail({
          email: parent.email,
          firstName: parent.first_name,
          type: 'city_sticker',
          plate: pl.plate,
          totalCents: govCents + fee,
          token: consent.consent_token,
          expiryDate: pl.city_sticker_expiry,
        });
        created.push({ user_id: pl.user_id, type: 'city_sticker', token: consent.consent_token, total_cents: govCents + fee });
      }
    }

    // Plate sticker per-plate
    if (inWindow(pl.license_plate_expiry)) {
      if (!pl.il_pin_encrypted || !pl.il_registration_id_encrypted) {
        skipped.push({ user_id: pl.user_id, reason: `plate ${pl.id}: no IL creds on plate row` });
      } else if (pl.il_credentials_invalid_at) {
        skipped.push({ user_id: pl.user_id, reason: `plate ${pl.id}: IL creds marked invalid` });
      } else if (await hasRecentConsent(pl.user_id, 'license_plate', pl.id)) {
        skipped.push({ user_id: pl.user_id, reason: `plate ${pl.id}: plate recent consent` });
      } else {
        const govCents = estimatePlateStickerCents(pl.license_plate_renewal_cost, pl.license_plate_type);
        const consent = await createConsentRequest({
          userId: pl.user_id,
          renewalType: 'license_plate',
          licensePlate: pl.plate,
          licenseState: pl.state || 'IL',
          govAmountCents: govCents,
          serviceFeeCents: fee,
          expiresInDays: 21,
        });
        await (supabaseAdmin as any)
          .from('renewal_purchase_consents')
          .update({ plate_id: pl.id, updated_at: new Date().toISOString() })
          .eq('id', consent.id);
        await sendAuthorizeEmail({
          email: parent.email,
          firstName: parent.first_name,
          type: 'license_plate',
          plate: pl.plate,
          totalCents: govCents + fee,
          token: consent.consent_token,
          expiryDate: pl.license_plate_expiry,
        });
        created.push({ user_id: pl.user_id, type: 'license_plate', token: consent.consent_token, total_cents: govCents + fee });
      }
    }
  }

  return res.status(200).json({
    ok: true,
    eligible_users_seen: rows?.length || 0,
    monitored_plates_seen: plates?.length || 0,
    created: created.length,
    skipped: skipped.length,
    created_detail: created,
    skipped_detail: skipped,
  });
}
