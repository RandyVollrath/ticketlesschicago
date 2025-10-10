import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

/**
 * ClickSend Incoming SMS Webhook
 *
 * This endpoint receives incoming SMS messages from ClickSend when users reply to our texts.
 * It stores the message, matches it to a user, and sends an email notification.
 *
 * Setup Instructions:
 * 1. Go to ClickSend Dashboard: https://dashboard.clicksend.com
 * 2. Navigate to: SMS > Settings > Inbound SMS Rules
 * 3. Add a new rule for your SMS number
 * 4. Set Webhook URL to: https://ticketlessamerica.com/api/webhooks/clicksend-incoming-sms
 * 5. Set Method to: POST
 * 6. Enable "Send raw data" if available
 */

// Disable body parsing so we can handle both JSON and form data
export const config = {
  api: {
    bodyParser: true, // Next.js will parse both JSON and form data automatically
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('📱 Incoming SMS webhook called');
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  try {
    // ClickSend sends data in different formats depending on configuration
    // Standard format: { from: '+12223334444', body: 'message text', message_id: '...' }
    // Form data format: from=...&body=...&message_id=...

    const data = req.body;
    let fromNumber = data.from || data.source;
    let messageBody = data.body || data.message || '';
    let messageId = data.message_id || data.messageId;
    // ClickSend MMS attachments come in media_file field (array or single URL)
    let mediaFiles = data.media_file ? (Array.isArray(data.media_file) ? data.media_file : [data.media_file]) : [];

    if (!fromNumber) {
      console.error('Missing from number:', { fromNumber });
      return res.status(400).json({ error: 'Missing from number' });
    }

    console.log(`📎 MMS attachments: ${mediaFiles.length}`);

    // SECURITY: Sanitize inputs to prevent any malicious content
    // We only store these as TEXT - Supabase uses parameterized queries so SQL injection is not possible
    // But we'll validate and truncate to be safe
    fromNumber = String(fromNumber).substring(0, 20); // Phone numbers are max 15 digits
    messageBody = String(messageBody).substring(0, 1000); // Reasonable SMS length limit
    messageId = messageId ? String(messageId).substring(0, 100) : null;

    // Validate phone number format (basic check)
    if (!/^[\+\d\s\-\(\)]+$/.test(fromNumber)) {
      console.error('Invalid phone number format:', fromNumber);
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    console.log(`📨 SMS from ${fromNumber}: "${messageBody}"`);

    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Normalize phone number for matching (remove +1, spaces, dashes)
    const normalizedPhone = fromNumber.replace(/[\s\-\(\)]/g, '');
    const phoneVariations = [
      normalizedPhone,
      `+${normalizedPhone}`,
      `+1${normalizedPhone.replace(/^\+?1/, '')}`,
      normalizedPhone.replace(/^\+?1/, '')
    ];

    console.log('Searching for user with phone variations:', phoneVariations);

    // Find user by phone number
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone, phone_number, home_address_full, license_plate, vin')
      .or(phoneVariations.map(p => `phone.eq.${p},phone_number.eq.${p}`).join(','));

    let matchedUser = users?.[0];
    let matchedEmail = matchedUser?.email || null;
    let matchedUserId = matchedUser?.user_id || null;

    if (matchedUser) {
      console.log(`✅ Matched user: ${matchedEmail}`);
    } else {
      console.log(`⚠️  No user found for phone: ${fromNumber}`);
    }

    // Store incoming SMS in database
    const { data: smsRecord, error: insertError } = await supabaseAdmin
      .from('incoming_sms')
      .insert({
        user_id: matchedUserId,
        from_number: fromNumber,
        message_body: messageBody,
        clicksend_message_id: messageId,
        clicksend_data: data,
        matched_user_email: matchedEmail,
        processed: false,
        email_sent: false
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error storing SMS:', insertError);
      return res.status(500).json({ error: 'Failed to store SMS' });
    }

    console.log('✅ SMS stored in database:', smsRecord.id);

    // Handle permit zone document uploads via MMS
    const messageLower = messageBody.toLowerCase();
    const isPermitDocs = (messageLower.includes('permit') || messageLower.includes('document') ||
                         messageLower.includes('id') || messageLower.includes('license') ||
                         messageLower.includes('residency') || mediaFiles.length > 0) &&
                        mediaFiles.length > 0;

    if (isPermitDocs && matchedUser && mediaFiles.length > 0) {
      console.log(`📄 Processing permit documents from ${fromNumber} (${mediaFiles.length} files)`);

      try {
        const { put } = await import('@vercel/blob');

        let idDocUrl = '';
        let idDocFilename = '';
        let residencyDocUrl = '';
        let residencyDocFilename = '';

        for (const mediaUrl of mediaFiles) {
          // Download the MMS image from ClickSend
          const response = await fetch(mediaUrl);
          if (!response.ok) {
            console.error(`Failed to download media: ${mediaUrl}`);
            continue;
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get('content-type') || 'image/jpeg';

          // Extract filename from URL or use default
          const urlParts = mediaUrl.split('/');
          const filename = urlParts[urlParts.length - 1] || `sms-image-${Date.now()}.jpg`;

          // Upload to Vercel Blob
          const timestamp = Date.now();
          const blobPath = `permit-docs/${matchedUserId}/sms-${timestamp}-${filename}`;

          const blob = await put(blobPath, buffer, {
            access: 'public',
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
              user_id: matchedUserId,
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

            // Send confirmation SMS to user
            const confirmMessage = 'Thanks! We received your permit zone documents and they are being reviewed. You\'ll hear from us within 1-2 business days.';

            try {
              const { sendClickSendSMS } = await import('../../../lib/sms-service');
              await sendClickSendSMS(fromNumber, confirmMessage);
            } catch (smsError) {
              console.error('Error sending confirmation SMS:', smsError);
            }
          } else {
            console.error('❌ Error saving permit documents:', permitError);
          }
        } else if (mediaFiles.length === 1) {
          // Only one file sent - ask for the other
          const askMessage = 'Thanks! We received 1 document. Please send one more (we need both your ID and proof of residency).';
          try {
            const { sendClickSendSMS } = await import('../../../lib/sms-service');
            await sendClickSendSMS(fromNumber, askMessage);
          } catch (smsError) {
            console.error('Error sending SMS:', smsError);
          }
        }
      } catch (docError) {
        console.error('❌ Error processing permit documents:', docError);
      }
    }

    // Send email notification to ticketlessamerica@gmail.com
    try {
      const emailSubject = isPermitDocs
        ? `📄 PERMIT DOCUMENTS via SMS from ${matchedEmail || fromNumber}`
        : matchedUser
          ? `Profile Update Request from ${matchedEmail}`
          : `SMS Reply from Unknown Number: ${fromNumber}`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">📱 Incoming SMS ${isPermitDocs ? '- PERMIT DOCUMENTS' : 'Reply'}</h2>

          ${isPermitDocs ? `
            <div style="background: #fef3c7; border: 2px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0; color: #92400e; font-weight: 600; font-size: 18px;">
                📄 PERMIT DOCUMENTS RECEIVED (${mediaFiles.length} files)
              </p>
              <p style="margin: 12px 0 0 0;">
                <a href="https://ticketlessamerica.com/admin-permit-documents" style="color: #0052cc; font-weight: 600;">
                  Review Documents in Admin Panel
                </a>
              </p>
            </div>
          ` : ''}

          <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>From:</strong> ${fromNumber}</p>
            <p style="margin: 8px 0 0;"><strong>Message:</strong></p>
            <p style="background: white; padding: 12px; border-radius: 4px; margin: 8px 0 0;">
              ${messageBody || '(MMS with no text)'}
            </p>
            ${mediaFiles.length > 0 ? `
              <p style="margin: 12px 0 0;"><strong>Media Files:</strong> ${mediaFiles.length}</p>
            ` : ''}
          </div>

          ${matchedUser ? `
            <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <h3 style="margin: 0 0 12px; color: #1e40af;">User Profile</h3>
              <p style="margin: 4px 0;"><strong>Email:</strong> ${matchedUser.email}</p>
              <p style="margin: 4px 0;"><strong>Phone:</strong> ${matchedUser.phone || matchedUser.phone_number}</p>
              <p style="margin: 4px 0;"><strong>Address:</strong> ${matchedUser.home_address_full || 'Not set'}</p>
              <p style="margin: 4px 0;"><strong>License Plate:</strong> ${matchedUser.license_plate || 'Not set'}</p>
              <p style="margin: 4px 0;"><strong>VIN:</strong> ${matchedUser.vin || 'Not set'}</p>
            </div>

            <div style="text-align: center; margin: 24px 0;">
              <a href="https://ticketlessamerica.com/admin/profile-updates"
                 style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
                Update Profile in Admin Panel
              </a>
            </div>
          ` : `
            <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="color: #92400e; margin: 0;">
                ⚠️ <strong>Unknown user</strong> - No profile found matching this phone number.
              </p>
            </div>
          `}

          <div style="color: #6b7280; font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0;">SMS ID: ${smsRecord.id}</p>
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
          from: 'Ticketless America <noreply@ticketlessamerica.com>',
          to: 'ticketlessamerica@gmail.com',
          subject: emailSubject,
          html: emailHtml
        })
      });

      if (resendResponse.ok) {
        console.log('✅ Email notification sent to ticketlessamerica@gmail.com');

        // Mark email as sent
        await supabaseAdmin
          .from('incoming_sms')
          .update({ email_sent: true })
          .eq('id', smsRecord.id);
      } else {
        const errorText = await resendResponse.text();
        console.error('❌ Failed to send email:', errorText);
      }
    } catch (emailError) {
      console.error('Error sending email notification:', emailError);
      // Don't fail the webhook if email fails
    }

    return res.status(200).json({
      success: true,
      message: 'SMS received and processed',
      sms_id: smsRecord.id,
      matched_user: matchedEmail || 'unknown'
    });

  } catch (error: any) {
    console.error('❌ Error processing incoming SMS:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
