# File Reference & Code Snippets

## Key Files Location Summary

### Main Notification/Renewal Files

| File | Purpose | Key Logic |
|------|---------|-----------|
| `/pages/api/cron/process-all-renewals.ts` | City sticker & license plate auto-processing | Charges customers 14 days before expiry |
| `/pages/api/cron/notify-emissions-test.ts` | Emissions test reminders | 90, 60, 45, 30, 14, 7, 3, 1, 0 days |
| `/pages/api/cron/notify-sticker-purchased.ts` | Post-purchase follow-ups | Days 0, 10, 14 after purchase |
| `/pages/api/cron/notify-expiring-licenses.ts` | License expiration alerts | Triggers 60+ days before renewal |
| `/pages/api/cron/notify-remitter-daily.ts` | Remitter digest email | Daily at 8am CT with pending counts |
| `/pages/api/send-renewal-reminders.background.js` | Legacy reminder system | Queries obligations view |
| `/pages/api/renewals/charge.ts` | Individual charge handler | API for processing single renewal |

---

## Key Code Patterns

### 1. Filtering for Protection Users Only

All renewal crons use this pattern:
```typescript
const { data: customers, error } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('has_protection', true)  // <-- Only Protection plan users
  .not('city_sticker_expiry', 'is', null);
```

### 2. Processing Window Check

```typescript
const expiryDate = new Date(customer.city_sticker_expiry);
const today = new Date();
const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

const notificationDays = customer.renewal_notification_days || 30;

// Process if within renewal window (0-30 days)
if (daysUntilExpiry > notificationDays) {
  continue; // Too early
}

if (daysUntilExpiry < 0) {
  continue; // Too late (already expired)
}
```

### 3. Duplicate Prevention

```typescript
// Check if already sent
const messageKey = `emissions_reminder_${daysUntil}_${user.emissions_date}`;

if (await wasNotificationSent(user.user_id, messageKey)) {
  console.log(`Already sent ${daysUntil}-day reminder to ${user.email}`);
  continue;
}

// Insert to prevent duplicates
async function wasNotificationSent(userId: string, messageKey: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('message_key', messageKey)
    .single();
  return !!data;
}
```

### 4. Emissions Check Before License Plate Renewal

From `/pages/api/cron/process-all-renewals.ts` (lines 513-549):

```typescript
// CRITICAL EMISSIONS CHECK
// If emissions test is required and not completed, cannot process license plate renewal
const emissionsRequired = customer.emissions_date !== null;
const emissionsCompleted = customer.emissions_completed === true;

if (emissionsRequired && !emissionsCompleted) {
  const emissionsDate = new Date(customer.emissions_date);
  const daysUntilEmissions = Math.floor((emissionsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  console.log(`⚠️ BLOCKED: Cannot process license plate renewal for ${customer.email}`);
  console.log(`   Reason: Emissions test not completed (due in ${daysUntilEmissions} days)`);
  console.log(`   Action: Sending urgent emissions reminder`);

  // Log the blocking for tracking
  await supabase.from('renewal_charges').insert({
    user_id: customer.user_id,
    charge_type: 'license_plate_renewal',
    amount: 0,
    status: 'blocked',
    failure_reason: 'Emissions test not completed - required for IL license plate renewal',
    failure_code: 'emissions_required',
    renewal_type: 'license_plate',
    renewal_due_date: customer.license_plate_expiry,
    failed_at: new Date().toISOString(),
  });

  results.licensePlateFailed++;
  continue; // Skip to next customer - cannot process without emissions
}
```

### 5. Checking for Purchased Stickers (Stops Reminders)

From `/pages/api/cron/notify-remitter-daily.ts` (line 106):

```typescript
// Get users ready for renewal (profile confirmed) but NOT YET PURCHASED
const { data: confirmedUsers, error: confirmedError } = await supabase
  .from('user_profiles')
  .select('user_id, email, first_name, last_name, license_plate, profile_confirmed_at, sticker_expiration_date')
  .eq('has_protection', true)
  .eq('profile_confirmed_for_year', currentYear)
  .is('sticker_purchased_at', null);  // <-- Filters out purchased stickers

if (confirmedError) {
  console.error('Error fetching confirmed users:', confirmedError);
}
```

### 6. Emissions Reminder Query (Only Incomplete)

From `/pages/api/cron/notify-emissions-test.ts` (lines 266-270):

```typescript
// Get users with emissions dates set who haven't completed the test
const { data: users, error } = await supabase
  .from('user_profiles')
  .select('*')
  .not('emissions_date', 'is', null)
  .or('emissions_completed.is.null,emissions_completed.eq.false');  // <-- Only incomplete
```

