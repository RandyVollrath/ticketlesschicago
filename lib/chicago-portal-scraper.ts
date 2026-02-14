/**
 * Chicago Payment Portal Scraper
 *
 * Automates ticket lookups on the City of Chicago payment portal
 * (webapps1.chicago.gov) using Playwright for browser automation.
 *
 * NO CAPTCHA SOLVING REQUIRED — the scraper bypasses the hCaptcha by
 * filling form fields via native value setters (triggering Angular change
 * detection) and force-enabling the Search button. The backend API at
 * POST /payments-web/api/searches does not validate captcha tokens.
 *
 * The scraper intercepts the JSON response from the API rather than
 * parsing HTML, giving us structured ticket data directly.
 *
 * Cost: $0.00 per lookup (no captcha service needed)
 * Schedule: Monday and Thursday (2x/week) via systemd timers
 *
 * This module is designed to run OUTSIDE of Vercel (local machine or VPS)
 * because Playwright requires a Chromium binary (~300MB).
 */

import { chromium, Browser, Page, Response } from 'playwright';

const PORTAL_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

// Timeout settings
const PAGE_LOAD_TIMEOUT = 60000;
const ANGULAR_BOOTSTRAP_WAIT_MS = 8000; // Angular SPA needs time to bootstrap
const TAB_SWITCH_WAIT_MS = 3000;
const POST_FILL_WAIT_MS = 1000;
const SEARCH_RESPONSE_TIMEOUT_MS = 30000;

// CapSolver fallback — only used when force-click bypass fails
const CAPSOLVER_API_URL = 'https://api.capsolver.com';
const CAPSOLVER_TIMEOUT_MS = 120000; // 2 minutes max for captcha solving

export interface PortalTicket {
  ticket_number: string;
  ticket_type: string; // parking, red light, speed camera
  issue_date: string;
  violation_description: string;
  current_amount_due: number;
  original_amount: number;
  ticket_queue: string; // Notice, Hearing, Determination, etc.
  hearing_disposition: string | null; // Liable, Not Liable, Dismissed, etc.
  notice_number: string | null;
  balance_due: number;
  raw_text: string; // Raw JSON from the API for debugging
}

export interface LookupResult {
  plate: string;
  state: string;
  last_name: string;
  tickets: PortalTicket[];
  error: string | null;
  screenshot_path: string | null;
  captcha_cost: number; // always 0 now — no captcha needed
  lookup_duration_ms: number;
}

/**
 * Parse ticket data from the CHI PAY API response JSON.
 *
 * The API returns structured data at POST /payments-web/api/searches.
 * On success (200), the response contains receivables (tickets).
 * On 422, the response contains an error message (usually "no open receivables").
 */
function parseTicketsFromApiResponse(data: any): PortalTicket[] {
  const tickets: PortalTicket[] = [];

  if (!data) return tickets;

  // The CHI PAY API returns tickets in data.searchResult.itemRows,
  // where each row has an itemFields array of {fieldKey, fieldValue} pairs.
  // This is the current (2026) API format.
  const itemRows = data?.searchResult?.itemRows;
  if (Array.isArray(itemRows) && itemRows.length > 0) {
    for (const row of itemRows) {
      const ticket = parseItemRow(row, JSON.stringify(row));
      if (ticket) {
        tickets.push(ticket);
      }
    }
    return tickets;
  }

  // Legacy fallback: older API format with flat receivable objects
  const receivables =
    data?.searchResult?.receivables ||
    data?.receivables ||
    data?.searchResult?.ticketDetails ||
    data?.results ||
    [];

  if (!Array.isArray(receivables)) {
    if (typeof receivables === 'object' && receivables.ticketNumber) {
      return [parseReceivable(receivables, JSON.stringify(data))];
    }
    return tickets;
  }

  for (const recv of receivables) {
    const ticket = parseReceivable(recv, JSON.stringify(recv));
    if (ticket) {
      tickets.push(ticket);
    }
  }

  return tickets;
}

