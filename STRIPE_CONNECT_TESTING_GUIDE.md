# Stripe Connect Testing Guide

## ✅ Current Setup Status

- **Live Account:** Fully approved and active
- **Connect Enabled:** ✅ Yes (`transfers: active`)
- **Client ID:** `ca_TNkJd2lnjghhgbT4CZBC46Bo0G2uCTJt`
- **Account ID:** `acct_1SHvt6PSdzV8LIEx`

## 🧪 How to Test Stripe Connect Tomorrow

### Option 1: Test in Test Mode (Recommended for Development)

1. **Get your Test Mode Client ID:**
   - Go to: https://dashboard.stripe.com/test/settings/applications
   - Copy the "Development" Client ID (starts with `ca_`)
   - Add to `.env.local`: `STRIPE_TEST_CONNECT_CLIENT_ID="ca_xxxxx"`

2. **Set your app to test mode:**
   ```bash
   # In .env.local, make sure:
   STRIPE_MODE="test"
   ```

3. **Create a test connected account:**
   ```bash
   node test-stripe-connect-create-account.js
   ```

### Option 2: Test in Live Mode (For Real Transactions)

Since your live account is already approved, you can create real connected accounts immediately.

## 📝 Testing Scripts

### Script 1: Create a Connected Account

**File:** `test-stripe-connect-create-account.js`

```javascript
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);

async function createConnectedAccount() {
  console.log('Creating Stripe Connected Account...\n');

  try {
    const account = await stripe.accounts.create({
      type: 'express', // 'express' or 'standard' or 'custom'
      country: 'US',
      email: 'test-partner@example.com', // Change this
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual', // or 'company'
    });

    console.log('✅ Connected account created!');
    console.log('Account ID:', account.id);
    console.log('\nNext step: Create an account link for onboarding');
    console.log('Account Details:', JSON.stringify(account, null, 2));

    return account.id;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createConnectedAccount();
```

### Script 2: Create Onboarding Link

**File:** `test-stripe-connect-onboarding.js`

```javascript
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);

// Replace with the account ID from Script 1
const CONNECTED_ACCOUNT_ID = 'acct_xxxxx';

async function createOnboardingLink() {
  console.log('Creating onboarding link...\n');

  try {
    const accountLink = await stripe.accountLinks.create({
      account: CONNECTED_ACCOUNT_ID,
      refresh_url: 'https://autopilotamerica.com/connect/refresh',
      return_url: 'https://autopilotamerica.com/connect/return',
      type: 'account_onboarding',
    });

    console.log('✅ Onboarding link created!');
    console.log('\nSend this link to the user to complete onboarding:');
    console.log(accountLink.url);
    console.log('\nLink expires in a few minutes, so use it quickly!');

    return accountLink.url;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createOnboardingLink();
```

### Script 3: Check Connected Account Status

**File:** `test-stripe-connect-check-account.js`

```javascript
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);

const CONNECTED_ACCOUNT_ID = 'acct_xxxxx'; // Replace

async function checkAccountStatus() {
  console.log('Checking connected account status...\n');

  try {
    const account = await stripe.accounts.retrieve(CONNECTED_ACCOUNT_ID);

    console.log('Account ID:', account.id);
    console.log('Type:', account.type);
    console.log('Email:', account.email);
    console.log('');
    console.log('Charges Enabled:', account.charges_enabled ? '✅' : '❌');
    console.log('Payouts Enabled:', account.payouts_enabled ? '✅' : '❌');
    console.log('Details Submitted:', account.details_submitted ? '✅' : '❌');
    console.log('');

    if (account.requirements) {
      console.log('Requirements:');
      console.log('Currently Due:', account.requirements.currently_due);
      console.log('Eventually Due:', account.requirements.eventually_due);
      console.log('Past Due:', account.requirements.past_due);
    }

    return account;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAccountStatus();
```

### Script 4: Create a Test Payment

