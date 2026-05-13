/**
 * Chicago DOT permits enrichment.
 *
 * Given a cited ticket address + issue date, queries the public DOT permits
 * dataset (data.cityofchicago.org/resource/pubx-yq2d.json) for permits that
 * were active on the cited block face on the ticket date AND that affected
 * parking — i.e. street closures, curb-lane closures, partial closures, or
 * meter bagging. A hit means the City itself permitted the closure that
 * made parking impossible or restricted at the citation location.
 *
 * Probe (2026-05-12):
 *   Test: 100 W RANDOLPH @ 2024-06-01.
 *   Found: DOT1901456 (DOT_OCC, Work Vehicles/Barricades), Partial street
 *          closure, valid 2023-12-18 → 2024-06-30. Block range 1–1502 W
 *          RANDOLPH covers the cited address.
 *
 * Memory warning (reference_dot_permits_dedup.md): this dataset returns
 * multiple rows per permit. We MUST dedupe by applicationnumber before
 * counting — otherwise downstream consumers see the same permit N times.
 *
 * No API key required at this query volume.
 */

const ENDPOINT = 'https://data.cityofchicago.org/resource/pubx-yq2d.json';

/**
 * Permit types that meaningfully affect parking enforcement. Other DOT
 * permit types (driveway install, sign request, address certificate) are
 * irrelevant for our use case.
 */
const PARKING_RELEVANT_PERMIT_TYPES = [
  'DOT_OCC',     // Occupy the Public ROW — construction/dumpster/canopy
  'DOT_PWO',     // Public Way Opening — utility work
  'DOT_DMPSTR',  // Dumpster Permit — dumpster on street
  'DOT_SE',      // Special Event — block parties, festivals
  'DOT_CANOPY',  // Construction Canopy
] as const;

/**
 * Milestones that indicate the permit is NOT real (cancelled, denied, or
 * still in application limbo). Anything else implies a real permit was on
 * file.
 */
const EXCLUDE_MILESTONES = new Set([
  'Cancelled',
  'Denied',
  'Incomplete Application',
  'Application Checks',
  'Application in Review',
  'Fee Payment',
  'Final Fee Payment',
  'Periodic Renewal',
]);

/**
 * streetclosure values from the dataset that imply parking enforcement
 * should have been suspended on the block. "Curblane" is the strongest
 * for our use case because it explicitly takes the parking lane out of
 * service. "Full" and "Partial" close the whole street. "Sidewalk" alone
 * doesn't affect parking.
 */
const PARKING_AFFECTING_CLOSURES = new Set(['Full', 'Partial', 'Curblane']);

export interface DotPermit {
  applicationNumber: string;
  applicationType: string;
  workTypeDescription: string | null;
  streetClosure: string | null;
  parkingMeterBagged: boolean;
  startDate: string | null; // ISO yyyy-mm-dd
  endDate: string | null;   // ISO yyyy-mm-dd
  streetNumberFrom: number;
  streetNumberTo: number;
  direction: string;
  streetName: string;
  /** Human-readable description for letter prose. */
  summary: string;
}

export interface DotPermitsEnrichment {
  /** Permits active on the cited block at the time of the ticket. */
  activePermits: DotPermit[];
  /** Convenience: was at least one permit closing parking active? */
  anyParkingClosure: boolean;
  /** Convenience: was at least one permit involving meter bagging active? */
  anyMeterBagging: boolean;
}

interface SodaRow {
  uniquekey: string;
  applicationnumber: string;
  applicationtype: string;
  worktypedescription?: string;
  applicationstatus?: string;
  currentmilestone?: string;
  applicationstartdate?: string;
  applicationenddate?: string;
  streetnumberfrom?: string;
  streetnumberto?: string;
  direction?: string;
  streetname?: string;
  streetclosure?: string;
  parkingmeterpostingorbagging?: string;
}

function isoOrNull(s: string | undefined): string | null {
  if (!s) return null;
  return s.slice(0, 10);
}

/**
 * Compose a one-sentence summary of the permit suitable for inclusion in a
 * contest letter. Avoids jargon, names the specific permit number.
 */
function summarizePermit(p: {
  applicationnumber: string;
  worktypedescription?: string;
  streetclosure?: string;
  parkingmeterpostingorbagging?: string;
  startDate: string | null;
  endDate: string | null;
}): string {
  const closure = p.streetclosure && PARKING_AFFECTING_CLOSURES.has(p.streetclosure)
    ? p.streetclosure === 'Curblane'
      ? 'curb-lane closure'
      : p.streetclosure === 'Full'
        ? 'full street closure'
        : 'partial street closure'
    : null;
  const meterBagging = p.parkingmeterpostingorbagging === 'Y' ? 'parking-meter bagging' : null;
  const conditions = [closure, meterBagging].filter(Boolean).join(' and ');
  const work = p.worktypedescription || 'public-right-of-way occupancy';
  const dateRange =
    p.startDate && p.endDate
      ? `valid ${p.startDate} through ${p.endDate}`
      : p.startDate
        ? `effective ${p.startDate}`
        : '';
  return `DOT Permit ${p.applicationnumber} (${work}${conditions ? ', ' + conditions : ''})${dateRange ? ', ' + dateRange : ''}`;
}

