// Speculative payment-form fill for an unknown gov payment page.
//
// Pattern: fuzzy-match field labels / names / IDs against expected keys, then
// fill with values from the CITY_PAYMENT_CARD_* env-var bundle. Mirrors the
// login-step approach used in lib/city-sticker-purchase.ts, which has
// proven robust against EzBuy's form quirks.
//
// Returns a structured result so callers can decide to proceed to submit
// or abort with diagnostics. Always screenshots before-and-after so a real
// run that fails gives us the actual selectors to harden against.
//
// NOTE: not yet probed against either EzBuy's or IL SOS's actual payment
// page. First real run is the test. If a screen has fields we didn't match,
// `filled` will report the gap; the screenshot will show what we missed.

import type { Page } from 'playwright';

export interface GovCardConfig {
  number: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  zip: string;
  billFirst: string;
  billLast: string;
  addr1: string;
  billCity: string;
  billState: string;
  billEmail: string;
}

export type FormFieldKey =
  | 'card_number'
  | 'exp_combined'
  | 'exp_month'
  | 'exp_year'
  | 'cvv'
  | 'zip'
  | 'first_name'
  | 'last_name'
  | 'address1'
  | 'city'
  | 'state'
  | 'email'
  | 'confirm_email'
  | 'agree_terms';

interface MatchRule {
  key: FormFieldKey;
  /** lowercase substrings — if any appears in the field blob (id+name+placeholder+label+aria) we match */
  hints: string[];
  /** if the key has already been filled by an earlier-rule match, skip */
  exclusive: boolean;
}

const RULES: MatchRule[] = [
  // Order matters — more specific first.
  { key: 'card_number', hints: ['cardnumber', 'card_number', 'card number', 'pan', 'cc-number', 'ccnumber', 'creditcard', 'credit card', 'card no'], exclusive: true },
  { key: 'cvv', hints: ['cvv', 'cvc', 'securitycode', 'security code', 'cv2', 'cid', 'card-security'], exclusive: true },
  { key: 'exp_combined', hints: ['expirydate', 'expiration date', 'expdate', 'exp_date', 'expdate', 'card-expiry', 'expiry'], exclusive: true },
  { key: 'exp_month', hints: ['expmonth', 'exp_month', 'expiration month', 'expirationmonth', 'cc-exp-month'], exclusive: true },
  { key: 'exp_year', hints: ['expyear', 'exp_year', 'expiration year', 'expirationyear', 'cc-exp-year'], exclusive: true },
  { key: 'first_name', hints: ['firstname', 'first name', 'given name', 'fname'], exclusive: true },
  { key: 'last_name', hints: ['lastname', 'last name', 'family name', 'surname', 'lname'], exclusive: true },
  { key: 'address1', hints: ['address1', 'address 1', 'street address', 'streetaddress', 'addressline1', 'billing address'], exclusive: true },
  { key: 'city', hints: ['billing city', 'city name', 'billingcity', '"city"'], exclusive: true },
  { key: 'state', hints: ['billingstate', 'state code', 'state province', 'billing state'], exclusive: true },
  { key: 'zip', hints: ['zip', 'postal', 'postcode', 'post code'], exclusive: true },
  { key: 'confirm_email', hints: ['confirm email', 'confirmemail', 'verify email', 'email confirmation'], exclusive: true },
  { key: 'email', hints: ['email'], exclusive: true },
  { key: 'agree_terms', hints: ['agreement', 'terms', 'i agree', 'acknowledg', 'serviceagreement', 'service fee'], exclusive: true },
];

function makeBlob(parts: Record<string, string | boolean | null | undefined>): string {
  return Object.values(parts)
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
}

export interface FillResult {
  filled: FormFieldKey[];
  missing: FormFieldKey[];
  /** True if at least the card number + cvv + exp + zip were filled. */
  paymentMinimumMet: boolean;
  attemptedFields: number;
}

const PAYMENT_MINIMUM: FormFieldKey[] = ['card_number', 'cvv', 'zip'];

