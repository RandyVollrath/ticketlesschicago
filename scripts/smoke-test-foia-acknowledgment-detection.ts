/**
 * Smoke test: GovQA FOIA acknowledgment detection
 *
 * Reproduces the four real "Unmatched FOIA Response" admin alerts seen on
 * 2026-05-14 (subjects F139363-051426, F139365, F139367, F139368) and asserts:
 *   1. isFoiaAcknowledgement() returns true on each
 *   2. extractGovqaReference() pulls the F######-###### tracking ref
 *   3. processFoiaResponse() short-circuits with isAcknowledgement:true and
 *      action 'acknowledgment_recorded' — meaning the webhook will NOT page
 *      the admin
 *   4. A real FOIA *response* with records is NOT misclassified as an ack
 */

import {
  isFoiaAcknowledgement,
  extractGovqaReference,
  processFoiaResponse,
} from '../lib/contest-outcome-tracker';

// Body from one of the four real alerts that hit Randy's inbox 2026-05-14.
// Captured verbatim from the "Body Preview" field of the admin notification.
const realAckBody = `

[https://uploads.govqa.us/CHICAGOIL/chicagologo_seal3.jpg]

Thank you for your FOIA request to the City of Chicago Finance Department. Your
FOIA request has been received and is being processed. Your reference number for
tracking purposes is: F139363-051426. Track and view responses at Public Records
Center`;

const cases: { subject: string; body: string; expectedRef: string }[] = [
  { subject: 'Department of Finance :: F139363-051426', body: realAckBody, expectedRef: 'F139363-051426' },
  { subject: 'Department of Finance :: F139365-051426', body: realAckBody.replace('F139363', 'F139365'), expectedRef: 'F139365-051426' },
  { subject: 'Department of Finance :: F139367-051426', body: realAckBody.replace('F139363', 'F139367'), expectedRef: 'F139367-051426' },
  { subject: 'Department of Finance :: F139368-051426', body: realAckBody.replace('F139363', 'F139368'), expectedRef: 'F139368-051426' },
];

// A real fulfillment response (with attachments) should NOT be classified as an
// acknowledgment. Same sender, but body talks about responsive documents.
const fulfillmentBody = `Attached please find the responsive documents to your FOIA request APE-abc123def456.
The officer's field notes and photographs taken at the time of the citation are enclosed.
Citation #12345678901, plate AB12345.`;

let failures = 0;

console.log('━━━ Acknowledgment detection (helpers) ━━━');
for (const c of cases) {
  const detected = isFoiaAcknowledgement(c.subject, c.body);
  const ref = extractGovqaReference(c.subject, c.body);
  const pass = detected && ref === c.expectedRef;
  console.log(`${pass ? '✅' : '❌'} ${c.subject} → ack=${detected} ref=${ref}`);
  if (!pass) failures++;
}

console.log('\n━━━ Fulfillment must NOT be flagged as acknowledgment ━━━');
const fulfillmentSubject = 'Re: FOIA APE-abc123def456 — Responsive Records Attached';
const falseAck = isFoiaAcknowledgement(fulfillmentSubject, fulfillmentBody);
console.log(`${!falseAck ? '✅' : '❌'} fulfillment isAck=${falseAck} (expected false)`);
if (falseAck) failures++;

// ── processFoiaResponse short-circuit ──
// Use a stub supabase client — we only care that the function classifies the
// email as an acknowledgment and returns isAcknowledgement:true WITHOUT
// running any of the 4 matching layers (which would require real DB).
console.log('\n━━━ processFoiaResponse short-circuit ━━━');

const fakeInsertedRows: any[] = [];
const stubSupabase: any = {
  from(table: string) {
    return {
      _table: table,
      insert(payload: any) {
        fakeInsertedRows.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
      // Defensive: if we somehow fall through to Layer 1/2/3/4, these would
      // be called. We don't expect them to be — but if they are, return empty
      // so the test still completes (and we'll see failure via no isAck flag).
      select() { return this; },
      eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      in() { return this; },
      order() { return Promise.resolve({ data: [], error: null }); },
    };
  },
};

(async () => {
  for (const c of cases) {
    const result = await processFoiaResponse(stubSupabase, 'chicagoil@govqa.us', c.subject, c.body, [], {});
    const pass = result.isAcknowledgement === true
      && result.matched === false
      && result.action === 'acknowledgment_recorded'
      && result.govqaReference === c.expectedRef;
    console.log(`${pass ? '✅' : '❌'} ${c.subject} → ${result.action} matched=${result.matched} isAck=${result.isAcknowledgement} ref=${result.govqaReference}`);
    if (!pass) {
      console.log(`   full result:`, JSON.stringify(result));
      failures++;
    }
  }

  // Verify each ack inserted exactly one row into foia_unmatched_responses
  // with status='acknowledgment' (the part that gives us the audit trail).
  console.log('\n━━━ Audit row inserted with status=acknowledgment ━━━');
  for (const c of cases) {
    const row = fakeInsertedRows.find(r =>
      r.table === 'foia_unmatched_responses'
      && r.payload?.subject === c.subject
      && r.payload?.status === 'acknowledgment',
    );
    const pass = !!row && row.payload.extracted_reference_id === c.expectedRef;
    console.log(`${pass ? '✅' : '❌'} ${c.subject} → audit row stored (ref=${row?.payload?.extracted_reference_id || 'MISSING'})`);
    if (!pass) failures++;
  }

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
