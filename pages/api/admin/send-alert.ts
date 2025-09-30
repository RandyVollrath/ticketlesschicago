import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ClickSend integration (if available)
const sendSMS = async (phone: string, message: string, dryRun: boolean) => {
  if (dryRun) {
    console.log(`[DRY RUN] Would send SMS to ${phone}: ${message}`);
    return { success: true, dryRun: true };
  }

  // TODO: Implement ClickSend SMS sending
  // const clicksend = require('clicksend');
  // ...send SMS via ClickSend API

  console.log(`Sending SMS to ${phone}: ${message}`);
  return { success: true };
};

const sendEmail = async (email: string, message: string, dryRun: boolean) => {
  if (dryRun) {
    console.log(`[DRY RUN] Would send email to ${email}: ${message}`);
    return { success: true, dryRun: true };
  }

  // TODO: Implement Resend email sending
  // const { Resend } = require('resend');
  // ...send email via Resend API

  console.log(`Sending email to ${email}: ${message}`);
  return { success: true };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, phone, message, type, dryRun } = req.body;

  if (!email || !message || !type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const results: any = {
      email: null,
      sms: null
    };

    // Send email if requested
    if (type === 'email' || type === 'both') {
      const emailResult = await sendEmail(email, message, dryRun || false);
      results.email = emailResult;
    }

    // Send SMS if requested
    if ((type === 'sms' || type === 'both') && phone) {
      const smsResult = await sendSMS(phone, message, dryRun || false);
      results.sms = smsResult;
    }

    console.log(`✅ Alert sent to ${email}${dryRun ? ' [DRY RUN]' : ''}`);

    return res.status(200).json({
      success: true,
      results,
      dryRun: dryRun || false
    });

  } catch (error: any) {
    console.error('Send alert error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}