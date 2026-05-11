/**
 * FOIA enrichment for portal tickets.
 *
 * The CHI PAY portal returns "Ticket — Skeletal" records that DO NOT include
 * the cited address or the issuing officer. Those facts only live in the
 * city's FOIA-released ticket database (`~/Documents/FOIA/foia.db`,
 * `tickets` table, 35.7M rows from 2018 through Dec 2025).
 *
 * For any portal ticket older than ~4–5 months we can:
 *   1. Look up the row by ticket_number → cited address + officer + violation_code
 *   2. Compute the officer's historical dismissal rate from `hearings`
 *   3. Compute the block face's historical dismissal rate
 *
 * These are the "you couldn't get this on your own" findings that justify
 * using Autopilot vs. mailing a generic letter yourself.
 *
 * Runs ONLY on the worker machine (where foia.db lives — Randy's setup
 * uses ~/Documents/FOIA/foia.db, 8.2 GB). Never called from Vercel.
 *
 * Implementation: shells out to the `sqlite3` CLI binary because we don't
 * have a node sqlite library installed. The CLI is fast for indexed
 * lookups (~ms per query against the ticket_number index).
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

const DEFAULT_FOIA_DB = process.env.FOIA_DB || resolve(homedir(), 'Documents/FOIA/foia.db');

export interface FoiaTicketRow {
  ticketNumber: string;
  issueDatetime: string | null;
  streetNum: string | null;
  streetDir: string | null;
  streetName: string | null;
  zipcode: string | null;
  violationCode: string | null;
  violationDesc: string | null;
  unit: string | null;
  unitDescription: string | null;
  officer: string | null;
  ticketQueue: string | null;
  dispo: string | null;
  /** Composed for display: "249 E PEARSON" */
  fullAddress: string | null;
}

export interface FoiaOfficerStats {
  officer: string;
  /** Total contested hearings for this officer (Mail or In-Person, decided) */
  totalContested: number;
  notLiable: number;
  liable: number;
  dismissalRate: number; // 0–1
  /** Filtered to the same violation_desc as the ticket */
  sameTypeContested: number;
  sameTypeNotLiable: number;
  sameTypeDismissalRate: number; // 0–1
}

export interface FoiaBlockStats {
  /** e.g. "E PEARSON" */
  blockLabel: string;
  /** Within the same hundred-block (e.g. 200–299 E PEARSON) and same violation type */
  ticketsAtBlock: number;
  notLiableAtBlock: number;
  dismissalRateAtBlock: number; // 0–1
}

/**
 * Look up a single portal ticket in foia.db. Returns null when the
 * ticket isn't in FOIA yet (fresh tickets, typically < 4 months old).
 */
export function enrichTicketFromFoia(ticketNumber: string, dbPath = DEFAULT_FOIA_DB): FoiaTicketRow | null {
  if (!existsSync(dbPath)) return null;
  // .mode tabs gives us \t separators that we can split safely
  const sql =
    ".mode tabs\n" +
    `SELECT ticket_number, issue_datetime, street_num, street_dir, street_name, zipcode, violation_code, violation_desc, unit, unit_description, officer, ticket_queue, dispo
     FROM tickets WHERE ticket_number = '${ticketNumber.replace(/'/g, "''")}' LIMIT 1;`;
  let out: string;
  try {
    out = execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf-8', timeout: 8000 });
  } catch {
    return null;
  }
  const line = out.trim().split('\n').find(l => l.trim().length > 0);
  if (!line) return null;
  // sqlite3 .mode tabs strips trailing empty fields when columns are NULL,
  // so pad to 13 to keep destructuring stable.
  const cols = line.split('\t');
  while (cols.length < 13) cols.push('');
  const [
    tn, dt, sn, sd, st, zc, vc, vd, unit, ud, off, tq, dispo,
  ] = cols;
  const fullAddress = composeAddress(sn, sd, st);
  return {
    ticketNumber: tn || ticketNumber,
    issueDatetime: dt || null,
    streetNum: sn || null,
    streetDir: sd || null,
    streetName: st || null,
    zipcode: zc || null,
    violationCode: vc || null,
    violationDesc: vd || null,
    unit: unit || null,
    unitDescription: ud || null,
    officer: off || null,
    ticketQueue: tq || null,
    dispo: dispo || null,
    fullAddress,
  };
}

/**
 * Compute the officer's contest-disposition history.
 *
 * Note: foia.db.hearings has `hearing_officer` (the administrative law
 * officer who decided the contest) — NOT the issuing officer. To attribute
 * to the issuing officer we'd need to join hearings → tickets by ticket_number
 * to find which issuing officer's tickets get dismissed most. We do that.
 */