/**
 * Parse a single itemRow from the CHI PAY API (current 2026 format).
 *
 * Each row has an itemFields array like:
 *   [{ fieldKey: "Ticket Number", fieldValue: "9306367440" }, ...]
 *
 * Known fieldKeys:
 *   "Ticket Number", "Date Issued", "Violation Description", "amountDue",
 *   "Notice Level" (status), "Lic Plate Number", "Lic Plate State",
 *   "receivableType", "receivableDescription", "id", "payable",
 *   "Hearing Start Date", "Hearing End Date", "lastName"
 */
function parseItemRow(row: any, rawJson: string): PortalTicket | null {
  if (!row?.itemFields || !Array.isArray(row.itemFields)) return null;

  // Build a key→value map from the itemFields array
  const fields: Record<string, string> = {};
  for (const field of row.itemFields) {
    if (field.fieldKey && field.fieldValue !== undefined && field.fieldValue !== null) {
      fields[field.fieldKey] = String(field.fieldValue);
    }
  }

  const ticketNumber = fields['Ticket Number'] || '';
  if (!ticketNumber) return null;

  // Parse issue date — API returns ISO format like "2026-02-07T21:07:00"
  const rawDate = fields['Date Issued'] || '';
  let issueDate = rawDate;
  if (rawDate.includes('T')) {
    // Convert to MM/DD/YYYY for consistency with the rest of the codebase
    try {
      const d = new Date(rawDate);
      issueDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    } catch {
      issueDate = rawDate;
    }
  }

  const desc = (fields['Violation Description'] || '').toLowerCase();
  let ticketType = 'parking';
  if (desc.includes('red light') || desc.includes('camera violation')) {
    ticketType = 'red_light';
  } else if (desc.includes('speed') || desc.includes('automated speed')) {
    ticketType = 'speed_camera';
  }

  const amountDue = parseFloat(fields['amountDue'] || '0');
  const noticeLevel = fields['Notice Level'] || '';

  return {
    ticket_number: ticketNumber,
    ticket_type: ticketType,
    issue_date: issueDate,
    violation_description: fields['Violation Description'] || '',
    current_amount_due: amountDue,
    original_amount: amountDue, // API doesn't provide original amount separately
    ticket_queue: noticeLevel,
    hearing_disposition: null,
    notice_number: null,
    balance_due: amountDue,
    raw_text: rawJson.substring(0, 500),
  };
}

/**
 * Parse a single receivable object from the API into our PortalTicket type.
 */
function parseReceivable(recv: any, rawJson: string): PortalTicket {
  // Field names from CHI PAY Angular source / API responses:
  // ticketNumber, ticketType, issueDate, violationDescription,
  // currentAmountDue, originalAmount, ticketQueue, hearingDisposition,
  // noticeNumber, balanceDue

  const ticketNumber = recv.ticketNumber || recv.ticket_number || recv.receivableId || '';
  const issueDate = recv.issueDate || recv.issue_date || recv.violationDate || '';

  // Determine ticket type from violation code or description
  let ticketType = 'parking';
  const desc = (recv.violationDescription || recv.violation_description || recv.description || '').toLowerCase();
  if (desc.includes('red light') || desc.includes('camera violation')) {
    ticketType = 'red_light';
  } else if (desc.includes('speed') || desc.includes('automated speed')) {
    ticketType = 'speed_camera';
  }

  return {
    ticket_number: String(ticketNumber),
    ticket_type: ticketType,
    issue_date: issueDate,
    violation_description: recv.violationDescription || recv.violation_description || recv.description || '',
    current_amount_due: parseFloat(recv.currentAmountDue || recv.current_amount_due || recv.amountDue || 0),
    original_amount: parseFloat(recv.originalAmount || recv.original_amount || recv.fineAmount || 0),
    ticket_queue: recv.ticketQueue || recv.ticket_queue || recv.status || '',
    hearing_disposition: recv.hearingDisposition || recv.hearing_disposition || null,
    notice_number: recv.noticeNumber || recv.notice_number || null,
    balance_due: parseFloat(recv.balanceDue || recv.balance_due || recv.currentAmountDue || recv.amountDue || 0),
    raw_text: rawJson.substring(0, 500),
  };
}

