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
  issue_datetime: string | null; // Full ISO timestamp from the API (e.g. "2026-02-07T21:07:00") — preserved for correlation with red-light receipt timestamps
  violation_description: string;
  current_amount_due: number;
  original_amount: number;
  ticket_queue: string; // Notice, Hearing, Determination, etc.
  hearing_disposition: string | null; // Liable, Not Liable, Dismissed, etc.
  notice_number: string | null;
  balance_due: number;
  raw_text: string; // Raw JSON from the API for debugging
  // Plate data from the ticket itself (for clerical error detection)
  ticket_plate: string | null; // The plate number ON the ticket (may differ from user's actual plate)
  ticket_state: string | null; // The plate state ON the ticket

  // ── Additional fields the CHI PAY search API exposes ──
  // These were being dropped on the floor before this pass. They don't give
  // us the violation address (that's not in the public payment portal —
  // everything there is labeled "Ticket -- Skeletal"), but they're useful
  // for deduplication, hearing-deadline tracking, and future endpoint probes.

  // Receivable id as exposed by the portal — format "tk:<ticketNumber>".
  // Stable across sessions, can be passed to future detail endpoints.
  portal_receivable_id: string | null;

  // The portal's internal classification, e.g. "Ticket -- Skeletal".
  // Also tracked as a sentinel: if this ever changes to a non-"Skeletal" value
  // for a given plate, the portal may be exposing fuller data.
  receivable_description: string | null;

  // Portal's receivable type code, e.g. "CANVAS_PARKING_TICKET_SKELETAL",
  // "CANVAS_RED_LIGHT", "CANVAS_AUTOMATED_SPEED". More granular than the
  // parking/red_light/speed inference we do off the description.
  receivable_type: string | null;

  // Whether the portal considers this ticket payable right now. Useful for
  // detecting tickets that were moved into collections and no longer have a
  // payable status — affects our contest strategy (collections needs a
  // different approach than active Notice-level tickets).
  payable: boolean | null;

  // Hearing window — when present, gives us a hard deadline to work against.
  hearing_start_date: string | null;
  hearing_end_date: string | null;

  // Registered-owner contact info from the search response's shared
  // `contactInformation` block. This is the address the City of Chicago
  // has on file for the plate — NOT the violation address — but it lets
  // us detect mismatches with the user's profile (improper service /
  // stale registration defenses) and confirm the plate belongs to the
  // person signing the contest letter.
  registered_owner_name: string | null;
  registered_owner_address: string | null; // single-line concatenation
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
  format_warnings: string[]; // Non-fatal warnings about unexpected API response format
  boot_eligibility: BootEligibility | null;
}

// Pre-tow warning signal surfaced by the city's "boot extension" API.
// A non-null result means the plate is currently booted; tow_eligible_date
// is when the city is allowed to tow the vehicle if the boot fee isn't paid.
// The endpoint is POST /payments-web/api/parking/check-boot-extention-eligibility
// (note the city's spelling: "extention"). Response shape observed in the
// portal bundle: { towEligibleDate: "YYYY-MM-DD HH:mm:ss.S", towExtensionEligible: "true"|"false" }
export interface BootEligibility {
  is_booted: boolean;
  tow_eligible_date: string | null; // Proper ISO 8601 with Chicago timezone offset
  tow_extension_eligible: boolean | null;
  api_status: number | null;
  raw: any;
}

// Convert a Chicago wall-clock time string ("YYYY-MM-DD HH:mm:ss[.S]") into
// a proper ISO 8601 UTC string. Handles DST by asking Intl.DateTimeFormat
// what the Chicago offset is for that exact moment. Without this, the server
// (running in UTC) would parse "2026-04-25 08:00:00" as 8am UTC instead of
// 8am CDT — a 5-hour error that would wreck the tow warning messaging.
function chicagoWallTimeToIsoUtc(wall: string): string | null {
  const m = String(wall).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mn, sc] = m.map(Number);
  // Given a candidate UTC Date, compute the Chicago-wall-clock milliseconds it produces.
  const chicagoAsUtcMs = (d: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const f: Record<string, string> = {};
    for (const p of parts) f[p.type] = p.value;
    const chicagoHour = f.hour === '24' ? 0 : +f.hour;
    return Date.UTC(+f.year, +f.month - 1, +f.day, chicagoHour, +f.minute, +f.second);
  };
  const target = Date.UTC(yr, mo - 1, dy, hr, mn, sc);
  // Iterate: compute offset, apply, re-check — handles DST transitions where
  // the offset at the naive moment differs from the offset at the true moment.
  let candidate = new Date(target);
  for (let i = 0; i < 3; i++) {
    const chicago = chicagoAsUtcMs(candidate);
    const offsetMs = candidate.getTime() - chicago; // UTC - Chicago
    const next = new Date(target + offsetMs);
    if (next.getTime() === candidate.getTime()) break;
    candidate = next;
  }
  return candidate.toISOString();
}

