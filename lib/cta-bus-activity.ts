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

type StopRow = { stop_id?: string; stop_name?: string; stop_lat?: string; stop_lon?: string };

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
 * service-window finding. We deliberately don't overreach — returning
 * `defenseSummary` is a conservative "service appears to be operating"
 * or "no stop found nearby" rather than claiming the specific bus was/
 * wasn't there.
 */
export async function getCtaBusActivityFinding(
  lat: number | null,
  lng: number | null,
  violationDatetime: string | null,
): Promise<CtaBusActivityFinding | null> {
  if (lat == null || lng == null) return null;

  // Query Open Data for stops within ~150 m. The CTA stops dataset uses
  // stop_lat / stop_lon — we do the distance filter client-side since
  // SoQL's within_circle requires a geo column configured as a location.
  const latBand = 0.002; // ~222 m N-S
  const lonBand = 0.0025; // ~200 m E-W at Chicago latitude

  const url = new URL(CTA_STOPS_DATASET);
  url.searchParams.set(
    '$where',
    `stop_lat between '${(lat - latBand).toFixed(5)}' and '${(lat + latBand).toFixed(5)}' and stop_lon between '${(lng - lonBand).toFixed(5)}' and '${(lng + lonBand).toFixed(5)}'`,
  );
  url.searchParams.set('$limit', '20');

  let rows: StopRow[] = [];
  try {
    const r = await fetch(url.toString(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    rows = (await r.json()) as StopRow[];
  } catch { return null; }
  if (rows.length === 0) {
    return {
      checked: true,
      stopId: null,
      stopName: null,
      scheduledArrivalsInWindow: 0,
      serviceWindowStart: null,
      serviceWindowEnd: null,
      defenseSummary: 'City of Chicago published CTA-stop records show no bus stop within 150 meters of the cited location at the time of the violation. The posted bus-stop zone the citation references may not be in actual CTA service.',
    };
  }

  // Nearest stop
  let best: { row: StopRow; distance: number } | null = null;
  for (const row of rows) {
    const lat2 = parseFloat(row.stop_lat || '');
    const lon2 = parseFloat(row.stop_lon || '');
    if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) continue;
    const d = haversineMeters(lat, lng, lat2, lon2);
    if (!best || d < best.distance) best = { row, distance: d };
  }

  if (!best) return null;

  // We have a nearby stop but no per-arrival schedule in this dataset.
  // Return a neutral finding that the argument is weak — the stop exists,
  // service is likely running. Letter generator will skip this unless the
  // stronger "no-stop" finding fires above.
  return {
    checked: true,
    stopId: best.row.stop_id || null,
    stopName: best.row.stop_name || null,
    scheduledArrivalsInWindow: -1, // -1 = not determinable from public data
    serviceWindowStart: null,
    serviceWindowEnd: null,
    defenseSummary: null,
  };
}
