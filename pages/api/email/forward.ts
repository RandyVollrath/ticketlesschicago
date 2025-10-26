import { NextApiRequest, NextApiResponse } from 'next';
import { notificationService } from '../../../lib/notifications';
import { supabaseAdmin } from '../../../lib/supabase';

interface ParsedEmailData {
  name: string;
  email: string;
  vin: string;
  plate: string;
  make: string;
  model: string;
  renewalDate: string;
}

/**
 * Webhook endpoint to receive forwarded city sticker emails
 * Supports SendGrid Inbound Parse format
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract email data from various formats:
    // - Resend inbound: { from, to, subject, text, html }
    // - SendGrid: { text, from, subject }
    // - Manual test: { email_text, from, subject }
    const emailText = req.body.text || req.body.html || req.body.email_text || '';
    const fromEmail = req.body.from || req.body.email || '';
    const subject = req.body.subject || '';

    console.log('📧 Received forwarded email:', {
      from: fromEmail,
      subject: subject,
      length: emailText.length,
      format: req.body.text ? 'resend/standard' : 'custom'
    });

    if (!emailText) {
      console.error('No email text found in request body:', Object.keys(req.body));
      return res.status(400).json({ error: 'No email content found' });
    }

    // Parse email using Claude API
    const parsed = await parseEmailWithAI(emailText);

    if (!parsed) {
      console.error('Failed to parse email');
      return res.status(400).json({ error: 'Could not parse email' });
    }

    console.log('✅ Parsed email data:', parsed);

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', parsed.email)
      .single();

    if (existingUser) {
      // User exists - send them link to add vehicle to their account
      await sendVehicleAddLink(parsed);
      return res.status(200).json({
        message: 'Existing user - sent link to add vehicle',
        email: parsed.email
      });
    }

    // Generate signup token with pre-filled data
    const token = await generateSignupToken(parsed);

    // Send reply email with signup link
    await sendSignupEmail(parsed, token);

    res.status(200).json({
      message: 'Signup email sent successfully',
      email: parsed.email
    });
  } catch (error) {
    console.error('Error processing forwarded email:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Parse email content using Claude API
 */
