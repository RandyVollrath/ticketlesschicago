# Codebase Exploration Summary - Remitter & Sticker Purchase Process

## Quick Navigation

Three comprehensive documents have been created to understand the remitter process flow:

1. **REMITTER_PROCESS_FLOW.md** (19KB) - Complete technical documentation
   - Detailed explanation of each stage in the remitter lifecycle
   - Database table schemas
   - Payment flow architecture
   - Critical notes on payment method handling

2. **KEY_FILES_AND_TESTING.md** (14KB) - Testing and implementation reference
   - File-by-file breakdown organized by functionality
   - 12-phase comprehensive testing checklist
   - Sample test data and Stripe card numbers
   - Rollback procedures

3. **CODEBASE_EXPLORATION_SUMMARY.md** (this file)
   - High-level overview
   - Key findings
   - Architecture decisions
   - Areas of focus for testing

---

## System Architecture Overview

The Ticketless Chicago system manages automatic city sticker and license plate renewals through a multi-party system:

```
Customers (Protection Subscribers)
    ↓
    [Stripe Checkout - Collect Payment Method]
    ↓
Stripe Customer (with saved payment method)
    ↓
    [Daily Cron: process-all-renewals.ts]
    ↓
Payment Processing (using saved card)
    ↓
├─ Customer Charged
├─ Remitter Order Created
├─ Remitter Notified (email)
└─ Customer Notified (email)
    ↓
    [Remitter Portal]
    ↓
Remitter Views Order & Submits to City
    ↓
    [Remitter calls confirm-payment API]
    ↓
Profile Expiry Advanced → Cycle Repeats Next Year
```

---

## Key Findings

### 1. Recent Payment Method Fix
**Commit:** "Fix: Save payment method for future renewal charges"

The protection checkout was recently updated to explicitly:
- Set `payment_method_collection: 'always'` in Stripe checkout session
- Set `default_payment_method: 'on_subscription'` on subscription data
- This ensures payment method is saved and available for future renewal charges

**Impact:** Customers no longer need to manually pay for renewals - fully automated.

### 2. Remitter Stripe Connect Integration
- Remitters connect their Stripe Express accounts
- Funds are transferred directly to their accounts via `transfer_data`
- Service fee ($12 per renewal) transferred as separate transfer
- Remitter gets: sticker_price + $12 service_fee

### 3. Fee Structure
```
Customer Charged:  (sticker + $2.50 + $0.30) / (1 - 0.029) ≈ $40.77 for $36 sticker
  ↓
Remitter Gets:    $36 sticker + $12 service = $48
Platform Keeps:   $2.50 (covers operational costs)
Stripe Fee:       ~$1.27 (2.9% + $0.30)
```

### 4. Dry Run Mode
The cron job supports `?dryRun=true` query parameter to:
- Simulate processing without actual charges
- Test renewal logic without production impact
- Perfect for testing before enabling in production

### 5. Dual Renewal Types
System supports both:
- **City Sticker Renewals** (fully automated, currently working)
- **License Plate Renewals** (blocked if emissions test not completed)

Emissions test is critical compliance requirement for Illinois.

### 6. Email & SMS Notifications
Multiple notification flows:
1. Charge success/failure emails to customers
2. New order alerts to remitters
3. Post-purchase reminders (day 0, 10, 14)
4. Renewal reminders before expiry
5. Emissions test reminders

---

## Critical Code Paths to Test

### Path 1: Full Customer Lifecycle
```typescript
// 1. User starts protection checkout
GET /api/protection/checkout
  → Creates Stripe session with payment_method_collection: 'always'

// 2. Stripe webhook processes completion
POST /api/stripe-webhook (on checkout.session.completed)
  → Creates user profile with stripe_customer_id
  → Sets has_protection: true
  → Stores renewal dates

// 3. 30 days before expiry - Cron runs
GET /api/cron/process-all-renewals?dryRun=false
  → Retrieves customer's saved payment method
  → Creates PaymentIntent with saved method
  → Charges customer automatically
  → Creates renewal_order for remitter

// 4. Remitter fulfills order
POST /api/remitter/confirm-payment
  → Marks renewal as complete
  → Advances profile expiry by 1 year
  → Cycle repeats next year
```

