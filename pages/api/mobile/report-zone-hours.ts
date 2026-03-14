/**
 * Report incorrect permit zone hours — with auto-accept.
 *
 * When a user reports that the posted hours for their block differ from what
 * we show, we immediately create/update a block-level override so the next
 * parking check at that location uses the corrected hours.
 *
 * POST body:
 *   zone          — permit zone number (string)
 *   zoneType      — 'residential' | 'industrial'
 *   schedule      — user-reported schedule, e.g. "Mon-Fri 8am-10pm"
 *   currentSchedule — what we showed them (optional, for audit)
 *   latitude      — GPS lat where they saw the sign
 *   longitude     — GPS lng
 *   address       — reverse-geocoded address (optional)
 *   rawSignText   — user typed the sign text (optional)
 *   photoBase64   — base64-encoded JPEG of the sign (optional)
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { parseChicagoAddress } from '../../../lib/address-parser';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Allow photo uploads
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    // Auth — optional (allow anonymous reports but prefer authenticated)
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(accessToken);
      if (user) userId = user.id;
    }

    // Parse request body
    const {
      zone,
      zoneType = 'residential',
      schedule,
      currentSchedule,
      latitude,
      longitude,
      address,
      rawSignText,
      photoBase64,
    } = req.body || {};

    if (!zone || !schedule) {
      return res.status(400).json({ error: 'zone and schedule are required' });
    }

    // Parse address to get block components
    let blockNumber = 0;
    let streetDirection = '';
    let streetName = '';
    let streetType = '';

    if (address) {
      const parsed = parseChicagoAddress(address);
      if (parsed) {
        blockNumber = Math.floor(parsed.number / 100) * 100;
        streetDirection = parsed.direction || '';
        streetName = parsed.name || '';
        streetType = parsed.suffix || '';
      }
    }

    // If we couldn't parse the address but have coordinates, try reverse geocode
    if (!streetName && latitude && longitude) {
      try {
        const rgUrl = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=18`;
        const rgResp = await fetch(rgUrl, {
          headers: { 'User-Agent': 'TicketlessChicago/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (rgResp.ok) {
          const rgData = await rgResp.json();
          const houseNumber = rgData.address?.house_number;
          const road = rgData.address?.road;
          if (houseNumber && road) {
            const parsed = parseChicagoAddress(`${houseNumber} ${road}`);
            if (parsed) {
              blockNumber = Math.floor(parsed.number / 100) * 100;
              streetDirection = parsed.direction || '';
              streetName = parsed.name || '';
              streetType = parsed.suffix || '';
            }
          }
        }
      } catch {}
    }

    // Upload photo if provided
    let photoUrl: string | null = null;
    if (photoBase64) {
      try {
        const buffer = Buffer.from(photoBase64, 'base64');
        const fileName = `zone-reports/${zone}/${Date.now()}_${userId || 'anon'}.jpg`;

        // Ensure bucket exists
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        if (!buckets?.find(b => b.name === 'zone-sign-photos')) {
          await supabaseAdmin.storage.createBucket('zone-sign-photos', {
            public: true,
            fileSizeLimit: 10 * 1024 * 1024, // 10MB
          });
        }

        const { error: uploadError } = await supabaseAdmin.storage
          .from('zone-sign-photos')
          .upload(fileName, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (!uploadError) {
          const { data: urlData } = supabaseAdmin.storage
            .from('zone-sign-photos')
            .getPublicUrl(fileName);
          photoUrl = urlData?.publicUrl || null;
        }
      } catch (uploadErr: any) {
        console.warn('[report-zone-hours] photo upload failed:', uploadErr?.message);
        // Continue without photo — don't fail the whole report
      }
    }

    // 1. Save the user report (audit trail)
    const { error: reportError } = await supabaseAdmin
      .from('permit_zone_user_reports')
      .insert({
        user_id: userId,
        zone,
        zone_type: zoneType,
        latitude: latitude || null,
        longitude: longitude || null,
        address: address || null,
        block_number: blockNumber || null,
        street_direction: streetDirection,
        street_name: streetName || null,
        street_type: streetType,
        reported_schedule: schedule,
        current_schedule: currentSchedule || null,
        raw_sign_text: rawSignText || null,
        photo_url: photoUrl,
        status: 'applied', // Auto-accept
        processed_at: new Date().toISOString(),
      });

    if (reportError) {
      console.warn('[report-zone-hours] report insert failed:', reportError.message);
    }

    // 2. AUTO-ACCEPT: Upsert block-level override immediately
    if (streetName && blockNumber) {
      const { error: overrideError } = await supabaseAdmin
        .from('permit_zone_block_overrides')
        .upsert({
          zone,
          zone_type: zoneType,
          block_number: blockNumber,
          street_direction: streetDirection,
          street_name: streetName,
          street_type: streetType,
          restriction_schedule: schedule,
          source: 'user_report',
          confidence: 'user_reported',
          reported_by: userId,
          raw_sign_text: rawSignText || null,
          photo_url: photoUrl,
          notes: currentSchedule ? `User corrected from "${currentSchedule}" to "${schedule}"` : null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'zone,block_number,street_direction,street_name,street_type',
        });

      if (overrideError) {
        console.error('[report-zone-hours] override upsert failed:', overrideError.message);
        return res.status(200).json({
          success: true,
          applied: false,
          warning: 'Report saved but override failed',
        });
      }

      console.log(`[report-zone-hours] Auto-accepted: Zone ${zone}, ${blockNumber} ${streetDirection} ${streetName} → "${schedule}" by ${userId || 'anonymous'}`);

      return res.status(200).json({
        success: true,
        applied: true,
        message: 'Thanks! Your correction has been applied immediately.',
        override: {
          zone,
          block: `${blockNumber} ${streetDirection} ${streetName}`.trim(),
          schedule,
        },
      });
    }

    // Could save the report but couldn't determine the block
    return res.status(200).json({
      success: true,
      applied: false,
      message: 'Report saved. We could not determine the exact block — a team member will review it.',
    });
  } catch (error: any) {
    console.error('[report-zone-hours] error', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
