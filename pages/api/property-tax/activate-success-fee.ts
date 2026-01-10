/**
 * Activate Property Tax Appeal with Success Fee Model
 *
 * No upfront payment - user pays 25% of actual savings after successful appeal.
 * This endpoint marks the appeal as activated under the success fee model.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';
import { logAuditEvent, getIpAddress, getUserAgent } from '../../../lib/audit-logger';

// Input validation schema
const activateSchema = z.object({
  appealId: z.string().uuid('Invalid appeal ID'),
  successFeeRate: z.number().min(0.1).max(0.5).default(0.25),
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
    const parseResult = activateSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { appealId, successFeeRate } = parseResult.data;

    // Verify appeal exists and belongs to user
    const { data: appeal, error: appealError } = await supabaseAdmin
      .from('property_tax_appeals')
      .select('id, user_id, status, pricing_model, estimated_tax_savings')
      .eq('id', appealId)
      .single();

    if (appealError || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    if (appeal.user_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to this appeal' });
    }

    // Prevent double activation
    if (appeal.status === 'paid' || appeal.status === 'letter_generated') {
      return res.status(400).json({
        error: 'Appeal already activated',
        message: 'This appeal has already been paid for or activated.'
      });
    }

    // Record rate limit action
    await recordRateLimitAction(ip, 'property_tax_checkout');

    // Activate appeal with success fee model
    const { error: updateError } = await supabaseAdmin
      .from('property_tax_appeals')
      .update({
        status: 'paid', // Mark as paid to unlock letter generation
        pricing_model: 'success_fee',
        success_fee_rate: successFeeRate,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', appealId);

    if (updateError) {
      console.error('Failed to activate appeal:', updateError);
      return res.status(500).json({ error: 'Failed to activate appeal' });
    }

    console.log('✅ Property Tax appeal activated with success fee model:', appealId);

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      actionType: 'success_fee_activated',
      entityType: 'property_tax_appeal',
      entityId: appealId,
      actionDetails: {
        pricingModel: 'success_fee',
        successFeeRate,
        estimatedSavings: appeal.estimated_tax_savings,
        estimatedFee: appeal.estimated_tax_savings ? appeal.estimated_tax_savings * successFeeRate : null
      },
      status: 'success',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    return res.status(200).json({
      success: true,
      appealId,
      pricingModel: 'success_fee',
      successFeeRate,
      message: 'Appeal activated. You will only be charged if your appeal is successful.'
    });

  } catch (error: any) {
    console.error('Success fee activation error:', error);

    // Log failed activation
    try {
      await logAuditEvent({
        userId: undefined,
        actionType: 'success_fee_activated',
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
      error: 'Activation failed',
      message: 'Unable to activate your appeal. Please try again.'
    });
  }
}