// Expected field keys in the CHI PAY API itemRow format (2026).
// Used to detect format drift — if any of these disappear, we alert.
const EXPECTED_ITEM_FIELD_KEYS = [
  'Ticket Number',
  'Date Issued',
  'Violation Description',
  'amountDue',
  'Notice Level',
];

// Additional known field keys (not required but tracked for completeness)
const KNOWN_ITEM_FIELD_KEYS = new Set([
  'Ticket Number', 'Date Issued', 'Violation Description', 'amountDue',
  'Notice Level', 'Lic Plate Number', 'Lic Plate State', 'receivableType',
  'receivableDescription', 'id', 'payable', 'Hearing Start Date',
  'Hearing End Date', 'lastName',
]);

/**
 * Parse ticket data from the CHI PAY API response JSON.
 *
 * The API returns structured data at POST /payments-web/api/searches.
 * On success (200), the response contains receivables (tickets).
 * On 422, the response contains an error message (usually "no open receivables").
 *
 * Returns { tickets, warnings } — warnings are non-fatal format issues that
 * should be logged and alerted on to detect API format changes early.
 */
/**
 * Extract the registered-owner name and mailing address from the shared
 * `searchResult.contactInformation` block and merge into every parsed ticket.
 * This block comes from the City of Chicago's vehicle-registration record
 * for the plate — useful for detecting mismatches against the user's
 * profile (stale registration / improper service defenses), NOT the
 * violation address (which is nowhere in the public portal).
 */
function extractRegisteredOwner(data: any): { name: string | null; address: string | null } {
  const c = data?.searchResult?.contactInformation;
  if (!c || typeof c !== 'object') return { name: null, address: null };
  const name = typeof c.contactName === 'string' && c.contactName.trim() ? c.contactName.trim() : null;

  // Normalize the weird 9-digit zip (city stores as "606222656" — that's a
  // standard 9-digit ZIP+4, just no hyphen) for display.
  const rawZip = typeof c.zipCode === 'string' ? c.zipCode.replace(/\D/g, '') : '';
  const formattedZip = rawZip.length === 9 ? `${rawZip.slice(0, 5)}-${rawZip.slice(5)}` : rawZip || null;

  const parts: string[] = [];
  if (c.addressLine1 && typeof c.addressLine1 === 'string') parts.push(c.addressLine1.trim());
  if (c.addressLine2 && typeof c.addressLine2 === 'string' && c.addressLine2.trim()) parts.push(c.addressLine2.trim());
  const cityStateZip: string[] = [];
  if (c.city && typeof c.city === 'string') cityStateZip.push(c.city.trim());
  if (c.state && typeof c.state === 'string') {
    const s = c.state.trim();
    cityStateZip.push(c.city ? s : s); // join below
  }
  let tail = cityStateZip.filter(Boolean).join(', ');
  if (formattedZip) tail = tail ? `${tail} ${formattedZip}` : formattedZip;
  if (tail) parts.push(tail);
  const address = parts.length ? parts.join(', ') : null;

  return { name, address };
}

