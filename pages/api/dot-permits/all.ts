/**
 * Returns CDOT permits that involve temporary no-parking signs (meter bagging or street closure).
 *
 * Source: Chicago Data Portal SODA API (pubx-yq2d — "Transportation Department Permits")
 * https://data.cityofchicago.org/resource/pubx-yq2d.json
 *
 * We query the portal directly rather than reading the dot_permits table because:
 *  - the table is empty in prod (sync cron is not in vercel.json)
 *  - permits change daily and live data is fine for a read-only map
 *
 * Filter matches the same semantics the in-repo sync uses: applicationstatus='Open',
 * parking impact (meter posting/bagging OR street closure), end_date in the future,
 * start_date within the requested lookahead window.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { TempSignPermit } from '@/lib/temp-signs';

const SODA_URL = 'https://data.cityofchicago.org/resource/pubx-yq2d.json';
const SELECT_FIELDS = [
  'applicationnumber',
  'applicationname',
  'worktypedescription',
  'applicationstatus',
  'applicationstartdate',
  'applicationenddate',
  'streetnumberfrom',
  'streetnumberto',
  'direction',
  'streetname',
  'suffix',
  'ward',
  'latitude',
  'longitude',
  'streetclosure',
  'parkingmeterpostingorbagging',
  'comments',
].join(',');

const PAGE_SIZE = 5000;
const MAX_PAGES = 4; // up to 20k rows total

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const lookaheadDays = Math.min(
      365,
      Math.max(1, parseInt((req.query.days as string) || '60', 10) || 60)
    );

    const today = new Date();
    const startOfToday = today.toISOString().split('T')[0];
    const horizon = new Date(today.getTime() + lookaheadDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    // Optional proximity filter — when the caller passes lat/lng/radius
    // we narrow the SODA query with a bounding box so we don't fetch the
    // ~14k citywide rows just to throw most of them away client-side.
    // The CDOT dataset stores latitude and longitude as separate numeric
    // columns (no point/location field), so within_circle() isn't usable
    // — bounding box is fine since the client re-filters with haversine.
    const latParam = parseFloat(req.query.lat as string);
    const lngParam = parseFloat(req.query.lng as string);
    const radiusParam = parseFloat(req.query.radius as string);
    const hasProximity = isFinite(latParam) && isFinite(lngParam) && isFinite(radiusParam) && radiusParam > 0;

    const whereParts = [
      `applicationstatus='Open'`,
      `applicationenddate>='${startOfToday}'`,
      `applicationstartdate<='${horizon}'`,
      `latitude IS NOT NULL`,
      `(parkingmeterpostingorbagging='Y' OR streetclosure IS NOT NULL)`,
    ];

    if (hasProximity) {
      // Cap radius at 5 km (5000m) to prevent abuse — well above any
      // reasonable "near my parking" use case.
      const radiusM = Math.min(radiusParam, 5000);
      // Approximate degree → meter conversion. 1° lat ≈ 111,000 m.
      // 1° lng varies by latitude: 111,000 * cos(lat).
      const latDelta = radiusM / 111000;
      const lngDelta = radiusM / (111000 * Math.cos((latParam * Math.PI) / 180));
      whereParts.push(`latitude > ${latParam - latDelta}`);
      whereParts.push(`latitude < ${latParam + latDelta}`);
      whereParts.push(`longitude > ${lngParam - lngDelta}`);
      whereParts.push(`longitude < ${lngParam + lngDelta}`);
    }

    const whereClause = whereParts.join(' AND ');

    const token = process.env.CHICAGO_DATA_PORTAL_TOKEN;

    const all: any[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${SODA_URL}?$where=${encodeURIComponent(whereClause)}&$select=${SELECT_FIELDS}&$limit=${PAGE_SIZE}&$offset=${page * PAGE_SIZE}&$order=applicationstartdate ASC`;
      const r = await fetch(url, {
        headers: token ? { 'X-App-Token': token } : {},
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(502).json({ error: 'SODA fetch failed', status: r.status, body: text.slice(0, 300) });
      }
      const chunk = await r.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      all.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
    }

    const permits: TempSignPermit[] = [];
    for (const row of all) {
      const lat = parseFloat(row.latitude);
      const lng = parseFloat(row.longitude);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      if (!row.applicationstartdate || !row.applicationenddate) continue;

      permits.push({
        id: `${row.applicationnumber}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
        applicationNumber: row.applicationnumber,
        name: row.applicationname || null,
        workType: row.worktypedescription || null,
        status: row.applicationstatus || null,
        startDate: row.applicationstartdate,
        endDate: row.applicationenddate,
        streetNumberFrom: row.streetnumberfrom ? parseInt(row.streetnumberfrom, 10) || null : null,
        streetNumberTo: row.streetnumberto ? parseInt(row.streetnumberto, 10) || null : null,
        direction: row.direction || null,
        streetName: row.streetname || null,
        suffix: row.suffix || null,
        ward: row.ward || null,
        latitude: lat,
        longitude: lng,
        streetClosure: row.streetclosure || null,
        meterBagging: row.parkingmeterpostingorbagging === 'Y',
        comments: row.comments || null,
      });
    }

    // Proximity-filtered responses are user-specific and small — cache
    // briefly and let the CDN dedupe identical requests. The unfiltered
    // citywide response stays on the longer SWR window.
    if (hasProximity) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    } else {
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    }
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      lookaheadDays,
      proximity: hasProximity ? { lat: latParam, lng: lngParam, radiusMeters: radiusParam } : null,
      count: permits.length,
      permits,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to load permits', message });
  }
}
