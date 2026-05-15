/**
 * POST /api/admin/ocr-permit-sign
 * Body: { photo_base64: "data:image/jpeg;base64,..." }
 * Returns parsed sign fields ready to drop into the field-collection form.
 *
 * Uses Claude Haiku 4.5 with an anti-hallucination prompt (NO specific zone
 * number in the example, explicit instruction to return null on illegible
 * digits, structured output for direct form-fill).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import Anthropic from '@anthropic-ai/sdk';

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const VISION_PROMPT = `This is a close-up photograph of a Chicago street sign, taken by someone walking the city to catalog permit-parking signs. Read what is actually printed on the sign and return strict JSON.

Output schema:
{"sign":{
  "kind":"permit_zone"|"tow_zone"|"snow_route"|"street_cleaning"|"no_parking"|"pedestrian_crossing"|"stop"|"speed_limit"|"one_way"|"do_not_enter"|"other"|"none",
  "zone_number":<int or null — ONLY if clearly readable>,
  "all_days":<bool — true ONLY if sign says "ALL DAYS" or "EVERYDAY">,
  "days_array":[<subset of "mon","tue","wed","thu","fri","sat","sun"> or null],
  "all_times":<bool — true ONLY if sign says "ALL TIMES" or "ANY TIME" or "24 HOURS">,
  "hours_start_24":"HH:MM" or null,
  "hours_end_24":"HH:MM" or null,
  "sign_condition":"clear"|"faded"|"damaged"|"obscured",
  "raw_text":<string — VERBATIM text on the sign with line breaks as \\n>
}}

Reference patterns (DO NOT copy unless they actually match):
- Chicago residential permit-zone sign: WHITE rectangle with RED border, header "RESIDENTIAL PERMIT PARKING ONLY", a zone number on a small sticker, and an hours line (e.g. "5 PM TO 9 AM MON THRU SAT, ANYTIME SUN").
- Day ranges to normalize: "MON THRU SAT" -> ["mon","tue","wed","thu","fri","sat"]; "MON-FRI" -> ["mon","tue","wed","thu","fri"]; "ANYTIME SUN" combined with hours on other days = include "sun" with all_times split.
- Hours: convert to 24-hour. "5 PM" -> "17:00". "9 AM" -> "09:00". Overnight hours are allowed (start later than end).

CRITICAL RULES:
- Read ONLY what is actually printed. Do not infer or pattern-match to common values.
- If you cannot read the zone number, set zone_number to null.
- If the sign mixes (e.g. permit hours Mon-Sat, but "ANYTIME SUN"), still set days_array to the WEEKDAY portion and put the Sunday exception in raw_text/notes for the human to resolve.
- If no sign is clearly visible, kind:"none".

Output ONLY the JSON object, no prose, no markdown fences.`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { photo_base64 } = req.body || {};
  if (!photo_base64 || typeof photo_base64 !== 'string') {
    return res.status(400).json({ error: 'photo_base64 (data URL) required' });
  }
  const m = photo_base64.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'photo_base64 must be a data: URL' });
  const mime = m[1];
  const b64 = m[2];

  try {
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime as any, data: b64 } },
          { type: 'text', text: VISION_PROMPT },
        ],
      }],
    });
    const text = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const clean = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
    let sign: any;
    try { sign = JSON.parse(clean).sign; }
    catch { return res.status(200).json({ sign: null, raw_response: text.slice(0, 400) }); }
    return res.status(200).json({ sign });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
