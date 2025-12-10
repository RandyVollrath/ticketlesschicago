# Key Files Reference & Testing Checklist

## Core Files by Functionality

### 1. REMITTER MANAGEMENT
| Feature | File | Key Functions |
|---------|------|---------------|
| Signup | `/pages/api/remitter/signup.ts` | Create account, generate API key, init stats |
| Portal UI | `/pages/remitter-portal.tsx` | Dashboard, orders, license viewer, exports |
| Stripe Connect | `/pages/api/stripe-connect/authorize.ts` | Express account, onboarding flow |
| Dashboard API | `/pages/api/renewal-intake/partner-dashboard.ts` | Stats, orders, pending review |
| Confirm Payment | `/pages/api/remitter/confirm-payment.ts` | Mark city submission as complete |
| Search Users | `/pages/api/remitter/search-users.ts` | Find users for license access |
| Get License | `/pages/api/remitter/get-license.ts` | Retrieve license images |

### 2. CUSTOMER PROTECTION CHECKOUT
| Feature | File | Key Functions |
|---------|------|---------------|
| Checkout | `/pages/api/protection/checkout.ts` | Create Stripe session, collect payment method |
| Webhook | `/pages/api/stripe-webhook.ts` | Process checkout completion, create profile |
| Success Page | `/pages/alerts/success.tsx` | Post-purchase UI, license upload prompt |

### 3. RENEWAL & PAYMENT PROCESSING
| Feature | File | Key Functions |
|---------|------|---------------|
| Main Cron | `/pages/api/cron/process-all-renewals.ts` | Charge customers, create orders, transfer to remitters |
| City Sticker Auto | `/lib/city-sticker-automation.ts` | Browser automation for EzBuy portal |
| Post-Purchase Notif | `/pages/api/cron/notify-sticker-purchased.ts` | Day 0, 10, 14 notifications |

### 4. DATABASE & TYPES
| Feature | File | Key Data |
|---------|------|----------|
| Type Definitions | `/lib/database.types.ts` | All table schemas |
| Supabase Client | `/lib/supabase.ts` | DB connection and auth |

### 5. CONFIGURATION
| Feature | File | Key Settings |
|---------|------|--------------|
| Stripe Config | `/lib/stripe-config.ts` | API keys, price IDs, modes |
| Audit Logging | `/lib/audit-logger.ts` | Event tracking |

---

## Complete Testing Checklist for Saved Payment Methods

### Phase 1: Initial Setup Tests

- [ ] **Remitter Onboarding**
  - [ ] Create new remitter account via `/remitter-signup`
  - [ ] Verify API key generated and returned
  - [ ] Verify stored in `renewal_partners` table
  - [ ] Connect Stripe Express account
  - [ ] Verify `stripe_connected_account_id` saved

- [ ] **Protection Checkout**
  - [ ] User starts protection checkout
  - [ ] Verify Stripe session created with `payment_method_collection: 'always'`
  - [ ] Verify `default_payment_method: 'on_subscription'` in session
  - [ ] Complete checkout with test card
  - [ ] Verify webhook fires and customer created

- [ ] **Customer Profile Creation**
  - [ ] Verify `user_profiles.has_protection: true`
  - [ ] Verify `user_profiles.stripe_customer_id` populated
  - [ ] Verify renewal dates stored (city sticker, license plate)
  - [ ] Verify subscription active in Stripe

### Phase 2: Payment Method Storage Tests

- [ ] **Verify Payment Method Saved**
  - [ ] Query Stripe customer: `stripe.customers.retrieve(customer_id)`
  - [ ] Confirm `invoice_settings.default_payment_method` exists
  - [ ] Verify it's the card from checkout
  - [ ] List payment methods: `stripe.paymentMethods.list({customer: customer_id})`
  - [ ] Verify payment method is "attached" to customer

- [ ] **Payment Method Persistence**
  - [ ] Wait 24+ hours (or manually test)
  - [ ] Query customer again
  - [ ] Verify payment method still exists
  - [ ] Verify it's still set as default

### Phase 3: Renewal Charge Tests

- [ ] **Trigger Renewal Processing**
  - [ ] Manually call cron with: `GET /api/cron/process-all-renewals?dryRun=true`
  - [ ] Verify logs show customer found
  - [ ] Verify expiry within 30-day window
  - [ ] Verify payment method retrieved successfully
  - [ ] Verify calculation correct: total = (sticker + 2.50 + 0.30) / (1 - 0.029)

- [ ] **Payment Intent Creation (Dry Run)**
  - [ ] Verify logs show PaymentIntent would be created
  - [ ] Verify logs show saved payment method used (not `payment_method_collection`)
  - [ ] Verify logs show `confirm: true`
  - [ ] Verify logs show transfer_data with remitter account
  - [ ] Verify logs show service fee transfer

- [ ] **Actual Payment Processing**
  - [ ] Run cron WITHOUT dryRun: `GET /api/cron/process-all-renewals`
  - [ ] Verify PaymentIntent created in Stripe dashboard
  - [ ] Verify charge succeeded without customer interaction
  - [ ] Verify funds transferred to remitter account
  - [ ] Verify `renewal_charges` record created with status: 'succeeded'
  - [ ] Verify `renewal_orders` record created
  - [ ] Verify customer notified via email

