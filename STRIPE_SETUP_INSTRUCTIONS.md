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
   - Charges customer for sticker + platform service fee + processing fee:
     - Base sticker prices (exact amounts remitter receives):
       - Motorbike (MB): $53.04
       - Passenger (P): $100.17
       - Large Passenger (LP): $159.12
       - Small Truck (ST): $235.71
       - Large Truck (LT): $530.40
     - Platform service fee: $2.50 (operational costs, support, infrastructure)
     - Processing fee: Calculated to cover Stripe's 2.9% + $0.30 on total transaction
     - Example: $100.17 sticker → customer pays $106.05 total
       - Customer charged: $106.05
       - Remitter receives: $112.17 ($100.17 sticker + $12 processing service)
       - Platform keeps: $2.50 (from customer)
       - Platform pays: $12 (from subscription balance to remitter)
       - Stripe keeps: $3.38 (processing fee)
   - **Two transfers to remitter:**
     - Transfer #1 (from customer payment): $100.17 (sticker cost)
     - Transfer #2 (from platform balance): $12.00 (processing service fee)
     - **Total remitter receives: $112.17**
   - **Platform net:** $2.50 - $12 = **-$9.50 per renewal**
     - This is covered by subscription revenue ($1/mo × 12 months = $12/year per customer)

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
- **Customer pays**: Sticker cost + platform service fee + processing fee (varies by vehicle type)
  - Example: $100.17 (sticker) + $2.50 (platform service) + $3.38 (processing) = $106.05 total
- **Remitter receives**: Sticker cost + $12 processing service fee
  - Example: $100.17 + $12 = $112.17 total
  - Transfer #1 (from customer): $100.17
  - Transfer #2 (from platform balance): $12.00
- **Platform receives**: $2.50 per renewal (from customer)
- **Platform pays**: $12 per renewal (to remitter, from subscription balance)
- **Platform net per renewal**: $2.50 - $12 = **-$9.50**
- **Stripe receives**: Processing fee (~$3.38 for Passenger vehicle)

### Example: 100 Customers (all Passenger vehicles, monthly plan)
- **Subscription revenue**: $1,200/mo ($14,400/year)
  - Protection revenue: $1,100/mo ($13,200/year)
  - Reserved for remitter service: $100/mo ($1,200/year)
- **Renewal revenue from customers**: $2.50 × 100 = $250
- **Renewal payments to remitters**: $12 × 100 = -$1,200
- **Net renewal revenue**: $250 - $1,200 = **-$950**
- **Total annual revenue**: $13,200 + $250 - $1,200 = **$12,250**

**Key insight:** The $1/mo subscription fee covers the $12 annual payment to remitters. Platform makes money from Protection service ($11/mo) + small renewal fee ($2.50).

---

## Next Steps

1. ✅ Wait for Stripe Connect live client ID approval
2. Create subscription products in Stripe ($12/mo, $99/year)
3. Add all price IDs to Vercel
4. Test in test mode
5. Switch to live and launch!
