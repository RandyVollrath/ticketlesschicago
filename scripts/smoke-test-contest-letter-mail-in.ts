/**
 * Smoke test: contest letter mail-in framing
 *
 * Three checks:
 *   1. Regex validation catches 9 in-person hearing phrases (synthetic).
 *   2. Regex validation passes a clean mail-in letter and does NOT false-positive
 *      on "hearing officer" (the role that adjudicates mail-in contests).
 *   3. Live Claude call with the new "CRITICAL CONTEST METHOD CONSTRAINT" prompt
 *      produces a letter that passes validation.
 *
 * Run with: npx tsx -r dotenv/config scripts/smoke-test-contest-letter-mail-in.ts dotenv_config_path=.env.local
 */

import Anthropic from '@anthropic-ai/sdk';
import { validateLetterContent } from '../pages/api/cron/autopilot-mail-letters';

// ─── Test 1 + 2: Synthetic regex checks ─────────────────────────────────────

const baseTicket = {
  ticket_number: 'TEST-12345',
  violation_date: '2026-04-20',
  violation_description: 'Expired Meter',
};

const cleanLetter = `April 27, 2026

City of Chicago
Department of Finance
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Citation #TEST-12345

To Whom It May Concern:

I am writing to formally contest parking citation #TEST-12345 issued on April 20, 2026 at 1234 N. State Street. The citation was issued for an expired meter violation.

The hearing officer reviewing this submission will find that the meter receipt attached as Exhibit A demonstrates I had paid for parking through the time of the citation. I respectfully request a written determination dismissing this citation based on the evidence in this written submission.

Sincerely,

Test User
123 Main St
Chicago, IL 60614`;

const badPhrases = [
  'I respectfully request a hearing on this matter.',
  'I would like to schedule a hearing to contest this citation.',
  'I plan to appear in person to dispute this ticket.',
  'I look forward to my hearing date.',
  'I will present my evidence at my hearing.',
  'I will explain the circumstances during the hearing.',
  'When I appear before the administrative court, I will demonstrate compliance.',
  'I respectfully request my day in court.',
  'Please set a hearing date at your earliest convenience.',
];

let regexPassCount = 0;
let regexFailCount = 0;

console.log('\n═══ TEST 1: Bad phrases must FAIL validation ═══');
for (const phrase of badPhrases) {
  const fakeLetter = cleanLetter.replace(
    'I respectfully request a written determination dismissing this citation based on the evidence in this written submission.',
    phrase,
  );
  const result = validateLetterContent(fakeLetter, baseTicket);
  const hearingIssues = result.issues.filter((i) => i.includes('in-person hearing language'));
  if (hearingIssues.length > 0) {
    console.log(`  ✅ caught: "${phrase.slice(0, 60)}..."`);
    regexPassCount++;
  } else {
    console.log(`  ❌ MISSED: "${phrase}"`);
    console.log(`     issues: ${JSON.stringify(result.issues)}`);
    regexFailCount++;
  }
}

console.log('\n═══ TEST 2: Clean letter must PASS validation ═══');
const cleanResult = validateLetterContent(cleanLetter, baseTicket);
const cleanHearingIssues = cleanResult.issues.filter((i) => i.includes('in-person hearing language'));
if (cleanHearingIssues.length === 0) {
  console.log(`  ✅ clean letter: no false positive on "hearing officer" role mention`);
  regexPassCount++;
} else {
  console.log(`  ❌ FALSE POSITIVE: ${JSON.stringify(cleanHearingIssues)}`);
  regexFailCount++;
}

console.log('\n═══ TEST 3: Live Claude with new prompt produces a passing letter ═══');

