import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabase } from '../../lib/supabase';

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
      
      try {
        // Get session metadata
        const metadata = session.metadata;
        if (!metadata) {
          console.error('No metadata found in session');
          break;
        }

        // Parse form data from metadata
        const formData = JSON.parse(metadata.formData || '{}');
        const email = metadata.email || session.customer_details?.email;
        
        if (!email) {
          console.error('No email found in session');
          break;
        }

        // Create user account
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: email,
          password: 'temp-password-' + Math.random().toString(36),
          email_confirm: true
        });

        if (authError) {
          console.error('Error creating user:', authError);
          break;
        }

        if (authData.user) {
          // Create vehicle reminder record
          const { error: reminderError } = await supabase
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
              completed: false,
              subscription_id: session.subscription?.toString(),
              subscription_status: 'active'
            }]);

          if (reminderError) {
            console.error('Error creating vehicle reminder:', reminderError);
          } else {
            console.log('Successfully created user and vehicle reminder');
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
      await supabase
        .from('vehicle_reminders')
        .update({ 
          subscription_status: subscription.status
        })
        .eq('subscription_id', subscription.id);
      
      console.log(`Subscription ${subscription.id} status updated to: ${subscription.status}`);
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
}