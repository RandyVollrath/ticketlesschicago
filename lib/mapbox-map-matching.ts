// Mapbox Map Matching API client.
//
// Takes a trajectory of GPS fixes (the car's actual path leading up to the
// parking spot) and returns the road segment Mapbox believes the car was on
// at the FINAL fix. This sidesteps the snap-to-nearest-centerline failure
// mode at intersections — Mapbox uses the whole trajectory, not just the
// stop point's distance to centerlines.
//
// Docs: https://docs.mapbox.com/api/navigation/map-matching/
//
// Set MAPBOX_ACCESS_TOKEN in env. Without it, this module is a no-op.

export interface TrajectoryFix {
  lat: number;
  lng: number;
  timestampMs?: number;
  accuracyMeters?: number;
}

export interface MapMatchResult {
  matched: boolean;
  // Street name Mapbox assigned to the FINAL trajectory point (the parking spot).
  finalStreetName: string | null;
  // Snapped lat/lng for the final point.
  finalSnappedLat: number | null;
  finalSnappedLng: number | null;
  // Mapbox's confidence in the overall match (0-1).
  confidence: number | null;
  // Number of points Mapbox successfully matched vs sent.
  matchedPointCount: number;
  inputPointCount: number;
  // Reason for skipping (token missing, too few points, API error).
  skipReason?: string;
}

const MAPBOX_ENDPOINT = 'https://api.mapbox.com/matching/v5/mapbox/driving';

export async function mapMatchTrajectory(
  fixes: TrajectoryFix[],
): Promise<MapMatchResult> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    return emptyResult(fixes.length, 'no_token');
  }
  if (fixes.length < 2) {
    return emptyResult(fixes.length, 'too_few_points');
  }
  // Mapbox cap: 100 coordinates per request. Keep the most recent.
  const trimmed = fixes.slice(-100);

  const coordsParam = trimmed
    .map((f) => `${f.lng.toFixed(6)},${f.lat.toFixed(6)}`)
    .join(';');

  // Per-point search radius. Mapbox accepts 0-50m.
  //
  // CRITICAL: radius is the distance from the GPS fix within which Mapbox will
  // search for a matching road — NOT a GPS-accuracy indicator. A car parked at
  // the curb sits 6-12m from the street centerline (half ROW + parking lane),
  // so a radius below ~20m fails to reach the actual street and either matches
  // a nameless parallel feature (alley, service road) or returns NoMatch.
  //
  // Before 2026-04: floor was 5m. Result: on clean grid streets Mapbox
  // returned matched=true with empty street name and ~0 confidence (parking
  // GPS snapped to an unnamed OSM way within 5m instead of the real street
  // 6-12m away). Fixed by bumping the floor to 25m — comfortably covers a
  // Chicago ROW (60ft ≈ 18m) plus parking lane.
  const radiusesParam = trimmed
    .map((f) => Math.max(25, Math.min(50, Math.round((f.accuracyMeters ?? 10) + 20))))
    .join(';');

  // Timestamps (seconds since epoch) let Mapbox use speed information.
  const allHaveTimestamps = trimmed.every((f) => typeof f.timestampMs === 'number');
  const timestampsParam = allHaveTimestamps
    ? trimmed.map((f) => Math.round((f.timestampMs as number) / 1000)).join(';')
    : null;

  const params = new URLSearchParams({
    access_token: token,
    geometries: 'geojson',
    steps: 'false',
    overview: 'simplified',
    tidy: 'true',
    radiuses: radiusesParam,
  });
  if (timestampsParam) params.set('timestamps', timestampsParam);

  const url = `${MAPBOX_ENDPOINT}/${coordsParam}?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      return emptyResult(trimmed.length, `http_${resp.status}`);
    }
    const json: any = await resp.json();
    if (json.code !== 'Ok') {
      return emptyResult(trimmed.length, `api_${json.code ?? 'unknown'}`);
    }

    const tracepoints: any[] = Array.isArray(json.tracepoints) ? json.tracepoints : [];
    // The LAST non-null tracepoint corresponds to the parking location.
    let lastTp: any = null;
    for (let i = tracepoints.length - 1; i >= 0; i--) {
      if (tracepoints[i]) {
        lastTp = tracepoints[i];
        break;
      }
    }
    const matchedCount = tracepoints.filter((tp) => tp != null).length;
    const matching = json.matchings?.[0];

    return {
      matched: lastTp != null,
      finalStreetName: lastTp?.name ?? null,
      finalSnappedLat: Array.isArray(lastTp?.location) ? lastTp.location[1] : null,
      finalSnappedLng: Array.isArray(lastTp?.location) ? lastTp.location[0] : null,
      confidence: typeof matching?.confidence === 'number' ? matching.confidence : null,
      matchedPointCount: matchedCount,
      inputPointCount: trimmed.length,
    };
  } catch (e: any) {
    return emptyResult(trimmed.length, e?.name === 'AbortError' ? 'timeout' : 'fetch_error');
  }
}

function emptyResult(inputCount: number, reason: string): MapMatchResult {
  return {
    matched: false,
    finalStreetName: null,
    finalSnappedLat: null,
    finalSnappedLng: null,
    confidence: null,
    matchedPointCount: 0,
    inputPointCount: inputCount,
    skipReason: reason,
  };
}
