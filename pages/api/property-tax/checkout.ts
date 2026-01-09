/**
 * Property Tax Appeal - Stripe Checkout
 *
 * Creates a Stripe Checkout session for the $179 appeal package.
 * On success, redirects to property-tax page with session token.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import stripeConfig from '../../../lib/stripe-config';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';
import { logAuditEvent, getIpAddress, getUserAgent } from '../../../lib/audit-logger';

// Get site URL with Vercel preview fallback
function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

// Input validation schema
const checkoutSchema = z.object({
  appealId: z.string().uuid('Invalid appeal ID'),
  pin: z.string().min(10, 'Invalid PIN').max(20),
  address: z.string().max(500),
  township: z.string().max(100),
  assessedValue: z.number().positive(),
  estimatedSavings: z.number().min(0),
  opportunityScore: z.number().min(0).max(100),
});

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

  try {
    // Rate limiting
    const ip = getClientIP(req);
    const rateLimitResult = await checkRateLimit(ip, 'property_tax_checkout');

    res.setHeader('X-RateLimit-Limit', rateLimitResult.limit);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in ${Math.ceil(rateLimitResult.resetIn / 1000)} seconds.`,
      });
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Validate request body
    const parseResult = checkoutSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { appealId, pin, address, township, assessedValue, estimatedSavings, opportunityScore } = parseResult.data;

    // Verify appeal exists and belongs to user
    const { data: appeal, error: appealError } = await supabaseAdmin
      .from('property_tax_appeals')
      .select('id, user_id, status, stripe_payment_intent_id')
      .eq('id', appealId)
      .single();

    if (appealError || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    if (appeal.user_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to this appeal' });
    }

    // Prevent double payment
    if (appeal.stripe_payment_intent_id) {
      return res.status(400).json({
        error: 'Payment already processed',
        message: 'This appeal has already been paid for.'
      });
    }

    // Record rate limit action
    await recordRateLimitAction(ip, 'property_tax_checkout');

    // Get or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: { userId: user.id }
      });
      customerId = customer.id;
    }

    // Determine price - use configured price or create ad-hoc if not set
    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (stripeConfig.propertyTaxAppealPriceId) {
      lineItems = [{
        price: stripeConfig.propertyTaxAppealPriceId,
        quantity: 1,
      }];
    } else {
      // Fallback: Create ad-hoc price (useful for testing)
      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Property Tax Appeal Package',
            description: `Appeal preparation for ${address} (PIN: ${pin})`,
          },
          unit_amount: 17900, // $179.00 in cents
        },
        quantity: 1,
      }];
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: lineItems,
      success_url: `${getSiteUrl()}/property-tax?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getSiteUrl()}/property-tax?canceled=true&appeal_id=${appealId}`,
      metadata: {
        product: 'property_tax_appeal',
        userId: user.id,
        appealId: appealId,
        pin: pin,
        address: address,
        township: township,
        assessedValue: String(assessedValue),
        estimatedSavings: String(Math.round(estimatedSavings)),
        opportunityScore: String(opportunityScore),
      },
      payment_intent_data: {
        metadata: {
          product: 'property_tax_appeal',
          userId: user.id,
          appealId: appealId,
          pin: pin,
        },
      },
    });

    console.log('✅ Property Tax checkout session created:', session.id);

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      actionType: 'checkout_initiated',
      entityType: 'property_tax_appeal',
      entityId: appealId,
      actionDetails: {
        sessionId: session.id,
        pin,
        address,
        township,
        assessedValue,
        estimatedSavings,
        opportunityScore,
      },
      status: 'success',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
    });

  } catch (error: any) {
    console.error('Property Tax checkout error:', error);

    // Log failed checkout
    try {
      await logAuditEvent({
        userId: undefined,
        actionType: 'checkout_initiated',
        entityType: 'property_tax_appeal',
        entityId: undefined,
        actionDetails: {
          error: error.message,
        },
        status: 'failure',
        errorMessage: error.message,
        ipAddress: getIpAddress(req),
        userAgent: getUserAgent(req),
      });
    } catch (logError) {
      console.error('Failed to log audit event:', logError);
    }

    return res.status(500).json({
      error: 'Checkout failed',
      message: 'Unable to create checkout session. Please try again.'
    });
  }
}
