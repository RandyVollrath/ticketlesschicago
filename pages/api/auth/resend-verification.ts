import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { checkRateLimit, checkEmailRateLimit, recordRateLimitAction, recordMagicLinkRequest, getClientIP } from '../../../lib/rate-limiter';
import { maskEmail } from '../../../lib/mask-pii';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  // SECURITY: Rate limiting by IP
  const ip = getClientIP(req);
  const ipRateLimitResult = await checkRateLimit(ip, 'auth');

  res.setHeader('X-RateLimit-Limit', ipRateLimitResult.limit);
  res.setHeader('X-RateLimit-Remaining', ipRateLimitResult.remaining);

  if (!ipRateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Too many verification attempts. Please try again later.',
    });
  }

  // SECURITY: Rate limiting by email (prevents email bombing)
  const emailRateLimitResult = await checkEmailRateLimit(email);
  if (!emailRateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Too many verification emails sent. Please try again later.',
    });
  }

  if (!supabaseAdmin) {
    console.error('Supabase admin client not available');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    console.log('📧 Resending verification email to:', maskEmail(email));

    // Generate verification link (use magiclink since user already exists)
    const { data: verifyData, error: verifyError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/settings?verified=true`
      }
    });

    if (verifyError) {
      console.error('Error generating verification link:', verifyError);
      return res.status(500).json({ error: 'Failed to generate verification link' });
    }

    if (!verifyData?.properties?.action_link) {
      console.error('No action link in response');
      return res.status(500).json({ error: 'Failed to generate verification link' });
    }

    console.log('✅ Verification link generated, sending via Resend...');

    // Record rate limit actions
    await Promise.all([
      recordRateLimitAction(ip, 'auth'),
      recordMagicLinkRequest(email)
    ]);

    // Send verification email with retry logic
    let emailSent = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📧 Email send attempt ${attempt}/3...`);

        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Autopilot America <hello@autopilotamerica.com>',
            to: email,
            subject: 'Verify Your Email - Autopilot America',
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a1a; margin-bottom: 16px;">Verify Your Email</h2>

                <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                  Click the button below to verify your email address and activate your alerts:
                </p>

                <div style="margin: 32px 0; text-align: center;">
                  <a href="${verifyData.properties.action_link}"
                     style="background-color: #0052cc;
                            color: white;
                            padding: 14px 32px;
                            text-decoration: none;
                            border-radius: 8px;
                            font-weight: 600;
                            font-size: 16px;
                            display: inline-block;">
                    Verify Email Address
                  </a>
                </div>

                <p style="color: #666; font-size: 14px; margin-top: 24px;">
                  This verification link will expire in 60 minutes.
                </p>

                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

                <p style="color: #9ca3af; font-size: 13px;">
                  Questions? Email us at <a href="mailto:support@autopilotamerica.com" style="color: #0052cc;">support@autopilotamerica.com</a>
                </p>

                <p style="color: #9ca3af; font-size: 12px;">
                  Autopilot America • Never get another parking ticket
                </p>
              </div>
            `
          })
        });

        if (resendResponse.ok) {
          const result = await resendResponse.json();
          console.log(`✅ Verification email sent successfully via Resend (Email ID: ${result.id})`);
          emailSent = true;
          break;
        } else {
          const errorText = await resendResponse.text();
          lastError = `Resend API error (${resendResponse.status}): ${errorText}`;
          console.error(`❌ Attempt ${attempt} failed:`, lastError);

          if (attempt < 3) {
            const waitTime = attempt * 1000;
            console.log(`⏳ Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      } catch (fetchError: any) {
        lastError = `Network error: ${fetchError.message}`;
        console.error(`❌ Attempt ${attempt} failed:`, lastError);

        if (attempt < 3) {
          const waitTime = attempt * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    if (!emailSent) {
      console.error('❌ Failed to send verification email after 3 attempts:', lastError);
      return res.status(500).json({ error: 'Failed to send email after multiple attempts. Please try again.' });
    }

    console.log('✅ Verification email sent via Resend');
    return res.status(200).json({
      success: true,
      message: 'Verification email sent! Check your inbox.'
    });

  } catch (error: any) {
    console.error('Error in resend-verification:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
