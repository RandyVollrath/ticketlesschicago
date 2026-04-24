#!/usr/bin/env npx ts-node
/**
 * eContest Dry-Run Probe
 *
 * When a fresh contestable ticket appears, this script:
 *   1. Navigates through Steps 1-3 of the eContest portal
 *   2. Reaches the evidence upload page (Step 4)
 *   3. Screenshots the form, captures all field names/types/constraints
 *   4. Does NOT submit — stops and emails the results to Randy
 *
 * Run: npx ts-node scripts/econtest-probe.ts
 * Or with a specific ticket: npx ts-node scripts/econtest-probe.ts --ticket 9205305523
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const ECONTEST_BASE = 'https://parkingtickets.chicago.gov/EHearingWeb';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  eContest Dry-Run Probe (NO SUBMISSION)');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════\n');

  // Check if a specific ticket was provided via CLI arg
  const ticketArg = process.argv.find(a => a.startsWith('--ticket'));
  const specificTicket = ticketArg ? process.argv[process.argv.indexOf(ticketArg) + 1] : null;

  let ticketNumber: string;
  let ownerName: string;
  let userEmail: string;
  let violationDesc: string;
  let amount: number;

  if (specificTicket) {
    console.log(`Using specified ticket: ${specificTicket}`);
    // Look up the ticket details
    const { data: ticket } = await supabase
      .from('detected_tickets')
      .select('ticket_number, violation_description, amount, registered_owner_name, user_id')
      .eq('ticket_number', specificTicket)
      .maybeSingle();

    if (!ticket) {
      console.log(`Ticket ${specificTicket} not found in database. Using it anyway with placeholder data.`);
      ticketNumber = specificTicket;
      ownerName = '';
      userEmail = 'probe@autopilotamerica.com';
      violationDesc = 'unknown';
      amount = 0;
    } else {
      ticketNumber = ticket.ticket_number;
      ownerName = ticket.registered_owner_name || '';
      violationDesc = ticket.violation_description || 'unknown';
      amount = ticket.amount || 0;

      // Get user email
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('email')
        .eq('user_id', ticket.user_id)
        .maybeSingle();
      userEmail = profile?.email || 'probe@autopilotamerica.com';
    }
  } else {
    // Find the freshest contestable ticket (status not already decided)
    console.log('Searching for fresh contestable tickets...');
    const { data: tickets } = await supabase
      .from('detected_tickets')
      .select('ticket_number, violation_description, amount, registered_owner_name, user_id, status, hearing_end_date')
      .eq('is_test', false)
      .in('status', ['pending_evidence', 'evidence_received', 'skipped', 'new'])
      .order('found_at', { ascending: false })
      .limit(20);

    if (!tickets || tickets.length === 0) {
      console.log('No fresh tickets found. Run with --ticket <number> to probe a specific ticket.');
      // Still email notification so Randy knows we tried
      await sendProbeResults({
        ticketNumber: 'none',
        status: 'no_tickets',
        message: 'No fresh contestable tickets found in the database.',
      });
      process.exit(0);
    }

    // Try each ticket until we find one that's eligible on the portal
    let found = false;
    for (const t of tickets) {
      console.log(`\nTrying ticket ${t.ticket_number} (${t.violation_description})...`);

      const eligibility = await quickEligibilityCheck(t.ticket_number);
      if (eligibility.eligible) {
        ticketNumber = t.ticket_number;
        ownerName = t.registered_owner_name || '';
        violationDesc = t.violation_description || 'unknown';
        amount = t.amount || 0;

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('user_id', t.user_id)
          .maybeSingle();
        userEmail = profile?.email || 'probe@autopilotamerica.com';

        console.log(`✓ Ticket ${ticketNumber} is eligible! Proceeding with probe.`);
        found = true;
        break;
      } else {
        console.log(`  ✗ Not eligible: ${eligibility.reason}`);
      }
    }

    if (!found) {
      console.log('\nNo eligible tickets found on the eContest portal.');
      await sendProbeResults({
        ticketNumber: 'none',
        status: 'none_eligible',
        message: `Checked ${tickets.length} tickets, none eligible for eContest. All may already be decided.`,
      });
      process.exit(0);
    }
  }

  // Parse registered owner name into first/last
  const nameParts = ownerName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || '';
  // Last name = last word (skip middle initial if present)
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  console.log(`\nProbing ticket: ${ticketNumber}`);
  console.log(`  Violation: ${violationDesc} | $${amount}`);
  console.log(`  Owner: ${firstName} ${lastName} (from: "${ownerName}")`);
  console.log(`  Email: ${userEmail}\n`);

  // ── Full probe through Steps 1-4 ──
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  const screenshots: string[] = [];
  const probeLog: string[] = [];

  try {
    // Step 1: Home
    probeLog.push('Step 1: Loading eContest home page...');
    await page.goto(`${ECONTEST_BASE}/home`, { waitUntil: 'networkidle' });

    // Step 2: Search ticket
    probeLog.push(`Step 2: Searching ticket ${ticketNumber}...`);
    await page.fill('#ticket1', ticketNumber);
    await page.click('#searchTickets');
    await page.waitForTimeout(3000);

    const searchUrl = page.url();
    const searchText = await page.evaluate(() => document.body.innerText);

    if (searchText.includes('not eligible') || !searchUrl.includes('eligibleTicketsDisplay')) {
      probeLog.push('RESULT: Ticket not eligible on eligibility page.');
      const ss = `/tmp/econtest-probe-${ticketNumber}-step2.png`;
      await page.screenshot({ path: ss, fullPage: true });
      screenshots.push(ss);
      await browser.close();
      await sendProbeResults({
        ticketNumber,
        status: 'not_eligible',
        message: 'Ticket not eligible on the eContest portal.',
        probeLog,
        screenshots,
      });
      process.exit(0);
    }

    // Capture eligibility page
    const ss2 = `/tmp/econtest-probe-${ticketNumber}-step2-eligible.png`;
    await page.screenshot({ path: ss2, fullPage: true });
    screenshots.push(ss2);

    // Check for contest checkbox and method
    const hasCheckbox = await page.$('input[type="checkbox"]');
    const contestMethod = await page.evaluate(() => {
      // Check for select dropdown
      const sel = document.querySelector('select') as HTMLSelectElement | null;
      if (sel) return { type: 'select', options: Array.from(sel.options).map(o => o.value + '|' + o.text) };
      // Check for hidden field
      const hid = document.getElementById('contestMethod') as HTMLInputElement | null;
      if (hid) return { type: 'hidden', value: hid.value };
      return null;
    });

    probeLog.push(`  Checkbox found: ${!!hasCheckbox}`);
    probeLog.push(`  Contest method: ${JSON.stringify(contestMethod)}`);

    // Check the checkbox if it exists
    if (hasCheckbox) {
      await hasCheckbox.check();
    }

    // Set method to Correspondence if it's a select
    if (contestMethod?.type === 'select') {
      const sel = await page.$('select');
      if (sel) await sel.selectOption('Correspondence');
    }

    // Click Continue
    const continueBtn = await page.$('#continue');
    if (!continueBtn) {
      probeLog.push('RESULT: No Continue button — ticket may not be contestable.');
      await browser.close();
      await sendProbeResults({ ticketNumber, status: 'no_continue', message: 'No Continue button on eligibility page.', probeLog, screenshots });
      process.exit(0);
    }

    const isDisabled = await continueBtn.getAttribute('disabled');
    probeLog.push(`  Continue button disabled: ${isDisabled}`);
    if (isDisabled) {
      probeLog.push('RESULT: Continue button is disabled — ticket not contestable.');
      await browser.close();
      await sendProbeResults({ ticketNumber, status: 'continue_disabled', message: 'Continue button disabled.', probeLog, screenshots });
      process.exit(0);
    }

    // Step 3: Click Continue → Terms page
    probeLog.push('Step 3: Navigating to Terms & Conditions...');
    await continueBtn.click();
    await page.waitForTimeout(3000);

    const termsUrl = page.url();
    probeLog.push(`  Terms page URL: ${termsUrl}`);

    const ss3 = `/tmp/econtest-probe-${ticketNumber}-step3-terms.png`;
    await page.screenshot({ path: ss3, fullPage: true });
    screenshots.push(ss3);

    // Fill terms form with registered owner data
    probeLog.push(`  Filling: firstName="${firstName}", lastName="${lastName}"`);
    await page.fill('#firstName', firstName);
    await page.fill('#lastName', lastName);
    await page.fill('#email', userEmail);
    await page.fill('#email2', userEmail);

    // Set date
    const today = new Date();
    const dateStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`;
    await page.evaluate((d: string) => {
      const dp = document.getElementById('datepicker') as HTMLInputElement;
      if (dp) { dp.value = d; dp.dispatchEvent(new Event('change', { bubbles: true })); }
    }, dateStr);

    // Check agree
    const agreeBox = await page.$('#checker1');
    if (agreeBox) await agreeBox.check();

    // Click Accept
    probeLog.push('  Clicking Accept (terms)...');
    const acceptBtn = await page.$('#continue');
    if (acceptBtn) {
      await acceptBtn.click();
      await page.waitForTimeout(5000);
    }

    const afterTermsUrl = page.url();
    probeLog.push(`  After terms URL: ${afterTermsUrl}`);

    // Check for errors
    const errors = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.error, .alert-danger, .text-danger, [class*="error"]'))
        .map(el => el.textContent?.trim()).filter(Boolean);
    });
    if (errors.length > 0) {
      probeLog.push(`  ERRORS: ${errors.join(' | ')}`);
      const ss3err = `/tmp/econtest-probe-${ticketNumber}-step3-error.png`;
      await page.screenshot({ path: ss3err, fullPage: true });
      screenshots.push(ss3err);
      await browser.close();
      await sendProbeResults({
        ticketNumber, status: 'terms_error',
        message: `Terms page error: ${errors.join(' | ')}`,
        probeLog, screenshots,
      });
      process.exit(0);
    }

    // ═══ Step 4: EVIDENCE UPLOAD PAGE ═══
    probeLog.push('Step 4: Evidence upload page reached!');

    const ss4 = `/tmp/econtest-probe-${ticketNumber}-step4-evidence.png`;
    await page.screenshot({ path: ss4, fullPage: true });
    screenshots.push(ss4);

    // Capture the full page text
    const evidenceText = await page.evaluate(() => document.body.innerText);
    probeLog.push(`  Page text length: ${evidenceText.length}`);

    // ── Capture ALL form elements ──
    const allFormElements = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input, select, textarea, button[type="submit"]')).map(el => {
        const inp = el as HTMLInputElement;
        return {
          tag: el.tagName,
          type: inp.type || '',
          name: inp.name || '',
          id: el.id || '',
          accept: inp.accept || '',
          multiple: inp.multiple || false,
          maxLength: (el as HTMLTextAreaElement).maxLength || -1,
          placeholder: inp.placeholder || '',
          required: inp.required || false,
          disabled: inp.disabled || false,
          value: inp.type === 'hidden' ? inp.value?.substring(0, 100) : '',
          className: el.className?.substring(0, 80) || '',
          visible: (el as HTMLElement).offsetParent !== null,
          options: el.tagName === 'SELECT'
            ? Array.from((el as HTMLSelectElement).options).map(o => o.value + ' | ' + o.text)
            : undefined,
        };
      });
    });

    // Separate visible vs hidden
    const visibleEls = allFormElements.filter(e => e.visible && e.type !== 'hidden');
    const hiddenEls = allFormElements.filter(e => e.type === 'hidden');
    const fileInputs = allFormElements.filter(e => e.type === 'file');

    probeLog.push(`\n  ──── VISIBLE FORM ELEMENTS (${visibleEls.length}) ────`);
    visibleEls.forEach(el => {
      let desc = `  ${el.tag} type="${el.type}" name="${el.name}" id="${el.id}"`;
      if (el.accept) desc += ` accept="${el.accept}"`;
      if (el.multiple) desc += ` multiple`;
      if (el.maxLength > 0) desc += ` maxLength=${el.maxLength}`;
      if (el.placeholder) desc += ` placeholder="${el.placeholder}"`;
      if (el.required) desc += ` REQUIRED`;
      if (el.options) desc += ` options=[${el.options.join(', ')}]`;
      probeLog.push(desc);
    });

    probeLog.push(`\n  ──── FILE UPLOAD INPUTS (${fileInputs.length}) ────`);
    if (fileInputs.length === 0) {
      probeLog.push('  (none found)');
    }
    fileInputs.forEach(el => {
      probeLog.push(`  name="${el.name}" id="${el.id}" accept="${el.accept}" multiple=${el.multiple}`);
    });

    probeLog.push(`\n  ──── HIDDEN FIELDS (${hiddenEls.length}) ────`);
    hiddenEls.forEach(el => {
      probeLog.push(`  name="${el.name}" value="${el.value}"`);
    });

    // Capture the full HTML of the form area for manual inspection
    const formHtml = await page.evaluate(() => {
      const main = document.querySelector('main, .container, .content, form') || document.body;
      return main.innerHTML;
    });
    const htmlPath = `/tmp/econtest-probe-${ticketNumber}-step4-form.html`;
    fs.writeFileSync(htmlPath, formHtml);
    probeLog.push(`\n  Full form HTML saved to: ${htmlPath}`);

    probeLog.push(`\n  ──── EVIDENCE PAGE TEXT ────`);
    probeLog.push(evidenceText.substring(0, 3000));

    // ═══ DONE — DO NOT SUBMIT ═══
    probeLog.push('\n══════════════════════════════════════');
    probeLog.push('  PROBE COMPLETE — DID NOT SUBMIT');
    probeLog.push('══════════════════════════════════════');

    await browser.close();

    // Send results
    await sendProbeResults({
      ticketNumber,
      status: 'evidence_page_reached',
      message: `Successfully reached evidence upload page for ticket ${ticketNumber}.`,
      probeLog,
      screenshots,
      formElements: { visible: visibleEls, fileInputs, hiddenCount: hiddenEls.length },
    });

  } catch (err: any) {
    probeLog.push(`\nERROR: ${err.message}`);
    const ssErr = `/tmp/econtest-probe-${ticketNumber}-error.png`;
    try { await page.screenshot({ path: ssErr, fullPage: true }); screenshots.push(ssErr); } catch {}
    await browser.close();
    await sendProbeResults({
      ticketNumber,
      status: 'error',
      message: `Probe failed: ${err.message}`,
      probeLog,
      screenshots,
    });
  }
}

/** Quick eligibility check without going past step 2 */
async function quickEligibilityCheck(ticketNumber: string): Promise<{ eligible: boolean; reason?: string }> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    await page.goto(`${ECONTEST_BASE}/home`, { waitUntil: 'networkidle' });
    await page.fill('#ticket1', ticketNumber);
    await page.click('#searchTickets');
    await page.waitForTimeout(3000);

    const text = await page.evaluate(() => document.body.innerText);
    const url = page.url();

    if (text.includes('not eligible') || !url.includes('eligibleTicketsDisplay')) {
      await browser.close();
      return { eligible: false, reason: 'not eligible on portal' };
    }

    // Check if Continue button is enabled (not disabled)
    const continueDisabled = await page.evaluate(() => {
      const btn = document.getElementById('continue') as HTMLInputElement | null;
      return btn ? btn.disabled : true;
    });

    // Check if there's a checkbox (eligible tickets have one)
    const hasCheckbox = await page.$('input[type="checkbox"]');

    await browser.close();

    if (continueDisabled && !hasCheckbox) {
      return { eligible: false, reason: 'Continue disabled, no checkbox — already decided' };
    }

    return { eligible: true };
  } catch (err: any) {
    if (browser) try { await browser.close(); } catch {}
    return { eligible: false, reason: err.message };
  }
}

