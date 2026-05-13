#!/usr/bin/env npx tsx
/**
 * Live smoke test for the Tier 1 enrichments:
 *   - DOT permits (any parking violation)
 *   - 311 tree obstruction (sign-based violations)
 *
 * Picks N random parking tickets from FOIA db, runs both new lookups,
 * reports per-ticket hits and aggregate hit-rate. Exit 0 on success.
 *
 * Per CLAUDE.md: live smoke test is the acceptance criterion.
 *
 * Run:  npx tsx scripts/smoke-test-tier1-enrichments.ts
 *       SAMPLE_SIZE=50 npx tsx scripts/smoke-test-tier1-enrichments.ts
 */

import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import { findActiveDotPermits } from '../lib/contest-review/dot-permits-enrichment';
import { findTreeObstructionComplaints } from '../lib/contest-review/cdot-311-enrichment';

const DB_PATH = process.env.FOIA_DB || resolve(homedir(), 'Documents/FOIA/foia.db');
const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '30', 10);

interface SampleRow {
  ticket_number: string;
  issue_datetime: string;
  street_num: string;
  street_dir: string;
  street_name: string;
  violation_desc: string;
}

function foiaDateToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function main() {
  // Pull a mix of sign-based and other parking violations from 2024.
  const sql = `
    SELECT ticket_number, issue_datetime, street_num, street_dir, street_name, violation_desc
    FROM hearings
    WHERE street_num IS NOT NULL
      AND street_dir IS NOT NULL
      AND street_name IS NOT NULL
      AND issue_datetime LIKE '%/2024 %'
      AND violation_desc IS NOT NULL
    ORDER BY RANDOM()
    LIMIT ${SAMPLE_SIZE};
  `;
  const raw = execFileSync('sqlite3', ['-separator', '|', DB_PATH, sql], { encoding: 'utf-8' });
  const rows: SampleRow[] = raw.trim().split('\n').filter(Boolean).map(line => {
    const [ticket_number, issue_datetime, street_num, street_dir, street_name, violation_desc] = line.split('|');
    return { ticket_number, issue_datetime, street_num, street_dir, street_name, violation_desc };
  });

  console.log(`Sampling ${rows.length} parking tickets from 2024:\n`);

  let dotHits = 0;
  let treeHits = 0;
  let dotFailures = 0;
  let treeFailures = 0;

  const SIGN_DESCS = /STREET CLEAN|NO PARK|BUS STOP|BIKE|SNOW|NO STANDING|COMMERCIAL|RUSH HOUR|OVERNIGHT/;

  for (const r of rows) {
    const iso = foiaDateToIso(r.issue_datetime);
    const num = parseInt(r.street_num, 10);
    if (!iso || !Number.isFinite(num)) {
      console.log(`  ⊘ ${r.ticket_number}: bad parse`);
      continue;
    }
    const args = {
      streetNumber: num, streetDirection: r.street_dir, streetName: r.street_name, ticketIsoDate: iso,
    };
    const isSignBased = SIGN_DESCS.test(r.violation_desc);

    // DOT
    const dot = await findActiveDotPermits(args);
    let dotSummary = '';
    if (!dot) { dotFailures += 1; dotSummary = 'NETFAIL'; }
    else if (dot.activePermits.length > 0) {
      dotHits += 1;
      dotSummary = `DOT:${dot.activePermits.length} (closure=${dot.anyParkingClosure}, meter=${dot.anyMeterBagging})`;
    } else dotSummary = 'DOT:0';

    // Tree (sign-based only)
    let treeSummary = '';
    if (isSignBased) {
      const tree = await findTreeObstructionComplaints(args);
      if (!tree) { treeFailures += 1; treeSummary = 'TREE:NETFAIL'; }
      else if (tree.treeComplaints.length > 0) {
        treeHits += 1;
        const o = tree.treeComplaints.filter(c => c.openAtTicketTime).length;
        const c = tree.treeComplaints.filter(c => !c.openAtTicketTime).length;
        treeSummary = `TREE:${o} open + ${c} recent`;
      } else treeSummary = 'TREE:0';
    } else {
      treeSummary = 'TREE:N/A';
    }

    console.log(`  ${num} ${r.street_dir} ${r.street_name} (${iso}) [${r.violation_desc.slice(0, 25)}] ${dotSummary} | ${treeSummary}`);
  }

  console.log('');
  console.log(`DOT permits:        ${dotHits}/${rows.length} tickets hit, ${dotFailures} network failures`);
  const signBasedCount = rows.filter(r => SIGN_DESCS.test(r.violation_desc)).length;
  console.log(`311 tree (sign-based only): ${treeHits}/${signBasedCount} tickets hit, ${treeFailures} network failures`);

  if (dotFailures > 0 || treeFailures > 0) {
    console.error('\n✗ FAILED — network errors.');
    process.exit(1);
  }
  console.log('\n✓ PASSED — Tier 1 enrichments wired correctly and reachable.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