export async function fillGovPaymentForm(page: Page, cfg: GovCardConfig): Promise<FillResult> {
  const fields = await page.$$('input, select');

  const claimed = new Set<FormFieldKey>();
  const filled: FormFieldKey[] = [];
  let attemptedFields = 0;

  for (const el of fields) {
    attemptedFields++;
    const info = await el.evaluate((e) => {
      const i = e as HTMLInputElement | HTMLSelectElement;
      const id = i.id || '';
      const name = (i as HTMLInputElement).name || '';
      const placeholder = (i as HTMLInputElement).placeholder || '';
      const aria = i.getAttribute('aria-label') || '';
      let labelText = '';
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) labelText = lbl.textContent || '';
      }
      // also check enclosing label
      const wrappingLabel = i.closest('label')?.textContent || '';
      const closestFormGroupLabel = i.closest('.form-group, .form-field, .field, .input-group')?.querySelector('label')?.textContent || '';
      const tag = i.tagName.toLowerCase();
      const type = (i as HTMLInputElement).type || tag;
      const visible = (i as HTMLElement).offsetParent !== null;
      return { id, name, placeholder, aria, labelText, wrappingLabel, closestFormGroupLabel, tag, type, visible };
    });
    if (!info.visible) continue;
    if (info.type === 'hidden' || info.type === 'submit' || info.type === 'button') continue;
    const blob = makeBlob(info);

    for (const rule of RULES) {
      if (rule.exclusive && claimed.has(rule.key)) continue;
      const matched = rule.hints.some((h) => blob.includes(h));
      if (!matched) continue;

      try {
        await fillByKey(el, rule.key, info.tag, cfg);
        claimed.add(rule.key);
        filled.push(rule.key);
      } catch (e) {
        // swallow per-field failure; try other rules / other fields
      }
      break; // one rule per field
    }
  }

  // Resolve the missing list (the ones we wanted to find but didn't).
  // Keys that have a "combined" or "split" alternative are reconciled.
  const has = (k: FormFieldKey) => filled.includes(k);
  const expOK = has('exp_combined') || (has('exp_month') && has('exp_year'));

  const desired: FormFieldKey[] = ['card_number', 'cvv', 'first_name', 'last_name', 'address1', 'city', 'state', 'zip', 'email'];
  const missing = desired.filter((k) => !has(k));
  if (!expOK) missing.push('exp_combined');

  const paymentMinimumMet = PAYMENT_MINIMUM.every((k) => has(k)) && expOK;

  return { filled, missing, paymentMinimumMet, attemptedFields };
}

async function fillByKey(
  el: import('playwright').ElementHandle,
  key: FormFieldKey,
  tag: string,
  cfg: GovCardConfig,
): Promise<void> {
  switch (key) {
    case 'card_number':
      await el.fill(cfg.number);
      return;
    case 'cvv':
      await el.fill(cfg.cvv);
      return;
    case 'exp_combined':
      // common formats: MM/YY or MM/YYYY. Try MM/YY first since many gateways
      // accept it; if rejected we'll know from form validation.
      await el.fill(`${cfg.expMonth}/${cfg.expYear}`);
      return;
    case 'exp_month':
      if (tag === 'select') {
        await (el as any).selectOption(cfg.expMonth).catch(async () => {
          await (el as any).selectOption({ label: cfg.expMonth }).catch(() => {});
        });
      } else {
        await el.fill(cfg.expMonth);
      }
      return;
    case 'exp_year':
      if (tag === 'select') {
        await (el as any).selectOption(cfg.expYear).catch(async () => {
          // Some forms use 2-digit year
          const twoDigit = cfg.expYear.slice(-2);
          await (el as any).selectOption(twoDigit).catch(() => {});
        });
      } else {
        await el.fill(cfg.expYear);
      }
      return;
    case 'first_name':
      await el.fill(cfg.billFirst);
      return;
    case 'last_name':
      await el.fill(cfg.billLast);
      return;
    case 'address1':
      await el.fill(cfg.addr1);
      return;
    case 'city':
      await el.fill(cfg.billCity);
      return;
    case 'state':
      if (tag === 'select') {
        await (el as any).selectOption(cfg.billState.toUpperCase()).catch(async () => {
          await (el as any).selectOption({ label: cfg.billState.toUpperCase() }).catch(() => {});
        });
      } else {
        await el.fill(cfg.billState.toUpperCase());
      }
      return;
    case 'zip':
      await el.fill(cfg.zip);
      return;
    case 'email':
    case 'confirm_email':
      await el.fill(cfg.billEmail);
      return;
    case 'agree_terms':
      // Checkbox — check if not already.
      try {
        const isChecked = await (el as any).isChecked();
        if (!isChecked) await (el as any).check();
      } catch {}
      return;
  }
}

const SUBMIT_BTN_PATTERNS = [
  /\bsubmit\s*payment\b/i,
  /\bpay\s*now\b/i,
  /\bcomplete\s*purchase\b/i,
  /\bcomplete\s*order\b/i,
  /\bplace\s*order\b/i,
  /\bauthorize\s*payment\b/i,
  /\bconfirm\s*(?:payment|order|purchase)\b/i,
  /^submit$/i,
  /^pay$/i,
];

