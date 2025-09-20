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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature']!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      buf.toString(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook error:', err.message);
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
          
          // Notify Rewardful about the conversion
          try {
            const rewardfulConversionData = {
              referral: rewardfulReferralId,
              customer_id: session.customer || authData?.user?.id,
              amount: session.amount_total ? (session.amount_total / 100) : 0, // Convert cents to dollars
              currency: session.currency || 'usd',
              email: email
            };
            
            console.log('Sending conversion to Rewardful:', rewardfulConversionData);
            
            const rewardfulResponse = await fetch('https://api.rewardful.com/conversions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.REWARDFUL_API_SECRET}`
              },
              body: JSON.stringify(rewardfulConversionData)
            });
            
            if (rewardfulResponse.ok) {
              console.log('Successfully reported conversion to Rewardful');
            } else {
              const errorText = await rewardfulResponse.text();
              console.error('Failed to report conversion to Rewardful:', rewardfulResponse.status, errorText);
            }
          } catch (rewardfulError) {
            console.error('Error reporting to Rewardful:', rewardfulError);
          }
        } else {
          console.log('No Rewardful referral ID found in session');
        }
        
        if (!email) {
          console.error('No email found in session');
          break;
        }

        // Create user account
        console.log('Creating user with email:', email);
        
        if (!supabaseAdmin) {
          console.error('Supabase admin client not available - missing SUPABASE_SERVICE_ROLE_KEY');
          break;
        }
        
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: email,
          password: 'temp-password-' + Math.random().toString(36),
          email_confirm: true // Auto-confirm email for paid users
        });

        if (authError) {
          console.error('Error creating user:', authError);
          break;
        }

        console.log('User created successfully:', authData.user?.id);

        if (authData.user) {
          // Create user record in new database structure
          console.log('Creating user profile for user:', authData.user.id);
          
          const { error: userError } = await supabaseAdmin
            .from('users')
            .insert([{
              id: authData.user.id,
              email: email,
              phone: formData.phone,
              first_name: formData.name?.split(' ')[0] || null,
              last_name: formData.name?.split(' ').slice(1).join(' ') || null,
              notification_preferences: {
                email: formData.emailNotifications,
                sms: formData.smsNotifications,
                voice: formData.voiceNotifications,
                reminder_days: formData.reminderDays
              },
              email_verified: true, // Auto-verify for paid users
              phone_verified: false
            }]);

          if (userError) {
            console.error('Error creating user profile:', userError);
          } else {
            console.log('Successfully created user profile');
          }

          // Create vehicle record
          console.log('Creating vehicle for user:', authData.user.id);
          console.log('Form data:', formData);
          
          const { data: vehicleData, error: vehicleError } = await supabaseAdmin
            .from('vehicles')
            .insert([{
              user_id: authData.user.id,
              license_plate: formData.licensePlate,
              vin: formData.vin || null,
              year: formData.vehicleYear || null,
              zip_code: formData.zipCode,
              mailing_address: formData.mailingAddress,
              mailing_city: formData.mailingCity,
              mailing_state: 'IL',
              mailing_zip: formData.mailingZip,
              subscription_id: session.subscription?.toString(),
              subscription_status: 'active'
            }])
            .select()
            .single();

          if (vehicleError) {
            console.error('Error creating vehicle:', vehicleError);
          } else {
            console.log('Successfully created vehicle:', vehicleData.id);

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

          // Send welcome email with login instructions
          try {
            const { error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
              type: 'magiclink',
              email: email,
              options: {
                redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/dashboard`
              }
            });

            if (!magicLinkError) {
              console.log('Welcome email with login link sent successfully');
            } else {
              console.error('Error sending welcome email:', magicLinkError);
            }
          } catch (emailError) {
            console.error('Error with welcome email process:', emailError);
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
            
            // Create account on mystreetcleaning.com
            console.log('🔄 Creating mystreetcleaning.com account for user');
            try {
              const mscResult = await syncUserToMyStreetCleaning(
                email,
                streetCleaningAddress,
                authData.user.id
              );
              
              if (mscResult.success) {
                console.log('✅ Successfully created mystreetcleaning.com account:', mscResult.accountId);
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