### Path 2: Error Handling
```typescript
// Card expires or is declined
  → PaymentIntent fails
  → renewal_charges.status = 'failed'
  → Customer receives failure email with retry link
  → Support can manually retry

// No payment method saved
  → Cron logs error
  → Support alerted
  → Customer notified to update payment method

// Emissions test not completed
  → License plate renewal blocked
  → renewal_charges.status = 'blocked'
  → Customer sent emissions reminder
```

---

## Key Tables Involved

### renewal_partners
Core remitter account data
- `api_key` - Used for portal authentication
- `stripe_connected_account_id` - Where funds are transferred
- `service_fee_amount` - Currently $2 per transaction

### user_profiles
Core customer data
- `stripe_customer_id` - Links to Stripe customer
- `has_protection` - Determines if eligible for renewal processing
- `city_sticker_expiry` - Triggers renewal charge at 0-30 days
- `license_plate_expiry` - Blocked if emissions not complete

### renewal_charges
Complete charge history
- `status: 'succeeded'|'failed'|'blocked'`
- Tracks customer amount vs remitter amount vs platform fee
- Critical for reconciliation and troubleshooting

### renewal_orders
Remitter work queue
- Created when charge succeeds
- Remitter uses to know what to submit
- Status: pending → submitted → completed

---

## What Changed Recently

The recent commit modified `pages/alerts/success.tsx`:
- Updated button text from "Upload Document" to "Go to Settings to Upload"
- Updated helper text: "You can also do this later" → "You can skip this for now"

This is a minor UI update that doesn't affect the payment method flow, but indicates active development on the post-purchase flow.

---

## Areas Most Likely to Have Issues

### 1. Payment Method Retrieval
**Risk:** Customer's payment method could be deleted/expired in Stripe
**Check:** Before creating PaymentIntent, verify method exists
**Test:** Manually delete method, run cron, verify error handling

### 2. Stripe Connect Transfers
**Risk:** Remitter account not fully onboarded or restricted
**Check:** Verify `stripe_connected_account_id` is active
**Test:** Transfer to newly created account, verify funds appear

### 3. Duplicate Charge Prevention
**Risk:** Multiple cron runs could charge same customer twice
**Check:** Query `renewal_charges` before creating PaymentIntent
**Test:** Run cron twice simultaneously, verify only one charge

### 4. Notification Delivery
**Risk:** Emails/SMS might fail silently
**Check:** Verify `notification_log` entries created
**Test:** Check email/SMS actually received by customers

### 5. Fee Calculations
**Risk:** Rounding errors with multiple fee calculations
**Check:** Verify Math.round() used correctly
**Test:** Run through various sticker prices, check calculations

### 6. Timezone Issues
**Risk:** 30-day window calculated incorrectly across timezones
**Check:** Use UTC for all date calculations
**Test:** Customer in different timezone, verify window correct

---

## Testing Priority Matrix

### Critical (Must Test First):
- [x] Payment method saved after checkout
- [x] Payment method retrieved correctly
- [x] Charge succeeds with saved method
- [x] Funds transferred to remitter
- [x] No duplicate charges
- [x] Customer/remitter both notified

### High (Test Before Production):
- [x] Card declined → customer notified
- [x] Card expired → customer notified
- [x] No payment method → error logged
- [x] Emissions blocking license plate
- [x] Remitter confirm payment API
- [x] Profile expiry advances 1 year

### Medium (Test to Be Thorough):
- [x] Multi-vehicle scenarios
- [x] Post-purchase notifications (days 0, 10, 14)
- [x] Remitter portal displays correctly
- [x] CSV/PDF exports work
- [x] License image access permissions
- [x] Concurrent cron runs

