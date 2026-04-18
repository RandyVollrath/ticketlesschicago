/**
 * Submit Debug Report API
 *
 * User taps "Send Debug Report" → mobile client POSTs a JSON bundle
 * (native log files + AsyncStorage history + app state). Stored in the
 * audit_logs table with action_type='mobile_debug_report' for remote
 * inspection. Reused existing table to avoid a migration.
 *
 * This is the emergency channel when automatic log upload paths fail silently.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const ReportSchema = z.object({
  app_version: z.string().max(20).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  note: z.string().max(500).optional(),
  payload: z.record(z.string(), z.unknown()), // free-form JSON (Zod v4 requires key+value)
});

const MAX_PAYLOAD_BYTES = 8_000_000; // 8MB

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
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
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.substring(7)
    );
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    const parseResult = ReportSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { app_version, platform, note, payload } = parseResult.data;

    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    // Store in audit_logs with a distinct action_type so it's easy to query.
    const { data, error: insertError } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action_type: 'mobile_debug_report',
        entity_type: 'debug_report',
        entity_id: `${user.id}-${Date.now()}`,
        action_details: {
          app_version: app_version || null,
          platform: platform || null,
          note: note || null,
          payload_size_bytes: payloadSize,
          payload,
        },
        status: 'success',
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('submit-debug-report insert failed:', insertError);
      return res.status(500).json({ error: 'Failed to store report' });
    }

    console.log(`Debug report submitted: user=${user.id}, id=${data.id}, size=${payloadSize}B, note="${note || ''}"`);

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Error in submit-debug-report:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
