import { supabaseAdmin } from './supabase';
import { geocodeChicagoAddress } from './places-geocoder';

/**
 * Resolve a Chicago address to ward + section. Geocodes via the Places API
 * (autocomplete + details — see lib/places-geocoder.ts for why), then runs
 * the PostGIS find_section_for_point function on the main Supabase DB.
 *
 * Every code path that saves a user's home address must call this (or the
 * /api/find-section endpoint) to populate home_address_ward + section — if we
 * skip it, the user falls out of the street-cleaning cron's ward/section
 * filter and silently stops receiving alerts. And if the geocoder lands a
 * block off (which the legacy Maps Geocoding API did on Chicago grid
 * streets), the user gets the wrong section's schedule — same outcome,
 * silent failure.
 */
export async function resolveAddressZone(address: string): Promise<{
  lat: number;
  lng: number;
  ward: string | null;
  section: string | null;
} | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  if (!supabaseAdmin) {
    console.error('[resolveAddressZone] supabaseAdmin missing');
    return null;
  }

  const geo = await geocodeChicagoAddress(trimmed);
  if (geo.status !== 'OK' || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
    return null;
  }

  try {
    const { data, error } = await (supabaseAdmin.rpc as any)('find_section_for_point', {
      lon: geo.lng,
      lat: geo.lat,
    });
    if (error || !data?.length) {
      return { lat: geo.lat, lng: geo.lng, ward: null, section: null };
    }
    return {
      lat: geo.lat,
      lng: geo.lng,
      ward: String(data[0].ward),
      section: String(data[0].section),
    };
  } catch (e) {
    console.error('[resolveAddressZone] error:', e);
    return null;
  }
}
