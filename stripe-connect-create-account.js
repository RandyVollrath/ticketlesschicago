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

async function createConnectedAccount() {
  console.log('🔧 Creating Stripe Connected Account...\n');

  try {
    const account = await stripe.accounts.create({
      type: 'express', // Express = Stripe handles the onboarding UI
      country: 'US',
      email: 'test-remitter@autopilotamerica.com', // Change this if you want
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual', // Can be 'individual' or 'company'
    });

    console.log('✅ Connected Account Created!\n');
    console.log('════════════════════════════════════════════════════════════');
    console.log('Account ID:', account.id);
    console.log('Type:', account.type);
    console.log('Email:', account.email);
    console.log('════════════════════════════════════════════════════════════\n');

    console.log('💾 SAVE THIS ACCOUNT ID:');
    console.log(account.id);
    console.log('');

    // Save to a file for easy reference
    fs.writeFileSync('connected-account-id.txt', account.id);
    console.log('✅ Saved to: connected-account-id.txt\n');

    console.log('Next step: Generate onboarding link');
    console.log('Run: node stripe-connect-onboarding.js');

    return account;
  } catch (error) {
    console.error('❌ Error creating account:', error.message);
    if (error.raw) {
      console.error('Details:', JSON.stringify(error.raw, null, 2));
    }
  }
}

createConnectedAccount();
