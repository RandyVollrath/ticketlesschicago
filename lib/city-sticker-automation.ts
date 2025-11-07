// City Sticker Registration Automation
// Automates the Chicago City Clerk EzBuy vehicle sticker purchase process

import { chromium, Browser, Page } from 'playwright';

interface VehicleInfo {
  licensePlate: string;
  vin: string; // Full VIN (will extract last 6 characters)
  lastName: string; // Owner's last name
  email: string;
  // Optional fields
  renewalNoticeNumber?: string; // If they have a renewal notice
  companyName?: string; // If registering as company
}

interface RegistrationResult {
  success: boolean;
  message: string;
  confirmationNumber?: string;
  totalAmount?: number;
  error?: string;
  screenshots?: string[];
}

/**
 * Register or renew a Chicago city vehicle sticker
 */
export async function registerCitySticker(
  vehicle: VehicleInfo,
  dryRun: boolean = true
): Promise<RegistrationResult> {
  let browser: Browser | null = null;
  const screenshots: string[] = [];

  try {
    console.log('🚗 Starting city sticker registration...');
    console.log(`   License Plate: ${vehicle.licensePlate}`);
    console.log(`   VIN: ${vehicle.vin}`);
    console.log(`   Dry Run: ${dryRun ? 'YES (will not complete payment)' : 'NO'}\n`);

    browser = await chromium.launch({
      headless: false, // Keep visible for now during testing
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    // Step 1: Navigate to EzBuy portal
    console.log('📄 Step 1: Navigating to EzBuy portal...');
    await page.goto('https://ezbuy.chicityclerk.com/vehicle-stickers', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'city-sticker-auto-step1.png', fullPage: true });
    screenshots.push('city-sticker-auto-step1.png');
    console.log('✅ Loaded EzBuy portal');

    // Step 2: Click "Next" to proceed past instructions
    console.log('\n📄 Step 2: Proceeding past instructions...');
    const nextButton = await page.$('button:has-text("Next")');
    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'city-sticker-auto-step2.png', fullPage: true });
      screenshots.push('city-sticker-auto-step2.png');
      console.log('✅ Advanced to Record Search');
    } else {
      throw new Error('Could not find Next button');
    }

    // Step 3: Fill in Record Search (License Plate + VIN)
    console.log('\n📄 Step 3: Filling vehicle information...');

    // Look for all input fields on the page
    const inputs = await page.$$('input[type="text"], input:not([type])');
    console.log(`   Found ${inputs.length} input fields`);

    // Try to identify and fill all required fields
    let plateFilled = false;
    let vinFilled = false;
    let lastNameFilled = false;

    // Extract last 6 characters from VIN
    const vinLast6 = vehicle.vin.slice(-6);

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const label = await input.evaluate((el) => {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        return labelEl ? labelEl.textContent?.trim() : null;
      });

      const placeholder = await input.getAttribute('placeholder');
      const name = await input.getAttribute('name');
      const id = await input.getAttribute('id');

      console.log(`   Input ${i + 1}: label="${label}" placeholder="${placeholder}" name="${name}" id="${id}"`);

      // Fill last name
      if (!lastNameFilled && (
        label?.toLowerCase().includes('last name') ||
        placeholder?.toLowerCase().includes('last name') ||
        name?.toLowerCase().includes('lastname') ||
        name?.toLowerCase().includes('last_name') ||
        id?.toLowerCase().includes('lastname')
      )) {
        await input.fill(vehicle.lastName);
        console.log(`   ✅ Filled last name: ${vehicle.lastName}`);
        lastNameFilled = true;
      }

      // Fill license plate
      if (!plateFilled && (
        label?.toLowerCase().includes('plate') ||
        placeholder?.toLowerCase().includes('plate') ||
        name?.toLowerCase().includes('plate') ||
        id?.toLowerCase().includes('plate')
      )) {
        await input.fill(vehicle.licensePlate);
        console.log(`   ✅ Filled license plate: ${vehicle.licensePlate}`);
        plateFilled = true;
      }

      // Fill VIN (last 6 characters only)
      if (!vinFilled && (
        label?.toLowerCase().includes('vin') ||
        label?.toLowerCase().includes('identification') ||
        placeholder?.toLowerCase().includes('vin') ||
        name?.toLowerCase().includes('vin') ||
        id?.toLowerCase().includes('vin')
      )) {
        await input.fill(vinLast6);
        console.log(`   ✅ Filled VIN (last 6): ${vinLast6}`);
        vinFilled = true;
      }
    }

    if (!plateFilled || !vinFilled || !lastNameFilled) {
      throw new Error(`Missing fields - Last Name: ${lastNameFilled}, Plate: ${plateFilled}, VIN: ${vinFilled}`);
    }

    await page.screenshot({ path: 'city-sticker-auto-step3-filled.png', fullPage: true });
    screenshots.push('city-sticker-auto-step3-filled.png');

    // Wait a moment for form validation to complete
    await page.waitForTimeout(1000);

    // Check if there are any validation errors
    console.log('\n🔍 Checking for validation errors...');
    let pageText = await page.evaluate(() => document.body.innerText);

    if (pageText.includes('required') || pageText.includes('invalid') || pageText.includes('error')) {
      console.log('   ⚠️  Possible validation errors detected');
      await page.screenshot({ path: 'city-sticker-auto-validation-error.png', fullPage: true });
      screenshots.push('city-sticker-auto-validation-error.png');
    }

    // Check if Search button is enabled
    const searchButton = await page.$('button:has-text("Search")');
    if (!searchButton) {
      throw new Error('Could not find Search button');
    }

    const isEnabled = await searchButton.evaluate((btn) => !btn.hasAttribute('disabled'));
    console.log(`   Search button enabled: ${isEnabled}`);

    if (!isEnabled) {
      console.log('   ⚠️  Search button is disabled - likely vehicle not found in system or validation issue');
      console.log('   This is expected if testing with a vehicle not actually due for renewal');

      return {
        success: false,
        message: 'Search button disabled - vehicle may not be in system or form validation failed. This is expected when testing with vehicles not actually due for renewal.',
        screenshots
      };
    }

    // Click Search to look up the vehicle record
    console.log('\n📄 Step 4: Searching for vehicle record...');
    await searchButton.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'city-sticker-auto-step4-search-results.png', fullPage: true });
    screenshots.push('city-sticker-auto-step4-search-results.png');
    console.log('✅ Vehicle search completed');

    // Step 4: Check for errors or eligibility issues
    pageText = await page.evaluate(() => document.body.innerText);

    if (pageText.toLowerCase().includes('not found') ||
        pageText.toLowerCase().includes('no records') ||
        pageText.toLowerCase().includes('error')) {
      throw new Error('Vehicle not found or not eligible for renewal');
    }

    // Fill email
    console.log('\n📄 Step 5: Filling contact information...');
    const emailInputs = await page.$$('input[type="email"], input[name*="email" i], input[id*="email" i]');

    if (emailInputs.length > 0) {
      await emailInputs[0].fill(vehicle.email);
      console.log(`   ✅ Filled email: ${vehicle.email}`);
    } else {
      console.log('   ⚠️  Could not find email field');
    }

    await page.screenshot({ path: 'city-sticker-auto-step5-contact.png', fullPage: true });
    screenshots.push('city-sticker-auto-step5-contact.png');

    // Step 5: Proceed to Options/Cart
    console.log('\n📄 Step 6: Proceeding to cart...');
    const nextButton3 = await page.$('button:has-text("Next")');
    if (nextButton3) {
      await nextButton3.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'city-sticker-auto-step6-options.png', fullPage: true });
      screenshots.push('city-sticker-auto-step6-options.png');
      console.log('✅ Advanced to Options/Cart');
    }

    // Step 6: Extract pricing information
    console.log('\n💰 Extracting pricing information...');
    const priceText = await page.evaluate(() => {
      const priceElements = Array.from(document.querySelectorAll('*')).filter(el =>
        el.textContent?.match(/\$\d+/g)
      );
      return priceElements.map(el => el.textContent?.trim()).join(' | ');
    });
    console.log(`   Prices found: ${priceText}`);

    // Extract total amount
    const totalMatch = priceText.match(/\$(\d+(?:\.\d{2})?)/);
    const totalAmount = totalMatch ? parseFloat(totalMatch[1]) : 0;

    if (dryRun) {
      console.log('\n⏸️  DRY RUN MODE - Stopping before payment');
      console.log('   Would proceed to payment next');
      console.log(`   Total Amount: $${totalAmount}`);

      // Keep browser open for 10 seconds for inspection
      await page.waitForTimeout(10000);

      return {
        success: true,
        message: 'Dry run completed successfully - stopped before payment',
        totalAmount,
        screenshots
      };
    }

    // If not dry run, would continue to payment here
    // For now, we'll stop here since we need real payment processing

    return {
      success: true,
      message: 'Registration process completed up to payment step',
      totalAmount,
      screenshots
    };

  } catch (error) {
    console.error('\n❌ Error during registration:', error);

    return {
      success: false,
      message: 'Registration failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      screenshots
    };
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('\n✅ Browser closed');
  }
}

/**
 * Check if a vehicle is eligible for city sticker renewal
 */
export async function checkRenewalEligibility(
  licensePlate: string,
  vin: string
): Promise<{
  eligible: boolean;
  message: string;
  expirationDate?: string;
}> {
  // This would do a quick check without going through full registration
  // For now, just a placeholder
  return {
    eligible: true,
    message: 'Eligibility check not implemented yet'
  };
}
