/**
 * Remitter Signup & API Key Generation
 * Creates a new remitter account with API key
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { fetchWithTimeout, DEFAULT_TIMEOUTS } from '../../../lib/fetch-with-timeout';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Input validation schema
const remitterSignupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email format').max(255).transform(val => val.toLowerCase().trim()),
  phone: z.string().min(7, 'Phone number too short').max(20).regex(/^[\+\d\s\-\(\)]+$/, 'Invalid phone number format'),
  businessType: z.string().max(50).optional(),
  businessAddress: z.string().max(500).optional(),
  licenseNumber: z.string().max(50).optional(),
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate request body
  const parseResult = remitterSignupSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  try {
    const { name, email, phone, businessType, businessAddress, licenseNumber } = parseResult.data;

    // Check if email already exists
    const { data: existing } = await supabase
      .from('renewal_partners')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Generate API key
    const apiKey = generateApiKey();

    // Create remitter account
    const { data: partner, error } = await supabase
      .from('renewal_partners')
      .insert({
        name,
        email,
        phone,
        business_type: businessType || 'remitter',
        business_address: businessAddress,
        license_number: licenseNumber,
        api_key: apiKey,
        status: 'active',
        onboarding_completed: false,
        auto_forward_payments: true,
        commission_percentage: 0, // Remitter gets 100%, you get application fee
        service_fee_amount: 2, // Your $2 fee
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating partner:', error);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    // Initialize stats
    await supabase.from('renewal_partner_stats').insert({
      partner_id: partner.id,
      orders_today: 0,
      revenue_today: 0,
      total_orders: 0,
      total_revenue: 0,
    });

    // Send welcome email with API key
    await sendWelcomeEmail(partner, apiKey);

    return res.status(200).json({
      success: true,
      partner: {
        id: partner.id,
        name: partner.name,
        email: partner.email,
      },
      apiKey,
      nextStep: 'stripe_connect',
      stripeConnectUrl: `/api/stripe-connect/authorize?partnerId=${partner.id}`,
    });

  } catch (error: any) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

function generateApiKey(): string {
  // Format: ap_live_xxxxxxxxxxxxxxxxxxxxx
  const randomBytes = crypto.randomBytes(24).toString('hex');
  return `ap_live_${randomBytes}`;
}

async function sendWelcomeEmail(partner: any, apiKey: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com';
    const portalUrl = `${baseUrl}/remitter-portal`;

    const resendResponse = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      timeout: DEFAULT_TIMEOUTS.email,
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: partner.email,
        subject: 'Welcome to Autopilot America - Your Remitter API Key',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #2563eb; color: white; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">Welcome to Autopilot America!</h1>
              <p style="margin: 8px 0 0; opacity: 0.9;">You're now a registered remitter</p>
            </div>

            <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb;">
              <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">
                Hi ${partner.name},
              </p>

              <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">
                Your remitter account has been created successfully. Below is your API key for accessing the Remitter Portal and API.
              </p>

              <div style="background: #1f2937; color: #10b981; padding: 16px; border-radius: 6px; font-family: monospace; word-break: break-all; margin: 20px 0;">
                ${apiKey}
              </div>

              <p style="color: #dc2626; font-size: 14px; margin: 20px 0;">
                <strong>Important:</strong> Keep this API key secure. Do not share it publicly. You'll need it to access the portal and update order statuses.
              </p>

              <h3 style="color: #1f2937; margin: 24px 0 12px;">Next Steps:</h3>
              <ol style="color: #374151; padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;">Complete Stripe Connect setup to receive payments</li>
                <li style="margin-bottom: 8px;">Bookmark your portal: <a href="${portalUrl}" style="color: #2563eb;">${portalUrl}</a></li>
                <li style="margin-bottom: 8px;">Enter your API key when prompted to access the dashboard</li>
                <li style="margin-bottom: 8px;">Wait for renewal orders to be assigned to you</li>
              </ol>

              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-top: 24px;">
                <h4 style="color: #1f2937; margin: 0 0 8px;">How It Works:</h4>
                <p style="color: #6b7280; font-size: 14px; margin: 0;">
                  When customers pay for renewals, orders are assigned to active remitters. You'll receive the order details including license plate, VIN, and customer info. Submit the renewal to the city/state, then update the order status with the confirmation number. Payment is automatically transferred to your Stripe account.
                </p>
              </div>
            </div>

            <div style="background: #f9fafb; padding: 16px; text-align: center; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                Questions? Reply to this email or contact <a href="mailto:support@autopilotamerica.com" style="color: #2563eb;">support@autopilotamerica.com</a>
              </p>
            </div>
          </div>
        `
      })
    });

    if (resendResponse.ok) {
      console.log(`✅ Welcome email sent to ${partner.email}`);
    } else {
      const errorText = await resendResponse.text();
      console.error('❌ Failed to send welcome email:', errorText);
    }
  } catch (error: any) {
    console.error('Error sending welcome email:', error);
    // Don't throw - signup should still succeed even if email fails
  }
}
