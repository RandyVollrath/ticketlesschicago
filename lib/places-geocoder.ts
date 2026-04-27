// Shared Chicago-grid geocoder. Use this instead of the legacy Maps Geocoding
// API for any address-to-coordinates conversion that feeds ward/section
// lookup, contest letters, or anything else that has to land on the right
// block.
//
// Why we don't use the legacy Maps Geocoding API
// (https://maps.googleapis.com/maps/api/geocode/json):
// On Chicago grid streets like Fullerton it interpolates along OSM-style
// segments and returns a midpoint that can be a full block (~1500 ft) east
// of the actual building. For "1237 W Fullerton Ave" it pinned the result
// at Sheffield/Fullerton (-87.6537), routing users into Ward 43 / Section 1
// instead of the correct Ward 2 / Section 1 — wrong cleaning schedule,
// wrong contest letter ward, wrong everything.
//
// Why we don't use Places searchText either:
// It picks the same interpolated point that the legacy API does. Google has
// two Places at "1237 W Fullerton" — an interpolated one at -87.6537 and
// the actual building at -87.6599. Autocomplete ranks the building first;
// searchText does not.
//
// What this does:
// Same two-step pipeline the website's AddressAutocomplete component uses:
//   autocomplete -> first prediction -> Place Details
// Sharing one session token so Google bills the pair as a single search.

export type GeocodeStatus = 'OK' | 'ZERO_RESULTS' | 'NOT_CHICAGO' | 'ERROR';

export interface GeocodeResult {
  status: GeocodeStatus;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
  city?: string;
  errorMessage?: string;
  retries?: number;
}

interface AddressComponent {
  longText: string;
  shortText?: string;
  types: string[];
}

/**
 * Geocode a Chicago address using the Places API (New) autocomplete + details
 * pipeline. Returns precise building coordinates, not interpolated midpoints.
 *
 * Caller is responsible for adding ", Chicago, IL, USA" if not present —
 * we biased autocomplete to Chicago but you can pass a fully-qualified
 * string if you want.
 */
export async function geocodeChicagoAddress(
  address: string,
  retryCount = 0,
): Promise<GeocodeResult> {
  // Maps Platform key, separate from any Gemini key.
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!googleApiKey) {
    console.error('[places-geocoder] Google API key not configured');
    return { status: 'ERROR', errorMessage: 'Google API key not configured' };
  }

  const trimmed = address.trim();
  if (!trimmed) {
    return { status: 'ZERO_RESULTS', errorMessage: 'Empty address' };
  }

  const normalizedAddress = /chicago/i.test(trimmed)
    ? trimmed
    : `${trimmed}, Chicago, IL, USA`;

  // Per-request session token so Google bills the autocomplete + details
  // pair as one search.
  const sessionToken = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    // Step 1 — autocomplete to find the best Place ID for this typed string.
    const acRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
      body: JSON.stringify({
        input: normalizedAddress,
        sessionToken,
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
        includedRegionCodes: ['us'],
        // Bias to Chicago — 50 km radius covers the city + nearby suburbs.
        locationBias: {
          circle: {
            center: { latitude: 41.8781, longitude: -87.6298 },
            radius: 50000,
          },
        },
      }),
    });

    if (!acRes.ok) {
      if ((acRes.status === 429 || acRes.status >= 500) && retryCount < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return geocodeChicagoAddress(address, retryCount + 1);
      }
      const errBody = await acRes.text().catch(() => '');
      console.error('[places-geocoder] autocomplete error', acRes.status, errBody.slice(0, 300));
      return { status: 'ERROR', errorMessage: `autocomplete ${acRes.status}`, retries: retryCount };
    }

    const acData = await acRes.json();
    const suggestions = Array.isArray(acData?.suggestions) ? acData.suggestions : [];
    const placeId: string | undefined = suggestions[0]?.placePrediction?.placeId;

    if (!placeId) {
      return { status: 'ZERO_RESULTS', retries: retryCount };
    }

    // Step 2 — fetch precise location for that place_id.
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': googleApiKey,
          'X-Goog-FieldMask': 'location,formattedAddress,addressComponents',
        },
      },
    );

    if (!detailsRes.ok) {
      if ((detailsRes.status === 429 || detailsRes.status >= 500) && retryCount < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return geocodeChicagoAddress(address, retryCount + 1);
      }
      const errBody = await detailsRes.text().catch(() => '');
      console.error('[places-geocoder] details error', detailsRes.status, errBody.slice(0, 300));
      return { status: 'ERROR', errorMessage: `details ${detailsRes.status}`, retries: retryCount };
    }

    const place = await detailsRes.json();
    const lat: number | undefined = place?.location?.latitude;
    const lng: number | undefined = place?.location?.longitude;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { status: 'ZERO_RESULTS', retries: retryCount };
    }

    const comps: AddressComponent[] = place.addressComponents || [];
    const cityComp = comps.find(c => c.types?.includes('locality'));
    const city = cityComp?.longText;
    const isChicago = typeof city === 'string' && city.toLowerCase().includes('chicago');

    if (!isChicago) {
      return {
        status: 'NOT_CHICAGO',
        lat,
        lng,
        formattedAddress: place.formattedAddress,
        city,
        retries: retryCount,
      };
    }

    return {
      status: 'OK',
      lat,
      lng,
      formattedAddress: place.formattedAddress,
      city,
      retries: retryCount,
    };
  } catch (error: any) {
    console.error('[places-geocoder] fetch error:', error?.message);
    if (retryCount < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return geocodeChicagoAddress(address, retryCount + 1);
    }
    return { status: 'ERROR', errorMessage: error?.message || 'unknown', retries: retryCount };
  }
}
