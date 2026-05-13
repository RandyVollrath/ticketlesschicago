#!/usr/bin/env tsx
/**
 * Synthetic-HTML test of lib/gov-payment-form's fuzzy matcher.
 *
 * Builds an in-memory HTML page with common payment-form patterns,
 * runs fillGovPaymentForm against it, asserts every expected field
 * got the right value. Covers patterns we'd expect to see on EzBuy
 * and IL SOS without needing to authenticate against either.
 *
 * Run: npx tsx scripts/test-gov-payment-form.ts
 */

import { chromium } from 'playwright';
import { fillGovPaymentForm, clickPaymentSubmit, scrapeConfirmationReference, looksLikePaymentForm } from '../lib/gov-payment-form';

const CARD = {
  number: '4242424242424242',
  expMonth: '12',
  expYear: '2029',
  cvv: '123',
  zip: '60601',
  billFirst: 'Ada',
  billLast: 'Lovelace',
  addr1: '123 Test Lane',
  billCity: 'Chicago',
  billState: 'IL',
  billEmail: 'ada@example.com',
};

interface Variant {
  name: string;
  html: string;
  expectFilled: Record<string, string>;
  expectPaymentMinimumMet?: boolean;
}

const VARIANTS: Variant[] = [
  {
    name: 'hostedpayments-style (matches existing ticket portal)',
    html: `
      <form>
        <label for="cardNumber">Card Number</label><input id="cardNumber" name="cardNumber" type="text" />
        <label for="expirydate">Expiration Date (MM/YYYY)</label><input id="expirydate" name="expirydate" type="text" />
        <label for="cvv">CVV</label><input id="cvv" name="cvv" type="text" />
        <label for="firstName">First Name</label><input id="firstName" name="firstName" type="text" />
        <label for="lastName">Last Name</label><input id="lastName" name="lastName" type="text" />
        <label for="address1">Address</label><input id="address1" name="address1" type="text" />
        <label for="city">City</label><input id="city" name="city" type="text" />
        <label for="state">State</label>
        <select id="state" name="state"><option value="">--</option><option value="IL">IL</option><option value="WI">WI</option></select>
        <label for="zip">Zip</label><input id="zip" name="zip" type="text" />
        <label for="email">Email</label><input id="email" name="email" type="email" />
        <label for="confirmEmail">Confirm Email</label><input id="confirmEmail" name="confirmEmail" type="email" />
        <label for="serviceAgreementBox">I agree to the service fee</label><input id="serviceAgreementBox" type="checkbox" />
        <button type="submit">Submit Payment</button>
      </form>
    `,
    expectFilled: {
      cardNumber: '4242424242424242',
      expirydate: '12/2029',
      cvv: '123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      address1: '123 Test Lane',
      city: 'Chicago',
      state: 'IL',
      zip: '60601',
      email: 'ada@example.com',
      confirmEmail: 'ada@example.com',
    },
    expectPaymentMinimumMet: true,
  },
  {
    name: 'split-month-year date',
    html: `
      <form>
        <label for="cc-num">Credit Card Number</label><input id="cc-num" name="cc-num" />
        <label for="exp-month">Expiration Month</label>
        <select id="exp-month" name="exp-month">
          <option value="">MM</option>
          <option value="11">11</option><option value="12">12</option>
        </select>
        <label for="exp-year">Expiration Year</label>
        <select id="exp-year" name="exp-year">
          <option value="">YYYY</option>
          <option value="2028">2028</option><option value="2029">2029</option>
        </select>
        <label for="security-code">Security Code</label><input id="security-code" name="cvc" />
        <label for="postal">Postal Code</label><input id="postal" name="postal" />
        <label for="emailaddr">Email Address</label><input id="emailaddr" name="emailaddr" type="email" />
        <button type="submit">Pay Now</button>
      </form>
    `,
    expectFilled: {
      'cc-num': '4242424242424242',
      'exp-month': '12',
      'exp-year': '2029',
      'security-code': '123',
      postal: '60601',
      emailaddr: 'ada@example.com',
    },
    expectPaymentMinimumMet: true,
  },
  {
    name: 'aria-label-only fields (no <label>)',
    html: `
      <form>
        <input id="f1" aria-label="Card Number" />
        <input id="f2" aria-label="Expiration Date" />
        <input id="f3" aria-label="CVV" />
        <input id="f4" aria-label="Billing Zip" />
        <input id="f5" aria-label="First Name" />
        <input id="f6" aria-label="Last Name" />
        <input id="f7" aria-label="Email" type="email" />
        <button type="submit">Complete Purchase</button>
      </form>
    `,
    expectFilled: {
      f1: '4242424242424242',
      f2: '12/2029',
      f3: '123',
      f4: '60601',
      f5: 'Ada',
      f6: 'Lovelace',
      f7: 'ada@example.com',
    },
    expectPaymentMinimumMet: true,
  },
  {
    name: 'missing-card-number form should NOT report minimum met',
    html: `
      <form>
        <label for="cvv">CVV</label><input id="cvv" name="cvv" />
        <label for="email">Email</label><input id="email" name="email" type="email" />
        <button>Submit Payment</button>
      </form>
    `,
    expectFilled: {
      cvv: '123',
      email: 'ada@example.com',
    },
    expectPaymentMinimumMet: false,
  },
];

