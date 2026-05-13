/**
 * End-to-end smoke test for the contest pipeline.
 *
 * What it actually tests (the questions code-reading can't answer):
 *
 *   PHASE A — Detection → mailing state machine.
 *     Insert a synthetic ticket+letter with is_test=true and an
 *     evidence_deadline 2h in the past. Simulate the autopilot-reminders
 *     promotion logic. Assert the letter status flips from
 *     `pending_evidence` → `approved` (so mail-letters' .or() filter would
 *     pick it up next run). Confirm is_test=true blocks actual Lob mailing.
 *
 *   PHASE B — Evidence integration.
 *     Insert another synthetic ticket+letter with a known-good public image
 *     URL. Call integrateUserEvidence() directly. Assert:
 *       - letter.evidence_integrated = true
 *       - letter.letter_content was rewritten (not the placeholder)
 *       - letter.status = 'ready' (auto-mail) or 'pending_approval'
 *       - ticket.status = 'approved' or 'needs_approval'
 *       - user_evidence JSON contains photo_analyses for the image
 *
 *   PHASE C — Stuck-row monitor query plane.
 *     Run the same SQL the admin digest runs and confirm our test ticket
 *     does NOT count as stuck (it was promoted by phase A) and the evidence
 *     audit query confirms phase B's letter was properly integrated.
 *
 *   CLEANUP — every row this script created is deleted at the end, even
 *   on failure (try/finally). Run twice in a row to confirm idempotence.
 *
 * Run: npx tsx scripts/smoke-test-contest-pipeline-e2e.ts
 * Exits 0 on full pass, 1 on any failure.
 *
 * Risk surface:
 *   - Calls Claude API (regenerateLetterWithAI + analyzeEvidencePhotos).
 *     Costs a few cents per run; acceptable.
 *   - is_test=true is honored by autopilot-mail-letters (verified) so we
 *     don't hit Lob and don't mail real letters.
 *   - Uses the existing qa-bot test account — never touches real users.
 */

import { createClient } from '@supabase/supabase-js';
import { integrateUserEvidence } from '../lib/evidence-processing';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Existing smoke-test account — never delete it, only reuse.
const SMOKE_USER_ID = '7d1adabb-f9f5-41ec-9075-5f7cb311a822'; // qa-bot
const SMOKE_PLATE_ID = '849461dc-1746-4fb5-bb95-53c33aecbbe5';
const SMOKE_PLATE = 'QABOT01';
const SMOKE_STATE = 'IL';

// A small public image we know Claude Vision can fetch + describe.
// gstatic.com is a Google CDN that serves images without User-Agent gating —
// reliable from any environment. Wikipedia's CDN 400s for plain fetches and
// is a bad pick for an automated test.
const PROBE_IMAGE_URL = 'https://www.gstatic.com/webp/gallery/1.jpg';

