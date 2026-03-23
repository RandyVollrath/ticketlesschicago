/**
 * GET /api/foia/authorization-pdf?id=<request_id>
 *
 * Generates a PDF of the signed FOIA authorization for a given request.
 * Uses pdf-lib for server-side PDF generation.
 *
 * The PDF serves as a permanent record of the e-signature for:
 * 1. Attaching to the FOIA email sent to the city
 * 2. User's own records
 * 3. Audit trail / legal compliance
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { generateFoiaAuthorizationPdf } from '../../../lib/foia-authorization-pdf';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Authenticate the request
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !supabase) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.substring(7);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Invalid or expired token' });
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
    .maybeSingle();

  if (error || !request) {
    return res.status(404).json({ error: 'FOIA request not found' });
  }

  if (!request.signature_name) {
    return res.status(400).json({ error: 'This request does not have a signature on file' });
  }

  try {
    const pdfBuffer = await generateFoiaAuthorizationPdf({
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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="FOIA-Authorization-${request.license_state}-${request.license_plate}.pdf"`
    );
    return res.status(200).send(pdfBuffer);
  } catch (err: any) {
    console.error('Failed to generate FOIA authorization PDF:', err.message);
    return res.status(500).json({ error: 'Failed to generate PDF' });
  }
}
