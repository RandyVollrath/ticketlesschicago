/**
 * Admin API: Backfill a history-FOIA response that didn't reach the inbound webhook.
 *
 * When the city replies and the Resend webhook fires, `processHistoryFoiaResponse`
 * runs automatically. If for any reason the webhook misses (route misconfigured,
 * Resend outage, attachment too large), an admin can paste the email here and run
 * the exact same pipeline.
 *
 * Multipart form fields:
 *   - referenceId        (optional)  — APH-xxxx; preferred way to locate the request
 *   - requestId          (optional)  — UUID; alternative
 *   - licensePlate       (optional)  — fallback lookup; uses oldest non-terminal row
 *   - licenseState       (optional)  — pairs with licensePlate
 *   - fromEmail          (required)
 *   - subject            (required)
 *   - body               (required)  — email body as pasted from Gmail
 *   - attachmentText     (optional)  — pasted text from PDF/CSV attachments (fed to Gemini parser)
 *   - attachments[]      (optional)  — uploaded files, archived to Vercel Blob
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { processHistoryFoiaResponse } from '../../../lib/contest-outcome-tracker';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  maxDuration: 120,
  api: { bodyParser: false },
};

const ALLOWED_TYPES = [
  'application/pdf',
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/tiff',
];

export default withAdminAuth(async (req, res, _adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({
      maxFileSize: 25 * 1024 * 1024, // 25 MB per file
      multiples: true,
      allowEmptyFiles: false,
    });

    const [fields, files] = await form.parse(req);

    const referenceId = fields.referenceId?.[0]?.trim();
    const requestId = fields.requestId?.[0]?.trim();
    const licensePlate = fields.licensePlate?.[0]?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const licenseState = (fields.licenseState?.[0] || 'IL').toUpperCase().trim();
    const fromEmail = fields.fromEmail?.[0]?.trim();
    const subject = fields.subject?.[0]?.trim() || '';
    const body = fields.body?.[0] || '';
    const attachmentText = fields.attachmentText?.[0] || '';

    if (!fromEmail) return res.status(400).json({ error: 'fromEmail is required' });
    if (!body && !attachmentText) {
      return res.status(400).json({ error: 'Either body or attachmentText must be provided' });
    }
    if (!referenceId && !requestId && !licensePlate) {
      return res.status(400).json({ error: 'One of referenceId, requestId, or licensePlate is required' });
    }

    // ── Resolve the history-FOIA request row ──
    let row: any = null;
    if (requestId) {
      const { data } = await supabaseAdmin
        .from('foia_history_requests')
        .select('id, status, license_plate, license_state, email, name, reference_id')
        .eq('id', requestId)
        .maybeSingle();
      row = data;
    } else if (referenceId) {
      const { data } = await supabaseAdmin
        .from('foia_history_requests')
        .select('id, status, license_plate, license_state, email, name, reference_id')
        .eq('reference_id', referenceId)
        .maybeSingle();
      row = data;
    } else if (licensePlate) {
      // Pick the most recent non-cancelled row for this plate
      const { data } = await supabaseAdmin
        .from('foia_history_requests')
        .select('id, status, license_plate, license_state, email, name, reference_id')
        .eq('license_plate', licensePlate)
        .eq('license_state', licenseState)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(1);
      row = data?.[0] || null;
    }

    if (!row) {
      return res.status(404).json({ error: 'No matching foia_history_requests row found' });
    }

    // ── Upload attachments to Vercel Blob (mirrors the webhook flow) ──
    const uploadedFiles = Array.isArray(files.attachments)
      ? files.attachments
      : files.attachments ? [files.attachments] : [];

    const attachmentsMeta: { filename: string; content_type: string; url?: string }[] = [];

    if (uploadedFiles.length > 0) {
      const { put } = await import('@vercel/blob');
      for (const f of uploadedFiles) {
        const mimetype = f.mimetype || 'application/octet-stream';
        if (!ALLOWED_TYPES.includes(mimetype)) {
          console.warn(`Rejecting ${f.originalFilename}: disallowed type ${mimetype}`);
          continue;
        }
        const rawName = f.originalFilename || `foia-doc-${Date.now()}`;
        const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'attachment';
        const buffer = fs.readFileSync(f.filepath);
        const blobPath = `foia-responses/${Date.now()}-${safeName}`;
        const blob = await put(blobPath, buffer, {
          access: 'public',
          addRandomSuffix: true,
          contentType: mimetype,
        });
        attachmentsMeta.push({ filename: safeName, content_type: mimetype, url: blob.url });
      }
    }

    // ── Combine body + pasted attachment text, exactly like the webhook does ──
    const enrichedBody = attachmentText
      ? `${body}\n\n--- PASTED ATTACHMENT TEXT ---\n${attachmentText}`
      : body;

    const result = await processHistoryFoiaResponse(
      supabaseAdmin as any,
      row.id,
      fromEmail,
      subject,
      enrichedBody,
      attachmentsMeta,
    );

    // Re-read the row so the UI shows the freshly-parsed state.
    const { data: refreshed } = await supabaseAdmin
      .from('foia_history_requests')
      .select('id, status, ticket_count, total_fines, response_received_at, parsed_tickets')
      .eq('id', row.id)
      .maybeSingle();

    return res.status(200).json({
      success: true,
      action: result.action,
      parsedTicketCount: result.parsedTicketCount,
      isExtension: result.isExtension,
      attachmentsUploaded: attachmentsMeta.length,
      request: refreshed,
    });
  } catch (err: any) {
    console.error('foia-history-backfill error:', err);
    return res.status(500).json({ error: sanitizeErrorMessage(err) || 'Internal error' });
  }
});
