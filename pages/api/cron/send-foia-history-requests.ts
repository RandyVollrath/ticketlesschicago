/**
 * Cron: Send Queued FOIA Ticket History Requests
 *
 * Processes foia_history_requests with status='queued'.
 * Sends a FOIA email to DOFfoia@cityofchicago.org requesting complete
 * ticket history for each license plate, with a signed authorization PDF attached.
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
  generateHistoryReferenceId,
} from '../../../lib/foia-history-service';
import { generateFoiaAuthorizationPdf } from '../../../lib/foia-authorization-pdf';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = secret
    ? (authHeader === `Bearer ${secret}` || keyParam === secret)
    : false;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Starting FOIA ticket history request processing...');

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  // ── Recovery: Re-queue orphaned 'drafting' rows (cron crashed mid-send) ──
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: orphanedDrafting } = await supabaseAdmin
    .from('foia_history_requests')
    .update({
      status: 'queued',
      updated_at: new Date().toISOString(),
      notes: 'Re-queued: was stuck in drafting (previous cron run crashed)',
    } as any)
    .eq('status', 'drafting')
    .lt('updated_at', fiveMinutesAgo)
    .select('id');
  if (orphanedDrafting && orphanedDrafting.length > 0) {
    console.log(`  ♻️ Recovered ${orphanedDrafting.length} orphaned 'drafting' history FOIA request(s)`);
  }

  // ── Recovery: Retry 'failed' rows (up to 3 attempts, oldest first) ──
  const { data: failedRetries } = await supabaseAdmin
    .from('foia_history_requests')
    .select('id, notes, request_payload')
    .eq('status', 'failed')
    .order('updated_at', { ascending: true })
    .limit(10);
  let retried = 0;
  if (failedRetries && failedRetries.length > 0) {
    for (const fr of failedRetries as any[]) {
      const attempts = fr.request_payload?.retry_count || 0;
      if (attempts >= 3) continue; // max 3 retries
      await supabaseAdmin
        .from('foia_history_requests')
        .update({
          status: 'queued',
          updated_at: new Date().toISOString(),
          request_payload: { ...fr.request_payload, retry_count: attempts + 1 },
          notes: `Retry #${attempts + 1}: ${fr.notes || 'previous attempt failed'}`,
        } as any)
        .eq('id', fr.id);
      retried++;
    }
    if (retried > 0)
      console.log(`  ♻️ Re-queued ${retried} failed history FOIA request(s) for retry`);
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
    return res.status(200).json({ message: 'No queued requests', processed: 0, retried, recovered: orphanedDrafting?.length || 0 });
  }

  console.log(`Found ${queuedRequests.length} queued FOIA history requests`);

  let sent = 0;
  let failed = 0;

  for (const request of queuedRequests) {
    console.log(`  Processing FOIA history request ${request.id} for plate ${request.license_state} ${request.license_plate}`);

    try {
      // Mark as drafting to prevent double-sends if cron runs overlap
      await supabaseAdmin
        .from('foia_history_requests')
        .update({ status: 'drafting', updated_at: new Date().toISOString() } as any)
        .eq('id', request.id);

      // Generate a signed authorization PDF to attach to the FOIA email
      let authorizationPdf: Buffer | undefined;
      if (request.signature_name) {
        authorizationPdf = await generateFoiaAuthorizationPdf({
          id: request.id,
          name: request.name,
          email: request.email,
          licensePlate: request.license_plate,
          licenseState: request.license_state,
          signatureName: request.signature_name,
          signatureAgreedText: request.signature_agreed_text,
          consentGivenAt: request.consent_given_at,
          createdAt: request.created_at,
          consentIp: request.consent_ip,
          signatureUserAgent: request.signature_user_agent,
          consentElectronicProcess: request.consent_electronic_process,
        });
      }

      // Generate a unique reference ID for response matching
      const referenceId = generateHistoryReferenceId();

      // Send the FOIA email to the city with signed authorization attached
      const result = await sendTicketHistoryFoiaEmail({
        name: request.name,
        email: request.email,
        licensePlate: request.license_plate,
        licenseState: request.license_state,
        signatureName: request.signature_name || undefined,
        signedAt: request.consent_given_at
          ? new Date(request.consent_given_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : undefined,
        authorizationPdf: authorizationPdf || undefined,
        referenceId,
      });

      if (result.success) {
        console.log(`    Sent (Resend ID: ${result.emailId}, Ref: ${referenceId})`);

        // Update status — wrapped in try-catch because the email was ALREADY SENT
        // If this fails, the orphan recovery logic will re-queue it on the next run
        const updatePayload: any = {
          status: 'sent',
          foia_sent_at: new Date().toISOString(),
          foia_email_id: result.emailId || null,
          updated_at: new Date().toISOString(),
          reference_id: referenceId,
          resend_message_id: result.emailId,
          notes: `Sent to DOFfoia@cityofchicago.org on behalf of ${request.name}. Ref: ${referenceId}`,
        };

        try {
          await supabaseAdmin
            .from('foia_history_requests')
            .update(updatePayload)
            .eq('id', request.id);
        } catch (dbErr: any) {
          console.error(`    ⚠️ CRITICAL: History FOIA email sent but DB update failed: ${dbErr.message}. Row ${request.id} may be stuck in 'drafting'. Will be recovered on next run.`);
        }

        // Send confirmation email to the user (non-blocking — must not mark FOIA as failed)
        try {
          await sendFoiaHistoryConfirmationEmail({
            email: request.email,
            name: request.name,
            licensePlate: request.license_plate,
            licenseState: request.license_state,
          });
        } catch (notifyErr: any) {
          console.error(`    ⚠️ User confirmation email failed (non-blocking): ${notifyErr.message}`);
        }

        sent++;
      } else {
        console.error(`    Failed to send: ${result.error}`);
        await supabaseAdmin
          .from('foia_history_requests')
          .update({
            status: 'failed',
            notes: result.error || 'Send failed',
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', request.id);
        failed++;
      }
    } catch (err: any) {
      console.error(`    Exception: ${err.message}`);
      await supabaseAdmin
        .from('foia_history_requests')
        .update({
          status: 'failed',
          notes: err.message,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', request.id);
      failed++;
    }

    // Rate limit: 1 second between emails
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const summary = { processed: queuedRequests.length, sent, failed };
  console.log(`FOIA history request processing complete:`, summary);

  return res.status(200).json(summary);
}