let failures = 0;

function expect(cond: boolean, msg: string) {
  if (cond) {
    console.log(`    ✓ ${msg}`);
  } else {
    console.log(`    ✗ ${msg}`);
    failures++;
  }
}

async function runVariant(v: Variant) {
  console.log(`\nvariant: ${v.name}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>${v.html}</body></html>`);

    // 1. Detection (only true for variants with a card-number field)
    const hasCardField = await looksLikePaymentForm(page);
    if (v.expectPaymentMinimumMet) {
      expect(hasCardField, 'looksLikePaymentForm true');
    }

    const result = await fillGovPaymentForm(page, CARD);
    expect(result.paymentMinimumMet === Boolean(v.expectPaymentMinimumMet), `paymentMinimumMet=${v.expectPaymentMinimumMet}`);

    for (const [id, expected] of Object.entries(v.expectFilled)) {
      const got = await page.$eval(`#${id}`, (el: any) => el.value);
      expect(got === expected, `#${id} = "${expected}" (got "${got}")`);
    }

    const submitLabel = await clickPaymentSubmit(page).catch(() => null);
    if (v.expectPaymentMinimumMet) {
      expect(Boolean(submitLabel), `clickPaymentSubmit found a button (${submitLabel})`);
    }
  } finally {
    await browser.close();
  }
}

async function testConfirmationScraping() {
  console.log('\nvariant: confirmation reference scraping');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const cases: Array<{ html: string; expected: string }> = [
      { html: '<div>Thanks! Confirmation Number: ABC123XYZ</div>', expected: 'ABC123XYZ' },
      { html: '<p>Your transaction id is TXN-987654321.</p>', expected: 'TXN-987654321' },
      { html: '<h2>Receipt #: 0001234567</h2>', expected: '0001234567' },
      { html: '<div>Order ID: ORDER_2026_05_13</div>', expected: 'ORDER_2026_05_13' },
    ];
    for (const c of cases) {
      await page.setContent(`<!DOCTYPE html><html><body>${c.html}</body></html>`);
      const got = await scrapeConfirmationReference(page);
      expect(got === c.expected, `${c.html.replace(/<[^>]+>/g, '')} → ${c.expected} (got ${got})`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('Testing lib/gov-payment-form against synthetic HTML payment forms');
  for (const v of VARIANTS) await runVariant(v);
  await testConfirmationScraping();
  console.log(`\n${failures === 0 ? '✅ ALL ASSERTIONS PASSED' : `❌ ${failures} assertion(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
