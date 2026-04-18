#!/usr/bin/env tsx
/**
 * Refresh home_address_ward / home_address_section for every user whose
 * address we can resolve. Geocodes missing coords via Google, then uses the
 * PostGIS find_section_for_point RPC to pick ward + section.
 *
 * Prevents the "Travis has ward=null, cron skips him" silent-drop class of
 * bug by keeping every user's zone fields in sync with their saved address.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
const supa = createClient(url, key);
// Geocode via the production find-section API (handles Google + PostGIS).
const FIND_SECTION = 'https://autopilotamerica.com/api/find-section';

const APPLY = process.argv.includes('--apply');
const ONLY_MISSING = process.argv.includes('--only-missing');

type Profile = {
  user_id: string;
  email: string | null;
  street_address: string | null;
  home_address_full: string | null;
  home_address_lat: number | null;
  home_address_lng: number | null;
  home_address_ward: string | null;
  home_address_section: string | null;
};

async function findSection(lat: number, lng: number): Promise<{ ward: string; section: string } | null> {
  const { data, error } = await (supa.rpc as any)('find_section_for_point', { lon: lng, lat });
  if (error || !data || !data.length) return null;
  return { ward: String(data[0].ward), section: String(data[0].section) };
}

async function resolveAddress(address: string): Promise<{ lat: number; lng: number; ward: string | null; section: string | null } | null> {
  // Hit prod /api/find-section which does Google geocode + PostGIS zone lookup.
  const resp = await fetch(`${FIND_SECTION}?address=${encodeURIComponent(address)}`);
  if (!resp.ok) {
    // 404 means geocoding worked but no zone (gap area) — still try to grab coords.
    try {
      const body: any = await resp.json();
      if (body.coordinates) {
        return { lat: body.coordinates.lat, lng: body.coordinates.lng, ward: null, section: null };
      }
    } catch {}
    return null;
  }
  const body: any = await resp.json();
  if (!body.coordinates) return null;
  return {
    lat: body.coordinates.lat,
    lng: body.coordinates.lng,
    ward: body.ward ?? null,
    section: body.section ?? null,
  };
}

async function main() {
  const { data: users, error } = await supa
    .from('user_profiles')
    .select('user_id, email, street_address, home_address_full, home_address_lat, home_address_lng, home_address_ward, home_address_section');
  if (error) throw error;

  const rows: Profile[] = (users || []).filter((u: Profile) => u.street_address || u.home_address_full);
  const target = ONLY_MISSING
    ? rows.filter(u => !u.home_address_ward || !u.home_address_section)
    : rows;

  console.log(`${rows.length} users with any address; ${target.length} to process${APPLY ? '' : ' (DRY RUN)'}`);

  let updated = 0, geocoded = 0, nulled = 0, skipped = 0, errored = 0;

  for (const u of target) {
    const address = u.street_address || u.home_address_full!;
    let lat: number | null = u.home_address_lat;
    let lng: number | null = u.home_address_lng;
    let ward: string | null = null;
    let section: string | null = null;

    if (lat == null || lng == null) {
      const res = await resolveAddress(address);
      if (!res) { console.log(`  no-geo    ${u.email}: ${address}`); skipped++; continue; }
      lat = res.lat; lng = res.lng; ward = res.ward; section = res.section;
      geocoded++;
    } else {
      const sec = await findSection(lat, lng);
      ward = sec?.ward ?? null;
      section = sec?.section ?? null;
    }

    if (!ward || !section) {
      console.log(`  no-zone   ${u.email}: ${address} (${lat.toFixed(4)},${lng.toFixed(4)})`);
      if (APPLY && (u.home_address_ward || u.home_address_section)) {
        const { error: uErr } = await supa.from('user_profiles').update({
          home_address_lat: lat,
          home_address_lng: lng,
          home_address_ward: null,
          home_address_section: null,
        }).eq('user_id', u.user_id);
        if (uErr) { errored++; continue; }
        nulled++;
      }
      continue;
    }

    const changed = ward !== u.home_address_ward || section !== u.home_address_section
      || lat !== u.home_address_lat || lng !== u.home_address_lng;
    if (!changed) { skipped++; continue; }

    console.log(`  ${APPLY ? 'update' : 'WOULD'} ${u.email}: ${u.home_address_ward}/${u.home_address_section} -> ${ward}/${section}`);
    if (APPLY) {
      const { error: uErr } = await supa.from('user_profiles').update({
        home_address_lat: lat,
        home_address_lng: lng,
        home_address_ward: ward,
        home_address_section: section,
      }).eq('user_id', u.user_id);
      if (uErr) { console.error('    fail:', uErr.message); errored++; continue; }
      updated++;
    }
  }

  console.log(`\nDone. updated=${updated} nulled=${nulled} geocoded=${geocoded} skipped=${skipped} errored=${errored}`);
}

main().catch(e => { console.error(e); process.exit(1); });
