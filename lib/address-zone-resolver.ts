import { supabaseAdmin } from './supabase';

/**
 * Resolve a Chicago address to ward + section. Geocodes via Google, then runs
 * the PostGIS find_section_for_point function on the main Supabase DB.
 *
 * Every code path that saves a user's home address must call this (or the
 * /api/find-section endpoint) to populate home_address_ward + section — if we
 * skip it, the user falls out of the street-cleaning cron's ward/section
 * filter and silently stops receiving alerts.
 */
export async function resolveAddressZone(address: string): Promise<{
  lat: number;
  lng: number;
  ward: string | null;
  section: string | null;
} | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    console.error('[resolveAddressZone] GOOGLE_API_KEY missing');
    return null;
  }
  if (!supabaseAdmin) {
    console.error('[resolveAddressZone] supabaseAdmin missing');
    return null;
  }

  const normalized = /,\s*(IL|Illinois)/i.test(trimmed) ? trimmed : `${trimmed}, Chicago, IL, USA`;
  const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(normalized)}&key=${googleKey}`;

  try {
    const resp = await fetch(u);
    if (!resp.ok) return null;
    const body: any = await resp.json();
    if (body.status !== 'OK' || !body.results?.length) return null;
    const loc = body.results[0].geometry?.location;
    if (!loc) return null;

    const { data, error } = await (supabaseAdmin.rpc as any)('find_section_for_point', {
      lon: loc.lng,
      lat: loc.lat,
    });
    if (error || !data?.length) {
      return { lat: loc.lat, lng: loc.lng, ward: null, section: null };
    }
    return {
      lat: loc.lat,
      lng: loc.lng,
      ward: String(data[0].ward),
      section: String(data[0].section),
    };
  } catch (e) {
    console.error('[resolveAddressZone] error:', e);
    return null;
  }
}
