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

const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);

async function checkConnectStatusLive() {
  console.log('🔍 Checking LIVE Stripe Connect Account Status\n');

  try {
    // Check if the account itself is enabled for Connect
    const account = await stripe.accounts.retrieve();

    console.log('═'.repeat(60));
    console.log('YOUR STRIPE ACCOUNT (Platform Account)');
    console.log('═'.repeat(60));
    console.log(`Account ID: ${account.id}`);
    console.log(`Type: ${account.type}`);
    console.log(`Country: ${account.country}`);
    console.log(`Email: ${account.email || 'Not set'}`);
    console.log(`Business Name: ${account.business_profile?.name || 'Not set'}`);
    console.log('');

    // Check if charges enabled
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
      console.log('✅ DETAILS SUBMITTED - Account verified');
    } else {
      console.log('⚠️  DETAILS NOT SUBMITTED - Verification incomplete');
    }

    console.log('');

    // Check capabilities
    if (account.capabilities) {
      console.log('Capabilities:');
      for (const [capability, status] of Object.entries(account.capabilities)) {
        const statusEmoji = status === 'active' ? '✅' : status === 'pending' ? '⏳' : '❌';
        console.log(`  ${statusEmoji} ${capability}: ${status}`);
      }
    }

    // Check requirements
    if (account.requirements) {
      console.log('');

      if (account.requirements.currently_due && account.requirements.currently_due.length > 0) {
        console.log('⚠️  Requirements Currently Due:');
        account.requirements.currently_due.forEach(req => {
          console.log(`  - ${req}`);
        });
      } else {
        console.log('✅ No requirements currently due');
      }

      if (account.requirements.eventually_due && account.requirements.eventually_due.length > 0) {
        console.log('');
        console.log('ℹ️  Requirements Eventually Due:');
        account.requirements.eventually_due.forEach(req => {
          console.log(`  - ${req}`);
        });
      }

      if (account.requirements.past_due && account.requirements.past_due.length > 0) {
        console.log('');
        console.log('❌ Requirements PAST DUE:');
        account.requirements.past_due.forEach(req => {
          console.log(`  - ${req}`);
        });
      }

      if (account.requirements.disabled_reason) {
        console.log('');
        console.log(`🚫 Account Disabled Reason: ${account.requirements.disabled_reason}`);
      }
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log('\n📊 STRIPE CONNECT STATUS:\n');

    // Check if Connect is enabled
    if (account.capabilities?.transfers === 'active' || account.capabilities?.card_payments === 'active') {
      console.log('✅ STRIPE CONNECT IS ENABLED!');
      console.log('   You can create connected accounts and process payments on behalf of others.');
    } else if (account.capabilities?.transfers === 'pending') {
      console.log('⏳ STRIPE CONNECT IS PENDING');
      console.log('   Waiting for approval. Check requirements above.');
    } else {
      console.log('❌ STRIPE CONNECT NOT ENABLED');
      console.log('   You may need to apply for it in your Stripe Dashboard.');
    }

    console.log('');
    console.log('Dashboard: https://dashboard.stripe.com/settings/account');
    console.log('Connect Settings: https://dashboard.stripe.com/settings/connect');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkConnectStatusLive().catch(console.error);
