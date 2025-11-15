# Manual Testing Checklists

## ✅ QUICK WINS (Do These First - 30 min total)

### 1. Stripe Connect Test (5 min)
- [ ] Run: `node check-stripe-connect-live.js`
- [ ] Verify: Shows "✅ STRIPE CONNECT IS ENABLED"
- [ ] Done! You're approved.

### 2. License Upload Validation Test (10 min)
**Test with BAD images:**
- [ ] Upload a blurry photo → Should fail
- [ ] Upload a non-license (passport/random photo) → Should fail
- [ ] Upload a dark/underexposed image → Should fail

**Where to test:** https://autopilotamerica.com/settings#license-upload

**Expected:** Google Vision rejects with error message

### 3. Permit Zone Visibility Check (5 min)
**Test 1: User WITHOUT permit zone**
- [ ] Create/login as user without permit zone
- [ ] Go to /settings
- [ ] Verify: NO license upload section shows
- [ ] Verify: NO proof of residency section shows

**Test 2: User WITH permit zone**
- [ ] Login as user with permit zone (your account)
- [ ] Go to /settings
- [ ] Verify: License upload section shows
- [ ] Verify: Proof of residency section shows
- [ ] Verify: Email forwarding address shows

### 4. Proof of Residency Flow Test (10 min)
- [ ] Go to /settings
- [ ] Find email forwarding address: `8777a96d-dfdc-48ab-9dd2-182c9e34080a@bills.autopilotamerica.com`
- [ ] Copy it
- [ ] Send a test email to that address with a PDF attached
- [ ] Wait 2 minutes
- [ ] Refresh /settings
- [ ] Verify: Latest bill shows up
- [ ] Check: Shows correct date

---

## 💰 PAYMENT AMOUNT VERIFICATION (30 min)

### Check All Pages Have Correct Prices:

#### /protection Page
- [ ] Monthly: **$7/month**
- [ ] Annual: **$70/year** (save $14)
- [ ] Features listed correctly
- [ ] No hidden fees mentioned

#### City Sticker Pricing (wherever shown)
- [ ] Passenger: **$151/year**
- [ ] Motorcycle: **$41/year**
- [ ] B-Truck: **$151/year**
- [ ] C-Truck: **$218/year**
- [ ] Persons with Disabilities: **$151/year**
- [ ] RT (Recreational Trailer): **$18-$50/year**
- [ ] RV (Recreational Vehicle): **$78-$102/year**

#### License Plate Renewal
- [ ] Standard: **$151**
- [ ] Personalized: **+$7/year**
- [ ] Vanity: **+$13/year**

#### Permit Fees (if applicable)
- [ ] Check varies by zone
- [ ] Should pull from city data

**Where to check:**
1. Settings page dropdowns
2. Renewal reminder emails
3. Checkout pages
4. Confirmation emails

---

## 🔒 DATA RETENTION & PRIVACY (15 min)

### License Storage Test
- [ ] Upload license with "store until expiry" checked
- [ ] Upload license with "delete after 48 hours" checked
- [ ] Verify consent is stored in database:
  ```bash
  node check-license-uploads.js
  ```
- [ ] Check fields: `license_reuse_consent_given`, `license_valid_until`

### Bill Storage Test
- [ ] Check when oldest bill was uploaded
- [ ] Verify bills older than 30 days are deleted
- [ ] Run:
  ```bash
  # Check if cleanup cron exists
  grep "cleanup.*residency" vercel.json
  ```

### Privacy Policy Check
- [ ] Visit /privacy (if exists)
- [ ] Verify mentions:
  - [ ] What data is collected
  - [ ] How long it's stored
  - [ ] Who has access
  - [ ] How to delete your data
  - [ ] Encryption methods

---

## 📋 TERMS & CLARITY (15 min)

### Protection Page Review
Go to: /protection

**Check for:**
- [ ] Clear explanation of 80% reimbursement
- [ ] Clear $200/year limit
- [ ] What's covered (parking tickets)
- [ ] What's NOT covered (moving violations, towing, boots)
- [ ] How to submit claims
- [ ] Cancellation policy
- [ ] Renewal reminder details

**Missing anything?** Note what needs to be added.

