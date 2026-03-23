/**
 * Receipt Forwarding Webhook (Resend Inbound)
 *
 * Processes forwarded registration receipts (city sticker, license plate)
 * and utility bill PDFs for proof of residency.
 *
 * Shared forwarding address: receipts@autopilotamerica.com
 * User is identified by matching the sender email against user_profiles.
 *
 * Configure in Resend Dashboard:
 * - Event: email.received
 * - Endpoint: https://www.autopilotamerica.com/api/webhooks/receipt-forwarding
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { verifyWebhook } from '../../../lib/webhook-verification';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UTILITY_BUCKET_NAME = 'residency-proofs-temps';
const REGISTRATION_BUCKET_NAME = 'registration-evidence';
const CITY_STICKER_SENDER = 'chicagovehiclestickers@sebis.com';
const LICENSE_PLATE_SENDER = 'ecommerce@ilsos.gov';

function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedHosts = ['api.resend.com', 'attachments.resend.dev'];
    return parsed.protocol === 'https:' && allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

type EvidenceSourceType = 'city_sticker' | 'license_plate';
type InboundInboxType = 'utility' | 'registration' | 'legacy';

interface ResendInboundPayload {
  type: 'email.received';
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    reply_to?: string;
    attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
      content_disposition?: string;
      content_id?: string;
    }>;
  };
}

function detectEvidenceSource(senderEmail: string): EvidenceSourceType | null {
  if (senderEmail.includes(CITY_STICKER_SENDER)) return 'city_sticker';
  if (senderEmail.includes(LICENSE_PLATE_SENDER)) return 'license_plate';
  return null;
}

/**
 * When a user forwards a receipt, the `from` header is the user's own email,
 * not the original sender. Gmail/Outlook/Apple Mail include the original sender
 * in the forwarded message body. This function searches the email text and HTML
 * for known sender addresses in forwarded-message patterns.
 *
 * Patterns matched:
 *   - Gmail:   "---------- Forwarded message ----------\nFrom: Name <sender@example.com>"
 *   - Outlook: "From: Name <sender@example.com>"
 *   - Apple:   "Begin forwarded message:\n\nFrom: sender@example.com"
 *   - Generic: any occurrence of the known sender email address in the body
 */
function detectEvidenceSourceFromBody(text?: string | null, html?: string | null): EvidenceSourceType | null {
  const haystack = `${text || ''}\n${html || ''}`.toLowerCase();

  if (haystack.includes(CITY_STICKER_SENDER)) return 'city_sticker';
  if (haystack.includes(LICENSE_PLATE_SENDER)) return 'license_plate';
  return null;
}