/**
 * Fill a form field using the native value setter to properly trigger
 * Angular's change detection (ngModel / reactive forms).
 *
 * Simply doing input.value = 'x' doesn't fire Angular's input event handler.
 * We must call the native HTMLInputElement.prototype.value setter, then
 * dispatch 'input' and 'change' events with bubbles: true.
 */
async function fillFormField(page: Page, labelText: string, value: string): Promise<boolean> {
  return page.evaluate(({ labelText, value }) => {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      const label = input.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      if (label.includes(labelText) && input.offsetParent !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { labelText, value });
}

/**
 * Select a value in a <select> dropdown and trigger Angular change detection.
 */
async function selectDropdownValue(page: Page, labelText: string, value: string): Promise<boolean> {
  return page.evaluate(({ labelText, value }) => {
    const selects = document.querySelectorAll('select');
    for (const select of selects) {
      const label = select.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      if (label.includes(labelText) && select.offsetParent !== null) {
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === value ||
              select.options[i].text === value ||
              select.options[i].value.toUpperCase() === value.toUpperCase()) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  }, { labelText, value });
}

/**
 * Force-enable and click the Search button.
 *
 * The button is disabled until hCaptcha is solved, but we bypass that by:
 * 1. Removing the 'disabled' attribute
 * 2. Setting .disabled = false
 * 3. Calling .click() via JavaScript (not Playwright .click(), which
 *    would be intercepted by overlay elements)
 *
 * This triggers Angular's (click) handler which calls createSearch(),
 * which posts to /api/searches. The backend does NOT validate captcha.
 */
async function forceClickSearch(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button.btn.btn-primary');
    for (const btn of btns) {
      if (btn.textContent?.trim() === 'Search') {
        const htmlBtn = btn as HTMLButtonElement;
        htmlBtn.removeAttribute('disabled');
        htmlBtn.disabled = false;
        htmlBtn.click();
        return true;
      }
    }
    return false;
  });
}

/**
 * Solve hCaptcha using CapSolver API.
 * Only called as a fallback when the force-click bypass stops working
 * (i.e., the city starts validating captcha tokens server-side).
 *
 * Returns the captcha response token, or null on failure.
 * Cost: ~$0.001-0.003 per solve.
 */
async function solveHCaptchaWithCapSolver(
  page: Page,
  siteKey: string,
  pageUrl: string
): Promise<{ token: string; cost: number } | null> {
  const apiKey = process.env.CAPSOLVER_API_KEY;
  if (!apiKey) {
    console.log('    CAPSOLVER_API_KEY not set — cannot solve captcha');
    return null;
  }

  try {
    console.log('    Solving hCaptcha via CapSolver...');

    // Create task
    const createResp = await fetch(`${CAPSOLVER_API_URL}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'HCaptchaTaskProxyLess',
          websiteURL: pageUrl,
          websiteKey: siteKey,
        },
      }),
    });

    const createData = await createResp.json() as any;
    if (createData.errorId !== 0) {
      console.error(`    CapSolver create error: ${createData.errorDescription}`);
      return null;
    }

    const taskId = createData.taskId;

    // Poll for result
    const deadline = Date.now() + CAPSOLVER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));

      const resultResp = await fetch(`${CAPSOLVER_API_URL}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: apiKey,
          taskId,
        }),
      });

      const resultData = await resultResp.json() as any;

      if (resultData.status === 'ready') {
        console.log('    hCaptcha solved via CapSolver');
        return {
          token: resultData.solution.gRecaptchaResponse,
          cost: 0.002, // approximate per-solve cost
        };
      } else if (resultData.status === 'failed') {
        console.error(`    CapSolver solve failed: ${resultData.errorDescription}`);
        return null;
      }
      // Still processing — continue polling
    }

    console.error('    CapSolver timeout');
    return null;
  } catch (err: any) {
    console.error(`    CapSolver exception: ${err.message}`);
    return null;
  }
}