export function getIssuingOfficerStats(
  officer: string,
  violationDesc: string | null,
  dbPath = DEFAULT_FOIA_DB,
): FoiaOfficerStats | null {
  if (!existsSync(dbPath) || !officer) return null;
  const safeOfficer = officer.replace(/'/g, "''");
  const safeViol = (violationDesc || '').replace(/'/g, "''");
  const sql =
    ".mode tabs\n" +
    `SELECT
       SUM(CASE WHEN h.disposition='Not Liable' THEN 1 ELSE 0 END) AS nl,
       SUM(CASE WHEN h.disposition='Liable'    THEN 1 ELSE 0 END) AS li,
       SUM(CASE WHEN h.disposition='Not Liable' AND UPPER(t.violation_desc)=UPPER('${safeViol}') THEN 1 ELSE 0 END) AS nl_same,
       SUM(CASE WHEN h.disposition IN ('Not Liable','Liable') AND UPPER(t.violation_desc)=UPPER('${safeViol}') THEN 1 ELSE 0 END) AS dec_same
     FROM hearings h
     JOIN tickets t ON t.ticket_number = h.ticket_number
     WHERE t.officer = '${safeOfficer}'
       AND h.disposition IN ('Not Liable','Liable')
       AND h.contest_method IN ('Mail','In-Person');`;
  let out: string;
  try {
    out = execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf-8', timeout: 12000 });
  } catch {
    return null;
  }
  const line = out.trim().split('\n').find(l => l.trim().length > 0);
  if (!line) return null;
  const [nlStr, liStr, nlSameStr, decSameStr] = line.split('\t');
  const nl = parseInt(nlStr || '0', 10) || 0;
  const li = parseInt(liStr || '0', 10) || 0;
  const total = nl + li;
  if (total === 0) return null;
  const nlSame = parseInt(nlSameStr || '0', 10) || 0;
  const decSame = parseInt(decSameStr || '0', 10) || 0;
  return {
    officer,
    totalContested: total,
    notLiable: nl,
    liable: li,
    dismissalRate: nl / total,
    sameTypeContested: decSame,
    sameTypeNotLiable: nlSame,
    sameTypeDismissalRate: decSame > 0 ? nlSame / decSame : 0,
  };
}

/**
 * Block-face dismissal rate for the same violation type. Looks at the
 * hundred-block (street_num rounded down to the nearest 100) and joins
 * hearings → tickets. A "hot block" — where the city issues many tickets
 * of this type but loses most contests — is itself a strong defense:
 * the hearing officer has seen the pattern before.
 */
export function getBlockStats(
  enriched: FoiaTicketRow,
  dbPath = DEFAULT_FOIA_DB,
): FoiaBlockStats | null {
  if (!existsSync(dbPath) || !enriched.streetName || !enriched.streetNum) return null;
  const num = parseInt(enriched.streetNum, 10);
  if (isNaN(num)) return null;
  const blockLow = Math.floor(num / 100) * 100;
  const blockHigh = blockLow + 99;
  const safeStreet = (enriched.streetName || '').replace(/'/g, "''");
  const safeDir = (enriched.streetDir || '').replace(/'/g, "''");
  const safeViol = (enriched.violationDesc || '').replace(/'/g, "''");
  const sql =
    ".mode tabs\n" +
    `SELECT
       SUM(CASE WHEN h.disposition='Not Liable' THEN 1 ELSE 0 END) AS nl,
       COUNT(*) AS total
     FROM hearings h
     JOIN tickets t ON t.ticket_number = h.ticket_number
     WHERE UPPER(t.street_name) = UPPER('${safeStreet}')
       AND UPPER(t.street_dir)  = UPPER('${safeDir}')
       AND CAST(t.street_num AS INTEGER) BETWEEN ${blockLow} AND ${blockHigh}
       AND UPPER(t.violation_desc) = UPPER('${safeViol}')
       AND h.disposition IN ('Not Liable','Liable')
       AND h.contest_method IN ('Mail','In-Person');`;
  let out: string;
  try {
    out = execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf-8', timeout: 12000 });
  } catch {
    return null;
  }
  const line = out.trim().split('\n').find(l => l.trim().length > 0);
  if (!line) return null;
  const [nlStr, totalStr] = line.split('\t');
  const nl = parseInt(nlStr || '0', 10) || 0;
  const total = parseInt(totalStr || '0', 10) || 0;
  if (total < 5) return null; // Too few to be statistically interesting
  return {
    blockLabel: `${blockLow}–${blockHigh} ${enriched.streetDir || ''} ${enriched.streetName || ''}`.trim().replace(/\s+/g, ' '),
    ticketsAtBlock: total,
    notLiableAtBlock: nl,
    dismissalRateAtBlock: nl / total,
  };
}

function composeAddress(sn: string | null, sd: string | null, st: string | null): string | null {
  const parts = [sn, sd, st].map(p => (p || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}
