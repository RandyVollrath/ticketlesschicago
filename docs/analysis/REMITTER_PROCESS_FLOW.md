# Ticketless Chicago - Remitter & Sticker Purchase Process Flow

## Overview
This document describes the complete remitter process flow, from creation through payment collection and sticker purchase fulfillment. The system integrates remitters with Stripe Connect to collect payments for city sticker renewals.

---

## 1. REMITTER CREATION & ONBOARDING

### 1.1 Remitter Signup
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/remitter/signup.ts`

The signup process creates a new remitter account with the following flow:

1. **Input Data:**
   - Business name, email, phone
   - Business type (remitter, dealership, other)
   - Business address
   - City remitter license number (optional)

2. **Account Creation:**
   - Check if email already exists in `renewal_partners` table
   - Generate API key (format: `ap_live_xxxxxxxxxxxxxxxxxxxxx`)
   - Insert into `renewal_partners` table with:
     - `name`, `email`, `phone`
     - `business_type`, `business_address`, `license_number`
     - `api_key` - Used for authentication
     - `status: 'active'`
     - `onboarding_completed: false`
     - `auto_forward_payments: true`
     - `commission_percentage: 0` (Remitter keeps 100% of sticker price)
     - `service_fee_amount: $2` (Platform fee per transaction)

3. **Statistics Initialization:**
   - Create `renewal_partner_stats` entry:
     - `orders_today: 0`
     - `revenue_today: 0`
     - `total_orders: 0`
     - `total_revenue: 0`

4. **Response:**
   - API key (must be saved by remitter)
   - Partner ID
   - Next step: Stripe Connect authorization
   - Magic link to portal

### 1.2 Stripe Connect Setup
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/stripe-connect/authorize.ts`

1. **Account Creation:**
   - Create Stripe Express account if doesn't exist
   - Type: `express` (requires minimal information)
   - Country: `US`
   - Capabilities: `card_payments`, `transfers`
   - Business type: `individual` or `company`

2. **Onboarding Flow:**
   - Generate Stripe Account Link
   - Redirect remitter to Stripe for:
     - Bank account setup
     - Identity verification
     - Business details confirmation
   - Refresh URL: Allows restart if incomplete
   - Return URL: Redirect back to remitter portal

3. **Storage:**
   - Save `stripe_connected_account_id` to `renewal_partners` table

---

## 2. PROTECTION SUBSCRIPTION CHECKOUT

**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/protection/checkout.ts`

### 2.1 Initial Purchase Flow

1. **Checkout Session Creation:**
   - Customer selects monthly ($12/mo) or annual ($99/year) plan
   - Creates Stripe Checkout session with:
     ```
     mode: 'subscription'
     payment_method_collection: 'always'  // CRITICAL: Collect payment method
     default_payment_method: 'on_subscription'  // Save for future charges
     ```

2. **Key Configuration:**
   - Renewal fees are NOT charged upfront
   - Only subscription price ($12/mo or $99/year) is charged
   - Renewal charges happen automatically 30 days before due dates
   - Payment method is saved for future renewal charges

3. **Session Metadata:**
   ```json
   {
     userId: UUID,
     email: email,
     phone: phone,
     plan: 'monthly' | 'annual',
     product: 'ticket_protection',
     vehicleType: 'P' | 'MB' | 'LP' | 'ST' | 'LT',
     citySticker: expiry_date,
     licensePlate: expiry_date,
     streetAddress: address,
     hasPermitZone: boolean,
     permitRequested: boolean,
     permitZones: JSON string
   }
   ```

### 2.2 Stripe Webhook Processing
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/stripe-webhook.ts`

On `checkout.session.completed` event:

1. **New Customer Path:**
   - Create auth user if doesn't exist
   - Create or update `user_profiles` with:
     - `has_protection: true`
     - `stripe_customer_id: session.customer`
     - Renewal dates from metadata
     - Address, phone, vehicle info

