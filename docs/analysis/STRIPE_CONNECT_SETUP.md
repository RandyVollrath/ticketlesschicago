# Stripe Connect Setup Guide
## Remitter Payment Integration with Direct Deposit

---

## 🎯 Overview

This system allows remitters (currency exchanges, dealers) to:
- **Receive payments DIRECTLY** into their Stripe account
- You automatically collect a **$2 platform fee** per transaction
- Remitters keep 100% of the city sticker price
- Everything is automated via Stripe Connect

---

## 📋 What You Need to Do

### Phase 1: Stripe Dashboard Setup (One-Time, 10 minutes)

#### Step 1: Enable Stripe Connect

1. **Go to:** https://dashboard.stripe.com/connect/accounts/overview
2. Click **"Get Started with Connect"**
3. Choose **"Build a platform or marketplace"**
4. Click **"Continue"**

#### Step 2: Choose Account Type

Select **"Express"** accounts:
- ✅ Fastest onboarding (5 minutes for remitters)
- ✅ Stripe handles all compliance
- ✅ Remitters get their own Stripe dashboard
- ✅ Best for small businesses

#### Step 3: Configure Platform Settings

**Go to:** https://dashboard.stripe.com/settings/connect

Set these URLs:
```
Redirect URI: https://autopilotamerica.com/api/stripe-connect/callback
Account Refresh URL: https://autopilotamerica.com/remitter-portal?reauth=true
Account Return URL: https://autopilotamerica.com/remitter-portal?success=true
```

#### Step 4: Get Your Client ID

**Go to:** https://dashboard.stripe.com/settings/applications

You'll see:
```
Client ID: ca_xxxxxxxxxxxxxxxxxxxxx
```

**Copy this!** You'll need it.

#### Step 5: Add to Environment Variables

Update your `.env.local` and production environment:

```bash
# Existing Stripe keys
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx

# NEW: Add this
STRIPE_CONNECT_CLIENT_ID=ca_xxxxxxxxxxxxx
NEXT_PUBLIC_BASE_URL=https://autopilotamerica.com
```

**In Vercel:**
1. Go to: https://vercel.com/your-project/settings/environment-variables
2. Add `STRIPE_CONNECT_CLIENT_ID` = `ca_xxxxxxxxxxxxx`
3. Add `NEXT_PUBLIC_BASE_URL` = `https://autopilotamerica.com`
4. Redeploy

---

### Phase 2: Database Setup

#### Run the SQL Migration

```bash
# Connect to your database
psql $DATABASE_URL -f database/migrations/create_renewal_intake_system.sql
```

This creates:
- `renewal_partners` - Remitter accounts
- `renewal_orders` - Customer orders
- `renewal_document_reviews` - Document validation queue
- `renewal_order_activity_log` - Audit trail
- `renewal_partner_stats` - Dashboard stats

---

### Phase 3: Create Your First Remitter (Testing)

#### Option A: Via Signup Page (Recommended)

1. **Visit:** `https://autopilotamerica.com/remitter-signup`
2. Fill out the form
3. Click "Create Account"
4. **Save the API key** that's displayed!
5. Click "Connect Stripe Account"
6. Complete Stripe onboarding (5 minutes)

#### Option B: Manual SQL Insert

```sql
INSERT INTO renewal_partners (
  name,
  email,
  phone,
  api_key,
  business_type,
  status,
  auto_forward_payments,
  service_fee_amount
) VALUES (
  'Test Remitter',
  'yourtest@email.com',
  '3125551234',
  'ap_live_' || encode(gen_random_bytes(24), 'hex'),
  'remitter',
  'active',
  true,
  2.00  -- Your $2 fee
) RETURNING api_key;
```

**Copy the returned API key!**

Then connect Stripe:
```
Visit: https://autopilotamerica.com/api/stripe-connect/authorize?partnerId=<partner-id>
```

---

### Phase 4: Test the Payment Flow

#### Step 1: Login to Remitter Portal

1. **Visit:** `https://autopilotamerica.com/remitter-portal`
2. **Enter API key:** `ap_live_xxxxxxxxxxxxx`
3. Click "Log In"

