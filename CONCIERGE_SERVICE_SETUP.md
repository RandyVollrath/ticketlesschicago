# Concierge Service Setup Guide
## Automated City Sticker Renewals with Subscription Billing

---

## 🎯 Overview

This system automates city sticker renewals for customers who subscribe to your concierge service:

- **$12/month subscription** → Goes to your platform (concierge service fee)
- **$12-15 one-time fee** → Goes to remitter (initial setup)
- **Automated renewals** → Customer's card is charged 30-60 days before sticker expires
- **Direct to remitter** → Sticker payments go directly to remitter via Stripe Connect
- **$2 platform fee** → Automatically deducted from each renewal

---

## 💰 Payment Flow

### Customer Signup
```
1. Customer visits /concierge-signup
2. Enters vehicle & payment info
3. Authorizes future charges
4. Immediately charged:
   - $12-15 one-time → Remitter (via Connect)
   - $12 recurring → Platform (subscription)
5. Card saved for future renewals
```

### Automated Renewal (30-60 days before expiration)
```
1. Cron job runs daily at 7am CST
2. Finds customers with expiring stickers
3. Charges saved payment method
4. Payment flow:
   - $100 (sticker) → Remitter
   - $2 (platform fee) → Platform
5. Creates order for remitter to fulfill
6. Notifies customer via email/SMS
```

### Payment Failure
```
1. Charge attempt fails
2. System logs failure reason
3. Sends email notification to customer
4. Sends SMS notification to customer
5. Records in payment_failure_notifications table
6. Customer can update payment method
```

---

## 📋 Setup Steps

### Step 1: Run Database Migration

```bash
psql $DATABASE_URL -f database/migrations/add_subscription_and_payment_fields.sql
```

This creates:
- Subscription fields in `user_profiles`
- `renewal_charges` table (tracks all payments)
- `payment_failure_notifications` table (email/SMS tracking)

### Step 2: Set Environment Variables

Ensure these are set in Vercel:

```bash
# Stripe keys (LIVE mode)
STRIPE_SECRET_KEY=sk_live_xxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_CONNECT_CLIENT_ID=ca_xxxxx

# Database
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx

# Cron security
CRON_SECRET=<generate-random-secret>

# Base URL
NEXT_PUBLIC_BASE_URL=https://autopilotamerica.com
```

### Step 3: Deploy

```bash
git add -A
git commit -m "Add concierge service with automated renewals"
git push origin main
```

Vercel will automatically deploy and set up the cron job.

### Step 4: Test Signup Flow

1. Visit: `https://autopilotamerica.com/concierge-signup`
2. Fill out form with test data
3. Use Stripe test card: `4242 4242 4242 4242`
4. Verify charges appear in Stripe Dashboard

---

## 🗂️ Database Schema

### user_profiles (additions)

```sql
stripe_customer_id TEXT
stripe_payment_method_id TEXT
stripe_subscription_id TEXT
subscription_status TEXT  -- 'active', 'past_due', 'canceled'
subscription_started_at TIMESTAMPTZ
subscription_canceled_at TIMESTAMPTZ
payment_authorized_at TIMESTAMPTZ
renewal_notification_days INTEGER DEFAULT 30  -- When to charge (30-60 days)
```

### renewal_charges (new table)

Tracks all payment attempts:

```sql
id UUID
user_id UUID
charge_type TEXT  -- 'subscription', 'sticker_renewal', 'remitter_onetime'
amount DECIMAL(10, 2)
stripe_payment_intent_id TEXT
status TEXT  -- 'pending', 'succeeded', 'failed', 'refunded'
failure_reason TEXT
remitter_partner_id UUID
remitter_received_amount DECIMAL(10, 2)
platform_fee_amount DECIMAL(10, 2)
renewal_type TEXT  -- 'city_sticker', 'license_plate'
renewal_due_date DATE
customer_notified BOOLEAN
notification_sent_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

### payment_failure_notifications (new table)

Tracks email/SMS notifications for failed payments:

```sql
id UUID
user_id UUID
renewal_charge_id UUID
notification_type TEXT  -- 'email', 'sms'
recipient TEXT  -- email address or phone number
status TEXT  -- 'pending', 'sent', 'failed'
subject TEXT
message TEXT
provider TEXT  -- 'resend' for email, 'twilio' for SMS
sent_at TIMESTAMPTZ
retry_count INTEGER
next_retry_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