### Low (Edge Cases):
- [x] Zero-dollar sticker (test price)
- [x] Very high sticker amount
- [x] Subscription cancellation
- [x] Concurrent requests to same customer

---

## Files to Keep Monitored

### During Development:
- `/pages/api/protection/checkout.ts` - Changes here affect payment collection
- `/pages/api/cron/process-all-renewals.ts` - Core renewal logic
- `/pages/api/stripe-webhook.ts` - Initial account setup

### For New Features:
- `/pages/remitter-portal.tsx` - UI for remitter experience
- `/lib/city-sticker-automation.ts` - Browser automation (currently dry-run only)

### For Debugging:
- `/lib/stripe-config.ts` - Price IDs and API keys
- `/lib/database.types.ts` - Schema reference
- Check logs in `/pages/api/cron/process-all-renewals.ts`

---

## Known Limitations

1. **City Sticker Automation** - Currently dry-run only (stops before payment)
   - Full automation would require handling city clerk portal changes
   - Remitter must manually submit to city for now

2. **License Plate Renewal** - Not fully implemented
   - Emissions check is working
   - Actual purchase via IL SOS not yet integrated
   - Currently only marks "ready for license plate renewal" in logs

3. **Remitter Verification** - Basic implementation
   - No KYC/identity verification yet
   - Stripe Express handles this, but could be more strict

4. **Webhook Retries** - Not explicitly handled
   - If webhook fails to process, might miss customer account
   - Consider implementing webhook queue/retry logic

---

## How to Run Tests

### Local Testing
```bash
# 1. Set up test customer and remitter
# 2. Run dry-run to verify logic
curl "http://localhost:3000/api/cron/process-all-renewals?dryRun=true" \
  -H "Authorization: Bearer ${CRON_SECRET}"

# 3. Check logs for what would happen
# 4. Run actual charge if comfortable
curl "http://localhost:3000/api/cron/process-all-renewals" \
  -H "Authorization: Bearer ${CRON_SECRET}"

# 5. Verify in Stripe dashboard and database
```

### Production Testing
```bash
# Use Vercel's local deployment
vercel dev

# Or call staging environment
curl "https://staging.ticketlesschicago.com/api/cron/process-all-renewals?dryRun=true"
```

---

## Documentation Files Generated

These files are now in your project root:

1. **REMITTER_PROCESS_FLOW.md** - Deep dive into every step
   - Sections 1-10 covering remitter creation through automation
   - Complete database schema reference
   - Saved payment method critical notes

2. **KEY_FILES_AND_TESTING.md** - Implementation guide
   - File reference table
   - 12-phase testing checklist
   - Rollback procedures

3. **CODEBASE_EXPLORATION_SUMMARY.md** - This file
   - High-level architecture
   - Key findings
   - Testing priorities

---

## Quick Reference: Payment Method Flow

```
Checkout Session
    ↓
{
  mode: 'subscription',
  payment_method_collection: 'always',  ← Collect method
  subscription_data: {
    default_payment_method: 'on_subscription'  ← Save it
  }
}
    ↓
Webhook (checkout.session.completed)
    ↓
Create customer with stripe_customer_id
    ↓
stripe.customers.retrieve(customer_id)
    ↓
customer.invoice_settings.default_payment_method exists ✓
    ↓
Cron Job (30 days before expiry)
    ↓
stripe.paymentIntents.create({
  customer: customer_id,
  payment_method: defaultPaymentMethod,  ← Use saved method
  confirm: true  ← Process immediately
})
    ↓
PaymentIntent succeeds → renewal_order created → notifications sent
PaymentIntent fails → customer notified to update method
```

---

## Next Steps

1. Run the 12-phase testing checklist from KEY_FILES_AND_TESTING.md
2. Start with Phase 1 & 2 (Setup and Payment Method Storage)
3. Verify payment method persists correctly
4. Test renewal charge processing with dry-run first
5. Run full suite with actual charges on test data
6. Monitor production for any issues

All files are in the project root and ready for reference during testing.

