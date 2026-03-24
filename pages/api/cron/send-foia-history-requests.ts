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
  generateHistoryReferenceId,
} from '../../../lib/foia-history-service';
import { generateFoiaAuthorizationPdf } from '../../../lib/foia-authorization-pdf';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization (header only — never accept secrets in query params which get logged)
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? (authHeader === `Bearer ${secret}`) : false);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Starting FOIA ticket history request processing...');

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  // ── Recovery: Fix sent-but-stuck rows (email sent but DB update failed) ──
  // If a row has been in 'drafting' for >5 minutes, the previous run died.
  // BUT: If resend_message_id is set, the email was ALREADY SENT and the DB
  // update just failed — mark as 'sent' instead of re-queuing (prevents
  // sending duplicate FOIA emails to the city).
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // First: fix rows where email was sent but status stuck in 'drafting'
  const { data: sentButStuck, error: sentButStuckError } = await supabaseAdmin
    .from('foia_history_requests')
    .select('id, resend_message_id')
    .eq('status', 'drafting')
    .lt('updated_at', fiveMinutesAgo)
    .not('resend_message_id', 'is', null);

  if (sentButStuckError) {
    console.error('Failed to fetch sent-but-stuck history FOIA requests:', sentButStuckError.message);
  }
  if (sentButStuck && sentButStuck.length > 0) {
    for (const row of sentButStuck) {
      const { error: fixError } = await supabaseAdmin
        .from('foia_history_requests')
        .update({
          status: 'sent',
          foia_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          notes: 'Recovered: email was sent (has resend_message_id) but status was stuck in drafting',
        } as any)
        .eq('id', row.id);
      if (fixError) {
        console.error(`Failed to fix sent-but-stuck history FOIA request ${row.id}: ${fixError.message}`);
      }
    }
    console.log(`  ✅ Fixed ${sentButStuck.length} sent-but-stuck history FOIA request(s) (marked as sent)`);
  }

  // Then: re-queue truly orphaned rows (no resend_message_id = email never sent)
  const { data: orphanedDrafting, error: orphanRecoveryError } = await supabaseAdmin
    .from('foia_history_requests')
    .update({
      status: 'queued',
      updated_at: new Date().toISOString(),
      notes: 'Re-queued: was stuck in drafting (previous cron run crashed)',
    } as any)
    .eq('status', 'drafting')
    .lt('updated_at', fiveMinutesAgo)
    .is('resend_message_id', null)
    .select('id');
  if (orphanRecoveryError) {
    console.error('Failed to recover orphaned drafting history FOIA requests:', orphanRecoveryError.message);
  }
  if (orphanedDrafting && orphanedDrafting.length > 0) {
    console.log(`  ♻️ Recovered ${orphanedDrafting.length} orphaned 'drafting' history FOIA request(s)`);
  }

  // ── Recovery: Retry 'failed' rows (up to 3 attempts, oldest first) ──
  const { data: failedRetries, error: failedFetchError } = await supabaseAdmin
    .from('foia_history_requests')
    .select('id, notes, request_payload')
    .eq('status', 'failed')
    .order('updated_at', { ascending: true })
    .limit(10);
  if (failedFetchError) {
    console.error('Failed to fetch failed history FOIA requests for retry:', failedFetchError.message);
  }
  let retried = 0;
  if (failedRetries && failedRetries.length > 0) {
    for (const fr of failedRetries as any[]) {
      const attempts = fr.request_payload?.retry_count || 0;
      if (attempts >= 3) continue; // max 3 retries
      const { error: retryUpdateError } = await supabaseAdmin
        .from('foia_history_requests')
        .update({
          status: 'queued',
          updated_at: new Date().toISOString(),
          request_payload: { ...fr.request_payload, retry_count: attempts + 1 },
          notes: `Retry #${attempts + 1}: ${fr.notes || 'previous attempt failed'}`,
        } as any)
        .eq('id', fr.id);
      if (retryUpdateError) {
        console.error(`Failed to re-queue history FOIA request ${fr.id}: ${retryUpdateError.message}`);
        continue;
      }
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
    return res.status(500).json({ error: 'Failed to fetch queued FOIA history requests' });
  }

  if (!queuedRequests || queuedRequests.length === 0) {
    console.log('No queued FOIA history requests to process.');
    return res.status(200).json({ message: 'No queued requests', processed: 0, retried, recovered: orphanedDrafting?.length || 0, sentButStuckFixed: sentButStuck?.length || 0 });
  }

  console.log(`Found ${queuedRequests.length} queued FOIA history requests`);

  let sent = 0;
  let failed = 0;

  for (const request of queuedRequests) {
    console.log(`  Processing FOIA history request ${request.id} for plate ${request.license_state} ${request.license_plate}`);

    try {
      // Mark as drafting to prevent double-sends if cron runs overlap
      const { data: claimedRequest, error: claimError } = await supabaseAdmin
        .from('foia_history_requests')
        .update({ status: 'drafting', updated_at: new Date().toISOString() } as any)
        .eq('id', request.id)
        .eq('status', 'queued')
        .select('id')
        .maybeSingle();

      if (claimError) {
        throw new Error(`Failed to claim queued FOIA request: ${claimError.message}`);
      }

      if (!claimedRequest?.id) {
        console.log(`    Skipping ${request.id} — another run already claimed it`);
        continue;
      }

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
