// Explore Chicago City Sticker registration process
const { chromium } = require('playwright');

async function exploreCitySticker() {
  console.log('🚗 Exploring Chicago City Sticker Registration...\n');

  const browser = await chromium.launch({
    headless: false, // Show browser to see what we're doing
    slowMo: 500
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  try {
    // Navigate to City Clerk website
    console.log('📄 Step 1: Navigating to City Clerk website...');
    await page.goto('https://www.chicityclerk.com/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.screenshot({ path: 'city-sticker-step1-homepage.png', fullPage: true });
    console.log('📸 Screenshot saved: city-sticker-step1-homepage.png');

    // Look for city sticker links
    console.log('\n🔍 Looking for city sticker registration link...');
    const content = await page.content();
    
    // Search for "Vehicle Sticker" or "City Sticker" links
    const links = await page.$$('a');
    let found = false;
    
    for (let link of links) {
      const text = await link.textContent();
      if (text && text.match(/vehicle sticker|city sticker|purchase.*sticker/i)) {
        console.log(`  Found link: "${text.trim()}"`);
        const href = await link.getAttribute('href');
        console.log(`  URL: ${href}`);
        
        if (!found && href && !href.includes('#')) {
          console.log(`\n🖱️  Clicking: "${text.trim()}"...`);
          await link.click();
          found = true;
          await page.waitForTimeout(3000);
          break;
        }
      }
    }

    if (!found) {
      console.log('\n⚠️  Could not find direct link, trying direct URL...');
      await page.goto('https://www.chicityclerk.com/city-stickers-parking/about-city-stickers', {
        waitUntil: 'networkidle',
        timeout: 30000
      });
    }

    await page.screenshot({ path: 'city-sticker-step2-sticker-page.png', fullPage: true });
    console.log('📸 Screenshot saved: city-sticker-step2-sticker-page.png');

    // Look for "Buy" or "Purchase" or "Renew" button
    console.log('\n🔍 Looking for purchase/renew button...');
    const buttons = await page.$$('button, a');
    
    for (let button of buttons) {
      const text = await button.textContent();
      if (text && text.match(/buy|purchase|renew|online|order/i)) {
        console.log(`  Found button: "${text.trim()}"`);
        const href = await button.getAttribute('href');
        if (href) console.log(`  Link: ${href}`);
      }
    }

    // Try to find the registration portal URL
    console.log('\n🔍 Searching page for registration portal URL...');
    const pageText = await page.evaluate(() => document.body.innerText);
    
    const urlMatch = pageText.match(/(https?:\/\/[^\s]+sticker[^\s]*)/gi);
    if (urlMatch) {
      console.log('\n✅ Found potential registration URLs:');
      urlMatch.forEach(url => console.log(`  - ${url}`));
    }

    // Save the full HTML for analysis
    const html = await page.content();
    require('fs').writeFileSync('city-sticker-page.html', html);
    console.log('\n💾 Full HTML saved to: city-sticker-page.html');

    console.log('\n⏸️  Browser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: 'city-sticker-error.png', fullPage: true });
  } finally {
    await browser.close();
    console.log('\n✅ Exploration complete!');
  }
}

exploreCitySticker();
