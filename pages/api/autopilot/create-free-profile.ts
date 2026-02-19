import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Creates a user_profiles record and monitored_plates entry for free plan signups
 * from the /start page. This ensures the portal scraper can find their plate.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, licensePlate, plateState } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (!licensePlate) {
      return res.status(400).json({ error: 'License plate required' });
    }

    // Sanitize inputs
    const cleanPlate = String(licensePlate).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const cleanState = String(plateState || 'IL').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'IL';

    // Verify the user exists in Supabase auth
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (userError || !userData?.user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const email = userData.user.email;

    // Upsert user_profiles — don't overwrite existing paid fields
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        user_id: userId,
        email: email,
        license_plate: cleanPlate,
        license_state: cleanState,
        // is_paid stays false (default) for free users
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (profileError) {
      console.error('Error creating free profile:', profileError);
      return res.status(500).json({ error: 'Failed to create profile' });
    }

    console.log('✅ Free profile created for user:', userId, 'plate:', cleanPlate, cleanState);

    // Also add to monitored_plates so free alerts work
    const { error: plateError } = await supabaseAdmin
      .from('monitored_plates')
      .upsert({
        user_id: userId,
        plate: cleanPlate,
        state: cleanState,
        status: 'active',
        is_leased_or_company: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,plate' });

    if (plateError) {
      console.error('Error adding plate to monitored_plates:', plateError);
      // Non-fatal — profile was created successfully
    } else {
      console.log('✅ Plate added to monitored_plates for free user');
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Create free profile error:', error);
    return res.status(500).json({ error: error.message || 'Failed to create profile' });
  }
}
