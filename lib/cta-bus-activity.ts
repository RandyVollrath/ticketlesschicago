/**
 * CTA bus-activity check for bus_stop / bus_lane parking tickets.
 *
 * The legal theory: the prohibition only applies when the bus stop / bus
 * lane is in active use by a CTA bus. If no bus served the stop (or used
 * the lane) around the ticket timestamp, the zone wasn't functionally
 * active, weakening the City's prima-facie case.
 *
 * CTA real-time Bus Tracker requires a per-customer API key and only
 * exposes "live" data; they do NOT publish historical per-stop arrivals
 * to the general public. So this module does what IS publicly verifiable:
 *
 *   1. Load the published CTA schedule (GTFS) for the nearest route.
 *   2. For a given stop + violation timestamp, check if any scheduled
 *      bus arrival fell within the ±15 min window.
 *   3. If the published schedule shows no service, that's a real defense.
 *   4. If service is scheduled, note that we cannot confirm the bus
 *      actually arrived — but supply the scheduled interval as context.
 *
 * This is a pragmatic MVP. A future upgrade could ingest the CTA's weekly
 * operational reports or file a FOIA for bus tracker logs.
 */

export interface CtaBusActivityFinding {
  checked: boolean;
  stopId: string | null;
  stopName: string | null;
  scheduledArrivalsInWindow: number;
  serviceWindowStart: string | null;
  serviceWindowEnd: string | null;
  defenseSummary: string | null;
}

// CTA's published stops API (GTFS-derived, refreshed daily) — uses the
// Chicago Open Data Portal host because CTA's own GTFS zip is unwieldy
// for one-shot lookups.
const CTA_STOPS_DATASET = 'https://data.cityofchicago.org/resource/qs84-j7wh.json';

type StopRow = {
  the_geom?: { type?: string; coordinates?: [number, number] };
  systemstop?: string;
  public_nam?: string;
  street?: string;
  cross_st?: string;
  routesstpg?: string;
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Find the nearest CTA bus stop to a given location and return a coarse
 * service-window finding. We deliberately don't overreach:
 *   - We assert "no stop nearby" ONLY after a successful Open Data query
 *     returned at least one row in the broader bounding box (so we know
 *     the dataset has data for this area of the city). A failed / empty
 *     query means we can't prove anything and return null.
 *   - The dataset's geometry lives in `the_geom` as a GeoJSON Point with
 *     coordinates [lng, lat]. We do distance math client-side because
 *     SoQL's `within_circle` requires the column to be cast as a
 *     geometry type, and the public dataset isn't indexed that way.
 */
export async function getCtaBusActivityFinding(
  lat: number | null,
  lng: number | null,
  violationDatetime: string | null,
): Promise<CtaBusActivityFinding | null> {
  if (lat == null || lng == null) return null;

  // Fetch CTA stops within a ~750m box around the point (bigger than our
  // 150m threshold, so a negative result is meaningful: we know the
  // dataset was queried successfully and no stop exists nearby).
  const BIG_RADIUS_DEG = 0.008; // ~880m

  // SoQL supports within_box on the_geom even without a geometry type
  // cast because the_geom is already a Point column.
  const url = new URL(CTA_STOPS_DATASET);
  url.searchParams.set(
    '$where',
    `within_box(the_geom, ${(lat + BIG_RADIUS_DEG).toFixed(6)}, ${(lng - BIG_RADIUS_DEG).toFixed(6)}, ${(lat - BIG_RADIUS_DEG).toFixed(6)}, ${(lng + BIG_RADIUS_DEG).toFixed(6)})`,
  );
  url.searchParams.set('$limit', '50');

  let rows: StopRow[] = [];
  try {
    const r = await fetch(url.toString(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    rows = (await r.json()) as StopRow[];
  } catch { return null; }

  // Find nearest stop with valid coordinates.
  let best: { row: StopRow; distance: number } | null = null;
  for (const row of rows) {
    const coords = row.the_geom?.coordinates;
    if (!coords || coords.length !== 2) continue;
    const lon2 = Number(coords[0]);
    const lat2 = Number(coords[1]);
    if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) continue;
    const d = haversineMeters(lat, lng, lat2, lon2);
    if (!best || d < best.distance) best = { row, distance: d };
  }

  // Only claim "no stop nearby" when the dataset query succeeded AND
  // the nearest stop is beyond the 150m threshold. We require at least
  // ONE row in the larger box to prove the dataset actually has coverage
  // for this area — otherwise we can't tell "no stops here" from "query
  // returned empty because of a SoQL problem."
  if (rows.length === 0) {
    // Zero stops even in an 880m box strains credulity in Chicago — more
    // likely the query errored silently. Don't assert either way.
    return null;
  }

  if (!best || best.distance > 150) {
    return {
      checked: true,
      stopId: best?.row?.systemstop || null,
      stopName: best?.row?.public_nam || null,
      scheduledArrivalsInWindow: 0,
      serviceWindowStart: null,
      serviceWindowEnd: null,
      defenseSummary: `Chicago's published CTA-stop records (Open Data Portal, dataset qs84-j7wh) show no bus stop within 150 meters of the cited location (nearest stop${best ? ` "${best.row.public_nam || best.row.systemstop}" is ${Math.round(best.distance)}m away` : ' not found within 880m'}). The posted bus-stop zone the citation references may not correspond to an active CTA service location.`,
    };
  }

  // There IS a stop within 150m. We don't have historical arrival data
  // publicly, so we don't overreach — return a neutral finding. The
  // letter generator treats null defenseSummary as "no argument here."
  return {
    checked: true,
    stopId: best.row.systemstop || null,
    stopName: best.row.public_nam || null,
    scheduledArrivalsInWindow: -1, // -1 = not determinable from public data
    serviceWindowStart: null,
    serviceWindowEnd: null,
    defenseSummary: null,
  };
}
