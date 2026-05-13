#!/usr/bin/env npx tsx
/**
 * Live smoke test for the 311 sign-repair enrichment.
 *
 * Picks N real Street-Cleaning (9-64-010) tickets from the FOIA db,
 * runs each through findRecentSignComplaints(), prints what was found.
 * Exit 0 if every call returned a response (even with zero hits — that
 * means the API is up); exit 1 on any hard failure.
 *
 * Per CLAUDE.md this is the acceptance criterion: "Live smoke test is
 * the acceptance criterion. npx tsc --noEmit passing is NOT sufficient."
 *
 * Run:  npx tsx scripts/smoke-test-cdot-311.ts
 */

import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import { findRecentSignComplaints } from '../lib/contest-review/cdot-311-enrichment';

const DB_PATH = process.env.FOIA_DB || resolve(homedir(), 'Documents/FOIA/foia.db');
const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '50', 10);

interface SampleRow {
  ticket_number: string;
  issue_datetime: string;
  street_num: string;
  street_dir: string;
  street_name: string;
  disposition: string;
}

function foiaDateToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function main() {
  // FOIA uses violation_desc keywords (e.g. "STREET CLEANING") since the
  // raw violation_code is "0964040B"-style, not the dashed format. Pull a
  // mix of sign-based violations from 2024 with parseable addresses.
  const sql = `
    SELECT ticket_number, issue_datetime, street_num, street_dir, street_name, disposition
    FROM hearings
    WHERE violation_desc LIKE 'STREET CLEANING%'
      AND street_num IS NOT NULL
      AND street_dir IS NOT NULL
      AND street_name IS NOT NULL
      AND issue_datetime LIKE '%/2024 %'
    ORDER BY RANDOM()
    LIMIT ${SAMPLE_SIZE};
  `;
  const raw = execFileSync('sqlite3', ['-separator', '|', DB_PATH, sql], { encoding: 'utf-8' });
  const rows: SampleRow[] = raw.trim().split('\n').filter(Boolean).map(line => {
    const [ticket_number, issue_datetime, street_num, street_dir, street_name, disposition] = line.split('|');
    return { ticket_number, issue_datetime, street_num, street_dir, street_name, disposition };
  });
  if (rows.length === 0) {
    console.error('No sample rows returned from FOIA db. Check that ~/Documents/FOIA/foia.db exists and has Street Cleaning hearings.');
    process.exit(1);
  }

  console.log(`Sampling ${rows.length} Street-Cleaning tickets from 2024:\n`);

  let networkFailures = 0;
  let ticketsWithHits = 0;
  let openHits = 0;
  let recentHits = 0;

  for (const r of rows) {
    const iso = foiaDateToIso(r.issue_datetime);
    const num = parseInt(r.street_num, 10);
    if (!iso || !Number.isFinite(num)) {
      console.log(`  ⊘ ${r.ticket_number}: bad parse, skipping`);
      continue;
    }

    const result = await findRecentSignComplaints({
      streetNumber: num,
      streetDirection: r.street_dir,
      streetName: r.street_name,
      ticketIsoDate: iso,
    });

    if (!result) {
      console.log(`  ✗ ${r.ticket_number}: NETWORK FAILURE`);
      networkFailures += 1;
      continue;
    }

    const open = result.signComplaints.filter(s => s.openAtTicketTime).length;
    const recent = result.signComplaints.filter(s => !s.openAtTicketTime).length;
    if (open + recent > 0) ticketsWithHits += 1;
    openHits += open;
    recentHits += recent;

    const summary = result.signComplaints.length === 0
      ? '(no 311 hits)'
      : result.signComplaints
          .slice(0, 3)
          .map(s => `${s.srNumber} @ ${s.streetNumber}, ${s.openAtTicketTime ? 'OPEN at ticket' : `closed ${s.daysClosedBeforeTicket}d before`}`)
          .join('; ');

    console.log(`  ✓ ${r.ticket_number} ${num} ${r.street_dir} ${r.street_name} (${iso}) — ${summary}`);
  }

  console.log('');
  console.log(`Summary: ${ticketsWithHits}/${rows.length} tickets had 311 sign-repair hits on the block`);
  console.log(`         ${openHits} open SRs at ticket time, ${recentHits} closed within 365d`);
  console.log(`         ${networkFailures} network failures`);

  if (networkFailures > 0) {
    console.error('\n✗ FAILED — network errors. The 311 API may be down or rate-limited.');
    process.exit(1);
  }
  console.log('\n✓ PASSED — 311 enrichment is wired correctly and reachable.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