- [ ] **Fee Breakdown Verification**
  - [ ] Check `renewal_charges.amount` (total customer charged)
  - [ ] Check `renewal_charges.remitter_received_amount` (sticker + $12)
  - [ ] Check `renewal_charges.platform_fee_amount` ($2.50)
  - [ ] Verify math: remitter + platform ≈ customer charged - Stripe fee

### Phase 4: Error Handling Tests

- [ ] **Expired Card Scenario**
  - [ ] Add card expiring within 30 days to test customer
  - [ ] Wait for renewal window
  - [ ] Run cron job
  - [ ] Verify PaymentIntent fails
  - [ ] Verify `renewal_charges.status: 'failed'`
  - [ ] Verify customer receives failure notification email
  - [ ] Verify remitter does NOT receive order

- [ ] **Declined Card Scenario**
  - [ ] Set up customer with card that will decline (4000000000000002)
  - [ ] Run cron job
  - [ ] Verify PaymentIntent fails with decline message
  - [ ] Verify failure logged in `renewal_charges`
  - [ ] Verify customer email sent with retry instructions

- [ ] **Missing Payment Method**
  - [ ] Manually delete customer's default payment method in Stripe
  - [ ] Run cron job
  - [ ] Verify cron logs error
  - [ ] Verify no PaymentIntent created
  - [ ] Verify customer alerted to update method

- [ ] **Insufficient Funds**
  - [ ] Use test card with insufficient funds (4000002500003155)
  - [ ] Run cron job
  - [ ] Verify charge fails
  - [ ] Verify customer notified

- [ ] **Duplicate Charge Prevention**
  - [ ] Manually create charge
  - [ ] Run cron for same customer/date
  - [ ] Verify existing charge check prevents duplicate
  - [ ] Verify logs show "Already processed"

### Phase 5: Remitter Fulfillment Tests

- [ ] **Remitter Portal Access**
  - [ ] Login with API key
  - [ ] Verify orders appear on dashboard
  - [ ] Verify order shows customer details
  - [ ] Verify order shows payment status: 'paid'
  - [ ] Verify sticker price and service fee visible

- [ ] **License Access**
  - [ ] Search for customer in portal
  - [ ] Click "View License"
  - [ ] Confirm warning modal appears
  - [ ] Confirm access
  - [ ] Verify license images load
  - [ ] Verify signed URLs valid

- [ ] **Confirm Payment API**
  - [ ] Get order number and customer ID
  - [ ] Call `/api/remitter/confirm-payment` with:
    ```json
    {
      "user_id": "uuid",
      "renewal_type": "city_sticker",
      "due_date": "2026-12-15",
      "city_confirmation_number": "CHI-2026-12345"
    }
    ```
  - [ ] Verify API authentication with API key
  - [ ] Verify renewal marked as paid
  - [ ] Check `renewal_orders.status` changed to 'submitted'
  - [ ] Verify user profile expiry advanced by 1 year
  - [ ] Verify audit event logged

### Phase 6: Post-Purchase Notifications

- [ ] **Day 0-1: Purchase Notification**
  - [ ] Check `notification_log` table
  - [ ] Verify email received by customer
  - [ ] Verify SMS sent (if phone provided)
  - [ ] Verify expected delivery date in message

- [ ] **Day 10: Delivery Reminder**
  - [ ] Update `sticker_purchased_at` to 9 days ago
  - [ ] Run cron: `POST /api/cron/notify-sticker-purchased`
  - [ ] Verify email with "Check mailbox" sent
  - [ ] Verify not sent to already-notified users

- [ ] **Day 14: Apply Reminder**
  - [ ] Update `sticker_purchased_at` to 13 days ago
  - [ ] Run cron
  - [ ] Verify "Did you apply?" email sent
  - [ ] Verify action buttons present

- [ ] **Prevent Duplicate Notifications**
  - [ ] Run notification cron twice
  - [ ] Verify second run sends no duplicates
  - [ ] Verify `notification_log` entries prevent re-sends

### Phase 7: Subscription Lifecycle

- [ ] **Monthly Subscription**
  - [ ] Customer on monthly plan
  - [ ] Verify charged $12/month on anniversary
  - [ ] Verify renewal date triggers at correct time
  - [ ] Verify payment method used for both subscription and renewal

- [ ] **Annual Subscription**
  - [ ] Customer on annual plan
  - [ ] Verify charged $99/year
  - [ ] Verify renewal window (0-30 days before expiry)
  - [ ] Verify payment method persists across year

- [ ] **Subscription Cancellation**
  - [ ] Cancel subscription in Stripe
  - [ ] Verify renewal cron skips this customer
  - [ ] Verify `has_protection` remains true (historical)
  - [ ] Verify status doesn't block profile queries

### Phase 8: Multi-Vehicle Scenario

