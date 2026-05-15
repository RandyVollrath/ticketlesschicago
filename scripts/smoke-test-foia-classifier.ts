/**
 * Smoke test for the FOIA response classifier.
 *
 * Regression target: the F139069-051226 incident (2026-05-12). A bare GovQA
 * acknowledgment was misread as a fulfillment with 0 documents because the
 * old heuristic fired on the word "attached" appearing in the footer link.
 *
 * Each case below is a real or representative body the classifier must label
 * correctly. Exit code 0 = all pass, 1 = any failure.
 */

import {
  isExtensionResponse,
  isAcknowledgmentEmail,
  isLikelyFulfillment,
} from '../lib/contest-outcome-tracker';

type Case = {
  name: string;
  subject: string;
  body: string;
  attachments: { filename: string; content_type: string }[];
  expectedAck: boolean;
  expectedExtension: boolean;
  expectedFulfillment: boolean;
};

const cases: Case[] = [
  {
    name: 'F139069 GovQA acknowledgment (the bug)',
    subject: 'Department of Finance :: F139069-051226',
    body: `[https://uploads.govqa.us/CHICAGOIL/chicagologo_seal3.jpg]

Thank you for your FOIA request to the City of Chicago Finance Department. Your
FOIA request has been received and is being processed. Your reference number for
tracking purposes is: F139069-051226. Track and view responses at Public Records
Center [https://uploads.govqa.us/attachments-link]`,
    attachments: [],
    expectedAck: true,
    expectedExtension: false,
    expectedFulfillment: false,
  },
  {
    name: 'April Lundberg extension letter',
    subject: 'Re: Follow-Up: FOIA Request APE-gpGoonaETCuE — 7 Business Days Without Response',
    body: `The Department of Finance ("DOF") sent the extension letter below via GovQA on 5/4/26. This request will be completed by the required date of 05/18/2026.

Thank you,

April Lundberg
Freedom of Information Act Officer
City of Chicago | Department of Finance | Policy and Legislation

RE: PUBLIC RECORDS REQUEST of May 02, 2026, Reference # F138048-050426.

Dear Scarlet Carson, pursuant to 5 ILCS 140/3(e) the response time has been extended.`,
    attachments: [],
    expectedAck: false,
    expectedExtension: true,
    expectedFulfillment: false,
  },
  {
    name: 'Real fulfillment with attachments',
    subject: 'FOIA Response — APE-xxxxxx',
    body: `Please find attached the responsive records for your FOIA request.

The Department of Finance is providing the following records: ticket photos,
issuing officer notes, and the meter test log.`,
    attachments: [
      { filename: 'ticket_evidence.pdf', content_type: 'application/pdf' },
    ],
    expectedAck: false,
    expectedExtension: false,
    expectedFulfillment: true,
  },
  {
    name: 'Real fulfillment, no attachments but explicit phrasing',
    subject: 'FOIA Response — APE-xxxxxx',
    body: `In response to your FOIA request, please find attached the requested
records. The responsive documents are attached hereto.`,
    attachments: [],
    expectedAck: false,
    expectedExtension: false,
    expectedFulfillment: true,
  },
  {
    name: 'Bare denial — no responsive records',
    subject: 'FOIA Response — APE-xxxxxx',
    body: `The Department of Finance has reviewed your request and determined
that there are no responsive records.`,
    attachments: [],
    expectedAck: false,
    expectedExtension: false,
    expectedFulfillment: false,
  },
  {
    name: 'GovQA footer noise alone should not be a fulfillment',
    subject: 'Department of Finance :: F139999-051226',
    body: `Your FOIA request has been received and is being processed. View
attachments and responses at the Public Records Center portal.`,
    attachments: [],
    expectedAck: true,
    expectedExtension: false,
    expectedFulfillment: false,
  },
];

let failures = 0;
for (const c of cases) {
  const ack = isAcknowledgmentEmail(c.subject, c.body);
  const ext = isExtensionResponse(c.subject, c.body);
  const ful = isLikelyFulfillment(c.body, c.attachments);
  const pass =
    ack === c.expectedAck && ext === c.expectedExtension && ful === c.expectedFulfillment;
  const status = pass ? 'PASS' : 'FAIL';
  console.log(
    `[${status}] ${c.name}\n  ack=${ack} (want ${c.expectedAck})  ext=${ext} (want ${c.expectedExtension})  ful=${ful} (want ${c.expectedFulfillment})`,
  );
  if (!pass) failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed`);
process.exit(0);