function parseTicketsFromApiResponse(data: any): { tickets: PortalTicket[]; warnings: string[] } {
  const tickets: PortalTicket[] = [];
  const warnings: string[] = [];

  if (!data) return { tickets, warnings };

  // ── Schema validation: check top-level structure ──
  if (typeof data !== 'object') {
    warnings.push(`API response is ${typeof data}, expected object`);
    return { tickets, warnings };
  }

  if (!data.searchResult) {
    // Check for any known alternate top-level keys
    const topKeys = Object.keys(data).join(', ');
    warnings.push(`Missing searchResult in API response. Top-level keys: [${topKeys}]`);
  }

  // Shared across every ticket in this response — plate-level owner info.
  const owner = extractRegisteredOwner(data);

  // The CHI PAY API returns tickets in data.searchResult.itemRows,
  // where each row has an itemFields array of {fieldKey, fieldValue} pairs.
  // This is the current (2026) API format.
  const itemRows = data?.searchResult?.itemRows;
  if (Array.isArray(itemRows) && itemRows.length > 0) {
    // Validate field keys on the first row to detect format drift
    const firstRow = itemRows[0];
    if (firstRow?.itemFields && Array.isArray(firstRow.itemFields)) {
      const presentKeys = new Set(firstRow.itemFields.map((f: any) => f?.fieldKey).filter(Boolean));

      // Check required keys
      for (const expectedKey of EXPECTED_ITEM_FIELD_KEYS) {
        if (!presentKeys.has(expectedKey)) {
          warnings.push(`Expected field key "${expectedKey}" missing from itemRow. Present keys: [${Array.from(presentKeys).join(', ')}]`);
        }
      }

      // Check for unknown new keys (format expansion — not critical but worth logging)
      for (const key of presentKeys) {
        if (!KNOWN_ITEM_FIELD_KEYS.has(key as string)) {
          warnings.push(`Unknown new field key "${key}" in itemRow — API may have added new fields`);
        }
      }
    } else {
      warnings.push(`First itemRow has no itemFields array — format changed`);
    }

    for (const row of itemRows) {
      const ticket = parseItemRow(row, JSON.stringify(row));
      if (ticket) {
        ticket.registered_owner_name = owner.name;
        ticket.registered_owner_address = owner.address;
        tickets.push(ticket);
      }
    }

    // If we had rows but parsed 0 tickets, that's a format problem
    if (tickets.length === 0 && itemRows.length > 0) {
      warnings.push(`${itemRows.length} itemRows found but 0 tickets parsed — parsing logic may be outdated`);
    }

    return { tickets, warnings };
  }

  // If searchResult exists but has no itemRows, check what it does have
  if (data?.searchResult && !itemRows) {
    const srKeys = Object.keys(data.searchResult).join(', ');
    // Only warn if there's no error message (422 responses have errorMessage, not itemRows)
    if (!data.searchResult.errorMessage && !data.searchResult.errorMessageDisplay) {
      warnings.push(`searchResult has no itemRows. Keys: [${srKeys}]. Snapshot: ${JSON.stringify(data.searchResult).substring(0, 300)}`);
    }
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
      const t = parseReceivable(receivables, JSON.stringify(data));
      t.registered_owner_name = owner.name;
      t.registered_owner_address = owner.address;
      return { tickets: [t], warnings };
    }
    return { tickets, warnings };
  }

  if (receivables.length > 0) {
    warnings.push(`Using legacy receivables format (${receivables.length} items) — API may have reverted from itemRows format`);
  }

  for (const recv of receivables) {
    const ticket = parseReceivable(recv, JSON.stringify(recv));
    if (ticket) {
      ticket.registered_owner_name = owner.name;
      ticket.registered_owner_address = owner.address;
      tickets.push(ticket);
    }
  }

  return { tickets, warnings };
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

  // Diagnostic logging for camera tickets — capture what the portal actually returns
  // so we can learn what fields are available for vehicle mismatch detection
  const descLower = (fields['Violation Description'] || '').toLowerCase();
  if (descLower.includes('red light') || descLower.includes('camera') || descLower.includes('speed') || descLower.includes('automated')) {
    console.log(`    [Camera Ticket Diagnostics] Ticket #${ticketNumber}`);
    console.log(`    [Camera Ticket Diagnostics] All fields: ${JSON.stringify(fields)}`);
  }

  // Parse issue date — API returns ISO format like "2026-02-07T21:07:00"
  const rawDate = fields['Date Issued'] || '';
  let issueDate = rawDate;
  let issueDatetime: string | null = null;
  if (rawDate.includes('T')) {
    // Preserve the full ISO timestamp for correlation with red-light receipt data
    issueDatetime = rawDate;
    // Also produce MM/DD/YYYY for display/backward compatibility
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

  // Normalize hearing dates — the API returns them only for tickets that are
  // already in the hearing queue; empty strings come through for others.
  const hearingStart = fields['Hearing Start Date'] || null;
  const hearingEnd = fields['Hearing End Date'] || null;

  const payableRaw = fields['payable'];
  const payable = payableRaw === 'true' ? true : payableRaw === 'false' ? false : null;

  return {
    ticket_number: ticketNumber,
    ticket_type: ticketType,
    issue_date: issueDate,
    issue_datetime: issueDatetime,
    violation_description: fields['Violation Description'] || '',
    current_amount_due: amountDue,
    original_amount: amountDue, // API doesn't provide original amount separately
    ticket_queue: noticeLevel,
    hearing_disposition: null,
    notice_number: null,
    balance_due: amountDue,
    raw_text: rawJson.substring(0, 500),
    ticket_plate: fields['Lic Plate Number'] || null,
    ticket_state: fields['Lic Plate State'] || null,
    portal_receivable_id: fields['id'] || null,
    receivable_description: fields['receivableDescription'] || null,
    receivable_type: fields['receivableType'] || null,
    payable,
    hearing_start_date: hearingStart && hearingStart.trim() ? hearingStart : null,
    hearing_end_date: hearingEnd && hearingEnd.trim() ? hearingEnd : null,
    registered_owner_name: null, // filled in by the caller from searchResult.contactInformation
    registered_owner_address: null,
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

  // Legacy format may have ISO timestamps too
  let issueDatetimeLegacy: string | null = null;
  if (issueDate && issueDate.includes('T')) {
    issueDatetimeLegacy = issueDate;
  }

  return {
    ticket_number: String(ticketNumber),
    ticket_type: ticketType,
    issue_date: issueDate,
    issue_datetime: issueDatetimeLegacy,
    violation_description: recv.violationDescription || recv.violation_description || recv.description || '',
    current_amount_due: parseFloat(recv.currentAmountDue || recv.current_amount_due || recv.amountDue || '0') || 0,
    original_amount: parseFloat(recv.originalAmount || recv.original_amount || recv.fineAmount || '0') || 0,
    ticket_queue: recv.ticketQueue || recv.ticket_queue || recv.status || '',
    hearing_disposition: recv.hearingDisposition || recv.hearing_disposition || null,
    notice_number: recv.noticeNumber || recv.notice_number || null,
    balance_due: parseFloat(recv.balanceDue || recv.balance_due || recv.currentAmountDue || recv.amountDue || '0') || 0,
    raw_text: rawJson.substring(0, 500),
    ticket_plate: recv.licPlateNumber || recv.lic_plate_number || recv.plateNumber || null,
    ticket_state: recv.licPlateState || recv.lic_plate_state || recv.plateState || null,
    portal_receivable_id: recv.id || recv.receivableId || null,
    receivable_description: recv.receivableDescription || recv.receivable_description || null,
    receivable_type: recv.receivableType || recv.receivable_type || null,
    payable: typeof recv.payable === 'boolean' ? recv.payable : recv.payable === 'true' ? true : recv.payable === 'false' ? false : null,
    hearing_start_date: recv.hearingStartDate || recv.hearing_start_date || null,
    hearing_end_date: recv.hearingEndDate || recv.hearing_end_date || null,
    registered_owner_name: null,
    registered_owner_address: null,
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
 * Probe the city's "boot extension" endpoint to see if a plate is currently
 * booted, and if so when the vehicle becomes tow-eligible. Runs inside the
 * authenticated browser context that the search just established.
 *
 * Endpoint: POST /payments-web/api/parking/check-boot-extention-eligibility
 * (the city really spells it "extention") — observed in the portal bundle.
 *
 * Response when booted: { towEligibleDate, towExtensionEligible, ... }
 * Response when not booted: empty array / null / no towEligibleDate.
 */
async function probeBootEligibility(page: Page, plate: string): Promise<BootEligibility> {
  // Drive the boot-extend form as a real user would. The city's backend ties
  // auth on check-boot-extention-eligibility to session state that only
  // gets established by actually loading the boot-extend page, entering a
  // plate, and submitting — direct fetches return 401.
  let bootApiStatus: number | null = null;
  let bootApiBody: any = null;
  const steps: any[] = [];

  const onResp = async (resp: Response) => {
    const url = resp.url();
    if (url.includes('/check-boot-extention-eligibility')) {
      bootApiStatus = resp.status();
      try { bootApiBody = JSON.parse(await resp.text()); } catch {}
      steps.push({ kind: 'intercepted', status: resp.status() });
    }
  };
  page.on('response', onResp);

  try {
    await page.goto('https://webapps1.chicago.gov/payments-web/#/boot-extend?cityServiceId=1', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(6000); // Angular bootstrap

    // Fill the plateNumber input. Prefer the Angular formControlName; fall
    // back to the first visible text input if the control name changes.
    const filled = await page.evaluate((p: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const candidates: HTMLInputElement[] = [];
      document.querySelectorAll<HTMLInputElement>('input[formcontrolname="plateNumber"], input[name="plateNumber"]').forEach(i => candidates.push(i));
      if (candidates.length === 0) {
        document.querySelectorAll<HTMLInputElement>('input').forEach(i => {
          if ((i as HTMLElement).offsetParent !== null && (i.type === 'text' || i.type === '')) candidates.push(i);
        });
      }
      for (const input of candidates) {
        if ((input as HTMLElement).offsetParent === null) continue;
        setter.call(input, p);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, selector: input.getAttribute('formcontrolname') || input.name || input.type };
      }
      return { ok: false, selector: null };
    }, plate.toUpperCase());
    steps.push({ kind: 'fill', filled });

    if (!filled?.ok) {
      return { is_booted: false, tow_eligible_date: null, tow_extension_eligible: null, api_status: null, raw: { error: 'could-not-fill-boot-form', steps } };
    }

    await page.waitForTimeout(500);

    // Find and click the submit button — commonly labeled "Continue" or "Submit" on city forms.
    const submitClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      for (const b of btns) {
        const visible = (b as HTMLElement).offsetParent !== null;
        if (!visible) continue;
        const t = (b.textContent || '').trim().toLowerCase();
        if (t === 'continue' || t === 'submit' || t === 'check eligibility' || t === 'next') {
          b.disabled = false;
          b.removeAttribute('disabled');
          b.click();
          return t;
        }
      }
      return null;
    });
    steps.push({ kind: 'submit', clicked: submitClicked });

    // Wait up to 20s for the boot-eligibility response
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && bootApiStatus === null) {
      await page.waitForTimeout(500);
    }
    steps.push({ kind: 'wait-done', status: bootApiStatus });
  } finally {
    page.off('response', onResp);
  }

  const final = { status: bootApiStatus, body: bootApiBody };

  // Empty body / null / array-of-length-zero / missing towEligibleDate ⇒ not booted
  const body = final?.body;
  const record = Array.isArray(body) ? body[0] : body;
  const rawTowDate = record && typeof record === 'object' ? record.towEligibleDate ?? null : null;
  const isBooted = !!rawTowDate;
  const isoTowDate = rawTowDate ? chicagoWallTimeToIsoUtc(String(rawTowDate)) : null;
  const ext = record && typeof record === 'object' ? record.towExtensionEligible : null;
  const normalizedExt = ext === true || ext === 'true' ? true : ext === false || ext === 'false' ? false : null;
  return {
    is_booted: isBooted,
    tow_eligible_date: isoTowDate,
    tow_extension_eligible: normalizedExt,
    api_status: final?.status ?? null,
    raw: { final, steps },
  };
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
 * 7. Probes the boot-extension endpoint to capture tow-eligible-date for booted plates
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
    format_warnings: [],
    boot_eligibility: null,
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
      // Success - parse ticket data from JSON with format validation
      const parsed = parseTicketsFromApiResponse(searchApiResponse);
      result.tickets = parsed.tickets;
      result.format_warnings = parsed.warnings;

      // Log any format warnings — these indicate the API may have changed
      if (parsed.warnings.length > 0) {
        console.warn(`    ⚠ ${parsed.warnings.length} format warning(s) for plate ${plate}:`);
        for (const w of parsed.warnings) {
          console.warn(`      - ${w}`);
        }
      }

      console.log(`    Found ${result.tickets.length} ticket(s) in API response`);

      // If we got a 200 but parsing returned 0 tickets,
      // the response structure might be different than expected.
      // Log it for debugging.
      if (result.tickets.length === 0) {
        console.log('    API response (no tickets parsed):', JSON.stringify(searchApiResponse).substring(0, 500));

        // Fall back to HTML parsing if API JSON didn't yield tickets but page shows them
        const fallbackTickets = await parseResultsFromPage(page);
        if (fallbackTickets.length > 0) {
          result.tickets = fallbackTickets;
          result.format_warnings.push(`Used HTML fallback parsing — API JSON yielded 0 tickets but HTML had ${fallbackTickets.length}`);
          console.log(`    Fallback HTML parsing found ${fallbackTickets.length} ticket(s)`);
        }
      }
    } else if (searchApiStatus === 422 && searchApiResponse) {
      // 422 = validation error, usually "no open receivables found"
      const errorMsg = searchApiResponse?.searchResult?.errorMessage || '';
      const errorDisplay = searchApiResponse?.searchResult?.errorMessageDisplay || '';

      const lowerMsg = errorMsg.toLowerCase();
      if (lowerMsg.includes('no open receivables') || lowerMsg.includes('not be found') || lowerMsg.includes('already paid')) {
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

    // Probe boot eligibility. The city's "boot extension" endpoint exposes
    // towEligibleDate — when a currently-booted vehicle becomes tow-eligible
    // if unpaid. For non-booted plates the response is empty/null. Runs in
    // the browser so it inherits the authenticated session from the search.
    try {
      result.boot_eligibility = await probeBootEligibility(page, plate);
    } catch (bootErr: any) {
      result.format_warnings.push(`boot-eligibility probe failed: ${bootErr.message}`);
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
  const amounts = amountMatches.map(a => parseFloat(a.replace(/[$,]/g, ''))).filter(n => !isNaN(n));
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
    issue_datetime: null, // Not available from text parsing
    violation_description: violationDesc,
    current_amount_due: currentAmount,
    original_amount: originalAmount,
    ticket_queue: ticketQueue,
    hearing_disposition: hearingDisposition,
    notice_number: noticeMatch ? noticeMatch[1] : null,
    balance_due: currentAmount,
    raw_text: text.substring(0, 500),
    ticket_plate: null, // Not available from text parsing
    ticket_state: null,
    portal_receivable_id: null,
    receivable_description: null,
    receivable_type: null,
    payable: null,
    hearing_start_date: null,
    hearing_end_date: null,
    registered_owner_name: null,
    registered_owner_address: null,
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

    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5; // Abort run if portal seems down

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
        consecutiveErrors++;

        // If we hit too many errors in a row, the portal is probably down
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(`\n  ⚠ ${MAX_CONSECUTIVE_ERRORS} consecutive errors — portal may be down. Aborting remaining lookups.`);
          break;
        }
      } else {
        console.log(`  Found ${result.tickets.length} ticket(s) (${result.lookup_duration_ms}ms, free)`);
        consecutiveErrors = 0; // Reset on success
      }

      // Rate limit between lookups — with exponential backoff on errors
      if (i < platesToCheck.length - 1) {
        // Back off: double the delay for each consecutive error (up to 60s)
        const backoffMultiplier = consecutiveErrors > 0 ? Math.min(Math.pow(2, consecutiveErrors), 12) : 1;
        const actualDelay = Math.min(delay * backoffMultiplier, 60000);

        if (backoffMultiplier > 1) {
          console.log(`  Backing off: ${actualDelay / 1000}s (${backoffMultiplier}x due to ${consecutiveErrors} consecutive error(s))`);
        } else {
          console.log(`  Waiting ${actualDelay / 1000}s before next lookup...`);
        }
        await new Promise(resolve => setTimeout(resolve, actualDelay));
      }
    }

  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const totalTickets = results.reduce((sum, r) => sum + r.tickets.length, 0);
  const failures = results.filter(r => r.error).length;

  // Aggregate format warnings across all lookups
  const allWarnings = results.flatMap(r => r.format_warnings);
  const uniqueWarnings = [...new Set(allWarnings)];

  console.log(`\nLookup complete:`);
  console.log(`  Plates checked: ${results.length}`);
  console.log(`  Total tickets found: ${totalTickets}`);
  console.log(`  Failures: ${failures}`);
  console.log(`  Cost: $0.00 (no captcha needed)`);

  if (uniqueWarnings.length > 0) {
    console.warn(`\n  ⚠ FORMAT WARNINGS (${uniqueWarnings.length} unique):`);
    for (const w of uniqueWarnings) {
      console.warn(`    - ${w}`);
    }
    console.warn('  → The CHI PAY API format may have changed. Review scraper parsing logic.');

    // Send admin email alert about format changes
    try {
      await sendFormatChangeAlert(uniqueWarnings, results.length, totalTickets, failures);
    } catch (alertErr: any) {
      console.error(`  Failed to send format alert email: ${alertErr.message}`);
    }
  }

  return results;
}

