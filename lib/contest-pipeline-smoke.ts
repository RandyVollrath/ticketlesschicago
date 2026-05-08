/**
 * Contest pipeline smoke test.
 *
 * Runs as part of the daily admin digest to assert that key invariants of
 * the contest letter pipeline are still in place. Designed to be in-process
 * and side-effect-free — no DB writes, no Lob calls, no Resend calls. Each
 * check exercises a real production code path with synthetic inputs.
 *
 * Surface failures prominently in the admin email so a regression is caught
 * the next morning rather than the next time a real customer's letter
 * goes wrong.
 */

import crypto from 'crypto';
import { verifyLobSignature } from './lob-signature';
import { validateLetterContent } from './letter-quality-validator';
import { formatViolationDate } from './contest-letter-date';

export interface SmokeCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SmokeResult {
  passed: boolean;
  checks: SmokeCheck[];
  ranAt: string;
}

function pass(name: string, detail = ''): SmokeCheck {
  return { name, passed: true, detail };
}
function fail(name: string, detail: string): SmokeCheck {
  return { name, passed: false, detail };
}

function sign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function checkLobSignature(): SmokeCheck[] {
  const checks: SmokeCheck[] = [];
  const secret = process.env.LOB_WEBHOOK_SECRET;
  if (!secret) {
    checks.push(fail('Lob signature: secret configured', 'LOB_WEBHOOK_SECRET is not set'));
    return checks;
  }

  const body = JSON.stringify({ id: 'evt_smoke', event_type: { id: 'letter.in_transit' }, body: { id: 'ltr_smoke' } });
  const now = String(Math.floor(Date.now() / 1000));

  // Valid signature should pass.
  const validSig = sign(secret, now, body);
  checks.push(verifyLobSignature(body, validSig, now)
    ? pass('Lob signature: accepts valid HMAC')
    : fail('Lob signature: accepts valid HMAC', 'verifyLobSignature returned false for a freshly-signed payload'));

  // Wrong signature should be rejected.
  const wrongSig = sign(secret, now, body + 'tampered');
  checks.push(!verifyLobSignature(body, wrongSig, now)
    ? pass('Lob signature: rejects tampered payload')
    : fail('Lob signature: rejects tampered payload', 'verifyLobSignature accepted a HMAC of a different payload'));

  // Stale timestamp (>5min) should be rejected.
  const stale = String(Math.floor(Date.now() / 1000) - 600);
  const staleSig = sign(secret, stale, body);
  checks.push(!verifyLobSignature(body, staleSig, stale)
    ? pass('Lob signature: rejects stale timestamps (replay protection)')
    : fail('Lob signature: rejects stale timestamps', 'verifyLobSignature accepted a 10-minute-old signed payload'));

  // Missing signature should be rejected.
  checks.push(!verifyLobSignature(body, undefined, now)
    ? pass('Lob signature: rejects unsigned events')
    : fail('Lob signature: rejects unsigned events', 'verifyLobSignature returned true with no signature header'));

  return checks;
}

function checkLetterValidator(): SmokeCheck[] {
  const checks: SmokeCheck[] = [];

  // 1. Letter with an unfilled placeholder should fail validation.
  const badLetterPlaceholder = `Date: April 15, 2026

To whom it may concern,

I respectfully contest citation #ABC123 issued on April 15, 2026 at [LOCATION]. The cited violation is expired plates.

Sincerely,
Test User
City of Chicago Department of Finance`;
  const v1 = validateLetterContent(badLetterPlaceholder, {
    ticket_number: 'ABC123',
    violation_date: '2026-04-15',
  });
  checks.push(!v1.pass && v1.issues.some(i => /placeholder/i.test(i))
    ? pass('Letter validator: catches unfilled [LOCATION] placeholder')
    : fail('Letter validator: catches unfilled [LOCATION] placeholder',
        v1.pass ? 'validator returned pass=true on a letter containing [LOCATION]' : `placeholder issue not in: ${v1.issues.join('; ')}`));

  // 2. Letter with a date that disagrees with violation_date should fail.
  const badLetterDate = `Date: May 1, 2026

To whom it may concern,

RE: Citation ABC123

I respectfully contest citation #ABC123. Violation Date: April 14, 2026 at 100 N State St.

Sincerely,
Test User
City of Chicago Department of Finance`;
  const v2 = validateLetterContent(badLetterDate, {
    ticket_number: 'ABC123',
    violation_date: '2026-04-15',
  });
  checks.push(!v2.pass && v2.issues.some(i => /date mismatch/i.test(i))
    ? pass('Letter validator: catches off-by-one date drift (Apr 14 vs Apr 15)')
    : fail('Letter validator: catches off-by-one date drift',
        v2.pass ? 'validator passed a letter with the exact bug that hit Jesse Randall in May 2026' : `date issue not in: ${v2.issues.join('; ')}`));

  // 3. Clean letter should pass.
  const goodLetter = `Date: May 1, 2026

To whom it may concern,

RE: Citation ABC123

I respectfully contest citation #ABC123. Violation Date: April 15, 2026 at 100 N State St.

The cited violation should be dismissed because the photographic evidence does not establish the alleged violation.

Sincerely,
Test User
City of Chicago Department of Finance`;
  const v3 = validateLetterContent(goodLetter, {
    ticket_number: 'ABC123',
    violation_date: '2026-04-15',
  });
  checks.push(v3.pass
    ? pass('Letter validator: passes clean letter')
    : fail('Letter validator: passes clean letter', `unexpected issues: ${v3.issues.join('; ')}`));

  return checks;
}

