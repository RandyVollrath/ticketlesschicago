import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { notifyNewUserAboutWinterBan } from '../../../lib/winter-ban-notifications';
import { isAddressOnSnowRoute } from '../../../lib/snow-route-matcher';
import { maskEmail, maskPhone } from '../../../lib/mask-pii';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Input validation schema for alert signup
const alertSignupSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email('Invalid email format').max(255).transform(val => val.toLowerCase().trim()),
  phone: z.string().min(7).max(20).regex(/^[\+\d\s\-\(\)]+$/, 'Invalid phone number format'),
  licensePlate: z.string().min(2).max(10).regex(/^[A-Z0-9\-\s]+$/i, 'Invalid license plate').transform(val => val.toUpperCase().trim()),
  address: z.string().min(5).max(500),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
  city: z.string().max(100).optional(),
  vin: z.string().max(17).optional().nullable(),
  make: z.string().max(50).optional().nullable(),
  model: z.string().max(50).optional().nullable(),
  citySticker: z.string().optional().nullable(),
  token: z.string().max(100).optional().nullable(),
  smsConsent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
  authenticatedUserId: z.string().uuid().optional().nullable(),
});

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

  // Validate request body
  const parseResult = alertSignupSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errors = parseResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    console.warn('Alert signup validation failed:', errors);
    return res.status(400).json({
      error: 'Validation failed',
      details: errors,
    });
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    licensePlate,
    address,
    zip,
    city,
    vin,
    make,
    model,
    citySticker,
    token,
    smsConsent,
    marketingConsent,
    authenticatedUserId
  } = parseResult.data;

  console.log(`Alert signup: ${maskEmail(email)}, plate: ${licensePlate}, phone: ${maskPhone(phone)}`);

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

    let userId: string | null = null;

    // If authenticated user ID is provided (OAuth flow), use it directly
    if (authenticatedUserId) {
      console.log('✅ Using authenticated user ID from OAuth:', authenticatedUserId);
      userId = authenticatedUserId;
    } else {
      // Email/password signup flow - need to create auth user
      console.log('Creating new user via email/password...');

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

      if (authError) {
        // If user already exists, try to get them
        console.log('Auth error, checking if user exists:', authError.message);

        // Check if error indicates user already exists
        if (authError.message?.includes('already') || authError.message?.includes('exists') || authError.message?.includes('duplicate')) {
          console.log('User already exists, finding existing user...');
          const { data: existingUsers } = await supabase.auth.admin.listUsers();
          const user = existingUsers?.users.find(u => u.email === email);

          if (user) {
            userId = user.id;
            console.log('✅ Found existing user:', email, userId);
          } else {
            throw new Error(`User exists but could not be found`);
          }
        } else {
          // Real error, not just "already exists"
          console.error('❌ Critical auth error:', authError);
          console.error('Full error object:', JSON.stringify(authError, null, 2));
          throw new Error(`Failed to create auth user: ${authError.message}`);
        }
      } else {
        userId = authData?.user?.id || null;
        console.log('✅ Created new user:', email, userId);
      }
    }

    if (!userId) {
      throw new Error('Failed to get user ID');
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);

    // Map city to timezone
    const cityTimezoneMap: { [key: string]: { timezone: string; mailingCity: string; mailingState: string } } = {
      'chicago': { timezone: 'America/Chicago', mailingCity: 'Chicago', mailingState: 'IL' },
      'san-francisco': { timezone: 'America/Los_Angeles', mailingCity: 'San Francisco', mailingState: 'CA' },
      'boston': { timezone: 'America/New_York', mailingCity: 'Boston', mailingState: 'MA' },
      'san-diego': { timezone: 'America/Los_Angeles', mailingCity: 'San Diego', mailingState: 'CA' }
    };

    const cityConfig = cityTimezoneMap[city || 'chicago'] || cityTimezoneMap['chicago'];

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
      city: city || 'chicago',
      timezone: cityConfig.timezone,
      // Auto-populate mailing address from home address
      mailing_address: address,
      mailing_city: cityConfig.mailingCity,
      mailing_state: cityConfig.mailingState,
      mailing_zip: zip,
      notify_email: true,
      notify_sms: smsConsent === true, // TCPA compliance - only enable if user consented
      is_paid: true, // Free users are considered "paid" for alerts
      has_protection: false,
      marketing_consent: marketingConsent === true, // CAN-SPAM compliance
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

    // Check if user's address is on a 2-inch snow ban route and auto-opt them in
    try {
      const snowRouteResult = await isAddressOnSnowRoute(address);
      if (snowRouteResult.isOnSnowRoute && snowRouteResult.route) {
        console.log('❄️ User is on snow route:', snowRouteResult.route.on_street);

        // Update profile with snow route info and auto-opt-in to alerts
        const { error: snowUpdateError } = await supabase
          .from('user_profiles')
          .update({
            on_snow_route: true,
            snow_route_street: snowRouteResult.route.on_street,
            notify_snow_forecast: true,
            notify_snow_confirmation: true,
            notify_snow_forecast_email: true,
            notify_snow_forecast_sms: smsConsent === true, // Respect SMS consent
            notify_snow_confirmation_email: true,
            notify_snow_confirmation_sms: smsConsent === true
          })
          .eq('user_id', userId);

        if (snowUpdateError) {
          console.error('Failed to update snow route preferences:', snowUpdateError);
        } else {
          console.log('✅ Auto-opted user into snow ban alerts');
        }
      } else {
        console.log('ℹ️ User address not on a snow route');
      }
    } catch (snowError) {
      // Don't fail signup if snow route check fails
      console.error('Snow route check failed (non-critical):', snowError);
    }

    // If user opted into marketing, add them to drip campaign
    if (marketingConsent === true) {
      console.log('📧 User opted into marketing - adding to drip campaign');

      const { error: dripError } = await supabase
        .from('drip_campaign_status')
        .upsert({
          user_id: userId,
          email: email,
          campaign_name: 'free_alerts_onboarding'
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false
        });

      if (dripError) {
        console.error('⚠️  Failed to add to drip campaign (non-critical):', dripError);
      } else {
        console.log('✅ Added to drip campaign');
      }
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

    // Only skip email if THIS request came from OAuth flow (authenticatedUserId was provided)
    // If user clicked "Use Email Link Instead", they want an email regardless of past OAuth
    const isCurrentRequestOAuth = !!authenticatedUserId;

    if (isCurrentRequestOAuth) {
      console.log('✅ This signup came from OAuth flow, will skip verification email');
    } else {
      console.log('📧 This signup came from email flow, will send verification email');
    }

    // Check if user needs winter ban notification (Dec 1 - Apr 1)
    try {
      const winterBanResult = await notifyNewUserAboutWinterBan(
        userId,
        address,
        email,
        normalizedPhone,
        firstName
      );
      if (winterBanResult.sent) {
        console.log('❄️ Winter ban notification sent to new user');
      } else if (winterBanResult.reason) {
        console.log(`ℹ️ Winter ban not sent: ${winterBanResult.reason}`);
      }
    } catch (winterError) {
      // Don't fail signup if winter ban notification fails
      console.error('Winter ban notification failed (non-critical):', winterError);
    }

    // SIMPLIFIED: If OAuth flow, we're done - no email needed
    if (isCurrentRequestOAuth) {
      console.log('✅ OAuth signup complete - no email needed');
      return res.status(200).json({
        success: true,
        message: 'Account created successfully. You are logged in via Google.',
        userId,
        alreadyAuthenticated: true
      });
    }

    // EMAIL FLOW: Generate magic link and send email
    // If either fails, the request fails (no silent failures)
    console.log('📧 Generating magic link...');
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?redirect=/settings&welcome=true`
      }
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('❌ Failed to generate magic link:', linkError);
      throw new Error('Failed to generate login link. Please try again.');
    }

    const magicLink = linkData.properties.action_link;
    console.log('✅ Magic link generated');

    // Send email via Resend - if this fails, the request fails
    console.log('📧 Sending magic link email to:', email);
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: email,
        subject: 'Sign in to Autopilot America',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Autopilot America!</h2>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">
              Click the button below to sign in and start receiving free parking alerts.
            </p>
            <div style="margin: 32px 0; text-align: center;">
              <a href="${magicLink}"
                 style="background-color: #2563EB; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block;">
                Sign In to Autopilot
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">This link expires in 60 minutes.</p>
            <p style="color: #666; font-size: 14px;">
              Or sign in with Google at <a href="${process.env.NEXT_PUBLIC_SITE_URL}/login" style="color: #2563EB;">autopilotamerica.com/login</a>
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
            <p style="color: #9ca3af; font-size: 12px;">Autopilot America - Never get another parking ticket</p>
          </div>
        `
      })
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error('❌ Resend API error:', resendResponse.status, errorText);
      throw new Error('Failed to send verification email. Please try again.');
    }

    const emailResult = await resendResponse.json();
    console.log('✅ Email sent successfully. Resend ID:', emailResult.id);

    return res.status(200).json({
      success: true,
      message: 'Check your email for the sign-in link!',
      userId,
      emailId: emailResult.id
    });

  } catch (error: any) {
    console.error('Free signup error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}