### Signup Flow
- [ ] Start protection signup
- [ ] Look for Terms acceptance checkbox
- [ ] Verify links to full Terms of Service
- [ ] Check Terms are clear and readable

---

## 🎫 STRIPE CONNECT QUICK TEST (30 min)

### Setup (10 min)
```bash
# Create test account
node -e "
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);
stripe.accounts.create({
  type: 'express',
  country: 'US',
  email: 'test-remitter@example.com',
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
}).then(account => {
  console.log('Account ID:', account.id);
  console.log('Save this!');
});
"
```

### Create Onboarding Link (5 min)
```bash
# Replace ACCOUNT_ID with ID from above
node -e "
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);
const ACCOUNT_ID = 'acct_xxxxx';
stripe.accountLinks.create({
  account: ACCOUNT_ID,
  refresh_url: 'https://autopilotamerica.com',
  return_url: 'https://autopilotamerica.com',
  type: 'account_onboarding',
}).then(link => {
  console.log('Onboarding Link:');
  console.log(link.url);
  console.log('\nVisit this link to complete onboarding');
});
"
```

### Complete Onboarding (10 min)
- [ ] Click the link from above
- [ ] Fill out the Stripe Express onboarding
- [ ] Use test data (or real if you want)
- [ ] Complete all steps
- [ ] Verify redirects back to site

### Verify Status (5 min)
```bash
node -e "
const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);
const ACCOUNT_ID = 'acct_xxxxx';
stripe.accounts.retrieve(ACCOUNT_ID).then(account => {
  console.log('Charges enabled:', account.charges_enabled);
  console.log('Payouts enabled:', account.payouts_enabled);
  console.log('Details submitted:', account.details_submitted);
});
"
```

Expected:
- [ ] charges_enabled: true
- [ ] payouts_enabled: true
- [ ] details_submitted: true

---

## 🚗 PAYMENT FLOW TESTS

### City Sticker Test (When Connect is ready)
**Can't do this until Stripe Connect working!**

- [ ] Login as user with permit zone
- [ ] Have license uploaded
- [ ] Have proof of residency uploaded
- [ ] Start city sticker renewal flow
- [ ] Select vehicle type
- [ ] See correct price
- [ ] Enter payment info
- [ ] Submit
- [ ] Verify payment goes to remitter account
- [ ] Check email confirmation

### License Plate Test
**Can't do this until payment flow is built!**

- [ ] Start license plate renewal
- [ ] Select plate type (passenger, vanity, personalized)
- [ ] See correct price
- [ ] Enter payment
- [ ] Submit
- [ ] Verify payment successful

---

## 📧 UTILITY BILL SETUP (Do manually, 5 min each)

### ComEd
1. Login: https://secure.comed.com
2. My Account → Paperless Billing → Email Preferences
3. Add: `8777a96d-dfdc-48ab-9dd2-182c9e34080a@bills.autopilotamerica.com`
4. Test: Request bill to be emailed

### Peoples Gas
1. Login: https://www.peoplesgasdelivery.com
2. Billing → Email Settings
3. Add forwarding email
4. Test by requesting bill

### Xfinity
1. Login: https://customer.xfinity.com
2. Billing → Paperless Billing
3. Add email address
4. Verify and test

### Others
- Water bill (if separate)
- Electric (if not ComEd)
- Internet (if not Xfinity)

---

## ✅ PRIORITY ORDER FOR MANUAL TESTS

### Do TODAY (1 hour):
1. ✅ Stripe Connect verification (5 min) - DONE already!
2. Permit zone visibility check (5 min)
3. Payment amount verification (30 min)
4. Terms & clarity review (15 min)

### Do TOMORROW (1 hour):
5. License validation test (10 min)
6. Proof of residency flow (10 min)
7. Data retention check (15 min)
8. Stripe Connect account creation (30 min)

### Do BEFORE LAUNCH (2 hours):
9. Full city sticker payment test
10. License plate payment test
11. End-to-end user flows
12. Utility bill setup

---

## 🎯 QUICK START

Right now, go do:

1. **Payment verification** - Check every page for correct prices
2. **Permit zone test** - Make sure it only shows to right users
3. **Terms review** - Read /protection page, note what's unclear

Those 3 things take 45 minutes and catch the highest-risk issues.

**Sleep well, test tomorrow!** 🌙
