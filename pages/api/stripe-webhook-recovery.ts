import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../lib/supabase';

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

// EMERGENCY WEBHOOK HANDLER - Processes webhooks without signature verification
// Only use this temporarily while fixing the webhook secret issue
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🚨 EMERGENCY WEBHOOK HANDLER - Processing without signature verification');
  
  const buf = await buffer(req);
  let event: any;
  
  try {
    // Parse the event without signature verification
    event = JSON.parse(buf.toString());
    console.log('Event type:', event.type);
    console.log('Event ID:', event.id);
  } catch (err: any) {
    console.error('Failed to parse webhook body:', err.message);
    return res.status(400).send(`Invalid JSON: ${err.message}`);
  }

  // Handle the events
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Processing checkout session:', session.id);
      
      try {
        // Get session metadata
        const metadata = session.metadata;
        if (!metadata) {
          console.error('No metadata found in session');
          break;
        }

        // Parse form data from split metadata fields
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

        const email = metadata.email || session.customer_details?.email;
        
        if (!email) {
          console.error('No email found in session');
          break;
        }

        console.log('Processing for user:', email);
        
        // Check if user exists
        const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
        const userExists = existingUser?.users?.find(u => u.email === email);
        
        if (!userExists) {
          console.error('User not found:', email);
          break;
        }

        const userId = userExists.id;

        // Create vehicle record
        const vehicleData = {
          user_id: userId,
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

        const { data: vehicle, error: vehicleError } = await supabaseAdmin
          .from('vehicles')
          .insert([vehicleData])
          .select()
          .single();

        if (vehicleError) {
          console.error('Error creating vehicle:', vehicleError);
        } else {
          console.log('✅ Vehicle created:', vehicle.id);
          
          // Create obligations
          const obligations = [];
          if (formData.cityStickerExpiry) {
            obligations.push({
              vehicle_id: vehicle.id,
              user_id: userId,
              type: 'city_sticker',
              due_date: formData.cityStickerExpiry,
              completed: false
            });
          }
          
          if (formData.licensePlateExpiry) {
            obligations.push({
              vehicle_id: vehicle.id,
              user_id: userId,
              type: 'license_plate',
              due_date: formData.licensePlateExpiry,
              completed: false
            });
          }
          
          if (obligations.length > 0) {
            await supabaseAdmin.from('obligations').insert(obligations);
            console.log('✅ Obligations created:', obligations.length);
          }
        }

        console.log('✅ Webhook processed successfully');
      } catch (error) {
        console.error('Error processing checkout session:', error);
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
}