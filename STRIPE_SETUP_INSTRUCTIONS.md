# Stripe Setup Instructions for Protection Service

## What Changed

### Pricing Update
- Monthly: $10/mo → **$12/mo**
- Annual: $100/year → **$99/year**

### New Feature: $12 Remitter Setup Fee
- One-time $12 charge at signup
- Sent directly to remitter via Stripe Connect
- No platform fee on this charge

---

## Required Stripe Setup

### 1. Update Subscription Pricing (If Not Already Done)

**In Stripe Dashboard:**

1. Go to Products → Create Product
2. Create "Protection Service - Monthly"
   - Price: **$12.00**
   - Billing period: Monthly
   - Copy the Price ID (starts with `price_`)

3. Create "Protection Service - Annual"
   - Price: **$99.00**
   - Billing period: Yearly
   - Copy the Price ID (starts with `price_`)

4. Add to Vercel environment variables:
   ```
   STRIPE_PROTECTION_MONTHLY_PRICE_ID=price_xxxxx
   STRIPE_PROTECTION_ANNUAL_PRICE_ID=price_xxxxx
   ```

---

### 2. Create Remitter Setup Fee Product

**In Stripe Dashboard:**

1. Go to Products → Create Product
2. Name: "Remitter Setup Fee"
3. Description: "One-time setup fee for city sticker renewal service"
4. Pricing:
   - Price: **$12.00**
   - One time (not recurring)
5. Metadata (important for excluding from Rewardful):
   ```
   exclude_from_commission: true
   ```
6. Save and copy the Price ID

7. Add to Vercel environment variables:
   ```
   STRIPE_REMITTER_SETUP_FEE_PRICE_ID=price_xxxxx
   ```

---

## How It Works

### Customer Checkout Flow

When a customer signs up for Protection:

1. **Stripe Checkout shows:**
   ```
   Protection Service (Monthly)     $12/mo
   Remitter Setup Fee (one-time)    $12
   ────────────────────────────────
   Total due today: $24
   Then $12/month recurring
   ```

   OR for annual:
   ```
   Protection Service (Annual)      $99/year
   Remitter Setup Fee (one-time)    $12
   ────────────────────────────────
   Total due today: $111
   Then $99/year recurring
   ```

2. **Webhook processes payment:**
   - Creates user profile with `has_protection: true`
   - Saves renewal dates
   - **Charges $12 to customer's saved card**
   - **Sends $12 to remitter via Stripe Connect** (transfer_data)
   - Logs transaction in `renewal_charges` table

3. **Automated renewals (30 days before expiration):**
   - Charges $100-530 for sticker (depends on vehicle type)
   - Sends to remitter via Connect
   - Platform keeps $2 fee

---

## Testing

### Test Mode Setup

1. Create test versions of all products in Stripe test mode
2. Add test price IDs to environment variables:
   ```
   STRIPE_TEST_PROTECTION_MONTHLY_PRICE_ID=price_xxxxx
   STRIPE_TEST_PROTECTION_ANNUAL_PRICE_ID=price_xxxxx
   STRIPE_TEST_REMITTER_SETUP_FEE_PRICE_ID=price_xxxxx
   ```

3. Set test mode:
   ```
   STRIPE_MODE=test
   ```

### Test the Flow

1. Visit `/protection`
2. Fill out form
3. Use Stripe test card: `4242 4242 4242 4242`
4. Check Stripe Dashboard:
   - Subscription created ✓
   - $12 charge to customer ✓
   - Transfer to remitter Connect account ✓

---

## Production Checklist

Before going live:

- [ ] Live subscription products created ($12/mo, $99/year)
- [ ] Remitter setup fee product created ($12 one-time)
- [ ] All LIVE price IDs added to Vercel
- [ ] Stripe Connect live client ID approved and added
- [ ] Active remitter with connected Stripe account
- [ ] Test checkout in test mode works
- [ ] Set `STRIPE_MODE=live` (or remove it - defaults to live)
- [ ] Deploy to production

---

## Environment Variables Summary

Required in Vercel:

```bash
# Subscription pricing
STRIPE_PROTECTION_MONTHLY_PRICE_ID=price_xxxxx  # $12/mo
STRIPE_PROTECTION_ANNUAL_PRICE_ID=price_xxxxx   # $99/year

# Remitter fee
STRIPE_REMITTER_SETUP_FEE_PRICE_ID=price_xxxxx  # $12 one-time

# Stripe Connect
STRIPE_CONNECT_CLIENT_ID=ca_xxxxx               # Live client ID

# Test mode (optional - only if testing)
STRIPE_MODE=test
STRIPE_TEST_PROTECTION_MONTHLY_PRICE_ID=price_xxxxx
STRIPE_TEST_PROTECTION_ANNUAL_PRICE_ID=price_xxxxx
STRIPE_TEST_REMITTER_SETUP_FEE_PRICE_ID=price_xxxxx
```

---

## Revenue Model

### Per Customer Signup:
- **You receive**: $12/mo or $99/year (subscription)
- **Remitter receives**: $12 (setup fee, via Connect)

### Per Renewal (automated):
- **Customer pays**: $100-530 (sticker cost)
- **Remitter receives**: $98-528 (sticker cost minus $2)
- **You receive**: $2 (platform fee, via Connect)

### Example: 100 Customers
- **Monthly subscriptions**: $1,200/mo recurring revenue
- **Or annual**: $9,900/year recurring revenue
- **Setup fees**: $1,200 one-time to remitters
- **Renewal fees**: $200 in platform fees per 100 renewals

---

## Next Steps

1. ✅ Wait for Stripe Connect live client ID approval
2. Create subscription products in Stripe
3. Create remitter setup fee product
4. Add all price IDs to Vercel
5. Test in test mode
6. Switch to live and launch!