- [ ] **Multiple Stickers**
  - [ ] Create customer with 2 vehicles (different expiry dates)
  - [ ] Verify cron processes each independently
  - [ ] Verify both charged correctly
  - [ ] Verify both orders created for remitter
  - [ ] Verify correct sticker types (P, MB, LP, etc.)

- [ ] **License Plate + City Sticker**
  - [ ] Customer with both renewals
  - [ ] Run cron with city sticker in window, license plate outside
  - [ ] Verify only city sticker charged
  - [ ] Next run: move license plate into window
  - [ ] Verify it's charged separately

### Phase 9: Emissions Test Integration

- [ ] **License Plate Blocked**
  - [ ] Set `emissions_completed: false` for customer
  - [ ] Set `emissions_date` to future date
  - [ ] Run cron with license plate in renewal window
  - [ ] Verify charge blocked with reason: "Emissions test not completed"
  - [ ] Verify customer notified to complete emissions

- [ ] **Emissions Completed**
  - [ ] Set `emissions_completed: true`
  - [ ] Run cron
  - [ ] Verify license plate renewal proceeds
  - [ ] Verify emissions check passed in logs

### Phase 10: Audit & Logging

- [ ] **Audit Trail**
  - [ ] Verify every charge logged in `audit_log`
  - [ ] Verify user ID captured
  - [ ] Verify action type: 'charge_processed'
  - [ ] Verify IP address and user agent stored

- [ ] **Cron Job Monitoring**
  - [ ] Check logs for completion
  - [ ] Verify summary stats returned:
    - [ ] `cityStickerProcessed`
    - [ ] `cityStickerSucceeded`
    - [ ] `cityStickerFailed`
  - [ ] Verify any errors listed in response

### Phase 11: Dashboard & Reporting

- [ ] **Remitter Stats**
  - [ ] View dashboard after charge
  - [ ] Verify `orders_today` incremented
  - [ ] Verify `revenue_today` updated
  - [ ] Verify totals accumulating correctly

- [ ] **CSV Export**
  - [ ] Export reconciliation CSV
  - [ ] Verify all columns present:
    - [ ] Order number
    - [ ] Customer details
    - [ ] Vehicle info
    - [ ] Amounts (sticker, fee, total)
    - [ ] Payment status
  - [ ] Verify data accuracy

- [ ] **PDF Export**
  - [ ] Export renewal batch PDF
  - [ ] Verify all orders included
  - [ ] Verify formatting and readability
  - [ ] Verify ready for city submission

### Phase 12: Edge Cases

- [ ] **Zero-Amount Charge**
  - [ ] Set sticker price to $0 (test price)
  - [ ] Verify charge still calculates correctly
  - [ ] Verify remitter still receives $12 service fee

- [ ] **Very High Amount**
  - [ ] Set sticker price to $999.99
  - [ ] Verify charge calculates correctly
  - [ ] Verify no overflow/precision issues
  - [ ] Verify Stripe accepts amount

- [ ] **Timezone Issues**
  - [ ] Test with customer in different timezone
  - [ ] Verify expiry date calculated correctly
  - [ ] Verify 30-day window respects timezone

- [ ] **Concurrent Requests**
  - [ ] Simulate multiple cron runs simultaneously
  - [ ] Verify no duplicate charges
  - [ ] Verify database locks handle race conditions

---

## Key Metrics to Monitor

### Success Indicators:
- Charge success rate > 95% (after excluding invalid cards)
- No duplicate charges across multiple cron runs
- Payment method saved and reused in <5ms
- Notification delivery >99% (email + SMS)
- Remitter receives order within 2 minutes of charge

### Warning Signs:
- Charges failing without customer notification
- Orders created but charges failed
- Duplicate charges for same date
- Payment methods disappearing
- Notifications not sent
- Remitter not receiving transferred funds

---

## Sample Test Data

### Test Customers:
```
Email: test1@example.com
Card: 4242 4242 4242 4242 (always succeeds)
Expiry: 12/25 (future)
CVC: 123

Email: test2@example.com
Card: 4000 0000 0000 0002 (always declines)
Expiry: 12/25
CVC: 123
```

### Test Remitter:
```
Name: Test Remitter
Email: remitter@example.com
Phone: (555) 555-1234
Business Type: remitter
```

### Test Renewals:
```
City Sticker Expiry: [today + 15 days] (within 30-day window)
License Plate Expiry: [today + 45 days] (outside window)
Vehicle Type: P (Passenger)
```

---

## Rollback Procedures

If issues found:

1. **Stop Cron Execution**
   - Disable scheduled cron in platform (Vercel, etc.)
   - Or add `if (process.env.DISABLE_CRON === 'true') return`

2. **Refund Processing**
   - Use Stripe dashboard to refund `PaymentIntent`
   - Funds return to customer card automatically
   - Update `renewal_charges.status` to 'refunded'
   - Send customer explanation email

3. **Data Cleanup**
   - Delete test `renewal_orders` entries
   - Reset expiry dates if modified
   - Re-run with corrected code

4. **Communication**
   - Notify affected customers
   - Provide support contact
   - Document issue and fix