async function runLiveTest(): Promise<{ passed: boolean; reason: string; letterPreview: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { passed: false, reason: 'ANTHROPIC_API_KEY not set', letterPreview: '' };
  }

  const anthropic = new Anthropic({ apiKey });

  // Replicate the structure of the production prompt from
  // pages/api/contest/generate-letter.ts including the new mail-in guardrail.
  const prompt = `Generate a professional, formal contest letter for a parking/traffic ticket with the following details:

Ticket Information:
- Ticket Number: TEST-12345
- Violation: Expired Meter
- Violation Code: 9-64-190
- Date: April 20, 2026
- Location: 1234 N. State Street, Chicago, IL
- Amount: $65

Contest Grounds: I had paid the meter through 3:30 PM (receipt attached). The citation was issued at 3:15 PM.

Sender Information:
- Name: Test User
- Address: 123 Main St, Chicago, IL 60614
- Email: test@example.com
- Phone: (312) 555-0100

CRITICAL CONTEST METHOD CONSTRAINT — READ FIRST:
This is a WRITTEN MAIL-IN CONTEST. The letter is being mailed to the City of Chicago Department of Finance, P.O. Box 88292, Chicago, IL 60680-1292, where it will be reviewed by a hearing officer who issues a written determination by mail.

DO NOT, under any circumstances:
- Request an in-person hearing or "request a hearing"
- Ask to appear, attend, or be present at a hearing
- Mention scheduling a hearing or hearing date
- Say "I look forward to my hearing" or anything implying a future appearance
- Use phrases like "at the hearing", "during the hearing", "when I appear", "in court"

INSTEAD, frame the letter as a written submission:
- "I respectfully request that this citation be dismissed based on the following written submission."
- "I respectfully request a written determination dismissing this citation."
- The hearing officer reviews mail-in contests on the papers and issues the determination by mail — there is no appearance.

Generate a professional contest letter that:
1. Clearly states the intent to contest the ticket BY MAIL
2. References the specific violation code and ordinance
3. Presents the grounds for contest in a clear, factual manner
4. Cites relevant legal precedents or ordinance language if applicable
5. Requests dismissal in writing (no hearing requested)
6. Is respectful and professional in tone
7. Includes proper formatting for a formal letter
8. Addresses the recipient as "City of Chicago, Department of Finance" (not the Department of Administrative Hearings) — mail-in contests are processed by DOF and adjudicated by hearing officers on the written record
9. Uses standard legal contest language

Use a formal letter format with proper salutation and closing.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    return { passed: false, reason: 'Claude returned non-text response', letterPreview: '' };
  }

  const letter = content.text;
  const result = validateLetterContent(letter, baseTicket);

  const hearingIssues = result.issues.filter((i) => i.includes('in-person hearing language'));
  if (hearingIssues.length > 0) {
    return {
      passed: false,
      reason: `Letter contains hearing-request language: ${hearingIssues.join('; ')}`,
      letterPreview: letter.slice(0, 1500),
    };
  }

  return {
    passed: true,
    reason: result.issues.length === 0 ? 'no validation issues' : `passed hearing check; other issues: ${result.issues.join('; ')}`,
    letterPreview: letter.slice(0, 1500),
  };
}

(async () => {
  let liveResult: { passed: boolean; reason: string; letterPreview: string };
  try {
    liveResult = await runLiveTest();
  } catch (err: any) {
    liveResult = { passed: false, reason: `Exception: ${err?.message || String(err)}`, letterPreview: '' };
  }

  if (liveResult.passed) {
    console.log(`  ✅ live letter passes validation (${liveResult.reason})`);
    console.log('\n--- letter preview (first 1500 chars) ---');
    console.log(liveResult.letterPreview);
    console.log('--- end preview ---');
  } else {
    console.log(`  ❌ live letter FAILED: ${liveResult.reason}`);
    if (liveResult.letterPreview) {
      console.log('\n--- letter preview (first 1500 chars) ---');
      console.log(liveResult.letterPreview);
      console.log('--- end preview ---');
    }
  }

  console.log('\n═══ SUMMARY ═══');
  console.log(`  Regex tests: ${regexPassCount} passed, ${regexFailCount} failed`);
  console.log(`  Live test:   ${liveResult.passed ? 'PASS' : 'FAIL'}`);

  const allPass = regexFailCount === 0 && liveResult.passed;
  process.exit(allPass ? 0 : 1);
})();
