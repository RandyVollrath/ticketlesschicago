import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, updates } = req.body;

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Supabase admin client not available' });
    }

    if (!user_id || !updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Missing user_id or updates' });
    }

    // Allowlist: only these fields may be updated by admin
    const ALLOWED_FIELDS = new Set([
      'city_sticker_expiry',
      'license_plate_expiry',
      'plate_state',
      'reminder_enabled',
      'reminder_days_before',
      'notes',
    ]);

    const sanitizedUpdates: Record<string, unknown> = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.has(key)) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Update vehicle reminder record
    const { data, error } = await supabaseAdmin
      .from('vehicle_reminders')
      .update(sanitizedUpdates)
      .eq('user_id', user_id)
      .select();

    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data
    });

  } catch (error: any) {
    console.error('Update user error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});