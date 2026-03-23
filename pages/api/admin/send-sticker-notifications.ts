import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { quickEmail, greeting as greet, p, callout, section, button, divider, bulletList, steps, esc } from '../../../lib/email-template';

interface UserNotification {
  user_id: string;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  license_plate: string;
}

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { users, stickerTypes } = req.body as {
      users: UserNotification[];
      stickerTypes: string[];
    };

    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'No users provided' });
    }

    if (!stickerTypes || !Array.isArray(stickerTypes) || stickerTypes.length === 0) {
      return res.status(400).json({ error: 'No sticker types provided' });
    }

    let emailsSent = 0;
    let smsSent = 0;
    const errors: string[] = [];

    // Process each user
    for (const user of users) {
      try {
        // Generate sticker type list
        const stickerList = stickerTypes.map(type => {
          if (type === 'city_sticker') return 'City Sticker';
          if (type === 'license_plate') return 'License Plate Sticker';
          return type;
        });

        const stickerText = stickerList.length === 1
          ? stickerList[0]
          : `${stickerList.slice(0, -1).join(', ')} and ${stickerList[stickerList.length - 1]}`;

        // Email notification
        const safeName = esc(user.first_name || 'there');
        const safePlate = esc(user.license_plate);
        const safeStickerText = esc(stickerText);
        const emailHtml = quickEmail({
          preheader: `Your ${stickerText} for ${user.license_plate} is in the mail!`,
          headerTitle: 'Stickers On The Way!',
          headerSubtitle: `For vehicle ${safePlate}`,
          body: [
            callout('success', `Good news, ${safeName}!`,
              `We've purchased your <strong>${safeStickerText}</strong> for vehicle <strong>${safePlate}</strong> and they're in the mail!`),
            section('What to Expect', bulletList([
              'Your stickers will arrive at your registered address within 7-10 business days',
              'They\'ll come in a standard envelope from the City of Chicago',
              'Installation instructions will be included',
            ]), { bg: '#EFF6FF', borderColor: '#BFDBFE' }),
            section('When Your Stickers Arrive', steps([
              'Clean the windshield area where you\'ll place the sticker',
              'Carefully peel and apply the sticker',
              'Press firmly to ensure proper adhesion',
              'You\'re all set — stay compliant and ticket-free!',
            ])),
            button('View Your Dashboard', 'https://autopilotamerica.com/dashboard'),
          ].join(''),
        });

        const emailText = `
Good News, ${user.first_name}!

We've purchased your ${stickerText} for vehicle ${user.license_plate} and they're in the mail!

What to Expect:
- Your stickers will arrive at your registered address within 7-10 business days
- They'll come in a standard envelope from the City of Chicago
- Installation instructions will be included

When Your Stickers Arrive:
1. Clean the windshield area where you'll place the sticker
2. Carefully peel and apply the sticker
3. Press firmly to ensure proper adhesion
4. You're all set - stay compliant and ticket-free!

View your dashboard: https://autopilotamerica.com/dashboard

Questions or concerns? Contact us at support@autopilotamerica.com

Best regards,
Autopilot America Team
        `;

        // SMS notification
        const smsMessage = `Autopilot America: Good news! Your ${stickerText} for plate ${user.license_plate} has been purchased and is in the mail. Expect delivery in 7-10 business days. Questions? Reply or email support@autopilotamerica.com`;

        // Send email
        try {
          const emailSent = await notificationService.sendEmail({
            to: user.email,
            subject: `Your ${stickerText} ${stickerList.length > 1 ? 'are' : 'is'} on the way!`,
            html: emailHtml,
            text: emailText
          });

          if (emailSent) {
            emailsSent++;
          } else {
            errors.push(`Failed to send email to ${user.email}`);
          }
        } catch (emailError) {
          console.error(`Error sending email to ${user.email}:`, emailError);
          errors.push(`Error sending email to ${user.email}: ${emailError}`);
        }

        // Send SMS
        if (user.phone) {
          try {
            const smsSentResult = await notificationService.sendSMS({
              to: user.phone,
              message: smsMessage
            });

            if (smsSentResult) {
              smsSent++;
            } else {
              errors.push(`Failed to send SMS to ${user.phone}`);
            }
          } catch (smsError) {
            console.error(`Error sending SMS to ${user.phone}:`, smsError);
            errors.push(`Error sending SMS to ${user.phone}: ${smsError}`);
          }
        }

        // Log individual sticker notifications
        try {
          for (const stickerType of stickerTypes) {
            await supabaseAdmin.from('sticker_notifications').insert({
              user_id: user.user_id,
              sticker_type: stickerType,
              license_plate: user.license_plate,
              sent_by: user.email,
              sent_at: new Date().toISOString()
            });
          }
        } catch (logError) {
          console.error('Error logging sticker notification:', logError);
          // Don't fail the whole operation if logging fails
        }

      } catch (userError) {
        console.error(`Error processing user ${user.email}:`, userError);
        errors.push(`Error processing user ${user.email}: ${userError}`);
      }
    }

    return res.status(200).json({
      success: true,
      emailsSent,
      smsSent,
      totalUsers: users.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error in send-sticker-notifications:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
