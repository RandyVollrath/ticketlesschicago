import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Webhook handler for inbound SMS messages from ClickSend
 * Handles "CONFIRM" keyword to mark user profile as confirmed
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📨 Inbound SMS webhook received:', JSON.stringify(req.body, null, 2));

    const { from, body: messageBody } = req.body;

    if (!from || !messageBody) {
      console.error('Missing required fields in webhook');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Normalize phone number to E.164 format to match database format
    // ClickSend sends in format like "+12223334444" or "12223334444"
    const digitsOnly = from.replace(/\D/g, '');
    const phoneE164 = digitsOnly.length === 11 && digitsOnly.startsWith('1')
      ? `+${digitsOnly}`
      : `+1${digitsOnly.slice(-10)}`;

    // Check if message contains "CONFIRM" keyword (case insensitive)
    const isConfirmation = messageBody.trim().toUpperCase().includes('CONFIRM');

    if (isConfirmation) {
      console.log(`📝 Confirmation keyword detected from ${phoneE164}`);

      // Find user by phone number
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('user_id, first_name, email, has_protection')
        .eq('phone_number', phoneE164)
        .single();

      if (userError || !user) {
        console.error('User not found for phone:', phoneE164);
        return res.status(200).json({ success: true, message: 'User not found' });
      }

      // Only allow Protection users to confirm (free users don't need this)
      if (!user.has_protection) {
        console.log(`⚠️ Non-protection user tried to confirm: ${user.user_id}`);
        return res.status(200).json({ success: true, message: 'Only available for Protection users' });
      }

      // Update profile_confirmed_at timestamp
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ profile_confirmed_at: new Date().toISOString() })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error('Error confirming profile:', updateError);
        return res.status(500).json({ error: 'Failed to confirm profile' });
      }

      console.log(`✅ Profile confirmed for user ${user.user_id} (${user.first_name}) via SMS`);

      // TODO: Send confirmation SMS back to user
      // Could send: "Thanks ${user.first_name}! Your profile is confirmed. We'll use your current info when we process your renewal."

      return res.status(200).json({
        success: true,
        message: 'Profile confirmed successfully'
      });
    }

    // If not a confirmation, just log and acknowledge
    console.log(`📨 SMS received but no action taken: "${messageBody}"`);
    return res.status(200).json({ success: true, message: 'SMS received' });

  } catch (error: any) {
    console.error('Inbound SMS webhook error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
