/**
 * eContest Portal Submission Service
 *
 * Submits ticket contests electronically via Chicago's eContest portal
 * at parkingtickets.chicago.gov/EHearingWeb/
 *
 * Flow:
 *   1. Load home page, grab CSRF token
 *   2. POST ticket number to /displayEligibleTickets
 *   3. If eligible: check "contest" checkbox, select "Correspondence", click Continue
 *   4. Upload evidence (PDF of letter + any exhibit images)
 *   5. Submit contest
 *   6. Capture confirmation
 *
 * Fallback: If this fails at any step, caller should fall back to Lob mail.
 *
 * Recon date: 2026-04-23
 * Portal tech: Java/Spring MVC, session-based CSRF, NO captcha
 */

import { chromium, Browser, Page } from 'playwright';

const ECONTEST_BASE = 'https://parkingtickets.chicago.gov/EHearingWeb';

export interface EContestSubmissionParams {
  ticketNumber: string;
  /** Plain text letter content for the written defense narrative */
  defenseText: string;
  /** Paths to evidence files (PDFs, images) to upload */
  evidenceFiles?: string[];
  /** For logging */
  letterId?: string;
}

export interface EContestResult {
  success: boolean;
  /** Which step we reached before success or failure */
  step: 'home' | 'eligibility' | 'evidence' | 'confirmation' | 'error';
  /** Confirmation number or ID from the portal */
  confirmationId?: string;
  /** Full text of the confirmation page */
  confirmationText?: string;
  /** Error message if failed */
  error?: string;
  /** Whether this ticket is eligible for eContest at all */
  eligible?: boolean;
  /** The contest method used */
  contestMethod?: string;
  /** Screenshot path for debugging (only on failure) */
  screenshotPath?: string;
}

/**
 * Submit a ticket contest via the eContest portal.
 * Returns result with success/failure and confirmation details.
 * Caller should fall back to Lob mail if this fails.
 */
