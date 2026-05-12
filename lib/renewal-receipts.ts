// Capture + deliver renewal purchase receipts.
//
// After a successful automation run:
//   - Upload the confirmation screenshot to the renewal-receipts bucket
//   - Email the user the confirmation number + screenshot link
//   - Email a copy of the screenshot to admin for audit/sample

import * as fs from 'fs';
import * as path from 'path';
import { supabaseAdmin } from './supabase';
import type { ConsentRecord } from './renewal-consent';

const BUCKET = 'renewal-receipts';
const ADMIN_EMAIL = 'randyvollrath@gmail.com';

const TYPE_LABEL: Record<string, string> = {
  city_sticker: 'Chicago city vehicle sticker',
  license_plate: 'Illinois license plate sticker',
};

export interface UploadResult {
  storagePath: string;
  signedUrl: string | null;
}

export async function uploadRenewalScreenshot(
  consent: ConsentRecord,
  localPath: string,
): Promise<UploadResult> {
  const buf = fs.readFileSync(localPath);
  const ext = path.extname(localPath) || '.png';
  const storagePath = `${consent.user_id}/${consent.renewal_type}/${consent.id}${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`upload renewal screenshot: ${error.message}`);

  const { data, error: signErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 30); // 30 days
  if (signErr) {
    return { storagePath, signedUrl: null };
  }
  return { storagePath, signedUrl: data?.signedUrl ?? null };
}

export interface SendReceiptInput {
  consent: ConsentRecord;
  userEmail: string;
  confirmationNumber?: string | null;
  receiptUrl?: string | null;
  amountChargedCents: number;
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function sendUserRenewalReceiptEmail(input: SendReceiptInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[renewal-receipts] RESEND_API_KEY missing; user receipt skipped');
    return;
  }
  const label = TYPE_LABEL[input.consent.renewal_type] || 'renewal';
  const lines = [
    `Hi —`,
    ``,
    `We've completed the renewal of your ${label} on your behalf.`,
    ``,
    `Plate: ${input.consent.license_plate || '(on file)'} (${input.consent.license_state || 'IL'})`,
    `Amount charged: ${dollars(input.amountChargedCents)}`,
    input.confirmationNumber ? `Confirmation #: ${input.confirmationNumber}` : '',
    ``,
    input.receiptUrl ? `Confirmation page: ${input.receiptUrl}` : '',
    ``,
    `The new sticker will arrive by US mail at the address on file with the city/state.`,
    ``,
    `— Autopilot America`,
  ].filter(Boolean);

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Autopilot America <renewals@autopilotamerica.com>',
        to: [input.userEmail],
        subject: `${label} renewed — confirmation`,
        text: lines.join('\n'),
      }),
    });
    if (!r.ok) console.error('[renewal-receipts] user email Resend error', r.status, await r.text());
  } catch (e) {
    console.error('[renewal-receipts] user email failed', e);
  }
}

export async function sendUserRenewalFailedEmail(input: {
  consent: ConsentRecord;
  userEmail: string;
  reason: 'invalid_credentials' | 'card_declined' | 'site_changed' | 'circuit_breaker' | 'other';
  detail?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const label = TYPE_LABEL[input.consent.renewal_type] || 'renewal';
  const reasonLines: Record<typeof input.reason, string[]> = {
    invalid_credentials: [
      `The state rejected your saved Registration ID + PIN — usually this means your plate was replaced and a new card with a new PIN was mailed to you.`,
      ``,
      `Please open your latest registration card or renewal notice and update your PIN in your settings:`,
      `${siteBaseUrl()}/settings`,
      ``,
      `Until then, please renew yourself at https://www.ilsos.gov/departments/vehicles/onlinerenewals.html`,
    ],
    card_declined: [
      `Your card on file declined when we tried to charge ${dollars(input.consent.total_amount_cents)} for the ${label}.`,
      ``,
      `Please update your payment method in your account and we'll try again next cycle:`,
      `${siteBaseUrl()}/settings`,
      ``,
      `Or renew yourself if you'd rather: https://${input.consent.renewal_type === 'city_sticker' ? 'ezbuy.chicityclerk.com/vehicle-stickers' : 'www.ilsos.gov/departments/vehicles/onlinerenewals.html'}`,
    ],
    site_changed: [
      `The renewal website changed unexpectedly and our automation couldn't complete the purchase. We're investigating.`,
      ``,
      `For now please renew yourself at https://${input.consent.renewal_type === 'city_sticker' ? 'ezbuy.chicityclerk.com/vehicle-stickers' : 'www.ilsos.gov/departments/vehicles/onlinerenewals.html'}`,
      ``,
      `We weren't charged so neither were you.`,
    ],
    circuit_breaker: [
      `Our auto-renewal automation is temporarily paused while we investigate a few recent failures. We'll retry your renewal once we've reopened it.`,
      ``,
      `If you'd rather not wait, you can renew yourself: ${input.consent.renewal_type === 'city_sticker' ? 'https://ezbuy.chicityclerk.com/vehicle-stickers' : 'https://www.ilsos.gov/departments/vehicles/onlinerenewals.html'}`,
    ],
    other: [
      `We weren't able to complete your ${label} renewal automatically. We'll keep an eye on it; if you'd rather renew yourself, here's the official site:`,
      `${input.consent.renewal_type === 'city_sticker' ? 'https://ezbuy.chicityclerk.com/vehicle-stickers' : 'https://www.ilsos.gov/departments/vehicles/onlinerenewals.html'}`,
    ],
  };
  const lines = [
    `Hi —`,
    ``,
    ...reasonLines[input.reason],
    ``,
    input.detail ? `(Details for support: ${input.detail.slice(0, 200)})` : '',
    ``,
    `— Autopilot America`,
  ].filter(Boolean);

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Autopilot America <renewals@autopilotamerica.com>',
        to: [input.userEmail],
        subject: `${label} renewal — needs your attention`,
        text: lines.join('\n'),
      }),
    });
  } catch (e) {
    console.error('[renewal-receipts] user failure email failed', e);
  }
}

function siteBaseUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://www.autopilotamerica.com';
}

export async function sendAdminRenewalNotice(input: SendReceiptInput & { success: boolean; error?: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const label = TYPE_LABEL[input.consent.renewal_type] || 'renewal';
  const subject = input.success
    ? `[Auto-renew] ${label} succeeded`
    : `[Auto-renew] ${label} FAILED`;
  const body = [
    `${subject}`,
    ``,
    `User: ${input.userEmail}`,
    `Plate: ${input.consent.license_plate || '(none)'} (${input.consent.license_state || 'IL'})`,
    `Amount: ${dollars(input.amountChargedCents)}`,
    input.confirmationNumber ? `Confirmation #: ${input.confirmationNumber}` : '',
    input.receiptUrl ? `Receipt: ${input.receiptUrl}` : '',
    input.error ? `Error: ${input.error}` : '',
    `Consent id: ${input.consent.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [ADMIN_EMAIL],
        subject,
        text: body,
      }),
    });
  } catch (e) {
    console.error('[renewal-receipts] admin notice failed', e);
  }
}
