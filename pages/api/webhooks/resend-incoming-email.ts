import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyWebhook } from '../../../lib/webhook-verification';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { triggerAutopilotMailRun } from '../../../lib/trigger-autopilot-mail';
import {
  isFoiaResponseEmail,
  processFoiaResponse,
  processHistoryFoiaResponse,
  classifyComplianceDocument,
  processComplianceDocument,
} from '../../../lib/contest-outcome-tracker';

/**
 * Resend Incoming Email Webhook
 *
 * This endpoint receives incoming email replies from Resend when users reply to your emails.
 * It stores the reply, matches it to a user, and sends you a notification.
 *
 * Setup Instructions:
 * 1. Go to Resend Dashboard: https://resend.com/settings/webhooks
 * 2. Add a new webhook
 * 3. Set URL to: https://ticketlessamerica.com/api/webhooks/resend-incoming-email
 * 4. Enable "email.received" event
 * 5. Save and copy the signing secret to .env as RESEND_WEBHOOK_SECRET
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb', // Must be large enough for base64-encoded image attachments
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Verify webhook signature
  if (!verifyWebhook('resend', req)) {
    console.error('⚠️ Resend webhook verification failed');
    return res.status(401).json({ error: 'Unauthorized - invalid signature' });
  }

  console.log('📧 Incoming email webhook called (verified ✅)');
  console.log('Event:', { type: req.body?.type, from: req.body?.data?.from, to: req.body?.data?.to, subject: req.body?.data?.subject, attachments: req.body?.data?.attachments?.length || 0 });

  try {
    const event = req.body;

    // Resend webhook format
    if (event.type !== 'email.received') {
      console.log('Ignoring non-received event:', event.type);
      return res.status(200).json({ message: 'Event ignored' });
    }

    const data = event.data;
    const fromEmail = data.from;
    const toEmail = data.to || '';
    const subject = data.subject || '(no subject)';
    const text = data.text || data.html || '';
    const html = data.html || '';
    const attachments = data.attachments || []; // Resend provides attachments array

    console.log(`📨 Email from ${fromEmail} to ${toEmail}: "${subject}"`);
    console.log(`📎 Attachments: ${attachments.length}`);

    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // ── Check if this is a FOIA response from the City of Chicago ──
    if (isFoiaResponseEmail(fromEmail, subject, text)) {
      console.log('FOIA response email detected from city');

      // Upload FOIA attachments to Vercel Blob (PDFs, CSVs, XLSX files from city)
      const foiaAttachmentsMeta: { filename: string; content_type: string; url?: string }[] = [];
      let foiaAttachmentTextContent = ''; // Extracted text from CSV/text attachments for AI parsing
      // Whitelist of content types allowed for FOIA attachments
      const ALLOWED_FOIA_CONTENT_TYPES = [
        'application/pdf',
        'text/csv',
        'text/plain',
        'text/tab-separated-values',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/png',
        'image/jpeg',
        'image/tiff',
      ];

      if (attachments.length > 0) {
        try {
          const { put } = await import('@vercel/blob');
          for (const attachment of attachments) {
            const contentType = attachment.content_type || 'application/octet-stream';

            // Validate content type to prevent malicious file uploads (e.g. text/html → XSS)
            if (!ALLOWED_FOIA_CONTENT_TYPES.includes(contentType)) {
              console.warn(`  ⚠️ Rejected FOIA attachment with disallowed content type: ${contentType} (${attachment.filename})`);
              continue;
            }

            // Sanitize filename to prevent path traversal and special characters
            const rawFilename = attachment.filename || `foia-doc-${Date.now()}`;
            const filename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'attachment';
            const buffer = Buffer.from(attachment.content, 'base64');

            const blobPath = `foia-responses/${Date.now()}-${filename}`;
            const blob = await put(blobPath, buffer, {
              access: 'private',
              contentType: contentType,
            });

            foiaAttachmentsMeta.push({
              filename,
              content_type: contentType,
              url: blob.url,
            });
            console.log(`  ✅ Uploaded FOIA attachment: ${filename} (${contentType}, ${buffer.length} bytes) → ${blob.url}`);

            // Extract text content from CSV/TSV/text attachments for AI parsing
            const lowerFilename = filename.toLowerCase();
            if (contentType.startsWith('text/') || lowerFilename.endsWith('.csv') || lowerFilename.endsWith('.tsv') || lowerFilename.endsWith('.txt')) {
              try {
                const textContent = buffer.toString('utf-8');
                foiaAttachmentTextContent += `\n\n--- ATTACHMENT: ${filename} ---\n${textContent}`;
                console.log(`  📄 Extracted ${textContent.length} chars of text from ${filename}`);
              } catch (e) { /* non-text content, skip */ }
            }
          }
        } catch (uploadError: any) {
          console.error('  ❌ Error uploading FOIA attachments:', uploadError.message);
          // Fall back to metadata-only if upload fails
          for (const a of attachments) {
            foiaAttachmentsMeta.push({
              filename: a.filename || 'unknown',
              content_type: a.content_type || 'application/octet-stream',
            });
          }
        }
      }

      // Combine email body with any extracted attachment text for fuller AI parsing
      const enrichedBody = foiaAttachmentTextContent
        ? `${text}\n\n${foiaAttachmentTextContent}`
        : text;

      // Extract email headers for In-Reply-To matching (Layer 2)
      const emailHeaders = {
        inReplyTo: data.headers?.['in-reply-to'] || data.in_reply_to || undefined,
        references: data.headers?.['references'] || undefined,
        messageId: data.headers?.['message-id'] || data.message_id || undefined,
      };

      try {
        const foiaResult = await processFoiaResponse(
          supabaseAdmin,
          fromEmail,
          subject,
          enrichedBody, // Use enrichedBody (email text + extracted CSV/attachment text) not raw text
          foiaAttachmentsMeta,
          emailHeaders,
        );
        console.log(`  FOIA result: ${foiaResult.action} (matched: ${foiaResult.matched}, type: ${foiaResult.foiaType})`);

        // ── Handle history FOIA matches ──
        if (foiaResult.matched && foiaResult.foiaType === 'history' && foiaResult.requestId) {
          console.log(`  Processing history FOIA response for request ${foiaResult.requestId}`);
          try {
            const historyResult = await processHistoryFoiaResponse(
              supabaseAdmin,
              foiaResult.requestId,
              fromEmail,
              subject,
              enrichedBody, // Use enriched body with CSV/text attachment content
              foiaAttachmentsMeta,
            );
            console.log(`  History FOIA: ${historyResult.action} (${historyResult.parsedTicketCount} tickets parsed)`);

            // Notify admin — different email for extensions vs actual responses
            if (process.env.RESEND_API_KEY) {
              const isExt = historyResult.isExtension;
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: 'Autopilot America <alerts@autopilotamerica.com>',
                  to: ['randyvollrath@gmail.com'],
                  subject: isExt
                    ? `FOIA Extension Notice — History Request ${foiaResult.requestId}`
                    : `FOIA History Response — ${historyResult.parsedTicketCount} tickets found`,
                  html: isExt
                    ? `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                      <div style="background: #D97706; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                        <h1 style="margin: 0; font-size: 20px;">FOIA Extension Filed</h1>
                        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">City invoked 5 ILCS 140/3(e) — additional 5 business days</p>
                      </div>
                      <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <p style="background: #FEF3C7; padding: 12px; border-radius: 8px; border-left: 4px solid #D97706;">
                          <strong>Extension only — user was NOT notified.</strong> The city has an additional 5 business days to produce the records.
                        </p>
                        <p><strong>Request ID:</strong> ${foiaResult.requestId}</p>
                        <p><strong>From:</strong> ${fromEmail}</p>
                        <p><strong>Action:</strong> ${historyResult.action}</p>
                        <hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">
                        <p><strong>Body Preview:</strong></p>
                        <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 13px;">${text.substring(0, 500)}</div>
                      </div>
                    </div>
                  `
                    : `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                      <div style="background: #0369A1; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                        <h1 style="margin: 0; font-size: 20px;">FOIA History Response Received</h1>
                      </div>
                      <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <p><strong>Request ID:</strong> ${foiaResult.requestId}</p>
                        <p><strong>From:</strong> ${fromEmail}</p>
                        <p><strong>Tickets Parsed:</strong> ${historyResult.parsedTicketCount}</p>
                        <p><strong>Action:</strong> ${historyResult.action}</p>
                        <hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">
                        <p><strong>Body Preview:</strong></p>
                        <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 13px;">${text.substring(0, 500)}</div>
                      </div>
                    </div>
                  `,
                }),
              });
            }
          } catch (histErr: any) {
            console.error('  History FOIA processing failed:', histErr.message);
          }

          return res.status(200).json({
            message: 'History FOIA response processed',
            ...foiaResult,
          });
        }

        // ── Handle evidence FOIA matches ──
        if (foiaResult.matched && foiaResult.foiaType === 'evidence' && foiaResult.ticketNumber) {

          // ── Extension: admin-only notification, skip letter regen and user notification ──
          if (foiaResult.isExtension) {
            console.log(`  Evidence FOIA extension detected — skipping letter regen and user notification`);
            try {
              if (process.env.RESEND_API_KEY) {
                await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    from: 'Autopilot America <alerts@autopilotamerica.com>',
                    to: ['randyvollrath@gmail.com'],
                    subject: `FOIA Extension Notice — Ticket ${foiaResult.ticketNumber}`,
                    html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: #D97706; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                          <h1 style="margin: 0; font-size: 20px;">FOIA Extension Filed</h1>
                          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">City invoked 5 ILCS 140/3(e) — additional 5 business days</p>
                        </div>
                        <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                          <p style="background: #FEF3C7; padding: 12px; border-radius: 8px; border-left: 4px solid #D97706;">
                            <strong>Extension only — user was NOT notified.</strong> The city has an additional 5 business days to produce enforcement records.
                          </p>
                          <p><strong>Ticket:</strong> ${foiaResult.ticketNumber}</p>
                          <p><strong>From:</strong> ${fromEmail}</p>
                          <p><strong>Subject:</strong> ${subject}</p>
                          <p><strong>Attachments:</strong> ${attachments.length}</p>
                          <hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">
                          <p><strong>Body Preview:</strong></p>
                          <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 13px;">${text.substring(0, 500)}</div>
                        </div>
                      </div>
                    `,
                  }),
                });
                console.log('  Admin notified of FOIA extension');
              }
            } catch (extNotifErr: any) {
              console.error('  Admin extension notification failed:', extNotifErr.message);
            }

            return res.status(200).json({
              message: 'Evidence FOIA extension processed (admin-only notification)',
              ...foiaResult,
            });
          }

          // Trigger letter re-generation if letter hasn't been mailed
          try {
            const { data: foiaReqData } = await supabaseAdmin
              .from('ticket_foia_requests')
              .select('ticket_id')
              .eq('id', foiaResult.requestId || '')
              .single();

            if (foiaReqData) {
              const { data: letter } = await supabaseAdmin
                .from('contest_letters')
                .select('id, status, mailed_at')
                .eq('ticket_id', foiaReqData.ticket_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (letter && !letter.mailed_at) {
                await supabaseAdmin
                  .from('contest_letters')
                  .update({
                    letter_content: null,
                    letter_text: null,
                    status: 'pending_evidence',
                  })
                  .eq('id', letter.id);

                console.log(`  Letter ${letter.id} marked for re-generation (FOIA response received)`);

                await supabaseAdmin.from('ticket_audit_log').insert({
                  ticket_id: foiaReqData.ticket_id,
                  action: 'letter_regeneration_triggered',
                  details: {
                    reason: 'foia_response_received',
                    foia_action: foiaResult.action,
                    letter_id: letter.id,
                    attachment_count: attachments.length,
                  },
                  performed_by: null,
                });
              } else if (letter && letter.mailed_at) {
                console.log(`  Letter ${letter.id} already mailed — cannot re-generate`);
                await supabaseAdmin.from('ticket_audit_log').insert({
                  ticket_id: foiaReqData.ticket_id,
                  action: 'foia_response_after_mailing',
                  details: {
                    foia_action: foiaResult.action,
                    letter_id: letter.id,
                    mailed_at: letter.mailed_at,
                    note: 'FOIA response arrived after letter was already mailed',
                  },
                  performed_by: null,
                });
              }

              // Notify the user that FOIA response arrived
              const { data: ticketData } = await supabaseAdmin
                .from('detected_tickets')
                .select('user_id, ticket_number')
                .eq('id', foiaReqData.ticket_id)
                .single();

              if (ticketData) {
                const { data: userData } = await supabaseAdmin.auth.admin.getUserById(ticketData.user_id);
                const userEmail = userData?.user?.email;

                if (userEmail && process.env.RESEND_API_KEY) {
                  const isDenial = foiaResult.action === 'foia_denial_recorded';
                  const userSubject = isDenial
                    ? `FOIA Update: No Records Found — Ticket #${ticketData.ticket_number}`
                    : `FOIA Update: City Responded — Ticket #${ticketData.ticket_number}`;
                  const userMessage = isDenial
                    ? `The City of Chicago responded to our FOIA request for ticket #${ticketData.ticket_number} and stated that no responsive records were found. This strengthens your contest — the city's own records system has no supporting enforcement documentation for this citation. Your contest letter will be updated to include this as a due process argument.`
                    : `The City of Chicago responded to our FOIA request for ticket #${ticketData.ticket_number} and provided ${attachments.length} document(s). We're reviewing the records and updating your contest letter accordingly.`;

                  await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      from: 'Autopilot America <alerts@autopilotamerica.com>',
                      to: [userEmail],
                      subject: userSubject,
                      html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                          <div style="background: ${isDenial ? '#7C3AED' : '#2563EB'}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; font-size: 20px;">${isDenial ? 'FOIA: No Records Found' : 'FOIA Response Received'}</h1>
                          </div>
                          <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                            <p>${userMessage}</p>
                            ${isDenial ? '<p style="background: #f3e8ff; padding: 12px; border-radius: 8px; border-left: 4px solid #7C3AED;"><strong>What this means:</strong> Under the Illinois FOIA Act (5 ILCS 140), the city had 5 business days to produce the enforcement records. Their denial that records exist means no supporting enforcement documentation is available for this citation. This strengthens the due process argument in your contest letter.</p>' : ''}
                            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">No action needed from you — we handle everything automatically.</p>
                          </div>
                        </div>
                      `,
                    }),
                  });
                  console.log(`  User ${userEmail} notified of FOIA response`);
                }
              }
            }
          } catch (regenErr: any) {
            console.error('  Letter re-generation/notification failed:', regenErr.message);
          }

          // Notify admin
          try {
            if (process.env.RESEND_API_KEY) {
              const isDenial = foiaResult.action === 'foia_denial_recorded';
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: 'Autopilot America <alerts@autopilotamerica.com>',
                  to: ['randyvollrath@gmail.com'],
                  subject: `FOIA ${isDenial ? 'Denial' : 'Response'} — Ticket ${foiaResult.ticketNumber}`,
                  html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                      <div style="background: ${isDenial ? '#7C3AED' : '#2563EB'}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                        <h1 style="margin: 0; font-size: 20px;">${isDenial ? 'FOIA Denial Received' : 'FOIA Response Received'}</h1>
                      </div>
                      <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <p><strong>Ticket:</strong> ${foiaResult.ticketNumber}</p>
                        <p><strong>From:</strong> ${fromEmail}</p>
                        <p><strong>Subject:</strong> ${subject}</p>
                        <p><strong>Match Method:</strong> ${foiaResult.action}</p>
                        <p><strong>Attachments:</strong> ${attachments.length}</p>
                        <hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">
                        <p><strong>Body Preview:</strong></p>
                        <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 13px;">${text.substring(0, 500)}</div>
                      </div>
                    </div>
                  `,
                }),
              });
              console.log('  Admin notified of FOIA response');
            }
          } catch (adminNotifErr: any) {
            console.error('  Admin notification failed:', adminNotifErr.message);
          }

          return res.status(200).json({
            message: 'Evidence FOIA response processed',
            ...foiaResult,
          });
        }

        // ── Unmatched FOIA — already queued by processFoiaResponse ──
        if (!foiaResult.matched) {
          // Notify admin of unmatched FOIA
          try {
            if (process.env.RESEND_API_KEY) {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: 'Autopilot America <alerts@autopilotamerica.com>',
                  to: ['randyvollrath@gmail.com'],
                  subject: `FOIA Response — UNMATCHED (needs review)`,
                  html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                      <div style="background: #DC2626; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                        <h1 style="margin: 0; font-size: 20px;">Unmatched FOIA Response</h1>
                        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Could not match to any pending FOIA request — queued for manual review</p>
                      </div>
                      <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <p><strong>From:</strong> ${fromEmail}</p>
                        <p><strong>Subject:</strong> ${subject}</p>
                        <p><strong>Detected Type:</strong> ${foiaResult.foiaType}</p>
                        <p><strong>Attachments:</strong> ${attachments.length}</p>
                        <hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">
                        <p><strong>Body Preview:</strong></p>
                        <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 13px;">${text.substring(0, 500)}</div>
                      </div>
                    </div>
                  `,
                }),
              });
            }
          } catch (adminErr: any) {
            console.error('  Admin unmatched notification failed:', adminErr.message);
          }

          return res.status(200).json({
            message: 'FOIA response queued for admin review',
            ...foiaResult,
          });
        }
      } catch (foiaErr: any) {
        console.error('FOIA response processing failed:', foiaErr.message);
      }
    }

    // Check if this is an evidence reply (sent to evidence@autopilotamerica.com)
    const isEvidenceReply = toEmail.toLowerCase().includes('evidence@') ||
                            subject.toLowerCase().includes('evidence') ||
                            subject.toLowerCase().includes('parking ticket detected');

    // Find user by email - try auth.users first for autopilot users
    let matchedUserId: string | null = null;
    let matchedUserEmail: string | null = null;

    // Try to find in auth.users (for autopilot users) — paginate to avoid 50-user default limit
    let authUser: { id: string; email?: string } | undefined;
    {
      let page = 1;
      const perPage = 100;
      while (!authUser) {
        const { data: authPage } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (!authPage?.users?.length) break;
        authUser = authPage.users.find(u => u.email?.toLowerCase() === fromEmail.toLowerCase());
        if (authPage.users.length < perPage) break;
        page++;
      }
    }

    if (authUser) {
      matchedUserId = authUser.id;
      matchedUserEmail = authUser.email || null;
      console.log(`✅ Matched autopilot user: ${matchedUserEmail}`);
    }

    // Also check user_profiles as fallback
    const { data: users } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone, phone_number, home_address_full, license_plate')
      .eq('email', fromEmail);

    let matchedUser = users?.[0];
    if (matchedUser && !matchedUserId) {
      matchedUserId = matchedUser.user_id;
      matchedUserEmail = matchedUser.email;
      console.log(`✅ Matched user profile: ${matchedUserEmail}`);
    }

    if (!matchedUserId) {
      console.log(`⚠️  No user found for email: ${fromEmail}`);
    }

    // Handle evidence replies specially
    if (isEvidenceReply && matchedUserId) {
      console.log(`📋 Processing evidence reply from ${fromEmail}`);

      // Find the user's most recent pending_evidence ticket
      const { data: pendingTicket } = await supabaseAdmin
        .from('detected_tickets')
        .select('id, ticket_number, violation_type, evidence_requested_at')
        .eq('user_id', matchedUserId)
        .eq('status', 'pending_evidence')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (pendingTicket) {
        console.log(`🎫 Found pending ticket: ${pendingTicket.ticket_number}`);

        // Process and upload attachments
        const uploadedAttachments: { url: string; filename: string; content_type: string }[] = [];

        if (attachments.length > 0) {
          try {
            const { put } = await import('@vercel/blob');

            for (const attachment of attachments) {
              const filename = attachment.filename || `evidence-${Date.now()}`;
              const contentType = attachment.content_type || 'application/octet-stream';
              const buffer = Buffer.from(attachment.content, 'base64');

              const blobPath = `ticket-evidence/${matchedUserId}/${pendingTicket.id}/${Date.now()}-${filename}`;
              const blob = await put(blobPath, buffer, {
                access: 'private',
                contentType: contentType,
              });

              uploadedAttachments.push({
                url: blob.url,
                filename: filename,
                content_type: contentType,
              });

              console.log(`✅ Uploaded evidence file: ${filename}`);
            }
          } catch (uploadError) {
            console.error('❌ Error uploading evidence attachments:', uploadError);
          }
        }

        // Store the evidence
        let mailTriggered = false;
        const { data: evidenceRecord, error: evidenceError } = await supabaseAdmin
          .from('ticket_evidence')
          .insert({
            ticket_id: pendingTicket.id,
            user_id: matchedUserId,
            source: 'email_reply',
            evidence_text: text,
            attachments: uploadedAttachments,
          })
          .select()
          .single();

        if (evidenceError) {
          console.error('❌ Error saving evidence:', evidenceError);
        } else {
          console.log(`✅ Evidence saved: ${evidenceRecord.id}`);

          // Update ticket to show evidence was received
          await supabaseAdmin
            .from('detected_tickets')
            .update({
              evidence_deadline: new Date().toISOString(), // immediately eligible for same-day mailing
              evidence_received_at: new Date().toISOString(),
              evidence_on_time: pendingTicket?.evidence_deadline
                ? new Date().getTime() <= new Date(pendingTicket.evidence_deadline).getTime()
                : null,
              status: 'evidence_received',
            })
            .eq('id', pendingTicket.id);

          // Trigger immediate mailing run so evidence-backed letters can be mailed today
          const triggerResult = await triggerAutopilotMailRun({
            ticketId: pendingTicket.id,
            reason: 'evidence_received_resend_webhook',
          });
          console.log(`Mail trigger: ${triggerResult.message}`);
          mailTriggered = triggerResult.triggered;

          // Send admin notification about evidence received
          try {
            const evidenceNotifHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0; font-size: 20px;">📋 Evidence Received!</h1>
                </div>
                <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                  <p><strong>Ticket:</strong> ${pendingTicket.ticket_number}</p>
                  <p><strong>Violation Type:</strong> ${pendingTicket.violation_type}</p>
                  <p><strong>From:</strong> ${fromEmail}</p>
                  <p><strong>Attachments:</strong> ${uploadedAttachments.length} file(s)</p>
                  <hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">
                  <p><strong>User's Response:</strong></p>
                  <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${text}</div>
                </div>
              </div>
            `;

            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: ['randyvollrath@gmail.com'],
                subject: `📋 Evidence Received - Ticket ${pendingTicket.ticket_number}`,
                html: evidenceNotifHtml
              }),
            });
            console.log('✅ Admin notified of evidence');
          } catch (notifError) {
            console.error('Failed to send evidence notification:', notifError);
          }
        }

        // Return early for evidence replies
        return res.status(200).json({
          success: true,
          message: 'Evidence received and saved',
          ticket_number: pendingTicket.ticket_number,
          attachments_count: uploadedAttachments.length,
          mail_triggered: mailTriggered,
        });
      } else {
        console.log(`⚠️  No pending_evidence ticket found for user ${matchedUserId}`);
      }
    }

    // ── Auto-classify compliance documents from attachments ──
    if (matchedUserId && attachments.length > 0 && !isEvidenceReply) {
      for (const attachment of attachments) {
        const classification = classifyComplianceDocument(
          attachment.filename || '',
          subject,
          text,
        );
        if (classification.type !== 'unknown' && classification.confidence !== 'low') {
          console.log(`📄 Auto-classified compliance doc: ${classification.type} (${classification.confidence}) — ${classification.reason}`);
          try {
            const docResult = await processComplianceDocument(
              supabaseAdmin,
              matchedUserId,
              classification.type,
              {
                filename: attachment.filename || 'unknown',
                subject,
                extractedText: text.substring(0, 1000),
              },
            );
            console.log(`  Compliance doc result: ${docResult.action}`);
          } catch (docErr: any) {
            console.error(`  Compliance doc processing failed: ${docErr.message}`);
          }
        }
      }
    }

    // Check for "I AUTHORIZE" reply — grants contest consent via email
    const bodyTrimmed = text.replace(/[>\s\n\r]/g, ' ').trim();
    const isAuthorizeReply = /\bI\s+AUTHORIZE\b/i.test(bodyTrimmed);

    if (isAuthorizeReply && matchedUserId) {
      console.log(`✍️ "I AUTHORIZE" reply detected from ${fromEmail} — granting contest consent`);

      try {
        // Get user's name from profile for the signature
        const { data: consentProfile } = await supabaseAdmin
          .from('user_profiles')
          .select('first_name, last_name, contest_consent')
          .eq('user_id', matchedUserId)
          .single();

        if (consentProfile && !consentProfile.contest_consent) {
          const signatureName = `${consentProfile.first_name || ''} ${consentProfile.last_name || ''}`.trim() || fromEmail;

          await supabaseAdmin
            .from('user_profiles')
            .update({
              contest_consent: true,
              contest_consent_at: new Date().toISOString(),
              contest_consent_ip: 'email_reply',
              contest_consent_signature: `${signatureName} (via email reply)`,
            })
            .eq('user_id', matchedUserId);

          console.log(`✅ Contest consent granted via email for user ${matchedUserId} (signed as "${signatureName}")`);

          // Send confirmation email
          if (process.env.RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: [fromEmail],
                subject: 'Contest Authorization Confirmed',
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: #059669; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                      <h1 style="margin: 0; font-size: 20px;">Authorization Confirmed</h1>
                    </div>
                    <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                      <p>Hi ${consentProfile.first_name || 'there'},</p>
                      <p>We've received your authorization. We can now contest tickets on your behalf automatically.</p>
                      <p>Any pending contest letters that were waiting for your authorization will be processed in the next mailing run.</p>
                      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">You can revoke this authorization at any time in your <a href="https://autopilotamerica.com/settings" style="color: #059669;">account settings</a>.</p>
                    </div>
                  </div>
                `,
              }),
            });
            console.log('✅ Sent authorization confirmation email');
          }

          // Notify admin
          if (process.env.RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: ['randyvollrath@gmail.com'],
                subject: `✍️ Contest Consent Received — ${fromEmail}`,
                html: `<p><strong>${signatureName}</strong> (${fromEmail}) replied "I AUTHORIZE" to grant contest consent via email.</p>`,
              }),
            });
          }
        } else if (consentProfile?.contest_consent) {
          console.log(`ℹ️ User ${matchedUserId} already has contest consent — no update needed`);
        }
      } catch (consentError) {
        console.error('❌ Failed to process I AUTHORIZE reply:', consentError);
      }
    }

    // Check for keywords in the reply (for non-evidence emails)
    const bodyLower = text.toLowerCase();
    const subjectLower = subject.toLowerCase();
    const isYes = bodyLower.includes('yes') || bodyLower.includes('activate');
    const isInfo = bodyLower.includes('info') || bodyLower.includes('protection') || bodyLower.includes('details');
    const isPermitDocs = (bodyLower.includes('permit') || bodyLower.includes('document') ||
                         subjectLower.includes('permit') || subjectLower.includes('document')) &&
                        attachments.length > 0;

    // Idempotency: check if this email was already stored (webhook retry protection)
    const emailId = data.email_id || data.message_id || null;
    if (emailId) {
      const { count: existingEmailCount } = await supabaseAdmin
        .from('incoming_emails')
        .select('*', { count: 'exact', head: true })
        .eq('from_email', fromEmail)
        .eq('subject', subject)
        .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()); // within last 5 minutes

      if (existingEmailCount && existingEmailCount > 0) {
        console.log(`⏭️ Duplicate incoming email detected from ${fromEmail} — skipping`);
        return res.status(200).json({ success: true, message: 'Already processed (duplicate)' });
      }
    }

    // Store incoming email in database
    const { data: emailRecord, error: insertError } = await supabaseAdmin
      .from('incoming_emails')
      .insert({
        user_id: matchedUser?.user_id || null,
        from_email: fromEmail,
        subject: subject,
        body_text: text,
        body_html: html,
        matched_user_email: matchedUser?.email || null,
        contains_yes: isYes,
        contains_info: isInfo,
        processed: false,
        notification_sent: false
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error storing email:', insertError);
      return res.status(500).json({ error: 'Failed to store email' });
    }

    console.log('✅ Email stored in database:', emailRecord.id);

    // Handle permit zone document uploads
    if (isPermitDocs && matchedUser && attachments.length > 0) {
      console.log(`📄 Processing permit documents from ${fromEmail} (${attachments.length} files)`);

      try {
        // Process attachments and upload to Vercel Blob
        const { put } = await import('@vercel/blob');

        let idDocUrl = '';
        let idDocFilename = '';
        let residencyDocUrl = '';
        let residencyDocFilename = '';

        for (const attachment of attachments) {
          const filename = attachment.filename || 'document';
          const contentType = attachment.content_type || 'application/octet-stream';

          // Resend provides base64 encoded content
          const buffer = Buffer.from(attachment.content, 'base64');

          // Upload to Vercel Blob
          const timestamp = Date.now();
          const blobPath = `permit-docs/${matchedUser.user_id}/email-${timestamp}-${filename}`;

          const blob = await put(blobPath, buffer, {
            access: 'private', // SECURITY: Utility bills must be private
            contentType: contentType,
          });

          console.log(`✅ Uploaded ${filename} to blob storage`);

          // Assign to ID or residency doc (first file = ID, second = residency)
          if (!idDocUrl) {
            idDocUrl = blob.url;
            idDocFilename = filename;
          } else if (!residencyDocUrl) {
            residencyDocUrl = blob.url;
            residencyDocFilename = filename;
          }
        }

        // Save to permit_zone_documents table
        if (idDocUrl && residencyDocUrl) {
          const { data: permitDoc, error: permitError } = await supabaseAdmin
            .from('permit_zone_documents')
            .insert({
              user_id: matchedUser.user_id,
              id_document_url: idDocUrl,
              id_document_filename: idDocFilename,
              proof_of_residency_url: residencyDocUrl,
              proof_of_residency_filename: residencyDocFilename,
              address: matchedUser.home_address_full || '',
              verification_status: 'pending',
            })
            .select()
            .single();

          if (!permitError) {
            console.log(`✅ Permit documents saved for review: ${permitDoc.id}`);
          } else {
            console.error('❌ Error saving permit documents:', permitError);
          }
        } else {
          console.log(`⚠️  Need both ID and residency docs. Received ${attachments.length} attachments.`);
        }
      } catch (docError) {
        console.error('❌ Error processing permit documents:', docError);
      }
    }

    // Send notification email to you
    try {
      const actionNeeded = isPermitDocs ? '📄 PERMIT DOCUMENTS RECEIVED - Review in admin!' :
                          isYes ? '🟢 USER SAID YES - Send activation link!' :
                          isInfo ? '🔵 USER WANTS INFO - Send protection details!' :
                          '⚪ Reply received - Review needed';

      const emailSubject = `${actionNeeded} - Reply from ${fromEmail}`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">📧 Incoming Email Reply</h2>

          ${isYes ? `
            <div style="background: #dcfce7; border: 2px solid #16a34a; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0; color: #166534; font-weight: 600; font-size: 18px;">
                ✅ USER SAID YES! Send them the signup link:
              </p>
              <p style="margin: 12px 0 0 0;">
                <a href="https://autopilotamerica.com/start" style="color: #0052cc; font-weight: 600;">
                  https://autopilotamerica.com/start
                </a>
              </p>
            </div>
          ` : ''}

          ${isInfo ? `
            <div style="background: #dbeafe; border: 2px solid #2563eb; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0; color: #1e40af; font-weight: 600; font-size: 18px;">
                📋 USER WANTS INFO! Send them protection details:
              </p>
              <p style="margin: 12px 0 0 0;">
                <a href="https://ticketlessamerica.com/protection" style="color: #0052cc; font-weight: 600;">
                  https://ticketlessamerica.com/protection
                </a>
              </p>
            </div>
          ` : ''}

          ${isPermitDocs ? `
            <div style="background: #fef3c7; border: 2px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0; color: #92400e; font-weight: 600; font-size: 18px;">
                📄 PERMIT DOCUMENTS RECEIVED (${attachments.length} files)
              </p>
              <p style="margin: 12px 0 0 0; color: #78350f;">
                User sent permit zone documents via email. Review and approve/reject in admin panel:
              </p>
              <p style="margin: 12px 0 0 0;">
                <a href="https://ticketlessamerica.com/admin-permit-documents" style="color: #0052cc; font-weight: 600;">
                  Review Documents in Admin Panel
                </a>
              </p>
            </div>
          ` : ''}

          <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>From:</strong> ${fromEmail}</p>
            <p style="margin: 8px 0 0;"><strong>Subject:</strong> ${subject}</p>
            <p style="margin: 8px 0 0;"><strong>Message:</strong></p>
            <p style="background: white; padding: 12px; border-radius: 4px; margin: 8px 0 0; white-space: pre-wrap;">
              ${text || '(no text content)'}
            </p>
          </div>

          ${matchedUser ? `
            <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <h3 style="margin: 0 0 12px; color: #1e40af;">User Profile</h3>
              <p style="margin: 4px 0;"><strong>Email:</strong> ${matchedUser.email}</p>
              <p style="margin: 4px 0;"><strong>Phone:</strong> ${matchedUser.phone || matchedUser.phone_number || 'Not set'}</p>
              <p style="margin: 4px 0;"><strong>Address:</strong> ${matchedUser.home_address_full || 'Not set'}</p>
              <p style="margin: 4px 0;"><strong>License Plate:</strong> ${matchedUser.license_plate || 'Not set'}</p>
            </div>
          ` : `
            <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="color: #92400e; margin: 0;">
                ⚠️ <strong>Unknown user</strong> - No profile found matching this email address.
              </p>
            </div>
          `}

          <div style="text-align: center; margin: 24px 0;">
            <a href="mailto:${fromEmail}"
               style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              Reply to ${fromEmail}
            </a>
          </div>

          <div style="color: #6b7280; font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0;">Email ID: ${emailRecord.id}</p>
            <p style="margin: 4px 0 0;">Received: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `;

      // Add timeout to prevent webhook from hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: process.env.ADMIN_NOTIFICATION_EMAIL || 'hiautopilotamerica@gmail.com',
          subject: emailSubject,
          html: emailHtml
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (resendResponse.ok) {
        console.log('✅ Notification email sent to hiautopilotamerica@gmail.com');

        // Mark notification as sent
        await supabaseAdmin
          .from('incoming_emails')
          .update({ notification_sent: true })
          .eq('id', emailRecord.id);
      } else {
        const errorText = await resendResponse.text();
        console.error('❌ Failed to send notification email:', errorText);
      }
    } catch (emailError: any) {
      if (emailError.name === 'AbortError') {
        console.error('⏱️ Notification email send timed out');
      } else {
        console.error('Error sending notification email:', emailError);
      }
      // Don't fail the webhook if email fails
    }

    return res.status(200).json({
      success: true,
      message: 'Email received and processed',
      email_id: emailRecord.id,
      matched_user: matchedUser?.email || 'unknown',
      action_detected: isYes ? 'YES' : isInfo ? 'INFO' : 'none'
    });

  } catch (error: any) {
    console.error('❌ Error processing incoming email:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
