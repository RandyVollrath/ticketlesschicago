import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyWebhook } from '../../../lib/webhook-verification';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { triggerAutopilotMailRun } from '../../../lib/trigger-autopilot-mail';

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
  console.log('Body:', JSON.stringify(req.body, null, 2));

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

    // Check if this is an evidence reply (sent to evidence@autopilotamerica.com)
    const isEvidenceReply = toEmail.toLowerCase().includes('evidence@') ||
                            subject.toLowerCase().includes('evidence') ||
                            subject.toLowerCase().includes('parking ticket detected');

    // Find user by email - try auth.users first for autopilot users
    let matchedUserId: string | null = null;
    let matchedUserEmail: string | null = null;

    // Try to find in auth.users (for autopilot users)
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = authUsers?.users?.find(u => u.email?.toLowerCase() === fromEmail.toLowerCase());

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
                ✅ USER SAID YES! Send them the activation link:
              </p>
              <p style="margin: 12px 0 0 0;">
                <a href="https://ticketlessamerica.com/alerts/signup" style="color: #0052cc; font-weight: 600;">
                  https://ticketlessamerica.com/alerts/signup
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
