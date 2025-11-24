import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../lib/supabase';
import { syncUserToMyStreetCleaning } from '../../lib/mystreetcleaning-integration';
import { createRewardfulAffiliate } from '../../lib/rewardful-helper';
import { Resend } from 'resend';
import { logAuditEvent } from '../../lib/audit-logger';
import { notifyNewUserAboutWinterBan } from '../../lib/winter-ban-notifications';
import stripeConfig from '../../lib/stripe-config';

const stripe = new Stripe(stripeConfig.secretKey!, {
  apiVersion: '2024-12-18.acacia'
});

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to check if a string has meaningful content (not null, undefined, or empty)
function hasValue(str: string | null | undefined): boolean {
  return !!str && str.trim() !== '';
}

// Normalize phone number to E.164 format (+1XXXXXXXXXX)
function normalizePhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;

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

export const config = {
  api: {
    bodyParser: false
  }
};

async function buffer(readable: any) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('🔔 Stripe webhook called at:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Headers:', req.headers['stripe-signature'] ? 'Signature present' : 'No signature');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  // If no signature header, log useful debugging info and reject
  if (!sig) {
    console.warn('⚠️ Webhook called without Stripe signature header');
    console.warn('User-Agent:', req.headers['user-agent'] || 'Not provided');
    console.warn('Origin:', req.headers['origin'] || 'Not provided');
    console.warn('Referer:', req.headers['referer'] || 'Not provided');
    console.warn('X-Forwarded-For:', req.headers['x-forwarded-for'] || 'Not provided');
    console.warn('Body preview:', buf.toString().substring(0, 100));

    // This is likely a health check, bot, or invalid request - not a real Stripe webhook
    return res.status(400).json({
      error: 'Missing stripe-signature header',
      note: 'This endpoint only accepts webhooks from Stripe'
    });
  }

  let event: Stripe.Event;

  try {
    const webhookSecret = stripeConfig.webhookSecret;

    if (!webhookSecret) {
      console.error(`❌ STRIPE_WEBHOOK_SECRET is not set for ${stripeConfig.mode} mode!`);
      // Try to handle the event anyway in development
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️ Development mode: Processing without signature verification');
        event = JSON.parse(buf.toString()) as Stripe.Event;
      } else {
        return res.status(500).send('Webhook secret not configured');
      }
    } else {
      event = stripe.webhooks.constructEvent(
        buf.toString(),
        sig,
        webhookSecret
      );
      console.log(`✅ Webhook signature verified successfully (${stripeConfig.mode} mode)`);
    }

    console.log('Event type:', event.type);
    console.log('Event ID:', event.id);
  } catch (err: any) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('Signature header:', sig ? 'Present' : 'Missing');
    console.error('Using webhook secret:', process.env.STRIPE_WEBHOOK_SECRET ? `Set (${process.env.STRIPE_WEBHOOK_SECRET.substring(0, 15)}...)` : 'NOT SET!');
    console.error('Raw body length:', buf.length);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the events
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('Checkout session completed:', session.id);
      console.log('Session client_reference_id (Rewardful ID):', session.client_reference_id);
      
      try {
        // Get session metadata
        const metadata = session.metadata;
        if (!metadata) {
          console.error('No metadata found in session');
          break;
        }

        // Handle Ticket Protection purchases separately
        if (metadata.product === 'ticket_protection') {
          console.log('🛡️ Processing Ticket Protection purchase');
          console.log('User ID:', metadata.userId);
          console.log('Plan:', metadata.plan);
          console.log('City Sticker Date:', metadata.citySticker);
          console.log('License Plate Date:', metadata.licensePlate);

          if (!supabaseAdmin) {
            console.error('Supabase admin client not available');
            break;
          }

          const email = metadata.email || session.customer_details?.email;
          if (!email) {
            console.error('No email found in Protection purchase');
            break;
          }

          // Extract name, phone, and address from Stripe customer_details
          const customerName = session.customer_details?.name;
          const firstName = customerName?.split(' ')[0] || null;
          const lastName = customerName?.split(' ').slice(1).join(' ') || null;
          const zipCode = session.customer_details?.address?.postal_code || null;
          const billingAddress = session.customer_details?.address?.line1 || null;
          const stripePhone = session.customer_details?.phone || null;

          console.log('📋 Extracted from Stripe:', { firstName, lastName, zipCode, billingAddress, stripePhone });

          let userId = metadata.userId;

          // If no userId, create a new user account
          if (!userId) {
            console.log('No userId provided - creating new user account for:', email);

            // Check if user already exists
            const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
            const existingUser = existingUsers?.users?.find(u => u.email === email);

            if (existingUser) {
              console.log('User already exists:', existingUser.id);
              userId = existingUser.id;

              // Check if user has a profile - if not, create one (this handles cases where OAuth user signed up but didn't complete profile)
              const { data: existingProfile } = await supabaseAdmin
                .from('user_profiles')
                .select('user_id')
                .eq('user_id', existingUser.id)
                .single();

              if (!existingProfile) {
                console.log('⚠️ Auth user exists but no profile found - creating profile now');

                // Create users table record first (required for foreign key)
                const { error: usersError } = await supabaseAdmin
                  .from('users')
                  .upsert({
                    id: userId,
                    email: email,
                    phone: hasValue(metadata.phone) ? metadata.phone : (stripePhone || null),
                    first_name: firstName,
                    last_name: lastName,
                    zip_code: zipCode,
                    mailing_address: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                    mailing_zip: zipCode,
                    home_address_full: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  }, {
                    onConflict: 'id'
                  });

                if (usersError && !usersError.message.includes('duplicate')) {
                  console.error('Users table error:', usersError);
                } else {
                  console.log('✅ Created users table record');
                }

                // Create or update user profile (use UPSERT in case trigger already created empty profile)
                const { error: profileError } = await supabaseAdmin
                  .from('user_profiles')
                  .upsert({
                    user_id: userId,
                    email: email,
                    first_name: firstName,
                    last_name: lastName,
                    phone_number: hasValue(metadata.phone) ? metadata.phone : (stripePhone || null),
                    zip_code: zipCode,
                    vehicle_type: hasValue(metadata.vehicleType) ? metadata.vehicleType : 'P',
                    has_protection: true,
                    stripe_customer_id: session.customer as string,
                    city_sticker_expiry: hasValue(metadata.citySticker) ? metadata.citySticker : null,
                    license_plate_expiry: hasValue(metadata.licensePlate) ? metadata.licensePlate : null,
                    mailing_address: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                    mailing_zip: zipCode,
                    street_address: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                    home_address_full: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                    has_permit_zone: metadata.hasPermitZone === 'true',
                    permit_requested: metadata.permitRequested === 'true',
                    residency_forwarding_consent_given: metadata.permitRequested === 'true', // Auto-consent if permit requested
                    // NOTE: permit_zones column does not exist in database - removed to prevent insert failure
                    updated_at: new Date().toISOString()
                  }, {
                    onConflict: 'user_id'
                  });

                if (profileError) {
                  console.error('❌ CRITICAL ERROR creating user profile (existing auth user path):', profileError);
                  console.error('Session ID:', session.id);
                  console.error('Email:', email);
                  console.error('User ID:', userId);

                  // Send immediate alert
                  try {
                    await resend.emails.send({
                      from: 'Alerts <alerts@autopilotamerica.com>',
                      to: 'randyvollrath@gmail.com',
                      subject: '🚨 CRITICAL: Protection Purchase Failed - Profile Creation Error (Existing Auth User)',
                      text: `Profile creation failed for existing auth user!\n\nSession: ${session.id}\nEmail: ${email}\nUser ID: ${userId}\nError: ${profileError.message}\n\nUser paid but got no account!`
                    });
                  } catch (e) {
                    console.error('Failed to send alert email:', e);
                  }

                  // Return error so Stripe will retry
                  return res.status(500).json({ error: 'Profile creation failed', details: profileError.message });
                } else {
                  console.log('✅ Created user profile with Protection');

                  // Auto-populate ward/section for street cleaning alerts
                  if (hasValue(metadata.streetAddress)) {
                    try {
                      console.log('🗺️ Geocoding address to get ward/section:', metadata.streetAddress);
                      const geocodeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/find-section?address=${encodeURIComponent(metadata.streetAddress)}`);

                      if (geocodeResponse.ok) {
                        const geoData = await geocodeResponse.json();
                        console.log(`✅ Found Ward ${geoData.ward}, Section ${geoData.section}`);

                        // Update profile with ward/section
                        await supabaseAdmin
                          .from('user_profiles')
                          .update({
                            home_address_ward: geoData.ward,
                            home_address_section: geoData.section,
                            updated_at: new Date().toISOString()
                          })
                          .eq('user_id', userId);

                        console.log('✅ Ward/section saved - street cleaning alerts are now active');
                      } else {
                        console.log('ℹ️ Could not geocode address - user can set up street cleaning manually');
                      }
                    } catch (geoError) {
                      // Non-critical - user can set up street cleaning manually
                      console.log('ℹ️ Geocoding failed (non-critical):', geoError);
                    }
                  }
                }

                // Generate and send magic link
                console.log('📧 Generating magic link for existing auth user (no profile):', email);
                const { data: linkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
                  type: 'magiclink',
                  email: email,
                  options: {
                    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?protection=true`
                  }
                });

                if (magicLinkError) {
                  console.error('Error generating magic link:', magicLinkError);
                } else if (linkData?.properties?.action_link) {
                  const magicLink = linkData.properties.action_link;
                  console.log('✅ Magic link generated, sending email...');

                  // Send magic link email via Resend
                  const resendResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      from: 'Autopilot America <noreply@autopilotamerica.com>',
                      to: email,
                      subject: 'Complete Your Profile - Autopilot America',
                      html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Ticket Protection!</h2>
                          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                            Thank you for signing up for Ticket Protection! Click the button below to access your account and complete your profile.
                          </p>
                          <div style="margin: 32px 0; text-align: center;">
                            <a href="${magicLink}"
                               style="background-color: #0052cc;
                                      color: white;
                                      padding: 14px 32px;
                                      text-decoration: none;
                                      border-radius: 8px;
                                      font-weight: 600;
                                      font-size: 16px;
                                      display: inline-block;">
                              Complete My Profile
                            </a>
                          </div>
                          <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes.</p>
                        </div>
                      `
                    })
                  });

                  if (resendResponse.ok) {
                    const result = await resendResponse.json();
                    console.log(`✅ Magic link email sent successfully via Resend (Email ID: ${result.id})`);
                  } else {
                    const errorText = await resendResponse.text();
                    console.error(`❌ Failed to send magic link email: ${errorText}`);
                  }
                }
              } else {
                console.log('✅ Profile already exists for existing auth user');
              }
            } else {
              // Create new user
              console.log('Creating new user account');
              const { data: newAuthData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email: email,
                email_confirm: true // Auto-confirm email for paid users
              });

              if (authError) {
                console.error('Error creating user account:', authError);
                break;
              }

              userId = newAuthData.user.id;
              console.log('✅ Created new user account:', userId);

              // Create users table record first (required for foreign key)
              const { error: usersError } = await supabaseAdmin
                .from('users')
                .upsert({
                  id: userId,
                  email: email,
                  phone: hasValue(metadata.phone) ? metadata.phone : (stripePhone || null),
                  first_name: firstName,
                  last_name: lastName,
                  zip_code: zipCode,
                  mailing_address: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                  mailing_zip: zipCode,
                  home_address_full: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                }, {
                  onConflict: 'id'
                });

              if (usersError && !usersError.message.includes('duplicate')) {
                console.error('Users table error:', usersError);
              } else {
                console.log('✅ Created users table record');
              }

              // Create or update user profile (use UPSERT in case trigger already created empty profile)
              const { error: profileError } = await supabaseAdmin
                .from('user_profiles')
                .upsert({
                  user_id: userId,
                  email: email,
                  first_name: firstName,
                  last_name: lastName,
                  phone_number: hasValue(metadata.phone) ? metadata.phone : (stripePhone || null),
                  zip_code: zipCode,
                  vehicle_type: hasValue(metadata.vehicleType) ? metadata.vehicleType : 'P',
                  has_protection: true,
                  stripe_customer_id: session.customer as string, // CRITICAL: Save for future renewals
                  city_sticker_expiry: hasValue(metadata.citySticker) ? metadata.citySticker : null,
                  license_plate_expiry: hasValue(metadata.licensePlate) ? metadata.licensePlate : null,
                  mailing_address: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                  mailing_zip: zipCode,
                  street_address: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                  home_address_full: hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress,
                  has_permit_zone: metadata.hasPermitZone === 'true',
                  permit_requested: metadata.permitRequested === 'true',
                  residency_forwarding_consent_given: metadata.permitRequested === 'true', // Auto-consent if permit requested
                  // NOTE: permit_zones column does not exist in database - removed to prevent insert failure
                  updated_at: new Date().toISOString()
                }, {
                  onConflict: 'user_id'
                });

              if (profileError) {
                console.error('❌ CRITICAL ERROR creating user profile:', profileError);
                console.error('Session ID:', session.id);
                console.error('Email:', email);
                console.error('User ID:', userId);

                // Send immediate alert to admin
                try {
                  await resend.emails.send({
                    from: 'Alerts <alerts@autopilotamerica.com>',
                    to: 'randyvollrath@gmail.com',
                    subject: '🚨 CRITICAL: Protection Purchase Failed - Profile Creation Error',
                    text: `Profile creation failed for Protection purchase!\n\nSession: ${session.id}\nEmail: ${email}\nUser ID: ${userId}\nError: ${profileError.message}\n\nUser paid but got no account!`
                  });
                } catch (e) {
                  console.error('Failed to send alert email:', e);
                }

                // Return error so Stripe will retry
                return res.status(500).json({ error: 'Profile creation failed', details: profileError.message });
              } else {
                console.log('✅ Created user profile with Protection');

                // Auto-populate ward/section for street cleaning alerts
                if (hasValue(metadata.streetAddress)) {
                  try {
                    console.log('🗺️ Geocoding address to get ward/section:', metadata.streetAddress);
                    const geocodeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/find-section?address=${encodeURIComponent(metadata.streetAddress)}`);

                    if (geocodeResponse.ok) {
                      const geoData = await geocodeResponse.json();
                      console.log(`✅ Found Ward ${geoData.ward}, Section ${geoData.section}`);

                      // Update profile with ward/section
                      await supabaseAdmin
                        .from('user_profiles')
                        .update({
                          home_address_ward: geoData.ward,
                          home_address_section: geoData.section,
                          updated_at: new Date().toISOString()
                        })
                        .eq('user_id', userId);

                      console.log('✅ Ward/section saved - street cleaning alerts are now active');
                    } else {
                      console.log('ℹ️ Could not geocode address - user can set up street cleaning manually');
                    }
                  } catch (geoError) {
                    // Non-critical - user can set up street cleaning manually
                    console.log('ℹ️ Geocoding failed (non-critical):', geoError);
                  }
                }

                // Check if user needs winter ban notification (Dec 1 - Apr 1)
                if (hasValue(metadata.streetAddress)) {
                  try {
                    const winterBanResult = await notifyNewUserAboutWinterBan(
                      userId,
                      metadata.streetAddress,
                      email,
                      hasValue(metadata.phone) ? metadata.phone : null,
                      hasValue(metadata.firstName) ? metadata.firstName : null
                    );
                    if (winterBanResult.sent) {
                      console.log('❄️ Winter ban notification sent to new Protection user');
                    } else if (winterBanResult.reason) {
                      console.log(`ℹ️ Winter ban not sent: ${winterBanResult.reason}`);
                    }
                  } catch (winterError) {
                    // Don't fail checkout if winter ban notification fails
                    console.error('Winter ban notification failed (non-critical):', winterError);
                  }
                }
              }

              // Generate and send magic link for new users
              console.log('📧 Generating magic link for new user:', email);
              const { data: linkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'magiclink',
                email: email,
                options: {
                  redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?protection=true`
                }
              });

              if (magicLinkError) {
                console.error('Error generating magic link:', magicLinkError);
              } else if (linkData?.properties?.action_link) {
                console.log('✅ Magic link generated, sending via Resend...');

                // Send the magic link via Resend
                try {
                  const resendResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      from: 'Autopilot America <noreply@autopilotamerica.com>',
                      to: email,
                      subject: 'Welcome to Autopilot America - Complete Your Profile',
                      html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Autopilot America!</h2>

                          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                            Thanks for purchasing Ticket Protection! Click the button below to securely log in to your account and complete your profile:
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
                              Complete My Profile
                            </a>
                          </div>

                          <p style="color: #666; font-size: 14px; margin-top: 32px;">
                            <strong>Important:</strong> Your $200/year ticket guarantee requires a complete and accurate profile. Please verify all your information within 24 hours.
                          </p>

                          ${metadata.permitRequested === 'true' ? `
                          <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin-top: 16px;">
                            <p style="color: #92400e; font-size: 14px; font-weight: 600; margin: 0 0 8px 0;">
                              🅿️ Parking Permit Setup Required
                            </p>
                            <p style="color: #78350f; font-size: 13px; margin: 0; line-height: 1.5;">
                              You requested a residential parking permit. Please set up automatic email forwarding in your settings
                              so we always have fresh proof of residency (required within 30 days of permit renewal).
                            </p>
                          </div>
                          ` : ''}

                          <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes for security reasons.</p>

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
                    console.log('✅ Magic link email sent via Resend');
                  } else {
                    const errorText = await resendResponse.text();
                    console.error('Error sending magic link via Resend:', errorText);
                  }
                } catch (resendError) {
                  console.error('Error sending email via Resend:', resendError);
                }
              }

              // Log audit event for payment processing (new user)
              await logAuditEvent({
                userId: userId,
                actionType: 'payment_processed',
                entityType: 'payment',
                entityId: session.id,
                actionDetails: {
                  product: 'ticket_protection',
                  plan: metadata.plan,
                  amount: session.amount_total,
                  currency: session.currency,
                  email: email,
                  renewals: {
                    citySticker: metadata.citySticker || null,
                    licensePlate: metadata.licensePlate || null,
                    isVanity: metadata.isVanityPlate === 'true',
                  },
                  hasPermitZone: metadata.hasPermitZone === 'true',
                  streetAddress: metadata.streetAddress,
                  stripeCustomerId: session.customer,
                  rewardfulReferral: metadata.rewardful_referral_id,
                },
                status: 'success',
              });

              // Log user consent for legal compliance (new user)
              const consentTextNewUser = 'I authorize Autopilot America to act as my concierge service to monitor my vehicle renewal deadlines and coordinate renewals on my behalf. Autopilot America is not a government agency or licensed remitter. I authorize Autopilot America to charge my payment method for the subscription service fee plus government renewal fees (city sticker, license plate, parking permits) 30 days before my deadlines. Autopilot America will forward the government fees to our licensed remitter partner who will execute the official submission with the City of Chicago and State of Illinois. I understand that final acceptance is subject to approval by the issuing authority. I agree to provide accurate information and required documentation when requested.';

              const { error: consentErrorNewUser } = await supabaseAdmin
                .from('user_consents')
                .insert({
                  user_id: userId,
                  consent_type: 'protection_purchase',
                  consent_text: consentTextNewUser,
                  consent_granted: true,
                  stripe_session_id: session.id,
                  ip_address: session.customer_details?.address?.country || null,
                  metadata: {
                    plan: metadata.plan,
                    city_sticker: metadata.citySticker,
                    license_plate: metadata.licensePlate,
                    has_permit_zone: metadata.hasPermitZone === 'true',
                    street_address: metadata.streetAddress
                  }
                });

              if (consentErrorNewUser) {
                console.error('Error logging consent for new user:', consentErrorNewUser);
              } else {
                console.log('✅ User consent logged for legal compliance (new user)');
              }

              break; // Exit after creating new user
            }
          }

          // Update or create profile for existing user with has_protection=true and renewal dates
          const updateData: any = {
            user_id: userId,
            email: email,
            has_protection: true,
            stripe_customer_id: session.customer as string, // CRITICAL: Save for future renewals
            updated_at: new Date().toISOString()
          };

          // Add name from Stripe customer details
          if (firstName) updateData.first_name = firstName;
          if (lastName) updateData.last_name = lastName;

          // Add zip code
          if (zipCode) {
            updateData.zip_code = zipCode;
            updateData.mailing_zip = zipCode;
          }

          // Phone from metadata (Protection form) OR Stripe customer details
          if (hasValue(metadata.phone) || stripePhone) {
            updateData.phone_number = hasValue(metadata.phone) ? metadata.phone : stripePhone;
          }
          if (hasValue(metadata.vehicleType)) {
            updateData.vehicle_type = metadata.vehicleType;
          }
          if (hasValue(metadata.citySticker)) {
            updateData.city_sticker_expiry = metadata.citySticker;
          }
          if (hasValue(metadata.licensePlate)) {
            updateData.license_plate_expiry = metadata.licensePlate;
          }

          // Save permit zone data
          if (metadata.hasPermitZone === 'true') {
            updateData.has_permit_zone = true;
            updateData.permit_requested = metadata.permitRequested === 'true';
            updateData.residency_forwarding_consent_given = metadata.permitRequested === 'true'; // Auto-consent if permit requested
            // NOTE: permit_zones column does not exist in database - removed to prevent update failure
          }

          // Save street address as both mailing and street cleaning address (prefer metadata, fallback to billing)
          const addressToSave = hasValue(metadata.streetAddress) ? metadata.streetAddress : billingAddress;
          if (addressToSave) {
            updateData.mailing_address = addressToSave;
            updateData.street_address = addressToSave;
            updateData.home_address_full = addressToSave;
          }

          // Use upsert to create profile if it doesn't exist, or update if it does
          const { error: updateError } = await supabaseAdmin
            .from('user_profiles')
            .upsert(updateData, {
              onConflict: 'user_id'
            });

          if (updateError) {
            console.error('Error updating user profile with Protection:', updateError);
          } else {
            console.log('✅ User profile updated with Protection status and renewal dates');

            // NOTE: Remitter fee is NOT charged upfront
            // Remitter gets paid when they perform the renewal service (30 days before expiration)
            // This happens in /api/cron/process-renewals.ts

            // Auto-populate ward/section for street cleaning alerts
            if (addressToSave) {
              try {
                console.log('🗺️ Geocoding address to get ward/section:', addressToSave);
                const geocodeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/find-section?address=${encodeURIComponent(addressToSave)}`);

                if (geocodeResponse.ok) {
                  const geoData = await geocodeResponse.json();
                  console.log(`✅ Found Ward ${geoData.ward}, Section ${geoData.section}`);

                  // Update profile with ward/section
                  await supabaseAdmin
                    .from('user_profiles')
                    .update({
                      home_address_ward: geoData.ward,
                      home_address_section: geoData.section,
                      updated_at: new Date().toISOString()
                    })
                    .eq('user_id', userId);

                  console.log('✅ Ward/section saved - street cleaning alerts are now active');
                } else {
                  console.log('ℹ️ Could not geocode address - user can set up street cleaning manually');
                }
              } catch (geoError) {
                // Non-critical - user can set up street cleaning manually
                console.log('ℹ️ Geocoding failed (non-critical):', geoError);
              }
            }

            // Check if user needs winter ban notification (Dec 1 - Apr 1)
            if (hasValue(metadata.streetAddress)) {
              try {
                const winterBanResult = await notifyNewUserAboutWinterBan(
                  userId,
                  metadata.streetAddress,
                  email,
                  hasValue(metadata.phone) ? metadata.phone : null,
                  hasValue(metadata.firstName) ? metadata.firstName : null
                );
                if (winterBanResult.sent) {
                  console.log('❄️ Winter ban notification sent to Protection upgrade user');
                } else if (winterBanResult.reason) {
                  console.log(`ℹ️ Winter ban not sent: ${winterBanResult.reason}`);
                }
              } catch (winterError) {
                // Don't fail checkout if winter ban notification fails
                console.error('Winter ban notification failed (non-critical):', winterError);
              }
            }

            // Send magic link to existing users who purchased protection
            console.log('📧 Generating magic link for existing user upgrade:', email);
            const { data: linkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
              type: 'magiclink',
              email: email,
              options: {
                redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?protection=true`
              }
            });

            if (magicLinkError) {
              console.error('Error generating magic link for upgrade:', magicLinkError);
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
                    from: 'Autopilot America <noreply@autopilotamerica.com>',
                    to: email,
                    subject: 'Welcome to Autopilot Protection - Access Your Account',
                    html: `
                      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #1a1a1a; margin-bottom: 16px;">Your Protection is Active!</h2>

                        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                          Thanks for upgrading to Ticket Protection! Click the button below to access your account and verify your profile:
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
                          <strong>Important:</strong> Your $200/year ticket guarantee requires a complete and accurate profile. Please verify all your information.
                        </p>

                        <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes for security reasons.</p>

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
                  console.log('✅ Magic link email sent to upgraded user via Resend');
                } else {
                  const errorText = await resendResponse.text();
                  console.error('Error sending magic link via Resend:', errorText);
                }
              } catch (resendError) {
                console.error('Error sending email via Resend:', resendError);
              }
            }
          }

          // Log audit event for payment processing
          await logAuditEvent({
            userId: userId,
            actionType: 'payment_processed',
            entityType: 'payment',
            entityId: session.id,
            actionDetails: {
              product: 'ticket_protection',
              plan: metadata.plan,
              amount: session.amount_total,
              currency: session.currency,
              email: email,
              renewals: {
                citySticker: metadata.citySticker || null,
                licensePlate: metadata.licensePlate || null,
                isVanity: metadata.isVanityPlate === 'true',
              },
              hasPermitZone: metadata.hasPermitZone === 'true',
              streetAddress: metadata.streetAddress,
              stripeCustomerId: session.customer,
              rewardfulReferral: metadata.rewardful_referral_id,
            },
            status: 'success',
          });

          // Log user consent for legal compliance
          const consentText = 'I authorize Autopilot America to act as my concierge service to monitor my vehicle renewal deadlines and coordinate renewals on my behalf. Autopilot America is not a government agency or licensed remitter. I authorize Autopilot America to charge my payment method for the subscription service fee plus government renewal fees (city sticker, license plate, parking permits) 30 days before my deadlines. Autopilot America will forward the government fees to our licensed remitter partner who will execute the official submission with the City of Chicago and State of Illinois. I understand that final acceptance is subject to approval by the issuing authority. I agree to provide accurate information and required documentation when requested.';

          const { error: consentError } = await supabaseAdmin
            .from('user_consents')
            .insert({
              user_id: userId,
              consent_type: 'protection_purchase',
              consent_text: consentText,
              consent_granted: true,
              stripe_session_id: session.id,
              ip_address: session.customer_details?.address?.country || null,
              metadata: {
                plan: metadata.plan,
                city_sticker: metadata.citySticker,
                license_plate: metadata.licensePlate,
                has_permit_zone: metadata.hasPermitZone === 'true',
                street_address: metadata.streetAddress
              }
            });

          if (consentError) {
            console.error('Error logging consent:', consentError);
          } else {
            console.log('✅ User consent logged for legal compliance');
          }

          // Exit early for Protection purchases
          break;
        }

        // Regular signup flow continues below
        // Parse form data from split metadata fields
        console.log('Webhook metadata received:', {
          vehicleInfo: metadata.vehicleInfo,
          renewalDates: metadata.renewalDates,
          contactInfo: metadata.contactInfo,
          preferences: metadata.preferences,
          streetCleaning: metadata.streetCleaning
        });

        const vehicleInfo = JSON.parse(metadata.vehicleInfo || '{}');
        const renewalDates = JSON.parse(metadata.renewalDates || '{}');
        const contactInfo = JSON.parse(metadata.contactInfo || '{}');
        const preferences = JSON.parse(metadata.preferences || '{}');
        const streetCleaning = JSON.parse(metadata.streetCleaning || '{}');
        
        // DEBUG: Log parsed values to find missing data
        console.log('📊 PARSED WEBHOOK DATA:', {
          vehicleYear: vehicleInfo.vehicleYear,
          cityStickerExpiry: renewalDates.cityStickerExpiry,
          licensePlateExpiry: renewalDates.licensePlateExpiry,
          emissionsDate: renewalDates.emissionsDate,
          reminderDays: preferences.reminderDays,
          phone: contactInfo.phone,
          smsNotifications: preferences.smsNotifications,
          voiceNotifications: preferences.voiceNotifications
        });
        
        // Reconstruct form data
        const formData = {
          ...vehicleInfo,
          ...renewalDates,
          ...contactInfo,
          ...preferences,
          ...streetCleaning
        };

        console.log('Parsed form data for webhook:', formData);
        const email = metadata.email || session.customer_details?.email;
        const rewardfulReferralId = session.client_reference_id;
        
        if (rewardfulReferralId) {
          console.log('Rewardful referral ID found in webhook:', rewardfulReferralId);

          // Rewardful conversion is tracked automatically via Stripe integration
          // When client_reference_id is set in the Stripe session, Rewardful automatically:
          // 1. Creates a lead when the session is created
          // 2. Converts the lead when payment succeeds
          console.log('Rewardful conversion will be tracked automatically via Stripe integration');
          console.log('Referral ID in session:', rewardfulReferralId);
          console.log('Customer email:', email || session.customer_details?.email);

          // The conversion tracking is handled by Rewardful's Stripe webhook integration
          // No manual API calls needed - this is the recommended approach

          // Send email notification about affiliate sale
          const plan = metadata.plan || 'unknown';
          const totalAmount = session.amount_total ? (session.amount_total / 100) : 0;
          const expectedCommission = plan === 'monthly' ? 2.40 : plan === 'annual' ? 24.00 : 0;
          const actualCommission = plan === 'monthly' ? 53.40 : plan === 'annual' ? 534.00 : 0;

          // Save to database for tracking
          try {
            const { error: dbError } = await supabaseAdmin
              .from('affiliate_commission_tracker')
              .insert({
                stripe_session_id: session.id,
                customer_email: email || session.customer_details?.email || 'Unknown',
                plan,
                total_amount: totalAmount,
                expected_commission: expectedCommission,
                referral_id: rewardfulReferralId,
                commission_adjusted: false
              });

            if (dbError) {
              console.error('❌ Failed to save affiliate commission to database:', dbError);
            } else {
              console.log('✅ Affiliate commission saved to database');
            }
          } catch (dbSaveError) {
            console.error('❌ Error saving affiliate commission:', dbSaveError);
          }

          // Send email notification
          try {
            await resend.emails.send({
              from: 'Ticketless Alerts <noreply@autopilotamerica.com>',
              to: ['randyvollrath@gmail.com', 'ticketlessamerica@gmail.com'],
              subject: '🎉 Affiliate Sale - Manual Commission Adjustment Needed',
              html: `
                <h2>Affiliate Sale Completed</h2>
                <p>A Protection plan was just purchased through an affiliate referral.</p>

                <h3>Sale Details:</h3>
                <ul>
                  <li><strong>Customer:</strong> ${email || session.customer_details?.email || 'Unknown'}</li>
                  <li><strong>Plan:</strong> ${plan}</li>
                  <li><strong>Total Charge:</strong> $${totalAmount.toFixed(2)}</li>
                  <li><strong>Referral ID:</strong> ${rewardfulReferralId}</li>
                </ul>

                <h3>⚠️ Commission Adjustment Required:</h3>
                <p>Rewardful will calculate commission on the full charge amount (including renewal fees).</p>
                <ul>
                  <li><strong>Expected Commission:</strong> $${expectedCommission.toFixed(2)}/month (20% of subscription only)</li>
                  <li><strong>Actual Commission:</strong> ~$${actualCommission.toFixed(2)} (20% of total including renewal fees)</li>
                </ul>

                <p><strong>Action needed:</strong> Manually adjust the commission in the Rewardful dashboard to $${expectedCommission.toFixed(2)}/month.</p>

                <p><a href="https://app.getrewardful.com/dashboard" style="display: inline-block; padding: 10px 20px; background-color: #0070f3; color: white; text-decoration: none; border-radius: 5px;">Open Rewardful Dashboard</a></p>
              `
            });
            console.log('✅ Affiliate sale notification email sent');
          } catch (emailError) {
            console.error('❌ Failed to send affiliate sale notification:', emailError);
          }
        } else {
          console.log('No Rewardful referral ID found in session');
        }
        
        if (!email) {
          console.error('No email found in session');
          break;
        }

        // Create user account (no password - they'll use Google OAuth or set password later)
        console.log('Creating user with email:', email);
        
        if (!supabaseAdmin) {
          console.error('Supabase admin client not available - missing SUPABASE_SERVICE_ROLE_KEY');
          break;
        }
        
        // Check if user already exists (in case they signed up via Google first)
        const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
        const userExists = existingUser?.users?.find(u => u.email === email);
        
        let authData;
        if (userExists) {
          console.log('User already exists, using existing account:', userExists.id);
          authData = { user: userExists, session: null };
          
          // Update existing user profile with phone if provided
          const updateData: any = { 
            updated_at: new Date().toISOString()
          };
          
          if (formData.phone) {
            updateData.phone = formData.phone;
          }
          
          const { error: updateError } = await supabaseAdmin
            .from('users')
            .update(updateData)
            .eq('id', userExists.id);
            
          if (updateError) {
            console.log('Error updating existing user subscription status:', updateError);
          } else {
            console.log('Updated existing user subscription status to active');
          }
        } else {
          console.log('Creating new user account');
          const { data: newAuthData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: email,
            email_confirm: true // Auto-confirm email for paid users
            // No password - they'll use Google OAuth or magic links
          });

          if (authError) {
            console.error('Error creating user:', authError);
            break;
          }
          authData = newAuthData;
        }

        console.log('User created successfully:', authData.user?.id);

        if (authData.user) {
          // Check if user profile already exists (for Google OAuth users)
          const { data: existingProfile } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', authData.user.id)
            .single();
            
          if (!existingProfile) {
            // Create user record with only the fields that exist in the users table
            console.log('Creating user profile for user:', authData.user.id);
            
            const { error: userError } = await supabaseAdmin
              .from('users')
              .insert([{
                id: authData.user.id,
                email: email,
                phone: normalizePhoneNumber(formData.phone),
                first_name: formData.firstName || null,
                last_name: formData.lastName || null,
                notification_preferences: {
                  email: formData.emailNotifications !== false, // Default to true
                  sms: formData.smsNotifications || false,
                  voice: formData.voiceNotifications || false,
                  reminder_days: formData.reminderDays || [30, 7, 1]
                },
                // Form data fields that settings page expects
                license_plate: formData.licensePlate,
                vin: formData.vin,
                zip_code: formData.zipCode,
                vehicle_type: formData.vehicleType,
                vehicle_year: formData.vehicleYear,
                city_sticker_expiry: formData.cityStickerExpiry,
                license_plate_expiry: formData.licensePlateExpiry,
                emissions_date: formData.emissionsDate,
                street_address: formData.streetAddress,
                mailing_address: formData.mailingAddress,
                mailing_city: formData.mailingCity,
                mailing_state: formData.mailingState,
                mailing_zip: formData.mailingZip,
                concierge_service: formData.conciergeService || false,
                city_stickers_only: formData.cityStickersOnly || false,
                spending_limit: formData.spendingLimit || 500,
                email_verified: true, // Auto-verify for paid users
                phone_verified: false
              }]);

            if (userError) {
              console.error('Error creating user profile:', userError);
            } else {
              console.log('Successfully created user profile');
            }
            
            // CRITICAL: Also create user_profiles record for settings page
            console.log('Creating user_profiles record for settings page compatibility...');
            
            const userProfileData = {
              user_id: authData.user.id,
              email: email,
              phone_number: normalizePhoneNumber(formData.phone),
              phone: normalizePhoneNumber(formData.phone), // Some fields use 'phone' instead of 'phone_number'
              license_plate: formData.licensePlate || null,
              // Use new firstName/lastName fields from form
              first_name: formData.firstName || null,
              last_name: formData.lastName || null,
              // Vehicle information
              vin: formData.vin || null,
              vehicle_type: formData.vehicleType || null,
              vehicle_year: formData.vehicleYear || null,
              zip_code: formData.zipCode || null,
              // Renewal dates - CRITICAL for notifications
              city_sticker_expiry: formData.cityStickerExpiry || null,
              license_plate_expiry: formData.licensePlateExpiry || null,
              emissions_date: formData.emissionsDate || null,
              // Mailing address
              mailing_address: formData.mailingAddress || formData.streetAddress || null,
              mailing_city: formData.mailingCity || 'Chicago',
              mailing_state: formData.mailingState || 'IL',
              mailing_zip: formData.mailingZip || formData.zipCode || null,
              street_address: formData.streetAddress || null,
              // Street cleaning settings - CRITICAL for street cleaning notifications
              home_address_full: formData.homeAddress || formData.streetAddress || null,
              home_address_ward: formData.homeAddressWard || null,
              home_address_section: formData.homeAddressSection || null,
              // Map form notification preferences to Ticketless fields
              notify_email: formData.emailNotifications !== false, // Default to true
              notify_sms: formData.smsNotifications || false,
              notify_snow: false,
              notify_winter_parking: false,
              phone_call_enabled: formData.voiceNotifications || false,
              voice_calls_enabled: formData.voiceNotifications || false, // Duplicate field some places use
              notify_days_array: formData.reminderDays || [1, 7, 30], // Default reminder days
              notify_days_before: formData.reminderDays?.[0] || 1, // Primary reminder day
              notify_evening_before: formData.eveningBefore !== false,
              voice_preference: 'female',
              phone_call_time_preference: '7am',
              voice_call_time: '07:00',
              follow_up_sms: formData.followUpSms !== false,
              // Notification preferences object for new system
              notification_preferences: {
                email: formData.emailNotifications !== false,
                sms: formData.smsNotifications || false,
                voice: formData.voiceNotifications || false,
                reminder_days: formData.reminderDays || [1, 7, 30]
              },
              // All Ticketless users are paid
              sms_pro: true,
              is_paid: true,
              is_canary: false,
              role: 'user',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            
            let { error: profileError } = await supabaseAdmin
              .from('user_profiles')
              .insert([userProfileData]);
              
            // If insert failed due to name fields not existing, retry without them
            if (profileError && (profileError.message?.includes('first_name') || profileError.message?.includes('last_name'))) {
              console.log('Name fields not supported in database, retrying without them...');
              const dataWithoutNames = { ...userProfileData };
              delete dataWithoutNames.first_name;
              delete dataWithoutNames.last_name;
              
              const retryResult = await supabaseAdmin
                .from('user_profiles')
                .insert([dataWithoutNames]);
              profileError = retryResult.error;
            }
              
            if (profileError) {
              console.error('Error creating user_profiles record:', profileError);
            } else {
              console.log('Successfully created user_profiles record');

              // Check if user needs winter ban notification (Dec 1 - Apr 1)
              const userAddress = formData.homeAddress || formData.streetAddress;
              if (userAddress) {
                try {
                  const winterBanResult = await notifyNewUserAboutWinterBan(
                    user.id,
                    userAddress,
                    email,
                    formData.phone || null,
                    formData.firstName || null
                  );
                  if (winterBanResult.sent) {
                    console.log('❄️ Winter ban notification sent to new checkout user');
                  } else if (winterBanResult.reason) {
                    console.log(`ℹ️ Winter ban not sent: ${winterBanResult.reason}`);
                  }
                } catch (winterError) {
                  // Don't fail checkout if winter ban notification fails
                  console.error('Winter ban notification failed (non-critical):', winterError);
                }
              }

              // Auto-create Rewardful affiliate for customer referral program
              console.log('Creating Rewardful affiliate for customer referral program...');
              const affiliateData = await createRewardfulAffiliate({
                email: email,
                first_name: formData.firstName || email.split('@')[0],
                last_name: formData.lastName || '',
                campaign_id: process.env.REWARDFUL_CUSTOMER_CAMPAIGN_ID,
                stripe_customer_id: session.customer as string
              });

              if (affiliateData) {
                // Save affiliate ID to user profile
                await supabaseAdmin
                  .from('user_profiles')
                  .update({
                    affiliate_id: affiliateData.id,
                    affiliate_signup_date: new Date().toISOString()
                  })
                  .eq('user_id', authData.user.id);

                console.log('✅ Customer affiliate created:', {
                  id: affiliateData.id,
                  referral_link: affiliateData.links?.[0]?.url || `https://ticketlessamerica.com?via=${affiliateData.token}`
                });
              } else {
                console.log('⚠️ Could not create affiliate (non-blocking)');
              }
            }
          } else {
            console.log('User profile already exists, updating with form data...');
            
            // Update user_profiles with form data for existing user
            const userProfileUpdateData = {
              phone_number: normalizePhoneNumber(formData.phone),
              license_plate: formData.licensePlate || null,
              // Use new firstName/lastName fields from form
              first_name: formData.firstName || null,
              last_name: formData.lastName || null,
              notify_email: formData.emailNotifications !== false,
              notify_sms: formData.smsNotifications || false,
              phone_call_enabled: formData.voiceNotifications || false,
              notify_days_array: formData.reminderDays || [1],
              sms_pro: true,
              is_paid: true,
              updated_at: new Date().toISOString()
            };
            
            let { error: profileUpdateError } = await supabaseAdmin
              .from('user_profiles')
              .upsert([{ user_id: authData.user.id, email: email, ...userProfileUpdateData }]);
              
            // If update failed due to name fields not existing, retry without them
            if (profileUpdateError && (profileUpdateError.message?.includes('first_name') || profileUpdateError.message?.includes('last_name'))) {
              console.log('Name fields not supported in database, retrying without them...');
              const dataWithoutNames = { ...userProfileUpdateData };
              delete dataWithoutNames.first_name;
              delete dataWithoutNames.last_name;
              
              const retryResult = await supabaseAdmin
                .from('user_profiles')
                .upsert([{ user_id: authData.user.id, email: email, ...dataWithoutNames }]);
              profileUpdateError = retryResult.error;
            }
              
            if (profileUpdateError) {
              console.error('Error updating user_profiles record:', profileUpdateError);
            } else {
              console.log('Successfully updated user_profiles record');
            }
          }

          // Create vehicle record
          console.log('Creating vehicle for user:', authData.user.id);
          console.log('Form data for vehicle creation:', JSON.stringify({
            licensePlate: formData.licensePlate,
            vin: formData.vin,
            zipCode: formData.zipCode,
            vehicleYear: formData.vehicleYear
          }, null, 2));
          
          const vehicleInsertData = {
            user_id: authData.user.id,
            license_plate: formData.licensePlate,
            vin: formData.vin || null,
            year: formData.vehicleYear || null,
            zip_code: formData.zipCode,
            mailing_address: formData.mailingAddress || formData.streetAddress,
            mailing_city: formData.mailingCity || 'Chicago',
            mailing_state: formData.mailingState || 'IL',
            mailing_zip: formData.mailingZip || formData.zipCode,
            subscription_id: session.subscription?.toString(),
            subscription_status: 'active'
          };
          
          console.log('Vehicle insert data:', JSON.stringify(vehicleInsertData, null, 2));
          
          const { data: vehicleData, error: vehicleError } = await supabaseAdmin
            .from('vehicles')
            .insert([vehicleInsertData])
            .select()
            .single();

          if (vehicleError) {
            console.error('❌ Error creating vehicle:', JSON.stringify(vehicleError, null, 2));
            console.error('Vehicle error details:', vehicleError.message, vehicleError.code, vehicleError.details);
          } else {
            console.log('✅ Successfully created vehicle:', vehicleData?.id);

            // Create obligations for this vehicle
            const obligations = [];
            
            if (formData.cityStickerExpiry) {
              obligations.push({
                vehicle_id: vehicleData.id,
                user_id: authData.user.id,
                type: 'city_sticker',
                due_date: formData.cityStickerExpiry,
                completed: false
              });
            }

            if (formData.licensePlateExpiry) {
              obligations.push({
                vehicle_id: vehicleData.id,
                user_id: authData.user.id,
                type: 'license_plate',
                due_date: formData.licensePlateExpiry,
                completed: false
              });
            }

            if (formData.emissionsDate) {
              obligations.push({
                vehicle_id: vehicleData.id,
                user_id: authData.user.id,
                type: 'emissions',
                due_date: formData.emissionsDate,
                completed: false
              });
            }

            if (obligations.length > 0) {
              const { error: obligationsError } = await supabaseAdmin
                .from('obligations')
                .insert(obligations);

              if (obligationsError) {
                console.error('Error creating obligations:', obligationsError);
              } else {
                console.log('Successfully created obligations:', obligations.length);
              }
            }
          }

          // Generate and send welcome email with magic link for immediate access
          try {
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
              type: 'magiclink',
              email: email,
              options: {
                redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://ticketlessamerica.com'}/auth/callback`
              }
            });

            if (!linkError && linkData.properties?.action_link) {
              console.log('Magic link generated successfully for auto-login');
              
              // Send welcome email using your email service
              // For now, just log the link - you can implement email sending later
              console.log('Magic link for user:', linkData.properties.action_link);
            } else {
              console.error('Error generating magic link:', linkError);
            }
          } catch (emailError) {
            console.error('Error with magic link generation:', emailError);
          }

          // Legacy: Also create vehicle reminder for backward compatibility
          // Determine street cleaning address (use street address if provided, fallback to mailing address)
          const streetCleaningAddress = formData.streetCleaningAddress || 
                                      formData.streetAddress || 
                                      `${formData.mailingAddress}, ${formData.mailingCity}, ${formData.mailingState} ${formData.mailingZip}`;
          
          const { error: reminderError } = await supabaseAdmin
            .from('vehicle_reminders')
            .insert([{
              user_id: authData.user.id,
              license_plate: formData.licensePlate,
              vin: formData.vin || null,
              zip_code: formData.zipCode,
              city_sticker_expiry: formData.cityStickerExpiry,
              license_plate_expiry: formData.licensePlateExpiry,
              emissions_due_date: formData.emissionsDate || null,
              email: email,
              phone: normalizePhoneNumber(formData.phone) || undefined,
              notification_preferences: {
                email: formData.emailNotifications,
                sms: formData.smsNotifications,
                voice: formData.voiceNotifications,
                reminder_days: formData.reminderDays
              },
              service_plan: formData.billingPlan === 'monthly' ? 'pro' : 'pro',
              mailing_address: formData.mailingAddress,
              mailing_city: formData.mailingCity,
              mailing_state: 'IL',
              mailing_zip: formData.mailingZip,
              street_cleaning_address: streetCleaningAddress,
              completed: false,
              subscription_id: session.subscription?.toString(),
              subscription_status: 'active'
            }]);

          if (reminderError) {
            console.error('Error creating vehicle reminder:', reminderError);
            console.error('Reminder error details:', JSON.stringify(reminderError, null, 2));
          } else {
            console.log('Successfully created user and vehicle reminder');
            
            // Create account on mystreetcleaning.com with enhanced OAuth support
            console.log('🔄 Creating mystreetcleaning.com account for user');
            try {
              // Extract OAuth and notification data from user metadata if available
              const userMetadata = authData.user.user_metadata || {};
              
              const notificationPrefs = {
                email: formData.emailNotifications !== false,
                sms: formData.smsNotifications || false,
                voice: formData.voiceNotifications || false,
                days_before: formData.reminderDays || [1, 7, 30]
              };

              const mscResult = await syncUserToMyStreetCleaning(
                email,
                streetCleaningAddress,
                authData.user.id,
                {
                  googleId: userMetadata.sub || userMetadata.google_id,
                  name: userMetadata.full_name || userMetadata.name || formData.name,
                  notificationPreferences: notificationPrefs
                }
              );
              
              if (mscResult.success) {
                console.log('✅ Successfully created mystreetcleaning.com account:', mscResult.accountId);
                
                // Update user metadata to track MSC account creation
                try {
                  await supabaseAdmin.auth.admin.updateUserById(authData.user.id, {
                    user_metadata: {
                      ...userMetadata,
                      msc_account_created: true,
                      msc_account_id: mscResult.accountId
                    }
                  });
                } catch (metaError) {
                  console.error('Warning: Could not update user metadata:', metaError);
                }
              } else {
                console.error('❌ Failed to create mystreetcleaning.com account:', mscResult.error);
              }
            } catch (mscError) {
              console.error('❌ Error during mystreetcleaning.com integration:', mscError);
            }
          }
        }
      } catch (error) {
        console.error('Error processing checkout session:', error);
      }
      break;

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      const subscription = event.data.object as Stripe.Subscription;
      
      // Update subscription status
      if (supabaseAdmin) {
        await supabaseAdmin
          .from('vehicle_reminders')
          .update({ 
            subscription_status: subscription.status
          })
          .eq('subscription_id', subscription.id);
      }
      
      console.log(`Subscription ${subscription.id} status updated to: ${subscription.status}`);
      break;

    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log('Payment intent succeeded:', paymentIntent.id);

      // Check if this is a contest letter mailing payment
      if (paymentIntent.metadata?.service === 'contest_letter_mailing') {
        console.log('📮 Processing contest letter mailing payment');
        const contestId = paymentIntent.metadata.contestId;

        try {
          // Update contest record
          const { data: contest, error: contestError } = await supabaseAdmin
            .from('ticket_contests')
            .select('contest_letter, mailing_address, extracted_data')
            .eq('id', contestId)
            .single();

          if (contestError || !contest) {
            console.error('Contest not found:', contestId);
            break;
          }

          // Update payment status
          await supabaseAdmin
            .from('ticket_contests')
            .update({
              mail_service_payment_status: 'paid'
            })
            .eq('id', contestId);

          console.log('✅ Contest mail service payment marked as paid');

          // Import Lob service (note: will need to handle errors if LOB_API_KEY not set)
          try {
            const { sendLetter, formatLetterAsHTML, CHICAGO_PARKING_CONTEST_ADDRESS } = await import('../../lib/lob-service');

            const userAddress = paymentIntent.metadata.mailingAddress
              ? JSON.parse(paymentIntent.metadata.mailingAddress)
              : contest.mailing_address;

            // Get signature from extracted_data if available
            const signature = contest.extracted_data?.signature;
            const letterHTML = formatLetterAsHTML(contest.contest_letter, signature);

            const lobResponse = await sendLetter({
              from: userAddress, // User's address (return address on envelope)
              to: CHICAGO_PARKING_CONTEST_ADDRESS, // City department
              letterContent: letterHTML,
              description: `Contest letter for ticket ${paymentIntent.metadata.contestId}`,
              metadata: {
                contestId: contestId,
                paymentIntentId: paymentIntent.id
              }
            });

            // Update contest with Lob tracking info
            await supabaseAdmin
              .from('ticket_contests')
              .update({
                lob_mail_id: lobResponse.id,
                mail_status: 'sent',
                mail_sent_at: new Date().toISOString(),
                mail_tracking_url: lobResponse.url
              })
              .eq('id', contestId);

            console.log(`✅ Letter sent via Lob. ID: ${lobResponse.id}`);

          } catch (lobError: any) {
            console.error('Error sending letter via Lob:', lobError);
            // Update status to failed
            await supabaseAdmin
              .from('ticket_contests')
              .update({
                mail_status: 'failed'
              })
              .eq('id', contestId);
          }

        } catch (error) {
          console.error('Error processing mail service payment:', error);
        }
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
}