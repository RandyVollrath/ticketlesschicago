import { NextApiRequest, NextApiResponse } from 'next';
import { syncUserToMyStreetCleaning } from '../../lib/mystreetcleaning-integration';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, streetAddress, userId } = req.body;

    // Validate required fields
    if (!email || !streetAddress) {
      return res.status(400).json({ 
        error: 'Email and street address are required' 
      });
    }

    console.log('🔄 [API] MyStreetCleaning sync request for:', email);

    // Optional: Check if user exists in our system
    if (userId) {
      const { data: existingUser, error: userError } = await supabaseAdmin
        .from('vehicle_reminders')
        .select('email, user_id')
        .eq('user_id', userId)
        .single();

      if (userError || !existingUser) {
        console.warn('⚠️ [API] User not found in ticketless system:', userId);
      }
    }

    // Sync user to MyStreetCleaning
    const result = await syncUserToMyStreetCleaning(email, streetAddress, userId);

    if (result.success) {
      console.log('✅ [API] Successfully synced user to MyStreetCleaning');
      return res.status(200).json({
        success: true,
        message: result.message,
        accountId: result.accountId
      });
    } else {
      console.error('❌ [API] Failed to sync user to MyStreetCleaning:', result.error);
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ [API] Unexpected error in MyStreetCleaning sync:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// Export the sync function for use by other parts of the application
export { syncUserToMyStreetCleaning };