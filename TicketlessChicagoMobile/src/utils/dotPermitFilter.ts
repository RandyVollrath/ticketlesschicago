// Filter CDOT temp-no-parking permits to those that overlap a chosen
// date range AND fall within walking distance of the searched address.
//
// Source: /api/dot-permits/all (Chicago Data Portal pubx-yq2d via our
// Next.js wrapper). Probed schema as of 2026-04-29:
//   { latitude, longitude, startDate, endDate, name, comments,
//     workType, streetClosure, meterBagging, applicationNumber, ward }
// Some city rows have garbage end dates ("3031-03-23"); the overlap
// math handles them naturally — they always overlap, which is fine for
// "is there a permit during my visit?"

export interface DotPermit {
  applicationNumber?: string;
  name?: string;
  workType?: string;
  status?: string;
  startDate?: string; // ISO with time, but we only care about the date
  endDate?: string;
  streetNumberFrom?: number;
  streetNumberTo?: number;
  direction?: string;
  streetName?: string;
  suffix?: string;
  ward?: string;
  latitude?: number;
  longitude?: number;
  streetClosure?: string;
  meterBagging?: boolean;
  comments?: string;
}

export interface FilteredPermit extends DotPermit {
  distanceMeters: number;
  startISO: string; // YYYY-MM-DD
  endISO: string;
  permitType: 'metered' | 'closure' | 'other';
}

// Haversine in meters.
export function distanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toDateOnly(iso: string | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10); // "2026-05-06T00:00:00.000" → "2026-05-06"
}

// Two date ranges overlap iff start1 <= end2 AND start2 <= end1.
function rangesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 <= e2 && s2 <= e1;
}

function classifyPermitType(p: DotPermit): FilteredPermit['permitType'] {
  if (p.meterBagging) return 'metered';
  if (p.streetClosure && p.streetClosure !== 'None' && p.streetClosure.trim() !== '')
    return 'closure';
  return 'other';
}

export interface FilterOptions {
  centerLat: number;
  centerLng: number;
  radiusMeters: number; // typical 200m for "this block-ish"
  startISO: string; // user's visit start (YYYY-MM-DD)
  endISO: string;   // user's visit end (inclusive)
}

export function filterDotPermits(
  permits: DotPermit[],
  opts: FilterOptions,
): FilteredPermit[] {
  const out: FilteredPermit[] = [];
  for (const p of permits) {
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
    const dist = distanceMeters(opts.centerLat, opts.centerLng, p.latitude, p.longitude);
    if (dist > opts.radiusMeters) continue;

    const sISO = toDateOnly(p.startDate);
    const eISO = toDateOnly(p.endDate);
    if (!sISO || !eISO) continue;
    if (!rangesOverlap(sISO, eISO, opts.startISO, opts.endISO)) continue;

    out.push({
      ...p,
      distanceMeters: dist,
      startISO: sISO,
      endISO: eISO,
      permitType: classifyPermitType(p),
    });
  }
  // Closest first; among same-distance, earliest start first.
  out.sort((a, b) => a.distanceMeters - b.distanceMeters || a.startISO.localeCompare(b.startISO));
  return out;
}

export function describePermit(p: FilteredPermit): string {
  const typeWord =
    p.permitType === 'metered' ? 'Metered spaces bagged'
      : p.permitType === 'closure' ? 'Street closure'
      : 'Curb permit';
  const blocks = p.distanceMeters < 75 ? 'right here'
    : p.distanceMeters < 200 ? `${Math.round(p.distanceMeters)}m away`
    : `${Math.round(p.distanceMeters)}m away`;
  return `${typeWord} — ${blocks}`;
}
