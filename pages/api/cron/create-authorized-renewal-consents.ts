// Daily cron — for users who have toggled auto-renewal ON in /settings:
// (1) On the first day we see an upcoming sticker expiry, create an
//     auto-granted consent row (so the orchestration cron picks it up later)
//     and email a "we're renewing on <date>, $X — click here to skip if you'd
//     rather not" notice.
// (2) On subsequent days, when the expiry crosses additional reminder
//     milestones (14, 3 days out), email the same notice again, idempotently
//     tracked via renewal_purchase_consents.reminders_sent.
//
// Per-sticker eligibility:
//   city_sticker:
//     - auto_renewal_authorized = TRUE
//     - auto_renewal_city_sticker = TRUE
//     - license_plate + vin + last_name on file
//     - city_sticker_expiry in [today, today+30]
//   license_plate:
//     - auto_renewal_authorized = TRUE
//     - auto_renewal_license_plate = TRUE
//     - il_pin_encrypted + il_registration_id_encrypted set
//     - il_credentials_invalid_at IS NULL
//     - license_plate_expiry in [today, today+30]
//     - emissions_completed = TRUE OR emissions_date IS NULL
//
// Lookback / dedupe: a consent row created in the last 90 days for the same
// (user, plate, renewal_type) is reused — we never create a second one for
// the same renewal year. Reminders never re-fire for the same milestone.

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin as typedSupabase } from '../../../lib/supabase';
import { createConsentRequest } from '../../../lib/renewal-consent';
import { isAutoRenewalGloballyEnabled } from '../../../lib/auto-renewal-gate';
import { estimateCityStickerCents, estimatePlateStickerCents } from '../../../lib/sticker-fees';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseAdmin = typedSupabase as any;
const ADMIN_EMAIL = 'randyvollrath@gmail.com';

// Reminder milestones — days before expiry to email "we're renewing your
// sticker on <date>" notices. Cron runs daily; once a milestone fires for a
// given consent we mark it in reminders_sent so we never resend.
const REMINDER_MILESTONES = [30, 14, 3] as const;
type ReminderMilestone = (typeof REMINDER_MILESTONES)[number];

const CREATE_WINDOW_DAYS = 30;
const DEDUPE_LOOKBACK_DAYS = 90;

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

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const expires = new Date(dateStr);
  if (Number.isNaN(expires.getTime())) return null;
  // Compare at UTC-midnight to match the YYYY-MM-DD expiry columns.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.floor((expires.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function pickFiringMilestones(daysOut: number, alreadySent: number[]): ReminderMilestone[] {
  // A milestone "fires" once daysOut crosses below it. e.g. at daysOut=12
  // both 30 and 14 should already have fired. The reminders_sent array
  // prevents re-firing the same milestone, so this stays idempotent across
  // daily cron runs.
  const sent = new Set(alreadySent);
  return REMINDER_MILESTONES.filter((m) => daysOut <= m && !sent.has(m));
}

