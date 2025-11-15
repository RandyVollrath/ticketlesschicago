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

// Read the account ID from the file created by the previous script
const accountId = fs.readFileSync('connected-account-id.txt', 'utf8').trim();

async function createOnboardingLink() {
  console.log(`🔗 Creating onboarding link for account: ${accountId}\n`);

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: 'https://autopilotamerica.com/connect/refresh',
      return_url: 'https://autopilotamerica.com/connect/return',
      type: 'account_onboarding',
    });

    console.log('✅ Onboarding Link Created!\n');
    console.log('════════════════════════════════════════════════════════════');
    console.log('🔗 ONBOARDING URL:');
    console.log(accountLink.url);
    console.log('════════════════════════════════════════════════════════════\n');
    console.log('⏰ This link expires in a few minutes - use it quickly!');
    console.log('📋 Open this link to complete the Stripe Express onboarding\n');
    console.log('After completing onboarding, run:');
    console.log('node stripe-connect-check-status.js');

    return accountLink.url;
  } catch (error) {
    console.error('❌ Error creating onboarding link:', error.message);
    if (error.raw) {
      console.error('Details:', JSON.stringify(error.raw, null, 2));
    }
  }
}

createOnboardingLink();
