/**
 * Cron: Send Queued FOIA Ticket History Requests
 *
 * Processes foia_history_requests with status='queued'.
 * Sends a FOIA email to DOFfoia@cityofchicago.org requesting complete
 * ticket history for each license plate.
 *
 * Also sends the user a confirmation email.
 *
 * Schedule: Daily at 10 AM CT (15:00 UTC)
 * Rate limit: 5 per run to avoid email rate limits
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  sendTicketHistoryFoiaEmail,
  sendFoiaHistoryConfirmationEmail,
} from '../../../lib/foia-history-service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📋 Starting FOIA ticket history request processing...');

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  // Fetch queued requests (limit 5 per run)
  const { data: queuedRequests, error: fetchError } = await supabaseAdmin
    .from('foia_history_requests')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(5);

  if (fetchError) {
    console.error('Failed to fetch queued FOIA history requests:', fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  if (!queuedRequests || queuedRequests.length === 0) {
    console.log('No queued FOIA history requests to process.');
    return res.status(200).json({ message: 'No queued requests', processed: 0 });
  }

  console.log(`Found ${queuedRequests.length} queued FOIA history requests`);

  let sent = 0;
  let failed = 0;

  for (const request of queuedRequests) {
    console.log(`\n  Processing FOIA history request ${request.id} for plate ${request.license_state} ${request.license_plate}`);

    try {
      // Send the FOIA email to the city
      const result = await sendTicketHistoryFoiaEmail({
        name: request.name,
        email: request.email,
        licensePlate: request.license_plate,
        licenseState: request.license_state,
      });

      if (result.success) {
        console.log(`    ✅ FOIA history request sent (Resend ID: ${result.emailId})`);

        // Update status
        await supabaseAdmin
          .from('foia_history_requests')
          .update({
            status: 'sent',
            foia_sent_at: new Date().toISOString(),
            foia_email_id: result.emailId || null,
            updated_at: new Date().toISOString(),
            notes: `Sent to DOFfoia@cityofchicago.org on behalf of ${request.name}`,
          })
          .eq('id', request.id);

        // Send confirmation email to the user
        await sendFoiaHistoryConfirmationEmail({
          email: request.email,
          name: request.name,
          licensePlate: request.license_plate,
          licenseState: request.license_state,
        });

        sent++;
      } else {
        console.error(`    ❌ Failed to send: ${result.error}`);
        await supabaseAdmin
          .from('foia_history_requests')
          .update({
            status: 'failed',
            notes: result.error || 'Send failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', request.id);
        failed++;
      }
    } catch (err: any) {
      console.error(`    ❌ Exception: ${err.message}`);
      await supabaseAdmin
        .from('foia_history_requests')
        .update({
          status: 'failed',
          notes: err.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      failed++;
    }

    // Rate limit: 1 second between emails
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const summary = { processed: queuedRequests.length, sent, failed };
  console.log(`\n📋 FOIA history request processing complete:`, summary);

  return res.status(200).json(summary);
}
