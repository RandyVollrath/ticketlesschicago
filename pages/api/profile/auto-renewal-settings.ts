// User-facing auto-renewal toggle endpoint.
//
// GET  → { authorized, city_sticker, license_plate, city_sticker_ready, license_plate_ready, missing }
// POST → flip any subset of { authorized, city_sticker, license_plate }
//
// Safety:
//   - Sub-toggle for city_sticker can only be TRUE if license_plate + vin + last_name are on file.
//   - Sub-toggle for license_plate can only be TRUE if IL Reg ID + PIN are on file.
//   - If master `authorized` is flipped to FALSE we also force both sub-toggles to FALSE so we
//     can't accidentally charge after revoke.
//   - Every state change is mirrored to audit_logs (action_type=user_auto_renewal_toggle).
//
// Note: the global env-level kill switch AUTO_RENEWAL_GLOBALLY_ENABLED still trumps everything
// (lib/auto-renewal-gate.ts). This endpoint just records the user's stated preference.

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin, supabase } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { maskUserId } from '../../../lib/mask-pii';
import { verifyDeclaredZoneAgainstAddress } from '../../../lib/check-permit-zone';

const patchSchema = z.object({
  authorized: z.boolean().optional(),
  city_sticker: z.boolean().optional(),
  license_plate: z.boolean().optional(),
  // User intent: "if I'm in a permit zone, also buy the residential parking
  // permit on my behalf at sticker renewal time." Independent of city_sticker
  // — a user may want a sticker-only renewal even though they qualify.
  permit_requested: z.boolean().optional(),
});

interface ProfileRow {
  user_id: string;
  email: string | null;
  last_name: string | null;
  license_plate: string | null;
  vin: string | null;
  il_pin_encrypted: string | null;
  il_registration_id_encrypted: string | null;
  auto_renewal_authorized: boolean | null;
  auto_renewal_authorized_at: string | null;
  auto_renewal_authorized_by: string | null;
  auto_renewal_city_sticker: boolean | null;
  auto_renewal_license_plate: boolean | null;
  has_permit_zone: boolean | null;
  permit_requested: boolean | null;
  permit_zone_number: string | null;
  home_address_full: string | null;
  mailing_address: string | null;
}

const PROFILE_COLUMNS =
  'user_id, email, last_name, license_plate, vin, il_pin_encrypted, il_registration_id_encrypted, ' +
  'auto_renewal_authorized, auto_renewal_authorized_at, auto_renewal_authorized_by, ' +
  'auto_renewal_city_sticker, auto_renewal_license_plate, ' +
  'has_permit_zone, permit_requested, permit_zone_number, home_address_full, mailing_address';

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

function readinessSummary(row: ProfileRow) {
  const city_sticker_ready = Boolean(row.license_plate && row.vin && row.last_name);
  const license_plate_ready = Boolean(row.il_pin_encrypted && row.il_registration_id_encrypted);

  const missing: { city_sticker: string[]; license_plate: string[] } = {
    city_sticker: [],
    license_plate: [],
  };
  if (!row.license_plate) missing.city_sticker.push('license_plate');
  if (!row.vin) missing.city_sticker.push('vin');
  if (!row.last_name) missing.city_sticker.push('last_name');
  if (!row.il_registration_id_encrypted) missing.license_plate.push('il_registration_id');
  if (!row.il_pin_encrypted) missing.license_plate.push('il_pin');

  return { city_sticker_ready, license_plate_ready, missing };
}

