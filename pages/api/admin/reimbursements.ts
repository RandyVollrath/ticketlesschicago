import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { ACTIVE_AUTOPILOT_PLAN } from '../../../lib/autopilot-plans';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-11-17.clover' })
  : null;

type LegacyTicketDetails = {
  email?: string;
  firstName?: string;
  lastName?: string;
  licensePlate?: string;
  ticketNumber?: string | null;
  ticketDate?: string;
  ticketAmount?: number;
  ticketType?: string;
  ticketDescription?: string | null;
  ticketAddress?: string | null;
  frontPhotoUrl?: string;
  backPhotoUrl?: string;
  paymentMethod?: string | null;
  paymentDetails?: string | null;
};

function parseDetails(notes: string | null): LegacyTicketDetails {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === 'object') return parsed as LegacyTicketDetails;
  } catch {}
  return {};
}

function mapStatusToLegacy(status: string): string {
  if (status === 'submitted' || status === 'needs_info') return 'pending';
  if (status === 'refunded') return 'paid';
  return status;
}

function mapStatusFromLegacy(status: string): string {
  if (status === 'pending') return 'submitted';
  if (status === 'paid') return 'refunded';
  return status;
}

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'PATCH') {
    return handlePatch(req, res, adminUser);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { data: claimsRaw, error } = await supabaseAdmin
      .from('guarantee_claims' as any)
      .select('*')
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('Error fetching guarantee claims:', error);
      return res.status(500).json({ error: 'Failed to fetch guarantee claims' });
    }

    const claims = (claimsRaw || []) as any[];
    const requests = claims.map((claim: any) => {
      const details = parseDetails(claim.notes);
      const ticketAmount = Number(details.ticketAmount || 0);
      const refundAmount = claim.refund_amount_cents ? claim.refund_amount_cents / 100 : null;

      return {
        id: claim.id,
        user_id: claim.user_id,
        email: claim.account_email || details.email || '',
        first_name: details.firstName || '',
        last_name: details.lastName || '',
        license_plate: details.licensePlate || '',
        ticket_number: details.ticketNumber || claim.ticket_ids || null,
        ticket_date: details.ticketDate || claim.submitted_at,
        ticket_amount: ticketAmount,
        ticket_type: details.ticketType || 'unknown',
        ticket_description: details.ticketDescription || null,
        ticket_address: details.ticketAddress || null,
        front_photo_url: details.frontPhotoUrl || '',
        back_photo_url: details.backPhotoUrl || '',
        status: mapStatusToLegacy(claim.status),
        reimbursement_amount: refundAmount,
        admin_notes: claim.deny_reason || null,
        processed_by: claim.reviewed_by,
        processed_at: claim.reviewed_at || claim.refund_issued_at,
        payment_method: details.paymentMethod || 'original_payment_method',
        payment_details: details.paymentDetails || '',
        created_at: claim.created_at,
        total_reimbursed_this_year: 0,
        remaining_coverage: ACTIVE_AUTOPILOT_PLAN.priceCents / 100,
      };
    });

    return res.status(200).json({ requests });
  } catch (error: any) {
    console.error('Error fetching claims:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, adminUser: { id: string; email: string }) {
  try {
    const { id, status, reimbursement_amount, admin_notes } = req.body || {};

    if (!id || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const targetStatus = mapStatusFromLegacy(status);
    const updateData: Record<string, any> = {
      status: targetStatus,
      reviewed_by: adminUser.email,
      reviewed_at: new Date().toISOString(),
    };

    if (admin_notes !== undefined) {
      updateData.deny_reason = admin_notes || null;
    }

    if (targetStatus === 'refunded') {
      if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured on server' });
      }

      const { data: claimRaw, error: claimError } = await supabaseAdmin
        .from('guarantee_claims' as any)
        .select('id, user_id')
        .eq('id', id)
        .single();
      const claim = claimRaw as any;

      if (claimError || !claim?.user_id) {
        return res.status(404).json({ error: 'Guarantee claim not found' });
      }

      const { data: subRaw, error: subError } = await supabaseAdmin
        .from('autopilot_subscriptions' as any)
        .select('stripe_subscription_id')
        .eq('user_id', claim.user_id)
        .single();
      const sub = subRaw as any;

      if (subError || !sub?.stripe_subscription_id) {
        return res.status(400).json({ error: 'No active subscription found for refund' });
      }

      const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
        expand: ['latest_invoice.payment_intent'],
      });

      const paymentIntent = subscription.latest_invoice && typeof subscription.latest_invoice !== 'string'
        ? (subscription.latest_invoice as any).payment_intent
        : null;
      const paymentIntentId = paymentIntent && typeof paymentIntent !== 'string' ? paymentIntent.id : null;

      if (!paymentIntentId) {
        return res.status(400).json({ error: 'Could not locate original payment for refund' });
      }

      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: reimbursement_amount
          ? Math.round(Number(reimbursement_amount) * 100)
          : ACTIVE_AUTOPILOT_PLAN.priceCents,
        metadata: {
          source: 'first_dismissal_guarantee',
          claim_id: id,
        },
      });

      updateData.refund_amount_cents = reimbursement_amount
        ? Math.round(Number(reimbursement_amount) * 100)
        : ACTIVE_AUTOPILOT_PLAN.priceCents;
      updateData.stripe_refund_id = refund.id;
      updateData.refund_issued_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('guarantee_claims' as any)
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.error('Error updating guarantee claim:', error);
      return res.status(500).json({ error: 'Failed to update guarantee claim' });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error updating guarantee claim:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
