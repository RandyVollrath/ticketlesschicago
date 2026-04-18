import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROFILE_FIELDS = [
  'first_name', 'last_name', 'phone_number',
  'license_plate', 'license_state',
  'vehicle_make', 'vehicle_model', 'vehicle_color', 'vehicle_year',
  'home_address_full',
  'mailing_address', 'mailing_city', 'mailing_state', 'mailing_zip',
  'city_sticker_expiry', 'plate_expiry',
];

const SETTINGS_FIELDS = [
  'allowed_ticket_types',
  'email_on_ticket_found', 'email_on_letter_mailed', 'email_on_approval_needed',
];

/**
 * Called right after Google OAuth, before Stripe checkout.
 * Copies the anonymous funnel_leads row into the authed user's user_profiles
 * + autopilot_settings, then marks the lead as converted (frozen).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = authUser.id;

    const { session_id } = req.body || {};
    if (!session_id || typeof session_id !== 'string' || !UUID_RE.test(session_id)) {
      return res.status(400).json({ error: 'Invalid session_id' });
    }

    const { data: lead, error: leadError } = await supabaseAdmin
      .from('funnel_leads')
      .select('*')
      .eq('session_id', session_id)
      .maybeSingle();

    if (leadError) {
      console.error('Lead lookup error:', leadError);
      return res.status(500).json({ error: 'Failed to load funnel data' });
    }

    if (!lead) {
      // Nothing to apply — caller can proceed without funnel data.
      return res.status(200).json({ success: true, applied: false });
    }

    // Build profile patch
    const profileUpdates: Record<string, any> = { user_id: userId };
    for (const f of PROFILE_FIELDS) {
      if (lead[f] !== null && lead[f] !== undefined && lead[f] !== '') {
        profileUpdates[f] = lead[f];
      }
    }
    if (authUser.email && !profileUpdates.email) {
      profileUpdates.email = authUser.email;
    }

    if (Object.keys(profileUpdates).length > 1) {
      profileUpdates.updated_at = new Date().toISOString();
      const { error: profErr } = await supabaseAdmin
        .from('user_profiles')
        .upsert(profileUpdates, { onConflict: 'user_id' });
      if (profErr) {
        console.error('Profile upsert error:', profErr);
        return res.status(500).json({ error: 'Failed to save profile' });
      }
    }

    // Build settings patch (only if anything is set)
    const settingsUpdates: Record<string, any> = { user_id: userId };
    let hasSettings = false;
    for (const f of SETTINGS_FIELDS) {
      if (lead[f] !== null && lead[f] !== undefined) {
        settingsUpdates[f] = lead[f];
        hasSettings = true;
      }
    }

    if (hasSettings) {
      settingsUpdates.updated_at = new Date().toISOString();
      const { error: setErr } = await supabaseAdmin
        .from('autopilot_settings')
        .upsert(settingsUpdates, { onConflict: 'user_id' });
      if (setErr) {
        console.error('Settings upsert error:', setErr);
        // Non-fatal — profile is the must-have
      }
    }

    // Freeze the lead row
    await supabaseAdmin
      .from('funnel_leads')
      .update({
        converted_user_id: userId,
        converted_at: new Date().toISOString(),
        email: authUser.email || lead.email,
      })
      .eq('session_id', session_id);

    return res.status(200).json({ success: true, applied: true });
  } catch (error: any) {
    console.error('apply-to-user exception:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
