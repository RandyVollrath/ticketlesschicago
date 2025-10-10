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

    // For free alerts signup, we upsert the vehicle (update if exists, create if not)
    // This is a signup/update flow, not an "add vehicle" flow
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

    // Use upsert to update if vehicle exists, create if not
    // Free users are limited to 1 vehicle, so we update their existing vehicle
    const { error: vehicleError } = await supabase
      .from('vehicles')
      .upsert(vehicleData, {
        onConflict: 'user_id,license_plate'
      });

    if (vehicleError) {
      console.error('Vehicle upsert error:', vehicleError);
      throw new Error(`Failed to save vehicle: ${vehicleError.message}`);
    }

    console.log('Vehicle saved successfully');

    console.log('✅ Free signup successful:', email);

    // Send magic link to new free users so they can login
    console.log('📧 Generating magic link for free user:', email);
    const { data: linkData, error: magicLinkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/settings`
      }
    });

    if (magicLinkError) {
      console.error('Error generating magic link:', magicLinkError);
    } else if (linkData?.properties?.action_link) {
      console.log('✅ Magic link generated, sending via Resend...');

      try {
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Ticketless America <noreply@ticketlessamerica.com>',
            to: email,
            subject: 'Welcome to Ticketless America - Access Your Account',
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Ticketless America!</h2>

                <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                  Your free alerts are now active! Click the button below to access your account and manage your settings:
                </p>

                <div style="margin: 32px 0; text-align: center;">
                  <a href="${linkData.properties.action_link}"
                     style="background-color: #0052cc;
                            color: white;
                            padding: 14px 32px;
                            text-decoration: none;
                            border-radius: 8px;
                            font-weight: 600;
                            font-size: 16px;
                            display: inline-block;">
                    Access My Account
                  </a>
                </div>

                <p style="color: #666; font-size: 14px; margin-top: 32px;">
                  You can also sign in anytime using Google by going to <a href="${process.env.NEXT_PUBLIC_SITE_URL}/login" style="color: #0052cc;">ticketlessamerica.com/login</a>
                </p>

                <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes for security reasons.</p>

                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

                <p style="color: #9ca3af; font-size: 13px;">
                  Questions? Email us at <a href="mailto:support@ticketlessamerica.com" style="color: #0052cc;">support@ticketlessamerica.com</a>
                </p>

                <p style="color: #9ca3af; font-size: 12px;">
                  Ticketless America • Never get another parking ticket
                </p>
              </div>
            `
          })
        });

        if (resendResponse.ok) {
          console.log('✅ Magic link email sent via Resend');
        } else {
          const errorText = await resendResponse.text();
          console.error('Error sending magic link via Resend:', errorText);
        }
      } catch (resendError) {
        console.error('Error sending email via Resend:', resendError);
      }
    }

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