2. **Payment Method Storage:**
   - Stripe automatically saves default payment method to customer
   - Accessible via: `stripe.customers.retrieve(customer_id)`
   - Retrieved as: `customer.invoice_settings.default_payment_method`

3. **Post-Signup:**
   - Auto-geocode address for ward/section (street cleaning alerts)
   - Generate magic link for profile completion
   - Set `renewal_status: 'active'`

---

## 3. STICKER PURCHASE PROCESS

### 3.1 Payment Collection via Cron Job
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/cron/process-all-renewals.ts`

This critical cron job runs daily to charge customers and create remitter orders.

#### Trigger Conditions:
- Customer has `has_protection: true`
- Customer has `stripe_customer_id` (paid subscription)
- Renewal date is within 0-30 days of expiration
- Not already processed for this renewal date
- No previous failed charge for this date

#### Payment Flow:

1. **Fetch Sticker Price:**
   ```
   const stickerPrice = await getStickerPrice(vehicleType)
   // Fetches from Stripe Price object
   ```

2. **Calculate Total with Fees:**
   ```
   Total = (stickerPrice + SERVICE_FEE + STRIPE_FIXED_FEE) / (1 - STRIPE_PERCENTAGE_FEE)
   
   SERVICE_FEE = $2.50 (platform operational fee)
   STRIPE_PERCENTAGE_FEE = 2.9%
   STRIPE_FIXED_FEE = $0.30
   ```

3. **Create Payment Intent:**
   ```typescript
   const paymentIntent = await stripe.paymentIntents.create({
     amount: Math.round(totalAmount * 100),
     currency: 'usd',
     customer: customer.stripe_customer_id,
     payment_method: defaultPaymentMethod,  // SAVED payment method
     confirm: true,  // Immediately confirm/process
     description: `City Sticker Renewal - ${license_plate}`,
     transfer_data: {
       destination: remitter.stripe_connected_account_id,
       amount: Math.round(stickerPrice * 100)  // Remitter gets sticker price only
     }
   })
   ```

4. **Service Fee Transfer:**
   ```
   // $12/month subscription * prorated = $12 service fee paid from platform balance
   // Transferred separately to remitter for processing/fulfillment
   stripe.transfers.create({
     amount: 1200,  // $12.00
     destination: remitter.stripe_connected_account_id,
     description: 'Sticker Processing Service Fee'
   })
   ```

5. **Financial Breakdown (Example: $36 Sticker):**
   - Customer charged: ~$40.77 (includes Stripe fees)
   - Remitter receives: ~$50.00 ($36 sticker + $12 service fee + $2 platform contribution)
   - Platform keeps: $2.50
   - Stripe processing fee: ~$1.27

#### Database Records Created:

1. **renewal_charges Table:**
   ```json
   {
     user_id: UUID,
     charge_type: 'sticker_renewal',
     amount: total_charged,
     stripe_payment_intent_id: payment_intent.id,
     stripe_charge_id: payment_intent.latest_charge,
     status: 'succeeded',
     remitter_partner_id: remitter.id,
     remitter_received_amount: stickerPrice + 12.00,
     platform_fee_amount: 2.50,
     renewal_type: 'city_sticker',
     renewal_due_date: expiry_date,
     succeeded_at: timestamp,
     customer_notified: true
   }
   ```

2. **renewal_orders Table:**
   ```json
   {
     order_number: 'AUTO-' + timestamp,
     partner_id: remitter.id,
     customer_name: full_name,
     customer_email: email,
     customer_phone: phone,
     license_plate: plate,
     street_address: address,
     city: city,
     state: state,
     zip_code: zip,
     sticker_type: vehicle_type,
     sticker_price: price,
     service_fee: 12.00,
     total_amount: price + 12.00,
     payment_status: 'paid',
     status: 'pending',
     stripe_payment_intent_id: payment_intent.id
   }
   ```

### 3.2 Email Notifications

**To Customer:**
- Subject: "Your city sticker renewal has been processed - $XX.XX"
- Contents: Amount charged, license plate, next steps
- States: Will submit to city within 1-2 business days

**To Remitter:**
- Subject: "New City Sticker Order! - [PLATE]"
- Contents: Customer details, sticker price, service fee, total payment
- Action items: Submit renewal to city, record confirmation number, confirm via API

### 3.3 Dry Run Mode
- Enabled via query parameter: `?dryRun=true`
- Logs what would be charged but doesn't actually process
- Useful for testing renewal logic without affecting production

---

## 4. REMITTER FULFILLMENT & CONFIRMATION

### 4.1 Remitter Portal
**File:** `/home/randy-vollrath/ticketless-chicago/pages/remitter-portal.tsx`

Remitter dashboard for managing orders:

1. **Authentication:**
   - Login with API key (stored in localStorage)
   - API key: `X-API-Key` header in all requests

2. **Dashboard View:**
   - Orders today/week/month/all-time
   - Revenue metrics
   - Quick exports (CSV, PDF)
   - Document uploads

3. **Orders Management:**
   - View pending orders with full customer details
   - Filter by status: all, submitted, paid, completed
   - View customer license images (with permission workflow)
   - Track payment status and dates

4. **License Viewer:**
   - Search users by email, plate, or name
   - Request confirmation before accessing license
   - 48-hour deletion countdown warning (unless multi-year consent)
   - Signed URLs for secure temporary access

### 4.2 City Sticker Automation
**File:** `/home/randy-vollrath/ticketless-chicago/lib/city-sticker-automation.ts`

Browser automation for Chicago City Clerk EzBuy portal:

1. **Dry Run Mode (Default):**
   - Navigates to EzBuy portal
   - Fills in vehicle info (plate, VIN last 6, owner name)
   - Searches for vehicle record
   - Fills contact info (email)
   - Proceeds to cart/options
   - Extracts pricing information
   - **Stops before payment** for manual review

2. **Steps:**
   ```
   1. Navigate to ezbuy.chicityclerk.com/vehicle-stickers
   2. Advance past instructions
   3. Search for vehicle (plate + VIN + last name)
   4. Fill contact information
   5. Proceed to cart
   6. Extract total amount
   7. [In production: Complete payment]
   ```

3. **Error Handling:**
   - Vehicle not found in system
   - Validation errors
   - Search button disabled
   - Screenshots captured at each step

### 4.3 Confirm Payment Endpoint
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/remitter/confirm-payment.ts`