function parseReceiptMetadata(subject: string, text?: string | null, sourceType?: EvidenceSourceType | null) {
  const haystack = `${subject || ''}\n${text || ''}`;
  const orderMatch = haystack.match(/\b(?:order|confirmation|transaction)\s*(?:#|number|no\.?)?\s*[:\-]?\s*([A-Z0-9\-]{5,})\b/i);
  const amountMatch = haystack.match(/\$\s*([0-9]+(?:\.[0-9]{2})?)/);
  const dateMatch = haystack.match(/\b(20[0-9]{2}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/20[0-9]{2})\b/);

  let parsedPurchaseDate: string | null = null;
  if (dateMatch?.[1]) {
    const parsed = new Date(dateMatch[1]);
    if (!Number.isNaN(parsed.getTime())) {
      parsedPurchaseDate = parsed.toISOString().slice(0, 10);
    }
  }

  // Extract sticker duration from email content.
  // Chicago city stickers come in 4-month, 12-month (1-year), and 24-month (2-year) terms.
  // IL plate stickers are always 12 months (annual).
  let stickerDurationMonths: number | null = null;
  if (sourceType === 'license_plate') {
    // IL plate stickers are always annual
    stickerDurationMonths = 12;
  } else if (sourceType === 'city_sticker') {
    const lowerHaystack = haystack.toLowerCase();
    // Check for explicit duration mentions in the receipt email
    if (/\b(?:2[\s-]?year|24[\s-]?month|two[\s-]?year)\b/.test(lowerHaystack)) {
      stickerDurationMonths = 24;
    } else if (/\b(?:4[\s-]?month|four[\s-]?month|reduced[\s-]?term)\b/.test(lowerHaystack)) {
      stickerDurationMonths = 4;
    } else {
      // Default: 12 months (most common). The raw email_text and email_html
      // are stored so we can re-parse if the regex needs refinement later.
      stickerDurationMonths = 12;
    }
  }

  // Compute expiration date from purchase date + duration.
  // City stickers expire on the last day of the expiration month.
  let parsedExpirationDate: string | null = null;
  if (parsedPurchaseDate && stickerDurationMonths) {
    const d = new Date(parsedPurchaseDate);
    // Move forward by duration months, then get last day of that month.
    // e.g. purchased 2025-07-15 + 12 months → last day of July 2026 → 2026-07-31
    d.setMonth(d.getMonth() + stickerDurationMonths + 1, 0);
    parsedExpirationDate = d.toISOString().slice(0, 10);
  }

  return {
    parsedOrderId: orderMatch?.[1] ?? null,
    parsedAmountCents: amountMatch?.[1] ? Math.round(parseFloat(amountMatch[1]) * 100) : null,
    parsedPurchaseDate,
    stickerDurationMonths,
    parsedExpirationDate,
  };
}

function parseRecipient(toAddress: string): { userId: string | null; inboxType: InboundInboxType } | null {
  // Shared forwarding address: receipts@autopilotamerica.com (user identified by sender email)
  if (/^receipts@autopilotamerica\.com$/i.test(toAddress)) {
    return { userId: null, inboxType: 'registration' };
  }

  // Per-user UUID addresses (legacy and subdomain formats)
  const match = toAddress.match(
    /([a-f0-9\-]+)@(?:(bills)\.autopilotamerica\.com|(receipts)\.autopilotamerica\.com|autopilotamerica\.com|linguistic-louse\.resend\.app)/i
  );
  if (!match) return null;

  const userId = match[1];
  const inboxType: InboundInboxType = match[2]
    ? 'utility'
    : match[3]
      ? 'registration'
      : 'legacy';
  return { userId, inboxType };
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, width = 86, maxLines = 14): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= width) {
      current = (current + ' ' + word).trim();
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

async function generateEmailEvidenceScreenshot(params: {
  sourceType: EvidenceSourceType;
  sender: string;
  subject: string;
  body: string;
  forwardedAtIso: string;
  orderId: string | null;
  amountCents: number | null;
}): Promise<Buffer> {
  const excerptLines = wrapLines(params.body || '(no email body provided)');
  const amount = params.amountCents != null ? `$${(params.amountCents / 100).toFixed(2)}` : 'Unknown';
  const sourceLabel = params.sourceType === 'city_sticker' ? 'City Sticker Receipt' : 'License Plate Receipt';
  const orderLabel = params.orderId || 'Unknown';
  const forwardedAt = new Date(params.forwardedAtIso).toLocaleString('en-US');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1400" height="900" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect x="40" y="40" width="1320" height="820" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
  <text x="80" y="120" font-size="40" font-family="Arial, sans-serif" font-weight="700" fill="#0f172a">${escapeXml(sourceLabel)} Evidence Snapshot</text>
  <text x="80" y="172" font-size="24" font-family="Arial, sans-serif" fill="#334155">Sender: ${escapeXml(params.sender || 'Unknown')}</text>
  <text x="80" y="212" font-size="24" font-family="Arial, sans-serif" fill="#334155">Forwarded: ${escapeXml(forwardedAt)}</text>
  <text x="80" y="252" font-size="24" font-family="Arial, sans-serif" fill="#334155">Order ID: ${escapeXml(orderLabel)}</text>
  <text x="80" y="292" font-size="24" font-family="Arial, sans-serif" fill="#334155">Amount: ${escapeXml(amount)}</text>
  <text x="80" y="352" font-size="26" font-family="Arial, sans-serif" font-weight="700" fill="#0f172a">Subject</text>
  <text x="80" y="392" font-size="24" font-family="Arial, sans-serif" fill="#111827">${escapeXml((params.subject || 'No subject').slice(0, 120))}</text>
  <text x="80" y="460" font-size="26" font-family="Arial, sans-serif" font-weight="700" fill="#0f172a">Email Excerpt</text>
  ${excerptLines
    .map((line, idx) => `<text x="80" y="${510 + idx * 32}" font-size="22" font-family="Arial, sans-serif" fill="#1f2937">${escapeXml(line)}</text>`)
    .join('\n')}
  <text x="80" y="838" font-size="18" font-family="Arial, sans-serif" fill="#64748b">Generated automatically by Ticketless Chicago evidence pipeline.</text>
</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

// Disable body parsing to handle raw webhook payload
export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Health check endpoint
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'receipt-forwarding-webhook',
      version: '2.0-full-processing',
      timestamp: new Date().toISOString(),
    });
  }

  // Log the request for debugging
  console.log('🔔 Webhook received:', {
    method: req.method,
    url: req.url,
    body: req.body,
  });

  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Verify Resend webhook signature to prevent forged receipt submissions.
  // Without this, attackers could inject fake city sticker receipts or utility bills.
  if (!verifyWebhook('resend', req)) {
    console.error('⚠️ Receipt forwarding webhook verification failed');
    return res.status(401).json({ error: 'Unauthorized - invalid signature' });
  }

  try {
    const payload: ResendInboundPayload = req.body;

    console.log('📦 Received payload:', JSON.stringify(payload, null, 2));

    // Verify it's an email.received event
    if (payload.type !== 'email.received') {
      console.log('❌ Invalid event type:', payload.type);
      return res.status(400).json({ error: 'Invalid event type' });
    }

    const email = payload.data;
    console.log('✉️ Processing email:', {
      from: email.from,
      to: email.to,
      subject: email.subject,
      attachments: email.attachments?.length || 0,
    });

    console.log('📎 Attachment details:', JSON.stringify(email.attachments, null, 2));

    // Extract user from "to" address
    // Shared address: receipts@autopilotamerica.com (user identified by sender email)
    // Legacy UUID addresses: {uuid}@bills.autopilotamerica.com, {uuid}@autopilotamerica.com, {uuid}@linguistic-louse.resend.app
    const toAddress = email.to[0]; // Primary recipient
    console.log(`🔍 Parsing email address: ${toAddress}`);

    const recipient = parseRecipient(toAddress);
    if (!recipient) {
      console.error('❌ Invalid email format:', toAddress);
      console.error('Expected: receipts@autopilotamerica.com or {uuid}@autopilotamerica.com');
      return res.status(400).json({ error: 'Invalid email format', toAddress });
    }

    // Resolve userId: from address UUID or by looking up sender email
    let userId = recipient.userId;

    if (!userId) {
      // Shared address — look up user by sender email
      const senderLookupEmail = (email.from || '').toLowerCase();
      console.log(`🔍 Shared address — looking up user by sender: ${senderLookupEmail}`);

      // Also search the forwarded email body for the original sender (e.g. chicagovehiclestickers@sebis.com)
      const emailBody = email.text || email.html || '';
      const possibleEmails = [senderLookupEmail];

      // Try user_profiles table first (no pagination issues)
      let foundUserId: string | null = null;
      for (const lookupEmail of possibleEmails) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('user_id')
          .ilike('email', lookupEmail)
          .limit(1);
        if (profiles?.[0]) {
          foundUserId = profiles[0].user_id;
          console.log(`✅ Matched user via user_profiles: ${lookupEmail} → ${foundUserId}`);
          break;
        }
      }

      // Fallback: paginate through auth.users if not found in profiles
      if (!foundUserId) {
        let page = 1;
        const perPage = 100;
        let found = false;
        while (!found) {
          const { data: authPage } = await supabase.auth.admin.listUsers({ page, perPage });
          if (!authPage?.users?.length) break;
          const authUser = authPage.users.find(
            u => u.email?.toLowerCase() === senderLookupEmail
          );
          if (authUser) {
            foundUserId = authUser.id;
            console.log(`✅ Matched user via auth.users page ${page}: ${senderLookupEmail} → ${foundUserId}`);
            found = true;
          }
          if (authPage.users.length < perPage) break;
          page++;
        }
      }

      if (!foundUserId) {
        console.error('❌ No account found for sender email:', senderLookupEmail);
        return res.status(404).json({
          error: 'No account found for sender email',
          sender: senderLookupEmail,
          hint: 'Forward from the email address associated with your Autopilot account',
        });
      }

      userId = foundUserId;
    }

    console.log(`📨 Received receipt forwarding email for user ${userId}`);
    console.log(`  - From: ${email.from}`);
    console.log(`  - Subject: ${email.subject}`);
    console.log(`  - Attachments: ${email.attachments?.length || 0}`);

    // Resend webhook payloads only contain metadata — fetch full email content if body is missing
    if (!email.text && !email.html && email.email_id) {
      console.log(`📥 Fetching full email content from Resend API: ${email.email_id}`);
      try {
        const resendRes = await fetch(
          `https://api.resend.com/emails/receiving/${email.email_id}`,
          { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }
        );
        if (resendRes.ok) {
          const fullEmail = await resendRes.json();
          email.text = fullEmail.text || email.text;
          email.html = fullEmail.html || email.html;
          if (!email.attachments?.length && fullEmail.attachments?.length) {
            email.attachments = fullEmail.attachments;
          }
          console.log(`✅ Fetched email body: text=${!!email.text}, html=${!!email.html}, attachments=${email.attachments?.length || 0}`);
        } else {
          console.warn(`⚠️ Failed to fetch email content: ${resendRes.status} ${resendRes.statusText}`);
        }
      } catch (fetchErr: any) {
        console.warn(`⚠️ Error fetching email content:`, fetchErr?.message);
      }
    }

    // Find user profile
    console.log(`🔍 Looking up user profile for: ${userId}`);
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('user_id, email_forwarding_address, has_contesting, has_permit_zone')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('❌ User not found:', userId, 'Error:', profileError);
      return res.status(404).json({ error: 'User not found', userId });
    }

    const senderEmail = (email.from || '').toLowerCase();
    // First check the from-header (direct send). If no match, check the email
    // body for the original sender — handles forwarded receipts where from is the
    // user's own address but the body contains "From: chicagovehiclestickers@sebis.com".
    const evidenceSource = detectEvidenceSource(senderEmail)
      ?? detectEvidenceSourceFromBody(email.text, email.html);
    const isRegistrationEvidenceReceipt = evidenceSource != null;
    const targetBucket = isRegistrationEvidenceReceipt ? REGISTRATION_BUCKET_NAME : UTILITY_BUCKET_NAME;

    if (recipient.inboxType === 'registration' && !isRegistrationEvidenceReceipt) {
      return res.status(400).json({
        error: 'Registration inbox only accepts registration receipts from supported senders',
        sender: senderEmail,
        hint: 'Forward the original receipt email — the body must contain the original sender address',
      });
    }

    // Determine the original sender for DB storage. If detected from body
    // (forwarded email), use the known sender address instead of the forwarder's email.
    const detectedFromHeader = detectEvidenceSource(senderEmail) != null;
    const originalSender = isRegistrationEvidenceReceipt
      ? (detectedFromHeader
          ? senderEmail
          : evidenceSource === 'city_sticker' ? CITY_STICKER_SENDER : LICENSE_PLATE_SENDER)
      : senderEmail;

    console.log(`✅ Found user profile:`, {
      has_contesting: profile.has_contesting,
      has_permit_zone: profile.has_permit_zone,
      email_forwarding_address: profile.email_forwarding_address,
      evidence_source: evidenceSource,
      detected_from: detectedFromHeader ? 'from-header' : 'email-body (forwarded)',
      original_sender: originalSender,
    });

    // All forwarding workflows require Protection.
    if (!profile.has_contesting) {
      console.error('❌ User does not have protection:', userId);
      return res.status(400).json({ error: 'User does not have protection service', userId });
    }

    // Utility-bill residency proof path requires permit-zone users.
    // City-sticker receipt evidence path does not require permit zone.
    if (!isRegistrationEvidenceReceipt && !profile.has_permit_zone) {
      console.error('❌ User does not have permit zone:', userId);
      return res.status(400).json({ error: 'User does not require proof of residency', userId });
    }

    // Find PDF attachment if present (required for utility-bill residency flow,
    // optional for registration evidence where body text can still prove purchase).
    console.log(`🔍 Searching for PDF attachment...`);
    const pdfAttachment = email.attachments?.find(att =>
      att.content_type === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')
    );

    let pdfBuffer: Buffer | null = null;
    if (pdfAttachment) {
      console.log(`✅ Found PDF attachment: ${pdfAttachment.filename} (${pdfAttachment.content_type})`);
      const attachmentUrl = `https://api.resend.com/emails/receiving/${payload.data.email_id}/attachments/${pdfAttachment.id}`;
      console.log(`📥 Fetching attachment from: ${attachmentUrl}`);

      const attachmentResponse = await fetch(attachmentUrl, {
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        },
      });

      if (!attachmentResponse.ok) {
        console.error('Failed to fetch attachment metadata:', await attachmentResponse.text());
        throw new Error('Failed to fetch attachment from Resend');
      }

      const attachmentData = await attachmentResponse.json();
      console.log(`📎 Got attachment metadata, downloading from: ${attachmentData.download_url}`);

      if (!isAllowedDownloadUrl(attachmentData.download_url)) {
        console.error(`🚨 Blocked download from untrusted URL: ${attachmentData.download_url}`);
        return res.status(400).json({ error: 'Invalid attachment download URL' });
      }

      const downloadResponse = await fetch(attachmentData.download_url);
      if (!downloadResponse.ok) {
        console.error('Failed to download attachment file:', await downloadResponse.text());
        throw new Error('Failed to download attachment file');
      }

      pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());
      console.log(`✅ Downloaded PDF: ${pdfBuffer.length} bytes`);
    } else if (!isRegistrationEvidenceReceipt) {
      console.error('❌ No PDF attachment found');
      console.error('Available attachments:', email.attachments);
      return res.status(400).json({
        error: 'No PDF attachment found in email',
        attachments: email.attachments?.map(a => ({ filename: a.filename, content_type: a.content_type }))
      });
    } else {
      console.log('ℹ️ Registration evidence email has no PDF; storing parsed email content only');
    }

    const today = new Date();
    const dateFolder = today.toISOString().split('T')[0];

    let filePath: string;
    let deletedCount = 0;

    if (isRegistrationEvidenceReceipt) {
      // Keep all city sticker purchase receipts for contest evidence history.
      const ts = today.getTime();
      const sanitizedName = (pdfAttachment?.filename || 'receipt.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = `evidence/${evidenceSource}-receipts/${userId}/${dateFolder}/${ts}-${sanitizedName}`;
    } else {
      // Utility-bill proof flow: keep only latest proof.
      const userFolder = `proof/${userId}`;
      const { data: existingFolders } = await supabase.storage
        .from(UTILITY_BUCKET_NAME)
        .list(userFolder);

      const filesToDelete = existingFolders
        ?.filter(item => item.name.match(/^\d{4}-\d{2}-\d{2}$/))
        .map(folder => `${userFolder}/${folder.name}/bill.pdf`) || [];

      if (filesToDelete.length > 0) {
        console.log(`🗑️  Deleting ${filesToDelete.length} old bills...`);
        await supabase.storage.from(UTILITY_BUCKET_NAME).remove(filesToDelete);
      }
      deletedCount = filesToDelete.length;
      filePath = `${userFolder}/${dateFolder}/bill.pdf`;
    }

    if (pdfBuffer) {
      console.log(`📤 Uploading to: ${targetBucket}/${filePath}`);
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(targetBucket)
        .upload(filePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) {
        console.error('❌ Upload error:', uploadError);
        throw uploadError;
      }
      console.log(`✅ Uploaded new file to: ${filePath}`, uploadData);
    }

    if (isRegistrationEvidenceReceipt) {
      const parsed = parseReceiptMetadata(email.subject || '', email.text || null, evidenceSource);
      let screenshotPath: string | null = null;
      try {
        const ts = today.getTime();
        screenshotPath = `snapshots/${evidenceSource}/${userId}/${dateFolder}/${ts}-email-evidence.png`;
        const screenshotBuffer = await generateEmailEvidenceScreenshot({
          sourceType: evidenceSource,
          sender: originalSender,
          subject: email.subject || '',
          body: email.text || '',
          forwardedAtIso: payload.created_at || new Date().toISOString(),
          orderId: parsed.parsedOrderId,
          amountCents: parsed.parsedAmountCents,
        });
        const { error: screenshotUploadError } = await supabase.storage
          .from(REGISTRATION_BUCKET_NAME)
          .upload(screenshotPath, screenshotBuffer, {
            contentType: 'image/png',
            upsert: true,
          });
        if (screenshotUploadError) {
          console.error('⚠️ Failed to upload evidence screenshot (non-fatal):', screenshotUploadError);
          screenshotPath = null;
        }
      } catch (screenshotError) {
        console.error('⚠️ Failed to generate evidence screenshot (non-fatal):', screenshotError);
        screenshotPath = null;
      }

      const { error: insertError } = await supabase
        .from('registration_evidence_receipts' as any)
        .insert({
          user_id: userId,
          source_type: evidenceSource,
          sender_email: originalSender,
          email_subject: email.subject || null,
          email_text: email.text || null,
          email_html: email.html || null,
          storage_bucket: REGISTRATION_BUCKET_NAME,
          storage_path: pdfBuffer ? filePath : null,
          screenshot_path: screenshotPath,
          file_name: pdfAttachment?.filename || null,
          forwarded_at: payload.created_at || new Date().toISOString(),
          parsed_order_id: parsed.parsedOrderId,
          parsed_amount_cents: parsed.parsedAmountCents,
          parsed_purchase_date: parsed.parsedPurchaseDate,
          sticker_duration_months: parsed.stickerDurationMonths,
          parsed_expiration_date: parsed.parsedExpirationDate,
        });

      if (insertError) {
        console.error('❌ Failed to insert registration evidence metadata:', insertError);
        throw insertError;
      }

      console.log(`🎉 Registration evidence saved for user ${userId}`);
      return res.status(200).json({
        success: true,
        message: `${evidenceSource} receipt saved successfully`,
        userId,
        source: evidenceSource,
        bucket: REGISTRATION_BUCKET_NAME,
        filePath: pdfBuffer ? filePath : null,
        screenshotPath,
      });
    }

    // Utility-bill proof path: update profile pointers
    console.log(`💾 Updating database for user ${userId}...`);
    const { data: updateData, error: updateError } = await supabase
      .from('user_profiles')
      .update({
        residency_proof_path: filePath,
        residency_proof_uploaded_at: new Date().toISOString(),
        residency_proof_verified: false,
        residency_proof_verified_at: null,
      })
      .eq('user_id', userId)
      .select();

    if (updateError) {
      console.error('❌ Database update error:', updateError);
      throw updateError;
    }

    console.log(`✅ Database updated:`, updateData);
    console.log(`📊 Stats: Deleted ${deletedCount} old bills, stored 1 new bill`);
    console.log(`🎉 Utility bill processed successfully for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Utility bill processed successfully',
      userId,
      filePath,
      deletedCount,
    });

  } catch (error: any) {
    console.error('Error processing receipt forwarding:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
    });
  }
}
// Deploy with full processing logic - no test returns
