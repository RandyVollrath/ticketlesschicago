import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    console.log('📧 Generating magic link for:', email);
    
    const { data: linkData, error: magicLinkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
      }
    });

    if (magicLinkError) {
      console.error('Error generating magic link:', magicLinkError);
      return res.status(500).json({ error: magicLinkError.message });
    }

    if (!linkData?.properties?.action_link) {
      return res.status(500).json({ error: 'No action link generated' });
    }

    console.log('✅ Magic link generated:', linkData.properties.action_link);

    // Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <noreply@ticketlessamerica.com>',
        to: email,
        subject: 'Sign in to Autopilot America',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a; margin-bottom: 16px;">Sign in to Autopilot America</h2>

            <p style="color: #374151; font-size: 16px; line-height: 1.6;">
              Click the button below to access your account:
            </p>

            <div style="margin: 32px 0; text-align: center;">
              <a href="${linkData.properties.action_link}"
                 style="background-color: #0052cc;
                        color: white;
                        padding: 14px 32px;
                        text-decoration: none;
                        border-radius: 8px;
                        font-weight: 600;
                        font-size: 16px;
                        display: inline-block;">
                Sign In to Your Account
              </a>
            </div>

            <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes for security reasons.</p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

            <p style="color: #9ca3af; font-size: 13px;">
              Questions? Email us at <a href="mailto:support@ticketlessamerica.com" style="color: #0052cc;">support@ticketlessamerica.com</a>
            </p>
          </div>
        `
      })
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend error:', resendData);
      return res.status(500).json({ 
        error: 'Failed to send email',
        details: resendData
      });
    }

    console.log('✅ Email sent via Resend:', resendData);

    return res.status(200).json({
      success: true,
      message: 'Magic link sent',
      resendId: resendData.id,
      magicLink: linkData.properties.action_link
    });

  } catch (error: any) {
    console.error('Error sending magic link:', error);
    return res.status(500).json({ error: error.message });
  }
}
