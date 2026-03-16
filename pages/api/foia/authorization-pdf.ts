/**
 * GET /api/foia/authorization-pdf?id=<request_id>
 *
 * Generates a PDF of the signed FOIA authorization for a given request.
 * Uses pure HTML-to-PDF approach (no external dependencies).
 * The PDF serves as a permanent record of the e-signature for:
 * 1. Attaching to the FOIA email sent to the city
 * 2. User's own records
 * 3. Audit trail / legal compliance
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

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Request ID is required' });
  }

  // Fetch the FOIA request with signature data
  const { data: request, error } = await supabaseAdmin
    .from('foia_history_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !request) {
    return res.status(404).json({ error: 'FOIA request not found' });
  }

  if (!request.signature_name) {
    return res.status(400).json({ error: 'This request does not have a signature on file' });
  }

  const signedDate = new Date(request.consent_given_at || request.created_at);
  const formattedDate = signedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = signedDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

  // Generate HTML representation of the signed authorization
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>FOIA Authorization - ${request.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Dancing+Script:wght@400;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      color: #1a1a2e;
      line-height: 1.6;
      padding: 60px;
      max-width: 800px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 24px;
      border-bottom: 2px solid #e2e8f0;
    }

    .header h1 {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .header p {
      font-size: 14px;
      color: #64748b;
    }

    .doc-title {
      text-align: center;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 32px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .vehicle-info {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }

    .vehicle-info table {
      width: 100%;
    }

    .vehicle-info td {
      padding: 6px 12px;
      font-size: 14px;
    }

    .vehicle-info td:first-child {
      font-weight: 600;
      color: #64748b;
      width: 160px;
    }

    .authorization-text {
      font-size: 14px;
      line-height: 1.8;
      margin-bottom: 32px;
      padding: 20px;
      background: #fefefe;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }

    .signature-block {
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid #e2e8f0;
    }

    .signature-line {
      display: flex;
      align-items: flex-end;
      gap: 16px;
      margin-bottom: 24px;
    }

    .signature-label {
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      min-width: 80px;
    }

    .signature-value {
      flex: 1;
      border-bottom: 1px solid #1a1a2e;
      padding-bottom: 4px;
      min-height: 36px;
    }

    .signature-name {
      font-family: 'Dancing Script', cursive;
      font-size: 28px;
      color: #1a1a2e;
    }

    .signature-date {
      font-size: 14px;
      color: #1a1a2e;
    }

    .audit-trail {
      margin-top: 40px;
      padding: 16px;
      background: #f1f5f9;
      border-radius: 8px;
      font-size: 11px;
      color: #64748b;
    }

    .audit-trail h4 {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      color: #475569;
    }

    .audit-trail table td {
      padding: 2px 8px;
      vertical-align: top;
    }

    .legal-notice {
      margin-top: 24px;
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.6;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Autopilot America LLC</h1>
    <p>Chicago, Illinois</p>
  </div>

  <div class="doc-title">Limited Authorization for FOIA Request</div>

  <div class="vehicle-info">
    <table>
      <tr>
        <td>Full Name:</td>
        <td>${escapeHtml(request.name)}</td>
      </tr>
      <tr>
        <td>Email:</td>
        <td>${escapeHtml(request.email)}</td>
      </tr>
      <tr>
        <td>License Plate:</td>
        <td><strong>${escapeHtml(request.license_state)} ${escapeHtml(request.license_plate)}</strong></td>
      </tr>
      <tr>
        <td>Request ID:</td>
        <td style="font-family: monospace; font-size: 12px;">${escapeHtml(request.id)}</td>
      </tr>
    </table>
  </div>

  <div class="authorization-text">
    ${escapeHtml(request.signature_agreed_text || 'Authorization text not recorded.')}
  </div>

  <div class="signature-block">
    <div class="signature-line">
      <span class="signature-label">Signature:</span>
      <div class="signature-value">
        <span class="signature-name">${escapeHtml(request.signature_name)}</span>
      </div>
    </div>

    <div class="signature-line">
      <span class="signature-label">Date:</span>
      <div class="signature-value">
        <span class="signature-date">${formattedDate}</span>
      </div>
    </div>

    <div class="signature-line">
      <span class="signature-label">Printed Name:</span>
      <div class="signature-value">
        <span style="font-size: 14px;">${escapeHtml(request.name)}</span>
      </div>
    </div>
  </div>

  <div class="audit-trail">
    <h4>Electronic Signature Audit Trail</h4>
    <table>
      <tr>
        <td>Signed at:</td>
        <td>${formattedDate} at ${formattedTime}</td>
      </tr>
      <tr>
        <td>IP Address:</td>
        <td>${escapeHtml(request.consent_ip || 'Not recorded')}</td>
      </tr>
      <tr>
        <td>User Agent:</td>
        <td style="word-break: break-all;">${escapeHtml(request.signature_user_agent || 'Not recorded')}</td>
      </tr>
      <tr>
        <td>Electronic Consent:</td>
        <td>${request.consent_electronic_process ? 'Yes — signer agreed to sign electronically' : 'Not recorded'}</td>
      </tr>
      <tr>
        <td>Legal Basis:</td>
        <td>Federal ESIGN Act (15 U.S.C. &sect; 7001); Illinois UETA (815 ILCS 334)</td>
      </tr>
    </table>
  </div>

  <div class="legal-notice">
    This document was electronically signed via Autopilot America (autopilotamerica.com).
    Electronic signatures are legally valid under the Federal ESIGN Act and the Illinois
    Uniform Electronic Transactions Act.
  </div>
</body>
</html>`;

  // Return as HTML (can be printed to PDF by the browser, or converted server-side later)
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="FOIA-Authorization-${request.license_state}-${request.license_plate}.html"`);
  return res.status(200).send(html);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
