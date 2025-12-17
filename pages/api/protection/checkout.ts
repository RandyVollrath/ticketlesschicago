import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { z } from 'zod';
import { logAuditEvent, getIpAddress, getUserAgent } from '../../../lib/audit-logger';
import stripeConfig from '../../../lib/stripe-config';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';
import { validateClientReferenceId } from '../../../lib/webhook-validator';
import { maskEmail } from '../../../lib/mask-pii';
import { sanitizeErrorMessage, isValidUSPhone, validateAndNormalizePhone } from '../../../lib/error-utils';

// Get site URL with Vercel preview fallback
function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  // Vercel provides VERCEL_URL for preview deployments
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // Fallback for local development
  return 'http://localhost:3000';
}

// Input validation schema
const checkoutSchema = z.object({
  billingPlan: z.enum(['monthly', 'annual'], {
    errorMap: () => ({ message: 'Billing plan must be "monthly" or "annual"' })
  }),
  email: z.string().email('Invalid email format').max(255).transform(val => val.toLowerCase().trim()),
  phone: z.string()
    .refine((val) => !val || isValidUSPhone(val), { message: 'Please enter a valid US phone number' })
    .transform((val) => val ? validateAndNormalizePhone(val) : null)
    .optional()
    .nullable(),
  userId: z.string().uuid().optional().nullable(),
  rewardfulReferral: z.string().max(100).optional().nullable(),
  renewals: z.object({
    citySticker: z.union([
      z.object({
        date: z.string().optional(),
        vehicleType: z.string().optional(),
      }),
      z.null(),
    ]).optional(),
    licensePlate: z.union([
      z.object({
        date: z.string().optional(),
        // New plateType field (preferred) - supports all IL plate types
        plateType: z.enum([
          'passenger_standard', 'passenger_personalized', 'passenger_vanity',
          'motorcycle_standard', 'motorcycle_personalized', 'motorcycle_vanity',
          'btruck_standard', 'btruck_personalized', 'btruck_vanity',
          'ctruck',
          'disability_standard', 'disability_personalized', 'disability_vanity',
          // Legacy values for backward compatibility
          'standard', 'personalized', 'vanity'
        ]).optional(),
        // Legacy isVanity field (deprecated, for backward compatibility)
        isVanity: z.boolean().optional(),
      }),
      z.null(),
    ]).optional(),
    cityVehicleSticker: z.boolean().optional(),
  }).optional().nullable(),
  hasPermitZone: z.boolean().optional(),
  streetAddress: z.string().max(500).optional().nullable(),
  vin: z.string().max(17).optional().nullable(),
  permitZones: z.array(
    z.union([
      z.string().max(50),
      z.object({
        ward: z.string().optional(),
        zone: z.string().optional(),
        status: z.string().optional(),
        addressRange: z.string().optional(),
      })
    ])
  ).optional().nullable(),
  vehicleType: z.enum(['MB', 'P', 'LP', 'ST', 'LT', 'standard', 'large']).optional(),
  permitRequested: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
});

const stripe = new Stripe(stripeConfig.secretKey!, {
  apiVersion: '2024-12-18.acacia',
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // SECURITY: Rate limiting
    const ip = getClientIP(req);
    const rateLimitResult = await checkRateLimit(ip, 'checkout');

    res.setHeader('X-RateLimit-Limit', rateLimitResult.limit);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);

    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for ${ip} on protection checkout`);
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in ${Math.ceil(rateLimitResult.resetIn / 1000)} seconds.`,
      });
    }

    // Validate request body
    const parseResult = checkoutSchema.safeParse(req.body);

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      console.warn('Checkout validation failed:', errors);
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    const { billingPlan, email, phone, userId, rewardfulReferral, renewals, hasPermitZone, streetAddress, vin, permitZones, vehicleType, permitRequested, smsConsent } = parseResult.data;

    console.log('Protection checkout request:', {
      billingPlan,
      email: maskEmail(email),
      userId: userId ? userId.substring(0, 8) + '...' : null,
      rewardfulReferral,
      hasRenewals: !!renewals,
      hasPermitZone,
      permitRequested,
      vehicleType
    });
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

    // Record rate limit action
    await recordRateLimitAction(ip, 'checkout');

    // SECURITY: Validate client_reference_id
    const validatedReferralId = validateClientReferenceId(rewardfulReferral);

    // Create Stripe Checkout session with mixed line items
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      // Use validated Rewardful referral ID as client_reference_id for tracking conversions
      client_reference_id: validatedReferralId || userId || undefined,
      mode: 'subscription',
      line_items: lineItems,
      // IMPORTANT: Save payment method for future renewal charges
      // With 'always', Stripe automatically saves the payment method to the subscription
      payment_method_collection: 'always',
      success_url: `${getSiteUrl()}/alerts/success?protection=true&existing=${userId ? 'true' : 'false'}&email=${encodeURIComponent(email)}`,
      cancel_url: `${getSiteUrl()}/protection`,
      metadata: {
        userId: userId || '',
        email: email,
        phone: phone || '',
        plan: billingPlan,
        product: 'ticket_protection',
        vehicleType: vehicleType || 'P',
        citySticker: renewals?.citySticker ? renewals.citySticker.date : '',
        licensePlate: renewals?.licensePlate ? renewals.licensePlate.date : '',
        // License plate type: standard, personalized, vanity, or electric
        licensePlateType: renewals?.licensePlate?.plateType || 'standard',
        // Legacy isVanity flag for backward compatibility (derived from plateType)
        isVanityPlate: (renewals?.licensePlate?.plateType === 'vanity' || renewals?.licensePlate?.isVanity) ? 'true' : 'false',
        // Is personalized plate (letters + numbers)
        isPersonalizedPlate: renewals?.licensePlate?.plateType === 'personalized' ? 'true' : 'false',
        // Is electric vehicle plate
        isElectricPlate: renewals?.licensePlate?.plateType === 'electric' ? 'true' : 'false',
        streetAddress: streetAddress || '',
        vin: vin || '',
        hasPermitZone: hasPermitZone ? 'true' : 'false',
        permitRequested: permitRequested ? 'true' : 'false',
        permitZones: hasPermitZone && permitZones ? JSON.stringify(permitZones) : '',
        rewardful_referral_id: rewardfulReferral || '',
        smsConsent: smsConsent === true ? 'true' : 'false' // TCPA compliance - track SMS consent
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
          licensePlateType: renewals?.licensePlate?.plateType || 'standard',
          isVanity: renewals?.licensePlate?.plateType === 'vanity' || renewals?.licensePlate?.isVanity || false,
          isPersonalized: renewals?.licensePlate?.plateType === 'personalized' || false,
          isElectric: renewals?.licensePlate?.plateType === 'electric' || false,
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

    // Log failed checkout attempt - use try-catch since variables may not be defined
    try {
      await logAuditEvent({
        userId: undefined,
        actionType: 'subscription_created',
        entityType: 'subscription',
        entityId: undefined,
        actionDetails: {
          error: error.message,
          requestBody: JSON.stringify(req.body || {}).substring(0, 500),
        },
        status: 'failure',
        errorMessage: error.message,
        ipAddress: getIpAddress(req),
        userAgent: getUserAgent(req),
      });
    } catch (logError) {
      console.error('Failed to log audit event:', logError);
    }

    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}