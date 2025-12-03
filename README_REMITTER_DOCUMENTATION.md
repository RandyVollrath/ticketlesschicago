# Remitter & Sticker Purchase Process Documentation

Complete codebase exploration documents have been generated to understand how the Ticketless Chicago remitter system works.

## Documents Overview

### 1. REMITTER_PROCESS_FLOW.md
**Purpose:** Technical deep dive into the complete remitter lifecycle

**Contents:**
- Remitter creation and onboarding flow
- Stripe Connect setup for payment receipt
- Protection subscription checkout process
- Automated renewal payment processing
- Remitter fulfillment and order confirmation
- Post-purchase notifications
- Complete database schema reference
- Critical payment method handling notes

**Best for:**
- Understanding architecture
- Learning how data flows through the system
- Reviewing database schema
- Understanding payment and fee calculations

**Key sections:**
1. Remitter Creation & Onboarding
2. Protection Subscription Checkout
3. Sticker Purchase Process
4. Remitter Fulfillment & Confirmation
5. Post-Purchase Notifications
6. Database Tables
7. Key Payment Flows to Test
8. Critical Notes for Payment Method Handling

---

### 2. KEY_FILES_AND_TESTING.md
**Purpose:** Implementation reference and testing guide

**Contents:**
- File reference organized by functionality
- 12-phase comprehensive testing checklist
- Sample test data and Stripe card numbers
- Key metrics to monitor
- Rollback procedures

**Best for:**
- Finding which files implement which features
- Running tests systematically
- Debugging issues
- Implementing changes

**Key sections:**
- Core Files by Functionality table
- Phase 1-12 Testing Checklist
- Key Metrics to Monitor
- Sample Test Data
- Rollback Procedures

---

### 3. CODEBASE_EXPLORATION_SUMMARY.md
**Purpose:** High-level overview and quick reference

**Contents:**
- System architecture diagram
- Key findings about recent changes
- Critical code paths
- Areas most likely to have issues
- Testing priority matrix
- Quick reference payment method flow

**Best for:**
- Quick understanding of system
- Identifying areas to focus on
- Understanding recent changes
- Testing priorities

**Key sections:**
- System Architecture Overview
- Key Findings (including recent payment method fix)
- Critical Code Paths
- Key Tables Involved
- Testing Priority Matrix
- Known Limitations

---

## Quick Start Guide

### If you want to understand the system quickly:
1. Read: CODEBASE_EXPLORATION_SUMMARY.md (5 min read)
2. Look at: System Architecture Overview section
3. Check: Key Findings about payment methods
4. Skim: Testing Priority Matrix

### If you're implementing features:
1. Read: REMITTER_PROCESS_FLOW.md relevant section
2. Find files in: KEY_FILES_AND_TESTING.md Core Files table
3. Follow: File references to implementation
4. Run tests from: KEY_FILES_AND_TESTING.md Testing Checklist

### If you're testing/debugging:
1. Read: CODEBASE_EXPLORATION_SUMMARY.md (overall understanding)
2. Use: KEY_FILES_AND_TESTING.md Testing Checklist
3. Reference: REMITTER_PROCESS_FLOW.md for specific flows
4. Check: "Areas Most Likely to Have Issues" section

---

## Key Files Referenced

### Core System Files:
- `/pages/api/remitter/signup.ts` - Remitter account creation
- `/pages/api/protection/checkout.ts` - Payment method collection
- `/pages/api/stripe-webhook.ts` - Account setup after purchase
- `/pages/api/cron/process-all-renewals.ts` - Automatic renewal charges
- `/pages/api/remitter/confirm-payment.ts` - Remitter confirmation
- `/pages/remitter-portal.tsx` - Remitter dashboard

### Supporting Files:
- `/lib/stripe-config.ts` - Stripe configuration
- `/lib/city-sticker-automation.ts` - Browser automation for city submissions
- `/lib/database.types.ts` - Database schema reference

---

## Main Concepts

### Payment Method Flow
1. **Collection:** Customer provides card during Stripe checkout
2. **Storage:** Stripe saves as `customer.invoice_settings.default_payment_method`
3. **Retrieval:** Cron job retrieves it 30 days before renewal
4. **Processing:** PaymentIntent created with saved method
5. **Transfer:** Funds go to remitter's Stripe Connect account

### Fee Breakdown (Example: $36 Sticker)
```
Customer Charged: $40.77 (includes Stripe fees)
  ├─ Remitter receives: $48 ($36 sticker + $12 service fee)
  ├─ Platform keeps: $2.50 (operations)
  └─ Stripe takes: ~$1.27 (2.9% + $0.30)
```

### Renewal Window
- Charged 0-30 days before expiry
- Exactly once per expiry date
- Different charges for each vehicle
- Emissions test required for license plates

---

## Testing Checklist at a Glance

### Must Test First (Critical):
1. Payment method saved after checkout
2. Payment method retrieved correctly  
3. Charge succeeds with saved method
4. Funds transferred to remitter
5. No duplicate charges
6. Both customer and remitter notified

