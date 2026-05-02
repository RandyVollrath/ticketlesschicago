/**
 * Log Auth Failure API (anonymous)
 *
 * Mobile clients call this when sign-in (Google, Apple, magic link) fails
 * BEFORE the user is authenticated — so the standard authenticated debug
 * report endpoint can't be used. This is the only signal we get when a
 * potential new user can't log in. Without it, login bugs are invisible.
 *
 * Writes a row to audit_logs (action_type='mobile_auth_failure', user_id=null)
 * for grep + dashboard queries. Also console.error's a one-line tag so it
 * surfaces in Vercel logs immediately.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const FailureSchema = z.object({
  provider: z.enum(['google', 'apple', 'email', 'magic_link']),
  stage: z.string().max(64),
  error_code: z.string().max(128).optional(),
  error_message: z.string().max(1000).optional(),
  app_version: z.string().max(20).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  os_version: z.string().max(40).optional(),
  device_model: z.string().max(80).optional(),
  attempted_email: z.string().max(254).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '32kb',
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parseResult = FailureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const f = parseResult.data;

    console.error(
      `[AUTH_FAILURE] provider=${f.provider} stage=${f.stage} platform=${f.platform || '?'} os=${f.os_version || '?'} app=${f.app_version || '?'} code=${f.error_code || '?'} msg="${(f.error_message || '').slice(0, 200)}" email=${f.attempted_email || '?'}`
    );

    if (!supabaseAdmin) {
      // Vercel logs already captured the failure above — return success so
      // the client doesn't retry forever if the DB is down.
      return res.status(200).json({ success: true, persisted: false });
    }

    const { error: insertError } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        user_id: null,
        action_type: 'mobile_auth_failure',
        entity_type: 'auth_failure',
        entity_id: `${f.provider}-${Date.now()}`,
        action_details: {
          provider: f.provider,
          stage: f.stage,
          error_code: f.error_code ?? null,
          error_message: f.error_message ?? null,
          app_version: f.app_version ?? null,
          platform: f.platform ?? null,
          os_version: f.os_version ?? null,
          device_model: f.device_model ?? null,
          attempted_email: f.attempted_email ?? null,
          extra: f.extra ? JSON.parse(JSON.stringify(f.extra)) : null,
        },
        status: 'failure',
      } as any);

    if (insertError) {
      console.error('log-auth-failure insert failed:', insertError);
      return res.status(200).json({ success: true, persisted: false });
    }

    return res.status(200).json({ success: true, persisted: true });
  } catch (error) {
    console.error('Error in log-auth-failure:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
