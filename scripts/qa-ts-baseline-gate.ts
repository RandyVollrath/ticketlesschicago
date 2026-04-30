#!/usr/bin/env npx tsx
/**
 * TypeScript baseline gate (QA_REPORT.md net #4).
 *
 * Ratchet-down mode: blocks deploy when the number of `tsc --noEmit` errors
 * goes UP from a locked-in baseline. Lets us stop new errors from sneaking
 * in without requiring a full multi-day cleanup first.
 *
 * The baseline is stored in scripts/ts-baseline.json. Update it when:
 *   - A batch of errors gets fixed → ratchet the baseline DOWN.
 *   - A schema regen / SDK upgrade legitimately introduces errors → after
 *     reviewing each one, run with --update to bump the baseline UP.
 *
 * Goal is monotone-down. Every PR that lands should leave the baseline at
 * or below where it started.
 *
 * Usage:
 *   npx tsx scripts/qa-ts-baseline-gate.ts          → check
 *   npx tsx scripts/qa-ts-baseline-gate.ts --update → write current count to baseline
 *
 * Wire into npm run deploy and CI.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const BASELINE_PATH = resolve(__dirname, 'ts-baseline.json');

interface Baseline {
  errorCount: number;
  capturedAt: string;
  notes?: string;
}

function readBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeBaseline(count: number, notes?: string): void {
  const data: Baseline = {
    errorCount: count,
    capturedAt: new Date().toISOString(),
    ...(notes ? { notes } : {}),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + '\n');
}

function countErrors(): { count: number; sample: string[] } {
  let raw = '';
  try {
    raw = execSync('npx tsc --noEmit 2>&1', { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err: any) {
    // tsc exits non-zero when there are errors. Capture stdout anyway.
    raw = err.stdout?.toString() || '';
  }
  const errorLines = raw.split('\n').filter(line => /error TS\d+:/.test(line));
  return {
    count: errorLines.length,
    sample: errorLines.slice(0, 5),
  };
}

const updateMode = process.argv.includes('--update');

console.log('→ TypeScript baseline gate');
const { count: actual, sample } = countErrors();
console.log(`  Current errors: ${actual}`);

if (updateMode) {
  const previous = readBaseline();
  writeBaseline(actual, process.argv[process.argv.indexOf('--update') + 1] || undefined);
  if (previous) {
    const delta = actual - previous.errorCount;
    if (delta < 0) {
      console.log(`  ✓ Baseline ratcheted DOWN ${previous.errorCount} → ${actual} (${delta})`);
    } else if (delta > 0) {
      console.log(`  ⚠ Baseline raised ${previous.errorCount} → ${actual} (+${delta}). Make sure each new error was deliberately accepted.`);
    } else {
      console.log(`  Baseline unchanged at ${actual}.`);
    }
  } else {
    console.log(`  Initial baseline written: ${actual}`);
  }
  process.exit(0);
}

const baseline = readBaseline();
if (!baseline) {
  console.log(`  No baseline file found at ${BASELINE_PATH}.`);
  console.log(`  Run with --update to capture the initial baseline.`);
  process.exit(0);
}

console.log(`  Baseline:       ${baseline.errorCount} (captured ${baseline.capturedAt})`);

if (actual <= baseline.errorCount) {
  if (actual < baseline.errorCount) {
    console.log(`  ✓ ${baseline.errorCount - actual} fewer errors than baseline. Run with --update to ratchet down.`);
  } else {
    console.log('  ✓ At baseline.');
  }
  process.exit(0);
}

const delta = actual - baseline.errorCount;
console.log(`  ✗ ${delta} NEW TypeScript error${delta === 1 ? '' : 's'} introduced.`);
console.log(`  Sample of current errors:`);
for (const line of sample) {
  console.log(`    ${line.slice(0, 200)}`);
}
console.log('');
console.log('  Either fix the new errors, or — if a schema regen / SDK upgrade legitimately');
console.log('  introduced them and you reviewed each one — run:');
console.log('    npx tsx scripts/qa-ts-baseline-gate.ts --update "reason"');
console.log('  to raise the baseline.');
process.exit(1);
