import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyWebhook } from '../../../lib/webhook-verification';
import { maskPhone, maskEmail } from '../../../lib/mask-pii';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

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
 * 4. Set Webhook URL to: https://ticketlessamerica.com/api/webhooks/clicksend-incoming-sms?token=YOUR_SECRET_TOKEN
 * 5. Set Method to: POST
 * 6. Enable "Send raw data" if available
 * 7. Add CLICKSEND_WEBHOOK_SECRET to your .env file
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

  // SECURITY: Verify webhook signature/token
  if (!verifyWebhook('clicksend', req)) {
    console.error('⚠️ ClickSend webhook verification failed');
    return res.status(401).json({ error: 'Unauthorized - invalid token' });
  }

  console.log('📱 Incoming SMS webhook called (verified)');
  // SECURITY: Don't log full headers - they may contain sensitive tokens

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
      console.error('Invalid phone number format:', maskPhone(fromNumber));
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    console.log(`📨 SMS from ${maskPhone(fromNumber)}: "${messageBody.substring(0, 50)}..."`);

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

    console.log('Searching for user with phone variations:', phoneVariations.map(p => maskPhone(p)));

    // Find user by phone number
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone, phone_number, home_address_full, license_plate, vin, first_name')
      .or(phoneVariations.map(p => `phone.eq.${p},phone_number.eq.${p}`).join(','));

    let matchedUser = users?.[0];
    let matchedEmail = matchedUser?.email || null;
    let matchedUserId = matchedUser?.user_id || null;

    if (matchedUser) {
      console.log(`✅ Matched user: ${maskEmail(matchedEmail)}`);
    } else {
      console.log(`⚠️  No user found for phone: ${maskPhone(fromNumber)}`);
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

    const messageLower = messageBody.toLowerCase().trim();

    // Handle CONFIRM reply - mark profile as confirmed
    // RACE CONDITION FIX: Only confirm if not already confirmed for this year
    if (messageLower === 'confirm' && matchedUser) {
      const currentYear = new Date().getFullYear();

      // Find the right user to confirm - prioritize users with protection who haven't confirmed this year
      const { data: confirmUsers, error: confirmQueryError } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, email, first_name, profile_confirmed_at, profile_confirmed_for_year, has_contesting')
        .or(phoneVariations.map(p => `phone.eq.${p},phone_number.eq.${p}`).join(','))
        .eq('has_contesting', true)
        .neq('profile_confirmed_for_year', currentYear)
        .order('created_at', { ascending: false });

      if (confirmQueryError) {
        console.error('Error querying for confirm users:', confirmQueryError);
      }

      const confirmUser = confirmUsers?.[0];

      if (!confirmUser) {
        // No user needs confirmation - they're all already confirmed or don't have protection
        console.log(`⏭️ CONFIRM received but no users need confirmation for ${currentYear}`);
        try {
          const { sendClickSendSMS } = await import('../../../lib/sms-service');
          await sendClickSendSMS(fromNumber, "Your profile is already confirmed for this year. You're all set!");
          console.log('✅ Already-confirmed SMS sent');
        } catch (smsError) {
          console.error('Error sending already-confirmed SMS:', smsError);
        }
      } else {
        console.log(`✅ CONFIRM received - updating profile for ${maskEmail(confirmUser.email)}`);

        // Use atomic update with WHERE clause to prevent race condition
        const { data: updatedRows, error: confirmError } = await supabaseAdmin
          .from('user_profiles')
          .update({
            profile_confirmed_at: new Date().toISOString(),
            profile_confirmed_for_year: currentYear
          })
          .eq('user_id', confirmUser.user_id)
          .neq('profile_confirmed_for_year', currentYear) // Only update if not already confirmed this year
          .select();

        if (!confirmError && updatedRows && updatedRows.length > 0) {
          // Send confirmation SMS back
          try {
            const { sendClickSendSMS } = await import('../../../lib/sms-service');
            await sendClickSendSMS(fromNumber, "Thanks! Your profile has been confirmed. We'll process your renewal automatically when it's time.");
            console.log('✅ Confirmation SMS sent');
          } catch (smsError) {
            console.error('Error sending confirmation SMS:', smsError);
          }
        } else if (confirmError) {
          console.error('❌ Error updating profile_confirmed_at:', confirmError);
        } else {
          // No rows updated - likely another request already processed
          console.log('⏭️ CONFIRM: No rows updated (likely already processed by another request)');
        }
      }
    }

    // Handle DONE/EMISSIONS - mark emissions test as completed
    const isEmissionsComplete =
      messageLower.includes('emissions') ||
      messageLower === 'done' ||
      messageLower.includes('test done') ||
      messageLower.includes('passed');

    if (isEmissionsComplete && matchedUser) {
      console.log(`🚗 Emissions completion keyword detected from ${matchedEmail}`);

      // For emissions, we need to re-query to find the right user if there are duplicates
      // Find all users with this phone who have an emissions_date set
      const { data: emissionsUsers, error: emissionsQueryError } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, email, first_name, emissions_date, emissions_completed, phone_number')
        .or(phoneVariations.map(p => `phone.eq.${p},phone_number.eq.${p}`).join(','))
        .not('emissions_date', 'is', null)
        .eq('emissions_completed', false)
        .order('emissions_date', { ascending: true });

      if (emissionsQueryError) {
        console.error('Error querying emissions users:', emissionsQueryError);
      } else if (!emissionsUsers || emissionsUsers.length === 0) {
        console.log(`⚠️ No users with pending emissions found for phone: ${maskPhone(fromNumber)}`);
        try {
          const { sendClickSendSMS } = await import('../../../lib/sms-service');
          await sendClickSendSMS(
            fromNumber,
            `Autopilot: We don't have an emissions due date on file for you, or it's already been marked complete. Visit autopilotamerica.com/settings to check your profile.`
          );
        } catch (smsError) {
          console.error('Error sending SMS:', smsError);
        }
      } else {
        // Pick the user with the soonest emissions date
        const emissionsUser = emissionsUsers[0];
        console.log(`✅ Found user with pending emissions: ${maskEmail(emissionsUser.email)} (due: ${emissionsUser.emissions_date})`);

        const currentYear = new Date().getFullYear();
        const emissionsTestYear = currentYear;

        // RACE CONDITION FIX: Use atomic update with WHERE clause
        const { data: updatedRows, error: updateError } = await supabaseAdmin
          .from('user_profiles')
          .update({
            emissions_completed: true,
            emissions_completed_at: new Date().toISOString(),
            emissions_test_year: emissionsTestYear
          })
          .eq('user_id', emissionsUser.user_id)
          .eq('emissions_completed', false) // Only update if still false (prevents duplicates)
          .select();

        if (updateError) {
          console.error('❌ Error marking emissions complete:', updateError);
        } else if (updatedRows && updatedRows.length > 0) {
          console.log(`✅ Emissions marked complete for ${maskEmail(emissionsUser.email)} via SMS`);

          try {
            const { sendClickSendSMS } = await import('../../../lib/sms-service');
            await sendClickSendSMS(
              fromNumber,
              `Autopilot: Great news${emissionsUser.first_name ? `, ${emissionsUser.first_name}` : ''}! We've marked your emissions test as complete. Your license plate renewal can now proceed without any blocks. Thanks for letting us know!`
            );
          } catch (smsError) {
            console.error('Error sending confirmation SMS:', smsError);
          }
        } else {
          // No rows updated - already processed by another request
          console.log('⏭️ Emissions: No rows updated (likely already processed by another request)');
        }
      }
    }

    // Handle STOP/unsubscribe
    if (['stop', 'unsubscribe', 'cancel', 'quit'].includes(messageLower) && matchedUser) {
      console.log(`🛑 STOP received from ${maskEmail(matchedEmail)} - disabling SMS`);

      await supabaseAdmin
        .from('user_profiles')
        .update({ notify_sms: false })
        .eq('user_id', matchedUserId);

      try {
        const { sendClickSendSMS } = await import('../../../lib/sms-service');
        await sendClickSendSMS(fromNumber, "You've been unsubscribed from Autopilot SMS notifications. Reply START to re-enable.");
      } catch (smsError) {
        console.error('Error sending unsubscribe SMS:', smsError);
      }
    }

    // Handle START/resubscribe
    if (['start', 'subscribe'].includes(messageLower) && matchedUser) {
      console.log(`✅ START received from ${matchedEmail} - enabling SMS`);

      await supabaseAdmin
        .from('user_profiles')
        .update({ notify_sms: true })
        .eq('user_id', matchedUserId);

      try {
        const { sendClickSendSMS } = await import('../../../lib/sms-service');
        await sendClickSendSMS(fromNumber, "You've been re-subscribed to Autopilot SMS notifications.");
      } catch (smsError) {
        console.error('Error sending resubscribe SMS:', smsError);
      }
    }

    // Handle YES - sticker applied confirmation
    if (['yes', 'y', 'applied'].includes(messageLower) && matchedUser) {
      console.log(`🏷️ Sticker applied confirmation from ${matchedEmail}`);

      // Find their most recent completed order awaiting sticker confirmation
      const { data: order, error: orderError } = await supabaseAdmin
        .from('renewal_orders')
        .select('id, order_number, sticker_type')
        .eq('customer_email', matchedUser.email)
        .eq('status', 'completed')
        .eq('sticker_applied', false)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (orderError) {
        console.error('Error finding order:', orderError);
      } else if (!order) {
        // No pending sticker confirmation
        console.log(`⚠️ No pending sticker confirmation for ${maskEmail(matchedEmail)}`);
        try {
          const { sendClickSendSMS } = await import('../../../lib/sms-service');
          await sendClickSendSMS(fromNumber, "Thanks for the message! We don't have any pending sticker confirmations for you right now.");
        } catch (smsError) {
          console.error('Error sending SMS:', smsError);
        }
      } else {
        // RACE CONDITION FIX: Use atomic update with WHERE clause
        const { data: updatedRows, error: updateError } = await supabaseAdmin
          .from('renewal_orders')
          .update({
            sticker_applied: true,
            sticker_applied_at: new Date().toISOString(),
            needs_manual_followup: false
          })
          .eq('id', order.id)
          .eq('sticker_applied', false) // Only update if not already applied
          .select();

        if (updateError) {
          console.error('Error marking sticker applied:', updateError);
        } else if (updatedRows && updatedRows.length > 0) {
          const isLicensePlate = ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase());
          const stickerType = isLicensePlate ? 'license plate sticker' : 'city sticker';

          console.log(`✅ Sticker marked as applied for order ${order.order_number}`);

          try {
            const { sendClickSendSMS } = await import('../../../lib/sms-service');
            const firstName = matchedUser.first_name || matchedUser.email?.split('@')[0];
            await sendClickSendSMS(
              fromNumber,
              `Autopilot: Awesome${firstName ? `, ${firstName}` : ''}! Your ${stickerType} is all set. You're good to go - no more reminders from us about this one. Drive safe!`
            );
          } catch (smsError) {
            console.error('Error sending confirmation SMS:', smsError);
          }
        } else {
          // No rows updated - already processed
          console.log('⏭️ Sticker applied: No rows updated (likely already processed by another request)');
        }
      }
    }

    // Handle permit zone document uploads via MMS
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
          // Download the MMS image from ClickSend with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

          let response: Response;
          try {
            response = await fetch(mediaUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
          } catch (fetchError: any) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
              console.error(`⏱️ Media download timed out: ${mediaUrl}`);
            } else {
              console.error(`Failed to download media: ${mediaUrl}`, fetchError.message);
            }
            continue;
          }

          if (!response.ok) {
            console.error(`Failed to download media: ${mediaUrl} (${response.status})`);
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
            access: 'private', // SECURITY: ID documents must be private
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
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || 'hiautopilotamerica@gmail.com',
          subject: emailSubject,
          html: emailHtml
        })
      });

      if (resendResponse.ok) {
        console.log('✅ Email notification sent for incoming SMS');

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
      error: sanitizeErrorMessage(error)
    });
  }
}