Called by remitter after successfully submitting renewal to city:

1. **Request:**
   ```json
   {
     "user_id": "uuid",
     "renewal_type": "city_sticker",
     "due_date": "2026-12-15",
     "city_confirmation_number": "CHI-2026-12345",
     "notes": "optional notes"
   }
   ```

2. **Authentication:**
   - Requires API key in Authorization header
   - `Bearer ${REMITTER_API_KEY}`

3. **Validation:**
   - Find renewal record by user_id, type, due_date
   - Verify user already paid us (payment_status = 'paid')
   - Check not already confirmed

4. **Updates:**
   - Set `renewal_payment.city_payment_status = 'paid'`
   - Save city confirmation number
   - **CRITICAL: Advance user profile expiry by 1 year**
     ```
     city_sticker_expiry: current_date → next_year_date
     ```
     This ensures the renewal cycle repeats automatically next year

5. **Response:**
   - Confirms renewal marked as paid
   - Shows profile update result
   - Logs audit event

---

## 5. POST-PURCHASE NOTIFICATIONS

**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/cron/notify-sticker-purchased.ts`

This cron job sends post-purchase emails/SMS at specific intervals:

1. **Day 0-1: Purchase Notification**
   - Email + SMS
   - Expected delivery date
   - Next steps (sticker will be mailed)

2. **Day 9-11: Delivery Reminder**
   - Reminder to check mailbox
   - Importance of applying immediately
   - Contact if not received after 14 days

3. **Day 13-15: Apply Reminder**
   - Check-in: Did you apply the sticker?
   - Warning: Still unprotected if not displayed
   - Action buttons: Yes/No for sticker status

---

## 6. DATABASE TABLES

### renewal_partners
```
id: UUID
name: TEXT
email: TEXT
phone: TEXT
business_type: TEXT ('remitter', 'dealership', 'other')
business_address: TEXT
license_number: TEXT (optional)
api_key: TEXT (unique)
status: TEXT ('active', 'inactive')
onboarding_completed: BOOLEAN
auto_forward_payments: BOOLEAN
commission_percentage: NUMERIC
service_fee_amount: NUMERIC
stripe_connected_account_id: TEXT (Stripe Express account ID)
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

