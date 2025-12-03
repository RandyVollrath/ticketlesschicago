import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { logAuditEvent, getIpAddress, getUserAgent } from '../../../lib/audit-logger';
import stripeConfig from '../../../lib/stripe-config';

const stripe = new Stripe(stripeConfig.secretKey!, {
  apiVersion: '2024-12-18.acacia',
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { billingPlan, email, phone, userId, rewardfulReferral, renewals, hasPermitZone, streetAddress, permitZones, vehicleType, permitRequested } = req.body;

  console.log('Protection checkout request:', {
    billingPlan,
    email,
    userId,
    rewardfulReferral,
    hasRenewals: !!renewals,
    hasPermitZone,
    permitRequested,
    streetAddress,
    vehicleType
  });

  if (!email || typeof email !== 'string' || email.trim() === '') {
    console.error('Missing or invalid email:', email);
    return res.status(400).json({ error: 'Missing required field: email' });
  }

  if (!billingPlan) {
    console.error('Missing billingPlan');
    return res.status(400).json({ error: 'Missing required field: billingPlan' });
  }

  if (billingPlan !== 'monthly' && billingPlan !== 'annual') {
    console.error('Invalid billing plan:', billingPlan);
    return res.status(400).json({ error: 'Invalid billing plan. Must be "monthly" or "annual"' });
  }

  try {
    // Create Stripe price IDs based on plan
    const priceId = billingPlan === 'monthly'
      ? stripeConfig.protectionMonthlyPriceId
      : stripeConfig.protectionAnnualPriceId;

    if (!priceId) {
      throw new Error(`Stripe price ID not configured for ${stripeConfig.mode} mode`);
    }

    // Build line items array - ONLY the subscription
    // Renewal fees are charged separately 30 days before due date via cron job
    const lineItems: any[] = [
      {
        price: priceId,
        quantity: 1,
      },
    ];

    // NOTE: We do NOT charge renewal fees upfront at signup!
    // - City sticker renewal fees are charged 30 days before expiration
    // - License plate renewal fees are charged 30 days before expiration
    // - Permit fees are charged when user submits permit zone documents
    // - These are all one-time charges handled by /api/cron/process-all-renewals
    //
    // Initial checkout = ONLY the $12/month (or $99/year) subscription
    // User gets protection service immediately
    // Renewal charges happen automatically before due dates

    // Create Stripe Checkout session with mixed line items
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      // Use Rewardful referral ID as client_reference_id for tracking conversions
      client_reference_id: rewardfulReferral || userId || undefined,
      mode: 'subscription',
      line_items: lineItems,
      // IMPORTANT: Save payment method for future renewal charges
      // With 'always', Stripe automatically saves the payment method to the subscription
      payment_method_collection: 'always',
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/alerts/success?protection=true&existing=${userId ? 'true' : 'false'}&email=${encodeURIComponent(email)}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/protection`,
      metadata: {
        userId: userId || '',
        email: email,
        phone: phone || '',
        plan: billingPlan,
        product: 'ticket_protection',
        vehicleType: vehicleType || 'P',
        citySticker: renewals?.citySticker ? renewals.citySticker.date : '',
        licensePlate: renewals?.licensePlate ? renewals.licensePlate.date : '',
        isVanityPlate: renewals?.licensePlate?.isVanity ? 'true' : 'false',
        streetAddress: streetAddress || '',
        hasPermitZone: hasPermitZone ? 'true' : 'false',
        permitRequested: permitRequested ? 'true' : 'false',
        permitZones: hasPermitZone && permitZones ? JSON.stringify(permitZones) : '',
        rewardful_referral_id: rewardfulReferral || ''
      }
    });

    console.log('✅ Stripe checkout session created:', session.id);

    // Log audit event
    await logAuditEvent({
      userId: userId,
      actionType: 'subscription_created',
      entityType: 'subscription',
      entityId: session.id,
      actionDetails: {
        billingPlan,
        email,
        phone,
        hasPermitZone,
        streetAddress,
        vehicleType: vehicleType || 'P',
        renewals: {
          citySticker: renewals?.citySticker ? true : false,
          licensePlate: renewals?.licensePlate ? true : false,
          isVanity: renewals?.licensePlate?.isVanity || false,
        },
        rewardfulReferral,
      },
      status: 'success',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    return res.status(200).json({
      sessionId: session.id,
      url: session.url
    });

  } catch (error: any) {
    console.error('Checkout error:', error);

    // Log failed checkout attempt
    await logAuditEvent({
      userId: userId,
      actionType: 'subscription_created',
      entityType: 'subscription',
      entityId: undefined,
      actionDetails: {
        billingPlan,
        email,
        error: error.message,
      },
      status: 'failure',
      errorMessage: error.message,
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}