async function sendProbeResults(results: {
  ticketNumber: string;
  status: string;
  message: string;
  probeLog?: string[];
  screenshots?: string[];
  formElements?: any;
}) {
  // Print to console
  console.log('\n' + (results.probeLog || []).join('\n'));
  console.log('\nResult:', results.status, '-', results.message);

  if (!process.env.RESEND_API_KEY) {
    console.log('No RESEND_API_KEY — skipping notification email');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const isSuccess = results.status === 'evidence_page_reached';

  const subject = isSuccess
    ? `🔬 eContest probe: Evidence upload page mapped for ticket ${results.ticketNumber}`
    : `eContest probe: ${results.status} — ${results.ticketNumber}`;

  let body = `eContest Dry-Run Probe Results\n${now}\n\n`;
  body += `Ticket: ${results.ticketNumber}\n`;
  body += `Status: ${results.status}\n`;
  body += `Message: ${results.message}\n\n`;

  if (results.formElements) {
    body += `═══ EVIDENCE UPLOAD FORM STRUCTURE ═══\n\n`;
    body += `Visible form elements: ${results.formElements.visible?.length || 0}\n`;
    body += `File upload inputs: ${results.formElements.fileInputs?.length || 0}\n`;
    body += `Hidden fields: ${results.formElements.hiddenCount || 0}\n\n`;

    if (results.formElements.fileInputs?.length > 0) {
      body += `FILE UPLOADS:\n`;
      results.formElements.fileInputs.forEach((f: any) => {
        body += `  name="${f.name}" accept="${f.accept}" multiple=${f.multiple}\n`;
      });
      body += '\n';
    }

    if (results.formElements.visible?.length > 0) {
      body += `ALL VISIBLE FIELDS:\n`;
      results.formElements.visible.forEach((el: any) => {
        body += `  ${el.tag} type="${el.type}" name="${el.name}"`;
        if (el.accept) body += ` accept="${el.accept}"`;
        if (el.maxLength > 0) body += ` maxLength=${el.maxLength}`;
        if (el.placeholder) body += ` placeholder="${el.placeholder}"`;
        if (el.options) body += ` options=[${el.options.join(', ')}]`;
        body += '\n';
      });
    }
  }

  if (results.probeLog && results.probeLog.length > 0) {
    body += `\n═══ FULL PROBE LOG ═══\n\n`;
    body += results.probeLog.join('\n');
  }

  if (results.screenshots && results.screenshots.length > 0) {
    body += `\n\n═══ SCREENSHOTS ═══\n`;
    results.screenshots.forEach(s => body += `  ${s}\n`);
  }

  body += `\n\nThis was a DRY RUN — nothing was submitted to the City.\n`;
  body += `Portal: https://parkingtickets.chicago.gov/EHearingWeb/home\n`;

  try {
    // Read screenshot files as attachments
    const attachments = (results.screenshots || [])
      .filter(s => fs.existsSync(s))
      .map(s => ({
        filename: path.basename(s),
        content: fs.readFileSync(s).toString('base64'),
      }));

    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: ['randy@autopilotamerica.com'],
      subject,
      text: body,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    console.log('📧 Probe results emailed to randy@autopilotamerica.com');
  } catch (err: any) {
    console.error('Failed to send notification:', err.message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
