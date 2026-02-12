#!/usr/bin/env npx tsx
/**
 * Batch-geocode unique permit zone streets via Nominatim.
 *
 * For each unique (direction, street_name, street_type) in parking_permit_zones,
 * geocode a representative address to get real-world coordinates.
 * Store in street_geocache table.
 *
 * Nominatim rate limit: 1 request/sec (we use 1.1s delay to be safe).
 * ~1,019 unique streets → ~19 minutes.
 *
 * Usage: npx tsx scripts/geocode-permit-streets.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Direction abbreviation → full word for Nominatim
const DIR_FULL: Record<string, string> = {
  N: 'North', S: 'South', E: 'East', W: 'West',
};

// Street type abbreviation → full word
const TYPE_FULL: Record<string, string> = {
  ST: 'Street', AVE: 'Avenue', BLVD: 'Boulevard', DR: 'Drive',
  RD: 'Road', PL: 'Place', CT: 'Court', TER: 'Terrace',
  PKWY: 'Parkway', LN: 'Lane', WAY: 'Way', CIR: 'Circle',
  SQ: 'Square', HWY: 'Highway',
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildAddress(dir: string, name: string, type: string | null, addrNum: number): string {
  const dirFull = DIR_FULL[dir] || dir;
  const nameTitled = titleCase(name);
  const typeFull = type ? (TYPE_FULL[type] || type) : '';
  return `${addrNum} ${dirFull} ${nameTitled} ${typeFull}, Chicago, IL`.replace(/\s+/g, ' ').trim();
}

async function geocodeNominatim(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'TicketlessChicago/1.0 (permit-zone-geocoder)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const results = await resp.json();
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Get all unique streets from permit zones (paginate to get all 9,873+ records)
  const streets: any[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error: fetchErr } = await supabase
      .from('parking_permit_zones')
      .select('street_direction, street_name, street_type, address_range_low, address_range_high')
      .eq('status', 'ACTIVE')
      .range(from, from + PAGE_SIZE - 1);

    if (fetchErr) {
      console.error('Failed to fetch permit zones:', fetchErr);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    streets.push(...data);
    console.log(`  Fetched ${streets.length} permit zone records so far...`);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  if (streets.length === 0) {
    console.error('No active permit zones found');
    process.exit(1);
  }
  console.log(`Total permit zone records fetched: ${streets.length}`);

  // Group by unique street → pick representative address (midpoint of widest range)
  const streetMap = new Map<string, {
    dir: string; name: string; type: string | null; addrNum: number;
  }>();

  for (const s of streets) {
    const key = `${s.street_direction}|${s.street_name}|${s.street_type || ''}`;
    const mid = Math.round((s.address_range_low + s.address_range_high) / 2);
    const existing = streetMap.get(key);
    if (!existing) {
      streetMap.set(key, { dir: s.street_direction, name: s.street_name, type: s.street_type, addrNum: mid });
    }
    // Keep the one with the largest address range for better geocoding
    else if (Math.abs(s.address_range_high - s.address_range_low) >
             Math.abs(existing.addrNum * 2 - s.address_range_low - s.address_range_high)) {
      streetMap.set(key, { dir: s.street_direction, name: s.street_name, type: s.street_type, addrNum: mid });
    }
  }

  console.log(`Found ${streetMap.size} unique streets to geocode`);

  // Check which are already cached
  const { data: cached } = await supabase
    .from('street_geocache')
    .select('street_direction, street_name, street_type');

  const cachedSet = new Set(
    (cached || []).map(c => `${c.street_direction}|${c.street_name}|${c.street_type || ''}`)
  );

  const toGeocode = [...streetMap.entries()].filter(([key]) => !cachedSet.has(key));
  console.log(`${cachedSet.size} already cached, ${toGeocode.length} remaining`);

  let success = 0;
  let failed = 0;
  let total = toGeocode.length;

  for (let i = 0; i < toGeocode.length; i++) {
    const [, st] = toGeocode[i];
    const address = buildAddress(st.dir, st.name, st.type, st.addrNum);

    const coords = await geocodeNominatim(address);

    if (coords) {
      // Determine axis: N/S direction means street runs N-S (address increases along latitude)
      const axis = (st.dir === 'N' || st.dir === 'S') ? 'ns' : 'ew';

      const { error: insertError } = await supabase
        .from('street_geocache')
        .upsert({
          street_direction: st.dir,
          street_name: st.name,
          street_type: st.type,
          ref_lat: coords.lat,
          ref_lng: coords.lng,
          ref_addr_num: st.addrNum,
          axis,
          geocoded_address: address,
        }, {
          onConflict: 'street_direction,street_name,street_type',
          ignoreDuplicates: false,
        });

      if (insertError) {
        // Try plain insert if upsert fails due to unique index with COALESCE
        const { error: insertError2 } = await supabase
          .from('street_geocache')
          .insert({
            street_direction: st.dir,
            street_name: st.name,
            street_type: st.type,
            ref_lat: coords.lat,
            ref_lng: coords.lng,
            ref_addr_num: st.addrNum,
            axis,
            geocoded_address: address,
          });
        if (insertError2) {
          console.error(`  DB error for ${address}:`, insertError2.message);
          failed++;
        } else {
          success++;
        }
      } else {
        success++;
      }

      if ((i + 1) % 50 === 0 || i === toGeocode.length - 1) {
        const pct = ((i + 1) / total * 100).toFixed(1);
        const eta = ((total - i - 1) * 1.1 / 60).toFixed(1);
        console.log(`[${pct}%] ${i + 1}/${total} — ${success} ok, ${failed} failed — ETA ${eta}min`);
      }
    } else {
      // Try without street type (some streets don't match with type)
      const addressNoType = `${st.addrNum} ${DIR_FULL[st.dir] || st.dir} ${titleCase(st.name)}, Chicago, IL`;
      await sleep(1100);
      const coords2 = await geocodeNominatim(addressNoType);

      if (coords2) {
        const axis = (st.dir === 'N' || st.dir === 'S') ? 'ns' : 'ew';
        await supabase.from('street_geocache').insert({
          street_direction: st.dir,
          street_name: st.name,
          street_type: st.type,
          ref_lat: coords2.lat,
          ref_lng: coords2.lng,
          ref_addr_num: st.addrNum,
          axis,
          geocoded_address: addressNoType,
        });
        success++;
      } else {
        console.warn(`  FAILED: ${address} (and ${addressNoType})`);
        failed++;
      }
    }

    // Rate limit: 1.1 seconds between requests
    await sleep(1100);
  }

  console.log(`\nDone! ${success} geocoded, ${failed} failed out of ${total}`);
}

main().catch(console.error);
