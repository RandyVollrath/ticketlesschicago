import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { logAuditEvent } from '../../../lib/audit-logger';

/**
 * Remitter API Endpoint - Confirm City Payment
 *
 * Called by remitter after successfully submitting renewal to city
 * Updates city_payment_status from 'pending' to 'paid'
 *
 * POST /api/remitter/confirm-payment
 *
 * Body:
 * {
 *   "user_id": "uuid",
 *   "renewal_type": "city_sticker" | "license_plate",
 *   "due_date": "2026-12-15",
 *   "city_confirmation_number": "CHI-2026-12345",
 *   "notes": "optional notes"
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authentication - Remitter must provide API key
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.REMITTER_API_KEY;

  if (!expectedKey) {
    console.error('REMITTER_API_KEY not configured!');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    console.warn('Unauthorized remitter API access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    user_id,
    renewal_type,
    due_date,
    city_confirmation_number,
    notes
  } = req.body;

  // Validation
  if (!user_id || !renewal_type || !due_date) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['user_id', 'renewal_type', 'due_date']
    });
  }

  if (!['city_sticker', 'license_plate'].includes(renewal_type)) {
    return res.status(400).json({
      error: 'Invalid renewal_type',
      allowed: ['city_sticker', 'license_plate']
    });
  }

  try {
    // Find the specific renewal record
    const { data: renewal, error: findError } = await supabaseAdmin
      .from('renewal_payments')
      .select('*')
      .eq('user_id', user_id)
      .eq('renewal_type', renewal_type)
      .eq('due_date', due_date)
      .maybeSingle();

    if (findError) {
      console.error('Error finding renewal:', findError);
      return res.status(500).json({ error: 'Database error', details: findError.message });
    }

    if (!renewal) {
      return res.status(404).json({
        error: 'Renewal not found',
        message: `No renewal found for user ${user_id}, type ${renewal_type}, due date ${due_date}`
      });
    }

    // Check if already confirmed
    if (renewal.city_payment_status === 'paid') {
      return res.status(200).json({
        success: true,
        message: 'Renewal already confirmed',
        warning: 'This renewal was already marked as paid',
        renewal: {
          id: renewal.id,
          city_confirmation_number: renewal.city_confirmation_number,
          confirmed_at: renewal.updated_at
        }
      });
    }

    // Check if user actually paid us first
    if (renewal.payment_status !== 'paid') {
      return res.status(400).json({
        error: 'User payment not completed',
        message: 'Cannot confirm city payment before user pays us',
        payment_status: renewal.payment_status
      });
    }

    // Update city payment status
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('renewal_payments')
      .update({
        city_payment_status: 'paid',
        city_confirmation_number: city_confirmation_number || null,
        metadata: {
          ...renewal.metadata,
          remitter_confirmed_at: new Date().toISOString(),
          remitter_notes: notes || null
        }
      })
      .eq('id', renewal.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating renewal:', updateError);
      return res.status(500).json({ error: 'Update failed', details: updateError.message });
    }

    // Log audit event
    await logAuditEvent({
      userId: user_id,
      actionType: 'city_payment_confirmed',
      entityType: 'renewal_payment',
      entityId: renewal.id,
      actionDetails: {
        renewal_type,
        due_date,
        city_confirmation_number,
        notes,
        previous_status: renewal.city_payment_status,
        new_status: 'paid'
      },
      status: 'success',
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    console.log(`✅ City payment confirmed: ${renewal_type} for user ${user_id}, due ${due_date}`);

    return res.status(200).json({
      success: true,
      message: 'City payment confirmed successfully',
      renewal: {
        id: updated.id,
        user_id: updated.user_id,
        renewal_type: updated.renewal_type,
        due_date: updated.due_date,
        city_payment_status: updated.city_payment_status,
        city_confirmation_number: updated.city_confirmation_number,
        confirmed_at: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Unexpected error in confirm-payment:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