const CONTINUE_BTN_PATTERNS = [
  /\bcontinue\b/i,
  /\bnext\b/i,
  /\breview\b/i,
  /\bproceed\b/i,
];

/**
 * Click whichever button looks most like a final-submit. Returns the
 * button text we clicked (for logging) or null if none found. Caller is
 * responsible for waiting for navigation.
 */
export async function clickPaymentSubmit(page: Page): Promise<string | null> {
  const candidates = await page.$$eval('button, input[type="submit"], input[type="button"]', (els) =>
    els.map((el) => ({
      text: (((el as HTMLElement).textContent || (el as HTMLInputElement).value) || '').trim(),
      visible: (el as HTMLElement).offsetParent !== null,
      disabled: (el as HTMLButtonElement).disabled === true,
    })),
  );
  const usable = candidates.filter((c) => c.visible && !c.disabled);
  // Prefer explicit final-submit patterns.
  for (const pat of SUBMIT_BTN_PATTERNS) {
    const found = usable.find((c) => pat.test(c.text));
    if (found) {
      await page.click(`button:has-text("${found.text}")`, { timeout: 10000 }).catch(async () => {
        await page.getByRole('button', { name: found.text }).first().click({ timeout: 10000 });
      });
      return found.text;
    }
  }
  return null;
}

/**
 * Click a "Continue" / "Next" / "Review" button to advance to the next
 * screen. Used to walk multi-step checkouts toward the payment form.
 * Returns the label clicked or null.
 */
export async function clickContinue(page: Page): Promise<string | null> {
  const candidates = await page.$$eval('button, input[type="submit"], input[type="button"]', (els) =>
    els.map((el) => ({
      text: (((el as HTMLElement).textContent || (el as HTMLInputElement).value) || '').trim(),
      visible: (el as HTMLElement).offsetParent !== null,
      disabled: (el as HTMLButtonElement).disabled === true,
    })),
  );
  const usable = candidates.filter((c) => c.visible && !c.disabled);
  // Skip anything that looks like final submit.
  const safe = usable.filter((c) => !SUBMIT_BTN_PATTERNS.some((p) => p.test(c.text)));
  for (const pat of CONTINUE_BTN_PATTERNS) {
    const found = safe.find((c) => pat.test(c.text));
    if (found) {
      await page.click(`button:has-text("${found.text}")`, { timeout: 10000 }).catch(async () => {
        await page.getByRole('button', { name: found.text }).first().click({ timeout: 10000 });
      });
      return found.text;
    }
  }
  return null;
}

/**
 * Scrape a confirmation reference from the current page. Looks for common
 * label phrasing. Returns null if nothing matches — caller should still
 * persist the screenshot for manual recovery.
 */
export async function scrapeConfirmationReference(page: Page): Promise<string | null> {
  const txt = await page.evaluate(() => document.body?.innerText || '');
  const patterns = [
    /(?:confirmation\s*(?:number|#|no\.?))[:\s]*([A-Z0-9][A-Z0-9\-_]{4,})/i,
    /(?:transaction\s*(?:id|#|number|no\.?))[:\s]*([A-Z0-9][A-Z0-9\-_]{4,})/i,
    /(?:receipt\s*(?:number|#|no\.?))[:\s]*([A-Z0-9][A-Z0-9\-_]{4,})/i,
    /(?:order\s*(?:id|#|number))[:\s]*([A-Z0-9][A-Z0-9\-_]{4,})/i,
    /(?:reference\s*(?:#|number|no\.?))[:\s]*([A-Z0-9][A-Z0-9\-_]{4,})/i,
  ];
  for (const re of patterns) {
    const m = txt.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * True when the current page looks like a payment form (has a card-number
 * input visible). Used to detect "we've arrived at checkout" in multi-step
 * flows.
 */
export async function looksLikePaymentForm(page: Page): Promise<boolean> {
  const fields = await page.$$('input, select');
  for (const el of fields) {
    const info = await el.evaluate((e) => {
      const i = e as HTMLInputElement;
      const blob = `${i.id || ''} ${i.name || ''} ${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`.toLowerCase();
      const visible = (i as HTMLElement).offsetParent !== null;
      return { blob, visible };
    });
    if (!info.visible) continue;
    if (/cardnumber|card_number|cc-number|ccnumber|creditcard|pan/.test(info.blob)) return true;
  }
  return false;
}
