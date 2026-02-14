import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    let userId: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data.user) {
        userId = data.user.id;
      }
    }

    const {
      accountEmail,
      accountPhone,
      hadEligibleTicketContested,
      ticketIds,
      membershipRemainedActive,
      docsProvidedOnTime,
      ticketsAfterMembershipStart,
    } = req.body || {};

    if (!accountEmail || hadEligibleTicketContested !== true || membershipRemainedActive !== true || docsProvidedOnTime !== true || ticketsAfterMembershipStart !== true) {
      return res.status(400).json({
        error: 'Please complete all required confirmations before submitting your Guarantee Review request.',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('guarantee_claims')
      .insert({
        user_id: userId,
        account_email: accountEmail,
        account_phone: accountPhone || null,
        had_eligible_ticket_contested: true,
        ticket_ids: ticketIds || null,
        membership_remained_active: true,
        docs_provided_on_time: true,
        tickets_after_membership_start: true,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .select('id, status, submitted_at')
      .single();

    if (error) {
      console.error('Guarantee claim submit error:', error);
      return res.status(500).json({ error: 'Failed to submit guarantee claim' });
    }

    // Optional lightweight admin notification via email webhook/inbox if configured.
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'randyvollrath@gmail.com';
    if (process.env.RESEND_API_KEY) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: [adminEmail],
          subject: `New Guarantee Review Request (${data.id})`,
          html: `<p>New First Dismissal Guarantee claim submitted.</p><p><strong>Claim ID:</strong> ${data.id}</p><p><strong>Email:</strong> ${accountEmail}</p>`,
        }),
      }).catch((notifyError) => {
        console.error('Failed to notify admin about guarantee claim:', notifyError);
      });
    }

    return res.status(200).json({ success: true, claim: data });
  } catch (error: any) {
    console.error('Guarantee claim submit error:', error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
