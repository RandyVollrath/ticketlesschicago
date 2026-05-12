/**
 * Smoke test for lib/contest-deadlines.ts.
 *
 * Run: npx tsx scripts/smoke-test-contest-deadlines.ts
 * Exits 0 on pass, 1 on any failure. CLAUDE.md ship rule: this is what we'd run
 * before claiming the deadline rewrite is "done."
 */

import { computeContestDeadlines } from '../lib/contest-deadlines';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

console.log('Smoke: contest-deadlines\n');

// ── Case 1: ON, fresh ticket. Expect 3 days after detection. ────────────────
{
  const issue = new Date('2026-05-10T15:00:00-05:00');
  const detected = new Date('2026-05-12T10:00:00-05:00');
  const r = computeContestDeadlines(issue, detected, true);
  const delta = daysBetween(detected, r.evidenceDeadline);
  console.log(`Case 1 — ON, fresh: issue=${isoDate(issue)} detected=${isoDate(detected)} deadline=${isoDate(r.evidenceDeadline)} Δ=${delta}d`);
  check('ON gives ~3 days from detection', delta >= 2 && delta <= 4, `got ${delta} days`);
  check('evidenceDeadline === autoSendDeadline', r.evidenceDeadline.getTime() === r.autoSendDeadline.getTime());
  check('not clamped', r.clampedToContestDeadline === false);
}

// ── Case 2: OFF, fresh ticket. Expect Day 17 from issue. ────────────────────
{
  const issue = new Date('2026-05-10T15:00:00-05:00');
  const detected = new Date('2026-05-12T10:00:00-05:00');
  const r = computeContestDeadlines(issue, detected, false);
  const deltaFromIssue = daysBetween(new Date(issue.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })), r.evidenceDeadline);
  console.log(`Case 2 — OFF, fresh: issue=${isoDate(issue)} detected=${isoDate(detected)} deadline=${isoDate(r.evidenceDeadline)} Δ from issue=${deltaFromIssue}d`);
  check('OFF gives Day 17 from issue', deltaFromIssue === 17, `got ${deltaFromIssue} days`);
  check('contestDeadline is Day 21 from issue', daysBetween(new Date(issue.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })), r.contestDeadline) === 21);
}

// ── Case 3: ON, OLD ticket (detected on Day 19). Should clamp to Day 21. ───
{
  const issue = new Date('2026-04-23T15:00:00-05:00'); // 19 days before "today"
  const detected = new Date('2026-05-12T10:00:00-05:00');
  const r = computeContestDeadlines(issue, detected, true);
  const deltaFromIssue = daysBetween(new Date(issue.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })), r.evidenceDeadline);
  console.log(`Case 3 — ON, old: issue=${isoDate(issue)} detected=${isoDate(detected)} deadline=${isoDate(r.evidenceDeadline)} clamped=${r.clampedToContestDeadline}`);
  check('clamped to 21-day hard deadline', r.clampedToContestDeadline === true);
  check('deadline is exactly Day 21 from issue', deltaFromIssue === 21, `got ${deltaFromIssue} days`);
}

// ── Case 4: OFF, very old ticket (Day 17 already passed). 48h-from-now floor,
//   but the 21-day hard deadline still trumps it.
{
  const issue = new Date('2026-04-23T15:00:00-05:00'); // 19 days ago
  const detected = new Date('2026-05-12T10:00:00-05:00');
  const r = computeContestDeadlines(issue, detected, false);
  const hoursFromDetected = (r.evidenceDeadline.getTime() - detected.getTime()) / (60 * 60 * 1000);
  console.log(`Case 4 — OFF, old: deadline=${r.evidenceDeadline.toISOString()} hours from detected=${hoursFromDetected.toFixed(1)}h clamped=${r.clampedToContestDeadline}`);
  check('48h floor OR clamped to 21-day deadline', hoursFromDetected >= 47.9 || r.clampedToContestDeadline);
  check('at least some future time', hoursFromDetected > 0);
}

// ── Case 4b: OFF, moderately stale ticket (Day 10), still within window. ───
{
  const issue = new Date('2026-05-02T15:00:00-05:00'); // 10 days ago
  const detected = new Date('2026-05-12T10:00:00-05:00');
  const r = computeContestDeadlines(issue, detected, false);
  const hoursFromDetected = (r.evidenceDeadline.getTime() - detected.getTime()) / (60 * 60 * 1000);
  console.log(`Case 4b — OFF, Day 10: deadline=${r.evidenceDeadline.toISOString()} hours from detected=${hoursFromDetected.toFixed(1)}h clamped=${r.clampedToContestDeadline}`);
  check('Day 17 target still in the future when issue=Day 10', hoursFromDetected >= 47.9, `got ${hoursFromDetected.toFixed(1)}h`);
}

// ── Case 5: ON, no issue date. Falls back to 3 days from detection. ────────
{
  const detected = new Date('2026-05-12T10:00:00-05:00');
  const r = computeContestDeadlines(null, detected, true);
  const delta = daysBetween(detected, r.evidenceDeadline);
  console.log(`Case 5 — ON, no issue: deadline=${isoDate(r.evidenceDeadline)} Δ=${delta}d clamped=${r.clampedToContestDeadline}`);
  // contestDeadline falls back to detected + 14d when no issue date; 3 < 14 so no clamp expected
  check('falls back to ~3 days', delta >= 2 && delta <= 4);
  check('no clamp when issue date unknown and target < 14d', r.clampedToContestDeadline === false);
}

// ── Case 6: defaults — null/undefined fast_contest_submission = ON. ────────
{
  const issue = new Date('2026-05-10T15:00:00-05:00');
  const detected = new Date('2026-05-12T10:00:00-05:00');
  const rNull = computeContestDeadlines(issue, detected, null);
  const rUndef = computeContestDeadlines(issue, detected, undefined);
  const rTrue = computeContestDeadlines(issue, detected, true);
  check('null defaults to ON', rNull.evidenceDeadline.getTime() === rTrue.evidenceDeadline.getTime());
  check('undefined defaults to ON', rUndef.evidenceDeadline.getTime() === rTrue.evidenceDeadline.getTime());
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