---

## Email Notification Examples

### City Sticker Purchase Confirmation

From `/pages/api/cron/process-all-renewals.ts` (lines 82-127):

```typescript
const html = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); 
                color: white; padding: 24px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; font-size: 24px;">
        Your ${typeName} renewal has been processed
      </h1>
    </div>
    <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
      <p>Hi ${customer.first_name || 'there'},</p>
      <p>Great news! We've successfully charged your card for your ${typeName} renewal.</p>
      
      <div style="background: white; border: 1px solid #e5e7eb; 
                  border-radius: 8px; padding: 16px; margin: 16px 0;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #6b7280;">Amount charged:</span>
          <strong>$${amount.toFixed(2)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #6b7280;">Expiration date:</span>
          <strong>${customer.city_sticker_expiry || customer.license_plate_expiry}</strong>
        </div>
      </div>
      
      <p><strong>What's next?</strong></p>
      <ol>
        <li>We'll submit your renewal to the city within 1-2 business days</li>
        <li>Your new sticker will be mailed to your address on file</li>
        <li>You'll receive a confirmation email when it's complete</li>
      </ol>
    </div>
  </div>
`;
```

### Emissions Test Reminder (Critical - 0 Days)

From `/pages/api/cron/notify-emissions-test.ts` (lines 154-157):

```typescript
case 'critical':
  subject = `${style.emoji} URGENT: Emissions Test Due ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}`;
  headerText = `Your Emissions Test is Due ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}!`;
  bodyText = `This is your final reminder. Without a valid emissions test, 
              you cannot renew your license plate. 
              Please complete your test immediately.`;
  break;
```

---

## Database Tables Referenced

### user_profiles (Key Renewal Fields)
- `has_protection` - Boolean, true = Protection Plan user
- `city_sticker_expiry` - ISO date of city sticker expiration
- `license_plate_expiry` - ISO date of license plate expiration
- `emissions_date` - ISO date when emissions test is due
- `emissions_completed` - Boolean, true = test completed
- `sticker_purchased_at` - ISO timestamp when sticker was purchased
- `renewal_notification_days` - Number (default 30) of days before expiry to start notifications
- `profile_confirmed_for_year` - Integer year when profile was confirmed
- `stripe_customer_id` - For charging
- `phone` / `phone_number` - For SMS notifications
- `notify_sms` - Boolean, user opted-in to SMS

### notification_log (Duplicate Prevention)
- `user_id` - Who received notification
- `notification_type` - Type of notification sent
- `channel` - 'email' or 'sms'
- `message_key` - Unique identifier to prevent duplicates
- `metadata` - JSON with sent_at, days_until_deadline, etc.

### renewal_charges (Payment Tracking)
- `user_id` - Customer
- `charge_type` - 'sticker_renewal', 'license_plate_renewal'
- `amount` - Amount charged
- `status` - 'pending', 'succeeded', 'failed', 'blocked'
- `stripe_payment_intent_id` - For reconciliation
- `failure_reason` - Why payment failed (if applicable)

### renewal_orders (Remitter Work Queue)
- `partner_id` - Remitter who will process
- `license_plate` - Vehicle to renew
- `status` - 'pending', 'processing', 'completed'
- `sticker_price` - Cost of sticker
- `total_amount` - Including processing fee
- `stripe_payment_intent_id` - Customer payment reference

### renewal_partners (Remitter Info)
- `name` - Remitter name
- `email` / `notification_email` - Where to send digest
- `status` - 'active' or inactive
- `stripe_connected_account_id` - For payments

---

## Environment Variables Needed

```
RESEND_API_KEY          - Email delivery
CLICKSEND_USERNAME      - SMS delivery
CLICKSEND_API_KEY       - SMS delivery
CRON_SECRET             - Authorization for cron jobs
STRIPE_SECRET_KEY       - Payment processing
NEXT_PUBLIC_SUPABASE_URL - Database
SUPABASE_SERVICE_ROLE_KEY - Database admin access
```

---

## Testing Commands

### Test Emissions Reminder
```bash
curl -X POST https://ticketlesschicago.com/api/cron/notify-emissions-test \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Test Renewal Processing
```bash
curl -X POST https://ticketlesschicago.com/api/cron/process-all-renewals \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Test Post-Purchase Notifications
```bash
curl -X GET https://ticketlesschicago.com/api/cron/notify-sticker-purchased
```

