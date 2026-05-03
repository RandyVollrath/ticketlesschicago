/**
 * eContest attachment-guard smoke test.
 *
 * Wired into `npm run gate:econtest-attach` and the QA pipeline. Proves the
 * pre-flight guards in lib/econtest-service.ts and lib/econtest-evidence-packet.ts
 * refuse to ship a contest with no attachment / a bogus attachment.
 *
 * Origin: a real customer ticket (Jesse Randall, May 2026) revealed that a
 * dry-run script could pass `evidenceFiles: []` and the eContest service
 * would happily walk to the submit button. With this guard, that path
 * fail-closes — Lob mail then takes over.
 */
import { submitEContest } from '../lib/econtest-service';
import { buildEcontestEvidencePacket } from '../lib/econtest-evidence-packet';
import * as fs from 'fs';

interface Case {
  name: string;
  run: () => Promise<{ ok: boolean; reason?: string }>;
}

const CASES: Case[] = [
  {
    name: 'submitEContest refuses no evidenceFiles',
    run: async () => {
      const r = await submitEContest({
        ticketNumber: '0000000000',
        defenseText: 'placeholder',
        evidenceFiles: [],
        stopBeforeSubmit: false,
      });
      return r.success === false && /no evidence files/i.test(r.error || '')
        ? { ok: true }
        : { ok: false, reason: `expected refusal; got success=${r.success} error=${r.error}` };
    },
  },
  {
    name: 'submitEContest refuses missing file path',
    run: async () => {
      const r = await submitEContest({
        ticketNumber: '0000000000',
        defenseText: 'placeholder',
        evidenceFiles: ['/tmp/this-file-definitely-does-not-exist-' + Date.now() + '.pdf'],
        stopBeforeSubmit: false,
      });
      return r.success === false && /does not exist/i.test(r.error || '')
        ? { ok: true }
        : { ok: false, reason: `expected refusal; got success=${r.success} error=${r.error}` };
    },
  },
  {
    name: 'submitEContest refuses suspiciously small file',
    run: async () => {
      const tiny = `/tmp/tiny-fake-pdf-${Date.now()}.pdf`;
      fs.writeFileSync(tiny, 'not really a pdf');
      try {
        const r = await submitEContest({
          ticketNumber: '0000000000',
          defenseText: 'placeholder',
          evidenceFiles: [tiny],
          stopBeforeSubmit: false,
        });
        return r.success === false && /suspiciously small/i.test(r.error || '')
          ? { ok: true }
          : { ok: false, reason: `expected refusal; got success=${r.success} error=${r.error}` };
      } finally {
        try { fs.unlinkSync(tiny); } catch {}
      }
    },
  },
  {
    name: 'buildEcontestEvidencePacket produces real PDF for real letter HTML',
    run: async () => {
      const html = `
        <html><body>
          <h1>Contest of Parking Ticket 0000000000</h1>
          <p>This is a test letter body that is long enough to render a real
          PDF. It would normally be the actual contest letter for the customer.
          The City of Chicago Department of Finance reviews this for an
          administrative correspondence hearing per Municipal Code 9-100-070.</p>
          <p>${'Lorem ipsum '.repeat(200)}</p>
          <p>Sincerely,<br/>Test Customer<br/>123 Test St, Chicago IL 60601</p>
        </body></html>
      `;
      const packet = await buildEcontestEvidencePacket({
        ticketNumber: 'SMOKE-' + Date.now(),
        htmlContent: html,
      });
      try {
        if (packet.pageCount < 1) return { ok: false, reason: `packet has 0 pages` };
        if (packet.byteSize < 500) return { ok: false, reason: `packet only ${packet.byteSize}B` };
        if (!fs.existsSync(packet.packetPath)) return { ok: false, reason: `packet file missing` };
        return { ok: true };
      } finally {
        try { fs.unlinkSync(packet.packetPath); } catch {}
      }
    },
  },
];

(async () => {
  let failed = 0;
  for (const tc of CASES) {
    try {
      const r = await tc.run();
      if (r.ok) console.log(`PASS: ${tc.name}`);
      else { console.error(`FAIL: ${tc.name} — ${r.reason}`); failed++; }
    } catch (e: any) {
      console.error(`FAIL: ${tc.name} — threw: ${e.message}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\n${failed} attachment-guard fixture(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${CASES.length} attachment-guard fixtures passed.`);
  process.exit(0);
})();
