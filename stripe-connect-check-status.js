const fs = require('fs');

// Load .env.local
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^[\"']|[\"']$/g, '');
      process.env[key] = value;
    }
  });
}

const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);

// Read the account ID from the file
const accountId = fs.readFileSync('connected-account-id.txt', 'utf8').trim();

async function checkAccountStatus() {
  console.log(`📊 Checking status for account: ${accountId}\n`);

  try {
    const account = await stripe.accounts.retrieve(accountId);

    console.log('════════════════════════════════════════════════════════════');
    console.log('Account Information:');
    console.log('════════════════════════════════════════════════════════════');
    console.log('Account ID:', account.id);
    console.log('Type:', account.type);
    console.log('Email:', account.email);
    console.log('Country:', account.country);
    console.log('');

    console.log('════════════════════════════════════════════════════════════');
    console.log('Status:');
    console.log('════════════════════════════════════════════════════════════');
    console.log('Charges Enabled:', account.charges_enabled ? '✅ Yes' : '❌ No');
    console.log('Payouts Enabled:', account.payouts_enabled ? '✅ Yes' : '❌ No');
    console.log('Details Submitted:', account.details_submitted ? '✅ Yes' : '❌ No');
    console.log('');

    if (account.requirements) {
      console.log('════════════════════════════════════════════════════════════');
      console.log('Requirements:');
      console.log('════════════════════════════════════════════════════════════');
      console.log('Currently Due:', account.requirements.currently_due.length > 0
        ? account.requirements.currently_due.join(', ')
        : '✅ None');
      console.log('Eventually Due:', account.requirements.eventually_due.length > 0
        ? account.requirements.eventually_due.join(', ')
        : '✅ None');
      console.log('Past Due:', account.requirements.past_due.length > 0
        ? '⚠️ ' + account.requirements.past_due.join(', ')
        : '✅ None');
      console.log('');
    }

    // Overall status
    console.log('════════════════════════════════════════════════════════════');
    if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
      console.log('🎉 ACCOUNT FULLY ACTIVATED!');
      console.log('✅ Ready to accept payments and receive payouts');
      console.log('');
      console.log('Next step: Test a payment');
      console.log('Run: node stripe-connect-test-payment.js');
    } else if (account.details_submitted) {
      console.log('⏳ ACCOUNT PENDING VERIFICATION');
      console.log('Stripe is reviewing the account details');
    } else {
      console.log('⚠️ ONBOARDING INCOMPLETE');
      console.log('The account holder needs to complete the onboarding process');
      console.log('Generate a new onboarding link:');
      console.log('Run: node stripe-connect-onboarding.js');
    }
    console.log('════════════════════════════════════════════════════════════');

    return account;
  } catch (error) {
    console.error('❌ Error checking account status:', error.message);
    if (error.raw) {
      console.error('Details:', JSON.stringify(error.raw, null, 2));
    }
  }
}

checkAccountStatus();
