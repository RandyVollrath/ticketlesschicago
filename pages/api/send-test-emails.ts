import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { notificationService } from '../../lib/notifications';
import { sanitizeErrorMessage } from '../../lib/error-utils';
import { quickEmail, p, section, button, bulletList } from '../../lib/email-template';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: require CRON_SECRET to prevent unauthorized mass email sends
  const authHeader = req.headers.authorization;
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Supabase admin client not available' });
    }

    // Get all auth users
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError || !authData) {
      return res.status(500).json({ error: 'Failed to fetch users', details: authError });
    }

    const results = {
      totalUsers: authData.users.length,
      emailsSent: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Send welcome/verification email to each user
    for (const user of authData.users) {
      if (!user.email) continue;

      try {
        const emailContent = {
          to: user.email,
          subject: 'Welcome to Autopilot America — Your Account is Ready!',
          html: quickEmail({
            preheader: 'Your account is confirmed and ready — Peace of Mind Parking, always.',
            headerTitle: 'Welcome to Autopilot America!',
            headerSubtitle: 'Your account is confirmed and ready',
            body: [
              p('Thank you for joining Autopilot America. We\'ll help you stay on top of your vehicle renewals — <strong>Peace of Mind Parking, always.</strong>'),
              section('What\'s Next?', bulletList([
                'We\'ll monitor your renewal dates automatically',
                'You\'ll receive timely reminders before each deadline',
                'Access your dashboard anytime to update preferences',
              ])),
              p(`<strong>Email:</strong> ${user.email}<br><strong>Account Created:</strong> ${new Date(user.created_at).toLocaleDateString()}<br><strong>Status:</strong> Verified &amp; Active`),
              button('View Your Dashboard', 'https://autopilotamerica.com/dashboard'),
            ].join(''),
          }),
          text: `Welcome to Autopilot America!

Your account is confirmed and ready!

Thank you for joining Autopilot America. We'll help you stay on top of your vehicle renewals — Peace of Mind Parking, always.

What's Next?
- We'll monitor your renewal dates automatically
- You'll receive timely reminders before each deadline
- Access your dashboard anytime to update preferences

Email: ${user.email}
Account Created: ${new Date(user.created_at).toLocaleDateString()}
Status: Verified & Active

View your dashboard: https://autopilotamerica.com/dashboard

Autopilot America - Peace of Mind Parking`
        };

        const success = await notificationService.sendEmail(emailContent);
        
        if (success) {
          results.emailsSent++;
          console.log(`✅ Welcome email sent to ${user.email}`);
        } else {
          results.failed++;
          results.errors.push(`Failed to send email to ${user.email}`);
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push(`Error sending email to ${user.email}: ${sanitizeErrorMessage(error)}`);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Sent ${results.emailsSent} welcome emails, ${results.failed} failed`,
      results
    });

  } catch (error: any) {
    console.error('Send test emails error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}