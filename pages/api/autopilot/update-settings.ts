import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Updates autopilot_settings for a user. Used by the post-payment onboarding
 * flow in /start to save ticket type preferences and notification settings.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, allowed_ticket_types, email_on_ticket_found, email_on_letter_mailed, email_on_approval_needed } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Build update object — only include fields that were explicitly provided
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (Array.isArray(allowed_ticket_types)) {
      // Sanitize: only allow known ticket type keys
      const VALID_TYPES = [
        'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
        'no_standing_time_restricted', 'parking_prohibited', 'residential_permit',
        'missing_plate', 'commercial_loading', 'fire_hydrant', 'street_cleaning', 'bus_lane',
      ];
      updates.allowed_ticket_types = allowed_ticket_types.filter((t: string) => VALID_TYPES.includes(t));
    }

    if (typeof email_on_ticket_found === 'boolean') {
      updates.email_on_ticket_found = email_on_ticket_found;
    }

    if (typeof email_on_letter_mailed === 'boolean') {
      updates.email_on_letter_mailed = email_on_letter_mailed;
    }

    if (typeof email_on_approval_needed === 'boolean') {
      updates.email_on_approval_needed = email_on_approval_needed;
    }

    const { error } = await supabaseAdmin
      .from('autopilot_settings')
      .update(updates)
      .eq('user_id', userId);

    if (error) {
      console.error('Error updating autopilot settings:', error);
      return res.status(500).json({ error: 'Failed to update settings' });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Update settings error:', error);
    return res.status(500).json({ error: error.message || 'Failed to update settings' });
  }
}
