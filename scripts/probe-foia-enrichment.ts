#!/usr/bin/env npx tsx
// Smoke-probe FOIA enrichment with a known-real ticket number from foia.db.
// Confirms address + officer come back, plus officer & block stats.
import { enrichTicketFromFoia, getIssuingOfficerStats, getBlockStats } from '../lib/contest-review/foia-enrichment';

// Pick the first 5 ticket numbers from foia.db tickets table for varied types.
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
const DB = process.env.FOIA_DB || resolve(homedir(), 'Documents/FOIA/foia.db');

const sql =
  ".mode tabs\n" +
  `SELECT ticket_number FROM tickets
   WHERE violation_desc IN ('STREET CLEANING','NO CITY STICKER VEH UNDER/EQUAL 16,000 LBS.','EXP. METER NON-CENTRAL BUSINESS DIS','EXPIRED PLATES OR TEMP REGISTRATION','RESIDENTIAL PERMIT PARKING')
   AND issue_datetime > '01/01/2024'
   LIMIT 5;`;
const out = execFileSync('sqlite3', [DB], { input: sql, encoding: 'utf-8' });
const nums = out.trim().split('\n').filter(Boolean);
console.log(`Probing ${nums.length} ticket numbers from FOIA…\n`);

for (const tn of nums) {
  const t = enrichTicketFromFoia(tn);
  if (!t) { console.log(`  ${tn}: NOT FOUND`); continue; }
  console.log(`#${tn}  ${t.violationDesc}`);
  console.log(`   addr=${t.fullAddress}  zip=${t.zipcode}  officer=${t.officer}  unit=${t.unit}`);

  const stats = t.officer ? getIssuingOfficerStats(t.officer, t.violationDesc) : null;
  if (stats) {
    console.log(`   officer history: ${stats.notLiable}/${stats.totalContested} dismissed (${(stats.dismissalRate * 100).toFixed(1)}%) overall; ${stats.sameTypeNotLiable}/${stats.sameTypeContested} for same type (${(stats.sameTypeDismissalRate * 100).toFixed(1)}%)`);
  } else {
    console.log('   officer history: (none)');
  }

  const block = getBlockStats(t);
  if (block) {
    console.log(`   block ${block.blockLabel}: ${block.notLiableAtBlock}/${block.ticketsAtBlock} dismissed for this type (${(block.dismissalRateAtBlock * 100).toFixed(1)}%)`);
  }
  console.log();
}
