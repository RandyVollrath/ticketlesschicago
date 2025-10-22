import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
// import { notifyNewUserAboutWinterBan } from '../../lib/winter-ban-notifications';

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
    // Create or get user via Supabase Auth
    // Note: email_confirm is set to FALSE - user must verify email via link
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: false, // Require email verification
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone,
      }
    });

    let userId: string | null = null;

    if (authError) {
      // If user already exists, try to get them
      console.log('Auth error, checking if user exists:', authError.message);

      // Check if error is "user already exists"
      if (authError.message?.includes('already') || authError.message?.includes('exists')) {
        console.log('User already exists, finding existing user...');
        const { data: existingUser, error: existingError } = await supabase.auth.admin.listUsers();

        if (existingError) {
          throw new Error(`Failed to list users: ${existingError.message}`);
        }

        const user = existingUser?.users.find(u => u.email === email);

        if (!user) {
          throw new Error(`User exists but could not be found: ${authError.message}`);
        }

        userId = user.id;
        console.log('✅ Found existing user:', email, userId);
      } else {
        // Real error, not just "already exists"
        console.error('❌ Critical auth error:', authError);
        throw new Error(`Failed to create user: ${authError.message}. Please try signing up with Google instead or contact support.`);
      }
    } else {
      userId = authData?.user?.id || null;
      console.log('✅ Created new user:', email, userId);
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
        email_verified: false, // Mark as unverified initially
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
    const profileData = {
      user_id: userId,
      email,
      phone_number: normalizedPhone,
      first_name: firstName,
      last_name: lastName,
      zip_code: zip,
      license_plate: licensePlate.toUpperCase(),
      home_address_full: address,
      // Auto-populate mailing address from home address
      mailing_address: address,
      mailing_city: 'Chicago',
      mailing_state: 'IL',
      mailing_zip: zip,
      notify_email: true,
      notify_sms: true,
      is_paid: true, // Free users are considered "paid" for alerts
      has_protection: false,
      updated_at: new Date().toISOString()
    };

    console.log('[Profile Create] Upserting profile with data:', profileData);

    const { data: profileResult, error: profileError } = await supabase
      .from('user_profiles')
      .upsert(profileData, {
        onConflict: 'user_id'
      })
      .select();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      throw new Error(`Failed to create profile: ${profileError.message}`);
    }

    console.log('[Profile Create] Profile upserted successfully:', profileResult);

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
    console.log('[Vehicle Create] Upserting vehicle with data:', vehicleData);

    const { data: vehicleResult, error: vehicleError } = await supabase
      .from('vehicles')
      .upsert(vehicleData, {
        onConflict: 'user_id,license_plate'
      })
      .select();

    if (vehicleError) {
      console.error('Vehicle upsert error:', vehicleError);
      throw new Error(`Failed to save vehicle: ${vehicleError.message}`);
    }

    console.log('[Vehicle Create] Vehicle upserted successfully:', vehicleResult);

    console.log('✅ Free signup successful:', email);

    // Check if user needs winter ban notification (Dec 1 - Apr 1)
    // TODO: Re-enable when winter-ban-notifications type errors are fixed
    // try {
    //   const winterBanResult = await notifyNewUserAboutWinterBan(
    //     userId,
    //     address,
    //     email,
    //     normalizedPhone,
    //     firstName
    //   );
    //   if (winterBanResult.sent) {
    //     console.log('❄️ Winter ban notification sent to new user');
    //   } else if (winterBanResult.reason) {
    //     console.log(`ℹ️ Winter ban not sent: ${winterBanResult.reason}`);
    //   }
    // } catch (winterError) {
    //   // Don't fail signup if winter ban notification fails
    //   console.error('Winter ban notification failed (non-critical):', winterError);
    // }

    // Generate TWO links:
    // 1. Immediate login (for instant access)
    // 2. Email verification (to confirm email ownership)
    console.log('🔐 Generating login session for immediate access...');
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/settings?welcome=true`
      }
    });

    if (sessionError || !sessionData?.properties?.action_link) {
      console.error('❌ Failed to generate session:', sessionError);
      // Don't fail signup - user can still login with Google
      console.log('⚠️  User created but cannot auto-login. They can use Google OAuth.');
    }

    const loginLink = sessionData?.properties?.action_link;
    console.log('✅ Login session generated');

    // Generate email verification link (use magiclink type since user already exists)
    console.log('📧 Generating email verification link...');
    const { data: verifyData, error: verifyError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/settings?verified=true`
      }
    });

    const verificationLink = verifyData?.properties?.action_link;
    console.log('Verification link generated:', !!verificationLink);

    // Send welcome email with verification link in background (non-blocking)
    console.log('📧 Sending verification email (background)...');

    // Send email with retry logic
    let emailSent = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📧 Email send attempt ${attempt}/3...`);

        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Autopilot America <noreply@autopilotamerica.com>',
            to: email,
            subject: 'Verify Your Email - Autopilot America',
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Autopilot America!</h2>

                <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                  Thanks for signing up! Please verify your email address to activate your alerts and complete your account setup.
                </p>

                <div style="margin: 32px 0; text-align: center;">
                  <a href="${verificationLink || linkData?.properties?.action_link}"
                     style="background-color: #0052cc;
                            color: white;
                            padding: 14px 32px;
                            text-decoration: none;
                            border-radius: 8px;
                            font-weight: 600;
                            font-size: 16px;
                            display: inline-block;">
                    Verify Email Address
                  </a>
                </div>

                <p style="color: #666; font-size: 14px; background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; border-radius: 4px;">
                  <strong>Note:</strong> Email delivery may take up to 5 minutes due to Gmail processing. If you don't see this email, check your Spam or Promotions folder.
                </p>

                <p style="color: #666; font-size: 14px; margin-top: 24px;">
                  You can also sign in anytime using Google at <a href="${process.env.NEXT_PUBLIC_SITE_URL}/login" style="color: #0052cc;">autopilotamerica.com/login</a>
                </p>

                <p style="color: #666; font-size: 14px;">This verification link will expire in 60 minutes.</p>

                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

                <p style="color: #9ca3af; font-size: 13px;">
                  Questions? Email us at <a href="mailto:support@autopilotamerica.com" style="color: #0052cc;">support@autopilotamerica.com</a>
                </p>

                <p style="color: #9ca3af; font-size: 12px;">
                  Autopilot America • Never get another parking ticket
                </p>
              </div>
            `
          })
        });

        if (resendResponse.ok) {
          const result = await resendResponse.json();
          console.log(`✅ Magic link email sent successfully via Resend (Email ID: ${result.id})`);
          emailSent = true;
          break; // Success, exit retry loop
        } else {
          const errorText = await resendResponse.text();
          lastError = `Resend API error (${resendResponse.status}): ${errorText}`;
          console.error(`❌ Attempt ${attempt} failed:`, lastError);

          // Wait before retry (exponential backoff)
          if (attempt < 3) {
            const waitTime = attempt * 1000; // 1s, 2s
            console.log(`⏳ Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      } catch (resendError: any) {
        lastError = `Network error: ${resendError.message}`;
        console.error(`❌ Attempt ${attempt} failed:`, lastError);

        // Wait before retry
        if (attempt < 3) {
          const waitTime = attempt * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // Log email send failure but don't block signup
    if (!emailSent) {
      console.error('⚠️  Failed to send welcome email after 3 attempts:', lastError);
      console.log('User can still access account via immediate login link');
    }

    return res.status(200).json({
      success: true,
      message: 'Account created successfully',
      userId,
      loginLink: loginLink || null // Return immediate login link
    });

  } catch (error: any) {
    console.error('Free signup error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}