You should see the dashboard!

#### Step 2: Test Stripe Connection Status

Check if Stripe account is connected:
```sql
SELECT
  name,
  email,
  stripe_connected_account_id,
  stripe_account_status,
  payout_enabled,
  onboarding_completed
FROM renewal_partners
WHERE email = 'yourtest@email.com';
```

Should show:
- `stripe_connected_account_id`: acct_xxxxx
- `stripe_account_status`: active
- `payout_enabled`: true
- `onboarding_completed`: true

#### Step 3: Create a Test Order

Visit the customer intake form:
```
https://autopilotamerica.com/renewal-intake?partnerId=<partner-id>
```

Fill out:
1. Customer info (use test data)
2. Vehicle info
3. Upload test documents (any images/PDFs)
4. Review and submit

#### Step 4: Process Test Payment

Use Stripe test card:
```
Card: 4242 4242 4242 4242
Expiry: 12/34
CVC: 123
ZIP: 60601
```

**What happens:**
1. Customer pays $105 (for example)
2. $105 goes DIRECTLY to remitter's Stripe account
3. Stripe automatically deducts $2 platform fee
4. Remitter receives $103
5. You receive $2 in your platform balance

#### Step 5: Verify Payment

**In Remitter's Stripe Dashboard:**
```
https://dashboard.stripe.com/connect/accounts/<acct_id>
```
They'll see:
- Payment: $105
- Received: $103
- Platform fee: -$2

**In Your Stripe Dashboard:**
```
https://dashboard.stripe.com/connect/application_fees
```
You'll see:
- Application fee collected: $2

---

## 💰 Payment Flow Diagram

```
Customer Checkout
      ↓
Pays $105 via Stripe
      ↓
┌─────────────────────────────┐
│   Stripe Payment Intent     │
│                             │
│  Amount: $105               │
│  Destination: Remitter      │
│  Application Fee: $2        │
└─────────────────────────────┘
      ↓
┌──────────────┬──────────────┐
│   Remitter   │  Platform    │
│  Receives    │  Receives    │
│    $103      │     $2       │
└──────────────┴──────────────┘
```

**Key Points:**
- ✅ Payment goes DIRECTLY to remitter (not through you)
- ✅ Your $2 fee is automatically deducted by Stripe
- ✅ Remitter sees $103 deposit
- ✅ You see $2 in application fees
- ✅ No manual transfers needed!

---

## 🔧 Code Example (How It Works)

### Customer Payment Processing

```typescript
// When customer pays
const paymentIntent = await stripe.paymentIntents.create({
  amount: 10500, // $105.00
  currency: 'usd',

  // Money goes DIRECTLY to remitter
  transfer_data: {
    destination: remitter.stripe_connected_account_id, // acct_xxxxx
  },

  // Your $2 fee (automatically deducted)
  application_fee_amount: 200, // $2.00

  payment_method: paymentMethodId,
  confirm: true,
});
```

**Result:**
- Remitter gets: $105 - $2 = $103 ✅
- You get: $2 ✅
- Customer pays: $105 total ✅

---

## 🎫 Remitter Onboarding Flow

### Step 1: Remitter Signs Up

1. Visits `/remitter-signup`
2. Fills out business info
3. Gets API key instantly

### Step 2: Connect Stripe

1. Clicks "Connect Stripe Account"
2. Redirected to Stripe
3. Creates Stripe Express account (5 minutes)
4. Completes verification:
   - Business info
   - Bank account
   - Tax info (EIN or SSN)
   - Identity verification

### Step 3: Start Processing

1. Logs into `/remitter-portal` with API key
2. Views dashboard
3. Starts accepting orders

---

## 📊 Dashboard Features for Remitters

### Stats View
- Today's orders & revenue
- This week/month/all-time
- Pending document reviews

### Orders List
- Filter by status (submitted, paid, completed)
- Search by customer/plate
- View order details

### Exports
- **Daily reconciliation CSV** (for accounting)
- **PDF batch report** (printable for city submission)

### Document Validation
- Auto-validation checklist
- Manual review queue
- Approve/reject documents

---

## 🔐 API Key Management

