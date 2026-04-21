/**
 * Residential-permit zone cross-check.
 *
 * Two useful signals for residential_permit tickets:
 *
 * 1. Does the user's mailing address fall INSIDE a residential-permit
 *    zone? If yes, they are entitled to a permit (and may legitimately
 *    already have one — which might just be unreadable in the photo).
 *    If no, the plate shouldn't have any business in this zone on
 *    anything other than a visitor pass — which is its own defense.
 *
 * 2. Which permit-zone boundary did the violation occur in? The city's
 *    zones have irregular edges; a ticket issued one block outside a
 *    zone is a codified § 9-100-060(a)(4) defense ("the cited condition
 *    did not in fact exist").
 *
 * We use Chicago's published Residential Parking Permit Zones dataset
 * (shapefile/geojson). Since that's polygon data, full spatial analysis
 * requires point-in-polygon math. MVP uses the centroid + bounding box
 * shortcut the dataset already supplies.
 */

export interface PermitZoneFinding {
  checked: boolean;
  userInsideZone: boolean | null;
  userZone: string | null;
  ticketInsideZone: boolean | null;
  ticketZone: string | null;
  mismatch: boolean; // true when user is inside a different zone from the ticket
  defenseSummary: string | null;
}

// Chicago's Open Data residential permit zones (v1, published as
// polygons). We query for zones whose bounding box contains the point.
const PERMIT_ZONES_DATASET = 'https://data.cityofchicago.org/resource/u9xt-hiju.json';

type ZoneRow = {
  zone?: string;
  zone_name?: string;
  the_geom?: any; // MultiPolygon GeoJSON
  [k: string]: any;
};

/**
 * Crude point-in-polygon for MultiPolygon GeoJSON. Good enough for our
 * use case — Chicago permit zones don't have donut holes or crossings.
 */
function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];
    const intersect =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI + 1e-12) + lngI;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInMultiPolygon(lat: number, lng: number, geom: any): boolean {
  if (!geom || !geom.coordinates) return false;
  const type = geom.type;
  const coords = geom.coordinates;
  try {
    if (type === 'MultiPolygon') {
      for (const polygon of coords) {
        for (const ring of polygon) {
          if (pointInRing(lat, lng, ring)) return true;
        }
      }
    } else if (type === 'Polygon') {
      for (const ring of coords) {
        if (pointInRing(lat, lng, ring)) return true;
      }
    }
  } catch { /* bad geometry — skip */ }
  return false;
}

async function findZoneForPoint(lat: number, lng: number): Promise<{ zone: string; name: string | null } | null> {
  // Open Data's SoQL doesn't support efficient point-in-polygon with a
  // geojson column without `within_polygon` on a location type. Simpler:
  // fetch zones whose bounding-box intersects our point. The dataset is
  // small (~150 zones city-wide).
  const url = new URL(PERMIT_ZONES_DATASET);
  url.searchParams.set('$limit', '500');
  try {
    const r = await fetch(url.toString(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const rows = (await r.json()) as ZoneRow[];
    for (const row of rows) {
      if (pointInMultiPolygon(lat, lng, row.the_geom)) {
        return { zone: row.zone || row.zone_name || 'unknown', name: row.zone_name || null };
      }
    }
  } catch { return null; }
  return null;
}

export async function getResidentialPermitZoneFinding(
  userLatLng: [number, number] | null,
  ticketLatLng: [number, number] | null,
): Promise<PermitZoneFinding | null> {
  if (!userLatLng && !ticketLatLng) return null;

  const userZone = userLatLng ? await findZoneForPoint(userLatLng[0], userLatLng[1]) : null;
  const ticketZone = ticketLatLng ? await findZoneForPoint(ticketLatLng[0], ticketLatLng[1]) : null;

  const result: PermitZoneFinding = {
    checked: true,
    userInsideZone: userZone ? true : userLatLng ? false : null,
    userZone: userZone?.zone || null,
    ticketInsideZone: ticketZone ? true : ticketLatLng ? false : null,
    ticketZone: ticketZone?.zone || null,
    mismatch: !!(userZone && ticketZone && userZone.zone !== ticketZone.zone),
    defenseSummary: null,
  };

  // Build defense paragraph for the two cases we care about.
  if (result.ticketInsideZone === false && ticketLatLng) {
    result.defenseSummary = `The City of Chicago's published residential-permit-zone boundaries (Open Data Portal, dataset u9xt-hiju) show the cited location is OUTSIDE any designated residential-permit zone. The permit requirement does not apply here — this is a § 9-100-060(a)(4) codified defense.`;
  } else if (result.mismatch && userZone && ticketZone) {
    result.defenseSummary = `The registered owner's address falls inside residential-permit zone ${userZone.zone}, but the citation was issued in zone ${ticketZone.zone}. This indicates the vehicle was outside its home zone and may have been legitimately visiting — under Chicago Municipal Code § 9-64-070, visitor-pass allowances apply.`;
  } else if (userZone && result.ticketInsideZone && userZone.zone === result.ticketZone) {
    result.defenseSummary = `The cited location is inside residential-permit zone ${userZone.zone}, and the registered owner's address is ALSO inside this same zone — the owner is entitled to a permit for this zone. If a permit was properly displayed but not visible to the enforcement officer (e.g., sun-bleached, placed on the wrong window, obscured by ice/snow/dashboard items), that is grounds for dismissal under § 9-100-060(a)(4).`;
  }

  return result;
}
