import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

// Server-side proxy for Google Places API (New) — Autocomplete endpoint.
// https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
//
// We keep the API key on the server (GOOGLE_API_KEY), rate-limit by IP, and
// return a normalized shape the browser component can consume directly.
//
// Requires "Places API (New)" to be enabled on the Google Cloud project.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = getClientIP(req);
  const rate = await checkRateLimit(ip, 'api');
  if (!rate.allowed) {
    return res.status(429).json({ error: 'rate_limited', retry_in_ms: rate.resetIn });
  }
  await recordRateLimitAction(ip, 'api');

  const raw = req.query.input;
  const input = Array.isArray(raw) ? raw[0] : raw || '';
  if (typeof input !== 'string' || input.trim().length < 3) {
    return res.status(200).json({ predictions: [] });
  }
  const trimmed = input.trim().slice(0, 200);

  const session = typeof req.query.session === 'string' ? req.query.session.slice(0, 128) : '';
  const biasChicago = req.query.bias === 'chicago';

  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error('[places-autocomplete] missing GOOGLE_API_KEY');
    return res.status(500).json({ error: 'server_not_configured' });
  }

  const body: Record<string, unknown> = {
    input: trimmed,
    includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
    includedRegionCodes: ['us'],
  };
  if (session) body.sessionToken = session;
  if (biasChicago) {
    body.locationBias = {
      circle: {
        center: { latitude: 41.8781, longitude: -87.6298 },
        radius: 50000,
      },
    };
  }

  try {
    const upstream = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();

    if (!upstream.ok) {
      const msg = data?.error?.message || 'upstream_error';
      console.error('[places-autocomplete] upstream', upstream.status, msg);
      return res.status(502).json({ predictions: [], error: msg });
    }

    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    const predictions = suggestions
      .map((s: any) => s?.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({
        place_id: p.placeId,
        description: p.text?.text || '',
        structured_formatting: {
          main_text: p.structuredFormat?.mainText?.text || '',
          secondary_text: p.structuredFormat?.secondaryText?.text || '',
        },
      }));

    return res.status(200).json({ predictions });
  } catch (err: any) {
    console.error('[places-autocomplete] fetch failed', err?.message);
    return res.status(502).json({ predictions: [], error: 'upstream_failed' });
  }
}