### Generate New API Keys

**For new remitters:**
- They sign up at `/remitter-signup`
- System auto-generates: `ap_live_<random48chars>`
- They save it (shown once!)

**Manual generation (SQL):**
```sql
-- Create new partner with API key
INSERT INTO renewal_partners (name, email, api_key, ...)
VALUES (
  'New Remitter',
  'email@example.com',
  'ap_live_' || encode(gen_random_bytes(24), 'hex'),
  ...
) RETURNING api_key;
```

### View Existing API Keys

```sql
SELECT
  name,
  email,
  api_key,
  created_at,
  status
FROM renewal_partners
ORDER BY created_at DESC;
```

### Regenerate API Key (if lost)

```sql
UPDATE renewal_partners
SET api_key = 'ap_live_' || encode(gen_random_bytes(24), 'hex')
WHERE id = '<partner-id>'
RETURNING api_key;
```

---

## ✅ Testing Checklist

### Before Going Live

- [ ] Stripe Connect enabled in dashboard
- [ ] Client ID added to environment variables
- [ ] Database migration run successfully
- [ ] Test remitter account created
- [ ] Test Stripe account connected
- [ ] Test order submitted successfully
- [ ] Test payment processed (remitter received $103, you received $2)
- [ ] Test CSV export works
- [ ] Test PDF generation works
- [ ] Test document validation works

### Go-Live Steps

1. **Switch to live Stripe keys:**
   ```bash
   STRIPE_SECRET_KEY=sk_live_xxxxx (not sk_test_)
   STRIPE_CONNECT_CLIENT_ID=ca_xxxxx (live, not test)
   ```

2. **Deploy to production:**
   ```bash
   git add -A
   git commit -m "Add Stripe Connect remitter integration"
   git push origin main
   ```

3. **Update Vercel environment variables** (use live keys)

4. **Invite first real remitter:**
   - Send them: `https://autopilotamerica.com/remitter-signup`
   - They complete onboarding
   - Start processing real orders!

---

## 💡 Common Issues & Solutions

### Issue: "Partner has not completed payment setup"

**Cause:** Remitter hasn't finished Stripe onboarding

**Fix:**
```sql
-- Check status
SELECT onboarding_completed, stripe_account_status
FROM renewal_partners
WHERE email = 'remitter@email.com';

-- If not completed, send them back to onboarding
Visit: /api/stripe-connect/authorize?partnerId=<id>
```

### Issue: "Invalid API key"

**Cause:** API key not saved or incorrect

**Fix:**
```sql
-- Look up their API key
SELECT api_key FROM renewal_partners
WHERE email = 'remitter@email.com';

-- Or regenerate new one
UPDATE renewal_partners
SET api_key = 'ap_live_' || encode(gen_random_bytes(24), 'hex')
WHERE email = 'remitter@email.com'
RETURNING api_key;
```

### Issue: Payment fails with "Account not found"

**Cause:** Stripe connected account ID not saved

**Fix:**
```sql
-- Check if account ID exists
SELECT stripe_connected_account_id
FROM renewal_partners
WHERE email = 'remitter@email.com';

-- If null, reconnect Stripe
-- Send remitter to: /api/stripe-connect/authorize?partnerId=<id>
```

---

## 📈 Scaling Tips

### When You Have 10+ Remitters

1. **Automate onboarding emails**
   - Welcome email with API key
   - Stripe setup reminders
   - Training videos

2. **Add admin dashboard**
   - View all remitters
   - See total platform revenue
   - Monitor Stripe connection status

3. **Implement webhooks**
   - Listen for Stripe Connect account updates
   - Auto-update partner status
   - Send notifications

4. **Add support system**
   - Help docs
   - Video tutorials
   - Support chat

---

## 🎯 Next Steps

1. ✅ Complete Phase 1 (Stripe Dashboard setup)
2. ✅ Run database migration
3. ✅ Create test remitter account
4. ✅ Test payment flow end-to-end
5. 🚀 Invite your first real remitter!

**Questions?** Check the code comments or test with Stripe test mode first.

**Ready to launch?** Switch to live keys and go! 🎉
