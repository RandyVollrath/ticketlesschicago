const fs = require('fs');

// Load .env.local
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY);

async function checkConnectStatus() {
  console.log('🔍 Checking Stripe Connect Account Status\n');
  console.log('Mode:', process.env.STRIPE_MODE || 'test');
  console.log('');

  try {
    // Get the connected account (if you have one)
    const accounts = await stripe.accounts.list({ limit: 10 });

    if (accounts.data.length === 0) {
      console.log('❌ No Stripe Connect accounts found');
      console.log('');
      console.log('To set up Stripe Connect:');
      console.log('1. Go to: https://dashboard.stripe.com/connect/accounts/overview');
      console.log('2. Click "Create account" or check if any exist');
      console.log('3. Complete the onboarding process');
      return;
    }

    console.log(`Found ${accounts.data.length} connected account(s):\n`);

    for (const account of accounts.data) {
      console.log('═'.repeat(60));
      console.log(`Account ID: ${account.id}`);
      console.log(`Type: ${account.type}`);
      console.log(`Country: ${account.country}`);
      console.log(`Email: ${account.email || 'Not set'}`);
      console.log(`Business Name: ${account.business_profile?.name || 'Not set'}`);
      console.log('');

      // Check charges enabled
      if (account.charges_enabled) {
        console.log('✅ CHARGES ENABLED - Can accept payments');
      } else {
        console.log('❌ CHARGES DISABLED - Cannot accept payments yet');
      }

      // Check payouts enabled
      if (account.payouts_enabled) {
        console.log('✅ PAYOUTS ENABLED - Can receive funds');
      } else {
        console.log('❌ PAYOUTS DISABLED - Cannot receive funds yet');
      }

      // Check details submitted
      if (account.details_submitted) {
        console.log('✅ DETAILS SUBMITTED - Onboarding complete');
      } else {
        console.log('⚠️  DETAILS NOT SUBMITTED - Onboarding incomplete');
      }

      // Check if there are requirements
      if (account.requirements) {
        console.log('');
        console.log('Requirements:');

        if (account.requirements.currently_due && account.requirements.currently_due.length > 0) {
          console.log('  ⚠️  Currently Due:');
          account.requirements.currently_due.forEach(req => {
            console.log(`    - ${req}`);
          });
        }

        if (account.requirements.eventually_due && account.requirements.eventually_due.length > 0) {
          console.log('  ℹ️  Eventually Due:');
          account.requirements.eventually_due.forEach(req => {
            console.log(`    - ${req}`);
          });
        }

        if (account.requirements.past_due && account.requirements.past_due.length > 0) {
          console.log('  ❌ PAST DUE:');
          account.requirements.past_due.forEach(req => {
            console.log(`    - ${req}`);
          });
        }

        if (account.requirements.disabled_reason) {
          console.log(`  🚫 Disabled Reason: ${account.requirements.disabled_reason}`);
        }
      }

      console.log('');
      console.log('Dashboard Link:');
      console.log(`https://dashboard.stripe.com/${process.env.STRIPE_MODE === 'live' ? '' : 'test/'}connect/accounts/${account.id}`);
      console.log('');
    }

    // Summary
    console.log('═'.repeat(60));
    console.log('\n📊 SUMMARY:\n');

    const fullyEnabled = accounts.data.filter(a =>
      a.charges_enabled && a.payouts_enabled && a.details_submitted
    );

    if (fullyEnabled.length > 0) {
      console.log('✅ You have FULLY APPROVED Stripe Connect account(s)!');
      console.log(`   ${fullyEnabled.length} account(s) ready to accept payments and receive payouts.`);
    } else {
      console.log('⚠️  No fully approved accounts yet.');
      console.log('   Complete the onboarding requirements above to enable payments.');
    }

  } catch (error) {
    console.error('❌ Error checking Stripe Connect:', error.message);

    if (error.code === 'account_invalid') {
      console.log('\nℹ️  This might mean you need to set up Stripe Connect first.');
      console.log('Go to: https://dashboard.stripe.com/connect/accounts/overview');
    }
  }
}

checkConnectStatus().catch(console.error);
