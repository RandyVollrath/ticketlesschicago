# Stripe Test Mode Setup Guide

This guide shows you how to easily switch between Stripe test and live modes.

## Quick Switch

To switch between test and live mode, **just change one environment variable**:

```bash
# In .env.local
STRIPE_MODE="test"   # For testing
# or
STRIPE_MODE="live"   # For production
```

Then restart your dev server: `npm run dev`

---

## One-Time Setup

### Step 1: Get Your Stripe Keys

#### Test Mode Keys
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Toggle to **Test Mode** (top right corner - you'll see "Test Mode" banner)
3. Go to **Developers** → **API Keys**
4. Copy:
   - Publishable key (starts with `pk_test_`)
   - Secret key (starts with `sk_test_`)

#### Live Mode Keys
1. Toggle to **Live Mode** (top right corner)
2. Go to **Developers** → **API Keys**
3. Copy:
   - Publishable key (starts with `pk_live_`)
   - Secret key (starts with `sk_live_`)

### Step 2: Get Webhook Secrets

#### Test Webhook
1. In **Test Mode**: **Developers** → **Webhooks**
2. Click your webhook endpoint or create one: `https://yourdomain.com/api/stripe-webhook`
3. Click **Reveal** under "Signing secret"
4. Copy the `whsec_test_...` value

#### Live Webhook
1. In **Live Mode**: **Developers** → **Webhooks**
2. Click your webhook endpoint or create one: `https://yourdomain.com/api/stripe-webhook`
3. Click **Reveal** under "Signing secret"
4. Copy the `whsec_...` value

### Step 3: Create Test Products

In **Test Mode**, create these products (same as live):

1. **Protection Subscriptions:**
   - Monthly ($12/month)
   - Annual ($120/year)

2. **City Stickers (by vehicle type):**
   - Motorbike - $53.04
   - Passenger - $100.17
   - Large Passenger - $159.12
   - Small Truck - $235.71
   - Large Truck - $530.40

3. **License Plates:**
   - Standard - $155
   - Vanity - $164

4. **Other:**
   - Permit Fee - $30

Copy all the test price IDs (start with `price_...`)

### Step 4: Add to .env.local

Create or update your `.env.local` file:

```bash
###########################################
# STRIPE MODE SWITCHER
###########################################
# Change this to switch between test/live
STRIPE_MODE="test"  # "test" or "live"

# Also need this for client-side (Next.js requirement)
NEXT_PUBLIC_STRIPE_MODE="test"  # Must match STRIPE_MODE above

###########################################
# TEST MODE KEYS
###########################################
STRIPE_TEST_SECRET_KEY="sk_test_xxxxxxxxxxxxx"
STRIPE_TEST_PUBLISHABLE_KEY="pk_test_xxxxxxxxxxxxx"
NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY="pk_test_xxxxxxxxxxxxx"
STRIPE_TEST_WEBHOOK_SECRET="whsec_test_xxxxxxxxxxxxx"

# Test Mode - Protection Subscriptions
STRIPE_TEST_PROTECTION_MONTHLY_PRICE_ID="price_test_xxxxx"
STRIPE_TEST_PROTECTION_ANNUAL_PRICE_ID="price_test_xxxxx"

# Test Mode - City Stickers
STRIPE_TEST_CITY_STICKER_MB_PRICE_ID="price_test_xxxxx"
STRIPE_TEST_CITY_STICKER_P_PRICE_ID="price_test_xxxxx"
STRIPE_TEST_CITY_STICKER_LP_PRICE_ID="price_test_xxxxx"
STRIPE_TEST_CITY_STICKER_ST_PRICE_ID="price_test_xxxxx"
STRIPE_TEST_CITY_STICKER_LT_PRICE_ID="price_test_xxxxx"

# Test Mode - License Plates
STRIPE_TEST_LICENSE_PLATE_PRICE_ID="price_test_xxxxx"
STRIPE_TEST_LICENSE_PLATE_VANITY_PRICE_ID="price_test_xxxxx"

# Test Mode - Permit Fee
STRIPE_TEST_PERMIT_FEE_PRICE_ID="price_test_xxxxx"

###########################################
# LIVE MODE KEYS
###########################################
STRIPE_SECRET_KEY="sk_live_xxxxxxxxxxxxx"
STRIPE_LIVE_SECRET_KEY="sk_live_xxxxxxxxxxxxx"
STRIPE_PUBLISHABLE_KEY="pk_live_xxxxxxxxxxxxx"
STRIPE_LIVE_PUBLISHABLE_KEY="pk_live_xxxxxxxxxxxxx"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_xxxxxxxxxxxxx"
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxx"
STRIPE_LIVE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxx"

# Live Mode - Protection Subscriptions
STRIPE_PROTECTION_MONTHLY_PRICE_ID="price_xxxxx"
STRIPE_PROTECTION_ANNUAL_PRICE_ID="price_xxxxx"
STRIPE_LIVE_PROTECTION_MONTHLY_PRICE_ID="price_xxxxx"
STRIPE_LIVE_PROTECTION_ANNUAL_PRICE_ID="price_xxxxx"

# Live Mode - City Stickers
STRIPE_CITY_STICKER_MB_PRICE_ID="price_xxxxx"
STRIPE_CITY_STICKER_P_PRICE_ID="price_xxxxx"
STRIPE_CITY_STICKER_LP_PRICE_ID="price_xxxxx"
STRIPE_CITY_STICKER_ST_PRICE_ID="price_xxxxx"
STRIPE_CITY_STICKER_LT_PRICE_ID="price_xxxxx"
STRIPE_LIVE_CITY_STICKER_MB_PRICE_ID="price_xxxxx"
STRIPE_LIVE_CITY_STICKER_P_PRICE_ID="price_xxxxx"
STRIPE_LIVE_CITY_STICKER_LP_PRICE_ID="price_xxxxx"
STRIPE_LIVE_CITY_STICKER_ST_PRICE_ID="price_xxxxx"
STRIPE_LIVE_CITY_STICKER_LT_PRICE_ID="price_xxxxx"

# Live Mode - License Plates
STRIPE_LICENSE_PLATE_PRICE_ID="price_xxxxx"
STRIPE_LICENSE_PLATE_VANITY_PRICE_ID="price_xxxxx"
STRIPE_LIVE_LICENSE_PLATE_PRICE_ID="price_xxxxx"
STRIPE_LIVE_LICENSE_PLATE_VANITY_PRICE_ID="price_xxxxx"

# Live Mode - Permit Fee
STRIPE_PERMIT_FEE_PRICE_ID="price_xxxxx"
STRIPE_LIVE_PERMIT_FEE_PRICE_ID="price_xxxxx"
```

---

## How to Use

### For Local Development (Testing)

1. Set `STRIPE_MODE="test"` and `NEXT_PUBLIC_STRIPE_MODE="test"` in `.env.local`
2. Restart dev server: `npm run dev`
3. You'll see in console: `🔑 Stripe Mode: TEST`
4. Use test cards:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - 3D Secure: `4000 0027 6000 3184`

### For Production (Live Charges)

1. Set `STRIPE_MODE="live"` and `NEXT_PUBLIC_STRIPE_MODE="live"` in `.env.local`
2. Restart dev server: `npm run dev`
3. You'll see in console: `🔑 Stripe Mode: LIVE`
4. **Real cards will be charged!**

### For Vercel Deployment

Add these environment variables in Vercel Dashboard:

**For Production environment:**
```bash
STRIPE_MODE="live"
NEXT_PUBLIC_STRIPE_MODE="live"
# ... plus all STRIPE_LIVE_* and STRIPE_TEST_* variables
```

**For Preview/Development environments:**
```bash
STRIPE_MODE="test"
NEXT_PUBLIC_STRIPE_MODE="test"
# ... plus all STRIPE_TEST_* and STRIPE_LIVE_* variables
```

**Important:** After changing `NEXT_PUBLIC_STRIPE_MODE`, you must:
- Redeploy on Vercel (rebuild is required)
- Restart `npm run dev` locally

---

## Testing Checklist

When in **Test Mode**, verify:

- [ ] Console shows `🔑 Stripe Mode: TEST`
- [ ] Checkout uses test card `4242 4242 4242 4242`
- [ ] Stripe Dashboard shows transaction in **Test Mode**
- [ ] Webhook events appear in Test Mode webhook logs
- [ ] No real charges are made
- [ ] Database records are created correctly

---

## Common Issues

### "Stripe publishable key not configured"
- Make sure `NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY` is set
- Make sure `NEXT_PUBLIC_STRIPE_MODE` matches `STRIPE_MODE`
- Restart dev server after changing env vars

### Webhooks not working in test mode
- Make sure you have a **separate webhook endpoint** for test mode
- Use Stripe CLI for local testing: `stripe listen --forward-to localhost:3000/api/stripe-webhook`
- Update `STRIPE_TEST_WEBHOOK_SECRET` with the webhook secret from Stripe CLI

### Wrong mode is being used
- Check console for `🔑 Stripe Mode:` log
- Verify both `STRIPE_MODE` and `NEXT_PUBLIC_STRIPE_MODE` are set
- Restart server after changing env vars

---

## Stripe CLI for Local Webhook Testing

For testing webhooks locally:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local dev server
stripe listen --forward-to localhost:3000/api/stripe-webhook

# Copy the webhook signing secret (starts with whsec_) to:
STRIPE_TEST_WEBHOOK_SECRET="whsec_xxxxx"
```

Then trigger test events:
```bash
stripe trigger checkout.session.completed
```

---

## Safety Tips

✅ **DO:**
- Always test in test mode first
- Use test cards for development
- Keep test and live keys separate
- Verify the mode before running transactions

❌ **DON'T:**
- Mix test and live price IDs
- Commit API keys to git
- Use live mode for development
- Forget to restart server after env changes

---

## Summary

**To switch modes, just change 2 lines in `.env.local`:**

```bash
STRIPE_MODE="test"  # or "live"
NEXT_PUBLIC_STRIPE_MODE="test"  # or "live"
```

Then restart your dev server. That's it! 🎉
