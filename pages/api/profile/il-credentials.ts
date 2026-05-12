// IL Secretary of State renewal credentials — read status / write encrypted.
//
// GET  → { has_credentials, updated_at, invalid_at }  (never returns plaintext)
// POST → encrypt + store reg_id + pin, clear invalid flag

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin, supabase } from '../../../lib/supabase';
import { encryptCredential } from '../../../lib/credentials-vault';
import { maskUserId } from '../../../lib/mask-pii';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const saveSchema = z.object({
  registrationId: z.string().trim().min(4).max(32),
  pin: z.string().trim().min(3).max(32),
});

async function authenticate(req: NextApiRequest): Promise<{ userId: string } | { error: string; status: number }> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !supabase) {
    return { error: 'Authorization required', status: 401 };
  }
  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: 'Invalid or expired token', status: 401 };
  return { userId: user.id };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req);
  if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('il_pin_encrypted, il_registration_id_encrypted, il_credentials_updated_at, il_credentials_invalid_at, auto_renewal_authorized, auto_renewal_authorized_at' as any)
        .eq('user_id', auth.userId)
        .maybeSingle();

      if (error) throw error;
      const row = data as unknown as null | {
        il_pin_encrypted: string | null;
        il_registration_id_encrypted: string | null;
        il_credentials_updated_at: string | null;
        il_credentials_invalid_at: string | null;
        auto_renewal_authorized: boolean | null;
        auto_renewal_authorized_at: string | null;
      };

      return res.status(200).json({
        has_credentials: Boolean(row?.il_pin_encrypted && row?.il_registration_id_encrypted),
        updated_at: row?.il_credentials_updated_at ?? null,
        invalid_at: row?.il_credentials_invalid_at ?? null,
        auto_renewal_authorized: Boolean(row?.auto_renewal_authorized),
        auto_renewal_authorized_at: row?.auto_renewal_authorized_at ?? null,
      });
    }

    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const { registrationId, pin } = parsed.data;

    const regIdCipher = encryptCredential(registrationId);
    const pinCipher = encryptCredential(pin);

    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        il_registration_id_encrypted: regIdCipher,
        il_pin_encrypted: pinCipher,
        il_credentials_updated_at: new Date().toISOString(),
        il_credentials_invalid_at: null,
      } as any)
      .eq('user_id', auth.userId);

    if (updateError) throw updateError;

    console.log(`[il-credentials] Saved for ${maskUserId(auth.userId)}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[il-credentials] error:', err);
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
}
