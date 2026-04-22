import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

// Server-side proxy for Google Places API (New) — Place Details endpoint.
// https://developers.google.com/maps/documentation/places/web-service/place-details
//
// Paired with /places-autocomplete. Using a session token across both calls
// means Google bills the pair as a single "session" rather than per-request.
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

  const place_id = typeof req.query.place_id === 'string' ? req.query.place_id.slice(0, 256) : '';
  if (!place_id) {
    return res.status(400).json({ error: 'place_id required' });
  }
  const session = typeof req.query.session === 'string' ? req.query.session.slice(0, 128) : '';

  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error('[places-details] missing GOOGLE_API_KEY');
    return res.status(500).json({ error: 'server_not_configured' });
  }

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(place_id)}`);
  if (session) url.searchParams.set('sessionToken', session);

  try {
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'addressComponents,formattedAddress,location',
      },
    });
    const data = await upstream.json();

    if (!upstream.ok) {
      const msg = data?.error?.message || 'upstream_error';
      console.error('[places-details] upstream', upstream.status, msg);
      return res.status(502).json({ error: msg });
    }

    const comps: Array<{ longText: string; shortText: string; types: string[] }> =
      data.addressComponents || [];
    const pick = (type: string, long = false) => {
      const c = comps.find((x) => x.types.includes(type));
      return c ? (long ? c.longText : c.shortText) : '';
    };

    const streetNumber = pick('street_number');
    const route = pick('route', true);
    const street = [streetNumber, route].filter(Boolean).join(' ').trim();
    const city =
      pick('locality', true) ||
      pick('sublocality', true) ||
      pick('sublocality_level_1', true) ||
      pick('postal_town', true) ||
      '';
    const state = pick('administrative_area_level_1');
    const zip = pick('postal_code');
    const zipSuffix = pick('postal_code_suffix');
    const fullZip = zip && zipSuffix ? `${zip}-${zipSuffix}` : zip;

    return res.status(200).json({
      street,
      city,
      state,
      zip: fullZip,
      formatted: data.formattedAddress || '',
      lat: data.location?.latitude ?? null,
      lng: data.location?.longitude ?? null,
      place_id,
    });
  } catch (err: any) {
    console.error('[places-details] fetch failed', err?.message);
    return res.status(502).json({ error: 'upstream_failed' });
  }
}