/**
 * Inject a solved captcha token into the page's hCaptcha widget,
 * then click the (now-enabled) Search button normally.
 */
async function submitWithCaptchaToken(page: Page, token: string): Promise<boolean> {
  return page.evaluate((captchaToken) => {
    // Set the hCaptcha response in the hidden textarea
    const textarea = document.querySelector('textarea[name="h-captcha-response"]') as HTMLTextAreaElement;
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, captchaToken);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Also set g-recaptcha-response (some hCaptcha implementations use this)
    const gTextarea = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement;
    if (gTextarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(gTextarea, captchaToken);
      gTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Try to call the hCaptcha callback directly if available
    try {
      const w = window as any;
      if (w.hcaptcha) {
        // Trigger the verified callback
        const iframes = document.querySelectorAll('iframe[src*="hcaptcha"]');
        if (iframes.length > 0) {
          // The hCaptcha widget should now enable the search button via its callback
          w.hcaptcha.execute?.();
        }
      }
    } catch { /* ignore */ }

    // Now click the search button (should be enabled after captcha token is set)
    // Wait a moment for Angular to process
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        const btns = document.querySelectorAll('button.btn.btn-primary');
        for (const btn of btns) {
          if (btn.textContent?.trim() === 'Search') {
            const htmlBtn = btn as HTMLButtonElement;
            htmlBtn.removeAttribute('disabled');
            htmlBtn.disabled = false;
            htmlBtn.click();
            resolve(true);
            return;
          }
        }
        resolve(false);
      }, 500);
    });
  }, token);
}

/**
 * Extract the hCaptcha site key from the page.
 */
async function getHCaptchaSiteKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Check for data-sitekey attribute on hCaptcha div
    const hcaptchaDiv = document.querySelector('[data-sitekey]');
    if (hcaptchaDiv) return hcaptchaDiv.getAttribute('data-sitekey');

    // Check hCaptcha iframe URL
    const iframe = document.querySelector('iframe[src*="hcaptcha"]');
    if (iframe) {
      const src = iframe.getAttribute('src') || '';
      const match = src.match(/sitekey=([a-f0-9-]+)/);
      if (match) return match[1];
    }

    return null;
  });
}

/**
 * Look up tickets for a single license plate on the Chicago payment portal.
 *
 * This is the primary entry point. It:
 * 1. Loads the portal in a headless browser
 * 2. Clicks the "License Plate" search tab
 * 3. Fills plate, state, and last name fields
 * 4. Force-clicks the Search button (bypassing captcha)
 * 5. If bypass fails, falls back to CapSolver (if CAPSOLVER_API_KEY is set)
 * 6. Intercepts the API response to get structured ticket data
 */
