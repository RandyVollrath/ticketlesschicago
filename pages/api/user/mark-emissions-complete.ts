import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * API endpoint for marking emissions test as complete
 * POST /api/user/mark-emissions-complete
 * Body: { userId: string }
 *
 * Also supports toggling back to incomplete:
 * Body: { userId: string, completed: false }
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, completed = true } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get user data to verify they have emissions tracking
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id, first_name, email, phone_number, emissions_date, emissions_completed')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      console.error('User not found:', userError);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has an emissions date set
    if (!user.emissions_date) {
      return res.status(400).json({
        error: 'No emissions date on file. Please set your emissions due date first.'
      });
    }

    // If marking as complete
    if (completed) {
      // Check if already completed
      if (user.emissions_completed) {
        return res.status(200).json({
          success: true,
          message: 'Emissions test already marked as complete',
          alreadyComplete: true
        });
      }

      // Calculate emissions test year (biennial cycle)
      const currentYear = new Date().getFullYear();
      const emissionsTestYear = currentYear;

      // Update emissions_completed
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          emissions_completed: true,
          emissions_completed_at: new Date().toISOString(),
          emissions_test_year: emissionsTestYear
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error marking emissions complete:', updateError);
        return res.status(500).json({ error: 'Failed to update emissions status' });
      }

      console.log(`✅ Emissions marked complete for user ${userId} (${user.first_name}) via UI`);

      // Send confirmation SMS if user has phone number
      if (user.phone_number) {
        try {
          await sendClickSendSMS(
            user.phone_number,
            `Autopilot: Your emissions test has been marked as complete. Your license plate renewal can now proceed without any blocks.`
          );
          console.log(`📱 Confirmation SMS sent to ${user.phone_number}`);
        } catch (smsError) {
          console.error('Failed to send confirmation SMS:', smsError);
          // Don't fail the request if SMS fails
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Emissions test marked as complete',
        emissions_completed: true,
        emissions_completed_at: new Date().toISOString(),
        emissions_test_year: emissionsTestYear
      });

    } else {
      // Marking as NOT complete (user made a mistake or needs to redo)
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          emissions_completed: false,
          emissions_completed_at: null,
          emissions_test_year: null
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error resetting emissions status:', updateError);
        return res.status(500).json({ error: 'Failed to reset emissions status' });
      }

      console.log(`⏪ Emissions status reset for user ${userId} (${user.first_name}) via UI`);

      return res.status(200).json({
        success: true,
        message: 'Emissions status reset',
        emissions_completed: false
      });
    }

  } catch (error: any) {
    console.error('Mark emissions complete error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
