import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyWebhook, readRawBody } from '../../../lib/webhook-verification';
import { triggerAutopilotMailRun } from '../../../lib/trigger-autopilot-mail';
import type { ContestEvaluation } from '../../../lib/contest-kits/types';
import {
  parseUserEvidence,
  reEvaluateWithKit,
  regenerateLetterWithAI,
  sendApprovalEmailForEvidence,
  analyzeEvidencePhotos,
  extractTicketFieldsFromPhoto,
  extractPoliceReportFromPhoto,
  extractParkChicagoReceiptFromPhoto,
  extractPoliceReportNumberFromText,
} from '../../../lib/evidence-processing';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Evidence Email Webhook
 *
 * This endpoint receives incoming email replies to evidence@autopilotamerica.com
 * when users reply with evidence for their parking ticket contest.
 *
 * It:
 * 1. Matches the email to a pending ticket
 * 2. Stores the user's evidence
 * 3. Regenerates the contest letter with the evidence
 * 4. Updates ticket status
 *
 * Setup Instructions:
 * 1. Go to Resend Dashboard: https://resend.com/settings/webhooks
 * 2. Add a new webhook
 * 3. Set URL to: https://ticketlessamerica.com/api/webhooks/evidence-email
 * 4. Enable "email.received" event
 * 5. Filter to only evidence@autopilotamerica.com domain if possible
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isAllowedAttachmentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow HTTPS from exact Resend domains (no wildcard subdomains)
    const allowedHosts = ['api.resend.com', 'attachments.resend.dev'];
    return parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export const config = {
  api: {
    bodyParser: false, // Must read raw body for Svix signature verification
  },
};

interface UserProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

// Functions regenerateLetterWithAI, parseUserEvidence, reEvaluateWithKit,
// buildKitGuidance, sendApprovalEmailForEvidence, analyzeEvidencePhotos
// are now imported from '../../../lib/evidence-processing'

/**
 * Trigger the letter generation cron to create a letter for a ticket that doesn't have one yet
 */
async function triggerLetterGeneration(reason: string): Promise<{ triggered: boolean; message: string }> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { triggered: false, message: 'CRON_SECRET missing' };
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const url = new URL('/api/cron/autopilot-generate-letters', baseUrl);
  url.searchParams.set('key', cronSecret);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'x-trigger-reason': reason,
      },
    });

    return {
      triggered: response.ok,
      message: response.ok ? 'Triggered letter generation' : `Letter generation trigger failed (${response.status})`,
    };
  } catch (error: any) {
    return { triggered: false, message: `Letter generation trigger error: ${error?.message}` };
  }
}

/**
 * Extract ticket ID from the "to" address using plus addressing
 * e.g., evidence+UUID@autopilotamerica.com -> UUID
 */
