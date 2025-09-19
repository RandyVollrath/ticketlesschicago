import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, licensePlate, billingPlan, formData, referralId } = req.body;

  try {
    // Create Stripe checkout session
    const checkoutParams: any = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'TicketlessChicago PRO - Complete Vehicle Compliance Service',
              description: `Hands-off vehicle compliance: We handle city sticker & license renewals, plus all alerts for ${licensePlate}`
            },
            unit_amount: billingPlan === 'annual' ? 10000 : 1000, // $100/year or $10/month
            recurring: {
              interval: billingPlan === 'annual' ? 'year' : 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `https://ticketlesschicago.com/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://ticketlesschicago.com/`,
      customer_email: email,
      metadata: {
        email,
        licensePlate,
        billingPlan,
        // Split form data into chunks to stay under 500 char limit per field
        vehicleInfo: JSON.stringify({
          name: formData.name,
          licensePlate: formData.licensePlate,
          vin: formData.vin,
          zipCode: formData.zipCode,
          vehicleType: formData.vehicleType,
          vehicleYear: formData.vehicleYear
        }),
        renewalDates: JSON.stringify({
          cityStickerExpiry: formData.cityStickerExpiry,
          licensePlateExpiry: formData.licensePlateExpiry,
          emissionsDate: formData.emissionsDate
        }),
        contactInfo: JSON.stringify({
          email: formData.email,
          phone: formData.phone,
          streetAddress: formData.streetAddress,
          mailingAddress: formData.mailingAddress,
          mailingCity: formData.mailingCity,
          mailingState: formData.mailingState,
          mailingZip: formData.mailingZip
        }),
        preferences: JSON.stringify({
          emailNotifications: formData.emailNotifications,
          smsNotifications: formData.smsNotifications,
          voiceNotifications: formData.voiceNotifications,
          reminderDays: formData.reminderDays,
          billingPlan: formData.billingPlan
        })
      }
    };

    // Add referral ID as client_reference_id if present
    if (referralId) {
      checkoutParams.client_reference_id = referralId;
    }

    const session = await stripe.checkout.sessions.create(checkoutParams);

    res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
}