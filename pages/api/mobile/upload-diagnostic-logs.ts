/**
 * Upload Diagnostic Logs API
 *
 * Called by the mobile app to upload parking decision logs from the device.
 * Stores entries in the audit_logs table for remote debugging.
 *
 * This solves the #1 debugging gap: parking_decisions.ndjson exists on device
 * but has no way to get off the device without manual Xcode extraction.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Each log entry from the device's parking_decisions.ndjson
const LogEntrySchema = z.object({
  event: z.string(),                    // event type (e.g. parking_confirmed, trip_summary)
  ts: z.string(),                       // ISO timestamp from the event
  data: z.record(z.unknown()),          // full event payload
  hash: z.string().min(8).max(64),      // client-side dedup hash
});

const UploadSchema = z.object({
  entries: z.array(LogEntrySchema).min(1).max(500),
  platform: z.enum(['ios', 'android']).default('ios'),
  app_version: z.string().optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify user authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const accessToken = authHeader.substring(7);

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    // Validate input
    const parseResult = UploadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid input',
        details: parseResult.error.issues.map(i => i.message).join(', '),
      });
    }

    const { entries, platform, app_version } = parseResult.data;

    // Check for duplicates by hash — collect existing hashes
    const hashes = entries.map(e => e.hash);
    const { data: existingRows } = await supabaseAdmin
      .from('audit_logs')
      .select('entity_id')
      .eq('user_id', user.id)
      .eq('action_type', 'mobile_diagnostic_log')
      .in('entity_id', hashes);

    const existingHashes = new Set((existingRows || []).map(r => r.entity_id));

    // Filter to new entries only
    const newEntries = entries.filter(e => !existingHashes.has(e.hash));

    if (newEntries.length === 0) {
      return res.status(200).json({
        success: true,
        inserted: 0,
        skipped: entries.length,
        message: 'All entries already uploaded',
      });
    }

    // Batch insert into audit_logs
    const rows = newEntries.map(entry => ({
      user_id: user.id,
      action_type: 'mobile_diagnostic_log',
      entity_type: entry.event,        // e.g. parking_confirmed, trip_summary
      entity_id: entry.hash,           // dedup key
      action_details: {
        ...entry.data,
        _event_ts: entry.ts,
        _platform: platform,
        _app_version: app_version || null,
      },
      status: 'success',
    }));

    const { error: insertError } = await supabaseAdmin
      .from('audit_logs')
      .insert(rows);

    if (insertError) {
      console.error('Error inserting diagnostic logs:', insertError);
      return res.status(500).json({ error: 'Failed to store diagnostic logs' });
    }

    console.log(`Diagnostic logs uploaded for user ${user.id}: ${newEntries.length} new, ${entries.length - newEntries.length} deduped`);

    return res.status(200).json({
      success: true,
      inserted: newEntries.length,
      skipped: entries.length - newEntries.length,
    });

  } catch (error) {
    console.error('Error in upload-diagnostic-logs:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
