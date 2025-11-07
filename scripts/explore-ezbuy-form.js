// Explore the actual EzBuy registration form
const { chromium } = require('playwright');
const fs = require('fs');

async function exploreEzBuyForm() {
  console.log('🚗 Exploring EzBuy City Sticker Registration Form...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 1000
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  try {
    // Go directly to EzBuy vehicle stickers page
    console.log('📄 Navigating to EzBuy portal...');
    await page.goto('https://ezbuy.chicityclerk.com/vehicle-stickers', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'ezbuy-step1-homepage.png', fullPage: true });
    console.log('📸 Screenshot: ezbuy-step1-homepage.png');

    // Look for input fields
    console.log('\n🔍 Analyzing form fields...\n');
    const inputs = await page.$$('input');
    console.log(`📝 Found ${inputs.length} input fields:`);

    for (let i = 0; i < inputs.length; i++) {
      const type = await inputs[i].getAttribute('type');
      const id = await inputs[i].getAttribute('id');
      const name = await inputs[i].getAttribute('name');
      const placeholder = await inputs[i].getAttribute('placeholder');
      const label = await inputs[i].evaluate(el => {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        return labelEl ? labelEl.textContent.trim() : null;
      });

      console.log(`  ${i + 1}. ${label || 'No label'}`);
      console.log(`     type="${type}" id="${id}" name="${name}"`);
      if (placeholder) console.log(`     placeholder="${placeholder}"`);
      console.log('');
    }

    // Look for select dropdowns
    const selects = await page.$$('select');
    console.log(`\n📋 Found ${selects.length} dropdown fields:`);

    for (let i = 0; i < selects.length; i++) {
      const id = await selects[i].getAttribute('id');
      const name = await selects[i].getAttribute('name');
      const label = await selects[i].evaluate(el => {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        return labelEl ? labelEl.textContent.trim() : null;
      });

      console.log(`  ${i + 1}. ${label || 'No label'}`);
      console.log(`     id="${id}" name="${name}"\n`);
    }

    // Look for buttons
    const buttons = await page.$$('button');
    console.log(`\n🔘 Found ${buttons.length} buttons:`);

    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].textContent();
      const type = await buttons[i].getAttribute('type');
      console.log(`  ${i + 1}. "${text.trim()}" (type: ${type})`);
    }

    // Check for captcha
    console.log('\n🔍 Checking for captcha...');
    const captchaFrame = await page.$('iframe[src*="captcha"]');
    if (captchaFrame) {
      console.log('  ⚠️  Captcha detected');
    } else {
      console.log('  ✅ No captcha found');
    }

    // Save HTML
    const html = await page.content();
    fs.writeFileSync('ezbuy-form.html', html);
    console.log('\n💾 HTML saved: ezbuy-form.html');

    // Look for "Renew" vs "New" options
    console.log('\n🔍 Looking for New vs Renewal flow...');
    const pageText = await page.evaluate(() => document.body.innerText);

    const hasNew = pageText.toLowerCase().includes('new') && pageText.toLowerCase().includes('sticker');
    const hasRenew = pageText.toLowerCase().includes('renew');

    if (hasNew) {
      console.log('  ✅ Found "New Sticker" option');
    }
    if (hasRenew) {
      console.log('  ✅ Found "Renewal" option');
    }

    console.log('\n⏸️  Browser will stay open for 30 seconds...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: 'ezbuy-error.png', fullPage: true });
  } finally {
    await browser.close();
    console.log('\n✅ Done!');
  }
}

exploreEzBuyForm();
