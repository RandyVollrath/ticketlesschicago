/**
 * Placeholder-guard smoke test.
 *
 * Wired into the QA pipeline (`.github/workflows/qa-pipeline.yml`) and
 * `npm run gate:letter-placeholders`. Runs in CI on every push that touches
 * letter generation.
 *
 * The fixtures below are real failure modes — not invented. Jesse Randall's
 * `kit_general_contest` letter shipped with `• [Your contest grounds]` in
 * the body and was about to be mailed by the auto-send cron. This test exists
 * to prove the validator catches that exact string and similar known leaks.
 */

import { findUnfilledPlaceholders, isLetterMailable } from '../lib/contest-letter-validator';

interface Case {
  name: string;
  text: string;
  expectMailable: boolean;
  expectContains?: string[]; // placeholders we expect to find when not mailable
}

const CASES: Case[] = [
  {
    name: 'Jesse Randall — real leaked expired-plates letter (must FAIL)',
    text: `I respectfully contest citation #9205513401.

I believe this citation was issued in error because:
• [Your contest grounds]

I request a hearing.`,
    expectMailable: false,
    expectContains: ['[Your contest grounds]'],
  },
  {
    name: 'ALL_CAPS placeholder leak (must FAIL)',
    text: `Dear City of Chicago,

I respectfully contest [TICKET_NUMBER] issued at [LOCATION].
My address: [YOUR ADDRESS].`,
    expectMailable: false,
    expectContains: ['[TICKET_NUMBER]', '[LOCATION]', '[YOUR ADDRESS]'],
  },
  {
    name: 'Multiple "Your X" instructions (must FAIL)',
    text: `Sincerely,
[Your name]
[Your address]
[Your phone]`,
    expectMailable: false,
  },
  {
    name: 'Bracketed legal citation — NOT a placeholder (must PASS)',
    text: `Under Chicago Municipal Code § 9-100-060 and 625 ILCS 5/3-413, I assert all defenses.

Sincerely,
Jesse Randall`,
    expectMailable: true,
  },
  {
    name: 'Real Jesse weather-defense letter, fully filled (must PASS)',
    text: `May 2, 2026

Jesse Randall
918 W Winona
Chicago, IL 60640

RE: Contest of Parking Ticket 9205513400
License Plate: EA42467 (IL)

I respectfully contest this citation based on weather conditions on April 15, 2026.
Heavy rain (1.13 inches) occurred. The City typically suspends street cleaning.

I would also note that 34.2% of decided STREET CLEANING contests resulted in Not Liable.

Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses.

Sincerely,
Jesse Randall
918 W Winona
Chicago, IL 60640`,
    expectMailable: true,
  },
  {
    name: 'TODO placeholder (must FAIL)',
    text: `1. Provide the City offered no proof of [TBD].\n2. Therefore, [FIXME].`,
    expectMailable: false,
  },
  {
    name: 'Empty letter (must PASS — empty is "no placeholders found")',
    text: ``,
    expectMailable: true,
  },
];

let failed = 0;
for (const tc of CASES) {
  const result = isLetterMailable(tc.text);
  const actuallyMailable = result.ok;
  if (actuallyMailable !== tc.expectMailable) {
    failed++;
    console.error(`FAIL: ${tc.name}`);
    console.error(`  expected mailable=${tc.expectMailable}, got mailable=${actuallyMailable}`);
    if (!result.ok) {
      console.error(`  findings: ${result.findings.map(f => f.placeholder).join(', ')}`);
    }
    continue;
  }
  // If we expected specific placeholders, check them
  if (tc.expectContains && !result.ok) {
    const foundSet = new Set(result.findings.map(f => f.placeholder));
    const missing = tc.expectContains.filter(p => !foundSet.has(p));
    if (missing.length) {
      failed++;
      console.error(`FAIL: ${tc.name}`);
      console.error(`  validator missed expected placeholders: ${missing.join(', ')}`);
      console.error(`  validator found: ${[...foundSet].join(', ')}`);
      continue;
    }
  }
  console.log(`PASS: ${tc.name}`);
}

if (failed > 0) {
  console.error(`\n${failed} placeholder-guard fixture(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${CASES.length} placeholder-guard fixtures passed.`);
process.exit(0);
