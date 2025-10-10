import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { logAuditEvent, getIpAddress, getUserAgent } from '../../../lib/audit-logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { billingPlan, email, phone, userId, rewardfulReferral, renewals, hasPermitZone, streetAddress, permitZones } = req.body;

  console.log('Protection checkout request:', {
    billingPlan,
    email,
    userId,
    rewardfulReferral,
    hasRenewals: !!renewals,
    hasPermitZone,
    streetAddress
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
      ? process.env.STRIPE_PROTECTION_MONTHLY_PRICE_ID
      : process.env.STRIPE_PROTECTION_ANNUAL_PRICE_ID;

    if (!priceId) {
      throw new Error('Stripe price ID not configured');
    }

    // Build line items array starting with subscription
    const lineItems: any[] = [
      {
        price: priceId,
        quantity: 1,
      },
    ];

    // Add renewal fees using permanent Stripe products (excluded from Rewardful via product metadata)
    if (renewals?.citySticker && process.env.STRIPE_CITY_STICKER_PRICE_ID) {
      lineItems.push({
        price: process.env.STRIPE_CITY_STICKER_PRICE_ID,
        quantity: 1,
      });
    }

    if (renewals?.licensePlate) {
      // Check if it's a vanity plate (costs $164 instead of $155)
      const isVanity = renewals.licensePlate.isVanity === true;
      const priceId = isVanity
        ? process.env.STRIPE_LICENSE_PLATE_VANITY_PRICE_ID
        : process.env.STRIPE_LICENSE_PLATE_PRICE_ID;

      if (priceId) {
        lineItems.push({
          price: priceId,
          quantity: 1,
        });
      }
    }

    // Add permit fee if in a permit zone
    if (hasPermitZone && process.env.STRIPE_PERMIT_FEE_PRICE_ID) {
      lineItems.push({
        price: process.env.STRIPE_PERMIT_FEE_PRICE_ID,
        quantity: 1,
      });
    }

    // Create Stripe Checkout session with mixed line items
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      // Use Rewardful referral ID as client_reference_id for tracking conversions
      client_reference_id: rewardfulReferral || userId || undefined,
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/alerts/success?protection=true&existing=${userId ? 'true' : 'false'}&email=${encodeURIComponent(email)}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/protection`,
      metadata: {
        userId: userId || '',
        email: email,
        phone: phone || '',
        plan: billingPlan,
        product: 'ticket_protection',
        citySticker: renewals?.citySticker ? renewals.citySticker.date : '',
        licensePlate: renewals?.licensePlate ? renewals.licensePlate.date : '',
        isVanityPlate: renewals?.licensePlate?.isVanity ? 'true' : 'false',
        streetAddress: streetAddress || '',
        hasPermitZone: hasPermitZone ? 'true' : 'false',
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