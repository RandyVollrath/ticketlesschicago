import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Normalize phone number to E.164 format (+1XXXXXXXXXX)
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');

  // If it already starts with '1' and has 11 digits, it's correct
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }

  // If it has 10 digits, add +1
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  // If it has 11 digits but doesn't start with 1, remove first digit and add +1
  // (user might have typed 1 twice)
  if (digitsOnly.length === 11) {
    return `+1${digitsOnly.slice(1)}`;
  }

  // If already has +, just return as-is
  if (phone.startsWith('+')) {
    return phone;
  }

  // Default: assume 10 digits, add +1
  return `+1${digitsOnly}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    licensePlate,
    address,
    zip,
    vin,
    make,
    model,
    citySticker,
    token
  } = req.body;

  if (!email || !phone || !licensePlate || !address || !zip) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Mark token as used if provided
    if (token) {
      const { error: tokenError } = await supabase
        .from('signup_tokens')
        .update({
          used: true,
          used_at: new Date().toISOString()
        })
        .eq('token', token);

      if (tokenError) {
        console.error('Error marking token as used:', tokenError);
      }
    }
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

    let userId: string | null = null;

    if (authError) {
      // If user already exists, try to get them
      console.log('Auth error, trying to find existing user:', authError.message);
      const { data: existingUser, error: existingError } = await supabase.auth.admin.listUsers();

      if (existingError) {
        throw new Error(`Failed to list users: ${existingError.message}`);
      }

      const user = existingUser?.users.find(u => u.email === email);

      if (!user) {
        throw new Error(`Failed to create or find user: ${authError.message}`);
      }

      userId = user.id;
      console.log('Found existing user:', email, userId);
    } else {
      userId = authData?.user?.id || null;
      console.log('Created new user:', email, userId);
    }

    if (!userId) {
      throw new Error('Failed to get user ID');
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);

    // Create users table record first (required for foreign key)
    const { error: usersError } = await supabase
      .from('users')
      .upsert({
        id: userId,
        email,
        phone: normalizedPhone,
        first_name: firstName,
        last_name: lastName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (usersError) {
      console.error('Users table error:', usersError);
      // Don't fail on duplicate, just log it
      if (!usersError.message.includes('duplicate')) {
        throw new Error(`Failed to create users record: ${usersError.message}`);
      }
    }

    // Create user profile
    const { error: profileError } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        email,
        phone_number: normalizedPhone,
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

    // Check if user already has this vehicle or if they've hit the free plan limit
    const { data: existingVehicles, error: countError } = await supabase
      .from('vehicles')
      .select('id, license_plate')
      .eq('user_id', userId);

    if (countError) {
      console.error('Error checking vehicle count:', countError);
    }

    // Check if this specific vehicle already exists
    const vehicleExists = existingVehicles?.some(
      v => v.license_plate.toUpperCase() === licensePlate.toUpperCase()
    );

    if (!vehicleExists) {
      // Only check limit if adding a NEW vehicle
      if (existingVehicles && existingVehicles.length >= 1) {
        return res.status(400).json({
          error: 'Free plan allows 1 vehicle. Upgrade to Ticket Protection for unlimited vehicles.'
        });
      }

      // Create vehicle record
      const vehicleData: any = {
        user_id: userId,
        license_plate: licensePlate.toUpperCase(),
        zip_code: zip,
        subscription_status: 'active'
      };

      // Add optional fields if provided
      if (vin) vehicleData.vin = vin;
      if (make) vehicleData.make = make;
      if (model) vehicleData.model = model;
      if (citySticker) vehicleData.city_sticker_expiry = citySticker;

      const { error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleData);

      if (vehicleError) {
        console.error('Vehicle creation error:', vehicleError);
        // Don't fail if vehicle already exists
        if (!vehicleError.message.includes('duplicate')) {
          throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
        }
      }
    } else {
      console.log('Vehicle already exists, updating profile only');
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