function extractTicketIdFromAddress(toEmail: string): string | null {
  if (!toEmail) return null;

  // Match evidence+TICKET_ID@autopilotamerica.com
  const match = toEmail.match(/evidence\+([a-f0-9-]{36})@autopilotamerica\.com/i);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Extract ticket number from email subject or body
 */
function extractTicketNumber(subject: string, body: string): string | null {
  // Common patterns for ticket numbers
  const patterns = [
    /ticket[:\s#-]*(\d{8,})/i,
    /citation[:\s#-]*(\d{8,})/i,
    /violation[:\s#-]*(\d{8,})/i,
    /#(\d{8,})/,
    /(\d{10,})/,  // Chicago tickets are often 10+ digits
  ];

  const combined = `${subject} ${body}`;

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Read raw body for Svix signature verification ──
  const rawBodyBuf = await readRawBody(req);
  const rawBody = rawBodyBuf.toString('utf-8');

  if (rawBodyBuf.length > 25 * 1024 * 1024) {
    return res.status(413).json({ error: 'Request body too large' });
  }

  try {
    req.body = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // SECURITY: Verify webhook signature
  // Support both Resend webhooks (uses RESEND_EVIDENCE_WEBHOOK_SECRET)
  // and Cloudflare Email Workers (uses X-Cloudflare-Email-Worker header)
  const cloudflareHeader = req.headers['x-cloudflare-email-worker'] as string;
  const expectedCloudflareSecret = process.env.CLOUDFLARE_EMAIL_WORKER_SECRET;

  // Accept Cloudflare worker if header matches configured secret.
  // SECURITY: Previously accepted any header containing 'cloudflare' — trivially spoofable.
  // Now requires either a matching secret or falls back to Resend signature verification.
  const isCloudflareWorker = cloudflareHeader && expectedCloudflareSecret
    ? cloudflareHeader === expectedCloudflareSecret
    : false;

  if (!isCloudflareWorker && !verifyWebhook('resend-evidence', req, rawBody)) {
    console.error('Evidence webhook verification failed');
    return res.status(401).json({ error: 'Unauthorized - invalid signature' });
  }

  const source = isCloudflareWorker ? 'cloudflare' : 'resend';

  console.log(`Evidence email webhook called via ${source} (verified)`);

  try {
    const event = req.body;

    // Resend webhook format
    if (event.type !== 'email.received') {
      console.log('Ignoring non-received event:', event.type);
      return res.status(200).json({ message: 'Event ignored' });
    }

    const data = event.data;
    const fromEmail = data.from;
    // Resend sends `to` as an array of strings
    const toEmailRaw = data.to;
    const toEmail = Array.isArray(toEmailRaw) ? toEmailRaw[0] : toEmailRaw;
    const subject = data.subject || '(no subject)';
    const emailId = data.email_id; // Resend email ID for fetching full content
    let textBody = data.text || '';
    let htmlBody = data.html || '';
    let attachments = data.attachments || [];

    console.log(`Evidence email from ${fromEmail}: "${subject}"`);
    console.log(`To (raw): ${JSON.stringify(toEmailRaw)}, parsed: ${toEmail}`);
    console.log(`Attachments: ${attachments.length}, email_id: ${emailId}`);

    // Only process emails sent to evidence@autopilotamerica.com (or evidence+TICKET_ID@)
    // Match both evidence@autopilotamerica.com and evidence+UUID@autopilotamerica.com
    if (!toEmail?.match(/evidence(\+[a-f0-9-]+)?@autopilotamerica\.com/i)) {
      console.log('Email not sent to evidence address, ignoring');
      return res.status(200).json({ message: 'Not an evidence email' });
    }

    // Resend webhook payloads only contain metadata — fetch full email content if body is missing
    if (!textBody && !htmlBody && emailId) {
      console.log(`Fetching full email content from Resend API: ${emailId}`);
      try {
        const resendRes = await fetch(
          `https://api.resend.com/emails/receiving/${emailId}`,
          { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }
        );
        if (resendRes.ok) {
          const fullEmail = await resendRes.json();
          textBody = fullEmail.text || textBody;
          htmlBody = fullEmail.html || htmlBody;
          if (!attachments?.length && fullEmail.attachments?.length) {
            attachments = fullEmail.attachments;
          }
          console.log(`Fetched email body: text=${!!textBody}, html=${!!htmlBody}, attachments=${attachments?.length || 0}`);
        } else {
          console.warn(`Failed to fetch email content: ${resendRes.status} ${resendRes.statusText}`);
        }
      } catch (fetchErr: any) {
        console.warn(`Error fetching email content:`, fetchErr?.message);
      }
    }

    // Find user by email
    // Method 1: Use auth.admin API (most reliable)
    let user: { id: string; email: string | undefined } | null = null;
    try {
      const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const foundUser = (authUsers?.users as any[])?.find((u: any) =>
        u.email?.toLowerCase() === fromEmail.trim().toLowerCase()
      );
      if (foundUser) {
        user = { id: foundUser.id, email: foundUser.email };
      }
    } catch (authErr: any) {
      console.error('auth.admin.listUsers failed:', authErr.message);
    }

    // Method 2: Fallback to RPC function
    if (!user) {
      try {
        const { data: sqlUser } = await supabaseAdmin.rpc('get_user_by_email' as any, {
          user_email: fromEmail.trim().toLowerCase()
        });
        if (sqlUser && (sqlUser as any[]).length > 0) {
          user = (sqlUser as any[])[0];
        }
      } catch (rpcErr: any) {
        console.error('get_user_by_email RPC failed:', rpcErr.message);
      }
    }

    if (!user) {
      console.log(`No user found for email: ${fromEmail}`);
      // Still store the email for manual review
      await supabaseAdmin
        .from('incoming_emails')
        .insert({
          from_email: fromEmail,
          subject: subject,
          body_text: textBody,
          body_html: htmlBody,
          processed: false,
          notification_sent: false,
        });

      // Notify admin
      await sendAdminNotification(fromEmail, subject, textBody, 'Unknown user - needs manual review');

      return res.status(200).json({ message: 'Email stored for manual review' });
    }

    console.log(`Matched user: ${user.email} (${user.id})`);

    // Try to extract ticket ID from the to address (plus addressing)
    // e.g., evidence+UUID@autopilotamerica.com
    const ticketIdFromAddress = extractTicketIdFromAddress(toEmail);
    console.log(`Extracted ticket ID from address: ${ticketIdFromAddress}`);

    // Also try to extract ticket number from subject/body as fallback
    const ticketNumber = extractTicketNumber(subject, textBody);
    console.log(`Extracted ticket number from content: ${ticketNumber}`);

    // Find the ticket - prioritize ticket ID from address, then ticket number, then first pending
    let tickets: any[] | null = null;

    if (ticketIdFromAddress) {
      // Best case: we have the exact ticket ID from plus addressing
      const { data } = await supabaseAdmin
        .from('detected_tickets')
        .select(`
          *,
          contest_letters (
            id,
            letter_content,
            letter_text,
            defense_type,
            status
          )
        `)
        .eq('id', ticketIdFromAddress)
        .eq('user_id', user.id);
      tickets = data;
      console.log(`Found ${tickets?.length || 0} ticket(s) by ID from address`);
    }

    // Fallback: try by ticket number if we didn't find by ID
    if ((!tickets || tickets.length === 0) && ticketNumber) {
      const { data } = await supabaseAdmin
        .from('detected_tickets')
        .select(`
          *,
          contest_letters (
            id,
            letter_content,
            letter_text,
            defense_type,
            status
          )
        `)
        .eq('user_id', user.id)
        .eq('ticket_number', ticketNumber)
        .eq('status', 'pending_evidence');
      tickets = data;
      console.log(`Found ${tickets?.length || 0} ticket(s) by ticket number`);
    }

    // Final fallback: get the first pending_evidence ticket (earliest deadline)
    if (!tickets || tickets.length === 0) {
      const { data } = await supabaseAdmin
        .from('detected_tickets')
        .select(`
          *,
          contest_letters (
            id,
            letter_content,
            letter_text,
            defense_type,
            status
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'pending_evidence')
        .order('evidence_deadline', { ascending: true })
        .limit(1);
      tickets = data;
      console.log(`Fallback: Found ${tickets?.length || 0} pending ticket(s) for user`);
    }

    if (!tickets || tickets.length === 0) {
      console.log('No pending tickets found for user');

      // Store email for manual review
      await supabaseAdmin
        .from('incoming_emails')
        .insert({
          user_id: user.id,
          from_email: fromEmail,
          subject: subject,
          body_text: textBody,
          body_html: htmlBody,
          processed: false,
          notification_sent: false,
        });

      await sendAdminNotification(fromEmail, subject, textBody, 'No pending tickets found');

      return res.status(200).json({ message: 'Email stored - no pending tickets' });
    }

    // Use the first (or only) matching ticket
    const ticket = tickets[0];
    const letter = ticket.contest_letters?.[0];

    console.log(`Found pending ticket: ${ticket.ticket_number}`);

    // IDEMPOTENCY: If evidence was already uploaded (webhook re-delivery), skip processing.
    // This prevents duplicate attachments, duplicate Claude Vision calls, and duplicate emails.
    if (ticket.user_evidence_uploaded_at) {
      console.log(`Evidence already processed for ticket ${ticket.id} at ${ticket.user_evidence_uploaded_at} — skipping (idempotent)`);
      return res.status(200).json({
        success: true,
        message: 'Evidence already processed (idempotent)',
        ticket_id: ticket.id,
      });
    }

    // Get user profile for letter regeneration
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error('Failed to load user profile:', profileError?.message);
      return res.status(500).json({ error: 'Failed to load user profile' });
    }

    // Store evidence — merge with any existing evidence (e.g. from prior SMS submission)
    const evidenceText = textBody || 'See attachments';
    const existingEvidenceRaw = ticket.user_evidence;
    let existingEvidence: any = {};
    if (existingEvidenceRaw) {
      try {
        existingEvidence = typeof existingEvidenceRaw === 'string'
          ? JSON.parse(existingEvidenceRaw)
          : existingEvidenceRaw;
      } catch {
        existingEvidence = {};
      }
    }

    // Merge text: append email text to any prior evidence text
    const mergedText = existingEvidence.text
      ? `${existingEvidence.text}\n\n--- Email Evidence ---\n${evidenceText}`
      : evidenceText;

    const evidenceData: any = {
      ...existingEvidence, // preserve prior SMS fields (sms_attachments, photo_analysis, etc.)
      text: mergedText,
      received_at: new Date().toISOString(),
      has_attachments: (existingEvidence.has_attachments || false) || attachments.length > 0,
      // Track which channels have submitted evidence
      received_via: existingEvidence.received_via
        ? (existingEvidence.received_via === 'email' ? 'email' : 'both')
        : 'email',
    };

    // Process attachments if any
    if (attachments.length > 0) {
      const { put } = await import('@vercel/blob');
      const attachmentUrls: string[] = [];

      for (const attachment of attachments) {
        try {
          const filename = attachment.filename || attachment.name || 'attachment';
          const contentType = attachment.content_type || attachment.contentType || attachment.type || 'application/octet-stream';

          // Log attachment properties for debugging
          console.log(`Processing attachment: ${filename}`);
          console.log(`  - contentType: ${contentType}`);
          console.log(`  - attachment keys: ${Object.keys(attachment).join(', ')}`);

          let buffer: Buffer | null = null;

          // Method 1: Fetch from Resend attachment download API (primary for Resend webhooks)
          // Resend webhooks only include metadata (id, filename, content_type) — not content.
          // Must fetch via: GET /emails/receiving/{email_id}/attachments/{attachment_id}
          if (!buffer && emailId && attachment.id) {
            console.log(`  Fetching attachment from Resend API: email=${emailId}, attachment=${attachment.id}`);
            try {
              const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50MB limit
              const attachMetaRes = await fetch(
                `https://api.resend.com/emails/receiving/${emailId}/attachments/${attachment.id}`,
                { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }
              );
              if (attachMetaRes.ok) {
                const attachMeta = await attachMetaRes.json();
                if (attachMeta.download_url) {
                  console.log(`  Downloading from: ${attachMeta.download_url}`);
                  // SECURITY: Validate download URL is from trusted Resend domain
                  if (!isAllowedAttachmentUrl(attachMeta.download_url)) {
                    console.error(`  Blocked untrusted download URL: ${attachMeta.download_url}`);
                    continue;
                  }
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 30000);
                  const downloadRes = await fetch(attachMeta.download_url, { signal: controller.signal });
                  clearTimeout(timeoutId);
                  if (downloadRes.ok) {
                    const contentLength = downloadRes.headers.get('content-length');
                    if (contentLength && parseInt(contentLength, 10) > MAX_ATTACHMENT_SIZE) {
                      console.error(`  Attachment too large: ${contentLength} bytes (max ${MAX_ATTACHMENT_SIZE})`);
                      continue;
                    }
                    const arrayBuffer = await downloadRes.arrayBuffer();
                    if (arrayBuffer.byteLength > MAX_ATTACHMENT_SIZE) {
                      console.error(`  Attachment exceeds size limit: ${arrayBuffer.byteLength} bytes`);
                      continue;
                    }
                    buffer = Buffer.from(arrayBuffer);
                    console.log(`  Downloaded ${buffer.length} bytes from Resend`);
                  } else {
                    console.error(`  Download failed: ${downloadRes.status}`);
                  }
                } else if (attachMeta.content) {
                  // Some versions return base64 content directly
                  const decoded = Buffer.from(attachMeta.content, 'base64');
                  if (decoded.length > MAX_ATTACHMENT_SIZE) {
                    console.error(`  Base64 content exceeds limit: ${decoded.length} bytes`);
                    continue;
                  }
                  buffer = decoded;
                  console.log(`  Got ${buffer.length} bytes from Resend content field`);
                }
              } else {
                console.error(`  Resend attachment API failed: ${attachMetaRes.status}`);
              }
            } catch (fetchErr: any) {
              console.error(`  Error fetching from Resend API: ${fetchErr.message}`);
            }
          }

          // Method 2: If attachment has a direct URL (Cloudflare worker format)
          if (!buffer && attachment.url) {
            console.log(`  Fetching attachment from URL: ${attachment.url}`);
            // SECURITY: Validate URL before fetching to prevent SSRF attacks
            if (!isAllowedAttachmentUrl(attachment.url)) {
              console.error(`⚠️ Blocked fetch to untrusted URL: ${attachment.url}`);
              continue; // Skip this attachment
            }
            try {
              const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000);
              const response = await fetch(attachment.url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (response.ok) {
                const contentLength = response.headers.get('content-length');
                if (contentLength && parseInt(contentLength, 10) > MAX_ATTACHMENT_SIZE) {
                  console.error(`  Attachment too large: ${contentLength} bytes`);
                  continue;
                }
                const arrayBuffer = await response.arrayBuffer();
                if (arrayBuffer.byteLength > MAX_ATTACHMENT_SIZE) {
                  console.error(`  Attachment exceeds size limit: ${arrayBuffer.byteLength} bytes`);
                  continue;
                }
                buffer = Buffer.from(arrayBuffer);
                console.log(`  Fetched ${buffer.length} bytes from URL`);
              } else {
                console.error(`  Failed to fetch URL: ${response.status}`);
              }
            } catch (fetchErr: any) {
              console.error(`  Error fetching URL: ${fetchErr.message}`);
            }
          }

          // Method 3: If attachment has inline content (base64 or raw)
          if (!buffer && attachment.content) {
            const content = attachment.content;
            if (typeof content === 'string') {
              let base64Data = content;
              const dataUrlMatch = base64Data.match(/^data:[^;]+;base64,(.+)$/);
              if (dataUrlMatch) base64Data = dataUrlMatch[1];
              base64Data = base64Data.replace(/[\s\r\n]/g, '');
              buffer = Buffer.from(base64Data, 'base64');
              console.log(`  Decoded base64 content: ${buffer.length} bytes`);
            } else if (Buffer.isBuffer(content)) {
              buffer = content;
            }
          }

          // Skip if we couldn't get any content
          if (!buffer || buffer.length === 0) {
            console.log(`  Skipping empty/unparseable attachment: ${filename}`);
            continue;
          }

          const timestamp = Date.now();
          const blobPath = `evidence/${user.id}/${ticket.id}/${timestamp}-${filename}`;

          const blob = await put(blobPath, buffer, {
            access: 'public',
            contentType: contentType,
          });

          attachmentUrls.push(blob.url);
          console.log(`  Uploaded: ${filename} (${buffer.length} bytes) -> ${blob.url}`);
        } catch (uploadErr: any) {
          console.error(`Failed to upload attachment ${attachment.filename}:`, uploadErr.message || uploadErr);
          console.error(`  Stack:`, uploadErr.stack);
        }
      }

      // Merge attachment URLs with any existing ones (from prior SMS submission)
      const existingAttachmentUrls: string[] = existingEvidence.attachment_urls || [];
      evidenceData.attachment_urls = [...existingAttachmentUrls, ...attachmentUrls];
      console.log(`Total attachments: ${evidenceData.attachment_urls.length} (${existingAttachmentUrls.length} existing + ${attachmentUrls.length} new)`);

      // Run Claude Vision analysis on uploaded photos (limit to 10 to prevent cost escalation)
      const MAX_PHOTOS_TO_ANALYZE = 10;
      const allPhotoUrls = attachmentUrls.filter((u: string) => /\.(jpg|jpeg|png|gif|heic|webp)/i.test(u));
      if (allPhotoUrls.length > MAX_PHOTOS_TO_ANALYZE) {
        console.log(`⚠️ Limiting photo analysis to first ${MAX_PHOTOS_TO_ANALYZE} of ${allPhotoUrls.length} photos`);
      }
      const photoUrls = allPhotoUrls.slice(0, MAX_PHOTOS_TO_ANALYZE);
      if (photoUrls.length > 0) {
        const photoAnalysisResults = await analyzeEvidencePhotos(photoUrls, ticket);
        if (photoAnalysisResults.length > 0) {
          // Merge photo analyses with any existing ones (use consistent field name)
          const existingAnalyses: any[] = existingEvidence.photo_analyses || [];
          evidenceData.photo_analyses = [...existingAnalyses, ...photoAnalysisResults];
          console.log(`Photo analyses: ${evidenceData.photo_analyses.length} total (${existingAnalyses.length} existing + ${photoAnalysisResults.length} new)`);
        }

        // ── OCR structured fields from the ticket image ──
        // CHI PAY doesn't expose the violation address, violation code,
        // officer badge, or issue time. When the user replies with a photo
        // of the paper ticket / mailed notice, this OCR pass pulls those
        // fields out and backfills the ticket row so Street View, 311
        // geo-proximity, contest-letter exhibits, and intersection defenses
        // all start working. We only write fields that are currently null
        // on the ticket and for which the OCR has high confidence.
        const ticketUpdate: Record<string, any> = {};
        for (const url of photoUrls) {
          const extracted = await extractTicketFieldsFromPhoto(url).catch((e) => {
            console.error(`OCR failed for ${url}:`, e?.message);
            return null;
          });
          if (!extracted || !extracted.is_actual_ticket) continue;
          console.log(`OCR extracted fields from ${url.split('/').pop()}: addr_conf=${extracted.address_confidence}, addr="${extracted.violation_address?.slice(0, 60)}", code=${extracted.violation_code}, time=${extracted.issue_time}`);

          // Address — only accept high confidence (≥0.6) so we don't steer
          // Street View to a bad block. Only fill if ticket.location is null.
          if (!ticket.location && extracted.violation_address && extracted.address_confidence >= 0.6) {
            ticketUpdate.location = extracted.violation_address;
          }
          // Violation code — the scraper infers type from description regex;
          // the actual CMC code on the ticket is authoritative.
          if (!ticket.violation_code && extracted.violation_code) {
            ticketUpdate.violation_code = extracted.violation_code;
          }
          // Officer badge — useful for officer-intelligence lookup and
          // clerical-error checks.
          if (!ticket.officer_badge && extracted.officer_badge) {
            ticketUpdate.officer_badge = extracted.officer_badge;
          }
          // Issue time — the scraper captures full ISO datetime when the
          // portal supplies it, but when it doesn't we use the OCR value
          // for within-day correlation (red-light receipts, weather hour).
          if (!ticket.issue_datetime && extracted.issue_time && ticket.violation_date) {
            // Combine ticket's date with the OCR'd time.
            ticketUpdate.issue_datetime = `${ticket.violation_date}T${extracted.issue_time}:00`;
          }
          // photo_url — single-image legacy column. Record the first photo
          // that the user submitted as THE ticket photo.
          if (!ticket.photo_url) {
            ticketUpdate.photo_url = url;
          }
          // Stop at the first ticket-like photo to save vision calls.
          break;
        }

        // ── Police report OCR (stolen-plate defense) ──
        // Only run for camera / missing-plate tickets where the stolen-plate
        // defense is the dominant dismissal reason. We skip the Vision call
        // for violation types where the defense doesn't apply, saving cost.
        const stolenPlateApplicable = ['red_light', 'speed_camera', 'missing_plate'].includes(
          ticket.violation_type || ''
        );
        if (stolenPlateApplicable && !ticket.plate_stolen) {
          for (const url of photoUrls) {
            const report = await extractPoliceReportFromPhoto(url).catch(() => null);
            if (!report || !report.is_stolen_plate_report || report.confidence < 0.5) continue;
            console.log(`Police report extracted: RD=${report.report_number}, agency=${report.agency}, stolen=${report.is_stolen_plate_report}`);
            ticketUpdate.plate_stolen = true;
            if (report.report_number) ticketUpdate.plate_stolen_report_number = report.report_number;
            if (report.agency) ticketUpdate.plate_stolen_report_agency = report.agency;
            if (report.report_date) ticketUpdate.plate_stolen_report_date = report.report_date;
            if (report.incident_date) ticketUpdate.plate_stolen_incident_date = report.incident_date;
            break; // one confirmed report is enough
          }
        }

        // Text-only fallback: the user might reply with just an RD number
        // in the email body rather than a photo of the report.
        if (stolenPlateApplicable && !ticketUpdate.plate_stolen_report_number && evidenceData.text) {
          const fromText = extractPoliceReportNumberFromText(evidenceData.text);
          if (fromText) {
            console.log(`Police report number extracted from email text: ${fromText.report_number} (${fromText.source})`);
            ticketUpdate.plate_stolen_report_number = fromText.report_number;
            // Only mark plate_stolen=true if the user's text actually says it was stolen
            if (/stolen|taken|lost|theft/i.test(evidenceData.text)) {
              ticketUpdate.plate_stolen = true;
            }
          }
        }

        // ── ParkChicago receipt OCR (expired-meter defense) ──
        if (ticket.violation_type === 'expired_meter' && !ticket.parkchicago_transaction_id) {
          for (const url of photoUrls) {
            const receipt = await extractParkChicagoReceiptFromPhoto(url).catch(() => null);
            if (!receipt || !receipt.is_parkchicago_receipt || receipt.confidence < 0.5) continue;
            console.log(`ParkChicago receipt extracted: zone=${receipt.zone}, txn=${receipt.transaction_id}, amount=${receipt.amount_paid}`);
            if (receipt.zone) ticketUpdate.parkchicago_zone = receipt.zone;
            if (receipt.start_time) ticketUpdate.parkchicago_start_time = receipt.start_time;
            if (receipt.end_time) ticketUpdate.parkchicago_end_time = receipt.end_time;
            if (typeof receipt.amount_paid === 'number') ticketUpdate.parkchicago_amount_paid = receipt.amount_paid;
            if (receipt.transaction_id) ticketUpdate.parkchicago_transaction_id = receipt.transaction_id;
            break;
          }
        }

        if (Object.keys(ticketUpdate).length > 0) {
          console.log(`Backfilling ticket ${ticket.id} with OCR fields:`, Object.keys(ticketUpdate).join(', '));
          await supabaseAdmin
            .from('detected_tickets')
            .update(ticketUpdate)
            .eq('id', ticket.id);
          // Reflect the update on the in-memory ticket object so any later
          // logic in this request sees the fresh values.
          Object.assign(ticket, ticketUpdate);
        }
      }
    }

    // Update ticket with evidence and SLA tracking
    const evidenceReceivedAt = new Date().toISOString();
    const evidenceOnTime = ticket?.evidence_deadline
      ? new Date(evidenceReceivedAt).getTime() <= new Date(ticket.evidence_deadline).getTime()
      : null;

    // Look up user settings to determine approval requirement
    const { data: userSettings } = await supabaseAdmin
      .from('autopilot_settings')
      .select('require_approval, auto_mail_enabled')
      .eq('user_id', user.id)
      .maybeSingle();

    // Default: require approval (matches new DB default)
    const requireApproval = userSettings?.require_approval ?? true;
    const autoMailEnabled = userSettings?.auto_mail_enabled ?? false;
    const needsApproval = requireApproval || !autoMailEnabled;

    console.log(`User settings: require_approval=${requireApproval}, auto_mail_enabled=${autoMailEnabled}, needsApproval=${needsApproval}`);

    // Determine new ticket status based on approval requirement
    // If auto-mail user, go straight to 'approved' so mail cron picks it up.
    // 'evidence_received' is an orphan status — no cron advances it.
    const newStatus = needsApproval ? 'needs_approval' : 'approved';

    // Update ticket with evidence
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        user_evidence: JSON.stringify(evidenceData),
        user_evidence_uploaded_at: evidenceReceivedAt,
        evidence_received_at: evidenceReceivedAt,
        evidence_on_time: evidenceOnTime,
        // Preserve original evidence_deadline (day 17 from ticket issue) — don't overwrite
        // The auto-send logic in autopilot-mail-letters checks evidence_deadline + 1h buffer
        status: newStatus,
      })
      .eq('id', ticket.id);

    console.log(`Updated ticket with evidence, status=${newStatus}`);

    // Parse user evidence into structured form for policy engine
    const attachmentFilenames = attachments.map((a: any) => a.filename || a.name || 'attachment');
    const parsedEvidence = parseUserEvidence(
      evidenceText,
      attachments.length > 0,
      attachmentFilenames,
      ticket.violation_type || ''
    );

    console.log('Parsed user evidence:', JSON.stringify({
      hasPhotos: parsedEvidence.hasPhotos,
      photoTypes: parsedEvidence.photoTypes,
      hasDocs: parsedEvidence.hasDocs,
      docTypes: parsedEvidence.docTypes,
      hasReceipts: parsedEvidence.hasReceipts,
      hasPoliceReport: parsedEvidence.hasPoliceReport,
    }));

    // Re-evaluate with contest kit policy engine using user's actual evidence
    let kitEval: ContestEvaluation | null = null;
    try {
      kitEval = await reEvaluateWithKit(ticket, parsedEvidence);
      if (kitEval) {
        console.log(`Kit re-evaluation: "${kitEval.selectedArgument.name}" (${Math.round(kitEval.estimatedWinRate * 100)}% win rate, ${Math.round(kitEval.confidence * 100)}% confidence)`);
        console.log(`  Evidence provided: ${kitEval.evidenceChecklist.filter(e => e.provided).length}/${kitEval.evidenceChecklist.length}`);
        if (kitEval.backupArgument) {
          console.log(`  Backup: "${kitEval.backupArgument.name}"`);
        }
      }
    } catch (err: any) {
      console.error('Kit re-evaluation failed (non-fatal):', err.message);
    }

    // Regenerate letter with AI if we have an existing letter
    let regeneratedLetterContent: string | null = null;
    let currentLetterId: string | null = letter?.id || null;

    // Guard: don't regenerate a letter that's already been mailed/sent/delivered/returned
    // Don't regenerate letters already sent/delivered/returned.
    // 'mailing' excluded: brief mailing window (~seconds) shouldn't block evidence integration.
    const IMMUTABLE_LETTER_STATUSES = ['sent', 'delivered', 'returned'];
    if (letter && IMMUTABLE_LETTER_STATUSES.includes(letter.status)) {
      console.log(`⚠️ Letter ${letter.id} is already "${letter.status}" — skipping regeneration to preserve mailed content`);
      // Store evidence on the ticket but don't touch the letter
    } else if (letter) {
      const originalLetter = letter.letter_content || letter.letter_text || '';

      // Use AI to integrate ALL evidence (merged from SMS + email), guided by kit evaluation strategy
      const photoAnalysesForPrompt = evidenceData.photo_analyses || [];
      const allEvidenceText = evidenceData.text || evidenceText; // Use merged text (includes prior SMS text if any)
      regeneratedLetterContent = await regenerateLetterWithAI(
        originalLetter,
        allEvidenceText,
        ticket,
        evidenceData.has_attachments || attachments.length > 0,
        kitEval,
        photoAnalysesForPrompt
      );

      // Validate AI output — must be non-empty and substantive
      if (!regeneratedLetterContent || regeneratedLetterContent.trim().length < 50) {
        console.error(`AI regeneration produced empty/malformed output (${regeneratedLetterContent?.length || 0} chars) — keeping original letter`);
        regeneratedLetterContent = originalLetter; // Fall back to original
      }

      // Update defense type if kit evaluation selected a different argument
      const newDefenseType = kitEval
        ? `kit_${kitEval.selectedArgument.id}`
        : letter.defense_type;

      // Set letter status based on approval requirement
      const letterStatus = needsApproval ? 'pending_approval' : 'ready';

      await supabaseAdmin
        .from('contest_letters')
        .update({
          letter_content: regeneratedLetterContent,
          letter_text: regeneratedLetterContent,
          defense_type: newDefenseType,
          status: letterStatus,
          evidence_integrated: true,
          evidence_integrated_at: new Date().toISOString(),
        })
        .eq('id', letter.id)
        .eq('user_id', user.id); // Defense-in-depth: ensure letter belongs to this user

      console.log(`Regenerated contest letter with kit-guided AI integration (defense=${newDefenseType}, status=${letterStatus})`);
    } else {
      // No letter exists yet — ticket was found but letter generation cron hasn't run
      // Set ticket status to 'found' temporarily so the generate-letters cron picks it up
      console.log('No existing letter found — triggering letter generation');
      await supabaseAdmin
        .from('detected_tickets')
        .update({ status: 'found' })
        .eq('id', ticket.id);

      const genResult = await triggerLetterGeneration('evidence_received_no_letter');
      console.log(`Letter generation trigger: ${genResult.message}`);

      // After generation, the generate-letters cron will set status to needs_approval
      // and send the approval email. We don't need to do it here.
    }

    // Log to audit
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: ticket.id,
        user_id: user.id,
        action: 'evidence_submitted',
        details: {
          email_from: fromEmail,
          email_subject: subject,
          attachment_count: attachments.length,
          needs_approval: needsApproval,
          parsedEvidence: {
            hasPhotos: parsedEvidence.hasPhotos,
            photoTypes: parsedEvidence.photoTypes,
            hasDocs: parsedEvidence.hasDocs,
            docTypes: parsedEvidence.docTypes,
            hasReceipts: parsedEvidence.hasReceipts,
          },
          kitReEvaluation: kitEval ? {
            selectedArgument: kitEval.selectedArgument.name,
            argumentWinRate: Math.round(kitEval.selectedArgument.winRate * 100),
            estimatedWinRate: Math.round(kitEval.estimatedWinRate * 100),
            confidence: Math.round(kitEval.confidence * 100),
            evidenceProvided: kitEval.evidenceChecklist.filter(e => e.provided).length,
            evidenceTotal: kitEval.evidenceChecklist.length,
            backupArgument: kitEval.backupArgument?.name || null,
          } : null,
        },
        performed_by: 'evidence_webhook',
      });

    // Get user email for notifications
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user.id);
    const userEmail = authUser?.user?.email || fromEmail;

    // If approval is needed and we have a regenerated letter, send approval email immediately
    if (needsApproval && regeneratedLetterContent && currentLetterId) {
      const approvalSent = await sendApprovalEmailForEvidence(
        userEmail,
        profile?.first_name || 'there',
        ticket.ticket_number,
        ticket.id,
        user.id,
        currentLetterId,
        regeneratedLetterContent,
        ticket.violation_description || ticket.violation_type || 'Parking Violation',
        ticket.violation_date || ticket.issue_date || null,
        ticket.amount || ticket.total_amount || null,
      );
      if (!approvalSent) {
        console.error(`❌ Failed to send approval email for ticket ${ticket.ticket_number} to ${userEmail} — user will not receive approval prompt`);
      }
    } else if (!needsApproval) {
      // Auto-mail user: send simple confirmation and trigger mailing
      await sendUserConfirmation(fromEmail, profile?.first_name || 'there', ticket.ticket_number);

      const triggerResult = await triggerAutopilotMailRun({
        ticketId: ticket.id,
        reason: 'evidence_received_webhook',
      });
      console.log(`Mail trigger: ${triggerResult.message}`);
    }
    // If no letter existed, the generate-letters cron handles the approval email

    // Notify admin with full details + regenerated letter
    await sendAdminNotification(
      fromEmail,
      subject,
      evidenceText,
      `Evidence received for ticket ${ticket.ticket_number}. ${needsApproval ? 'Approval email sent.' : 'Letter queued for mailing.'}`,
      ticket.ticket_number,
      attachments.length,
      {
        regeneratedLetter: regeneratedLetterContent,
        attachmentUrls: evidenceData.attachment_urls || [],
        violationType: ticket.violation_type || ticket.violation_code || null,
        violationDate: ticket.violation_date || ticket.issue_date || null,
        amount: ticket.amount || ticket.total_amount || null,
        plate: ticket.plate_number || ticket.license_plate || null,
        userName: profile?.full_name || profile?.first_name || null,
      }
    );

    return res.status(200).json({
      success: true,
      message: needsApproval ? 'Evidence received — approval email sent' : 'Evidence received — mailing triggered',
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      letter_updated: !!letter,
      needs_approval: needsApproval,
    });

  } catch (error: any) {
    console.error('Error processing evidence email:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}

/**
 * Send confirmation email to user
 */
async function sendUserConfirmation(
  userEmail: string,
  userName: string,
  ticketNumber: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [userEmail],
        subject: `Evidence Received - Ticket ${ticketNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #10b981; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Evidence Received!</h1>
            </div>
            <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                Hi ${userName},
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                Thank you for submitting evidence for ticket <strong>${ticketNumber}</strong>.
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                We've updated your contest letter to include the evidence you provided. We'll send your letter to the City of Chicago today.
              </p>
              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                Questions? Reply to this email.
              </p>
            </div>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Failed to send user confirmation:', err);
  }
}

/**
 * Send admin notification with full evidence details + regenerated letter
 */
async function sendAdminNotification(
  fromEmail: string,
  subject: string,
  body: string,
  status: string,
  ticketNumber?: string,
  attachmentCount?: number,
  extras?: {
    regeneratedLetter: string | null;
    attachmentUrls: string[];
    violationType: string | null;
    violationDate: string | null;
    amount: string | number | null;
    plate: string | null;
    userName: string | null;
  }
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  // Escape user-supplied text to prevent XSS in admin email HTML
  const escapeHtml = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const safeBody = escapeHtml(body);
  const safeFromEmail = escapeHtml(fromEmail);
  const safeStatus = escapeHtml(status);

  // Build attachment links HTML
  let attachmentLinksHtml = '';
  if (extras?.attachmentUrls && extras.attachmentUrls.length > 0) {
    const links = extras.attachmentUrls
      .map((url, i) => `<a href="${url}" style="color: #2563eb; text-decoration: underline;">Attachment ${i + 1}</a>`)
      .join(' &nbsp;|&nbsp; ');
    attachmentLinksHtml = `
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #1e40af;">Evidence Attachments (${extras.attachmentUrls.length}):</p>
        <p style="margin: 0;">${links}</p>
      </div>
    `;
  }

  // Build regenerated letter section
  let letterHtml = '';
  if (extras?.regeneratedLetter) {
    letterHtml = `
      <div style="margin: 20px 0;">
        <h3 style="color: #065f46; margin-bottom: 8px;">Regenerated Contest Letter</h3>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px;">
          <pre style="white-space: pre-wrap; font-family: Georgia, serif; font-size: 13px; line-height: 1.6; margin: 0; color: #1f2937;">${extras.regeneratedLetter}</pre>
        </div>
      </div>
    `;
  }

  // Build ticket details table
  let ticketDetailsHtml = '';
  if (ticketNumber || extras?.violationType || extras?.amount || extras?.plate) {
    const rows = [
      ticketNumber ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Ticket #</td><td style="padding: 6px 12px;">${ticketNumber}</td></tr>` : '',
      extras?.violationType ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Violation</td><td style="padding: 6px 12px;">${extras.violationType}</td></tr>` : '',
      extras?.violationDate ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Date</td><td style="padding: 6px 12px;">${extras.violationDate}</td></tr>` : '',
      extras?.amount ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Amount</td><td style="padding: 6px 12px;">$${extras.amount}</td></tr>` : '',
      extras?.plate ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Plate</td><td style="padding: 6px 12px;">${extras.plate}</td></tr>` : '',
      extras?.userName ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">User</td><td style="padding: 6px 12px;">${extras.userName}</td></tr>` : '',
    ].filter(Boolean).join('');

    ticketDetailsHtml = `
      <table style="border-collapse: collapse; margin: 12px 0; font-size: 14px;">
        ${rows}
      </table>
    `;
  }

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: ['randyvollrath@gmail.com'],
        subject: `Evidence Received: Ticket ${ticketNumber || 'Unknown'} from ${extras?.userName || fromEmail}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
            <div style="background: #059669; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 22px;">User Submitted Evidence</h1>
              <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">${safeStatus}</p>
            </div>

            <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none;">
              <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 13px;">From</p>
              <p style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600;">${safeFromEmail}</p>

              ${ticketDetailsHtml}

              <h3 style="color: #374151; margin: 20px 0 8px 0;">User's Evidence Message</h3>
              <pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; white-space: pre-wrap; font-size: 14px; line-height: 1.5; margin: 0;">${safeBody}</pre>

              ${attachmentLinksHtml}

              ${letterHtml}

              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  Same-day mailing has been triggered. The letter will be sent via Lob today.
                </p>
              </div>
            </div>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Failed to send admin notification:', err);
  }
}
