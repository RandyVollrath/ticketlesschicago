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
    const fromNumber = data.from || data.source;
    const messageBody = data.body || data.message;
    const messageId = data.message_id || data.messageId;

    if (!fromNumber || !messageBody) {
      console.error('Missing required fields:', { fromNumber, messageBody });
      return res.status(400).json({ error: 'Missing from or body' });
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

    // Send email notification to mystreetcleaning@gmail.com
    try {
      const emailSubject = matchedUser
        ? `Profile Update Request from ${matchedEmail}`
        : `SMS Reply from Unknown Number: ${fromNumber}`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">📱 Incoming SMS Reply</h2>

          <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>From:</strong> ${fromNumber}</p>
            <p style="margin: 8px 0 0;"><strong>Message:</strong></p>
            <p style="background: white; padding: 12px; border-radius: 4px; margin: 8px 0 0;">
              ${messageBody}
            </p>
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
          to: 'mystreetcleaning@gmail.com',
          subject: emailSubject,
          html: emailHtml
        })
      });

      if (resendResponse.ok) {
        console.log('✅ Email notification sent to mystreetcleaning@gmail.com');

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