export async function lookupPlateOnPortal(
  plate: string,
  state: string,
  lastName: string,
  options?: {
    browser?: Browser;
    screenshotDir?: string;
    skipCaptcha?: boolean; // Legacy param, ignored — captcha always skipped first
  }
): Promise<LookupResult> {
  const startTime = Date.now();
  let browser: Browser | null = options?.browser || null;
  let ownsBrowser = false;

  const result: LookupResult = {
    plate,
    state,
    last_name: lastName,
    tickets: [],
    error: null,
    screenshot_path: null,
    captcha_cost: 0, // Always 0 — no captcha needed
    lookup_duration_ms: 0,
  };

  try {
    // Launch browser if not provided
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      ownsBrowser = true;
    }

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    console.log(`  Looking up plate ${plate} (${state}) / ${lastName}...`);

    // Set up response interceptor BEFORE navigation
    // We'll capture the POST /api/searches response
    let searchApiResponse: any = null;
    let searchApiStatus: number | null = null;

    page.on('response', async (resp: Response) => {
      const url = resp.url();
      if (url.includes('/payments-web/api/searches') && resp.request().method() === 'POST') {
        searchApiStatus = resp.status();
        try {
          const text = await resp.text();
          searchApiResponse = JSON.parse(text);
        } catch {
          // Response might not be JSON
        }
      }
    });

    // Navigate to portal
    await page.goto(PORTAL_URL, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    // Wait for Angular to bootstrap
    await page.waitForTimeout(ANGULAR_BOOTSTRAP_WAIT_MS);

    // Click "License Plate" tab
    try {
      await page.locator('text=License Plate').first().click();
    } catch {
      if (options?.screenshotDir) {
        const ssPath = `${options.screenshotDir}/debug-${plate}-no-tab.png`;
        await page.screenshot({ path: ssPath, fullPage: true });
        result.screenshot_path = ssPath;
      }
      throw new Error('Could not find License Plate tab');
    }
    await page.waitForTimeout(TAB_SWITCH_WAIT_MS);

    // Fill the form
    const filledPlate = await fillFormField(page, 'License Plate', plate.toUpperCase());
    const filledName = await fillFormField(page, 'Last Name', lastName);
    const selectedState = await selectDropdownValue(page, 'State', state.toUpperCase());

    if (!filledPlate || !filledName || !selectedState) {
      if (options?.screenshotDir) {
        const ssPath = `${options.screenshotDir}/debug-${plate}-fill-failed.png`;
        await page.screenshot({ path: ssPath, fullPage: true });
        result.screenshot_path = ssPath;
      }
      throw new Error(`Form fill incomplete: plate=${filledPlate} name=${filledName} state=${selectedState}`);
    }

    // Wait for Angular to process field changes
    await page.waitForTimeout(POST_FILL_WAIT_MS);

    // Force-click the Search button
    const clicked = await forceClickSearch(page);
    if (!clicked) {
      throw new Error('Could not find Search button to click');
    }

    console.log('    Search submitted, waiting for API response...');

    // Wait for the API response
    const deadline = Date.now() + SEARCH_RESPONSE_TIMEOUT_MS;
    while (Date.now() < deadline && searchApiStatus === null) {
      await page.waitForTimeout(500);
    }

    if (searchApiStatus === null) {
      // Force-click bypass failed — the city may now be validating captcha tokens.
      // Try CapSolver as fallback if API key is configured.
      console.log('    Force-click bypass failed (no API response). Trying CapSolver fallback...');

      const siteKey = await getHCaptchaSiteKey(page);
      if (siteKey && process.env.CAPSOLVER_API_KEY) {
        const capResult = await solveHCaptchaWithCapSolver(page, siteKey, PORTAL_URL);
        if (capResult) {
          result.captcha_cost = capResult.cost;

          // Reset response tracking for retry
          searchApiResponse = null;
          searchApiStatus = null;

          // Submit with the solved token
          const submitted = await submitWithCaptchaToken(page, capResult.token);
          if (submitted) {
            // Wait for API response again
            const retryDeadline = Date.now() + SEARCH_RESPONSE_TIMEOUT_MS;
            while (Date.now() < retryDeadline && searchApiStatus === null) {
              await page.waitForTimeout(500);
            }
          }
        }
      }

      // If still no response after CapSolver attempt
      if (searchApiStatus === null) {
        if (options?.screenshotDir) {
          const ssPath = `${options.screenshotDir}/debug-${plate}-no-response.png`;
          await page.screenshot({ path: ssPath, fullPage: true });
          result.screenshot_path = ssPath;
        }
        throw new Error('No API response received within timeout (bypass + CapSolver both failed)');
      }
    }

    console.log(`    API responded with status ${searchApiStatus}`);

    // Take screenshot for records
    if (options?.screenshotDir) {
      const ssPath = `${options.screenshotDir}/results-${plate}-${Date.now()}.png`;
      await page.screenshot({ path: ssPath, fullPage: true });
      result.screenshot_path = ssPath;
    }

    // Parse the API response
    if (searchApiStatus === 200 && searchApiResponse) {
      // Success - parse ticket data from JSON
      result.tickets = parseTicketsFromApiResponse(searchApiResponse);
      console.log(`    Found ${result.tickets.length} ticket(s) in API response`);

      // If we got a 200 but parseTicketsFromApiResponse returned 0 tickets,
      // the response structure might be different than expected.
      // Log it for debugging.
      if (result.tickets.length === 0) {
        console.log('    API response (no tickets parsed):', JSON.stringify(searchApiResponse).substring(0, 500));

        // Fall back to HTML parsing if API JSON didn't yield tickets but page shows them
        const fallbackTickets = await parseResultsFromPage(page);
        if (fallbackTickets.length > 0) {
          result.tickets = fallbackTickets;
          console.log(`    Fallback HTML parsing found ${fallbackTickets.length} ticket(s)`);
        }
      }
    } else if (searchApiStatus === 422 && searchApiResponse) {
      // 422 = validation error, usually "no open receivables found"
      const errorMsg = searchApiResponse?.searchResult?.errorMessage || '';
      const errorDisplay = searchApiResponse?.searchResult?.errorMessageDisplay || '';

      if (errorMsg.includes('No open receivables') || errorMsg.includes('not be found') || errorMsg.includes('already paid')) {
        // No unpaid tickets - this is a successful lookup with 0 results
        console.log(`    No open tickets for plate ${plate}`);
        result.tickets = [];
      } else {
        // Some other validation error
        result.error = errorDisplay || errorMsg || `API returned ${searchApiStatus}`;
      }
    } else if (searchApiStatus === 500) {
      result.error = searchApiResponse?.message || `API returned 500 Internal Server Error`;
    } else if (searchApiStatus === 401) {
      result.error = 'API returned 401 Unauthorized - session may have expired';
    } else {
      result.error = `Unexpected API status ${searchApiStatus}: ${JSON.stringify(searchApiResponse).substring(0, 300)}`;
    }

    await page.close();
    await context.close();

  } catch (error: any) {
    result.error = error.message || 'Unknown error';
    console.error(`    Error: ${result.error}`);
  } finally {
    if (ownsBrowser && browser) {
      await browser.close();
    }
    result.lookup_duration_ms = Date.now() - startTime;
  }

  return result;
}

