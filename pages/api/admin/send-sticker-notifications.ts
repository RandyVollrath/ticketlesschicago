import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';

const ADMIN_EMAILS = ['randyvollrath@gmail.com', 'carenvollrath@gmail.com'];

interface UserNotification {
  user_id: string;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  license_plate: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user is an admin
    if (!ADMIN_EMAILS.includes(user.email || '')) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

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
        const emailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
            <!-- Header -->
            <div style="background: #10b981; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 600;">📬 Stickers On The Way!</h1>
            </div>

            <!-- Main Content -->
            <div style="padding: 32px 24px; background: #ffffff;">
              <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
                <h2 style="margin: 0 0 12px; color: #065f46; font-size: 20px;">Good News, ${user.first_name}!</h2>
                <p style="color: #065f46; font-size: 16px; line-height: 1.6; margin: 0;">
                  We've purchased your <strong>${stickerText}</strong> for vehicle <strong>${user.license_plate}</strong> and they're in the mail!
                </p>
              </div>

              <!-- What to Expect -->
              <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">What to Expect:</h3>
                <ul style="color: #0369a1; margin: 0; padding-left: 20px; line-height: 1.8;">
                  <li>Your stickers will arrive at your registered address within 7-10 business days</li>
                  <li>They'll come in a standard envelope from the City of Chicago</li>
                  <li>Installation instructions will be included</li>
                </ul>
              </div>

              <!-- Next Steps -->
              <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #92400e; margin: 0 0 12px; font-size: 18px;">📋 When Your Stickers Arrive:</h3>
                <ol style="color: #92400e; margin: 0; padding-left: 20px; line-height: 1.8;">
                  <li>Clean the windshield area where you'll place the sticker</li>
                  <li>Carefully peel and apply the sticker</li>
                  <li>Press firmly to ensure proper adhesion</li>
                  <li>You're all set - stay compliant and ticket-free!</li>
                </ol>
              </div>

              <!-- Dashboard Link -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="https://ticketlessamerica.com/dashboard"
                   style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                  View Your Dashboard
                </a>
              </div>

              <!-- Support Message -->
              <div style="text-align: center; color: #6b7280; margin: 24px 0; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0 0 8px;">Questions or concerns?</p>
                <p style="margin: 0;">Contact us at <a href="mailto:support@ticketlessamerica.com" style="color: #2563eb; text-decoration: none;">support@ticketlessamerica.com</a></p>
              </div>
            </div>

            <!-- Footer -->
            <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
              <div style="margin-bottom: 12px;">
                <strong style="color: #374151;">Ticketless America</strong><br>
                Your trusted vehicle compliance partner
              </div>
              <div>
                <a href="https://ticketlessamerica.com/dashboard" style="color: #6b7280; margin: 0 8px; text-decoration: none;">Dashboard</a> |
                <a href="https://ticketlessamerica.com/support" style="color: #6b7280; margin: 0 8px; text-decoration: none;">Support</a>
              </div>
            </div>
          </div>
        `;

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

View your dashboard: https://ticketlessamerica.com/dashboard

Questions or concerns? Contact us at support@ticketlessamerica.com

Best regards,
Ticketless America Team
        `;

        // SMS notification
        const smsMessage = `Ticketless: Good news! Your ${stickerText} for plate ${user.license_plate} has been purchased and is in the mail. Expect delivery in 7-10 business days. Questions? Reply or email support@ticketlessamerica.com - Ticketless America`;

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
}
