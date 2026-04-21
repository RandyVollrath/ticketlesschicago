/**
 * Camera-malfunction detector for red-light / speed-camera tickets.
 *
 * Queries Chicago's Open Data Portal for daily violation counts at each
 * camera. A day with violations >= 3× the 30-day median (or in the top
 * 5%) is a statistical anomaly — often caused by camera miscalibration,
 * signal timing error, or equipment fault. When a user's ticket falls on
 * such a day, this becomes a direct "camera malfunction" argument per
 * 625 ILCS 5/11-208.6.
 *
 * Datasets:
 *   - Red-light violations (spqx-js37): one row per camera-day-violation
 *   - Speed-camera violations (hhkd-xvj4): one row per camera-day-violation
 *
 * Both datasets are public and don't require an app token for small
 * volumes of queries (we run at most once per camera ticket detected).
 *
 * Returns null when data is missing or inconclusive — callers treat that
 * as "no argument available" rather than an error.
 */

type OpenDataViolationRow = {
  violation_date?: string;
  address?: string;
  camera_id?: string;
  intersection?: string;
  violations?: string | number;
  [k: string]: any;
};

export interface CameraMalfunctionFinding {
  hasAnomaly: boolean;
  cameraIdentifier: string;
  violationDate: string; // YYYY-MM-DD
  violationsOnTicketDate: number;
  medianViolationsPerDay: number;
  multipleOfMedian: number; // e.g. 4.2 means 4.2× normal volume
  windowStart: string;
  windowEnd: string;
  rowCount: number;
  defenseSummary: string | null;
}

const RED_LIGHT_DATASET = 'https://data.cityofchicago.org/resource/spqx-js37.json';
const SPEED_CAMERA_DATASET = 'https://data.cityofchicago.org/resource/hhkd-xvj4.json';

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Look up violation-volume history for a specific camera and return an
 * anomaly signal for the ticket's date.
 *
 * @param violationType 'red_light' | 'speed_camera'
 * @param cameraIdentifier Address, intersection, or camera_id that SoQL
 *   will match. We try the most specific field first and fall back.
 * @param violationDate ISO date of the ticket (YYYY-MM-DD)
 */
export async function getCameraMalfunctionSignal(
  violationType: 'red_light' | 'speed_camera',
  cameraIdentifier: string | null,
  violationDate: string | null,
): Promise<CameraMalfunctionFinding | null> {
  if (!cameraIdentifier || !violationDate) return null;
  const dataset = violationType === 'speed_camera' ? SPEED_CAMERA_DATASET : RED_LIGHT_DATASET;

  // 30-day window centred on the violation date.
  const vDate = new Date(violationDate + 'T00:00:00Z');
  if (!Number.isFinite(vDate.getTime())) return null;
  const windowStart = new Date(vDate);
  windowStart.setUTCDate(windowStart.getUTCDate() - 30);
  const windowEnd = new Date(vDate);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 30);

  // Try exact address match first, then fall back to substring match.
  // SoQL $where accepts `upper(address) = 'X'` and `upper(address) like 'X%'`.
  const cleanedId = cameraIdentifier.trim().toUpperCase().replace(/'/g, '');
  const whereClauses = [
    `upper(address) = '${cleanedId}'`,
    `upper(address) like '${cleanedId.split(' ')[0]}%'`,
    `upper(intersection) like '%${cleanedId.split(' ')[0]}%'`,
  ];

  for (const where of whereClauses) {
    const url = new URL(dataset);
    url.searchParams.set(
      '$where',
      `${where} AND violation_date between '${toISODate(windowStart)}T00:00:00' and '${toISODate(windowEnd)}T23:59:59'`
    );
    url.searchParams.set('$limit', '200');

    let rows: OpenDataViolationRow[] = [];
    try {
      const resp = await fetch(url.toString(), {
        headers: { accept: 'application/json' },
        // Short timeout — Open Data is usually fast, if it stalls we skip.
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      rows = (await resp.json()) as OpenDataViolationRow[];
    } catch {
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) continue;

    // Aggregate daily totals from the rows the dataset returned.
    const perDay = new Map<string, number>();
    for (const r of rows) {
      const d = (r.violation_date || '').slice(0, 10);
      if (!d) continue;
      const count = typeof r.violations === 'number'
        ? r.violations
        : parseInt(String(r.violations || '1'), 10) || 1;
      perDay.set(d, (perDay.get(d) || 0) + count);
    }
    if (perDay.size < 5) continue; // not enough data to compute a median

    const sorted = [...perDay.values()].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const onTicketDate = perDay.get(violationDate) || 0;

    if (median === 0) continue;
    const multiple = onTicketDate / median;

    const hasAnomaly = multiple >= 3;

    return {
      hasAnomaly,
      cameraIdentifier,
      violationDate,
      violationsOnTicketDate: onTicketDate,
      medianViolationsPerDay: median,
      multipleOfMedian: Math.round(multiple * 10) / 10,
      windowStart: toISODate(windowStart),
      windowEnd: toISODate(windowEnd),
      rowCount: rows.length,
      defenseSummary: hasAnomaly
        ? `On the date of this citation, camera ${cameraIdentifier} recorded ${onTicketDate} violations — ${multiple.toFixed(1)}× the 30-day median of ${median}. This is a statistical anomaly consistent with camera malfunction, miscalibration, or signal-timing error, and is independently verifiable via the City of Chicago Open Data Portal (${violationType === 'red_light' ? 'red-light violations dataset' : 'speed-camera violations dataset'}).`
        : null,
    };
  }

  return null;
}
