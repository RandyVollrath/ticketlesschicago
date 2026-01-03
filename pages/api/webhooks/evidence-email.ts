import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyWebhook } from '../../../lib/webhook-verification';

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

export const config = {
  api: {
    bodyParser: true,
  },
};

interface UserProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  mailing_address_line1: string | null;
  mailing_address_line2: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

/**
 * Regenerate letter content with user-provided evidence
 */
function regenerateLetterWithEvidence(
  originalLetter: string,
  userEvidence: string,
  profile: UserProfile
): string {
  // Find where the body of the letter starts (after "To Whom It May Concern:")
  const bodyStart = originalLetter.indexOf('To Whom It May Concern:');
  if (bodyStart === -1) {
    // If we can't find it, just append evidence section
    return originalLetter + `\n\nADDITIONAL EVIDENCE:\n${userEvidence}`;
  }

  // Find where the signature starts ("Thank you for your consideration" or "Sincerely")
  const signatureStart = originalLetter.indexOf('Thank you for your consideration');
  const sincerelyStart = originalLetter.indexOf('Sincerely');
  const endOfBody = signatureStart !== -1 ? signatureStart : sincerelyStart;

  if (endOfBody === -1) {
    return originalLetter + `\n\nADDITIONAL EVIDENCE:\n${userEvidence}`;
  }

  // Insert evidence section before the signature
  const header = originalLetter.substring(0, endOfBody);
  const footer = originalLetter.substring(endOfBody);

  const evidenceSection = `Additionally, I am providing the following evidence to support my contest:

${userEvidence}

`;

  return header + evidenceSection + footer;
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

  // SECURITY: Verify webhook signature
  // Support both Resend webhooks (uses RESEND_EVIDENCE_WEBHOOK_SECRET)
  // and Cloudflare Email Workers (uses X-Cloudflare-Email-Worker header)
  const cloudflareHeader = req.headers['x-cloudflare-email-worker'] as string;
  const expectedCloudflareSecret = process.env.CLOUDFLARE_EMAIL_WORKER_SECRET;

  const isCloudflareWorker = cloudflareHeader &&
    (cloudflareHeader === expectedCloudflareSecret || !expectedCloudflareSecret);

  if (!isCloudflareWorker && !verifyWebhook('resend-evidence', req)) {
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
    const toEmail = data.to;
    const subject = data.subject || '(no subject)';
    const textBody = data.text || '';
    const htmlBody = data.html || '';
    const attachments = data.attachments || [];

    console.log(`Evidence email from ${fromEmail}: "${subject}"`);
    console.log(`Attachments: ${attachments.length}`);

    // Only process emails sent to evidence@autopilotamerica.com
    if (!toEmail?.includes('evidence@autopilotamerica.com')) {
      console.log('Email not sent to evidence address, ignoring');
      return res.status(200).json({ message: 'Not an evidence email' });
    }

    // Find user by email
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
    const user = authUsers.users.find(u => u.email === fromEmail);

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

    // Try to extract ticket number from email
    const ticketNumber = extractTicketNumber(subject, textBody);
    console.log(`Extracted ticket number: ${ticketNumber}`);

    // Find pending ticket for this user
    let ticketQuery = supabaseAdmin
      .from('detected_tickets')
      .select(`
        *,
        contest_letters (
          id,
          letter_content,
          letter_text,
          defense_type
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'pending_evidence');

    // If we found a ticket number, filter by it
    if (ticketNumber) {
      ticketQuery = ticketQuery.eq('ticket_number', ticketNumber);
    }

    const { data: tickets } = await ticketQuery.order('evidence_deadline', { ascending: true });

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

    // Get user profile for letter regeneration
    const { data: profile } = await supabaseAdmin
      .from('autopilot_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // Store evidence
    const evidenceText = textBody || 'See attachments';
    const evidenceData: any = {
      text: evidenceText,
      received_at: new Date().toISOString(),
      has_attachments: attachments.length > 0,
    };

    // Process attachments if any
    if (attachments.length > 0) {
      const { put } = await import('@vercel/blob');
      const attachmentUrls: string[] = [];

      for (const attachment of attachments) {
        try {
          const filename = attachment.filename || 'attachment';
          const contentType = attachment.content_type || 'application/octet-stream';
          const buffer = Buffer.from(attachment.content, 'base64');

          const timestamp = Date.now();
          const blobPath = `evidence/${user.id}/${ticket.id}/${timestamp}-${filename}`;

          const blob = await put(blobPath, buffer, {
            access: 'private',
            contentType: contentType,
          });

          attachmentUrls.push(blob.url);
          console.log(`Uploaded evidence attachment: ${filename}`);
        } catch (uploadErr) {
          console.error('Failed to upload attachment:', uploadErr);
        }
      }

      evidenceData.attachment_urls = attachmentUrls;
    }

    // Update ticket with evidence
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        user_evidence: JSON.stringify(evidenceData),
        user_evidence_uploaded_at: new Date().toISOString(),
        status: 'evidence_received',
      })
      .eq('id', ticket.id);

    console.log('Updated ticket with evidence');

    // Regenerate letter if we have profile and existing letter
    if (profile && letter) {
      const originalLetter = letter.letter_content || letter.letter_text || '';
      const newLetterContent = regenerateLetterWithEvidence(
        originalLetter,
        evidenceText,
        profile as UserProfile
      );

      await supabaseAdmin
        .from('contest_letters')
        .update({
          letter_content: newLetterContent,
          letter_text: newLetterContent,
          status: 'ready_to_mail',
        })
        .eq('id', letter.id);

      console.log('Regenerated contest letter with evidence');
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
        },
        performed_by: 'evidence_webhook',
      });

    // Send confirmation email to user
    await sendUserConfirmation(fromEmail, profile?.first_name || 'there', ticket.ticket_number);

    // Notify admin
    await sendAdminNotification(
      fromEmail,
      subject,
      evidenceText,
      `Evidence received for ticket ${ticket.ticket_number}. Letter regenerated.`,
      ticket.ticket_number,
      attachments.length
    );

    return res.status(200).json({
      success: true,
      message: 'Evidence received and processed',
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      letter_updated: !!letter,
    });

  } catch (error: any) {
    console.error('Error processing evidence email:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process evidence email'
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
                We've updated your contest letter to include the evidence you provided. Your letter will be mailed to the City of Chicago on the next mailing date.
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
 * Send admin notification
 */
async function sendAdminNotification(
  fromEmail: string,
  subject: string,
  body: string,
  status: string,
  ticketNumber?: string,
  attachmentCount?: number
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
        to: [process.env.ADMIN_NOTIFICATION_EMAIL || 'hiautopilotamerica@gmail.com'],
        subject: `Evidence Email: ${status}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Evidence Email Received</h2>
            <p><strong>Status:</strong> ${status}</p>
            ${ticketNumber ? `<p><strong>Ticket:</strong> ${ticketNumber}</p>` : ''}
            <p><strong>From:</strong> ${fromEmail}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            ${attachmentCount ? `<p><strong>Attachments:</strong> ${attachmentCount}</p>` : ''}
            <hr>
            <p><strong>Message:</strong></p>
            <pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${body}</pre>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Failed to send admin notification:', err);
  }
}
