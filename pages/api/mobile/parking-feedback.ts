/**
 * Parking Feedback API — Layer 2 of accuracy measurement system.
 *
 * Accepts user feedback for a recent parking diagnostic event:
 *   1. Did parking actually occur? (not a red light / false positive)
 *   2. Is the street/block correct?
 *   3. Which side of the street? (N/S/E/W)
 *
 * Updates the corresponding parking_diagnostics row and computes
 * street_correct / side_correct for accuracy tracking.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const {
    diagnostic_id,        // ID of the parking_diagnostics row (optional — can match by time)
    confirmed_parking,    // boolean: did parking actually occur?
    confirmed_block,      // boolean: is the street/block correct?
    reported_side,        // 'N' | 'S' | 'E' | 'W' | null: which side of the street?
    feedback_source,      // string: where this truth came from (hero, card, chat, etc.)
    corrected_address,    // string: optional authoritative address when block was wrong
    note,                 // string: optional human note
  } = req.body;

  try {
    // Find the diagnostic row — either by ID or most recent for this user
    let targetId = diagnostic_id;

    if (!targetId) {
      // Find the most recent diagnostic for this user (within last 2 hours)
      const { data: recent, error: fetchErr } = await supabaseAdmin
        .from('parking_diagnostics')
        .select('id')
        .eq('user_id', user.id)
        .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      if (fetchErr || !recent || recent.length === 0) {
        return res.status(404).json({ error: 'No recent parking diagnostic found' });
      }
      targetId = recent[0].id;
    }

    // Build update payload
    const update: Record<string, any> = {
      user_feedback_at: new Date().toISOString(),
    };

    if (confirmed_parking !== undefined) {
      update.user_confirmed_parking = confirmed_parking;
    }
    if (confirmed_block !== undefined) {
      update.user_confirmed_block = confirmed_block;
    }
    if (reported_side) {
      update.user_reported_side = reported_side.toUpperCase();
    }

    // Compute accuracy fields if we have enough info
    // Fetch the diagnostic row to compare
    const { data: diagRow } = await supabaseAdmin
      .from('parking_diagnostics')
      .select('resolved_side, resolved_street_name, native_meta')
      .eq('id', targetId)
      .single();

    if (diagRow) {
      if (confirmed_block !== undefined) {
        update.street_correct = confirmed_block;
      }
      if (reported_side && diagRow.resolved_side) {
        update.side_correct = reported_side.toUpperCase() === diagRow.resolved_side;
      }
      const existingMeta = (diagRow.native_meta && typeof diagRow.native_meta === 'object')
        ? diagRow.native_meta as Record<string, any>
        : {};
      update.native_meta = {
        ...existingMeta,
        feedback_source: typeof feedback_source === 'string' && feedback_source.trim().length > 0
          ? feedback_source.trim().slice(0, 80)
          : (existingMeta.feedback_source ?? 'user_feedback'),
        corrected_address: typeof corrected_address === 'string' && corrected_address.trim().length > 0
          ? corrected_address.trim().slice(0, 200)
          : (existingMeta.corrected_address ?? null),
        feedback_note: typeof note === 'string' && note.trim().length > 0
          ? note.trim().slice(0, 500)
          : (existingMeta.feedback_note ?? null),
      };
    }

    const { error: updateErr } = await supabaseAdmin
      .from('parking_diagnostics')
      .update(update)
      .eq('id', targetId)
      .eq('user_id', user.id);

    if (updateErr) {
      console.warn('[parking-feedback] Update failed:', updateErr.message);
      return res.status(500).json({ error: 'Failed to save feedback' });
    }

    console.log(`[parking-feedback] Feedback saved for diagnostic ${targetId}: parking=${confirmed_parking}, block=${confirmed_block}, side=${reported_side}`);

    return res.status(200).json({
      success: true,
      diagnostic_id: targetId,
      side_correct: update.side_correct ?? null,
    });
  } catch (err: any) {
    console.error('[parking-feedback] Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