async function findRecentConsent(
  userId: string,
  type: 'city_sticker' | 'license_plate',
  plateId: string | null,
): Promise<{ id: string; consent_token: string; reminders_sent: number[]; status: string } | null> {
  const since = new Date(Date.now() - DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let q = supabaseAdmin
    .from('renewal_purchase_consents')
    .select('id, consent_token, reminders_sent, status, created_at')
    .eq('user_id', userId)
    .eq('renewal_type', type)
    .in('status', ['pending', 'granted', 'consumed'])
    .gt('created_at', since)
    .order('created_at', { ascending: false });
  q = plateId ? q.eq('plate_id', plateId) : q.is('plate_id', null);
  const { data } = await q.limit(1);
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as any;
  return {
    id: row.id,
    consent_token: row.consent_token,
    reminders_sent: Array.isArray(row.reminders_sent) ? row.reminders_sent : [],
    status: row.status,
  };
}

async function markRemindersSent(consentId: string, milestones: ReminderMilestone[], existing: number[]): Promise<void> {
  const merged = Array.from(new Set([...existing, ...milestones])).sort((a, b) => b - a);
  await supabaseAdmin
    .from('renewal_purchase_consents')
    .update({ reminders_sent: merged, updated_at: new Date().toISOString() })
    .eq('id', consentId);
}

async function sendRenewalNotice(params: {
  email: string;
  firstName: string | null;
  type: 'city_sticker' | 'license_plate';
  plate: string | null;
  totalCents: number;
  token: string;
  expiryDate: string | null;
  daysOut: number;
  isFirstNotice: boolean;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const url = `${siteBaseUrl()}/renewal/authorize/${params.token}`;
  const label = params.type === 'city_sticker' ? 'Chicago city sticker' : 'Illinois plate sticker';
  const greet = params.firstName ? `Hi ${params.firstName},` : 'Hi,';
  const dollars = `$${(params.totalCents / 100).toFixed(2)}`;
  const expiryLabel = params.expiryDate ? new Date(params.expiryDate).toLocaleDateString() : 'soon';
  const daysPhrase =
    params.daysOut <= 3
      ? `in ${params.daysOut} day${params.daysOut === 1 ? '' : 's'}`
      : `around ${expiryLabel}`;

  const lines = params.isFirstNotice
    ? [
        greet,
        '',
        `Heads up: your ${label} is up for renewal ${daysPhrase}. Because you've turned on auto-renewal in your Autopilot settings, we'll charge ${dollars} to your card on file and submit the renewal for you. You don't need to do anything.`,
        '',
        `Want to skip this year and renew yourself? ${url}`,
        '',
        `Plate: ${params.plate || '(on file)'}`,
        `Expires: ${expiryLabel}`,
        '',
        `We'll send two more reminders (14 days and 3 days before the charge) so you have plenty of time to skip if you change your mind.`,
        '',
        `— Autopilot America`,
      ]
    : [
        greet,
        '',
        `Reminder: we're renewing your ${label} ${daysPhrase} and charging ${dollars} to your card on file. Nothing for you to do unless you'd rather handle it yourself.`,
        '',
        `Skip this year: ${url}`,
        '',
        `Plate: ${params.plate || '(on file)'}`,
        `Expires: ${expiryLabel}`,
        '',
        `— Autopilot America`,
      ];

  const subject = params.isFirstNotice
    ? `We're renewing your ${label} on ${expiryLabel}`
    : `Reminder: we're renewing your ${label} ${daysPhrase}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Autopilot America <renewals@autopilotamerica.com>',
      to: [params.email],
      bcc: [ADMIN_EMAIL],
      subject,
      text: lines.join('\n'),
    }),
  }).catch((e) => console.error('[create-authorized-renewal-consents] resend error', e));
}

interface ProcessOneInput {
  userId: string;
  email: string;
  firstName: string | null;
  renewalType: 'city_sticker' | 'license_plate';
  plate: string | null;
  plateState: string | null;
  plateId: string | null;
  expiry: string | null;
  govCents: number;
  fee: number;
}

interface ProcessOneResult {
  status: 'sent' | 'created' | 'skipped';
  reason?: string;
  consent_id?: string;
  milestones?: number[];
}

async function processOne(input: ProcessOneInput): Promise<ProcessOneResult> {
  const daysOut = daysUntil(input.expiry);
  if (daysOut === null) return { status: 'skipped', reason: 'no expiry' };
  if (daysOut > CREATE_WINDOW_DAYS) return { status: 'skipped', reason: `expires in ${daysOut}d (>${CREATE_WINDOW_DAYS})` };
  if (daysOut < 0) return { status: 'skipped', reason: `already expired ${-daysOut}d ago` };

  // Reuse a recent consent if one exists; otherwise create one auto-granted.
  let consent = await findRecentConsent(input.userId, input.renewalType, input.plateId);

  if (!consent) {
    const created = await createConsentRequest({
      userId: input.userId,
      renewalType: input.renewalType,
      licensePlate: input.plate,
      licenseState: input.plateState || 'IL',
      govAmountCents: input.govCents,
      serviceFeeCents: input.fee,
      expiresInDays: 60,
      autoGrant: true,
    });
    if (input.plateId) {
      await supabaseAdmin
        .from('renewal_purchase_consents')
        .update({ plate_id: input.plateId, updated_at: new Date().toISOString() })
        .eq('id', created.id);
    }
    consent = { id: created.id, consent_token: created.consent_token, reminders_sent: [], status: created.status };
  }

  if (consent.status !== 'granted') {
    // User declined or it was consumed/failed already. Nothing to remind about.
    return { status: 'skipped', reason: `consent status=${consent.status}`, consent_id: consent.id };
  }

  const firing = pickFiringMilestones(daysOut, consent.reminders_sent);
  if (firing.length === 0) {
    return { status: 'skipped', reason: 'no new milestone', consent_id: consent.id };
  }

  // Send one email covering the most urgent firing milestone. If we caught
  // up multiple milestones in a single cron run (e.g. daysOut=2 with nothing
  // sent yet), we mark all of them as fired but only send the latest copy —
  // sending three back-to-back emails is spammy.
  const isFirstNotice = consent.reminders_sent.length === 0;
  await sendRenewalNotice({
    email: input.email,
    firstName: input.firstName,
    type: input.renewalType,
    plate: input.plate,
    totalCents: input.govCents + input.fee,
    token: consent.consent_token,
    expiryDate: input.expiry,
    daysOut,
    isFirstNotice,
  });

  await markRemindersSent(consent.id, firing, consent.reminders_sent);

  return { status: 'sent', consent_id: consent.id, milestones: firing as unknown as number[] };
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
  auto_renewal_city_sticker: boolean | null;
  auto_renewal_license_plate: boolean | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!isAutoRenewalGloballyEnabled()) {
    return res.status(200).json({ skipped: true, reason: 'AUTO_RENEWAL_GLOBALLY_ENABLED not true' });
  }

  const { data: rows, error } = await supabaseAdmin
    .from('user_profiles')
    .select(
      'user_id, email, first_name, last_name, license_plate, license_state, vin, ' +
        'city_sticker_expiry, license_plate_expiry, license_plate_type, license_plate_renewal_cost, ' +
        'il_pin_encrypted, il_registration_id_encrypted, il_credentials_invalid_at, ' +
        'emissions_completed, emissions_date, auto_renewal_city_sticker, auto_renewal_license_plate',
    )
    .eq('auto_renewal_authorized', true);

  if (error) return res.status(500).json({ error: sanitizeErrorMessage(error) });

  const fee = serviceFeeCents();
  const sent: Array<{ user_id: string; type: string; milestones: number[]; consent_id: string }> = [];
  const created: Array<{ user_id: string; type: string; consent_id: string }> = [];
  const skipped: Array<{ user_id: string; type: string; reason: string }> = [];

  function record(type: string, userId: string, result: ProcessOneResult) {
    if (result.status === 'sent' && result.consent_id) {
      sent.push({ user_id: userId, type, milestones: result.milestones ?? [], consent_id: result.consent_id });
    } else if (result.status === 'created' && result.consent_id) {
      created.push({ user_id: userId, type, consent_id: result.consent_id });
    } else if (result.status === 'skipped') {
      skipped.push({ user_id: userId, type, reason: result.reason || 'unknown' });
    }
  }

  for (const row of (rows as CandidateRow[]) ?? []) {
    if (!row.email) {
      skipped.push({ user_id: row.user_id, type: 'all', reason: 'no email' });
      continue;
    }

    if (row.auto_renewal_city_sticker) {
      if (!row.license_plate || !row.vin || !row.last_name) {
        skipped.push({ user_id: row.user_id, type: 'city_sticker', reason: 'missing plate/vin/last_name' });
      } else {
        const result = await processOne({
          userId: row.user_id,
          email: row.email,
          firstName: row.first_name,
          renewalType: 'city_sticker',
          plate: row.license_plate,
          plateState: row.license_state,
          plateId: null,
          expiry: row.city_sticker_expiry,
          govCents: estimateCityStickerCents(row.license_plate_type),
          fee,
        });
        record('city_sticker', row.user_id, result);
      }
    }

    if (row.auto_renewal_license_plate) {
      const emissionsBlocks = row.emissions_date && !row.emissions_completed;
      if (!row.il_pin_encrypted || !row.il_registration_id_encrypted) {
        skipped.push({ user_id: row.user_id, type: 'license_plate', reason: 'no IL creds' });
      } else if (row.il_credentials_invalid_at) {
        skipped.push({ user_id: row.user_id, type: 'license_plate', reason: 'IL creds invalid' });
      } else if (emissionsBlocks) {
        skipped.push({ user_id: row.user_id, type: 'license_plate', reason: 'emissions not completed' });
      } else {
        const result = await processOne({
          userId: row.user_id,
          email: row.email,
          firstName: row.first_name,
          renewalType: 'license_plate',
          plate: row.license_plate,
          plateState: row.license_state,
          plateId: null,
          expiry: row.license_plate_expiry,
          govCents: estimatePlateStickerCents(row.license_plate_renewal_cost, row.license_plate_type),
          fee,
        });
        record('license_plate', row.user_id, result);
      }
    }
  }

  // Second pass — monitored_plates rows (multi-vehicle users). Each plate
  // has its own credentials + expiries; reuse the same per-sticker toggles
  // on the parent user_profiles row.
  const userMap = new Map<string, CandidateRow>();
  for (const r of (rows as CandidateRow[]) ?? []) userMap.set(r.user_id, r);

  const { data: plates } = await supabaseAdmin
    .from('monitored_plates')
    .select(
      'id, user_id, plate, state, vin, last_name, city_sticker_expiry, license_plate_expiry, ' +
        'license_plate_type, license_plate_renewal_cost, il_pin_encrypted, il_registration_id_encrypted, il_credentials_invalid_at',
    )
    .eq('status', 'active')
    .or('city_sticker_expiry.not.is.null,license_plate_expiry.not.is.null');

  for (const pl of (plates as any[]) ?? []) {
    const parent = userMap.get(pl.user_id);
    if (!parent || !parent.email) continue;

    if (parent.auto_renewal_city_sticker) {
      if (!pl.plate || !pl.vin || !pl.last_name) {
        skipped.push({ user_id: pl.user_id, type: 'city_sticker', reason: `plate ${pl.id}: missing plate/vin/last_name` });
      } else {
        const result = await processOne({
          userId: pl.user_id,
          email: parent.email,
          firstName: parent.first_name,
          renewalType: 'city_sticker',
          plate: pl.plate,
          plateState: pl.state,
          plateId: pl.id,
          expiry: pl.city_sticker_expiry,
          govCents: estimateCityStickerCents(pl.license_plate_type),
          fee,
        });
        record('city_sticker', pl.user_id, result);
      }
    }

    if (parent.auto_renewal_license_plate) {
      if (!pl.il_pin_encrypted || !pl.il_registration_id_encrypted) {
        skipped.push({ user_id: pl.user_id, type: 'license_plate', reason: `plate ${pl.id}: no IL creds` });
      } else if (pl.il_credentials_invalid_at) {
        skipped.push({ user_id: pl.user_id, type: 'license_plate', reason: `plate ${pl.id}: IL creds invalid` });
      } else {
        const result = await processOne({
          userId: pl.user_id,
          email: parent.email,
          firstName: parent.first_name,
          renewalType: 'license_plate',
          plate: pl.plate,
          plateState: pl.state,
          plateId: pl.id,
          expiry: pl.license_plate_expiry,
          govCents: estimatePlateStickerCents(pl.license_plate_renewal_cost, pl.license_plate_type),
          fee,
        });
        record('license_plate', pl.user_id, result);
      }
    }
  }

  return res.status(200).json({
    ok: true,
    eligible_users_seen: rows?.length || 0,
    monitored_plates_seen: plates?.length || 0,
    sent: sent.length,
    created: created.length,
    skipped: skipped.length,
    sent_detail: sent,
    skipped_detail: skipped,
  });
}
