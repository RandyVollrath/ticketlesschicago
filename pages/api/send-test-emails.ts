import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { notificationService } from '../../lib/notifications';
import { sanitizeErrorMessage } from '../../lib/error-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
          subject: '🎉 Welcome to TicketLess Chicago - Your Account is Ready!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #0066cc; color: white; padding: 20px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">🎉 Welcome to TicketLess Chicago!</h1>
              </div>
              
              <div style="padding: 20px; background: #f9f9f9;">
                <h2 style="color: #333;">Your account is confirmed and ready!</h2>
                <p style="font-size: 16px; color: #666;">
                  Thank you for joining TicketLess Chicago. We'll help you stay on top of your vehicle renewals — peace of mind parking, always.
                </p>
                
                <div style="background: #e3f2fd; border-left: 4px solid #0066cc; padding: 15px; margin: 15px 0;">
                  <h3 style="color: #0066cc; margin-top: 0;">What's Next?</h3>
                  <ul style="color: #333;">
                    <li>We'll monitor your renewal dates automatically</li>
                    <li>You'll receive timely reminders before each deadline</li>
                    <li>Access your dashboard anytime to update preferences</li>
                  </ul>
                </div>
                
                <p><strong>Email:</strong> ${user.email}<br>
                <strong>Account Created:</strong> ${new Date(user.created_at).toLocaleDateString()}<br>
                <strong>Status:</strong> ✅ Verified & Active</p>
                
                <div style="text-align: center; margin: 20px 0;">
                  <a href="https://ticketlessamerica.com/dashboard" 
                     style="background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    View Your Dashboard
                  </a>
                </div>
              </div>
              
              <div style="padding: 15px; background: #eee; text-align: center; color: #666; font-size: 12px;">
                TicketLess Chicago - Keeping Chicago drivers compliant<br>
                Need help? Reply to this email or visit our dashboard.
              </div>
            </div>
          `,
          text: `Welcome to TicketLess Chicago!

Your account is confirmed and ready!

Thank you for joining TicketLess Chicago. We'll help you stay on top of your vehicle renewals — peace of mind parking, always.

What's Next?
- We'll monitor your renewal dates automatically
- You'll receive timely reminders before each deadline  
- Access your dashboard anytime to update preferences

Email: ${user.email}
Account Created: ${new Date(user.created_at).toLocaleDateString()}
Status: ✅ Verified & Active

View your dashboard: https://ticketlessamerica.com/dashboard

TicketLess Chicago - Keeping Chicago drivers compliant`
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