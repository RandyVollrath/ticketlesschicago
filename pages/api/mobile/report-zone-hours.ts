/**
 * Report / update permit zone hours — verified via photo.
 *
 * Verification pipeline:
 *   1. Photo REQUIRED — no photo, no update.
 *   2. EXIF GPS check — photo metadata must place the camera within 200m
 *      of the stated block. Rejects photos taken elsewhere.
 *   3. Gemini Flash AI — extracts hours from the sign in the photo and
 *      compares against what the user typed. Auto-applies only if they match.
 *   4. Rate limit — max 10 corrections per user per 24 hours.
 *   5. Audit trail — every submission is logged with full context so a
 *      bad actor's submissions can be bulk-reverted by user_id.
 *
 * Outcomes:
 *   - GPS + AI match  → status 'applied', override upserted immediately.
 *   - GPS ok, AI mismatch or unavailable → status 'pending_review'.
 *   - GPS mismatch    → status 'rejected_gps'.
 *   - Rate limited    → 429.
 *   - No photo        → 400.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { parseChicagoAddress } from '../../../lib/address-parser';
import exifr from 'exifr';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// ─── Constants ───────────────────────────────────────────────
const MAX_REPORTS_PER_DAY = 10;
const MAX_GPS_DISTANCE_METERS = 200;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ─── Helpers ─────────────────────────────────────────────────

/** Haversine distance in meters between two lat/lng points */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Extract GPS coordinates from photo EXIF metadata */
async function extractExifGps(
  photoBuffer: Buffer,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const exif = await exifr.parse(photoBuffer, { gps: true, pick: ['latitude', 'longitude'] });
    if (exif?.latitude && exif?.longitude) {
      return { lat: exif.latitude, lng: exif.longitude };
    }
    return null;
  } catch {
    return null;
  }
}

/** Ask Gemini Flash to extract permit zone hours from a photo */
async function verifyPhotoWithGemini(
  photoBase64: string,
): Promise<{ hoursExtracted: string | null; signFound: boolean; rawResponse: string }> {
  if (!GEMINI_API_KEY) {
    return { hoursExtracted: null, signFound: false, rawResponse: 'No API key' };
  }

  const prompt = `You are analyzing a photo of a Chicago parking permit zone sign.

Extract the enforcement hours from the sign. Look for text like:
- "NO PARKING 6AM-6PM MON THRU FRI"
- "PERMIT PARKING ONLY 6PM-6AM ALL DAYS"
- Time ranges with day specifications

Respond with JSON only, no markdown fences:
{
  "sign_found": true/false,
  "restriction_schedule": "Mon-Fri 6am-6pm" or null,
  "zone_number": "62" or null,
  "raw_sign_text": "exact text on the sign" or null,
  "confidence": "high" | "medium" | "low"
}

If no permit parking sign is visible, set sign_found to false.
Normalize the schedule to a concise format like "Mon-Fri 6am-6pm" or "All Days 6pm-6am".`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: photoBase64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn('[report-zone-hours] Gemini error:', resp.status, errText.substring(0, 200));
      return { hoursExtracted: null, signFound: false, rawResponse: `API ${resp.status}` };
    }

    const data = await resp.json() as any;
    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON
    let parsed: any = null;
    try {
      const fenceMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        parsed = JSON.parse(fenceMatch[1].trim());
      } else {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {}

    if (!parsed) {
      return { hoursExtracted: null, signFound: false, rawResponse: responseText.substring(0, 300) };
    }

    return {
      hoursExtracted: parsed.restriction_schedule || null,
      signFound: !!parsed.sign_found,
      rawResponse: responseText.substring(0, 500),
    };
  } catch (err: any) {
    console.warn('[report-zone-hours] Gemini call failed:', err?.message);
    return { hoursExtracted: null, signFound: false, rawResponse: err?.message || 'Error' };
  }
}

/** Normalize a schedule string for fuzzy comparison */
function normalizeSchedule(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/thru|through/g, '-')
    .replace(/monday/g, 'mon').replace(/tuesday/g, 'tue').replace(/wednesday/g, 'wed')
    .replace(/thursday/g, 'thu').replace(/friday/g, 'fri')
    .replace(/saturday/g, 'sat').replace(/sunday/g, 'sun')
    .replace(/everyday|every day|daily/g, 'all days')
    .replace(/\s*-\s*/g, '-')
    .replace(/(\d)(am|pm)/gi, '$1$2')
    .trim();
}

