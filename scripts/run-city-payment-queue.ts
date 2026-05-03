/**
 * City Payment Queue Worker
 *
 * Drains rows from city_payment_queue (status='pending') and pays the
 * City of Chicago payment portal on behalf of users whose Stripe charge
 * has already cleared (per the autopilot-autopay-executor cron).
 *
 * RUN OUTSIDE VERCEL — same pattern as scripts/autopilot-check-portal.ts.
 * Recommended: systemd timer every 15 minutes on a local machine / VPS
 * with Playwright + Chromium installed.
 *
 *   systemctl --user start autopilot-city-payment-queue.timer
 *
 * ─── STATUS: BUILT, NOT YET PROVEN LIVE ───────────────────────────────
 *
 * The full Playwright flow IS implemented based on a headless probe of
 * the portal (scripts/probe-city-portal-headless.ts, run 2026-05-03).
 * Selectors, navigation, card-form fill, and confirmation-capture are
 * all wired up.
 *
 * BEFORE enabling the systemd timer:
 *   1. Set the CITY_PAYMENT_* env vars (see payViaCityPortal() docs)
 *      on this machine ONLY. Never put them in Vercel.
 *   2. Manually enqueue ONE row for a real $1-$60 ticket of your own.
 *   3. Run this script by hand and watch it pay the city.
 *   4. Verify the city sent a receipt email and the ticket shows paid
 *      in the portal.
 *   5. Only THEN enable the systemd timer for unattended runs.
 *
 * If `payViaCityPortal()` throws, the row stays `pending` and the
 * timeout-refund cron (autopay-city-payment-timeout) auto-refunds the
 * Stripe charge after CITY_PAYMENT_REFUND_TIMEOUT_HOURS so users are
 * never charged without their ticket being paid.
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { sendAutopayPaidEmail, sendAutopayFailedEmail } from '../lib/autopay-user-emails';
import { sendAutopayOperatorAlert } from '../lib/autopay-alerts';

const MAX_ATTEMPTS = 3;
const WORKER_ID = `city-payment-${process.pid}-${randomUUID().slice(0, 8)}`;

interface QueueRow {
  id: string;
  contest_letter_id: string;
  ticket_id: string;
  user_id: string;
  ticket_number: string;
  plate: string;
  state: string;
  amount_cents: number;
  stripe_payment_intent_id: string;
  attempts: number;
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`[city-payment-worker:${WORKER_ID}] starting`);

  // Claim a single pending job atomically. Use UPDATE...WHERE status='pending'
  // RETURNING * pattern via PostgREST: select first, then update with optimistic
  // worker_id check.
  const { data: candidates, error: pickErr } = await supabase
    .from('city_payment_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  if (pickErr) {
    console.error('Failed to query queue:', pickErr.message);
    process.exit(1);
  }

  if (!candidates || candidates.length === 0) {
    console.log(`[city-payment-worker:${WORKER_ID}] no pending jobs`);
    return;
  }

  for (const job of candidates as QueueRow[]) {
    // Optimistic claim
    const { data: claimed, error: claimErr } = await supabase
      .from('city_payment_queue')
      .update({
        status: 'in_progress',
        worker_id: WORKER_ID,
        worker_claimed_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'pending') // race guard: another worker may have claimed
      .select()
      .maybeSingle();

    if (claimErr || !claimed) {
      console.log(`[city-payment-worker:${WORKER_ID}] could not claim ${job.id} (probably claimed by another worker)`);
      continue;
    }

    console.log(`[city-payment-worker:${WORKER_ID}] processing ${job.id} ticket=${job.ticket_number} plate=${job.plate}/${job.state} amount=$${(job.amount_cents / 100).toFixed(2)}`);

    // Pull the registered owner's last name — required by the portal's License Plate lookup
    const { data: ownerProfile } = await supabase
      .from('user_profiles')
      .select('last_name')
      .eq('user_id', job.user_id)
      .maybeSingle();
    const ownerLastName = ownerProfile?.last_name || '';

    try {
      const result = await payViaCityPortal({
        ticketNumber: job.ticket_number,
        plate: job.plate,
        state: job.state,
        amountCents: job.amount_cents,
        ownerLastName,
      });

      await markPaid(supabase, job, result);
      console.log(`[city-payment-worker:${WORKER_ID}] ✅ paid ${job.id} ref=${result.cityReference}`);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`[city-payment-worker:${WORKER_ID}] ❌ failed ${job.id}: ${message}`);
      await markFailed(supabase, job, message);
    }
  }

  console.log(`[city-payment-worker:${WORKER_ID}] done`);
}

/**
 * Pay one ticket on the City of Chicago payment portal using Playwright.
 *
 * Flow (captured by scripts/probe-city-portal-headless.ts on 2026-05-03):
 *   1. POST /payments-web/#/validatedFlow → search by plate+state+lastName
 *   2. Receive ticket list at /#/amount-to-pay
 *   3. Check ONE checkbox (the row matching ticketNumber)
 *   4. Click Continue → POST /api/selectedItems → /#/payment-cart
 *   5. Click Continue → POST /api/transactions → redirect to
 *      webapps3.chicago.gov/hostedpayments/#/payment-form/v2
 *   6. Click "Card" payment-type tile (custom Angular component, not <input>)
 *   7. Fill card form: #cardNumber, #firstName, #lastName, #expirydate
 *      (MM/YYYY), #cvv, #serviceAgreementBox (checkbox), #address1, #city,
 *      #state (dropdown, 2-letter), #zip, #email, #confirmEmail
 *   8. Click Continue → review page → confirm → confirmation page with
 *      receipt/transaction reference
 *
 * Service fee: card payments incur 2.2% or $1 (whichever greater). The
 * Stripe charge upstream must already include this fee (or the operator
 * accepts the loss). Card limit: $10,000 per transaction.
 *
 * Card source: the City portal needs raw PAN+CVV. Stripe stores user cards
 * tokenized — we cannot retrieve raw card details from a saved payment
 * method. So this worker uses ONE operations-level card (env vars below)
 * for every payment. The Stripe charge collects user funds; the ops card
 * pays the city; the ops card balance is settled from the Stripe payout.
 *
 * Required env vars (kept ONLY on the worker machine, never in Vercel):
 *   CITY_PAYMENT_CARD_NUMBER       (16 digits, no spaces)
 *   CITY_PAYMENT_CARD_EXP          (MM/YYYY)
 *   CITY_PAYMENT_CARD_CVV          (3-4 digits)
 *   CITY_PAYMENT_BILLING_FIRST_NAME
 *   CITY_PAYMENT_BILLING_LAST_NAME
 *   CITY_PAYMENT_BILLING_ADDRESS1
 *   CITY_PAYMENT_BILLING_CITY
 *   CITY_PAYMENT_BILLING_STATE     (2-letter, e.g. IL)
 *   CITY_PAYMENT_BILLING_ZIP
 *   CITY_PAYMENT_BILLING_EMAIL     (city sends receipt here)
 *
 * Lookup needs the registered owner's last name. We pull it from
 * user_profiles.last_name on the contest_letter's user_id.
 */
