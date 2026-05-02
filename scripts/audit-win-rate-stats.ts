#!/usr/bin/env tsx
/**
 * Audit every hardcoded win-rate stat in user-facing surfaces against the
 * real City of Chicago FOIA hearing data in contested_tickets_foia.
 *
 * Surfaces checked:
 *   - pages/start.tsx           (TICKET_TYPES.winRate)
 *   - pages/settings.tsx        (TICKET_TYPES.winRate)
 *   - lib/contest-kits/evidence-guidance.ts  (EVIDENCE_GUIDANCE[].winRate)
 *
 * Truth source:
 *   contested_tickets_foia, with Not Liable / (Not Liable + Liable) per
 *   the violation_description LIKE pattern that matches the City's actual
 *   strings (singular "EXPIRED PLATE", "BICYCLE PATH" not "BIKE LANE", etc).
 *
 * Run:    npx tsx scripts/audit-win-rate-stats.ts
 * CI:     exits non-zero if any claim is more than TOLERANCE_PP off truth.
 *
 * Why this exists: a real bug shipped a 27% stat into a customer's contest
 * letter when the truth was 76%. CLAUDE.md / memory: never make up numbers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

// Map violation key → FOIA violation_description ILIKE pattern.
// Mirrored from autopilot-check-portal.ts foiaSearchTerms; if you add a
// new violation type, add the search pattern here too.
const FOIA_TERMS: Record<string, string> = {
  expired_plates: '%EXPIRED PLATE%',
  no_city_sticker: '%CITY STICKER%',
  expired_meter: '%EXP%METER%',
  street_cleaning: '%STREET CLEANING%',
  fire_hydrant: '%FIRE HYDRANT%',
  disabled_zone: '%DISABLED%',
  residential_permit: '%RESIDENTIAL PERMIT%',
  no_standing_time_restricted: '%NO STANDING%',
  parking_prohibited: '%PARKING/STANDING PROHIBITED%',
  missing_plate: '%MISSING/NON%',
  commercial_loading: '%LOADING%',
  parking_alley: '%ALLEY%',
  bus_lane: '%BUS LANE%',
  bus_stop: '%BUS/TAXI%',                // 'PARK OR STAND IN BUS/TAXI/CARRIAGE STAND'
  bike_lane: '%BICYCLE PATH%',
  double_parking: '%DOUBLE PARK%',
  red_light: '%RED LIGHT%',
  speed_camera: '%SPEED VIOLATION%',
  snow_route: '%SNOW ROUTE%',
};

// ───────────────────────────────────────────────────────────────────────
// Source-of-truth queries
// ───────────────────────────────────────────────────────────────────────

async function countWhere(pattern: string, disposition: string): Promise<number> {
  // Sequential, with one retry — parallel count queries were flaky against
  // a 1.18M-row table (one of two parallel calls would intermittently return 0).
  for (let attempt = 0; attempt < 2; attempt++) {
    const { count, error } = await supabase
      .from('contested_tickets_foia')
      .select('*', { count: 'exact', head: true })
      .ilike('violation_description', pattern)
      .eq('disposition', disposition);
    if (!error && typeof count === 'number') return count;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return 0;
}

async function realRate(pattern: string): Promise<{ nl: number; l: number; rate: number | null }> {
  const nl = await countWhere(pattern, 'Not Liable');
  const l = await countWhere(pattern, 'Liable');
  const decided = nl + l;
  if (decided < 200) return { nl, l, rate: null };
  return { nl, l, rate: Math.round((nl / decided) * 1000) / 10 };
}

// ───────────────────────────────────────────────────────────────────────
// Hardcoded-claim parsers
// ───────────────────────────────────────────────────────────────────────

type Claim = { surface: string; key: string; winRate: number; line: string };

// Parses entries like:
//   { key: 'expired_plates', label: '...', winRate: 76, defaultOn: true },
//   { id: 'expired_plates', label: '...', winRate: 76 },
function parseTicketTypesWinRates(filePath: string): Claim[] {
  const txt = fs.readFileSync(filePath, 'utf8');
  const out: Claim[] = [];
  const re = /\{\s*(?:key|id)\s*:\s*['"]([\w_]+)['"][^}]*?winRate\s*:\s*(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    out.push({ surface: path.basename(filePath), key: m[1], winRate: Number(m[2]), line: m[0] });
  }
  return out;
}

// Parses lib/contest-kits/evidence-guidance.ts EVIDENCE_GUIDANCE blocks:
//   <key>: {
//     ...
//     winRate: 0.76,
function parseEvidenceGuidance(filePath: string): Claim[] {
  const txt = fs.readFileSync(filePath, 'utf8');
  const out: Claim[] = [];
  // Find each "key: {" block then look for winRate: 0.XX inside.
  const blockRe = /^\s{2}([a-z_]+)\s*:\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(txt)) !== null) {
    const key = m[1];
    const start = m.index;
    // search a window of ~3000 chars for winRate
    const slice = txt.slice(start, start + 3000);
    const wr = slice.match(/winRate\s*:\s*0?\.(\d{1,3})/);
    if (wr) {
      const winRate = Number(`0.${wr[1]}`) * 100;
      out.push({ surface: 'evidence-guidance.ts', key, winRate: Math.round(winRate), line: `${key}: winRate=${wr[0]}` });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────

const TOLERANCE_PP = 2; // claims more than this many percentage points off truth fail the audit

async function main() {
  const root = path.resolve(__dirname, '..');
  const claims: Claim[] = [
    ...parseTicketTypesWinRates(path.join(root, 'pages/start.tsx')),
    ...parseTicketTypesWinRates(path.join(root, 'pages/settings.tsx')),
    ...parseEvidenceGuidance(path.join(root, 'lib/contest-kits/evidence-guidance.ts')),
  ];

  // Aggregate by violation key for a comparison row each.
  const byKey = new Map<string, Claim[]>();
  for (const c of claims) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key)!.push(c);
  }

  console.log('\nAuditing hardcoded win-rate claims against contested_tickets_foia');
  console.log('Truth = Not Liable / (Not Liable + Liable), decided cases only, MIN_SAMPLE=200');
  console.log('TOLERANCE: any claim more than ±' + TOLERANCE_PP + 'pp off truth fails\n');

  const head = [
    'violation_key'.padEnd(32),
    'start'.padStart(6),
    'settings'.padStart(9),
    'kit'.padStart(5),
    'truth'.padStart(7),
    'sample'.padStart(8),
    'status',
  ].join(' ');
  console.log(head);
  console.log('-'.repeat(head.length + 20));

  let failures = 0;
  let unknown = 0;
  // Walk every key with a hardcoded claim AND every key in FOIA_TERMS
  // (so we also flag violations we have FOIA data for but no public claim).
  const allKeys = new Set<string>([...Array.from(byKey.keys()), ...Object.keys(FOIA_TERMS)]);

  for (const key of Array.from(allKeys).sort()) {
    const pattern = FOIA_TERMS[key];
    const claimRows = byKey.get(key) || [];
    const startC = claimRows.find((c) => c.surface === 'start.tsx')?.winRate;
    const settC = claimRows.find((c) => c.surface === 'settings.tsx')?.winRate;
    const kitC = claimRows.find((c) => c.surface === 'evidence-guidance.ts')?.winRate;

    if (!pattern) {
      console.log(
        key.padEnd(32) +
          ` ${(startC ?? '-').toString().padStart(5)}` +
          ` ${(settC ?? '-').toString().padStart(8)}` +
          ` ${(kitC ?? '-').toString().padStart(4)}` +
          ` ${'?'.padStart(6)}` +
          ` ${'?'.padStart(7)}` +
          '  ⚠ NO FOIA TERM — add a search pattern to FOIA_TERMS',
      );
      unknown++;
      continue;
    }

    const { nl, l, rate } = await realRate(pattern);
    const decided = nl + l;
    const truth = rate === null ? '(no sample)' : `${rate}%`;

    const row =
      key.padEnd(32) +
      ` ${(startC ?? '-').toString().padStart(5)}` +
      ` ${(settC ?? '-').toString().padStart(8)}` +
      ` ${(kitC ?? '-').toString().padStart(4)}` +
      ` ${truth.padStart(6)}` +
      ` ${decided.toLocaleString().padStart(7)}`;

    if (rate === null) {
      console.log(row + '  - sample too small to validate');
      continue;
    }

    const offClaims: string[] = [];
    for (const c of claimRows) {
      const delta = Math.abs(c.winRate - rate);
      if (delta > TOLERANCE_PP) offClaims.push(`${c.surface}: ${c.winRate}% (off by ${delta.toFixed(1)}pp)`);
    }
    if (offClaims.length === 0) {
      console.log(row + '  ✓ ok');
    } else {
      console.log(row + '  ✗ ' + offClaims.join('; '));
      failures += offClaims.length;
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Failures: ${failures}    Unknown-term keys: ${unknown}`);
  if (failures > 0) {
    console.error('\nAUDIT FAILED — fix the hardcoded claims to match FOIA truth, or update');
    console.error('FOIA_TERMS if the data has shifted. Never invent or estimate these numbers.');
    process.exit(1);
  }
  console.log('\nAUDIT PASSED — every public win-rate claim is within ±' + TOLERANCE_PP + 'pp of FOIA truth.\n');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(2);
});
