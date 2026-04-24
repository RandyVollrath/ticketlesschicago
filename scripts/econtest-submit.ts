#!/usr/bin/env npx ts-node
/**
 * eContest Portal Submission Script
 *
 * Attempts to submit approved contest letters via Chicago's eContest portal
 * (parkingtickets.chicago.gov/EHearingWeb/) instead of mailing via Lob.
 *
 * Flow:
 *   1. Query contest_letters where status='approved' and econtest_status IS NULL
 *   2. For each letter, attempt eContest submission
 *   3. If eContest succeeds: mark letter as 'sent' with econtest details
 *   4. If eContest fails: leave letter for Lob mailing cron (fallback)
 *
 * Run: npx ts-node scripts/econtest-submit.ts
 * Schedule: Before the Lob mailing cron (so eContest gets first shot)
 *
 * Required: Playwright (chromium), runs locally (not on Vercel)
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { submitEContest, checkEContestEligibility } from '../lib/econtest-service';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface ApprovedLetter {
  id: string;
  ticket_id: string;
  user_id: string;
  letter_content: string;
  status: string;
  econtest_status: string | null;
  econtest_submitted_at: string | null;
  lob_letter_id: string | null;
  detected_tickets: {
    ticket_number: string;
    violation_description: string;
    amount: number;
  } | null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  eContest Portal Submission');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════\n');

  // Find approved letters that haven't been sent via eContest or Lob yet
  const { data: letters, error } = await supabase
    .from('contest_letters')
    .select(`
      id,
      ticket_id,
      user_id,
      letter_content,
      status,
      econtest_status,
      econtest_submitted_at,
      lob_letter_id,
      detected_tickets!inner (
        ticket_number,
        violation_description,
        amount
      )
    `)
    .in('status', ['approved', 'ready'])
    .is('econtest_status', null)
    .is('lob_letter_id', null)
    .order('created_at', { ascending: true })
    .limit(10) as { data: ApprovedLetter[] | null; error: any };

  if (error) {
    console.error('Failed to query letters:', error.message);
    // If the econtest_status column doesn't exist yet, that's expected on first run
    if (error.message.includes('econtest_status')) {
      console.log('\n⚠️  The econtest_status column does not exist yet.');
      console.log('   Run the migration first:');
      console.log('   ALTER TABLE contest_letters ADD COLUMN econtest_status TEXT;');
      console.log('   ALTER TABLE contest_letters ADD COLUMN econtest_submitted_at TIMESTAMPTZ;');
      console.log('   ALTER TABLE contest_letters ADD COLUMN econtest_confirmation_id TEXT;');
      console.log('   ALTER TABLE contest_letters ADD COLUMN econtest_response JSONB;');
    }
    process.exit(1);
  }

  if (!letters || letters.length === 0) {
    console.log('No approved letters waiting for submission. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${letters.length} approved letter(s) to attempt via eContest.\n`);

  let submitted = 0;
  let failed = 0;
  let ineligible = 0;

  for (const letter of letters) {
    const ticket = letter.detected_tickets;
    if (!ticket) {
      console.log(`Letter ${letter.id}: No ticket data found, skipping`);
      continue;
    }

    const ticketNumber = ticket.ticket_number;
    console.log(`── Letter ${letter.id.substring(0, 8)}... ──`);
    console.log(`   Ticket: ${ticketNumber} | ${ticket.violation_description} | $${ticket.amount}`);

    // Step 1: Check eligibility first (quick, doesn't submit)
    console.log('   Checking eContest eligibility...');
    const eligibility = await checkEContestEligibility(ticketNumber);

    if (!eligibility.eligible) {
      console.log(`   ❌ Not eligible: ${eligibility.error || eligibility.status || 'unknown'}`);
      // Mark as ineligible so we don't keep retrying
      await supabase
        .from('contest_letters')
        .update({
          econtest_status: 'ineligible',
          econtest_response: { error: eligibility.error, status: eligibility.status },
        })
        .eq('id', letter.id);
      ineligible++;
      continue;
    }

    console.log(`   ✓ Eligible (method: ${eligibility.contestMethod}, status: ${eligibility.status})`);

    // Step 2: Extract plain text defense from letter content
    // Letter content may be HTML — strip tags for the defense narrative
    const defenseText = stripHtml(letter.letter_content || '');
    if (!defenseText || defenseText.length < 50) {
      console.log(`   ⚠️ Letter content too short (${defenseText.length} chars), skipping`);
      failed++;
      continue;
    }

    // Step 3: Attempt submission
    console.log('   Submitting via eContest...');
    const result = await submitEContest({
      ticketNumber,
      defenseText,
      letterId: letter.id,
      // TODO: Generate PDF of letter and pass as evidenceFiles
      // evidenceFiles: ['/path/to/letter.pdf'],
    });

    if (result.success) {
      console.log(`   ✅ Submitted! Confirmation: ${result.confirmationId || 'none'}`);
      console.log(`   Screenshot: ${result.screenshotPath || 'none'}`);

      // Update letter as sent via eContest
      await supabase
        .from('contest_letters')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          econtest_status: 'submitted',
          econtest_submitted_at: new Date().toISOString(),
          econtest_confirmation_id: result.confirmationId || null,
          econtest_response: {
            step: result.step,
            contestMethod: result.contestMethod,
            confirmationText: result.confirmationText,
            screenshotPath: result.screenshotPath,
          },
        })
        .eq('id', letter.id);

      // Also update detected_ticket status
      await supabase
        .from('detected_tickets')
        .update({ status: 'contested_online' })
        .eq('id', letter.ticket_id);

      submitted++;
    } else {
      console.log(`   ❌ Failed at step '${result.step}': ${result.error}`);
      if (result.screenshotPath) {
        console.log(`   Screenshot: ${result.screenshotPath}`);
      }

      // Mark the attempt but DON'T change letter status — let Lob pick it up as fallback
      await supabase
        .from('contest_letters')
        .update({
          econtest_status: 'failed',
          econtest_response: {
            step: result.step,
            error: result.error,
            eligible: result.eligible,
            contestMethod: result.contestMethod,
            confirmationText: result.confirmationText,
            screenshotPath: result.screenshotPath,
          },
        })
        .eq('id', letter.id);

      failed++;
    }

    // Small delay between submissions to be polite to the portal
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Results: ${submitted} submitted, ${failed} failed (→ Lob fallback), ${ineligible} ineligible`);
  console.log('═══════════════════════════════════════════════\n');

  // Send notification email with results
  await sendResultsNotification({
    submitted,
    failed,
    ineligible,
    total: letters.length,
    details: letters.map(l => ({
      ticketNumber: l.detected_tickets?.ticket_number || 'unknown',
      violation: l.detected_tickets?.violation_description || 'unknown',
      amount: l.detected_tickets?.amount || 0,
    })),
  });
}

async function sendResultsNotification(results: {
  submitted: number;
  failed: number;
  ineligible: number;
  total: number;
  details: { ticketNumber: string; violation: string; amount: number }[];
}) {
  if (!process.env.RESEND_API_KEY) {
    console.log('No RESEND_API_KEY — skipping notification email');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const subject = results.submitted > 0
    ? `✅ eContest: ${results.submitted} letter(s) submitted electronically`
    : results.total === 0
      ? `eContest: No letters pending`
      : `⚠️ eContest: ${results.failed} failed (falling back to Lob mail)`;

  const body = `
eContest Portal Submission Results
${now}

Summary:
- ${results.submitted} submitted via eContest (free, instant)
- ${results.failed} failed → will be mailed via Lob (fallback)
- ${results.ineligible} tickets not eligible for online contesting
- ${results.total} total letters attempted

${results.details.length > 0 ? 'Tickets:\n' + results.details.map(d =>
    `  ${d.ticketNumber} | ${d.violation} | $${d.amount}`
  ).join('\n') : ''}

${results.submitted > 0 ? '🎉 Savings: ~$' + (results.submitted * 1.5).toFixed(2) + ' in Lob postage avoided' : ''}
${results.failed > 0 ? '\nFailed submissions will be picked up by the Lob mailing cron as fallback.' : ''}

Portal: https://parkingtickets.chicago.gov/EHearingWeb/home
  `.trim();

  try {
    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: ['randy@autopilotamerica.com'],
      subject,
      text: body,
    });
    console.log('📧 Notification email sent');
  } catch (err: any) {
    console.error('Failed to send notification:', err.message);
  }
}

/** Strip HTML tags to get plain text for defense narrative */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
