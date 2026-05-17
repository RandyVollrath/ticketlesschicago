#!/usr/bin/env node
/**
 * Detection-correctness regression suite.
 *
 * Why this exists: 4 months of iOS parking/camera detection bugs followed
 * the same shape — each fix landed for one report, no test froze the
 * behavior, and a later fix broke an older one. This harness turns every
 * fixed bug into a permanent test case so we (1) document what the bug
 * looked like in the wire format, (2) verify a post-fix log shows the
 * fix signature, and (3) auto-scan every new debug report for known-bad
 * patterns.
 *
 * IMPORTANT: This is NOT a true unit-test of the Swift detection logic.
 * Until that logic is extracted into pure functions (plan item #2), we
 * can only assert against captured logs. A future fix that regresses
 * the May 16 bug will pass this suite — until a new debug report from
 * that user lands and gets scanned. The `scan` subcommand makes that
 * scan automatic.
 *
 * Usage:
 *   node scripts/run-detection-regressions.js               # self-check all fixtures (their captured NDJSON should match `self_check_against_input.expect`)
 *   node scripts/run-detection-regressions.js scan <path>   # scan a fresh ndjson against every fixture's regression_check
 *   node scripts/run-detection-regressions.js scan-report <audit-log-id>
 *       — fetch a debug report from Supabase (uses fetch-debug-report.js)
 *         and scan its NDJSON against every fixture.
 *   node scripts/run-detection-regressions.js scan-latest [--user <email>]
 *       — fetch the most recent report, scan it.
 *   node scripts/run-detection-regressions.js list          # list all fixtures
 *
 * Exit codes:
 *   0 — all checks passed (or in `self_check` mode, every fixture matched its expected pre-fix state)
 *   1 — at least one assertion failed (e.g., a scanned report shows a known bug recurring)
 *   2 — bad invocation / file not found
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const FIXTURES_DIR = path.resolve(
  __dirname,
  '..',
  'TicketlessChicagoMobile',
  'tests',
  'detection-fixtures'
);

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch (_) {
      // ignore unparseable lines
    }
  }
  return out;
}

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  const dirs = fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return dirs.map((name) => {
    const root = path.join(FIXTURES_DIR, name);
    const manifestPath = path.join(root, 'manifest.json');
    const ndjsonPath = path.join(root, 'parking_decisions.ndjson');
    if (!fs.existsSync(manifestPath)) {
      return { name, root, error: `missing manifest.json` };
    }
    if (!fs.existsSync(ndjsonPath)) {
      return { name, root, error: `missing parking_decisions.ndjson` };
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      return { name, root, error: `bad manifest.json: ${e.message}` };
    }
    return { name, root, manifest, ndjsonPath };
  });
}

/**
 * Match one trip_summary against a `trip_signature`. Each key in `sig`
 * must match the event. Suffix conventions:
 *   key_gt  — numeric, event[key] > sig[key_gt]
 *   key_gte — numeric, event[key] >= sig[key_gte]
 *   key_lt  — numeric, event[key] < sig[key_lt]
 *   key_lte — numeric, event[key] <= sig[key_lte]
 *   bare    — exact equality
 */
function matchSig(event, sig) {
  for (const [k, v] of Object.entries(sig)) {
    if (k.endsWith('_gt')) {
      const base = k.slice(0, -3);
      if (!(typeof event[base] === 'number' && event[base] > v)) return false;
    } else if (k.endsWith('_gte')) {
      const base = k.slice(0, -4);
      if (!(typeof event[base] === 'number' && event[base] >= v)) return false;
    } else if (k.endsWith('_lt')) {
      const base = k.slice(0, -3);
      if (!(typeof event[base] === 'number' && event[base] < v)) return false;
    } else if (k.endsWith('_lte')) {
      const base = k.slice(0, -4);
      if (!(typeof event[base] === 'number' && event[base] <= v)) return false;
    } else {
      if (event[k] !== v) return false;
    }
  }
  return true;
}

function findMatchingTrips(events, sig) {
  return events.filter((e) => matchSig(e, sig));
}

function hasAnyFixSignature(events, sigs) {
  return sigs.some((s) => events.some((e) => matchSig(e, s)));
}

/**
 * Check whether a trip's surrounding events contain forbidden state.
 * For trip_summary fields, we check the matched trip event itself.
 * (Future: take a windowed slice by tripId once that's tracked.)
 */
