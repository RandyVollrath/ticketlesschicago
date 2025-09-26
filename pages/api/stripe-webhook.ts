import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../lib/supabase';
import { syncUserToMyStreetCleaning } from '../../lib/mystreetcleaning-integration';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

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
  const sig = req.headers['stripe-signature']!;

  let event: Stripe.Event;

  try {
    // In production, Vercel env vars are used, not .env.local
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.error('❌ STRIPE_WEBHOOK_SECRET is not set in environment variables!');
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
      console.log('✅ Webhook signature verified successfully');
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

        // Parse form data from split metadata fields
        console.log('Webhook metadata received:', {
          vehicleInfo: metadata.vehicleInfo,
          renewalDates: metadata.renewalDates,
          contactInfo: metadata.contactInfo,
          preferences: metadata.preferences
        });

        const vehicleInfo = JSON.parse(metadata.vehicleInfo || '{}');
        const renewalDates = JSON.parse(metadata.renewalDates || '{}');
        const contactInfo = JSON.parse(metadata.contactInfo || '{}');
        const preferences = JSON.parse(metadata.preferences || '{}');
        
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
          ...preferences
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
                phone: formData.phone || null,
                first_name: formData.name ? formData.name.split(' ')[0] : null,
                last_name: formData.name ? formData.name.split(' ').slice(1).join(' ') : null,
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
              phone_number: formData.phone || null,
              license_plate: formData.licensePlate || null,
              // Extract name from form data
              first_name: formData.name ? formData.name.split(' ')[0] : null,
              last_name: formData.name ? formData.name.split(' ').slice(1).join(' ') : null,
              // Map form notification preferences to Ticketless fields
              notify_email: formData.emailNotifications !== false, // Default to true
              notify_sms: formData.smsNotifications || false,
              notify_snow: false,
              notify_winter_parking: false,
              phone_call_enabled: formData.voiceNotifications || false,
              notify_days_array: formData.reminderDays || [1], // Default to day-before
              notify_evening_before: true,
              voice_preference: 'female',
              phone_call_time_preference: '7am',
              follow_up_sms: true,
              // All Ticketless users are paid
              sms_pro: true,
              is_paid: true,
              is_canary: false,
              role: 'user'
            };
            
            const { error: profileError } = await supabaseAdmin
              .from('user_profiles')
              .insert([userProfileData]);
              
            if (profileError) {
              console.error('Error creating user_profiles record:', profileError);
            } else {
              console.log('Successfully created user_profiles record');
            }
          } else {
            console.log('User profile already exists, updating with form data...');
            
            // Update user_profiles with form data for existing user
            const userProfileUpdateData = {
              phone_number: formData.phone || null,
              license_plate: formData.licensePlate || null,
              // Extract name from form data
              first_name: formData.name ? formData.name.split(' ')[0] : null,
              last_name: formData.name ? formData.name.split(' ').slice(1).join(' ') : null,
              notify_email: formData.emailNotifications !== false,
              notify_sms: formData.smsNotifications || false,
              phone_call_enabled: formData.voiceNotifications || false,
              notify_days_array: formData.reminderDays || [1],
              sms_pro: true,
              is_paid: true,
              updated_at: new Date().toISOString()
            };
            
            const { error: profileUpdateError } = await supabaseAdmin
              .from('user_profiles')
              .upsert([{ user_id: authData.user.id, email: email, ...userProfileUpdateData }]);
              
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
                redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://ticketlessamerica.com'}/dashboard`
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
              phone: formData.phone,
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

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
}