async function parseEmailWithAI(emailText: string): Promise<ParsedEmailData | null> {
  try {
    const prompt = `Extract the following information from this Chicago city vehicle sticker email. Return ONLY a JSON object with these exact fields:

{
  "name": "full name of recipient",
  "email": "email address if visible",
  "vin": "vehicle VIN (17 characters)",
  "plate": "license plate number",
  "make": "vehicle make",
  "model": "vehicle model",
  "renewalDate": "calculate renewal date as exactly 1 year after the sent/mailed date in format YYYY-MM-DD"
}

Email content:
${emailText}

Return ONLY the JSON object, no other text.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      console.error('Claude API error:', await response.text());
      return null;
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Extract JSON from response (in case Claude adds explanation)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in Claude response:', content);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.vin || !parsed.plate || !parsed.renewalDate) {
      console.error('Missing required fields:', parsed);
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Error parsing email with AI:', error);
    return null;
  }
}

/**
 * Generate a secure token for pre-filled signup
 */
async function generateSignupToken(data: ParsedEmailData): Promise<string> {
  const tokenData = {
    ...data,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
  };

  // Store in Supabase for verification
  const { data: token, error } = await supabaseAdmin
    .from('signup_tokens')
    .insert({
      token: generateRandomToken(),
      data: tokenData,
      expires_at: tokenData.expiresAt
    })
    .select('token')
    .single();

  if (error) {
    console.error('Error creating signup token:', error);
    throw error;
  }

  return token.token;
}

/**
 * Generate random token
 */
function generateRandomToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Send signup email with pre-filled link
 */
async function sendSignupEmail(data: ParsedEmailData, token: string) {
  const signupUrl = `https://ticketlessamerica.com/signup?token=${token}`;

  const subject = '🚗 Complete Your Autopilot America Signup';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #2563eb; color: white; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">Autopilot America</h1>
      </div>

      <div style="padding: 32px 24px; background: white;">
        <h2 style="color: #1e40af; margin: 0 0 16px;">We Got Your Vehicle Info!</h2>

        <p style="color: #374151; line-height: 1.6;">
          Thanks for forwarding your city sticker email. We've extracted your vehicle information:
        </p>

        <div style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 16px; margin: 20px 0;">
          <strong style="color: #1e40af;">Vehicle:</strong> ${data.make} ${data.model}<br>
          <strong style="color: #1e40af;">Plate:</strong> ${data.plate}<br>
          <strong style="color: #1e40af;">VIN:</strong> ${data.vin}<br>
          <strong style="color: #1e40af;">City Sticker Renewal:</strong> ${new Date(data.renewalDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>

        <p style="color: #374151; line-height: 1.6;">
          <strong>To start getting reminders, complete your signup:</strong>
        </p>

        <ol style="color: #374151; line-height: 1.8;">
          <li>Click the button below</li>
          <li>Add your address (for street cleaning alerts)</li>
          <li>Add other renewal dates if needed</li>
          <li>Choose your reminder preferences</li>
        </ol>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${signupUrl}"
             style="background: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px;">
            Complete Signup (2 minutes)
          </a>
        </div>

        <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 24px 0;">
          <p style="color: #92400e; margin: 0; font-size: 14px;">
            <strong>Why we need your address:</strong> Chicago street cleaning tickets are the #1 cause of unexpected fines.
            We'll send you alerts the night before street cleaning to help you avoid $75 tickets.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 14px; margin: 24px 0 0;">
          This link expires in 7 days. Questions? Reply to this email.
        </p>
      </div>

      <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px;">
        <strong style="color: #374151;">Autopilot America</strong><br>
        Never miss a renewal deadline again
      </div>
    </div>
  `;

  const text = `
Thanks for forwarding your city sticker email!

We've extracted your vehicle information:
- Vehicle: ${data.make} ${data.model}
- Plate: ${data.plate}
- VIN: ${data.vin}
- City Sticker Renewal: ${data.renewalDate}

Complete your signup to start getting reminders: ${signupUrl}

To get the most value, you'll need to add:
1. Your address (for street cleaning alerts)
2. Other renewal dates if needed
3. Reminder preferences

This link expires in 7 days.

Questions? Reply to this email.
  `;

  await notificationService.sendEmail({
    to: data.email,
    subject,
    html,
    text
  });
}

/**
 * Send link to add vehicle to existing account
 */
async function sendVehicleAddLink(data: ParsedEmailData) {
  const subject = '🚗 Add This Vehicle to Your Account';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #2563eb; color: white; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">Autopilot America</h1>
      </div>

      <div style="padding: 32px 24px; background: white;">
        <h2 style="color: #1e40af; margin: 0 0 16px;">We Found Vehicle Info in Your Email</h2>

        <p style="color: #374151; line-height: 1.6;">
          We received your forwarded city sticker email and extracted:
        </p>

        <div style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 16px; margin: 20px 0;">
          <strong style="color: #1e40af;">Vehicle:</strong> ${data.make} ${data.model}<br>
          <strong style="color: #1e40af;">Plate:</strong> ${data.plate}<br>
          <strong style="color: #1e40af;">VIN:</strong> ${data.vin}<br>
          <strong style="color: #1e40af;">City Sticker Renewal:</strong> ${new Date(data.renewalDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>

        <p style="color: #374151; line-height: 1.6;">
          Since you already have an account, log in to add this vehicle to your dashboard.
        </p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="https://ticketlessamerica.com/login"
             style="background: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px;">
            Log In to Add Vehicle
          </a>
        </div>
      </div>
    </div>
  `;

  const text = `We received your forwarded city sticker email.

Vehicle Info:
- ${data.make} ${data.model}
- Plate: ${data.plate}
- VIN: ${data.vin}
- Renewal: ${data.renewalDate}

Log in to add this vehicle: https://ticketlessamerica.com/login
  `;

  await notificationService.sendEmail({
    to: data.email,
    subject,
    html,
    text
  });
}

// Increase body size limit for email content
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