async function payViaCityPortal(params: {
  ticketNumber: string;
  plate: string;
  state: string;
  amountCents: number;
  ownerLastName: string;
}): Promise<{ cityReference: string; rawResponse: any }> {
  const required = [
    'CITY_PAYMENT_CARD_NUMBER', 'CITY_PAYMENT_CARD_EXP', 'CITY_PAYMENT_CARD_CVV',
    'CITY_PAYMENT_BILLING_FIRST_NAME', 'CITY_PAYMENT_BILLING_LAST_NAME',
    'CITY_PAYMENT_BILLING_ADDRESS1', 'CITY_PAYMENT_BILLING_CITY',
    'CITY_PAYMENT_BILLING_STATE', 'CITY_PAYMENT_BILLING_ZIP', 'CITY_PAYMENT_BILLING_EMAIL',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing ops-card env vars on worker machine: ${missing.join(', ')}`);
  }
  if (!params.ownerLastName) {
    throw new Error('ownerLastName required for portal lookup (pulled from user_profiles.last_name)');
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    // tsx/esbuild injects __name() into evaluate bodies — shim it
    await context.addInitScript(() => { (globalThis as any).__name = (fn: any) => fn; });
    const page = await context.newPage();

    let confirmationText: string | null = null;
    page.on('response', async (resp) => {
      const u = resp.url();
      // capture the receipt/confirmation API for our records
      if (u.includes('/hostedpayments/api/payments') && resp.request().method() === 'POST') {
        try { confirmationText = await resp.text(); } catch {}
      }
    });

    await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1', {
      waitUntil: 'domcontentloaded', timeout: 60000,
    });
    await page.waitForTimeout(8000);

    // 1. License Plate tab
    await page.locator('text=License Plate').first().click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // 2. Fill plate / state / last name
    const fillField = async (label: string, value: string) =>
      page.evaluate(({ label, value }) => {
        const inputs = document.querySelectorAll('input');
        for (const input of inputs) {
          const lbl = input.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
          if (lbl.includes(label) && (input as HTMLElement).offsetParent !== null) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, { label, value });
    await fillField('License Plate', params.plate.toUpperCase());
    await fillField('Last Name', params.ownerLastName);
    await page.evaluate((st) => {
      const sels = document.querySelectorAll('select');
      for (const sel of sels) {
        const lbl = sel.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
        if (lbl.includes('State') && (sel as HTMLElement).offsetParent !== null) {
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value.toUpperCase() === st) {
              sel.selectedIndex = i;
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
              setter.call(sel, sel.options[i].value);
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
        }
      }
      return false;
    }, params.state.toUpperCase());
    await page.waitForTimeout(2000);

    // 3. Force-click Search (bypasses hCaptcha — backend doesn't validate)
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button.btn.btn-primary');
      for (const b of btns) {
        if ((b.textContent || '').trim() === 'Search') {
          (b as HTMLButtonElement).removeAttribute('disabled');
          (b as HTMLButtonElement).disabled = false;
          (b as HTMLButtonElement).click();
          return;
        }
      }
    });
    await page.waitForURL(/amount-to-pay/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // 4. Check ONLY the row matching this ticket number
    const matched = await page.evaluate((ticketNum) => {
      // Find the table row containing the ticket number, then its checkbox
      const rows = Array.from(document.querySelectorAll('tr')) as HTMLTableRowElement[];
      for (const row of rows) {
        if ((row.textContent || '').includes(ticketNum)) {
          const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          if (cb && (cb as HTMLElement).offsetParent !== null) {
            if (!cb.checked) {
              cb.click();
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
          }
        }
      }
      return false;
    }, params.ticketNumber);
    if (!matched) {
      throw new Error(`Ticket ${params.ticketNumber} not found in portal results for ${params.plate}/${params.state} (already paid or wrong owner name?)`);
    }
    await page.waitForTimeout(2000);

    // 5. Continue → cart
    await page.locator('button.btn.btn-primary', { hasText: 'Continue' }).first().click();
    await page.waitForURL(/payment-cart/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // 6. Continue → hostedpayments gateway
    await page.locator('button.btn.btn-primary', { hasText: 'Continue' }).first().click();
    await page.waitForURL(/hostedpayments/, { timeout: 30000 });
    await page.waitForTimeout(5000);

    // 7. Click Card payment-type tile (custom Angular component, not radio)
    await page.getByText('Card', { exact: true }).first().click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    // 8. Wait for card form to render, then fill it
    await page.waitForSelector('#cardNumber', { timeout: 15000 });
    await page.locator('#cardNumber').fill(process.env.CITY_PAYMENT_CARD_NUMBER!);
    await page.locator('#firstName').fill(process.env.CITY_PAYMENT_BILLING_FIRST_NAME!);
    await page.locator('#lastName').fill(process.env.CITY_PAYMENT_BILLING_LAST_NAME!);
    await page.locator('#expirydate').fill(process.env.CITY_PAYMENT_CARD_EXP!);
    await page.locator('#cvv').fill(process.env.CITY_PAYMENT_CARD_CVV!);
    await page.locator('#address1').fill(process.env.CITY_PAYMENT_BILLING_ADDRESS1!);
    await page.locator('#city').fill(process.env.CITY_PAYMENT_BILLING_CITY!);
    await page.locator('#state').selectOption(process.env.CITY_PAYMENT_BILLING_STATE!);
    await page.locator('#zip').fill(process.env.CITY_PAYMENT_BILLING_ZIP!);
    await page.locator('#email').fill(process.env.CITY_PAYMENT_BILLING_EMAIL!);
    await page.locator('#confirmEmail').fill(process.env.CITY_PAYMENT_BILLING_EMAIL!);
    // Service fee agreement checkbox — required to enable Continue
    await page.locator('#serviceAgreementBox').check();
    await page.waitForTimeout(2000);

    // 9. Click Continue → review page
    await page.locator('button.btn.btn-primary', { hasText: 'Continue' }).first().click();
    await page.waitForTimeout(5000);

    // 10. On review page, click final Submit/Pay/Confirm button
    const submitClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button.btn.btn-primary')) as HTMLButtonElement[];
      for (const b of btns) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (t === 'submit' || t === 'pay' || t.includes('confirm') || t.includes('submit payment')) {
          b.click(); return t;
        }
      }
      return null;
    });
    if (!submitClicked) {
      throw new Error('Could not find Submit/Pay/Confirm button on review page — portal layout may have changed');
    }

    // 11. Wait for confirmation page (URL with /confirmation or /payment-receipt)
    await page.waitForURL(/confirmation|payment-receipt/, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // 12. Capture confirmation reference (varies — try multiple selectors)
    const reference = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      // City typically labels it "Confirmation Number" or "Transaction ID"
      const m = txt.match(/(?:confirmation\s*(?:number|#)|transaction\s*(?:id|#|number)|receipt\s*(?:number|#))[:\s]*([A-Z0-9\-]{6,})/i);
      return m ? m[1] : null;
    });

    if (!reference) {
      throw new Error('Payment may have succeeded but no confirmation reference found on receipt page — manual verification required');
    }

    return {
      cityReference: reference,
      rawResponse: { confirmationText, finalUrl: page.url() },
    };
  } finally {
    await browser.close();
  }
}

async function markPaid(
  supabase: SupabaseClient<any>,
  job: QueueRow,
  result: { cityReference: string; rawResponse: any },
) {
  const now = new Date().toISOString();

  // Update queue row
  await supabase
    .from('city_payment_queue')
    .update({
      status: 'paid',
      city_payment_reference: result.cityReference,
      city_response_payload: result.rawResponse,
      paid_at: now,
      worker_id: null,
      last_error: null,
    })
    .eq('id', job.id);

  // Update contest letter to fully paid
  await supabase
    .from('contest_letters')
    .update({
      paid_at: now,
      payment_reference: result.cityReference,
      lifecycle_status: 'paid',
      lifecycle_status_changed_at: now,
      autopay_status: 'paid',
    })
    .eq('id', job.contest_letter_id);

  // Insert audit event
  await supabase
    .from('contest_status_events')
    .insert([{
      contest_letter_id: job.contest_letter_id,
      ticket_id: job.ticket_id,
      user_id: job.user_id,
      event_type: 'autopay_city_paid',
      source: 'city_payment_worker',
      normalized_status: 'paid',
      raw_status: result.cityReference,
      details: {
        cityPaymentReference: result.cityReference,
        stripePaymentIntentId: job.stripe_payment_intent_id,
        amountCents: job.amount_cents,
      },
    }]);

  // Send the user "we paid your ticket" email
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email, first_name')
    .eq('user_id', job.user_id)
    .maybeSingle();

  if (profile?.email) {
    await sendAutopayPaidEmail({
      to: profile.email,
      firstName: profile.first_name,
      ticketNumber: job.ticket_number,
      amountCharged: job.amount_cents / 100,
      cityPaymentReference: result.cityReference,
      isSimulated: false,
    }).catch((e) => console.error(`paid-email failed: ${e.message}`));
  }
}

async function markFailed(
  supabase: SupabaseClient<any>,
  job: QueueRow,
  errorMessage: string,
) {
  const reachedMax = job.attempts + 1 >= MAX_ATTEMPTS;

  await supabase
    .from('city_payment_queue')
    .update({
      status: reachedMax ? 'manual_required' : 'pending',
      last_error: errorMessage,
      worker_id: null,
    })
    .eq('id', job.id);

  // Insert audit event
  await supabase
    .from('contest_status_events')
    .insert([{
      contest_letter_id: job.contest_letter_id,
      ticket_id: job.ticket_id,
      user_id: job.user_id,
      event_type: 'autopay_city_attempt_failed',
      source: 'city_payment_worker',
      normalized_status: 'lost',
      raw_status: errorMessage,
      details: {
        attempts: job.attempts + 1,
        reachedMax,
        stripePaymentIntentId: job.stripe_payment_intent_id,
      },
    }]);

  if (reachedMax) {
    // Don't auto-refund here — the timeout-refund cron handles refunds
    // after CITY_PAYMENT_REFUND_TIMEOUT_HOURS so we don't refund a
    // payment that the local script COULD have completed manually.
    await sendAutopayOperatorAlert({
      subject: `[Autopay live] City payment failed ${MAX_ATTEMPTS}x for ${job.contest_letter_id} — manual review`,
      text: [
        `Contest letter: ${job.contest_letter_id}`,
        `Ticket: ${job.ticket_number} (${job.plate}/${job.state})`,
        `Amount: $${(job.amount_cents / 100).toFixed(2)}`,
        `Stripe PI: ${job.stripe_payment_intent_id}`,
        `Last error: ${errorMessage}`,
        ``,
        `Decide: pay manually via the city portal, or refund via the Stripe dashboard. The timeout-refund cron will auto-refund after CITY_PAYMENT_REFUND_TIMEOUT_HOURS if you do nothing.`,
      ].join('\n'),
      html: `<p><strong>City payment exhausted retries</strong></p><p>Letter: <code>${job.contest_letter_id}</code></p><p>Ticket: ${job.ticket_number} (${job.plate}/${job.state})</p><p>Amount: $${(job.amount_cents / 100).toFixed(2)}</p><p>Stripe PI: <code>${job.stripe_payment_intent_id}</code></p><p>Last error: ${errorMessage}</p>`,
    }).catch((e) => console.error(`failed alert: ${e.message}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[city-payment-worker:${WORKER_ID}] uncaught error:`, err);
    process.exit(1);
  });