/**
 * Run multiple browser instances in parallel, each processing a slice of plates.
 *
 * Instead of 1 browser doing 1,000 plates sequentially (6+ hours),
 * we run e.g. 3 browsers doing 333 plates each (~2 hours).
 *
 * @param concurrency Number of parallel browser instances (default 3, max 5)
 */
export async function lookupMultiplePlatesParallel(
  plates: Array<{ plate: string; state: string; lastName: string }>,
  options?: {
    screenshotDir?: string;
    delayBetweenMs?: number;
    maxPlates?: number;
    concurrency?: number;
  }
): Promise<LookupResult[]> {
  const concurrency = Math.min(options?.concurrency ?? 3, 5);
  const maxPlates = options?.maxPlates ?? plates.length;
  const platesToCheck = plates.slice(0, maxPlates);

  if (platesToCheck.length === 0) return [];

  if (platesToCheck.length <= 10 || concurrency <= 1) {
    return lookupMultiplePlates(platesToCheck, options);
  }

  const chunks: Array<Array<{ plate: string; state: string; lastName: string }>> = [];
  const chunkSize = Math.ceil(platesToCheck.length / concurrency);
  for (let i = 0; i < platesToCheck.length; i += chunkSize) {
    chunks.push(platesToCheck.slice(i, i + chunkSize));
  }

  console.log(`\n=== PARALLEL SCRAPER: ${platesToCheck.length} plates across ${chunks.length} browser instances ===`);
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  Worker ${i + 1}: ${chunks[i].length} plates`);
  }

  const workerPromises = chunks.map((chunk, index) => {
    return new Promise<LookupResult[]>(async (resolve) => {
      // Stagger browser launches by 2s
      if (index > 0) {
        await new Promise(r => setTimeout(r, index * 2000));
      }
      console.log(`  Worker ${index + 1} starting (${chunk.length} plates)...`);
      try {
        const results = await lookupMultiplePlates(chunk, {
          ...options,
          maxPlates: chunk.length,
        });
        console.log(`  Worker ${index + 1} finished: ${results.filter(r => !r.error).length}/${results.length} succeeded`);
        resolve(results);
      } catch (err: any) {
        console.error(`  Worker ${index + 1} crashed: ${err.message}`);
        resolve(chunk.map(p => ({
          plate: p.plate,
          state: p.state,
          last_name: p.lastName,
          tickets: [],
          error: `Worker crashed: ${err.message}`,
          screenshot_path: null,
          captcha_cost: 0,
          lookup_duration_ms: 0,
          format_warnings: [],
          boot_eligibility: null,
        })));
      }
    });
  });

  const allResults = await Promise.all(workerPromises);
  const flatResults = allResults.flat();

  const totalTickets = flatResults.reduce((sum, r) => sum + r.tickets.length, 0);
  const failures = flatResults.filter(r => r.error).length;

  console.log(`\n=== PARALLEL SCRAPER COMPLETE ===`);
  console.log(`  Total plates: ${flatResults.length}`);
  console.log(`  Tickets found: ${totalTickets}`);
  console.log(`  Failures: ${failures}`);
  console.log(`  Workers used: ${chunks.length}`);

  return flatResults;
}

/**
 * Send an admin email alert when the portal API response format appears to have changed.
 * Uses Resend API directly (no import needed — this module runs outside Vercel).
 */
async function sendFormatChangeAlert(
  warnings: string[],
  platesChecked: number,
  ticketsFound: number,
  failures: number,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('  RESEND_API_KEY not set — cannot send format alert email');
    return;
  }

  const warningList = warnings.map(w => `• ${w}`).join('\n');
  const subject = `⚠ Portal Scraper: API Format Change Detected (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`;
  const body = `The CHI PAY portal scraper detected unexpected changes in the API response format during the latest run.

Run Summary:
- Plates checked: ${platesChecked}
- Tickets found: ${ticketsFound}
- Failures: ${failures}
- Format warnings: ${warnings.length}

Warnings:
${warningList}

Action Required:
Review lib/chicago-portal-scraper.ts — the parseTicketsFromApiResponse() function may need updating to match the new API format. If tickets are still being parsed correctly, these warnings may just indicate new optional fields (safe to add to KNOWN_ITEM_FIELD_KEYS).

This is an automated alert from the autopilot portal scraper.`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Autopilot <alerts@autopilotamerica.com>',
      to: ['randy@autopilotamerica.com'],
      subject,
      text: body,
    }),
  });

  console.log('  Format alert email sent to admin');
}