---

## 🔧 Code Structure

### Customer-Facing

**pages/concierge-signup.tsx**
- Multi-step signup form
- Stripe Elements integration
- Payment authorization
- Terms & conditions

**pages/api/concierge/signup.ts**
- Creates Stripe Customer
- Attaches payment method
- Charges one-time remitter fee ($12-15)
- Creates $12/mo subscription
- Saves to database

### Automated Processing

**pages/api/cron/process-renewals.ts**
- Runs daily at 7am CST
- Finds customers with expiring stickers
- Charges saved payment methods
- Creates orders for remitters
- Handles failures with notifications

### Supporting Files

**database/migrations/add_subscription_and_payment_fields.sql**
- Schema updates

**vercel.json**
- Cron job configuration

---

## ⚙️ Configuration

### Renewal Timing (Per Customer)

Each customer has `renewal_notification_days` field (default: 30).

This controls when they're charged before expiration.

To change globally:
```sql
-- Set all customers to 60 days
UPDATE user_profiles
SET renewal_notification_days = 60
WHERE concierge_service = true;
```

To change for one customer:
```sql
-- Charge 45 days before expiration
UPDATE user_profiles
SET renewal_notification_days = 45
WHERE user_id = '<customer-id>';
```

### Sticker Prices

Defined in `pages/api/cron/process-renewals.ts`:

```typescript
const STICKER_PRICES = {
  passenger: 100,
  large_vehicle: 150,
  senior_disabled: 50,
};
```

### Platform Fee

```typescript
const PLATFORM_FEE = 2; // $2 per renewal
```

---

## 📊 Monitoring & Reports

### View Active Subscriptions

```sql
SELECT
  first_name,
  last_name,
  license_plate,
  city_sticker_expiry,
  subscription_status,
  renewal_notification_days,
  stripe_customer_id
FROM user_profiles
WHERE concierge_service = true
  AND subscription_status = 'active'
ORDER BY city_sticker_expiry;
```

### View Upcoming Renewals

```sql
SELECT
  first_name,
  last_name,
  license_plate,
  city_sticker_expiry,
  city_sticker_expiry - CURRENT_DATE as days_until_expiry,
  renewal_notification_days
FROM user_profiles
WHERE concierge_service = true
  AND subscription_status = 'active'
  AND city_sticker_expiry > CURRENT_DATE
ORDER BY city_sticker_expiry;
```

### View Failed Payments

```sql
SELECT
  rc.created_at,
  up.first_name,
  up.last_name,
  up.license_plate,
  rc.amount,
  rc.failure_reason,
  rc.failure_code
FROM renewal_charges rc
JOIN user_profiles up ON up.user_id = rc.user_id
WHERE rc.status = 'failed'
  AND rc.charge_type = 'sticker_renewal'
ORDER BY rc.created_at DESC;
```

### View Revenue

```sql
-- Monthly subscription revenue
SELECT
  COUNT(*) as active_subscribers,
  COUNT(*) * 12 as monthly_revenue
FROM user_profiles
WHERE subscription_status = 'active';

-- Renewal platform fees (lifetime)
SELECT
  SUM(platform_fee_amount) as total_platform_fees,
  COUNT(*) as total_renewals
FROM renewal_charges
WHERE charge_type = 'sticker_renewal'
  AND status = 'succeeded';
```

---

## 🔔 Notifications (TODO)

The system has placeholders for email/SMS notifications. To implement:

### Email Notifications (via Resend)

1. **Install Resend:**
```bash
npm install resend
```

2. **Add env var:**
```bash
RESEND_API_KEY=re_xxxxx
```

