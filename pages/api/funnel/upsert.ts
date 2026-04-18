import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_TICKET_TYPES = new Set([
  'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
  'no_standing_time_restricted', 'parking_prohibited', 'residential_permit',
  'missing_plate', 'commercial_loading', 'fire_hydrant', 'street_cleaning', 'bus_lane',
  'red_light', 'speed_camera',
]);

const ALLOWED_FIELDS = [
  'last_step_reached',
  'first_name', 'last_name', 'phone_number',
  'license_plate', 'license_state',
  'vehicle_make', 'vehicle_model', 'vehicle_color', 'vehicle_year',
  'home_address_full',
  'mailing_address', 'mailing_city', 'mailing_state', 'mailing_zip',
  'city_sticker_expiry', 'plate_expiry',
  'allowed_ticket_types',
  'email_on_ticket_found', 'email_on_letter_mailed', 'email_on_approval_needed',
  'billing_plan', 'consent_checked',
  'email',
  'utm_source', 'utm_medium', 'utm_campaign',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { session_id, ...rawFields } = req.body || {};

    if (!session_id || typeof session_id !== 'string' || !UUID_RE.test(session_id)) {
      return res.status(400).json({ error: 'Invalid session_id' });
    }

    const update: Record<string, any> = { session_id };

    for (const key of ALLOWED_FIELDS) {
      if (!(key in rawFields)) continue;
      const v = (rawFields as any)[key];
      if (v === undefined) continue;

      if (key === 'allowed_ticket_types') {
        if (Array.isArray(v)) {
          update[key] = v.filter((t: any) => typeof t === 'string' && VALID_TICKET_TYPES.has(t));
        }
        continue;
      }

      if (key === 'email_on_ticket_found' || key === 'email_on_letter_mailed' || key === 'email_on_approval_needed' || key === 'consent_checked') {
        if (typeof v === 'boolean') update[key] = v;
        continue;
      }

      if (key === 'license_plate' || key === 'license_state') {
        if (typeof v === 'string') update[key] = v.trim().toUpperCase().slice(0, 16) || null;
        continue;
      }

      if (key === 'mailing_state') {
        if (typeof v === 'string') update[key] = v.trim().toUpperCase().slice(0, 4) || null;
        continue;
      }

      if (key === 'city_sticker_expiry' || key === 'plate_expiry') {
        if (v === null || v === '') { update[key] = null; continue; }
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) update[key] = v.slice(0, 10);
        continue;
      }

      if (key === 'email') {
        if (typeof v === 'string') update[key] = v.trim().slice(0, 320).toLowerCase() || null;
        continue;
      }

      if (typeof v === 'string') {
        update[key] = v.trim().slice(0, 500) || null;
      }
    }

    // First-write metadata
    const userAgent = req.headers['user-agent'];
    const referrer = (req.headers['referer'] || req.headers['referrer']) as string | undefined;

    const { data: existing } = await supabaseAdmin
      .from('funnel_leads')
      .select('id, converted_user_id')
      .eq('session_id', session_id)
      .maybeSingle();

    if (!existing) {
      if (typeof userAgent === 'string') update.user_agent = userAgent.slice(0, 500);
      if (typeof referrer === 'string') update.referrer = referrer.slice(0, 500);
    }

    // Once converted, freeze the lead row.
    if (existing?.converted_user_id) {
      return res.status(200).json({ success: true, frozen: true });
    }

    const { error } = await supabaseAdmin
      .from('funnel_leads')
      .upsert(update, { onConflict: 'session_id' });

    if (error) {
      console.error('Funnel upsert error:', error);
      return res.status(500).json({ error: 'Failed to save funnel data' });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Funnel upsert exception:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