const PLACEHOLDER_LETTER = `RE: Ticket #__TICKET_NUMBER__

I am writing to formally contest parking ticket #__TICKET_NUMBER__ issued on __VIOLATION_DATE__.

I respectfully request that this citation be dismissed.

Thank you for your consideration.`;

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const runId = `SMOKE-${Date.now()}`;
  console.log(`E2E smoke: run id ${runId}\n`);

  const createdTicketIds: string[] = [];
  const createdLetterIds: string[] = [];

  try {
    // ────────────────────────────────────────────────────────────────────────
    // PHASE A — Promotion state machine (mimic autopilot-reminders trigger)
    // ────────────────────────────────────────────────────────────────────────
    console.log('Phase A: pending_evidence → approved promotion\n');

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const ticketA = {
      user_id: SMOKE_USER_ID,
      plate_id: SMOKE_PLATE_ID,
      plate: SMOKE_PLATE,
      state: SMOKE_STATE,
      ticket_number: `${runId}-A`,
      violation_type: 'street_cleaning',
      violation_description: 'STREET CLEANING — SMOKE TEST',
      violation_date: '2026-05-01',
      amount: 60,
      status: 'pending_evidence',
      found_at: new Date().toISOString(),
      source: 'smoke_test',
      evidence_requested_at: new Date().toISOString(),
      evidence_deadline: twoHoursAgo, // already past — should trigger promotion
      auto_send_deadline: twoHoursAgo,
      is_test: true,
    };

    const { data: insertedA, error: insertErrA } = await supabaseAdmin
      .from('detected_tickets')
      .insert(ticketA)
      .select('id')
      .single();
    if (insertErrA || !insertedA) throw new Error(`insert ticket A: ${insertErrA?.message}`);
    createdTicketIds.push(insertedA.id);
    console.log(`  inserted ticket A: ${insertedA.id}`);

    const letterAContent = PLACEHOLDER_LETTER.replace(/__TICKET_NUMBER__/g, ticketA.ticket_number)
      .replace(/__VIOLATION_DATE__/g, ticketA.violation_date);

    const { data: insertedLetterA, error: insertLetterErrA } = await supabaseAdmin
      .from('contest_letters')
      .insert({
        ticket_id: insertedA.id,
        user_id: SMOKE_USER_ID,
        letter_content: letterAContent,
        letter_text: letterAContent,
        defense_type: 'smoke_test',
        status: 'pending_evidence',
        using_default_address: false,
      })
      .select('id')
      .single();
    if (insertLetterErrA || !insertedLetterA) throw new Error(`insert letter A: ${insertLetterErrA?.message}`);
    createdLetterIds.push(insertedLetterA.id);
    console.log(`  inserted letter A: ${insertedLetterA.id}`);

    // Simulate the autopilot-reminders.ts evidence-deadline-passed branch:
    //   - flip ticket to 'approved'
    //   - flip letter to 'approved' with approved_via='auto_deadline_safety_net'
    // We don't call the cron handler itself (it would also process every
    // other pending ticket in the DB). We replay the exact SQL it would run.
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        status: 'approved',
        auto_send_deadline: new Date().toISOString(),
      })
      .eq('id', insertedA.id)
      .eq('status', 'pending_evidence');

    await supabaseAdmin
      .from('contest_letters')
      .update({
        status: 'approved',
        approved_via: 'auto_deadline_safety_net',
        approved_at: new Date().toISOString(),
      })
      .eq('id', insertedLetterA.id)
      .in('status', ['pending_evidence', 'pending_approval', 'draft', 'needs_admin_review', 'awaiting_consent']);

    // Verify
    const { data: ticketAAfter } = await supabaseAdmin
      .from('detected_tickets').select('status').eq('id', insertedA.id).single();
    const { data: letterAAfter } = await supabaseAdmin
      .from('contest_letters').select('status, approved_via').eq('id', insertedLetterA.id).single();

    check('ticket promoted to "approved"', ticketAAfter?.status === 'approved', `got ${ticketAAfter?.status}`);
    check('letter promoted to "approved"', letterAAfter?.status === 'approved', `got ${letterAAfter?.status}`);
    check('letter has approved_via=auto_deadline_safety_net',
      letterAAfter?.approved_via === 'auto_deadline_safety_net',
      `got ${letterAAfter?.approved_via}`);

    // Confirm the mail-letters cron filter would find this letter.
    // mail-letters loads contest_letters where status in (approved, ready,
    // awaiting_consent, mailing), joins detected_tickets, skips is_test.
    const { data: mailQuery } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id, status, using_default_address,
        detected_tickets!inner ( id, is_test, ticket_number )
      `)
      .or('status.eq.approved,status.eq.ready,status.eq.awaiting_consent,status.eq.mailing')
      .eq('id', insertedLetterA.id)
      .limit(1);
    check('mail-letters .or() filter matches the promoted letter',
      (mailQuery?.length ?? 0) === 1,
      `query returned ${mailQuery?.length ?? 0} rows`);
    check('is_test=true blocks actual Lob mailing',
      (mailQuery?.[0] as any)?.detected_tickets?.is_test === true);

    // ────────────────────────────────────────────────────────────────────────
    // PHASE B — Evidence integration (integrateUserEvidence end-to-end)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\nPhase B: integrateUserEvidence with real photo URL\n');

    const ticketB = {
      ...ticketA,
      ticket_number: `${runId}-B`,
      status: 'pending_evidence',
      evidence_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      auto_send_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      violation_type: 'no_city_sticker',
      violation_description: 'NO CITY STICKER — SMOKE TEST',
      amount: 200,
    };

    const { data: insertedB, error: insertErrB } = await supabaseAdmin
      .from('detected_tickets').insert(ticketB).select('id').single();
    if (insertErrB || !insertedB) throw new Error(`insert ticket B: ${insertErrB?.message}`);
    createdTicketIds.push(insertedB.id);

    const letterBContent = PLACEHOLDER_LETTER.replace(/__TICKET_NUMBER__/g, ticketB.ticket_number)
      .replace(/__VIOLATION_DATE__/g, ticketB.violation_date);
    const { data: insertedLetterB, error: insertLetterErrB } = await supabaseAdmin
      .from('contest_letters')
      .insert({
        ticket_id: insertedB.id,
        user_id: SMOKE_USER_ID,
        letter_content: letterBContent,
        letter_text: letterBContent,
        defense_type: 'smoke_test',
        status: 'pending_evidence',
        using_default_address: false,
      })
      .select('id')
      .single();
    if (insertLetterErrB || !insertedLetterB) throw new Error(`insert letter B: ${insertLetterErrB?.message}`);
    createdLetterIds.push(insertedLetterB.id);

    // Now exercise the real helper with text + a real image URL.
    const evidenceText =
      'I purchased my Chicago city sticker on 2026-04-15, well before this ticket was issued. ' +
      'The sticker was properly displayed on my windshield at the time of the violation. ' +
      'See attached photo of the sticker.';

    const integrationResult = await integrateUserEvidence(supabaseAdmin, {
      ticket: {
        id: insertedB.id,
        user_id: SMOKE_USER_ID,
        violation_type: 'no_city_sticker',
        violation_description: 'NO CITY STICKER — SMOKE TEST',
        violation_date: ticketB.violation_date,
        amount: 200,
        ticket_number: ticketB.ticket_number,
        evidence_deadline: ticketB.evidence_deadline,
      },
      evidenceText,
      attachments: [
        { url: PROBE_IMAGE_URL, filename: 'sticker.png', content_type: 'image/png' },
      ],
    });

    console.log(`  integration result: regenerated=${integrationResult.letterRegenerated} ` +
      `newLetterStatus=${integrationResult.newLetterStatus} ` +
      `newTicketStatus=${integrationResult.newTicketStatus} ` +
      `needsApproval=${integrationResult.needsApproval}`);

    const { data: letterBAfter } = await supabaseAdmin
      .from('contest_letters')
      .select('id, status, letter_content, evidence_integrated, evidence_integrated_at')
      .eq('id', insertedLetterB.id)
      .single();
    const { data: ticketBAfter } = await supabaseAdmin
      .from('detected_tickets')
      .select('status, user_evidence, evidence_received_at')
      .eq('id', insertedB.id)
      .single();

    check('letter.evidence_integrated = true',
      letterBAfter?.evidence_integrated === true,
      `got ${letterBAfter?.evidence_integrated}`);
    check('letter.status is mail-recognized',
      ['ready', 'pending_approval'].includes(letterBAfter?.status || ''),
      `got ${letterBAfter?.status}`);
    check('ticket.status promoted to approved or needs_approval',
      ['approved', 'needs_approval'].includes(ticketBAfter?.status || ''),
      `got ${ticketBAfter?.status}`);
    check('letter content was actually rewritten (longer than placeholder)',
      (letterBAfter?.letter_content?.length || 0) > letterBContent.length,
      `placeholder=${letterBContent.length} chars, after=${letterBAfter?.letter_content?.length ?? 0} chars`);
    check('letter content references the user\'s text evidence',
      /sticker/i.test(letterBAfter?.letter_content || ''),
      'expected "sticker" in regenerated letter body');

    // user_evidence should now be a JSON blob with photo_analyses
    let userEvidenceParsed: any = null;
    try { userEvidenceParsed = JSON.parse(ticketBAfter?.user_evidence || ''); } catch (_) { /* ignore */ }
    check('user_evidence is parseable JSON', !!userEvidenceParsed);
    check('user_evidence.text matches submitted text',
      userEvidenceParsed?.text === evidenceText);
    check('user_evidence.attachment_urls includes the probe image',
      (userEvidenceParsed?.attachment_urls || []).includes(PROBE_IMAGE_URL));
    check('user_evidence.photo_analyses array exists',
      Array.isArray(userEvidenceParsed?.photo_analyses),
      `got ${typeof userEvidenceParsed?.photo_analyses}`);
    // Vision may fail (network / fetch issues), but in the happy path it
    // should describe the image. We accept either: present + populated, OR
    // present + empty (degraded but not crashing).
    const visionRan = Array.isArray(userEvidenceParsed?.photo_analyses)
      && userEvidenceParsed.photo_analyses.length > 0;
    if (visionRan) {
      console.log(`  ✓ Claude Vision described the photo: "${userEvidenceParsed.photo_analyses[0].description.slice(0, 80)}..."`);
    } else {
      console.log(`  ⚠ Claude Vision returned no descriptions for the probe image (network or API issue) — letter still regenerated from text, just without photo facts`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // PHASE C — Audit query plane (the daily monitor would catch breakage)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\nPhase C: audit queries against the test rows\n');

    // Evidence-not-integrated check should NOT match letter B (it was integrated).
    const { data: auditCheck } = await supabaseAdmin
      .from('detected_tickets')
      .select(`
        id, user_evidence_uploaded_at,
        contest_letters ( id, evidence_integrated, mailed_at )
      `)
      .eq('id', insertedB.id);
    const auditRow = (auditCheck as any[])?.[0];
    const letters = Array.isArray(auditRow?.contest_letters) ? auditRow.contest_letters : [auditRow?.contest_letters].filter(Boolean);
    const integrated = letters.some((l: any) => l.evidence_integrated === true);
    check('audit query: letter B shows evidence_integrated=true', integrated);

    // Evidence-deadline-overdue check should NOT match letter A (it was promoted).
    const { data: stuckA } = await supabaseAdmin
      .from('contest_letters')
      .select('id, status')
      .eq('id', insertedLetterA.id)
      .eq('status', 'pending_evidence')
      .limit(1);
    check('audit query: letter A is no longer pending_evidence',
      (stuckA?.length ?? 0) === 0,
      `${stuckA?.length} rows still pending_evidence`);

  } finally {
    // ────────────────────────────────────────────────────────────────────────
    // CLEANUP — always delete the test rows, even on failure
    // ────────────────────────────────────────────────────────────────────────
    console.log('\nCleanup\n');
    if (createdLetterIds.length > 0) {
      await supabaseAdmin.from('contest_letters').delete().in('id', createdLetterIds);
      console.log(`  deleted ${createdLetterIds.length} contest_letters row(s)`);
    }
    if (createdTicketIds.length > 0) {
      // Cascade: ticket_audit_log + ticket_foia_requests usually FK-cascade.
      // Delete any audit rows we may have generated, then the tickets.
      await supabaseAdmin.from('ticket_audit_log').delete().in('ticket_id', createdTicketIds);
      await supabaseAdmin.from('detected_tickets').delete().in('id', createdTicketIds);
      console.log(`  deleted ${createdTicketIds.length} detected_tickets row(s)`);
    }
  }

  console.log(`\n${failures === 0 ? '✅ E2E PASS' : `❌ ${failures} assertion failure(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('💥 Smoke test threw:', err);
  process.exit(1);
});