function checkForbidden(tripEvent, forbidden) {
  const violations = [];
  for (const [k, v] of Object.entries(forbidden)) {
    if (k.endsWith('_gt')) {
      const base = k.slice(0, -3);
      if (typeof tripEvent[base] === 'number' && tripEvent[base] > v) {
        violations.push(`${base}=${tripEvent[base]} > ${v}`);
      }
    } else if (k.endsWith('_gte')) {
      const base = k.slice(0, -4);
      if (typeof tripEvent[base] === 'number' && tripEvent[base] >= v) {
        violations.push(`${base}=${tripEvent[base]} >= ${v}`);
      }
    } else {
      if (tripEvent[k] === v) {
        violations.push(`${k}=${JSON.stringify(v)}`);
      }
    }
  }
  return violations;
}

/**
 * Run a fixture's regression check against a target ndjson.
 * Returns { ok: bool, message: string, details: object }
 *   ok=true means the bug is NOT recurring in the target.
 *   ok=false means the bug pattern was found and the fix signature is missing.
 */
function runRegressionCheck(fixture, targetEvents) {
  const rc = fixture.manifest.regression_check;
  if (!rc) {
    return { ok: true, message: 'no regression_check defined', details: {} };
  }

  const matches = findMatchingTrips(targetEvents, rc.trip_signature);
  if (matches.length === 0) {
    return { ok: true, message: 'no trips match this fixture\'s bug signature', details: { matches: 0 } };
  }

  const failures = [];
  for (const trip of matches) {
    const violations = checkForbidden(trip, rc.trip_must_not_have || {});
    const hasFix = hasAnyFixSignature(targetEvents, rc.fix_signature_any_of || []);
    if (violations.length > 0 && !hasFix) {
      failures.push({
        tripId: trip.tripId,
        violations,
        startSource: trip.startSource,
        durationSec: trip.durationSec,
        ts: trip.ts,
      });
    }
  }

  if (failures.length === 0) {
    return {
      ok: true,
      message: `${matches.length} matching trip(s) found, but either no forbidden outcomes OR fix signature present`,
      details: { matches: matches.length, failures: 0 },
    };
  }

  return {
    ok: false,
    message: `${failures.length} of ${matches.length} matching trip(s) show the bug pattern AND no fix signature`,
    details: { matches: matches.length, failures },
  };
}

function selfCheckFixture(fixture) {
  const events = readJsonl(fixture.ndjsonPath);
  const result = runRegressionCheck(fixture, events);
  const expectBug = fixture.manifest.self_check_against_input?.expect === 'bug_present';
  // In self-check mode against a fixture's own (pre-fix) NDJSON, we expect
  // `ok: false` (the bug should be present in the captured log). That documents
  // the bug in the suite. Inverted assertion:
  if (expectBug) {
    if (result.ok) {
      return {
        ok: false,
        message: `self_check expected bug_present but the regression check passed — the fixture's captured log doesn't actually show the bug it claims to. Fix the manifest's trip_signature or trip_must_not_have.`,
        details: result.details,
      };
    }
    const failCount = Array.isArray(result.details.failures) ? result.details.failures.length : (result.details.failures || 0);
    return {
      ok: true,
      message: `bug present in captured log as expected (${failCount} matching trip[s] with forbidden outcomes)`,
      details: result.details,
    };
  }
  // expect=bug_absent — captured log should be clean (post-fix recordings, future use)
  if (!result.ok) {
    return {
      ok: false,
      message: `self_check expected bug_absent but the bug pattern is present in the captured log: ${result.message}`,
      details: result.details,
    };
  }
  return { ok: true, message: 'no bug pattern in captured log', details: result.details };
}

