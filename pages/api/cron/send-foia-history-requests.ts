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
      // Generate the authorization HTML to attach to the FOIA email
      let authorizationHtml: string | undefined;
      if (request.signature_name) {
        const signedDate = new Date(request.consent_given_at || request.created_at);
        authorizationHtml = generateAuthorizationHtml(request, signedDate);
      }

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
        authorizationHtml,
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

// ── Authorization HTML generator (inline to avoid circular import from authorization-pdf.ts) ──

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function generateAuthorizationHtml(request: any, signedDate: Date): string {
  const formattedDate = signedDate.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const formattedTime = signedDate.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>FOIA Authorization - ${escapeHtml(request.name)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; line-height: 1.6; padding: 40px; max-width: 700px; margin: 0 auto; }
    h1 { text-align: center; font-size: 20px; margin-bottom: 4px; }
    .subtitle { text-align: center; font-size: 13px; color: #64748b; margin-bottom: 32px; }
    .doc-title { text-align: center; font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 24px; }
    .info-table { width: 100%; margin-bottom: 20px; }
    .info-table td { padding: 4px 8px; font-size: 13px; }
    .info-table td:first-child { font-weight: bold; color: #64748b; width: 140px; }
    .auth-text { font-size: 13px; line-height: 1.8; margin-bottom: 28px; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; }
    .sig-block { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
    .sig-line { margin-bottom: 20px; }
    .sig-label { font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; }
    .sig-value { border-bottom: 1px solid #1a1a2e; padding: 4px 0; min-height: 28px; }
    .sig-name { font-size: 24px; font-style: italic; }
    .audit { margin-top: 32px; padding: 12px; background: #f1f5f9; font-size: 10px; color: #64748b; }
    .audit h4 { font-size: 10px; text-transform: uppercase; margin-bottom: 6px; color: #475569; }
    .audit td { padding: 1px 6px; vertical-align: top; }
    .legal { margin-top: 20px; font-size: 10px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <h1>Autopilot America LLC</h1>
  <div class="subtitle">Chicago, Illinois</div>
  <div class="doc-title">Limited Authorization for FOIA Request</div>

  <table class="info-table">
    <tr><td>Full Name:</td><td>${escapeHtml(request.name)}</td></tr>
    <tr><td>Email:</td><td>${escapeHtml(request.email)}</td></tr>
    <tr><td>License Plate:</td><td><strong>${escapeHtml(request.license_state)} ${escapeHtml(request.license_plate)}</strong></td></tr>
    <tr><td>Request ID:</td><td style="font-family: monospace; font-size: 11px;">${escapeHtml(request.id)}</td></tr>
  </table>

  <div class="auth-text">
    ${escapeHtml(request.signature_agreed_text || 'Authorization text not recorded.')}
  </div>

  <div class="sig-block">
    <div class="sig-line">
      <div class="sig-label">Signature:</div>
      <div class="sig-value"><span class="sig-name">${escapeHtml(request.signature_name)}</span></div>
    </div>
    <div class="sig-line">
      <div class="sig-label">Date:</div>
      <div class="sig-value">${formattedDate}</div>
    </div>
    <div class="sig-line">
      <div class="sig-label">Printed Name:</div>
      <div class="sig-value">${escapeHtml(request.name)}</div>
    </div>
  </div>

  <div class="audit">
    <h4>Electronic Signature Audit Trail</h4>
    <table>
      <tr><td>Signed at:</td><td>${formattedDate} at ${formattedTime}</td></tr>
      <tr><td>IP Address:</td><td>${escapeHtml(request.consent_ip || 'Not recorded')}</td></tr>
      <tr><td>User Agent:</td><td>${escapeHtml(request.signature_user_agent || 'Not recorded')}</td></tr>
      <tr><td>Electronic Consent:</td><td>${request.consent_electronic_process ? 'Yes' : 'Not recorded'}</td></tr>
      <tr><td>Legal Basis:</td><td>Federal ESIGN Act (15 U.S.C. &sect; 7001); Illinois UETA (815 ILCS 334)</td></tr>
    </table>
  </div>

  <div class="legal">
    This document was electronically signed via Autopilot America (autopilotamerica.com).
    Electronic signatures are legally valid under the Federal ESIGN Act and the Illinois
    Uniform Electronic Transactions Act.
  </div>
</body>
</html>`;
}
