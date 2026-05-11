#!/usr/bin/env npx tsx
/**
 * Smoke test for the free-ticket-review analysis pipeline.
 *
 * Feeds a hand-rolled LookupResult through buildAnalysis() and prints the
 * output. This proves the violation classifier, beyond-template detector,
 * and per-ticket recommender produce something meaningful without needing
 * a Playwright scrape or a live DB.
 *
 *   npx tsx scripts/smoke-test-free-review-analysis.ts
 *
 * Exit code 0 = all assertions passed. Non-zero = something regressed.
 */

import type { LookupResult, PortalTicket } from '../lib/chicago-portal-scraper';
import { buildAnalysis } from '../lib/contest-review/build-analysis';
import type { AutopilotEnrichment } from '../lib/contest-review/beyond-template-arguments';

function ticket(overrides: Partial<PortalTicket>): PortalTicket {
  return {
    ticket_number: 'X',
    ticket_type: 'parking',
    issue_date: '',
    issue_datetime: null,
    violation_description: '',
    current_amount_due: 0,
    original_amount: 0,
    ticket_queue: 'Notice',
    hearing_disposition: null,
    notice_number: null,
    balance_due: 0,
    raw_text: '',
    ticket_plate: null,
    ticket_state: null,
    portal_receivable_id: null,
    receivable_description: null,
    receivable_type: null,
    payable: true,
    hearing_start_date: null,
    hearing_end_date: null,
    registered_owner_name: null,
    registered_owner_address: null,
    ...overrides,
  };
}