export async function submitEContest(params: EContestSubmissionParams): Promise<EContestResult> {
  const { ticketNumber, defenseText, evidenceFiles, letterId } = params;
  const logPrefix = `[eContest ${ticketNumber}${letterId ? ` letter=${letterId}` : ''}]`;

  let browser: Browser | null = null;

  try {
    console.log(`${logPrefix} Starting eContest submission...`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    // ── Step 1: Load home page ──
    console.log(`${logPrefix} Step 1: Loading home page...`);
    await page.goto(`${ECONTEST_BASE}/home`, { waitUntil: 'networkidle' });

    // ── Step 2: Enter ticket number and search ──
    console.log(`${logPrefix} Step 2: Searching ticket ${ticketNumber}...`);
    await page.fill('#ticket1', ticketNumber);
    await page.click('#searchTickets');
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const pageText = await page.evaluate(() => document.body.innerText);

    // Check if ticket was found and is eligible
    if (pageText.includes('not eligible') || pageText.includes('Ticket is not eligible')) {
      console.log(`${logPrefix} Ticket not eligible for eContest`);
      await browser.close();
      return { success: false, step: 'eligibility', eligible: false, error: 'Ticket not eligible for eContest' };
    }

    if (!currentUrl.includes('eligibleTicketsDisplay')) {
      console.log(`${logPrefix} Unexpected URL after search: ${currentUrl}`);
      const screenshotPath = `/tmp/econtest-error-${ticketNumber}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath });
      await browser.close();
      return { success: false, step: 'eligibility', error: `Unexpected page after search: ${currentUrl}`, screenshotPath };
    }

    // ── Step 3: Check eligibility details ──
    console.log(`${logPrefix} Step 3: Checking eligibility...`);

    // Read the contest method and status
    const contestMethod = await page.evaluate(() => {
      const el = document.getElementById('contestMethod') as HTMLInputElement | HTMLSelectElement | null;
      return el ? el.value : null;
    });
    const statusAsString = await page.evaluate(() => {
      const el = document.getElementById('statusAsString') as HTMLInputElement | null;
      return el ? el.value : null;
    });

    console.log(`${logPrefix} Contest method: ${contestMethod}, Status: ${statusAsString}`);

    // Check if there's a checkbox to check for contesting
    const hasCheckbox = await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"][name*="contest"], input[type="checkbox"][id*="contest"]') as HTMLInputElement | null;
      return cb ? { name: cb.name, id: cb.id, checked: cb.checked } : null;
    });

    if (hasCheckbox) {
      console.log(`${logPrefix} Found contest checkbox: ${hasCheckbox.name || hasCheckbox.id}`);
      // Check the contest checkbox
      const cbSelector = hasCheckbox.id ? `#${hasCheckbox.id}` : `input[name="${hasCheckbox.name}"]`;
      await page.check(cbSelector);
      await page.waitForTimeout(500);
    }

    // Check if there's a method dropdown (select) — set to Correspondence
    const hasMethodSelect = await page.evaluate(() => {
      const sel = document.querySelector('select[name*="contestMethod"], select[id*="contestMethod"]') as HTMLSelectElement | null;
      return sel ? { name: sel.name, id: sel.id, options: Array.from(sel.options).map(o => o.value) } : null;
    });

    if (hasMethodSelect) {
      console.log(`${logPrefix} Found method select with options: ${hasMethodSelect.options.join(', ')}`);
      const selSelector = hasMethodSelect.id ? `#${hasMethodSelect.id}` : `select[name="${hasMethodSelect.name}"]`;
      // Prefer "Correspondence" — that's the mail-in equivalent
      if (hasMethodSelect.options.includes('Correspondence')) {
        await page.selectOption(selSelector, 'Correspondence');
      }
    }

    // Also check evidence checkbox if present
    const hasEvidenceCheckbox = await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"][name*="evidence"], input[type="checkbox"][id*="evidence"]') as HTMLInputElement | null;
      return cb ? { name: cb.name, id: cb.id } : null;
    });
    if (hasEvidenceCheckbox) {
      const ecbSelector = hasEvidenceCheckbox.id ? `#${hasEvidenceCheckbox.id}` : `input[name="${hasEvidenceCheckbox.name}"]`;
      await page.check(ecbSelector);
      console.log(`${logPrefix} Checked evidence checkbox`);
    }

    // Click Continue
    const continueBtn = await page.$('#continue');
    if (!continueBtn) {
      console.log(`${logPrefix} No Continue button found — ticket may not be contestable`);
      const screenshotPath = `/tmp/econtest-error-${ticketNumber}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath });
      await browser.close();
      return {
        success: false,
        step: 'eligibility',
        eligible: false,
        error: 'No Continue button — ticket not contestable via eContest',
        contestMethod: contestMethod || undefined,
        screenshotPath,
      };
    }

    console.log(`${logPrefix} Step 4: Clicking Continue to evidence page...`);
    await continueBtn.click();
    await page.waitForTimeout(5000);

    const evidenceUrl = page.url();
    const evidenceText = await page.evaluate(() => document.body.innerText);
    console.log(`${logPrefix} Evidence page URL: ${evidenceUrl}`);

    if (!evidenceFiles || evidenceFiles.length === 0) {
      const screenshotPath = `/tmp/econtest-error-${ticketNumber}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await browser.close();
      return {
        success: false,
        step: 'evidence',
        eligible: true,
        error: 'No evidence packet supplied for eContest submission',
        contestMethod: contestMethod || undefined,
        screenshotPath,
      };
    }

    // ── Step 4: Upload evidence and enter defense ──
    // Look for file upload fields
    const fileInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
        name: (el as HTMLInputElement).name,
        id: el.id,
        accept: (el as HTMLInputElement).accept,
      }));
    });
    console.log(`${logPrefix} File inputs found: ${JSON.stringify(fileInputs)}`);

    // Look for textarea for defense narrative
    const textareas = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('textarea')).map(el => ({
        name: el.name,
        id: el.id,
        maxLength: el.maxLength,
        placeholder: el.placeholder,
      }));
    });
    console.log(`${logPrefix} Textareas found: ${JSON.stringify(textareas)}`);

    if (fileInputs.length === 0) {
      const screenshotPath = `/tmp/econtest-error-${ticketNumber}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await browser.close();
      return {
        success: false,
        step: 'evidence',
        eligible: true,
        error: 'No file upload field found on eContest evidence page',
        contestMethod: contestMethod || undefined,
        screenshotPath,
      };
    }

    // Upload the full packet and fail closed if it cannot be attached.
    let uploadedCount = 0;
    for (let i = 0; i < Math.min(fileInputs.length, evidenceFiles.length); i++) {
      const selector = fileInputs[i].id ? `#${fileInputs[i].id}` : `input[name="${fileInputs[i].name}"]`;
      try {
        await page.setInputFiles(selector, evidenceFiles[i]);
        uploadedCount++;
        console.log(`${logPrefix} Uploaded evidence file ${i + 1}: ${evidenceFiles[i]}`);
      } catch (err: any) {
        const screenshotPath = `/tmp/econtest-error-${ticketNumber}-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await browser.close();
        return {
          success: false,
          step: 'evidence',
          eligible: true,
          error: `Failed to upload evidence file ${i + 1}: ${err.message}`,
          contestMethod: contestMethod || undefined,
          screenshotPath,
        };
      }
    }

    if (uploadedCount < evidenceFiles.length) {
      const screenshotPath = `/tmp/econtest-error-${ticketNumber}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await browser.close();
      return {
        success: false,
        step: 'evidence',
        eligible: true,
        error: `Evidence page only accepted ${uploadedCount} of ${evidenceFiles.length} required attachment(s)`,
        contestMethod: contestMethod || undefined,
        screenshotPath,
      };
    }

    // Fill defense text if textarea exists
    if (textareas.length > 0) {
      const taSelector = textareas[0].id ? `#${textareas[0].id}` : `textarea[name="${textareas[0].name}"]`;
      // Truncate to maxLength if set
      const maxLen = textareas[0].maxLength > 0 ? textareas[0].maxLength : 10000;
      const truncatedDefense = defenseText.substring(0, maxLen);
      await page.fill(taSelector, truncatedDefense);
      console.log(`${logPrefix} Filled defense text (${truncatedDefense.length} chars)`);
    } else {
      console.log(`${logPrefix} No defense textarea found — relying on uploaded evidence packet`);
    }

    // ── Step 5: Look for submit button and submit ──
    // Capture all visible form elements for debugging
    const visibleElements = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], input[type="button"], a.btn'))
        .filter(el => (el as HTMLElement).offsetParent !== null) // visible only
        .map(el => ({
          tag: el.tagName,
          type: (el as HTMLInputElement).type,
          name: (el as HTMLInputElement).name,
          id: el.id,
          value: (el as HTMLInputElement).value,
          text: el.textContent?.trim().substring(0, 50),
        }));
    });
    console.log(`${logPrefix} Visible buttons: ${JSON.stringify(visibleElements)}`);

    // Find the submit/contest button
    const submitBtn = await page.$('input[type="submit"][value*="Submit"], input[type="submit"][value*="Contest"], input[type="submit"][name="continue"], button[type="submit"]');
    if (!submitBtn) {
      // Take a screenshot for debugging
      const screenshotPath = `/tmp/econtest-evidence-${ticketNumber}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`${logPrefix} No submit button found on evidence page. Screenshot: ${screenshotPath}`);

      // Return partial success — we got to the evidence page but couldn't find submit
      // This data is valuable for mapping the rest of the flow
      await browser.close();
      return {
        success: false,
        step: 'evidence',
        eligible: true,
        error: 'Could not find submit button on evidence page — needs manual mapping',
        contestMethod: contestMethod || undefined,
        confirmationText: evidenceText.substring(0, 2000),
        screenshotPath,
      };
    }

    console.log(`${logPrefix} Step 5: Submitting contest...`);
    await submitBtn.click();
    await page.waitForTimeout(5000);

    // ── Step 6: Capture confirmation ──
    const confirmUrl = page.url();
    const confirmText = await page.evaluate(() => document.body.innerText);
    console.log(`${logPrefix} Confirmation page URL: ${confirmUrl}`);

    // Try to extract a confirmation number
    const confirmationId = extractConfirmationId(confirmText);

    // Check for error messages
    if (confirmText.toLowerCase().includes('error') || confirmText.toLowerCase().includes('unable to process')) {
      const screenshotPath = `/tmp/econtest-error-${ticketNumber}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`${logPrefix} Possible error on confirmation page. Screenshot: ${screenshotPath}`);
      await browser.close();
      return {
        success: false,
        step: 'confirmation',
        eligible: true,
        error: 'Portal returned an error on submission',
        confirmationText: confirmText.substring(0, 2000),
        contestMethod: contestMethod || undefined,
        screenshotPath,
      };
    }

    // Take a screenshot of successful submission
    const screenshotPath = `/tmp/econtest-success-${ticketNumber}-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`${logPrefix} Contest submitted successfully! Confirmation: ${confirmationId || 'none captured'}`);

    await browser.close();
    return {
      success: true,
      step: 'confirmation',
      eligible: true,
      confirmationId: confirmationId || undefined,
      confirmationText: confirmText.substring(0, 2000),
      contestMethod: contestMethod || 'Correspondence',
      screenshotPath,
    };
  } catch (err: any) {
    console.error(`${logPrefix} eContest submission failed:`, err.message);
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return {
      success: false,
      step: 'error',
      error: err.message,
    };
  }
}

/**
 * Check if a ticket is eligible for eContest without submitting.
 * Useful for pre-checking before generating letters.
 */
export async function checkEContestEligibility(ticketNumber: string): Promise<{
  eligible: boolean;
  contestMethod?: string;
  status?: string;
  error?: string;
}> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    await page.goto(`${ECONTEST_BASE}/home`, { waitUntil: 'networkidle' });
    await page.fill('#ticket1', ticketNumber);
    await page.click('#searchTickets');
    await page.waitForTimeout(3000);

    const pageText = await page.evaluate(() => document.body.innerText);
    const currentUrl = page.url();

    if (pageText.includes('not eligible') || !currentUrl.includes('eligibleTicketsDisplay')) {
      await browser.close();
      return { eligible: false, error: 'Ticket not eligible' };
    }

    const contestMethod = await page.evaluate(() => {
      const el = document.getElementById('contestMethod') as HTMLInputElement | null;
      return el ? el.value : null;
    });
    const status = await page.evaluate(() => {
      const el = document.getElementById('statusAsString') as HTMLInputElement | null;
      return el ? el.value : null;
    });

    // Check if Continue button exists (means ticket is actually contestable)
    const hasContinue = await page.$('#continue');

    await browser.close();
    return {
      eligible: !!hasContinue,
      contestMethod: contestMethod || undefined,
      status: status || undefined,
    };
  } catch (err: any) {
    if (browser) try { await browser.close(); } catch {}
    return { eligible: false, error: err.message };
  }
}

/** Try to extract a confirmation/reference number from the confirmation page text */
function extractConfirmationId(text: string): string | null {
  // Look for patterns like "Confirmation #: 12345" or "Reference: ABC123"
  const patterns = [
    /confirmation\s*#?\s*:?\s*(\w+)/i,
    /reference\s*#?\s*:?\s*(\w+)/i,
    /hearing\s*#?\s*:?\s*(\w+)/i,
    /case\s*#?\s*:?\s*(\w+)/i,
    /submission\s*id\s*:?\s*(\w+)/i,
  ];
  for (const pat of patterns) {
    const match = text.match(pat);
    if (match) return match[1];
  }
  return null;
}
