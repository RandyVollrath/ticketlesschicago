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

// SECURITY: Never fall back to SUPABASE_SERVICE_ROLE_KEY — it would expose the
// service role key in JWTs sent via email links. Fail hard if not configured.
const JWT_SECRET = process.env.APPROVAL_JWT_SECRET;
if (!JWT_SECRET) {
  console.error('APPROVAL_JWT_SECRET is not configured — approval links will fail');
}

export interface ApprovalToken {
  ticket_id: string;
  user_id: string;
  letter_id: string;
  exp: number;
}

export function generateApprovalToken(ticketId: string, userId: string, letterId: string): string {
  if (!JWT_SECRET) {
    throw new Error('APPROVAL_JWT_SECRET not configured — cannot generate approval tokens');
  }
  return jwt.sign(
    {
      ticket_id: ticketId,
      user_id: userId,
      letter_id: letterId,
    },
    JWT_SECRET,
    { expiresIn: '30d' } // Token valid for 30 days (consistent across all token generators)
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
    if (!JWT_SECRET) {
      console.error('APPROVAL_JWT_SECRET not configured — cannot verify approval tokens');
      return res.redirect('/tickets?error=server_config');
    }
    const decoded = jwt.verify(token, JWT_SECRET) as ApprovalToken;
    const { ticket_id, user_id, letter_id } = decoded;

    // Get current ticket status
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('detected_tickets')
      .select('status')
      .eq('id', ticket_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (ticketError || !ticket) {
      return res.redirect('/tickets?error=ticket_not_found');
    }

    // Check if already processed
    if (ticket.status !== 'needs_approval') {
      return res.redirect(`/tickets/${ticket_id}?message=already_processed`);
    }

    if (action === 'approve') {
      // Approve the ticket with optimistic lock — only update if still needs_approval
      // This prevents a race where the mail cron picks up the ticket between our
      // status check and this update, causing a duplicate mailing.
      const { data: updatedTicket, error: updateTicketErr } = await supabaseAdmin
        .from('detected_tickets')
        .update({ status: 'approved' })
        .eq('id', ticket_id)
        .eq('user_id', user_id)
        .eq('status', 'needs_approval')
        .select('id')
        .maybeSingle();

      if (updateTicketErr || !updatedTicket) {
        // Another process already changed the status — treat as already processed
        return res.redirect(`/tickets/${ticket_id}?message=already_processed`);
      }

      // Optimistic lock on letter too — only update if still pending_approval
      await supabaseAdmin
        .from('contest_letters')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: 'email_link'
        })
        .eq('id', letter_id)
        .eq('user_id', user_id)
        .in('status', ['pending_approval', 'draft', 'needs_admin_review']);

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
      // Skip the ticket with optimistic lock — only update if still needs_approval
      const { data: updatedTicket, error: updateTicketErr } = await supabaseAdmin
        .from('detected_tickets')
        .update({ status: 'skipped', skip_reason: 'User declined via email' })
        .eq('id', ticket_id)
        .eq('user_id', user_id)
        .eq('status', 'needs_approval')
        .select('id')
        .maybeSingle();

      if (updateTicketErr || !updatedTicket) {
        return res.redirect(`/tickets/${ticket_id}?message=already_processed`);
      }

      await supabaseAdmin
        .from('contest_letters')
        .update({ status: 'cancelled' })
        .eq('id', letter_id)
        .eq('user_id', user_id)
        .in('status', ['pending_approval', 'draft', 'needs_admin_review']);

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