const today = new Date();
const isoDaysAgo = (n: number) =>
  new Date(today.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Add a 6th ticket to exercise the cure-path for expired plates.
const fakeLookup: LookupResult = {
  plate: 'ABC1234',
  state: 'IL',
  last_name: 'TESTUSER',
  tickets: [
    ticket({
      ticket_number: '900000001',
      issue_date: isoDaysAgo(5),
      violation_description: 'STREET CLEANING',
      current_amount_due: 60,
      original_amount: 60,
      ticket_plate: 'ABC1234',
      ticket_state: 'IL',
      registered_owner_address: '123 N MAIN, CHICAGO, IL 60601',
    }),
    ticket({
      ticket_number: '900000006',
      issue_date: isoDaysAgo(7),
      violation_description: 'EXPIRED PLATES OR TEMP REGISTRATION',
      current_amount_due: 60,
      original_amount: 60,
      ticket_plate: 'ABC1234',
      ticket_state: 'IL',
    }),
    ticket({
      ticket_number: '900000002',
      issue_date: isoDaysAgo(3),
      violation_description: 'NO CITY STICKER VEH UNDER/EQUAL 16,000 LBS.',
      current_amount_due: 200,
      original_amount: 200,
      ticket_plate: 'ABC1234',
      ticket_state: 'IL',
      registered_owner_address: '500 OAK ST, EVANSTON, IL 60201',
    }),
    ticket({
      ticket_number: '900000003',
      issue_date: isoDaysAgo(18),
      violation_description: 'EXP. METER NON-CENTRAL BUSINESS DIS',
      current_amount_due: 65,
      original_amount: 65,
      ticket_plate: 'XYZ9999', // mismatch
      ticket_state: 'IL',
    }),
    ticket({
      ticket_number: '900000004',
      issue_date: isoDaysAgo(10),
      violation_description: 'RED LIGHT VIOLATION',
      current_amount_due: 100,
      original_amount: 100,
      ticket_type: 'red_light',
      ticket_plate: 'ABC1234',
      ticket_state: 'IL',
    }),
    ticket({
      ticket_number: '900000005',
      issue_date: isoDaysAgo(80),
      violation_description: 'SPEED VIOLATION CHILD SAFETY ZONE',
      current_amount_due: 175,
      original_amount: 35,
      ticket_type: 'speed_camera',
      ticket_queue: 'Determination',
      ticket_plate: 'ABC1234',
      ticket_state: 'IL',
    }),
  ],
  error: null,
  screenshot_path: null,
  captcha_cost: 0,
  lookup_duration_ms: 0,
  format_warnings: [],
  boot_eligibility: null,
};

// Synthetic Autopilot enrichment for ticket #900000001 (street cleaning):
// FOIA showed a strong block-level dismissal pattern at the cited block.
const enrichmentMap = new Map<string, AutopilotEnrichment>([
  ['900000001', {
    foundInFoia: true,
    citedAddress: '4322 S VANDERPOEL',
    officerId: '19422',
    officerSameTypeContested: 8,
    officerSameTypeDismissalRate: 0.75, // 75% — well above 57% baseline
    blockLabel: '4300–4399 S VANDERPOEL',
    blockTotalContested: 12,
    blockNotLiable: 9,
    blockDismissalRate: 0.75,
  }],
]);

const analysis = buildAnalysis(
  fakeLookup,
  {
    queriedPlate: 'ABC1234',
    queriedState: 'IL',
    queriedLastName: 'TESTUSER',
  },
  enrichmentMap,
);

const failures: string[] = [];
function expect(cond: boolean, msg: string) {
  if (!cond) failures.push(`FAIL: ${msg}`);
}

// Per-ticket lookups
const byNum = new Map(analysis.perTicket.map(t => [t.ticketNumber, t]));

// 1. Street cleaning + Autopilot enrichment → CONTEST with autopilot block pattern
const sc = byNum.get('900000001')!;
expect(sc.violationCode === '9-64-010', 'street cleaning violation code');
expect(
  sc.beyondTemplate.some(b => b.kind === 'autopilot' && b.id === 'autopilot_address_resolved'),
  'should surface Autopilot address-resolved finding when FOIA enrichment is present',
);
expect(
  sc.beyondTemplate.some(b => b.kind === 'autopilot' && b.id === 'autopilot_block_pattern'),
  'should surface Autopilot block-pattern finding when FOIA shows high block dismissal',
);
expect(
  sc.beyondTemplate.some(b => b.kind === 'autopilot' && b.id === 'autopilot_officer_dismissal_rate'),
  'should surface officer dismissal rate when officer same-type rate is materially above baseline',
);
expect(
  sc.recommendation === 'contest',
  'street cleaning with Autopilot block pattern should be CONTEST',
);
expect(
  !sc.beyondTemplate.some(b => b.id === 'evidence_witness_statement'),
  'witness statement should be dropped entirely',
);

// 2. City sticker with out-of-Chicago registered address → contest, non-resident
//    AND should always surface the "buy sticker now" cure
const cs = byNum.get('900000002')!;
expect(cs.violationCode === '9-64-125', 'city sticker violation code');
expect(cs.recommendation === 'contest', 'city sticker with out-of-Chicago address should be CONTEST');
expect(
  cs.beyondTemplate.some(b => b.id === 'non_resident_city_sticker'),
  'should detect non-resident defense for city sticker',
);
expect(
  cs.beyondTemplate.some(b => b.id === 'cure_buy_city_sticker' && b.kind === 'cure'),
  'should ALWAYS surface buy-sticker cure path for sticker tickets',
);

// 3. Expired meter with plate mismatch → contest (clerical error)
const em = byNum.get('900000003')!;
expect(em.violationCode === '9-64-170', 'expired meter violation code');
expect(em.recommendation === 'contest', 'plate mismatch should make this CONTEST');
expect(em.beyondTemplate.some(b => b.id === 'plate_mismatch'), 'should detect plate mismatch');
// Day 18 is within 14–20 window, so deadline warning should fire too
expect(em.beyondTemplate.some(b => b.id === 'deadline_imminent'), 'should detect deadline imminent');

// 4. Red light → at minimum a footage-review beyond-template
const rl = byNum.get('900000004')!;
expect(rl.violationCode === '9-102-010', 'red light violation code');
expect(rl.beyondTemplate.some(b => b.id === 'camera_footage_review'), 'should suggest camera footage review');

// 5. Speed camera, 80 days old + penalty applied → should fire zone-hours +
// untimely-notice; recommend "skip" since 80 days is past the 21-day window
// and no strong defense detected (zone-hours is moderate, footage-review is strong).
const sp = byNum.get('900000005')!;
expect(sp.violationCode === '9-102-020', 'speed camera violation code');
expect(sp.beyondTemplate.some(b => b.id === 'speed_camera_zone_hours'), 'should detect speed zone hours');
// Footage review is "strong" so the recommendation should be contest even at 80 days.
expect(sp.recommendation === 'contest', 'speed camera with strong defense should still be CONTEST');

// 6. Expired plates — always surface the renew-now cure path → contest
const ep = byNum.get('900000006')!;
expect(ep.violationCode === '9-76-160', 'expired plates violation code');
expect(
  ep.beyondTemplate.some(b => b.id === 'cure_renew_registration' && b.kind === 'cure'),
  'should ALWAYS surface renew-registration cure for expired plates',
);
expect(
  ep.recommendation === 'contest',
  'expired plates (89% baseline) + cure path → CONTEST',
);

// Cross-ticket: 2 camera tickets → calibration request pattern
expect(
  analysis.crossTicket.some(c => c.id === 'pattern_camera_repeat'),
  'should detect repeat-camera pattern',
);

console.log('────────────────────────────────────────────────────');
console.log('FREE TICKET REVIEW — ANALYSIS SMOKE TEST');
console.log('────────────────────────────────────────────────────');
console.log(`Plate: ${analysis.plate} (${analysis.state})`);
console.log(`Total tickets: ${analysis.totalTickets}   Total due: $${analysis.totalAmountDue.toFixed(2)}`);
console.log();
for (const t of analysis.perTicket) {
  console.log(`  #${t.ticketNumber}  ${t.violationName}  $${t.amount}  →  ${t.recommendation.toUpperCase()}`);
  console.log(`     ${t.recommendationReason}`);
  for (const b of t.beyondTemplate) {
    console.log(`     • [${b.strength}] ${b.title}  (+${Math.round(b.estimatedUpliftPct * 100)}pp)`);
  }
}
if (analysis.crossTicket.length) {
  console.log();
  console.log('Cross-ticket findings:');
  for (const c of analysis.crossTicket) {
    console.log(`  • [${c.strength}] ${c.title}`);
  }
}
console.log();

if (failures.length) {
  console.error('────────────────────────────────────────────────────');
  console.error(`${failures.length} ASSERTION(S) FAILED:`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('All assertions passed.');
