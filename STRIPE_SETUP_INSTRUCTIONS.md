# Stripe Setup Instructions for Protection Service

## What Changed

### Pricing Update
- Monthly: $10/mo → **$12/mo**
- Annual: $100/year → **$99/year**

### Service Fee Breakdown (Regulatory Compliance)
**Monthly ($12/mo):**
- Ticket Protection & Guarantee: $11/mo → Platform
- Sticker Service Fee: $1/mo → (Regulated, paid to remitter at renewal time)

**Annual ($99/year):**
- Ticket Protection & Guarantee: $87/year → Platform
- Sticker Service Fee: $12/year → (Regulated, paid to remitter at renewal time)

### Payment Timing
- **At signup**: Customer pays $12/mo or $99/year → ALL goes to platform
- **At renewal** (30 days before expiration): Customer pays sticker cost → Remitter gets paid via Stripe Connect

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

---

## How It Works

### Customer Checkout Flow

When a customer signs up for Protection:

1. **Stripe Checkout shows:**
   ```
   Protection Service (Monthly)     $12/mo
     • Ticket Protection             $11/mo
     • Sticker Service Fee           $1/mo
   ────────────────────────────────
   Total due today: $12
   Then $12/month recurring
   ```

   OR for annual:
   ```
   Protection Service (Annual)      $99/year
     • Ticket Protection             $87/year
     • Sticker Service Fee           $12/year
   ────────────────────────────────
   Total due today: $99
   Then $99/year recurring
   ```

2. **Webhook processes payment:**
   - Creates user profile with `has_protection: true`
   - Saves renewal dates and vehicle type
   - Saves stripe_customer_id for future charges
   - Records consent for automated renewals

3. **Automated renewals (30 days before expiration):**
   - Charges customer for sticker + service fee + processing fee:
     - Base sticker prices (exact amounts remitter receives):
       - Motorbike (MB): $53.04
       - Passenger (P): $100.17
       - Large Passenger (LP): $159.12
       - Small Truck (ST): $235.71
       - Large Truck (LT): $530.40
     - Service fee: $2.50 (operational costs, support, infrastructure)
     - Processing fee: Calculated to cover Stripe's 2.9% + $0.30 on total transaction
     - Example: $100.17 sticker → customer pays $106.05 total
       - Breakdown: Remitter gets $100.17, Platform gets $2.50, Stripe gets $3.38
   - Sends 100% of sticker price to remitter via Stripe Connect
   - Platform keeps $2.50 service fee per renewal

---

## Testing

### Test Mode Setup

1. Create test versions of all products in Stripe test mode
2. Add test price IDs to environment variables:
   ```
   STRIPE_TEST_PROTECTION_MONTHLY_PRICE_ID=price_xxxxx
   STRIPE_TEST_PROTECTION_ANNUAL_PRICE_ID=price_xxxxx
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
   - $12/mo or $99/year charged ✓
   - Payment method saved for future renewals ✓

---

## Production Checklist

Before going live:

- [ ] Live subscription products created ($12/mo, $99/year)
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

# Stripe Connect
STRIPE_CONNECT_CLIENT_ID=ca_xxxxx               # Live client ID

# Cron job security
CRON_SECRET=<your-existing-cron-secret>

# Test mode (optional - only if testing)
STRIPE_MODE=test
STRIPE_TEST_PROTECTION_MONTHLY_PRICE_ID=price_xxxxx
STRIPE_TEST_PROTECTION_ANNUAL_PRICE_ID=price_xxxxx
```

---

## Revenue Model

### Per Customer Signup:
- **Customer pays**: $12/mo or $99/year
- **You receive**: $12/mo or $99/year (100% of subscription)
  - Includes: Protection guarantee + Regulated sticker service fee
- **Remitter receives**: $0 upfront (paid at renewal time)

### Per Renewal (automated, 30 days before expiration):
- **Customer pays**: Sticker cost + service fee + processing fee (varies by vehicle type)
  - Example: $100.17 (sticker) + $2.50 (service) + $3.38 (processing) = $106.05 total
- **Remitter receives**: 100% of sticker cost ($53-530, depending on vehicle type)
- **Platform receives**: $2.50 service fee per renewal
- **Stripe receives**: Processing fee (2.9% + $0.30 on total transaction)

### Example: 100 Customers (all Passenger vehicles)
- **Monthly subscriptions**: $1,200/mo recurring revenue ($14,400/year)
- **Or annual subscriptions**: $9,900/year recurring revenue
- **Renewal revenue**: $2.50 × 100 renewals = $250/year
- **Total annual revenue**:
  - Monthly plan: $14,400 + $250 = **$14,650**
  - Annual plan: $9,900 + $250 = **$10,150**

---

## Next Steps

1. ✅ Wait for Stripe Connect live client ID approval
2. Create subscription products in Stripe ($12/mo, $99/year)
3. Add all price IDs to Vercel
4. Test in test mode
5. Switch to live and launch!
