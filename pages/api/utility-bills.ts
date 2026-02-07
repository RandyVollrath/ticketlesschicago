/**
 * Process Forwarded Utility Bills for Proof of Residency (Resend Inbound)
 *
 * Receives forwarded emails from Resend Inbound webhook.
 * Extracts utility bill PDF attachment and stores in Supabase.
 *
 * Webhook URL: https://ticketlesschicago.com/api/email/process-residency-proof-resend
 * Email format: {user_uuid}@bills.autopilotamerica.com
 *
 * Privacy: Only keeps most recent bill, deletes previous bills immediately.
 *
 * Configure in Resend Dashboard:
 * - Event: email.received
 * - Endpoint: https://ticketlesschicago.com/api/email/process-residency-proof-resend
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { sanitizeErrorMessage } from '../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UTILITY_BUCKET_NAME = 'residency-proofs-temps';
const REGISTRATION_BUCKET_NAME = 'registration-evidence';
const CITY_STICKER_SENDER = 'chicagovehiclestickers@sebis.com';
const LICENSE_PLATE_SENDER = 'ecommerce@ilsos.gov';

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

function parseReceiptMetadata(subject: string, text?: string | null) {
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

  return {
    parsedOrderId: orderMatch?.[1] ?? null,
    parsedAmountCents: amountMatch?.[1] ? Math.round(parseFloat(amountMatch[1]) * 100) : null,
    parsedPurchaseDate,
  };
}

function parseRecipient(toAddress: string): { userId: string; inboxType: InboundInboxType } | null {
  const match = toAddress.match(
    /([a-f0-9\-]+)@(?:(bills)\.autopilotamerica\.com|(receipts)\.autopilotamerica\.com|linguistic-louse\.resend\.app)/i
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
      service: 'utility-bills-webhook',
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

    // Extract user UUID from "to" address
    // Format: {uuid}@bills.autopilotamerica.com OR {uuid}@linguistic-louse.resend.app
    const toAddress = email.to[0]; // Primary recipient
    console.log(`🔍 Parsing email address: ${toAddress}`);

    const recipient = parseRecipient(toAddress);
    if (!recipient) {
      console.error('❌ Invalid email format:', toAddress);
      console.error('Expected format: {uuid}@bills.autopilotamerica.com, {uuid}@receipts.autopilotamerica.com, or {uuid}@linguistic-louse.resend.app');
      return res.status(400).json({ error: 'Invalid email format', toAddress });
    }

    const userId = recipient.userId;

    console.log(`📨 Received utility bill email for user ${userId}`);
    console.log(`  - From: ${email.from}`);
    console.log(`  - Subject: ${email.subject}`);
    console.log(`  - Attachments: ${email.attachments?.length || 0}`);

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
    const evidenceSource = detectEvidenceSource(senderEmail);
    const isRegistrationEvidenceReceipt = evidenceSource != null;
    const targetBucket = isRegistrationEvidenceReceipt ? REGISTRATION_BUCKET_NAME : UTILITY_BUCKET_NAME;

    if (recipient.inboxType === 'registration' && !isRegistrationEvidenceReceipt) {
      return res.status(400).json({
        error: 'Registration inbox only accepts registration receipts from supported senders',
        sender: senderEmail,
      });
    }

    console.log(`✅ Found user profile:`, {
      has_contesting: profile.has_contesting,
      has_permit_zone: profile.has_permit_zone,
      email_forwarding_address: profile.email_forwarding_address,
      evidence_source: evidenceSource,
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
      const parsed = parseReceiptMetadata(email.subject || '', email.text || null);
      let screenshotPath: string | null = null;
      try {
        const ts = today.getTime();
        screenshotPath = `snapshots/${evidenceSource}/${userId}/${dateFolder}/${ts}-email-evidence.png`;
        const screenshotBuffer = await generateEmailEvidenceScreenshot({
          sourceType: evidenceSource,
          sender: email.from || '',
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
          sender_email: email.from,
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
    console.error('Error processing utility bill:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
    });
  }
}
// Deploy with full processing logic - no test returns
