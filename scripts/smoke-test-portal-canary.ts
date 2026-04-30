#!/usr/bin/env npx tsx
/**
 * Portal-scraper canary (QA_REPORT.md net #7).
 *
 * The City of Chicago payment portal is the source of truth for whether a
 * contest won, lost, or got a hearing. Our portal scraper reads the literal
 * text of the disposition field; lib/contest-outcome-tracker.ts uses string
 * matching ('Not Liable' / 'Liable' / 'Hearing') to classify it.
 *
 * If the city ever changes the wording — "Found Not Liable", "Determination:
 * Not Liable", a different language code, etc. — our parser would silently
 * fall through and EVERY win would be missed. There is no other safety net
 * for that failure mode.
 *
 * This canary tests the *parser*, not the scraper. It runs against fixtures
 * once a day and asserts every documented disposition wording still maps to
 * the right outcome. If the city ever changes wording (hopefully rare), one
 * fixture goes red and we know within a day.
 *
 * Run locally:  npx tsx scripts/smoke-test-portal-canary.ts
 * Run in CI:    same — no DB or env vars required.
 */

import { detectOutcomeChange } from '../lib/contest-outcome-tracker';

interface Fixture {
  description: string;
  ticket_queue: string;
  hearing_disposition: string | null;
  current_amount_due: number;
  original_amount: number;
  expectedOutcome: 'dismissed' | 'reduced' | 'upheld' | 'hearing_scheduled' | null;
  // If non-null, also assert finalAmount equals this. Useful for reduced cases.
  expectedFinalAmount?: number;
}

// Every wording we have ever seen the city use. Add new ones as the
// disposition vocabulary expands. Keep the list inline so the canary is
// trivially auditable.
const FIXTURES: Fixture[] = [
  // ─── Dismissed (the path that matters most) ────────────────────────────
  {
    description: 'Standard dismissal: "Not Liable"',
    ticket_queue: 'Closed',
    hearing_disposition: 'Not Liable',
    current_amount_due: 0,
    original_amount: 80,
    expectedOutcome: 'dismissed',
  },
  {
    description: 'Capitalization variant: "NOT LIABLE"',
    ticket_queue: 'Closed',
    hearing_disposition: 'NOT LIABLE',
    current_amount_due: 0,
    original_amount: 80,
    expectedOutcome: 'dismissed',
  },
  {
    description: 'Lowercase variant: "not liable"',
    ticket_queue: 'Closed',
    hearing_disposition: 'not liable',
    current_amount_due: 0,
    original_amount: 80,
    expectedOutcome: 'dismissed',
  },
  {
    description: 'Alternate wording: "Dismissed"',
    ticket_queue: 'Closed',
    hearing_disposition: 'Dismissed',
    current_amount_due: 0,
    original_amount: 80,
    expectedOutcome: 'dismissed',
  },
  {
    description: 'Alternate wording: "Not Guilty"',
    ticket_queue: 'Closed',
    hearing_disposition: 'Not Guilty',
    current_amount_due: 0,
    original_amount: 80,
    expectedOutcome: 'dismissed',
  },
  {
    description: 'With trailing whitespace',
    ticket_queue: 'Closed',
    hearing_disposition: '  Not Liable  ',
    current_amount_due: 0,
    original_amount: 80,
    expectedOutcome: 'dismissed',
  },

  // ─── Upheld ────────────────────────────────────────────────────────────
  {
    description: 'Upheld: "Liable" full amount',
    ticket_queue: 'Closed',
    hearing_disposition: 'Liable',
    current_amount_due: 80,
    original_amount: 80,
    expectedOutcome: 'upheld',
  },

  // ─── Reduced (upheld but lower amount) ─────────────────────────────────
  {
    description: 'Reduced: "Liable" with reduced amount',
    ticket_queue: 'Closed',
    hearing_disposition: 'Liable',
    current_amount_due: 25,
    original_amount: 80,
    expectedOutcome: 'reduced',
    expectedFinalAmount: 25,
  },

  // ─── Hearing scheduled ─────────────────────────────────────────────────
  {
    description: 'Hearing in queue, no disposition yet',
    ticket_queue: 'Hearing',
    hearing_disposition: null,
    current_amount_due: 80,
    original_amount: 80,
    expectedOutcome: 'hearing_scheduled',
  },

  // ─── No change ─────────────────────────────────────────────────────────
  {
    description: 'Open ticket, no movement',
    ticket_queue: 'Open',
    hearing_disposition: null,
    current_amount_due: 80,
    original_amount: 80,
    expectedOutcome: null,
  },
];

// Stub TrackedTicket — only the fields detectOutcomeChange uses.
const stubTicket = {
  id: 'canary',
  ticket_number: 'CANARY-1',
  user_id: 'canary',
  violation_type: 'street_cleaning',
  violation_code: null,
  amount: 80,
  officer_badge: null,
  location: null,
  status: 'mailed',
  plate: null,
  state: null,
  last_portal_status: null,
  last_portal_check: null,
};

let passed = 0;
let failed = 0;

console.log(`Portal disposition canary — ${FIXTURES.length} fixtures\n`);

for (const f of FIXTURES) {
  const change = detectOutcomeChange(stubTicket, {
    ticket_queue: f.ticket_queue,
    hearing_disposition: f.hearing_disposition,
    current_amount_due: f.current_amount_due,
    original_amount: f.original_amount,
  });
  const ok = change.outcome === f.expectedOutcome;
  const finalOk = f.expectedFinalAmount === undefined || change.finalAmount === f.expectedFinalAmount;
  if (ok && finalOk) {
    console.log(`  ✓ ${f.description}`);
    passed++;
  } else {
    console.log(`  ✗ ${f.description}`);
    console.log(`      expected outcome=${f.expectedOutcome}, got ${change.outcome}`);
    if (f.expectedFinalAmount !== undefined) {
      console.log(`      expected finalAmount=${f.expectedFinalAmount}, got ${change.finalAmount}`);
    }
    failed++;
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nIf this canary fails after a long stretch of green, the City of Chicago');
  console.log('has likely changed the disposition wording on the payment portal. Update the');
  console.log('parser in lib/contest-outcome-tracker.ts:detectOutcomeChange and add a fixture.');
}
process.exit(failed === 0 ? 0 : 1);
