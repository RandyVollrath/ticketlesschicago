// Mapbox Geocoding v6 — reverse lookup for a single GPS point.
//
// Why this exists alongside lib/mapbox-map-matching.ts:
// Map matching expects a MOVING trajectory. For stationary parked-car GPS
// (where the last 5+ trajectory fixes cluster within ~10m of the curb),
// Mapbox map-matching returns matched=true but with empty street name and
// confidence ≈ 0 — not useful. Real-world data from 2026-04-23/24:
//   row 48 (W FOSTER):   matched 11/11, conf=0,        street=""
//   row 50 (N WOLCOTT):  matched 11/11, conf=0.000138, street=""
//   row 55 (W LAWRENCE): matched 11/11, conf=0,        street=""
// All three should have been clean grid-street matches.
//
// Reverse geocoding takes a single point and returns the nearest street/
// address with proper Mapbox match-quality metadata. This is exactly what
// we need for "what street is this parking spot on" — same problem
// Nominatim solves, but with Mapbox's data as a second opinion.
//
// Set MAPBOX_ACCESS_TOKEN in env. Without it, this module is a no-op.

export interface MapboxReverseGeocodeResult {
  matched: boolean;
  // Best street name we could extract (from props.context.street.name or
  // a feature whose feature_type is 'street').
  streetName: string | null;
  // Address number if the point landed on an interpolated/rooftop feature.
  houseNumber: string | null;
  // Human-readable concatenation Mapbox returned for the top feature.
  fullAddress: string | null;
  // The top feature's classification: 'address' | 'street' | 'block' | etc.
  featureType: string | null;
  // Mapbox match-code confidence string when present:
  // 'exact' | 'high' | 'medium' | 'low' | null.
  matchConfidence: string | null;
  skipReason?: string;
}

const ENDPOINT = 'https://api.mapbox.com/search/geocode/v6/reverse';

export async function mapboxReverseGeocode(
  lat: number,
  lng: number,
): Promise<MapboxReverseGeocodeResult> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return empty('no_token');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return empty('bad_coords');

  // types=address,street: prefer a precise address feature, fall back to a
  // street centerline feature. Limit 1 keeps the response small.
  // worldview=us so US-specific street names win over alternates.
  const params = new URLSearchParams({
    longitude: lng.toFixed(6),
    latitude: lat.toFixed(6),
    types: 'address,street',
    limit: '1',
    worldview: 'us',
    access_token: token,
  });
  const url = `${ENDPOINT}?${params.toString()}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) return empty(`http_${resp.status}`);
    const json: any = await resp.json();
    const feature = Array.isArray(json.features) ? json.features[0] : null;
    if (!feature) return empty('no_features');

    const props = feature.properties ?? {};
    const ctx = props.context ?? {};
    const featureType = props.feature_type ?? null;

    // Geocoding v6 places the street name in different spots depending on
    // the feature_type:
    //   feature_type='address': props.context.street.name
    //   feature_type='street':  props.name (the feature itself is the street)
    let streetName: string | null = null;
    if (featureType === 'street') {
      streetName = (props.name as string) ?? null;
    } else if (ctx.street?.name) {
      streetName = ctx.street.name;
    } else if (props.name) {
      // Some address features put the street into top-level name as well.
      streetName = props.name;
    }

    const houseNumber: string | null =
      (props.address_number as string) ??
      (ctx.address?.address_number as string) ??
      null;

    return {
      matched: true,
      streetName,
      houseNumber,
      fullAddress: (props.full_address as string) ?? (props.place_formatted as string) ?? null,
      featureType,
      matchConfidence: props.match_code?.confidence ?? null,
    };
  } catch (e: any) {
    return empty(e?.name === 'AbortError' ? 'timeout' : 'fetch_error');
  }
}

function empty(reason: string): MapboxReverseGeocodeResult {
  return {
    matched: false,
    streetName: null,
    houseNumber: null,
    fullAddress: null,
    featureType: null,
    matchConfidence: null,
    skipReason: reason,
  };
}