**File:** `test-stripe-connect-payment.js`

```javascript
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);

const CONNECTED_ACCOUNT_ID = 'acct_xxxxx'; // Replace
const AMOUNT = 1000; // $10.00 in cents
const APPLICATION_FEE = 200; // $2.00 platform fee

async function createPayment() {
  console.log('Creating test payment...\n');

  try {
    // Step 1: Create a PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: AMOUNT,
      currency: 'usd',
      application_fee_amount: APPLICATION_FEE,
      transfer_data: {
        destination: CONNECTED_ACCOUNT_ID,
      },
    });

    console.log('✅ Payment Intent created!');
    console.log('Payment Intent ID:', paymentIntent.id);
    console.log('Client Secret:', paymentIntent.client_secret);
    console.log('');
    console.log('Amount:', `$${AMOUNT / 100}`);
    console.log('Platform Fee:', `$${APPLICATION_FEE / 100}`);
    console.log('To Connected Account:', `$${(AMOUNT - APPLICATION_FEE) / 100}`);

    return paymentIntent;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createPayment();
```

## 🎯 Quick Start for Tomorrow Morning

1. **Run the setup checker:**
   ```bash
   node check-stripe-connect-live.js
   ```
   Should show: ✅ STRIPE CONNECT IS ENABLED!

2. **Create your first connected account:**
   ```bash
   # Copy Script 1 above to test-stripe-connect-create-account.js
   node test-stripe-connect-create-account.js
   ```

3. **Generate onboarding link:**
   ```bash
   # Copy Script 2, add the account ID from step 2
   node test-stripe-connect-onboarding.js
   ```

4. **Visit the onboarding link** (it will show in the console)

5. **Check if onboarding completed:**
   ```bash
   node test-stripe-connect-check-account.js
   ```

6. **Test a payment:**
   ```bash
   node test-stripe-connect-payment.js
   ```

## 📚 Key Concepts

### Account Types

- **Express:** Stripe handles onboarding UI (easiest)
- **Standard:** Separate Stripe account, you just connect to it
- **Custom:** Full control, you handle everything

### Payment Flow

```
Customer pays $10
  ↓
Platform (you) receives $10
  ↓
Platform keeps $2 (application fee)
  ↓
Connected account receives $8 (transfer)
```

### Webhooks to Listen For

```javascript
// Add these to your webhook handler:
'account.updated'              // When connected account status changes
'account.application.authorized' // When account connects to your platform
'account.application.deauthorized' // When account disconnects
'payment_intent.succeeded'     // When payment completes
'transfer.created'             // When transfer to connected account is made
```

## 🔗 Useful Links

- **Live Dashboard:** https://dashboard.stripe.com/connect/accounts/overview
- **Test Dashboard:** https://dashboard.stripe.com/test/connect/accounts/overview
- **Connect Settings:** https://dashboard.stripe.com/settings/connect
- **Applications:** https://dashboard.stripe.com/settings/applications
- **Stripe Connect Docs:** https://stripe.com/docs/connect

## ⚠️ Important Notes

1. **Don't mix test and live data** - Always check which mode you're in
2. **Account links expire** - Generate new ones if they expire (a few minutes)
3. **Webhooks are critical** - Set them up to know when accounts complete onboarding
4. **Platform fees** - You can charge 0-25% as application fees
5. **Payouts** - Connected accounts can set their own payout schedules

## 🚀 Production Checklist

Before going live with Stripe Connect:

- [ ] Set up webhook endpoints for all Connect events
- [ ] Create proper onboarding flow in your UI
- [ ] Add refresh/return URLs that actually exist
- [ ] Test the full payment flow end-to-end
- [ ] Document your application fee structure
- [ ] Set up proper error handling
- [ ] Create dashboard for connected accounts
- [ ] Add Terms of Service for platform
- [ ] Test disconnecting accounts

Good luck tomorrow! 🌙
