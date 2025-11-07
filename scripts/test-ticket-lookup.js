// Test script to figure out Chicago ticket lookup form structure
// Run: node scripts/test-ticket-lookup.js

const { chromium } = require('playwright');

async function testTicketLookup() {
  console.log('🔍 Opening Chicago ticket payment portal...');

  const browser = await chromium.launch({
    headless: true, // TRUE headless to avoid detection
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  try {
    // Navigate to main payment page first
    console.log('📄 Navigating to main payment page...');
    await page.goto('https://webapps1.chicago.gov/payments-web/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'debug-step1-main.png', fullPage: true });
    console.log('📸 Screenshot 1 saved: debug-step1-main.png');

    // Look for any buttons or links to parking tickets
    console.log('🔍 Looking for parking ticket option...');
    const clickableElements = await page.$$('button, a');
    console.log(`Found ${clickableElements.length} clickable elements`);

    // Try to find and click parking ticket option
    const parkingButton = await page.$('text=parking', 'text=ticket', 'button:has-text("Parking")', 'a:has-text("Parking")');
    if (parkingButton) {
      console.log('🖱️  Clicking parking ticket option...');
      await parkingButton.click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'debug-step2-after-click.png', fullPage: true });
    console.log('📸 Screenshot 2 saved: debug-step2-after-click.png');

    // Try the direct URL with service ID
    console.log('🔗 Trying direct lookup URL...');
    await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log('⏳ Waiting for form to load...');
    await page.waitForTimeout(5000); // Give it 5 seconds

    // Take screenshot to see current state
    await page.screenshot({ path: 'debug-step3-form.png', fullPage: true });
    console.log('📸 Screenshot 3 saved: debug-step3-form.png');

    // Click on the "License Plate" tab
    console.log('🖱️  Looking for License Plate tab...');
    const licensePlateTab = await page.getByText('License Plate', { exact: false });
    if (licensePlateTab) {
      console.log('✅ Found License Plate tab, clicking...');
      await licensePlateTab.click();
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'debug-step4-license-plate-tab.png', fullPage: true });
      console.log('📸 Screenshot 4 saved: debug-step4-license-plate-tab.png');
    } else {
      console.log('❌ Could not find License Plate tab');
    }

    // Try to find form fields by common patterns
    console.log('\n🔎 Looking for form fields...');

    // Get page content to analyze
    const content = await page.content();

    // Save HTML for analysis
    const fs = require('fs');
    fs.writeFileSync('debug-ticket-form.html', content);
    console.log('💾 HTML saved to debug-ticket-form.html');

    // Look for input fields
    const inputs = await page.$$('input');
    console.log(`\n📝 Found ${inputs.length} input fields`);

    for (let i = 0; i < inputs.length; i++) {
      const type = await inputs[i].getAttribute('type');
      const id = await inputs[i].getAttribute('id');
      const name = await inputs[i].getAttribute('name');
      const placeholder = await inputs[i].getAttribute('placeholder');
      console.log(`  Input ${i + 1}: type="${type}" id="${id}" name="${name}" placeholder="${placeholder}"`);
    }

    // Look for select/dropdowns
    const selects = await page.$$('select');
    console.log(`\n📋 Found ${selects.length} select dropdowns`);

    for (let i = 0; i < selects.length; i++) {
      const id = await selects[i].getAttribute('id');
      const name = await selects[i].getAttribute('name');
      console.log(`  Select ${i + 1}: id="${id}" name="${name}"`);
    }

    // Look for buttons
    const buttons = await page.$$('button');
    console.log(`\n🔘 Found ${buttons.length} buttons`);

    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].textContent();
      const type = await buttons[i].getAttribute('type');
      console.log(`  Button ${i + 1}: "${text.trim()}" (type: ${type})`);
    }

    // Now try to fill in the form with test data
    console.log('\n\n🧪 TESTING: Filling in form with CW22016 / Vollrath / IL...');

    try {
      // License plate - find by label text
      console.log('  📝 Filling license plate...');
      try {
        // Wait for the form to be ready
        await page.waitForSelector('label:has-text("License Plate")', { timeout: 5000 });

        // Get all .form-control inputs and fill the first one (license plate)
        const inputs = await page.$$('input.form-control');
        if (inputs.length > 0) {
          await inputs[0].fill('CW22016');
          console.log(`  ✅ License plate filled`);
        } else {
          console.log('  ❌ Could not find license plate field');
        }
      } catch (e) {
        console.log('  ❌ Could not find license plate field:', e.message);
      }

      // Select state - find the select.form-control dropdown
      console.log('  📋 Selecting state...');
      try {
        const stateDropdown = await page.$('select.form-control');
        if (stateDropdown && await stateDropdown.isVisible()) {
          await stateDropdown.selectOption('IL');
          console.log(`  ✅ State selected (IL)`);
        } else {
          console.log('  ❌ Could not find state dropdown');
        }
      } catch (e) {
        console.log('  ❌ Could not select state:', e.message);
      }

      // Fill last name - second input.form-control
      console.log('  📝 Filling last name...');
      try {
        const inputs = await page.$$('input.form-control');
        if (inputs.length >= 2) {
          await inputs[1].fill('Vollrath');
          console.log(`  ✅ Last name filled`);
        } else {
          console.log('  ❌ Could not find last name field');
        }
      } catch (e) {
        console.log('  ❌ Could not fill last name:', e.message);
      }

      // Check if captcha is present
      console.log('  🔍 Checking for captcha...');
      const captchaFrame = await page.$('iframe[src*="hcaptcha"]');
      if (captchaFrame) {
        console.log('  ⚠️  hCaptcha detected - will need solving service');
      } else {
        console.log('  ✅ No captcha detected!');
      }

      await page.screenshot({ path: 'debug-step5-form-filled.png', fullPage: true });
      console.log('📸 Screenshot 5 saved: debug-step5-form-filled.png');

      // Try to click search button
      let submitted = false;
      console.log('  🔍 Attempting to click search button...');
      try {
        const searchButton = await page.$('button.btn.btn-primary:has-text("Search")');
        if (searchButton) {
          const isDisabled = await searchButton.getAttribute('disabled');
          console.log(`  Button disabled: ${isDisabled !== null}`);

          if (isDisabled === null) {
            await searchButton.click();
            console.log('  ✅ Clicked Search button!');
            submitted = true;
          } else {
            console.log('  ❌ Button is disabled (captcha required)');
          }
        } else {
          console.log('  ❌ Could not find Search button');
        }
      } catch (e) {
        console.log('  ❌ Error clicking Search button:', e.message);
      }

      if (submitted) {
        console.log('  ⏳ Waiting for results...');
        await page.waitForTimeout(5000);

        await page.screenshot({ path: 'debug-step6-results.png', fullPage: true });
        console.log('📸 Screenshot 6 saved: debug-step6-results.png');

        // Save results HTML
        const resultsHtml = await page.content();
        fs.writeFileSync('debug-ticket-results.html', resultsHtml);
        console.log('💾 Results HTML saved to debug-ticket-results.html');

        console.log('\n✅ SUCCESS! Check the screenshots to see the results.');
      } else {
        console.log('  ❌ Could not find submit button');
      }

    } catch (error) {
      console.error('❌ Error filling form:', error.message);
    }

    // Done - no need to keep browser open in headless mode
    console.log('\n✅ Test complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'debug-error.png', fullPage: true });
  } finally {
    await browser.close();
    console.log('\n✅ Done!');
  }
}

testTicketLookup();
