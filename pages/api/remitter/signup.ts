/**
 * Remitter Signup & API Key Generation
 * Creates a new remitter account with API key
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name,
      email,
      phone,
      businessType,
      businessAddress,
      licenseNumber,
    } = req.body;

    // Validation
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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
    return res.status(500).json({ error: 'Failed to create account' });
  }
}

function generateApiKey(): string {
  // Format: ap_live_xxxxxxxxxxxxxxxxxxxxx
  const randomBytes = crypto.randomBytes(24).toString('hex');
  return `ap_live_${randomBytes}`;
}

async function sendWelcomeEmail(partner: any, apiKey: string) {
  // TODO: Implement with Resend
  console.log('Welcome email to:', partner.email);
  console.log('API Key:', apiKey);
}
