import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

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

  const { firstName, lastName, email, phone, licensePlate, address, zip } = req.body;

  if (!email || !phone || !licensePlate || !address || !zip) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Create or get user via Supabase Auth (passwordless magic link)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone,
      }
    });

    if (authError) {
      // If user already exists, try to get them
      const { data: existingUser, error: existingError } = await supabase.auth.admin.listUsers();
      const user = existingUser?.users.find(u => u.email === email);

      if (!user) {
        throw new Error(`Failed to create or find user: ${authError.message}`);
      }

      // User already exists, continue with existing user
      console.log('User already exists:', email);
    }

    const userId = authData?.user?.id || authError?.message.includes('already registered')
      ? (await supabase.auth.admin.listUsers()).data?.users.find(u => u.email === email)?.id
      : null;

    if (!userId) {
      throw new Error('Failed to get user ID');
    }

    // Check vehicle limit for free users (max 1 vehicle)
    const { data: existingVehicles, error: countError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('user_id', userId);

    if (countError) {
      console.error('Error checking vehicle count:', countError);
    }

    if (existingVehicles && existingVehicles.length >= 1) {
      return res.status(400).json({
        error: 'Free plan allows 1 vehicle. Upgrade to Ticket Protection for unlimited vehicles.'
      });
    }

    // Create user profile
    const { error: profileError } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        email,
        phone_number: phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`,
        first_name: firstName,
        last_name: lastName,
        zip_code: zip,
        license_plate: licensePlate.toUpperCase(),
        home_address_full: address,
        notify_email: true,
        notify_sms: true,
        is_paid: true, // Free users are considered "paid" for alerts
        has_protection: false,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    if (profileError) {
      console.error('Profile creation error:', profileError);
      throw new Error(`Failed to create profile: ${profileError.message}`);
    }

    // Create vehicle record
    const { error: vehicleError } = await supabase
      .from('vehicles')
      .insert({
        user_id: userId,
        license_plate: licensePlate.toUpperCase(),
        zip_code: zip,
        subscription_status: 'active'
      });

    if (vehicleError) {
      console.error('Vehicle creation error:', vehicleError);
      // Don't fail if vehicle already exists
      if (!vehicleError.message.includes('duplicate')) {
        throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
      }
    }

    console.log('✅ Free signup successful:', email);

    return res.status(200).json({
      success: true,
      message: 'Account created successfully',
      userId
    });

  } catch (error: any) {
    console.error('Free signup error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}