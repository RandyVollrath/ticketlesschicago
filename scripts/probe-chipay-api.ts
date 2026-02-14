import { chromium } from 'playwright';

async function probeWithFilledForm() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const allResponses: { method: string; url: string; status: number; reqBody?: string; respBody?: string }[] = [];

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/payments-web/') && (url.includes('/api/') || url.includes('/security/'))) {
      let body = '';
      try { body = (await resp.text()).substring(0, 10000); } catch {}
      allResponses.push({
        method: resp.request().method(),
        url,
        status: resp.status(),
        reqBody: resp.request().postData() || undefined,
        respBody: body,
      });
    }
  });

  console.log('Loading CHI PAY portal...');
  await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(8000);

  // Click License Plate tab
  console.log('Clicking License Plate tab...');
  await page.locator('text=License Plate').first().click();
  await page.waitForTimeout(3000);

  // === APPROACH 1: Fill form via Angular model and force-click ===
  console.log('\n=== APPROACH 1: Fill form via Angular model + force-click ===');

  // Set the field values via Angular's internal model by dispatching input events
  const fillResult = await page.evaluate(() => {
    // Find all visible input/select elements in the form
    const inputs = document.querySelectorAll('input');
    const selects = document.querySelectorAll('select');
    const results: string[] = [];

    // Find the License Plate input (it has maxlength=8 based on searchFields data)
    for (const input of inputs) {
      const label = input.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      const placeholder = input.placeholder || '';
      results.push(`input: label="${label}" placeholder="${placeholder}" visible=${input.offsetParent !== null} type=${input.type}`);

      if (label.includes('License Plate') || label.includes('Plate')) {
        // Set native value setter to trigger Angular change detection
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        nativeInputValueSetter.call(input, 'CW22016');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        results.push('  -> Filled plate: CW22016');
      }
      if (label.includes('Last Name')) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        nativeInputValueSetter.call(input, 'VOLLRATH');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        results.push('  -> Filled lastName: VOLLRATH');
      }
    }

    // Find the State dropdown
    for (const select of selects) {
      const label = select.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      results.push(`select: label="${label}" visible=${select.offsetParent !== null} options=${select.options.length}`);

      if (label.includes('State')) {
        // Find the IL option
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === 'IL' || select.options[i].text === 'Illinois' || select.options[i].text === 'IL') {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            results.push(`  -> Selected state: ${select.options[i].value} (${select.options[i].text})`);
            break;
          }
        }
      }
    }

    return results;
  });
  console.log('Fill results:');
  for (const r of fillResult) console.log('  ' + r);

  // Wait for Angular to process
  await page.waitForTimeout(1000);

  // Clear response buffer and force-click search
  allResponses.length = 0;

  console.log('\nForce-clicking Search...');
  const clickResult = await page.evaluate(() => {
    const btns = document.querySelectorAll('button.btn.btn-primary');
    let searchBtn: HTMLButtonElement | null = null;
    for (const btn of btns) {
      if (btn.textContent?.trim() === 'Search') {
        searchBtn = btn as HTMLButtonElement;
        break;
      }
    }
    if (!searchBtn) return { error: 'Search button not found' };

    searchBtn.removeAttribute('disabled');
    searchBtn.disabled = false;
    searchBtn.click();

    return { success: true };
  });
  console.log('Click result:', JSON.stringify(clickResult));

  await page.waitForTimeout(8000);

  console.log('\n=== API calls after form fill + force click ===');
  for (const r of allResponses) {
    console.log(r.method + ' ' + r.url + ' -> ' + r.status);
    if (r.reqBody) console.log('  Request:', r.reqBody.substring(0, 2000));
    if (r.respBody) console.log('  Response:', r.respBody.substring(0, 5000));
  }

  // === APPROACH 2: Direct API call via fetch inside browser with correct body format ===
  console.log('\n\n=== APPROACH 2: Direct fetch to /api/searches ===');

  const directResult = await page.evaluate(async () => {
    // Try the correct endpoint with correct body format
    const resp = await fetch('/payments-web/api/searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        searchCategoryId: '3',
        cityServiceId: '1',
        skeletal: false,
        searchInputFields: [
          { fieldKey: 'licPlateNumber', fieldValue: 'CW22016' },
          { fieldKey: 'state', fieldValue: 'IL' },
          { fieldKey: 'lastName', fieldValue: 'VOLLRATH' },
        ]
      })
    });
    return {
      status: resp.status,
      headers: Object.fromEntries(resp.headers.entries()),
      body: (await resp.text()).substring(0, 10000),
    };
  });
  console.log('Direct API result:');
  console.log('  Status:', directResult.status);
  console.log('  Body:', directResult.body);

  // === APPROACH 3: Try with captchaResponse field ===
  console.log('\n\n=== APPROACH 3: Direct fetch with captchaResponse field ===');

  const withCaptcha = await page.evaluate(async () => {
    const resp = await fetch('/payments-web/api/searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        searchCategoryId: '3',
        cityServiceId: '1',
        skeletal: false,
        captchaResponse: '',
        flowSession: 'undefined',
        searchInputFields: [
          { fieldKey: 'licPlateNumber', fieldValue: 'CW22016' },
          { fieldKey: 'state', fieldValue: 'IL' },
          { fieldKey: 'lastName', fieldValue: 'VOLLRATH' },
        ]
      })
    });
    return {
      status: resp.status,
      body: (await resp.text()).substring(0, 10000),
    };
  });
  console.log('With captcha field:');
  console.log('  Status:', withCaptcha.status);
  console.log('  Body:', withCaptcha.body);

  // === APPROACH 4: Try ticket number search (simpler, single field) ===
  console.log('\n\n=== APPROACH 4: Ticket number search ===');

  const ticketResult = await page.evaluate(async () => {
    const resp = await fetch('/payments-web/api/searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        searchCategoryId: '5',
        cityServiceId: '1',
        skeletal: false,
        searchInputFields: [
          { fieldKey: 'ticketNumber', fieldValue: '0' },
        ]
      })
    });
    return {
      status: resp.status,
      body: (await resp.text()).substring(0, 10000),
    };
  });
  console.log('Ticket search result:');
  console.log('  Status:', ticketResult.status);
  console.log('  Body:', ticketResult.body);

  // Take screenshot
  await page.screenshot({ path: 'debug-screenshots/api-probe-filled.png', fullPage: true });

  await browser.close();
}

probeWithFilledForm();
