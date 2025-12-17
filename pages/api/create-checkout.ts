import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';
import { validateClientReferenceId } from '../../lib/webhook-validator';
import { sanitizeErrorMessage } from '../../lib/error-utils';
import stripeConfig from '../../lib/stripe-config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Rate limiting
  const ip = getClientIP(req);
  const rateLimitResult = await checkRateLimit(ip, 'checkout');

  res.setHeader('X-RateLimit-Limit', rateLimitResult.limit);
  res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);

  if (!rateLimitResult.allowed) {
    console.warn(`Rate limit exceeded for ${ip} on checkout`);
    return res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again in ${Math.ceil(rateLimitResult.resetIn / 1000)} seconds.`,
    });
  }

  const { email, licensePlate, billingPlan, formData, referralId } = req.body;

  console.log('Create checkout API called with referralId:', referralId);

  try {
    // Get Stripe price ID from env vars
    const isAnnual = billingPlan === 'annual';
    const stripePriceId = isAnnual
      ? stripeConfig.protectionAnnualPriceId
      : stripeConfig.protectionMonthlyPriceId;

    if (!stripePriceId) {
      const envVar = isAnnual ? 'STRIPE_PROTECTION_ANNUAL_PRICE_ID' : 'STRIPE_PROTECTION_MONTHLY_PRICE_ID';
      console.error(`Missing Stripe price ID: ${envVar}`);
      return res.status(500).json({ error: `Missing Stripe configuration: ${envVar}` });
    }

    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
      price: stripePriceId,
      quantity: 1
    };

    // Create Stripe checkout session
    const checkoutParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [lineItem],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://ticketlessamerica.com'}/auth/success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://ticketlessamerica.com'}/`,
      customer_email: email,
      metadata: {
        email,
        licensePlate,
        billingPlan,
        // Split form data into chunks to stay under 500 char limit per field
        vehicleInfo: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
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
          billingPlan: formData.billingPlan,
          conciergeService: formData.conciergeService,
          cityStickersOnly: formData.cityStickersOnly,
          spendingLimit: formData.spendingLimit
        }),
        streetCleaning: JSON.stringify({
          homeAddress: formData.homeAddress,
          homeAddressWard: formData.homeAddressWard,
          homeAddressSection: formData.homeAddressSection,
          morningReminder: formData.morningReminder,
          daysBefore: formData.streetCleaningDaysBefore,
          eveningBefore: formData.eveningBefore,
          followUpSms: formData.followUpSms,
          voiceCallEnabled: formData.streetCleaningVoiceCall
        })
      }
    };

    // SECURITY: Validate and sanitize client_reference_id
    if (referralId) {
      const validatedReferralId = validateClientReferenceId(referralId);
      if (validatedReferralId) {
        checkoutParams.client_reference_id = validatedReferralId;
        console.log('Added validated client_reference_id to Stripe:', validatedReferralId);
      } else {
        console.warn('Invalid referralId rejected:', referralId);
      }
    }

    // Record rate limit action
    await recordRateLimitAction(ip, 'checkout');

    console.log('Creating Stripe session');
    const session = await stripe.checkout.sessions.create(checkoutParams);
    console.log('Stripe session created with ID:', session.id);

    res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}