3. **Implement in `/pages/api/cron/process-renewals.ts`:**
```typescript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'Autopilot America <hello@autopilotamerica.com>',
  to: customer.email,
  subject: 'Payment Failed - Action Required',
  text: message,
});
```

### SMS Notifications (via Twilio)

1. **Install Twilio:**
```bash
npm install twilio
```

2. **Add env vars:**
```bash
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+13125551234
```

3. **Implement in `/pages/api/cron/process-renewals.ts`:**
```typescript
import twilio from 'twilio';
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

await client.messages.create({
  body: message,
  from: process.env.TWILIO_PHONE_NUMBER,
  to: customer.phone,
});
```

---

## 🧪 Testing

### Test Signup (Development)

Use Stripe test mode and test cards:

```
Card: 4242 4242 4242 4242
Expiry: 12/34
CVC: 123
ZIP: 60601
```

### Test Cron Job Manually

```bash
curl -X POST https://autopilotamerica.com/api/cron/process-renewals \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Test Failure Scenarios

Use Stripe's special test cards:

```
# Declined card
4000 0000 0000 0002

# Insufficient funds
4000 0000 0000 9995

# Expired card
4000 0000 0000 0069
```

---

## 🚨 Handling Edge Cases

### Customer Cancels Subscription

```typescript
// In your dashboard cancel endpoint
await stripe.subscriptions.cancel(subscriptionId);

await supabase
  .from('user_profiles')
  .update({
    subscription_status: 'canceled',
    subscription_canceled_at: new Date().toISOString(),
  })
  .eq('stripe_subscription_id', subscriptionId);
```

### Customer Updates Payment Method

```typescript
// In your dashboard payment update endpoint
const newPaymentMethod = await stripe.paymentMethods.attach(newPaymentMethodId, {
  customer: customerId,
});

await stripe.customers.update(customerId, {
  invoice_settings: {
    default_payment_method: newPaymentMethodId,
  },
});

await supabase
  .from('user_profiles')
  .update({
    stripe_payment_method_id: newPaymentMethodId,
  })
  .eq('stripe_customer_id', customerId);
```

### Remitter Not Available

The cron job will throw an error if no remitter is available. Handle this by:

1. Creating a default/backup remitter
2. Assigning remitters based on customer location
3. Queuing renewals until remitter is available

---

## 📈 Scaling Considerations

### Multiple Remitters

Assign remitters based on customer zip code:

```typescript
const { data: remitter } = await supabase
  .from('renewal_partners')
  .select('*')
  .eq('status', 'active')
  .contains('service_zip_codes', [customer.zip_code])
  .single();
```

Add `service_zip_codes` field to `renewal_partners`:
```sql
ALTER TABLE renewal_partners
ADD COLUMN service_zip_codes TEXT[];
```

### High Volume

For 10,000+ customers:
- Add Redis caching for frequently accessed data
- Batch process renewals (100 at a time)
- Use Stripe's bulk APIs
- Add queue system (Bull, BullMQ)

---

## ✅ Launch Checklist

Before going live:

- [ ] Database migration run successfully
- [ ] Stripe Connect live client ID configured
- [ ] All environment variables set in Vercel
- [ ] Cron job scheduled and verified
- [ ] Test signup flow with real card
- [ ] Test refund flow
- [ ] Email notifications configured (Resend)
- [ ] SMS notifications configured (Twilio)
- [ ] Terms of Service and Privacy Policy pages created
- [ ] Customer dashboard to manage subscription
- [ ] Test payment failure handling
- [ ] Verify remitter receives payments correctly
- [ ] Monitor Stripe webhook events

---

## 🎯 Next Steps

1. **Wait for Stripe Connect live client ID approval**
2. **Run database migration**
3. **Test signup flow in production**
4. **Implement email/SMS notifications**
5. **Create customer dashboard**
6. **Set up monitoring/alerts**

---

## 💡 Questions?

Check the code comments or test with Stripe test mode first!

**Ready to launch?** Complete the Stripe Connect setup, run the migration, and deploy! 🚀
