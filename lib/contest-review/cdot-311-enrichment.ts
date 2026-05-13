/**
 * Chicago 311 sign-repair enrichment.
 *
 * Given a cited ticket address + issue date, queries the public 311 Service
 * Requests dataset (data.cityofchicago.org/resource/v6vf-nfxy.json) for
 * "Sign Repair Request - All Other Signs" SRs on the same block face. Hits
 * here are evidence the City itself had a documented sign-maintenance issue
 * at or near the cited location — strongest when the SR was OPEN at the
 * time of the ticket (the City literally had an unresolved work order for
 * the sign).
 *
 * Probe (2026-05-12):
 *   Ticket: 4444 N MALDEN, Street Cleaning, issued 2024-04-25 (Liable)
 *   Found:  SR23-01300036 @ 4446 N MALDEN — Sign Repair - All Other Signs,
 *           opened 2023-08-07, didn't close until 2025-07-09 (OPEN at
 *           ticket time, on the same block face, same direction).
 *
 * The dataset returns duplicates (per Chicago Data Portal SODA behavior —
 * see reference_dot_permits_dedup.md). We filter `duplicate=false` server
 * side and dedup by sr_number client side to be safe.
 *
 * No API key required for the SODA endpoint at this query volume; if we
 * hit throttle limits later we can add a CHICAGO_DATA_APP_TOKEN env var
 * and pass via X-App-Token.
 */

const ENDPOINT = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';

/**
 * SR types we care about for parking-sign contests. "All Other Signs" is the
 * catch-all that includes street-cleaning, no-parking, time-restriction, bike
 * lane, etc. Stop/One-Way/Do-Not-Enter are road regulatory signs and aren't
 * relevant to parking contests.
 */
const SIGN_REPAIR_SR_TYPES = ['Sign Repair Request - All Other Signs'] as const;

/**
 * Tree-related SR types whose presence near a sign-based ticket implies the
 * sign may have been obstructed by foliage/debris at the time of citation.
 * "Tree Trim Request (NO LONGER BEING ACCEPTED)" is the retired type but
 * has historical records useful for old tickets. "Tree Debris" and "Tree
 * Emergency" are the current types.
 */
const TREE_OBSTRUCTION_SR_TYPES = [
  'Tree Trim Request (NO LONGER BEING ACCEPTED)',
  'Tree Debris Clean-Up Request',
  'Tree Emergency',
] as const;

/**
 * Window for considering a closed SR "recent enough" relative to the ticket.
 * A sign that was broken and repaired within the prior year is evidence the
 * area's signage was in maintenance churn around the time of the ticket.
 */
const RECENT_CLOSED_WINDOW_DAYS = 365;

/**
 * Block-face match: we accept SRs whose street number is within ±BLOCK_RADIUS
 * of the ticket's street number, same direction + street name. Chicago's
 * standard block is ~100 numbers, so ±50 keeps us to one block face on each
 * side of the cited address.
 */
const BLOCK_RADIUS = 50;

export interface SignRepairSR {
  srNumber: string;
  srType: string;
  status: string;
  createdDate: string; // ISO yyyy-mm-dd
  closedDate: string | null; // ISO yyyy-mm-dd, null if still open
  streetNumber: number;
  streetDirection: string;
  streetName: string;
  /** True if the SR was still open on the ticket date. */
  openAtTicketTime: boolean;
  /** When closedDate is non-null and falls before ticket date, the gap in days. */
  daysClosedBeforeTicket: number | null;
}

export interface Cdot311Enrichment {
  /** All matching SRs on the block face that were filed on or before the ticket date. */
  signComplaints: SignRepairSR[];
  /** Convenience: was any SR open on the ticket date? */
  anyOpenAtTicketTime: boolean;
  /** Convenience: was any SR closed within the prior year? */
  anyRecentClosure: boolean;
}

/**
 * Same shape as SignRepairSR — different SR type filter underneath.
 */
export type TreeObstructionSR = SignRepairSR;

export interface TreeObstruction311Enrichment {
  treeComplaints: TreeObstructionSR[];
  anyOpenAtTicketTime: boolean;
  anyRecentClosure: boolean;
}

interface SodaRow {
  sr_number: string;
  sr_type: string;
  status: string;
  created_date: string;
  closed_date?: string;
  street_number: string;
  street_direction: string;
  street_name: string;
  duplicate?: boolean;
}

/**
 * Parse the ticket address into the components the 311 dataset uses.
 * Accepts either pre-split parts (preferred — FOIA enrichment has them) or
 * a single address string like "4444 N MALDEN AVE".
 */
export function parseAddress(address: string): {
  streetNumber: number;
  streetDirection: string;
  streetName: string;
} | null {
  const m = address.trim().match(/^(\d+)\s+([NSEW])\s+([A-Z0-9 ]+?)(?:\s+(?:ST|AVE|BLVD|DR|PL|RD|CT|LN|PKWY|TER|WAY))?$/i);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (!Number.isFinite(num)) return null;
  return {
    streetNumber: num,
    streetDirection: m[2].toUpperCase(),
    streetName: m[3].toUpperCase().trim(),
  };
}