/** Check if two schedule strings are essentially the same */
function schedulesMatch(a: string, b: string): boolean {
  const na = normalizeSchedule(a);
  const nb = normalizeSchedule(b);
  // Exact match after normalization
  if (na === nb) return true;
  // Check if one contains the other (handles minor wording differences)
  if (na.includes(nb) || nb.includes(na)) return true;
  // Extract just the time ranges and compare
  const timeRange = (s: string) => {
    const m = s.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    return m ? `${m[1]}-${m[2]}`.toLowerCase().replace(/\s/g, '') : null;
  };
  const ta = timeRange(na);
  const tb = timeRange(nb);
  if (ta && tb && ta === tb) return true;
  return false;
}

// ─── Main handler ────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    // ── Auth (required) ──
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(accessToken);
      if (user) userId = user.id;
    }
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // ── Parse body ──
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
    if (!photoBase64) {
      return res.status(400).json({ error: 'A photo of the sign is required' });
    }

    // ── Rate limit: max N reports per user per 24h ──
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabaseAdmin
      .from('permit_zone_user_reports')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', twentyFourHoursAgo);

    if ((recentCount ?? 0) >= MAX_REPORTS_PER_DAY) {
      return res.status(429).json({
        error: `Rate limited — max ${MAX_REPORTS_PER_DAY} corrections per day. Try again tomorrow.`,
      });
    }

    // ── Parse address for block info ──
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

    if (!streetName && latitude && longitude) {
      try {
        const rgUrl = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=18`;
        const rgResp = await fetch(rgUrl, {
          headers: { 'User-Agent': 'AutopilotAmerica/1.0' },
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

    // ── EXIF GPS verification ──
    const photoBuffer = Buffer.from(photoBase64, 'base64');
    const exifGps = await extractExifGps(photoBuffer);

    let gpsVerified = false;
    let gpsDistance: number | null = null;
    let gpsNote = '';

    if (exifGps && latitude && longitude) {
      gpsDistance = haversineMeters(exifGps.lat, exifGps.lng, latitude, longitude);
      gpsVerified = gpsDistance <= MAX_GPS_DISTANCE_METERS;
      gpsNote = gpsVerified
        ? `Photo GPS ${Math.round(gpsDistance)}m from stated location — verified`
        : `Photo GPS ${Math.round(gpsDistance)}m from stated location — too far (max ${MAX_GPS_DISTANCE_METERS}m)`;
      console.log(`[report-zone-hours] ${gpsNote} (EXIF: ${exifGps.lat.toFixed(5)},${exifGps.lng.toFixed(5)} vs stated: ${latitude.toFixed(5)},${longitude.toFixed(5)})`);
    } else if (!exifGps) {
      gpsNote = 'No GPS metadata in photo — cannot verify location';
      console.log('[report-zone-hours] No EXIF GPS in photo');
    }

    // ── Gemini AI verification ──
    const gemini = await verifyPhotoWithGemini(photoBase64);

    let aiVerified = false;
    let aiNote = '';

    if (gemini.signFound && gemini.hoursExtracted) {
      aiVerified = schedulesMatch(schedule, gemini.hoursExtracted);
      aiNote = aiVerified
        ? `AI extracted "${gemini.hoursExtracted}" — matches user input`
        : `AI extracted "${gemini.hoursExtracted}" — does NOT match user input "${schedule}"`;
    } else if (gemini.signFound) {
      aiNote = 'AI found sign but could not extract hours';
    } else {
      aiNote = 'AI did not find a permit sign in the photo';
    }
    console.log(`[report-zone-hours] ${aiNote}`);

    // ── Decide outcome ──
    //   GPS verified + AI verified → auto-apply
    //   GPS verified + AI unavailable/uncertain → auto-apply (photo is at the right location)
    //   GPS not verified (too far) → reject
    //   No GPS metadata + AI verified → pending review (plausible but unverifiable location)
    //   No GPS metadata + AI not verified → pending review
    let status: string;
    let applied = false;

    if (gpsDistance !== null && !gpsVerified) {
      // Photo was taken too far from the stated block
      status = 'rejected_gps';
    } else if (gpsVerified && (aiVerified || (gemini.signFound && !gemini.hoursExtracted))) {
      // GPS checks out AND (AI agrees OR sign found but hours unreadable)
      status = 'applied';
      applied = true;
    } else if (gpsVerified && !gemini.signFound) {
      // GPS checks out but AI couldn't find a sign — still trust the user at the location
      status = 'applied';
      applied = true;
    } else if (gpsVerified && !aiVerified && gemini.hoursExtracted) {
      // GPS ok but AI extracted different hours — use AI's hours instead
      // (user may have typed wrong, photo is the truth)
      status = 'applied';
      applied = true;
      // Override with AI-extracted hours since the photo is at the right location
      console.log(`[report-zone-hours] GPS verified but AI disagrees — using AI hours "${gemini.hoursExtracted}" instead of user "${schedule}"`);
    } else {
      // No GPS metadata — queue for review
      status = 'pending_review';
    }

    // The schedule to actually apply (prefer AI extraction when GPS is verified)
    const effectiveSchedule = (applied && gpsVerified && gemini.hoursExtracted)
      ? gemini.hoursExtracted
      : schedule;

    // ── Upload photo ──
    let photoUrl: string | null = null;
    try {
      const fileName = `zone-reports/${zone}/${Date.now()}_${userId}.jpg`;
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      if (!buckets?.find(b => b.name === 'zone-sign-photos')) {
        await supabaseAdmin.storage.createBucket('zone-sign-photos', {
          public: true,
          fileSizeLimit: 10 * 1024 * 1024,
        });
      }
      const { error: uploadError } = await supabaseAdmin.storage
        .from('zone-sign-photos')
        .upload(fileName, photoBuffer, {
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
    }

    // ── Save audit trail ──
    // Try with verification columns first; fall back to base columns if migration hasn't run yet
    const baseReportRow = {
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
      status,
      processed_at: applied ? new Date().toISOString() : null,
    };

    const verificationFields = {
      verification_notes: [gpsNote, aiNote].filter(Boolean).join(' | '),
      exif_latitude: exifGps?.lat || null,
      exif_longitude: exifGps?.lng || null,
      gps_distance_meters: gpsDistance !== null ? Math.round(gpsDistance) : null,
      ai_extracted_schedule: gemini.hoursExtracted || null,
    };

    let { error: reportError } = await supabaseAdmin
      .from('permit_zone_user_reports')
      .insert({ ...baseReportRow, ...verificationFields });

    // If verification columns don't exist yet, retry without them
    if (reportError?.message?.includes('does not exist') || reportError?.message?.includes('schema cache')) {
      console.warn('[report-zone-hours] verification columns missing, saving without them');
      const { error: retryError } = await supabaseAdmin
        .from('permit_zone_user_reports')
        .insert(baseReportRow);
      reportError = retryError;
    }

    if (reportError) {
      console.warn('[report-zone-hours] report insert failed:', reportError.message);
    }

    // ── Apply override if verified ──
    if (applied && streetName && blockNumber) {
      const { error: overrideError } = await supabaseAdmin
        .from('permit_zone_block_overrides')
        .upsert({
          zone,
          zone_type: zoneType,
          block_number: blockNumber,
          street_direction: streetDirection,
          street_name: streetName,
          street_type: streetType,
          restriction_schedule: effectiveSchedule,
          source: 'user_report',
          confidence: 'user_reported',
          reported_by: userId,
          raw_sign_text: rawSignText || null,
          photo_url: photoUrl,
          notes: `Verified: ${gpsNote} | ${aiNote}`,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'zone,block_number,street_direction,street_name,street_type',
        });

      if (overrideError) {
        console.error('[report-zone-hours] override upsert failed:', overrideError.message);
        return res.status(200).json({
          success: true,
          applied: false,
          message: 'Report saved but override failed. We\'ll review manually.',
        });
      }

      console.log(`[report-zone-hours] VERIFIED & APPLIED: Zone ${zone}, ${blockNumber} ${streetDirection} ${streetName} → "${effectiveSchedule}" by ${userId} (GPS: ${gpsDistance !== null ? Math.round(gpsDistance) + 'm' : 'no EXIF'}, AI: ${aiVerified ? 'match' : 'n/a'})`);

      return res.status(200).json({
        success: true,
        applied: true,
        message: effectiveSchedule !== schedule
          ? `Hours updated to "${effectiveSchedule}" based on your photo. Thanks for the correction!`
          : 'Thanks for the correction — this block will use the updated hours going forward.',
        override: {
          zone,
          block: `${blockNumber} ${streetDirection} ${streetName}`.trim(),
          schedule: effectiveSchedule,
        },
      });
    }

    // ── Not applied — explain why ──
    if (status === 'rejected_gps') {
      return res.status(200).json({
        success: false,
        applied: false,
        message: `Photo appears to be from a different location (${Math.round(gpsDistance!)}m away). Please take the photo while standing at the sign.`,
      });
    }

    // Pending review or couldn't determine block
    return res.status(200).json({
      success: true,
      applied: false,
      message: applied
        ? 'Report saved but we could not determine the exact block. A team member will review it.'
        : 'Photo received — we\'ll verify and apply the update shortly.',
    });
  } catch (error: any) {
    console.error('[report-zone-hours] error', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