### Should Test Before Production (High Priority):
1. Card declined → customer notified
2. Card expired → customer notified
3. No payment method → error logged
4. Emissions blocking license plate
5. Remitter confirm payment works
6. Profile expiry advances 1 year

### Additional Testing (Medium Priority):
1. Multi-vehicle scenarios
2. Post-purchase notifications
3. Remitter portal functionality
4. CSV/PDF exports
5. License image access
6. Concurrent cron runs

See KEY_FILES_AND_TESTING.md for full 12-phase checklist.

---

## Recent Changes

The recent commit "Fix: Save payment method for future renewal charges" updated:
- `/pages/api/protection/checkout.ts` - Now explicitly sets `payment_method_collection: 'always'`
- Ensures payment methods are saved for automatic renewal charges
- Makes the entire renewal process fully automatic

Minor UI changes to `/pages/alerts/success.tsx`:
- Updated button/text labels in post-purchase flow
- Doesn't affect payment method functionality

---

## Architecture Summary

```
Customers
  ↓ [Sign up for Protection]
  ↓ [Checkout with saved payment method]
  ↓ [Stripe Webhook processes signup]
Stripe Customer Created
  ↓ [30 days before renewal]
Cron Job Runs
  ↓ [Retrieves saved payment method]
  ↓ [Creates & confirms PaymentIntent]
Customer Charged
  ↓ [Funds transferred to remitter]
Remitter Receives Order
  ↓ [Submits to city]
  ↓ [Calls confirm-payment API]
Profile Expiry Advanced 1 Year
  ↓ [Cycle repeats next year]
```

---

## Database Tables at a Glance

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| renewal_partners | Remitter accounts | api_key, stripe_connected_account_id |
| user_profiles | Customer accounts | stripe_customer_id, has_protection, city_sticker_expiry |
| renewal_charges | Charge history | status, amount, remitter_received_amount |
| renewal_orders | Remitter work queue | order_number, payment_status, status |
| renewal_partner_stats | Remitter metrics | orders_today, revenue_today |

See REMITTER_PROCESS_FLOW.md Section 6 for complete schemas.

---

## Common Questions

**Q: Where does the payment method come from?**
A: Customer provides it during Stripe checkout. Stripe saves it automatically with `payment_method_collection: 'always'`.

**Q: How is the customer charged?**
A: Cron job runs daily, creates PaymentIntent with saved method 30 days before expiry, Stripe processes immediately without customer interaction.

**Q: Where do the funds go?**
A: Directly to remitter's Stripe Connect account via `transfer_data`. Service fee transferred separately.

**Q: What if the card is declined?**
A: PaymentIntent fails, customer receives email with failure reason and retry instructions.

**Q: How does the remitter know what to do?**
A: Email alert when order created, order visible in portal, all customer details provided.

**Q: What happens after remitter submits to city?**
A: Remitter calls confirm-payment API, marks renewal complete, profile expiry advanced by 1 year for next year's cycle.

---

## Dry Run / Testing Mode

The cron job supports testing without actual charges:
```bash
curl "http://localhost:3000/api/cron/process-all-renewals?dryRun=true"
```

- Logs what would be charged
- Does not actually charge customers
- Perfect for testing before going live

---

## Files Breakdown by Functionality

See KEY_FILES_AND_TESTING.md "Core Files by Functionality" section for complete table organized by:
1. Remitter Management (7 files)
2. Customer Protection Checkout (3 files)
3. Renewal & Payment Processing (3 files)
4. Database & Types (2 files)
5. Configuration (2 files)

---

## Support & Debugging

### Check these first:
1. CODEBASE_EXPLORATION_SUMMARY.md "Areas Most Likely to Have Issues"
2. REMITTER_PROCESS_FLOW.md "Critical Notes for Payment Method Handling"
3. KEY_FILES_AND_TESTING.md "Key Metrics to Monitor"

### Common Debug Steps:
1. Check `renewal_charges` table for charge status
2. Check `renewal_orders` table for order creation
3. Check Stripe dashboard for PaymentIntent
4. Check email logs for notification delivery
5. Check `notification_log` for duplicate prevention

---

## Version Information

- **Created:** December 2, 2025
- **Based on:** Latest codebase exploration
- **Stripe API Version:** 2024-12-18.acacia
- **Node.js:** v18.20.0

---

## Related Documentation

Also see in project root:
- WEBHOOK_TESTING_GUIDE.md - Stripe webhook testing
- YOUR_QUESTIONS_ANSWERED.md - Frequent questions
- WINTER_BAN_SETUP.md - Street cleaning automation

---

## Next Steps

1. Choose your learning path above
2. Start with CODEBASE_EXPLORATION_SUMMARY.md
3. Refer to other documents as needed
4. Follow the appropriate testing checklist
5. Monitor KEY METRICS while running tests

All files are in the project root and cross-referenced for easy navigation.