/**
 * Shared block-face SR query. Used by both sign-repair and tree-obstruction
 * lookups — same dataset, same join logic, different sr_type filter.
 * Returns null on network errors so callers can degrade gracefully.
 */
async function queryBlockSrs(args: {
  streetNumber: number;
  streetDirection: string;
  streetName: string;
  ticketIsoDate: string;
  srTypes: readonly string[];
}): Promise<SignRepairSR[] | null> {
  const { streetNumber, streetDirection, streetName, ticketIsoDate, srTypes } = args;
  const ticketDate = new Date(`${ticketIsoDate}T00:00:00Z`);
  if (Number.isNaN(ticketDate.getTime())) return null;

  const params = new URLSearchParams();
  params.set('$select', 'sr_number,sr_type,status,created_date,closed_date,street_number,street_direction,street_name,duplicate');
  const srTypeList = srTypes.map(t => `'${t.replace(/'/g, "''")}'`).join(', ');
  params.set(
    '$where',
    `street_name='${streetName.replace(/'/g, "''")}'
     AND street_direction='${streetDirection}'
     AND sr_type in(${srTypeList})
     AND duplicate=false
     AND created_date <= '${ticketIsoDate}T23:59:59'`.replace(/\s+/g, ' ').trim(),
  );
  params.set('$limit', '500');

  let rows: SodaRow[];
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`);
    if (!res.ok) return null;
    rows = (await res.json()) as SodaRow[];
  } catch {
    return null;
  }

  const seen = new Set<string>();
  const recentCutoff = new Date(ticketDate.getTime() - RECENT_CLOSED_WINDOW_DAYS * 86400000);
  const out: SignRepairSR[] = [];

  for (const r of rows) {
    if (seen.has(r.sr_number)) continue;
    seen.add(r.sr_number);
    const sn = parseInt(r.street_number, 10);
    if (!Number.isFinite(sn)) continue;
    if (Math.abs(sn - streetNumber) > BLOCK_RADIUS) continue;
    const created = (r.created_date || '').slice(0, 10);
    const closed = r.closed_date ? r.closed_date.slice(0, 10) : null;
    if (!created) continue;
    const closedDate = closed ? new Date(`${closed}T00:00:00Z`) : null;
    const openAtTicket = !closedDate || closedDate >= ticketDate;
    const daysClosedBefore =
      closedDate && closedDate < ticketDate
        ? Math.floor((ticketDate.getTime() - closedDate.getTime()) / 86400000)
        : null;
    const recentClosure =
      closedDate !== null && closedDate >= recentCutoff && closedDate < ticketDate;
    if (!openAtTicket && !recentClosure) continue;
    out.push({
      srNumber: r.sr_number,
      srType: r.sr_type,
      status: r.status,
      createdDate: created,
      closedDate: closed,
      streetNumber: sn,
      streetDirection: r.street_direction,
      streetName: r.street_name,
      openAtTicketTime: openAtTicket,
      daysClosedBeforeTicket: daysClosedBefore,
    });
  }
  return out;
}

/**
 * Find recent sign-repair 311 SRs on the cited block face.
 * Returns null on network errors so the caller can degrade gracefully.
 */
export async function findRecentSignComplaints(args: {
  streetNumber: number;
  streetDirection: string;
  streetName: string;
  ticketIsoDate: string; // yyyy-mm-dd
}): Promise<Cdot311Enrichment | null> {
  const signComplaints = await queryBlockSrs({ ...args, srTypes: SIGN_REPAIR_SR_TYPES });
  if (signComplaints === null) return null;
  const anyOpen = signComplaints.some(s => s.openAtTicketTime);
  const anyRecent = signComplaints.some(s => !s.openAtTicketTime);
  return { signComplaints, anyOpenAtTicketTime: anyOpen, anyRecentClosure: anyRecent };
}

/**
 * Find tree-obstruction 311 SRs on the cited block face. Used to support a
 * "sign was obstructed by tree foliage/debris" defense — only relevant for
 * sign-based parking violations.
 */
export async function findTreeObstructionComplaints(args: {
  streetNumber: number;
  streetDirection: string;
  streetName: string;
  ticketIsoDate: string;
}): Promise<TreeObstruction311Enrichment | null> {
  const treeComplaints = await queryBlockSrs({ ...args, srTypes: TREE_OBSTRUCTION_SR_TYPES });
  if (treeComplaints === null) return null;
  const anyOpen = treeComplaints.some(s => s.openAtTicketTime);
  const anyRecent = treeComplaints.some(s => !s.openAtTicketTime);
  return { treeComplaints, anyOpenAtTicketTime: anyOpen, anyRecentClosure: anyRecent };
}
