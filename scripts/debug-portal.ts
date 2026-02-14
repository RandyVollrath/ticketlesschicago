import { chromium } from 'playwright';
import fs from 'fs';

async function fillFormField(page: any, labelText: string, value: string) {
  return page.evaluate(({ labelText, value }: { labelText: string; value: string }) => {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      const label = input.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      if (label.includes(labelText) && (input as HTMLElement).offsetParent !== null) {
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

async function selectDropdownValue(page: any, labelText: string, value: string) {
  return page.evaluate(({ labelText, value }: { labelText: string; value: string }) => {
    const selects = document.querySelectorAll('select');
    for (const select of selects) {
      const label = select.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      if (label.includes(labelText) && (select as HTMLElement).offsetParent !== null) {
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

async function forceClickSearch(page: any) {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button.btn.btn-primary');
    for (const btn of btns) {
      if (btn.textContent?.trim() === 'Search') {
        btn.removeAttribute('disabled');
        (btn as HTMLButtonElement).disabled = false;
        (btn as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  });
}

async function debugPortalLookup() {
  console.log('Starting portal lookup for FJ86396 (IL) / Bee...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  let apiResponse: any = null;

  // Intercept API response
  page.on('response', async (response) => {
    if (response.url().includes('/payments-web/api/searches')) {
      console.log(`\n📡 Intercepted API response: ${response.status()}`);
      try {
        apiResponse = await response.json();
        console.log('\n✅ Got JSON response');
      } catch (e) {
        console.error('Failed to parse JSON:', e);
      }
    }
  });

  try {
    console.log('Loading portal...');
    await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log('Waiting 8 seconds for Angular to bootstrap...');
    await page.waitForTimeout(8000);

    console.log('Finding all clickable elements with "License Plate" text...');
    const licensePlateTabs = await page.evaluate(() => {
      const elements = document.querySelectorAll('button, a, div[role="tab"], [class*="tab"]');
      const found = [];
      for (const el of elements) {
        if (el.textContent?.includes('License Plate')) {
          found.push({
            tag: el.tagName,
            text: el.textContent.trim(),
            className: el.className,
            role: el.getAttribute('role'),
          });
        }
      }
      return found;
    });
    console.log('Found License Plate elements:', JSON.stringify(licensePlateTabs, null, 2));

    console.log('Clicking License Plate tab using Playwright locator...');
    try {
      await page.getByText('License Plate').first().click();
      console.log('Successfully clicked License Plate tab');
    } catch (e: any) {
      console.error('Failed to click License Plate tab:', e.message);
    }
    await page.waitForTimeout(2000);

    console.log('Filling License Plate: FJ86396...');
    const filledPlate = await fillFormField(page, 'License Plate', 'FJ86396');
    console.log(`  Plate filled: ${filledPlate}`);
    await page.waitForTimeout(500);

    console.log('Selecting State: IL...');
    const selectedState = await selectDropdownValue(page, 'State', 'IL');
    console.log(`  State selected: ${selectedState}`);
    await page.waitForTimeout(500);

    console.log('Filling Last Name: Bee...');
    const filledName = await fillFormField(page, 'Last Name', 'Bee');
    console.log(`  Last Name filled: ${filledName}`);
    await page.waitForTimeout(500);

    // Verify form values
    const formValues = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input, select');
      const values: Record<string, string> = {};
      inputs.forEach((input: any) => {
        if (input.value && input.offsetParent !== null) {
          const label = input.closest('.form-group')?.querySelector('label')?.textContent?.trim() || input.name || input.id;
          values[label] = input.value;
        }
      });
      return values;
    });
    console.log('Form values before submit:', formValues);

    // Take screenshot BEFORE clicking search
    await page.screenshot({ path: '/tmp/fj86396-before-search.png', fullPage: true });
    console.log('✅ Pre-search screenshot saved to /tmp/fj86396-before-search.png');

    console.log('Force-clicking Search button...');
    await forceClickSearch(page);

    console.log('Waiting for API response...');
    await page.waitForTimeout(10000); // Wait up to 10 seconds for response

    if (apiResponse) {
      const jsonString = JSON.stringify(apiResponse, null, 2);

      console.log('\n' + '='.repeat(80));
      console.log('FULL API RESPONSE:');
      console.log('='.repeat(80));
      console.log(jsonString);
      console.log('='.repeat(80) + '\n');

      // Save to file
      fs.writeFileSync('/tmp/fj86396-response.json', jsonString);
      console.log('✅ Response saved to /tmp/fj86396-response.json');

      // Take screenshot
      await page.screenshot({ path: '/tmp/fj86396-results.png', fullPage: true });
      console.log('✅ Screenshot saved to /tmp/fj86396-results.png');
    } else {
      console.error('❌ No API response captured!');
      await page.screenshot({ path: '/tmp/fj86396-error.png', fullPage: true });
      console.log('Screenshot saved to /tmp/fj86396-error.png');
    }

  } catch (error) {
    console.error('Error during lookup:', error);
    await page.screenshot({ path: '/tmp/fj86396-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

debugPortalLookup().catch(console.error);