### renewal_partner_stats
```
id: UUID
partner_id: UUID (FK)
orders_today: INTEGER
revenue_today: NUMERIC
total_orders: INTEGER
total_revenue: NUMERIC
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

### renewal_orders
```
id: UUID
order_number: TEXT (unique, 'AUTO-' + timestamp)
partner_id: UUID (FK)
customer_name: TEXT
customer_email: TEXT
customer_phone: TEXT
license_plate: TEXT
license_state: TEXT
street_address: TEXT
city: TEXT
state: TEXT
zip_code: TEXT
sticker_type: TEXT ('P', 'MB', 'LP', 'ST', 'LT')
sticker_price: NUMERIC
service_fee: NUMERIC
total_amount: NUMERIC
payment_status: TEXT ('paid', 'pending', 'failed')
status: TEXT ('pending', 'submitted', 'completed')
stripe_payment_intent_id: TEXT
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

### renewal_charges
```
id: UUID
user_id: UUID (FK)
charge_type: TEXT ('sticker_renewal', 'license_plate_renewal')
amount: NUMERIC (total charged to customer)
stripe_payment_intent_id: TEXT
stripe_charge_id: TEXT
status: TEXT ('succeeded', 'failed', 'blocked')
remitter_partner_id: UUID (FK)
remitter_received_amount: NUMERIC
platform_fee_amount: NUMERIC
renewal_type: TEXT
renewal_due_date: DATE
succeeded_at: TIMESTAMP
failed_at: TIMESTAMP
failure_reason: TEXT
failure_code: TEXT
customer_notified: BOOLEAN
notification_sent_at: TIMESTAMP
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

### user_profiles
```
user_id: UUID (FK)
stripe_customer_id: TEXT (Stripe customer ID for saving payment method)
has_protection: BOOLEAN
city_sticker_expiry: DATE
license_plate_expiry: DATE
vehicle_type: TEXT
renewal_status: TEXT ('active', 'pending', 'shipped', 'completed')
renewal_notification_days: INTEGER (default: 30)
sticker_purchased_at: TIMESTAMP
email: TEXT
phone_number: TEXT
first_name: TEXT
last_name: TEXT
street_address: TEXT
mailing_address: TEXT
zip_code: TEXT
... (other fields)
```

---

## 7. KEY PAYMENT FLOWS TO TEST

### For Saved Payment Methods on Sticker Purchases:

1. **Initial Protection Signup:**
   - Verify payment method is collected during checkout
   - Verify `stripe.checkout.sessions.create()` has `payment_method_collection: 'always'`
   - Verify `default_payment_method: 'on_subscription'` is set
   - After completion, verify customer.invoice_settings.default_payment_method exists

2. **Renewal Charge Processing:**
   - When cron runs 30 days before sticker expiry:
     - Verify `stripe.customers.retrieve(customer_id)` returns payment method
     - Verify `stripe.paymentIntents.create()` uses saved payment method (not 'payment_method_collection')
     - Verify payment goes through without needing customer interaction
     - Test with expired/invalid cards (should fail gracefully)

3. **Fee Calculations:**
   - Test sticker prices for each vehicle type (P, MB, LP, ST, LT)
   - Verify customer charge = (sticker + $2.50 + $0.30) / (1 - 0.029)
   - Verify remitter receives = sticker price + $12.00
   - Verify platform keeps = $2.50 (plus stripe fee difference)

4. **Error Handling:**
   - Card declined: Customer should get failure email with retry option
   - Emissions incomplete: License plate renewal should be blocked
   - No default payment method: Should log error and alert customer
   - Duplicate charge: Should check existing charges before processing

5. **Remitter Confirmation:**
   - Test API endpoint authentication with API key
   - Verify profile expiry advances by 1 year after confirmation
   - Verify renewal order moves from 'pending' to 'submitted'
   - Test city confirmation number is saved for record-keeping

6. **Post-Purchase Notifications:**
   - Verify notifications sent at correct days (0-1, 9-11, 13-15)
   - Verify `notification_log` table prevents duplicate sends
   - Verify SMS and email channels work
   - Test with users lacking phone numbers (email-only)

---

## 8. CRITICAL NOTES FOR PAYMENT METHOD HANDLING

### What Changed
The recent commit "Fix: Save payment method for future renewal charges" updated the protection checkout to explicitly collect and save payment methods for future renewal processing.

### Key Implementation Details:
1. Payment method is collected during initial Stripe Checkout (not optional)
2. Method is set as default on the customer object via `default_payment_method: 'on_subscription'`
3. Subscription metadata stores `default_payment_method: 'on_subscription'` which tells Stripe to automatically set it
4. During renewal, the cron job retrieves the customer and uses the saved method via `paymentIntents.create()`
5. No customer interaction needed during renewal charge
6. If payment fails, customer is notified and can update method in settings

### Failure Scenarios:
- Card expired since signup: PaymentIntent will fail, customer notified
- Insufficient funds: PaymentIntent will fail, customer notified
- Customer has no default payment method: Cron logs error, alerts support
- Emissions test not completed: License plate renewal blocked (see emissions_completed flag)

---

## 9. REMITTER RECONCILIATION

Remitters can export:
1. **Reconciliation CSV** - Today's orders with payment details
2. **Renewal Batch PDF** - All pending orders for submission to city

Both exports use API key authentication and include:
- Order numbers
- Customer details
- Vehicle information
- Sticker types and pricing
- Payment status
- Timestamps

---

## 10. CRON JOBS & AUTOMATIONS

### Daily Cron Jobs:
1. `process-all-renewals.ts` - Charge customers, create remitter orders
2. `notify-sticker-purchased.ts` - Send post-purchase emails/SMS
3. `notify-remitter-daily.ts` - Daily summary to remitters
4. `notify-expiring-licenses.ts` - Remind users about upcoming renewals
5. `notify-emissions-test.ts` - Remind of emissions test requirements

### Query Parameters:
- `?dryRun=true` - Simulate processing without actual charges
- Authorization header: `Bearer ${CRON_SECRET}`

---

## Summary: Saved Payment Method Flow

```
User Signs Up → Checkout (payment_method_collection: 'always')
    ↓
Stripe saves method as customer.invoice_settings.default_payment_method
    ↓
30 days before renewal → Cron job runs
    ↓
Retrieve customer + saved payment method
    ↓
Create PaymentIntent with saved method
    ↓
Transfer funds to remitter via Stripe Connect
    ↓
Create renewal_order for remitter fulfillment
    ↓
Send notifications to customer and remitter
    ↓
Remitter submits renewal to city
    ↓
Remitter confirms via /api/remitter/confirm-payment
    ↓
Profile expiry advances by 1 year → Cycle repeats
```

This ensures customers get automatic renewal without manual intervention, while remitters have clear orders to fulfill.