function cmdSelfCheck(fixtures) {
  let allOk = true;
  console.log(`\nRunning self-check against ${fixtures.length} fixture(s)…\n`);
  for (const f of fixtures) {
    if (f.error) {
      console.log(`  ✗  ${f.name}: ${f.error}`);
      allOk = false;
      continue;
    }
    const r = selfCheckFixture(f);
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark}  ${f.name}: ${r.message}`);
    if (!r.ok) {
      allOk = false;
      if (r.details?.failures) {
        for (const fail of r.details.failures.slice(0, 3)) {
          console.log(`         tripId=${fail.tripId} startSource=${fail.startSource} dur=${Math.round(fail.durationSec || 0)}s violations=${fail.violations.join(', ')}`);
        }
      }
    }
  }
  console.log('');
  return allOk ? 0 : 1;
}

function cmdScan(fixtures, ndjsonPath, label) {
  if (!fs.existsSync(ndjsonPath)) {
    console.error(`File not found: ${ndjsonPath}`);
    return 2;
  }
  const events = readJsonl(ndjsonPath);
  console.log(`\nScanning ${label} (${events.length} events) against ${fixtures.length} fixture(s)…\n`);
  let regressions = 0;
  let allOk = true;
  for (const f of fixtures) {
    if (f.error) {
      console.log(`  -  ${f.name}: skipped (${f.error})`);
      continue;
    }
    const r = runRegressionCheck(f, events);
    if (!r.ok) {
      regressions += 1;
      allOk = false;
      console.log(`  ✗ REGRESSION ${f.name}: ${r.message}`);
      console.log(`       fix_commit was: ${f.manifest.fix_commit || '(unknown)'}`);
      console.log(`       summary: ${f.manifest.summary}`);
      for (const fail of r.details.failures.slice(0, 3)) {
        console.log(`       tripId=${fail.tripId} startSource=${fail.startSource} dur=${Math.round(fail.durationSec || 0)}s violations=${fail.violations.join(', ')}`);
      }
    } else {
      console.log(`  ✓  ${f.name}: ${r.message}`);
    }
  }
  console.log('');
  if (regressions > 0) {
    console.log(`FAIL: ${regressions} known bug(s) appear to be recurring in ${label}.`);
  } else {
    console.log(`PASS: no known bug patterns recurring in ${label}.`);
  }
  return allOk ? 0 : 1;
}

function cmdList(fixtures) {
  console.log(`\n${fixtures.length} fixture(s):\n`);
  for (const f of fixtures) {
    if (f.error) {
      console.log(`  ✗  ${f.name}  (${f.error})`);
      continue;
    }
    const m = f.manifest;
    console.log(`  • ${f.name}`);
    console.log(`      fix_commit: ${m.fix_commit || '(unknown)'}`);
    console.log(`      source: ${m.source_debug_report || '(unknown)'}`);
    console.log(`      summary: ${m.summary}`);
    console.log('');
  }
  return 0;
}

function fetchReportToTmp({ id, latest, userEmail }) {
  const fetcher = path.resolve(__dirname, 'fetch-debug-report.js');
  if (!fs.existsSync(fetcher)) {
    throw new Error('scripts/fetch-debug-report.js missing');
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-scan-'));
  const args = ['--out', tmpDir];
  if (id) { args.push('--id', id); }
  if (userEmail) { args.push('--user', userEmail); }
  const cmd = `node "${fetcher}" ${args.map((a) => `"${a}"`).join(' ')}`;
  execSync(cmd, { stdio: 'inherit' });
  // The fetcher writes into <out>/remote_<slug>/parking_decisions.ndjson
  const dirs = fs.readdirSync(tmpDir).filter((n) => n.startsWith('remote_'));
  if (dirs.length !== 1) {
    throw new Error(`expected one remote_* dir in ${tmpDir}, got ${dirs.length}`);
  }
  const ndjson = path.join(tmpDir, dirs[0], 'parking_decisions.ndjson');
  if (!fs.existsSync(ndjson)) {
    throw new Error(`fetcher did not produce parking_decisions.ndjson at ${ndjson}`);
  }
  return ndjson;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'self-check';
  const fixtures = loadFixtures();

  if (cmd === 'list') {
    return cmdList(fixtures);
  }
  if (cmd === 'self-check' || cmd === undefined) {
    return cmdSelfCheck(fixtures);
  }
  if (cmd === 'scan') {
    const file = argv[1];
    if (!file) {
      console.error('Usage: scan <path-to-parking_decisions.ndjson>');
      return 2;
    }
    return cmdScan(fixtures, file, file);
  }
  if (cmd === 'scan-report') {
    const id = argv[1];
    if (!id) {
      console.error('Usage: scan-report <audit-log-id>');
      return 2;
    }
    const file = fetchReportToTmp({ id });
    return cmdScan(fixtures, file, `report ${id}`);
  }
  if (cmd === 'scan-latest') {
    let userEmail;
    const i = argv.indexOf('--user');
    if (i >= 0) userEmail = argv[i + 1];
    const file = fetchReportToTmp({ latest: true, userEmail });
    return cmdScan(fixtures, file, `latest report${userEmail ? ` for ${userEmail}` : ''}`);
  }

  console.error(`Unknown command: ${cmd}`);
  console.error(`Run with no args for self-check, or: list | scan <path> | scan-report <id> | scan-latest [--user <email>]`);
  return 2;
}

process.exit(main());
