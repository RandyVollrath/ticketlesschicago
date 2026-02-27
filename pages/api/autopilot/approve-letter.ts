/**
 * API endpoint for one-click letter approval via email link
 *
 * GET /api/autopilot/approve-letter?token=xxx&action=approve|skip
 *
 * Token is a signed JWT containing ticket_id and user_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const JWT_SECRET = process.env.APPROVAL_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface ApprovalToken {
  ticket_id: string;
  user_id: string;
  letter_id: string;
  exp: number;
}

export function generateApprovalToken(ticketId: string, userId: string, letterId: string): string {
  return jwt.sign(
    {
      ticket_id: ticketId,
      user_id: userId,
      letter_id: letterId,
    },
    JWT_SECRET,
    { expiresIn: '7d' } // Token valid for 7 days
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token, action } = req.query;

  if (!token || typeof token !== 'string') {
    return res.redirect('/tickets?error=invalid_token');
  }

  if (!action || (action !== 'approve' && action !== 'skip')) {
    return res.redirect('/tickets?error=invalid_action');
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as ApprovalToken;
    const { ticket_id, user_id, letter_id } = decoded;

    // Get current ticket status
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('detected_tickets')
      .select('status')
      .eq('id', ticket_id)
      .eq('user_id', user_id)
      .single();

    if (ticketError || !ticket) {
      return res.redirect('/tickets?error=ticket_not_found');
    }

    // Check if already processed
    if (ticket.status !== 'needs_approval') {
      return res.redirect(`/tickets/${ticket_id}?message=already_processed`);
    }

    if (action === 'approve') {
      // Approve the ticket and letter
      await supabaseAdmin
        .from('detected_tickets')
        .update({ status: 'approved' })
        .eq('id', ticket_id);

      await supabaseAdmin
        .from('contest_letters')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: 'email_link'
        })
        .eq('id', letter_id);

      // Log to audit
      await supabaseAdmin
        .from('ticket_audit_log')
        .insert({
          ticket_id,
          user_id,
          action: 'letter_approved',
          details: { via: 'email_link' },
          performed_by: 'user',
        });

      return res.redirect(`/tickets/${ticket_id}?message=approved`);
    } else {
      // Skip the ticket
      await supabaseAdmin
        .from('detected_tickets')
        .update({ status: 'skipped', skip_reason: 'User declined via email' })
        .eq('id', ticket_id);

      await supabaseAdmin
        .from('contest_letters')
        .update({ status: 'cancelled' })
        .eq('id', letter_id);

      // Log to audit
      await supabaseAdmin
        .from('ticket_audit_log')
        .insert({
          ticket_id,
          user_id,
          action: 'letter_skipped',
          details: { via: 'email_link' },
          performed_by: 'user',
        });

      return res.redirect(`/tickets/${ticket_id}?message=skipped`);
    }
  } catch (error: any) {
    console.error('Approval error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.redirect('/tickets?error=token_expired');
    }
    return res.redirect('/tickets?error=invalid_token');
  }
}
