/**
 * GET /api/foia/results?id=<request_id>&email=<email>
 *
 * Public endpoint: returns FOIA results for a specific request.
 * Authentication is by request ID + email (both required).
 * This is linked from the results notification email.
 *
 * Returns the parsed ticket history data if the request is fulfilled.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = (req.query.id as string || '').trim();
  const email = (req.query.email as string || '').trim().toLowerCase();

  if (!id || !email) {
    return res.status(400).json({ error: 'Request ID and email are required' });
  }

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid request ID format' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('foia_history_requests')
      .select('id, email, name, license_plate, license_state, status, created_at, foia_sent_at, response_received_at, response_data, ticket_count, total_fines')
      .eq('id', id)
      .eq('email', email)
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: 'Request not found. Check that your request ID and email are correct.',
      });
    }

    // Build response based on status
    const response: any = {
      id: data.id,
      license_plate: data.license_plate,
      license_state: data.license_state,
      status: data.status,
      submitted_at: data.created_at,
      sent_at: data.foia_sent_at,
    };

    if (data.status === 'queued') {
      response.message = 'Your FOIA request is queued and will be sent to the city shortly.';
    } else if (data.status === 'sent') {
      response.message = 'Your FOIA request has been sent to the City of Chicago. The city typically responds within 5 business days.';
      response.sent_at = data.foia_sent_at;
    } else if (data.status === 'fulfilled') {
      response.message = 'Your FOIA results are ready!';
      response.response_received_at = data.response_received_at;
      response.ticket_count = data.ticket_count;
      response.total_fines = data.total_fines;
      response.results = data.response_data;
    } else if (data.status === 'failed') {
      response.message = 'Unfortunately, the city was unable to fulfill this FOIA request. This can happen if the plate number was not found in their system.';
    } else if (data.status === 'cancelled') {
      response.message = 'This FOIA request was cancelled.';
    }

    res.setHeader('Cache-Control', 'private, no-cache');

    return res.status(200).json(response);
  } catch (err: any) {
    console.error('[foia/results] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
