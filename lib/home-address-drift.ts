import type { SupabaseClient } from '@supabase/supabase-js';

export type DriftStatus =
  | 'INSUFFICIENT_DATA'
  | 'STILL_AT_HOME'
  | 'CONFIRMED_HOME'
  | 'DRIFT_DETECTED'
  | 'AMBIGUOUS';

export interface DriftResult {
  status: DriftStatus;
  home_ward: string | null;
  home_section: string | null;
  candidate_ward: string | null;
  candidate_section: string | null;
  candidate_fraction: number | null;
  home_fraction: number | null;
  overnight_event_count: number;
  window_days: number;
}

const WINDOW_DAYS = 14;
const MIN_OVERNIGHT_EVENTS = 5;
const NEW_SECTION_MAJORITY = 0.7;
const HOME_SESSION_FLOOR = 0.2;

interface ParkingRow {
  latitude: number;
  longitude: number;
  parked_at: string;
  cleared_at: string | null;
}

interface OvernightBucket {
  date: string;
  latitude: number;
  longitude: number;
}

// A parking row counts as one overnight bucket for each calendar date D
// (America/Chicago) where 02:00 local on D falls within [parked_at, cleared_at|now].
// 02:00 is "the middle of the night" — wherever you're parked at that moment
// is where you slept. This handles all the edge cases (afternoon-to-morning,
// arrival after midnight, multi-night sessions) with one rule.
export function bucketOvernights(rows: ParkingRow[], now: Date = new Date()): OvernightBucket[] {
  const nowMs = now.getTime();
  const buckets = new Map<string, OvernightBucket>();
  for (const row of rows) {
    const start = new Date(row.parked_at).getTime();
    const rawEnd = row.cleared_at ? new Date(row.cleared_at).getTime() : nowMs;
    // Clamp end to now so a future-dated cleared_at (clock skew, dirty data)
    // doesn't walk the loop into the future and attribute phantom buckets.
    const end = Math.min(rawEnd, nowMs);
    if (!isFinite(start) || !isFinite(end) || end <= start) continue;

    // Walk every 02:00 America/Chicago between start and end. Range is bounded
    // by WINDOW_DAYS so this loop runs at most ~15 times per row.
    for (let t = floorTo2amChicagoBefore(start); t <= end; t += 86400_000) {
      if (t < start) continue;
      const date = chicagoDateString(new Date(t));
      const existing = buckets.get(date);
      // If somehow two rows cover the same 02:00 (data dirtiness), prefer the
      // longer-running session.
      if (!existing) {
        buckets.set(date, { date, latitude: row.latitude, longitude: row.longitude });
      } else {
        // Tie-breaker: keep the existing.
      }
    }
  }
  return [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Returns the unix-ms timestamp for the most recent 02:00 America/Chicago
// at or before `tMs`. Uses the local-time string of that timezone to
// account for DST.
function floorTo2amChicagoBefore(tMs: number): number {
  const local = new Date(tMs);
  // Round forward/back to today's 02:00 in Chicago, then subtract a day if it's
  // after `tMs`.
  const day = chicagoDateString(local); // YYYY-MM-DD in Chicago
  const todayAt2am = chicagoLocalToUtcMs(day, 2);
  return todayAt2am <= tMs ? todayAt2am : todayAt2am - 86400_000;
}

function chicagoDateString(d: Date): string {
  // en-CA gives YYYY-MM-DD
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// Convert "YYYY-MM-DD" + hour-of-day (America/Chicago) to a UTC unix-ms value.
// We do this by finding the offset for that local moment and applying it.
function chicagoLocalToUtcMs(dateYmd: string, hour: number): number {
  const [y, m, d] = dateYmd.split('-').map(Number);
  // Start from the naive UTC interpretation, then correct by the Chicago offset
  // for that wall clock.
  const naiveUtc = Date.UTC(y, m - 1, d, hour, 0, 0);
  const offsetMin = chicagoOffsetMinutes(new Date(naiveUtc));
  return naiveUtc - offsetMin * 60_000;
}

// Minutes east of UTC for America/Chicago at the given instant (negative for CDT/CST).
function chicagoOffsetMinutes(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  });
  const part = fmt.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-6';
  const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -360;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

export async function computeDriftForUser(
  supabase: SupabaseClient,
  userId: string,
  opts: { now?: Date } = {}
): Promise<DriftResult> {
  const now = opts.now ?? new Date();

  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('home_address_ward, home_address_section')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileErr) throw new Error(`profile fetch: ${profileErr.message}`);

  const home_ward = profile?.home_address_ward ?? null;
  const home_section = profile?.home_address_section ?? null;

  const sinceIso = new Date(now.getTime() - WINDOW_DAYS * 86400_000).toISOString();
  const { data: rows, error: rowsErr } = await supabase
    .from('parking_location_history')
    .select('latitude,longitude,parked_at,cleared_at')
    .eq('user_id', userId)
    .gte('parked_at', sinceIso)
    .order('parked_at', { ascending: true });
  if (rowsErr) throw new Error(`parking history fetch: ${rowsErr.message}`);

  const buckets = bucketOvernights((rows || []) as ParkingRow[], now);

  if (buckets.length < MIN_OVERNIGHT_EVENTS) {
    return {
      status: 'INSUFFICIENT_DATA',
      home_ward,
      home_section,
      candidate_ward: null,
      candidate_section: null,
      candidate_fraction: null,
      home_fraction: null,
      overnight_event_count: buckets.length,
      window_days: WINDOW_DAYS,
    };
  }

  // Snap each unique (lat,lng) to (ward, section) once.
  const uniqueCoords = new Map<string, { lat: number; lng: number }>();
  for (const b of buckets) {
    const key = `${b.latitude.toFixed(5)},${b.longitude.toFixed(5)}`;
    if (!uniqueCoords.has(key)) uniqueCoords.set(key, { lat: b.latitude, lng: b.longitude });
  }
  const coordToSection = new Map<string, { ward: string; section: string } | null>();
  for (const [key, { lat, lng }] of uniqueCoords) {
    const { data, error } = await supabase.rpc('find_section_for_point', { lon: lng, lat });
    if (error) throw new Error(`find_section_for_point: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    coordToSection.set(
      key,
      row && row.ward && row.section ? { ward: String(row.ward), section: String(row.section) } : null
    );
  }

  // Build section counts (drop buckets outside any Chicago zone — vacation,
  // suburbs, etc.).
  const counts = new Map<string, { ward: string; section: string; n: number }>();
  let included = 0;
  for (const b of buckets) {
    const key = `${b.latitude.toFixed(5)},${b.longitude.toFixed(5)}`;
    const snap = coordToSection.get(key);
    if (!snap) continue;
    const k = `${snap.ward}|${snap.section}`;
    const e = counts.get(k) ?? { ward: snap.ward, section: snap.section, n: 0 };
    e.n++;
    counts.set(k, e);
    included++;
  }

  if (included < MIN_OVERNIGHT_EVENTS) {
    // Almost all overnight stays were outside Chicago zones — not enough signal.
    return {
      status: 'INSUFFICIENT_DATA',
      home_ward,
      home_section,
      candidate_ward: null,
      candidate_section: null,
      candidate_fraction: null,
      home_fraction: null,
      overnight_event_count: included,
      window_days: WINDOW_DAYS,
    };
  }

  const homeKey = home_ward && home_section ? `${home_ward}|${home_section}` : null;
  const homeCount = homeKey ? counts.get(homeKey)?.n ?? 0 : 0;
  const home_fraction = round3(homeCount / included);

  if (home_fraction >= HOME_SESSION_FLOOR) {
    return {
      status: 'STILL_AT_HOME',
      home_ward,
      home_section,
      candidate_ward: null,
      candidate_section: null,
      candidate_fraction: null,
      home_fraction,
      overnight_event_count: included,
      window_days: WINDOW_DAYS,
    };
  }

  // Pick the most frequent non-home section.
  let topKey: string | null = null;
  let topN = 0;
  for (const [k, e] of counts) {
    if (e.n > topN) {
      topKey = k;
      topN = e.n;
    }
  }
  if (!topKey) {
    return {
      status: 'AMBIGUOUS',
      home_ward,
      home_section,
      candidate_ward: null,
      candidate_section: null,
      candidate_fraction: null,
      home_fraction,
      overnight_event_count: included,
      window_days: WINDOW_DAYS,
    };
  }
  const top = counts.get(topKey)!;
  const candidate_fraction = round3(top.n / included);

  if (homeKey && topKey === homeKey) {
    return {
      status: 'CONFIRMED_HOME',
      home_ward,
      home_section,
      candidate_ward: top.ward,
      candidate_section: top.section,
      candidate_fraction,
      home_fraction,
      overnight_event_count: included,
      window_days: WINDOW_DAYS,
    };
  }

  if (candidate_fraction >= NEW_SECTION_MAJORITY) {
    return {
      status: 'DRIFT_DETECTED',
      home_ward,
      home_section,
      candidate_ward: top.ward,
      candidate_section: top.section,
      candidate_fraction,
      home_fraction,
      overnight_event_count: included,
      window_days: WINDOW_DAYS,
    };
  }

  return {
    status: 'AMBIGUOUS',
    home_ward,
    home_section,
    candidate_ward: top.ward,
    candidate_section: top.section,
    candidate_fraction,
    home_fraction,
    overnight_event_count: included,
    window_days: WINDOW_DAYS,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const DRIFT_THRESHOLDS = {
  WINDOW_DAYS,
  MIN_OVERNIGHT_EVENTS,
  NEW_SECTION_MAJORITY,
  HOME_SESSION_FLOOR,
};
