import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { notifyRemittersProfileConfirmed } from '../../../lib/remitter-notifications';

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

  const { userId, token, renewalYear } = req.body;

  // Validate input
  if (!userId && !token) {
    return res.status(400).json({ error: 'userId or token required' });
  }

  try {
    let targetUserId = userId;

    // If token provided, verify it and get userId
    if (token && !userId) {
      // TODO: Implement token verification for email links
      // For now, we'll just use the direct userId approach from settings page
      return res.status(400).json({ error: 'Token-based confirmation not yet implemented' });
    }

    // Build update object
    const updateData: Record<string, any> = {
      profile_confirmed_at: new Date().toISOString()
    };

    // Include renewal year if provided
    if (renewalYear) {
      updateData.profile_confirmed_for_year = renewalYear;
    }

    // Update profile_confirmed_at timestamp
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', targetUserId)
      .select()
      .single();

    if (error) {
      console.error('Error confirming profile:', error);
      return res.status(500).json({ error: 'Failed to confirm profile' });
    }

    // Log the confirmation event (don't fail if this errors)
    try {
      await supabase.from('notification_log').insert({
        user_id: targetUserId,
        notification_type: 'profile_confirmation',
        channel: 'web',
        message_key: renewalYear ? `profile_confirmed_${renewalYear}` : 'profile_confirmed',
        metadata: {
          renewal_year: renewalYear || null,
          confirmed_at: new Date().toISOString(),
        }
      });
    } catch (logError) {
      // Don't fail if logging fails - table might not exist yet
      console.log('Note: Could not log confirmation (notification_log table may not exist)');
    }

    console.log(`✅ Profile confirmed for user ${targetUserId}${renewalYear ? ` for year ${renewalYear}` : ''}`);

    // Notify remitters about this new ready-for-renewal user
    try {
      await notifyRemittersProfileConfirmed({
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        licensePlate: data.license_plate,
        phone: data.phone,
      });
    } catch (notifyError) {
      console.error('Error notifying remitters:', notifyError);
      // Don't fail the request if notification fails
    }

    return res.status(200).json({
      success: true,
      message: 'Profile confirmed successfully',
      data
    });

  } catch (error: any) {
    console.error('Profile confirmation error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
