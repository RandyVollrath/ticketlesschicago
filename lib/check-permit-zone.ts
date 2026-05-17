// Single source of truth for "is this Chicago address inside an active
// residential permit zone?" — queries the parking_permit_zones table that
// pages/api/cron/sync-permit-zones (weekly) keeps in sync with Chicago Open
// Data. Used by:
//   - pages/api/check-permit-zone.ts (public HTTP endpoint)
//   - pages/api/profile-update.ts (inline recompute on every address change)
//
// Returning hasPermitZone reflects OUR authoritative data — not anything the
// user typed and not the city's record. This is the value we should trust
// when deciding whether to buy a permit + city sticker vs. just a sticker.

import { parseChicagoAddress } from './address-parser';
import { supabaseAdmin } from './supabase';

export interface PermitZoneMatch {
  zone: string;
  status: string;
  ward: string;
  addressRange: string;
}

export interface PermitZoneCheckResult {
  hasPermitZone: boolean;
  zones: PermitZoneMatch[];
  parsedAddress: {
    number: number;
    direction: string | null;
    name: string;
    type: string | null;
  } | null;
}

export async function checkPermitZoneForAddress(address: string): Promise<PermitZoneCheckResult> {
  const parsed = parseChicagoAddress(address);
  if (!parsed) {
    return { hasPermitZone: false, zones: [], parsedAddress: null };
  }
  if (!supabaseAdmin) {
    throw new Error('supabaseAdmin not available');
  }

  let query = supabaseAdmin
    .from('parking_permit_zones')
    .select('*')
    .eq('street_name', parsed.name)
    .eq('status', 'ACTIVE')
    .lte('address_range_low', parsed.number)
    .gte('address_range_high', parsed.number);

  if (parsed.direction) query = query.eq('street_direction', parsed.direction);
  if (parsed.type) query = query.eq('street_type', parsed.type);

  const { data: rows, error } = await query;
  if (error) throw error;

  const matching = (rows || []).filter((zone: any) => {
    if (zone.odd_even) {
      return parsed.isOdd ? zone.odd_even === 'O' : zone.odd_even === 'E';
    }
    return true;
  });

  const zones: PermitZoneMatch[] = matching.map((zone: any) => ({
    zone: zone.zone,
    status: zone.status,
    ward: zone.ward_low === zone.ward_high ? `Ward ${zone.ward_low}` : `Wards ${zone.ward_low}-${zone.ward_high}`,
    addressRange: `${zone.address_range_low}-${zone.address_range_high} ${zone.street_direction || ''} ${zone.street_name} ${zone.street_type || ''}`.trim(),
  }));

  return {
    hasPermitZone: zones.length > 0,
    zones,
    parsedAddress: {
      number: parsed.number,
      direction: parsed.direction,
      name: parsed.name,
      type: parsed.type,
    },
  };
}
