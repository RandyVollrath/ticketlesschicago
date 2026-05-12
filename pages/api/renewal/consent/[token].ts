// Public consent endpoint accessed via the token in a reminder email/SMS link.
// GET  → returns the consent record summary (or 404 / expired error)
// POST {action:'grant'|'decline'} → records the user's decision

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { getConsentByToken, grantConsent, declineConsent } from '../../../../lib/renewal-consent';
import { sanitizeErrorMessage } from '../../../../lib/error-utils';

const actionSchema = z.object({ action: z.enum(['grant', 'decline']) });

function extractIp(req: NextApiRequest): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return xff[0];
  return req.socket?.remoteAddress;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = String(req.query.token || '');
  if (!token || token.length < 16) return res.status(400).json({ error: 'Invalid token' });

  try {
    if (req.method === 'GET') {
      const c = await getConsentByToken(token);
      if (!c) return res.status(404).json({ error: 'Consent not found' });
      return res.status(200).json({
        id: c.id,
        renewal_type: c.renewal_type,
        license_plate: c.license_plate,
        license_state: c.license_state,
        gov_amount_cents: c.gov_amount_cents,
        service_fee_cents: c.service_fee_cents,
        total_amount_cents: c.total_amount_cents,
        status: c.status,
        expires_at: c.expires_at,
        granted_at: c.granted_at,
      });
    }

    if (req.method === 'POST') {
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'action must be grant or decline' });

      const ip = extractIp(req);
      const ua = req.headers['user-agent'] || undefined;
      const updated =
        parsed.data.action === 'grant'
          ? await grantConsent(token, { ip, userAgent: typeof ua === 'string' ? ua : undefined })
          : await declineConsent(token);
      return res.status(200).json({ success: true, status: updated.status });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(400).json({ error: sanitizeErrorMessage(e) });
  }
}