function buildResponse(row: ProfileRow) {
  return {
    authorized: Boolean(row.auto_renewal_authorized),
    city_sticker: Boolean(row.auto_renewal_city_sticker),
    license_plate: Boolean(row.auto_renewal_license_plate),
    authorized_at: row.auto_renewal_authorized_at,
    // has_permit_zone is read-only here: it reflects our parking_permit_zones
    // lookup of the user's saved address. Recomputed in profile-update.ts when
    // the address changes; never set directly by this endpoint. The toggle the
    // user actually controls is permit_requested.
    has_permit_zone: Boolean(row.has_permit_zone),
    permit_requested: Boolean(row.permit_requested),
    ...readinessSummary(row),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req);
  if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

  try {
    const { data: current, error: fetchErr } = await (supabaseAdmin as any)
      .from('user_profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current) return res.status(404).json({ error: 'Profile not found' });

    const currentRow = current as ProfileRow;

    if (req.method === 'GET') {
      return res.status(200).json(buildResponse(currentRow));
    }

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const ready = readinessSummary(currentRow);

    const targetAuthorized =
      parsed.data.authorized !== undefined ? parsed.data.authorized : Boolean(currentRow.auto_renewal_authorized);
    let targetCity =
      parsed.data.city_sticker !== undefined ? parsed.data.city_sticker : Boolean(currentRow.auto_renewal_city_sticker);
    let targetPlate =
      parsed.data.license_plate !== undefined ? parsed.data.license_plate : Boolean(currentRow.auto_renewal_license_plate);
    let targetPermit =
      parsed.data.permit_requested !== undefined ? parsed.data.permit_requested : Boolean(currentRow.permit_requested);

    // Force sub-toggles off if master is off.
    if (!targetAuthorized) {
      targetCity = false;
      targetPlate = false;
      // Permit intent is independent of the auto-renew master switch — leaving
      // it on while the master is off would let us pick the wrong cart total
      // if the user re-enables auto-renew later. Mirror the same off-on-revoke
      // safety as the sticker toggles.
      targetPermit = false;
    }

    // Reject if sub-toggle is on but the required credentials aren't present.
    if (targetCity && !ready.city_sticker_ready) {
      return res.status(400).json({
        error: 'Missing city sticker credentials',
        missing: ready.missing.city_sticker,
      });
    }
    if (targetPlate && !ready.license_plate_ready) {
      return res.status(400).json({
        error: 'Missing IL plate sticker credentials',
        missing: ready.missing.license_plate,
      });
    }

    // Reject permit_requested=true if we don't believe the address is in a
    // permit zone. has_permit_zone is recomputed on every address change in
    // profile-update.ts; if it's false here, our parking_permit_zones table
    // says the address doesn't qualify and we won't waste $30 on a permit.
    if (targetPermit && !currentRow.has_permit_zone) {
      return res.status(400).json({
        error: 'Address is not in an active residential permit zone',
        detail: 'Update your address on file if you recently moved; we recompute permit-zone eligibility from city data.',
      });
    }

    // Earlier-stage verification of "address vs the specific zone the user
    // declared they hold" — catches the failure mode where someone signed up
    // claiming Zone 2483 but their saved address actually maps to Zone 1855
    // (or no zone at all). Doing it here means the EzBuy bot's
    // address-mismatch guard never has to fire for foreseeable cases.
    if (targetPermit && currentRow.permit_zone_number) {
      const address = currentRow.mailing_address || currentRow.home_address_full;
      if (address) {
        try {
          const verdict = await verifyDeclaredZoneAgainstAddress(address, currentRow.permit_zone_number);
          if (verdict.decision === 'wrong-zone') {
            return res.status(400).json({
              error: 'Declared permit zone does not match your address',
              detail: `Your saved address is in zone(s) ${verdict.matchedZones.join(', ')}, but you have zone ${verdict.declared} on file. Update your address (if you moved) or your declared zone before turning permit purchase on.`,
            });
          }
          if (verdict.decision === 'address-not-in-any-zone') {
            return res.status(400).json({
              error: 'Address is not in any active residential permit zone',
              detail: `Your saved address doesn't match any active permit zone in our city data. You have zone ${verdict.declared} on file — update your address (if you moved) or remove the declared zone.`,
            });
          }
          // 'match' and 'inconclusive' both fall through — inconclusive means
          // we couldn't parse and we shouldn't block legitimate users.
        } catch (e) {
          console.error('[auto-renewal-settings] verifyDeclaredZoneAgainstAddress failed (continuing):', e);
        }
      }
    }

    const updates: Record<string, unknown> = {
      auto_renewal_authorized: targetAuthorized,
      auto_renewal_city_sticker: targetCity,
      auto_renewal_license_plate: targetPlate,
      permit_requested: targetPermit,
    };

    if (targetAuthorized && !currentRow.auto_renewal_authorized) {
      updates.auto_renewal_authorized_at = new Date().toISOString();
      updates.auto_renewal_authorized_by = currentRow.email || `user:${auth.userId}`;
      updates.auto_renewal_authorization_reason = 'self-serve via /settings';
    } else if (!targetAuthorized && currentRow.auto_renewal_authorized) {
      updates.auto_renewal_authorized_at = null;
      updates.auto_renewal_authorized_by = null;
      updates.auto_renewal_authorization_reason = null;
    }

    const { error: updErr } = await (supabaseAdmin as any)
      .from('user_profiles')
      .update(updates)
      .eq('user_id', auth.userId);

    if (updErr) throw updErr;

    // Audit row — use the same schema as scripts/grant-auto-renewal.ts.
    await (supabaseAdmin as any)
      .from('audit_logs')
      .insert({
        user_id: auth.userId,
        action_type: 'user_auto_renewal_toggle',
        entity_type: 'user_profile',
        entity_id: auth.userId,
        action_details: {
          before: {
            authorized: Boolean(currentRow.auto_renewal_authorized),
            city_sticker: Boolean(currentRow.auto_renewal_city_sticker),
            license_plate: Boolean(currentRow.auto_renewal_license_plate),
            permit_requested: Boolean(currentRow.permit_requested),
          },
          after: {
            authorized: targetAuthorized,
            city_sticker: targetCity,
            license_plate: targetPlate,
            permit_requested: targetPermit,
          },
        },
        status: 'success',
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn(`[auto-renewal-settings] audit log insert skipped: ${error.message}`);
      });

    console.log(
      `[auto-renewal-settings] ${maskUserId(auth.userId)} → authorized=${targetAuthorized}, city=${targetCity}, plate=${targetPlate}, permit=${targetPermit}`,
    );

    const updatedRow: ProfileRow = {
      ...currentRow,
      auto_renewal_authorized: targetAuthorized,
      auto_renewal_city_sticker: targetCity,
      auto_renewal_license_plate: targetPlate,
      permit_requested: targetPermit,
      auto_renewal_authorized_at: (updates.auto_renewal_authorized_at as string | null | undefined) ?? currentRow.auto_renewal_authorized_at,
    };

    return res.status(200).json(buildResponse(updatedRow));
  } catch (err) {
    console.error('[auto-renewal-settings] error:', err);
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
}