/**
 * Find DOT permits active on the cited block face at the time of the
 * ticket that materially affected parking enforcement.
 * Returns null on network errors so callers can degrade gracefully.
 */
export async function findActiveDotPermits(args: {
  streetNumber: number;
  streetDirection: string;
  streetName: string;
  ticketIsoDate: string;
}): Promise<DotPermitsEnrichment | null> {
  const { streetNumber, streetDirection, streetName, ticketIsoDate } = args;

  // SoQL filter: permit covers the cited address number, was active on the
  // ticket date, and either closed the street or bagged the meters.
  const permitTypeList = PARKING_RELEVANT_PERMIT_TYPES.map(t => `'${t}'`).join(', ');
  const params = new URLSearchParams();
  params.set(
    '$select',
    [
      'applicationnumber',
      'applicationtype',
      'worktypedescription',
      'applicationstatus',
      'currentmilestone',
      'applicationstartdate',
      'applicationenddate',
      'streetnumberfrom',
      'streetnumberto',
      'direction',
      'streetname',
      'streetclosure',
      'parkingmeterpostingorbagging',
    ].join(','),
  );
  params.set(
    '$where',
    `streetname='${streetName.replace(/'/g, "''")}'
     AND direction='${streetDirection}'
     AND streetnumberfrom <= ${streetNumber + 50}
     AND streetnumberto   >= ${streetNumber - 50}
     AND applicationtype in(${permitTypeList})
     AND applicationstartdate <= '${ticketIsoDate}T23:59:59'
     AND (applicationenddate >= '${ticketIsoDate}T00:00:00' OR applicationenddate IS NULL)
     AND (streetclosure in('Full','Partial','Curblane') OR parkingmeterpostingorbagging='Y')`.replace(/\s+/g, ' ').trim(),
  );
  params.set('$limit', '200');

  let rows: SodaRow[];
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`);
    if (!res.ok) return null;
    rows = (await res.json()) as SodaRow[];
  } catch {
    return null;
  }

  // Dedupe by applicationnumber per memory warning. Pick the row with the
  // longest active window (most authoritative version) when duplicates exist.
  const byPermitNumber = new Map<string, SodaRow>();
  for (const r of rows) {
    if (!r.applicationnumber) continue;
    if (r.currentmilestone && EXCLUDE_MILESTONES.has(r.currentmilestone)) continue;
    if (r.applicationstatus === 'Cancelled') continue;
    // Verify the permit's block range really covers the ticket address —
    // server-side filter is approximate (±50), refine here exactly.
    const from = parseInt(r.streetnumberfrom || '', 10);
    const to = parseInt(r.streetnumberto || '', 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (streetNumber < from || streetNumber > to) continue;
    // Verify closure conditions actually affect parking.
    const hasClosure = r.streetclosure && PARKING_AFFECTING_CLOSURES.has(r.streetclosure);
    const hasMeter = r.parkingmeterpostingorbagging === 'Y';
    if (!hasClosure && !hasMeter) continue;
    // Keep one per permit number — last write wins is fine.
    byPermitNumber.set(r.applicationnumber, r);
  }

  const activePermits: DotPermit[] = [];
  let anyClosure = false;
  let anyMeter = false;

  for (const r of byPermitNumber.values()) {
    const startDate = isoOrNull(r.applicationstartdate);
    const endDate = isoOrNull(r.applicationenddate);
    const hasClosure = !!(r.streetclosure && PARKING_AFFECTING_CLOSURES.has(r.streetclosure));
    const hasMeter = r.parkingmeterpostingorbagging === 'Y';
    if (hasClosure) anyClosure = true;
    if (hasMeter) anyMeter = true;
    activePermits.push({
      applicationNumber: r.applicationnumber,
      applicationType: r.applicationtype,
      workTypeDescription: r.worktypedescription || null,
      streetClosure: r.streetclosure || null,
      parkingMeterBagged: hasMeter,
      startDate,
      endDate,
      streetNumberFrom: parseInt(r.streetnumberfrom || '0', 10),
      streetNumberTo: parseInt(r.streetnumberto || '0', 10),
      direction: r.direction || '',
      streetName: r.streetname || '',
      summary: summarizePermit({
        applicationnumber: r.applicationnumber,
        worktypedescription: r.worktypedescription,
        streetclosure: r.streetclosure,
        parkingmeterpostingorbagging: r.parkingmeterpostingorbagging,
        startDate,
        endDate,
      }),
    });
  }

  return {
    activePermits,
    anyParkingClosure: anyClosure,
    anyMeterBagging: anyMeter,
  };
}