function checkDateFormatter(): SmokeCheck[] {
  const checks: SmokeCheck[] = [];
  // The exact case that bit Jesse: the validator and the prompt MUST agree
  // that "2026-04-15" prints as "April 15, 2026" — never April 14.
  const out = formatViolationDate('2026-04-15');
  checks.push(out === 'April 15, 2026'
    ? pass('Date formatter: 2026-04-15 → "April 15, 2026" (UTC-anchored)')
    : fail('Date formatter: 2026-04-15 → "April 15, 2026" (UTC-anchored)',
        `got "${out}" — letter generator and validator will disagree, off-by-one bug is back`));

  // Edge: leap year boundary
  const leap = formatViolationDate('2024-02-29');
  checks.push(leap === 'February 29, 2024'
    ? pass('Date formatter: handles leap day correctly')
    : fail('Date formatter: handles leap day correctly', `got "${leap}"`));

  // Edge: empty / null
  const blank = formatViolationDate(null);
  checks.push(blank === 'Unknown date'
    ? pass('Date formatter: null safe')
    : fail('Date formatter: null safe', `got "${blank}"`));

  return checks;
}

export async function runContestPipelineSmokeTest(): Promise<SmokeResult> {
  const checks: SmokeCheck[] = [
    ...checkLobSignature(),
    ...checkLetterValidator(),
    ...checkDateFormatter(),
  ];

  return {
    passed: checks.every(c => c.passed),
    checks,
    ranAt: new Date().toISOString(),
  };
}

export function smokeResultAsHtml(result: SmokeResult): string {
  const passed = result.checks.filter(c => c.passed).length;
  const total = result.checks.length;
  const banner = result.passed
    ? `<div style="margin-top: 24px; padding: 14px 16px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px;">
         <p style="margin: 0; font-size: 14px; color: #166534;">
           <strong>&#10003; Contest Pipeline Smoke Test — PASSED (${passed}/${total})</strong>
         </p>
       </div>`
    : `<div style="margin-top: 24px; padding: 14px 16px; background: #fef2f2; border: 2px solid #f87171; border-radius: 8px;">
         <p style="margin: 0 0 8px 0; font-size: 14px; color: #991b1b;">
           <strong>&#10007; Contest Pipeline Smoke Test — FAILED (${passed}/${total})</strong>
         </p>
         <p style="margin: 0; font-size: 13px; color: #991b1b;">
           A core invariant of the contest letter pipeline is broken. Investigate before the next mailer cron run.
         </p>
       </div>`;

  const rows = result.checks.map(c => {
    const icon = c.passed ? '<span style="color: #16a34a;">&#10003;</span>' : '<span style="color: #dc2626;">&#10007;</span>';
    const detail = c.passed
      ? ''
      : `<div style="font-size: 12px; color: #991b1b; margin-left: 22px;">${escapeHtml(c.detail)}</div>`;
    return `<li style="margin: 6px 0; font-size: 13px;">${icon} ${escapeHtml(c.name)}${detail}</li>`;
  }).join('');

  return `${banner}
    <ul style="margin: 12px 0 0 0; padding: 0; list-style: none; color: #374151;">
      ${rows}
    </ul>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
