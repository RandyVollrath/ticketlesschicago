// Test script to figure out Chicago ticket lookup form structure
// Run: node scripts/test-ticket-lookup.js

const { chromium } = require('playwright');

async function testTicketLookup() {
  console.log('🔍 Opening Chicago ticket payment portal...');

  const browser = await chromium.launch({
    headless: false, // Show browser for debugging
    slowMo: 1000 // Slow down so we can see what's happening
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  try {
    // Navigate to payment portal
    await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1');

    console.log('📄 Page loaded, waiting for form...');
    await page.waitForTimeout(3000); // Wait for React/Angular to load

    // Take screenshot to see what we're working with
    await page.screenshot({ path: 'debug-ticket-form.png', fullPage: true });
    console.log('📸 Screenshot saved to debug-ticket-form.png');

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

    // Look for buttons
    const buttons = await page.$$('button');
    console.log(`\n🔘 Found ${buttons.length} buttons`);

    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].textContent();
      const type = await buttons[i].getAttribute('type');
      console.log(`  Button ${i + 1}: "${text.trim()}" (type: ${type})`);
    }

    // Keep browser open for manual inspection
    console.log('\n⏸️  Browser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'debug-error.png', fullPage: true });
  } finally {
    await browser.close();
    console.log('\n✅ Done!');
  }
}

testTicketLookup();
