import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyWebhook } from '../../../lib/webhook-verification';

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
    bodyParser: true,
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
    const subject = data.subject || '(no subject)';
    const text = data.text || data.html || '';
    const html = data.html || '';
    const attachments = data.attachments || []; // Resend provides attachments array

    console.log(`📨 Email from ${fromEmail}: "${subject}"`);
    console.log(`📎 Attachments: ${attachments.length}`);

    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Find user by email
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone, phone_number, home_address_full, license_plate')
      .eq('email', fromEmail);

    let matchedUser = users?.[0];

    if (matchedUser) {
      console.log(`✅ Matched user: ${matchedUser.email}`);
    } else {
      console.log(`⚠️  No user found for email: ${fromEmail}`);
    }

    // Check for keywords in the reply
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

      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Autopilot America <noreply@autopilotamerica.com>',
          to: 'hiautopilotamerica@gmail.com',
          subject: emailSubject,
          html: emailHtml
        })
      });

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
    } catch (emailError) {
      console.error('Error sending notification email:', emailError);
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
      error: 'Internal server error',
      message: error.message
    });
  }
}
