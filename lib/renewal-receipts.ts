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
