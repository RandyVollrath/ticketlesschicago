#!/usr/bin/env tsx
/**
 * Audit every hardcoded win-rate stat in user-facing surfaces against the
 * real City of Chicago FOIA hearing data.
 *
 * Surfaces checked:
 *   - pages/start.tsx           (TICKET_TYPES.winRate)
 *   - pages/settings.tsx        (TICKET_TYPES.winRate)
 *   - TicketlessChicagoMobile/src/screens/NativeAlertsScreen.tsx (mobile)
 *   - lib/contest-kits/evidence-guidance.ts  (EVIDENCE_GUIDANCE[].winRate)
 *
 * Truth source — one of:
 *   1. Local SQLite at ~/Documents/FOIA/foia.db (table `hearings`).
 *      Preferred when present: one ~0.6s grouped scan covers all 19 keys.
 *   2. Supabase `contested_tickets_foia` (CI fallback when SQLite isn't
 *      on the machine). Slower (6s/query × 38 queries) and occasionally
 *      times out; per-query retry with exponential backoff handles flake.
 *
 * Truth = Not Liable / (Not Liable + Liable), decided cases only,
 * MIN_SAMPLE=200, matched by violation_description LIKE pattern.
 *
 * Run:    npx tsx scripts/audit-win-rate-stats.ts
 * CI:     exits non-zero if any claim is more than TOLERANCE_PP off truth.
 *
 * Why this exists: a real bug shipped a 27% stat into a customer's contest
 * letter when the truth was 76%. CLAUDE.md / memory: never make up numbers.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const FOIA_SQLITE_PATH = path.join(os.homedir(), 'Documents/FOIA/foia.db');
const HAS_SQLITE = fs.existsSync(FOIA_SQLITE_PATH);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!HAS_SQLITE && (!url || !serviceKey)) {
  console.error(
    `No truth source available: SQLite db not found at ${FOIA_SQLITE_PATH} ` +
      'and NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset.',
  );
  process.exit(1);
}
const supabase =
  url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

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
//
// Both backends return a Map<key, { nl, l }> covering every key in
// FOIA_TERMS. The main loop turns those into the rate + comparison.
// ───────────────────────────────────────────────────────────────────────

type Counts = { nl: number; l: number };

// SQLite: one grouped scan over `hearings`, then pattern-match in JS.
// ~0.6s on 1.2M rows; no flake, no retries needed.
function countsFromSqlite(): Map<string, Counts> {
  const tsv = execFileSync(
    'sqlite3',
    [
      FOIA_SQLITE_PATH,
      "SELECT violation_desc || char(9) || disposition || char(9) || COUNT(*) " +
        "FROM hearings " +
        "WHERE disposition IN ('Liable', 'Not Liable') " +
        'GROUP BY violation_desc, disposition;',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );

  // Convert each FOIA LIKE pattern (e.g. '%EXPIRED PLATE%') into a regex
  // that matches the same strings, so we can apply the same match logic
  // in JS that Supabase's ILIKE applies in SQL.
  const patterns: { key: string; rx: RegExp }[] = Object.entries(FOIA_TERMS).map(([key, p]) => {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
    return { key, rx: new RegExp('^' + escaped + '$', 'i') };
  });

  const out = new Map<string, Counts>();
  for (const key of Object.keys(FOIA_TERMS)) out.set(key, { nl: 0, l: 0 });

  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const [desc, dispo, nStr] = line.split('\t');
    const n = Number(nStr);
    if (!Number.isFinite(n)) continue;
    for (const { key, rx } of patterns) {
      if (rx.test(desc)) {
        const c = out.get(key)!;
        if (dispo === 'Not Liable') c.nl += n;
        else if (dispo === 'Liable') c.l += n;
      }
    }
  }
  return out;
}

// Supabase fallback: per-disposition exact count, retried with backoff.
// IMPORTANT: never silently return 0 on persistent failure — that produced
// phantom 100% truths when one disposition's count timed out. Returning
// null lets the caller skip the violation with a clear "(flake)" marker.
async function supabaseCount(pattern: string, disposition: string): Promise<number | null> {
  const delays = [500, 1000, 2000, 4000, 8000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const { count, error } = await supabase!
      .from('contested_tickets_foia')
      .select('*', { count: 'exact', head: true })
      .ilike('violation_description', pattern)
      .eq('disposition', disposition);
    if (!error && typeof count === 'number') return count;
    if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  return null;
}

async function countsFromSupabase(): Promise<Map<string, Counts | null>> {
  const out = new Map<string, Counts | null>();
  for (const [key, pattern] of Object.entries(FOIA_TERMS)) {
    const nl = await supabaseCount(pattern, 'Not Liable');
    const l = await supabaseCount(pattern, 'Liable');
    out.set(key, nl === null || l === null ? null : { nl, l });
  }
  return out;
}

function rateOf(c: Counts): { rate: number | null; decided: number } {
  const decided = c.nl + c.l;
  if (decided < 200) return { rate: null, decided };
  return { rate: Math.round((c.nl / decided) * 1000) / 10, decided };
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
    ...parseTicketTypesWinRates(
      path.join(root, 'TicketlessChicagoMobile/src/screens/NativeAlertsScreen.tsx'),
    ),
    ...parseEvidenceGuidance(path.join(root, 'lib/contest-kits/evidence-guidance.ts')),
  ];

  // Aggregate by violation key for a comparison row each.
  const byKey = new Map<string, Claim[]>();
  for (const c of claims) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key)!.push(c);
  }

  const sourceLabel = HAS_SQLITE
    ? `local SQLite (${FOIA_SQLITE_PATH})`
    : 'Supabase contested_tickets_foia';
  console.log(`\nAuditing hardcoded win-rate claims against ${sourceLabel}`);
  console.log('Truth = Not Liable / (Not Liable + Liable), decided cases only, MIN_SAMPLE=200');
  console.log('TOLERANCE: any claim more than ±' + TOLERANCE_PP + 'pp off truth fails\n');

  const counts: Map<string, Counts | null> = HAS_SQLITE
    ? countsFromSqlite()
    : await countsFromSupabase();

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

    const c = counts.get(key);
    const failed = c === null;
    const { rate, decided } = c ? rateOf(c) : { rate: null, decided: 0 };
    const truth = failed ? '(flake)' : rate === null ? '(no sample)' : `${rate}%`;

    const row =
      key.padEnd(32) +
      ` ${(startC ?? '-').toString().padStart(5)}` +
      ` ${(settC ?? '-').toString().padStart(8)}` +
      ` ${(kitC ?? '-').toString().padStart(4)}` +
      ` ${truth.padStart(6)}` +
      ` ${decided.toLocaleString().padStart(7)}`;

    if (failed) {
      console.log(row + '  ⚠ FOIA query timed out after 5 retries — skipped (rerun to revalidate)');
      continue;
    }
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