/**
 * Fallback: parse ticket data from the rendered HTML page.
 * Used when the API response is 200 but doesn't contain the expected JSON structure.
 */
async function parseResultsFromPage(page: Page): Promise<PortalTicket[]> {
  const tickets: PortalTicket[] = [];

  const jsTickets = await page.evaluate(() => {
    const results: Array<Record<string, string>> = [];
    const rows = document.querySelectorAll('tr, .row, [class*="ticket"], [class*="result"], [class*="receivable"]');
    rows.forEach(row => {
      const text = row.textContent || '';
      if (/\d{10,12}/.test(text)) {
        results.push({ text: text.trim() });
      }
    });
    return results;
  });

  for (const item of jsTickets) {
    const ticket = parseTicketFromText(item.text);
    if (ticket && !tickets.some(t => t.ticket_number === ticket.ticket_number)) {
      tickets.push(ticket);
    }
  }

  return tickets;
}

/**
 * Extract ticket data from a text block (fallback HTML parser).
 */
function parseTicketFromText(text: string): PortalTicket | null {
  if (!text || text.length < 10) return null;

  const ticketMatch = text.match(/\b(\d{10,12})\b/);
  if (!ticketMatch) return null;

  const ticketNumber = ticketMatch[1];
  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const issueDate = dateMatch ? dateMatch[1] : '';

  const amountMatches = text.match(/\$[\d,]+\.?\d{0,2}/g) || [];
  const amounts = amountMatches.map(a => parseFloat(a.replace(/[$,]/g, '')));
  const currentAmount = amounts.length > 0 ? amounts[amounts.length - 1] : 0;
  const originalAmount = amounts.length > 1 ? amounts[0] : currentAmount;

  let ticketType = 'parking';
  const textLower = text.toLowerCase();
  if (textLower.includes('red light') || textLower.includes('camera violation')) {
    ticketType = 'red_light';
  } else if (textLower.includes('speed') || textLower.includes('automated speed')) {
    ticketType = 'speed_camera';
  }

  let violationDesc = '';
  const violationPatterns = [
    /(?:violation|description|type)[:\s]+([^\n$]+)/i,
    /(EXPIRED .+?)(?:\s*\$|\s*\d{1,2}\/)/i,
    /(NO CITY .+?)(?:\s*\$|\s*\d{1,2}\/)/i,
    /(STREET CLEAN.+?)(?:\s*\$|\s*\d{1,2}\/)/i,
    /(FIRE HYDRANT.+?)(?:\s*\$|\s*\d{1,2}\/)/i,
    /(PARKING .+?)(?:\s*\$|\s*\d{1,2}\/)/i,
  ];
  for (const pattern of violationPatterns) {
    const match = text.match(pattern);
    if (match) { violationDesc = match[1].trim(); break; }
  }

  let hearingDisposition: string | null = null;
  for (const disp of ['Liable', 'Not Liable', 'Dismissed', 'Default', 'Contested']) {
    if (textLower.includes(disp.toLowerCase())) { hearingDisposition = disp; break; }
  }

  let ticketQueue = '';
  for (const queue of ['Notice', 'Hearing Requested', 'Hearing', 'Determination', 'Paid', 'Bankruptcy', 'Define']) {
    if (textLower.includes(queue.toLowerCase())) { ticketQueue = queue; break; }
  }

  const noticeMatch = text.match(/notice[:\s#]*(\d+)/i);

  return {
    ticket_number: ticketNumber,
    ticket_type: ticketType,
    issue_date: issueDate,
    violation_description: violationDesc,
    current_amount_due: currentAmount,
    original_amount: originalAmount,
    ticket_queue: ticketQueue,
    hearing_disposition: hearingDisposition,
    notice_number: noticeMatch ? noticeMatch[1] : null,
    balance_due: currentAmount,
    raw_text: text.substring(0, 500),
  };
}

/**
 * Look up multiple plates in sequence, sharing a browser instance.
 * Adds rate limiting between lookups to be polite.
 */
export async function lookupMultiplePlates(
  plates: Array<{ plate: string; state: string; lastName: string }>,
  options?: {
    screenshotDir?: string;
    delayBetweenMs?: number;
    maxPlates?: number;
  }
): Promise<LookupResult[]> {
  const delay = options?.delayBetweenMs ?? 5000;
  const maxPlates = options?.maxPlates ?? 50;
  const platesToCheck = plates.slice(0, maxPlates);

  console.log(`Starting portal lookups for ${platesToCheck.length} plates (no captcha needed)...`);

  let browser: Browser | null = null;
  const results: LookupResult[] = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    for (let i = 0; i < platesToCheck.length; i++) {
      const { plate, state, lastName } = platesToCheck[i];
      console.log(`\n[${i + 1}/${platesToCheck.length}] Checking ${plate} (${state})...`);

      const result = await lookupPlateOnPortal(plate, state, lastName, {
        browser,
        screenshotDir: options?.screenshotDir,
      });

      results.push(result);

      if (result.error) {
        console.log(`  FAILED: ${result.error}`);
      } else {
        console.log(`  Found ${result.tickets.length} ticket(s) (${result.lookup_duration_ms}ms, free)`);
      }

      // Rate limit between lookups
      if (i < platesToCheck.length - 1) {
        console.log(`  Waiting ${delay / 1000}s before next lookup...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const totalTickets = results.reduce((sum, r) => sum + r.tickets.length, 0);
  const failures = results.filter(r => r.error).length;

  console.log(`\nLookup complete:`);
  console.log(`  Plates checked: ${results.length}`);
  console.log(`  Total tickets found: ${totalTickets}`);
  console.log(`  Failures: ${failures}`);
  console.log(`  Cost: $0.00 (no captcha needed)`);

  return results;
}
