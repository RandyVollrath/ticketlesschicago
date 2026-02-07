import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Webhook handler for inbound SMS messages from ClickSend
 * Handles keywords:
 * - "CONFIRM" - marks user profile as confirmed
 * - "DONE" or "EMISSIONS" - marks emissions test as completed
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

    const upperBody = messageBody.trim().toUpperCase();

    // Check for emissions completion keywords: "DONE", "EMISSIONS", "EMISSIONS DONE", "TEST DONE"
    const isEmissionsComplete =
      upperBody.includes('EMISSIONS') ||
      upperBody === 'DONE' ||
      upperBody.includes('TEST DONE') ||
      upperBody.includes('PASSED');

    if (isEmissionsComplete) {
      console.log(`🚗 Emissions completion keyword detected from ${phoneE164}`);

      // Find user by phone number
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('user_id, first_name, email, emissions_date, emissions_completed, phone_number')
        .eq('phone_number', phoneE164)
        .single();

      if (userError || !user) {
        console.error('User not found for phone:', phoneE164);
        return res.status(200).json({ success: true, message: 'User not found' });
      }

      // Check if user has an emissions date set
      if (!user.emissions_date) {
        console.log(`⚠️ User ${user.user_id} doesn't have an emissions date set`);
        // Send helpful SMS response
        await sendClickSendSMS(
          phoneE164,
          `Autopilot: We don't have an emissions due date on file for you. If you need to track your emissions test, log in at autopilotamerica.com/settings to add it.`
        );
        return res.status(200).json({ success: true, message: 'No emissions date set' });
      }

      // Check if already completed
      if (user.emissions_completed) {
        console.log(`⚠️ Emissions already marked as completed for user ${user.user_id}`);
        await sendClickSendSMS(
          phoneE164,
          `Autopilot: Your emissions test is already marked as complete. Thanks for confirming!`
        );
        return res.status(200).json({ success: true, message: 'Already completed' });
      }

      // Calculate emissions test year (biennial cycle)
      const currentYear = new Date().getFullYear();
      const emissionsTestYear = currentYear % 2 === 0 ? currentYear : currentYear; // Current year or test year

      // Update emissions_completed
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          emissions_completed: true,
          emissions_completed_at: new Date().toISOString(),
          emissions_test_year: emissionsTestYear
        })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error('Error marking emissions complete:', updateError);
        return res.status(500).json({ error: 'Failed to update emissions status' });
      }

      console.log(`✅ Emissions marked complete for user ${user.user_id} (${user.first_name}) via SMS`);

      // Send confirmation SMS
      await sendClickSendSMS(
        phoneE164,
        `Autopilot: Great news, ${user.first_name || 'there'}! We've marked your emissions test as complete. You can now renew your license plate without emissions-related blocks. Thanks for letting us know!`
      );

      return res.status(200).json({
        success: true,
        message: 'Emissions marked as completed'
      });
    }

    // Check if message contains "CONFIRM" keyword (case insensitive)
    const isConfirmation = upperBody.includes('CONFIRM');

    if (isConfirmation) {
      console.log(`📝 Confirmation keyword detected from ${phoneE164}`);

      // Find user by phone number
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('user_id, first_name, email, has_contesting')
        .eq('phone_number', phoneE164)
        .single();

      if (userError || !user) {
        console.error('User not found for phone:', phoneE164);
        return res.status(200).json({ success: true, message: 'User not found' });
      }

      // Only allow Protection users to confirm (free users don't need this)
      if (!user.has_contesting) {
        console.log(`⚠️ Non-protection user tried to confirm: ${user.user_id}`);
        return res.status(200).json({ success: true, message: 'Only available for Protection users' });
      }

      // Update profile_confirmed_at timestamp and year
      const currentYear = new Date().getFullYear();
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          profile_confirmed_at: new Date().toISOString(),
          profile_confirmed_for_year: currentYear
        })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error('Error confirming profile:', updateError);
        return res.status(500).json({ error: 'Failed to confirm profile' });
      }

      console.log(`✅ Profile confirmed for user ${user.user_id} (${user.first_name}) via SMS`);

      // Send confirmation SMS back to user
      await sendClickSendSMS(
        phoneE164,
        `Autopilot: Thanks ${user.first_name || 'for confirming'}! Your profile is confirmed and your reminder settings are active.`
      );

      return res.status(200).json({
        success: true,
        message: 'Profile confirmed successfully'
      });
    }

    // Check for sticker applied confirmation: "YES", "APPLIED", "DONE" (when not emissions context)
    const isStickerApplied =
      upperBody === 'YES' ||
      upperBody === 'APPLIED' ||
      upperBody === 'Y' ||
      upperBody.includes('PUT IT ON') ||
      upperBody.includes('STICKER ON');

    if (isStickerApplied) {
      console.log(`🏷️ Sticker applied confirmation detected from ${phoneE164}`);

      // Find user by phone number
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('user_id, first_name, email')
        .eq('phone_number', phoneE164)
        .single();

      if (userError || !user) {
        console.error('User not found for phone:', phoneE164);
        return res.status(200).json({ success: true, message: 'User not found' });
      }

      // Find their most recent completed order that's awaiting sticker confirmation
      const { data: order, error: orderError } = await supabase
        .from('renewal_orders')
        .select('id, order_number, sticker_type')
        .eq('customer_email', user.email)
        .eq('status', 'completed')
        .eq('sticker_applied', false)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      if (orderError || !order) {
        // No pending sticker confirmation - maybe already confirmed or no recent order
        console.log(`⚠️ No pending sticker confirmation for user ${user.user_id}`);
        await sendClickSendSMS(
          phoneE164,
          `Autopilot: Thanks for the message! We don't have any pending sticker confirmations for you right now.`
        );
        return res.status(200).json({ success: true, message: 'No pending confirmation' });
      }

      // Mark sticker as applied
      const { error: updateError } = await supabase
        .from('renewal_orders')
        .update({
          sticker_applied: true,
          sticker_applied_at: new Date().toISOString(),
          needs_manual_followup: false
        })
        .eq('id', order.id);

      if (updateError) {
        console.error('Error marking sticker applied:', updateError);
        return res.status(500).json({ error: 'Failed to update sticker status' });
      }

      const isLicensePlate = ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase());
      const stickerType = isLicensePlate ? 'license plate sticker' : 'city sticker';

      console.log(`✅ Sticker marked as applied for order ${order.order_number}`);

      // Send thank you SMS
      await sendClickSendSMS(
        phoneE164,
        `Autopilot: Awesome${user.first_name ? `, ${user.first_name}` : ''}! Your ${stickerType} is all set. You're good to go - no more reminders from us about this one. Drive safe!`
      );

      return res.status(200).json({
        success: true,
        message: 'Sticker marked as applied'
      });
    }

    // If not a recognized keyword, just log and acknowledge
    console.log(`📨 SMS received but no action taken: "${messageBody}"`);
    return res.status(200).json({ success: true, message: 'SMS received' });

  } catch (error: any) {
    console.error('Inbound SMS webhook error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
