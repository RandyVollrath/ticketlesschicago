# Ticketless Chicago Renewal Notification System - Comprehensive Summary

## Overview
The renewal notification system is a sophisticated multi-cron job system that:
1. Sends proactive reminders to users at specific intervals before deadlines
2. Automatically processes renewals for Protection Plan users 14 days before expiration
3. Sends post-purchase confirmation and delivery reminders
4. Tracks notifications to prevent duplicates using a notification_log table
5. Differentiates between free users (no notifications) and paid Protection users

---

## 1. CRON JOBS FOR RENEWALS/DEADLINES

### Core Renewal Processing
**File: `/pages/api/cron/process-all-renewals.ts`**
- **Purpose**: Unified renewal processing for city stickers and license plates
- **Schedule**: Daily
- **Triggers on**: 0-30 days before expiration (configurable via `renewal_notification_days`)
- **Actions**:
  1. Charges saved payment method for renewal costs
  2. Transfers payments to remitter via Stripe Connect
  3. Creates orders for remitter fulfillment
  4. Sends success/failure notifications to customers
  5. Blocks license plate renewals if emissions test not completed

### Reminder Cron Jobs

**File: `/pages/api/cron/notify-emissions-test.ts`**
- **Purpose**: Proactive emissions test reminders (required for IL license plate renewal)
- **Schedule**: Daily
- **Who**: All users with `emissions_date` set and `emissions_completed != true`
- **Reminder schedule**: 90, 60, 45, 30, 14, 7, 3, 1, 0 days before deadline
- **Escalation**: Sends SMS even to users who haven't opted-in if deadline is 0-1 days
- **Channels**: Email + SMS (with urgency-based messaging)

**File: `/pages/api/cron/notify-sticker-purchased.ts`**
- **Purpose**: Post-purchase notifications for city stickers
- **Schedule**: Daily
- **Who**: Users with `sticker_purchased_at` set (Protection users only via query)
- **Notifications**:
  - Day 0-1: "Sticker Purchased" confirmation
  - Day 9-11: "Check Your Mailbox" delivery reminder
  - Day 13-15: "Did You Apply Your Sticker?" application check
- **Channels**: Email + SMS

**File: `/pages/api/cron/notify-expiring-licenses.ts`**
- **Purpose**: Alert users when driver's license expires before city sticker renewal
- **Schedule**: Daily
- **Who**: Protection users with `has_protection=true` and expiring licenses
- **Trigger**: License expires 60+ days before city sticker renewal
- **Action**: Prompts user to upload updated license image

**File: `/pages/api/cron/notify-remitter-daily.ts`**
- **Purpose**: Morning digest for remitters showing pending renewals
- **Schedule**: Daily at 8am CT
- **Who**: Active remitters in `renewal_partners` table
- **Contents**:
  - Count of users ready for renewal
  - Urgent renewals (deadline <7 days)
  - Complete list of pending renewals

**File: `/pages/api/send-renewal-reminders.background.js`** (Legacy/Active)
- **Purpose**: Background job for renewal reminders using obligations view
- **Schedule**: Called via query parameter with offset (60, 45, 30, 21, 14 days)
- **Who**: All users with upcoming obligations
- **Channels**: Email + SMS
- **Idempotency**: Uses `notification_log` table to prevent duplicates
- **Note**: Comment says "We stop at 14 days because that's when we purchase the stickers"

---

## 2. FREE USERS VS PAID PROTECTION USERS

### Key Differences

**Free Users:**
- Receive NO renewal notifications or automatic processing
- Do not have `has_protection = true`
- Only get basic ticket contest notifications

**Paid Protection Plan Users:**
- Have `has_protection = true` in `user_profiles` table
- Are filtered into ALL renewal cron jobs
- Receive:
  - Reminder emails/SMS at key intervals
  - Automatic renewal processing 14 days before expiration
  - Post-purchase confirmation emails
  - Emissions test reminders
  - License expiration alerts

### Filtering Logic
All renewal notification crons use this pattern:
```typescript
.from('user_profiles')
.select('*')
.eq('has_protection', true)  // Only Protection users
```

---

## 3. MESSAGES SENT FOR DIFFERENT DEADLINES

### City Sticker Renewals

**Message Template Structure**:
Based on days until expiration, messages escalate in urgency:

| Days Until | Email Subject | SMS Tone | Email Header |
|-----------|--------------|----------|--------------|
| 60 | "City Sticker expires in 2 months" | GREEN reminder 🚗 | Friendly reminder |
| 30 | "City Sticker expires in 30 days" | GREEN reminder 🚗 | Reminder |
| 14 | "City Sticker expires in 2 weeks" | RED urgent 🚨 | URGENT - Avoid $200+ tickets |
| 7 | "City Sticker expires in 1 week" | RED urgent 🚨 | FINAL WEEK |
| 3 | "City Sticker expires in 3 days" | RED emergency 🔥 | EMERGENCY - 3 days only |
| 1 | "City Sticker expires TOMORROW" | RED critical 🔥 | CRITICAL |
| 0 | "City Sticker expires TODAY" | RED critical 🚨 | EXPIRES TODAY |

**Sample SMS (30 days)**:
```
🚗 REMINDER: Chicago City Sticker expires [DATE] (30 days left). 
Don't risk tickets! [DASHBOARD_URL]
```

**Sample SMS (Critical - 0 days)**:
```
🚨 EXPIRES TODAY: City Sticker expires [DATE]! 
Renew immediately to avoid tickets! [DASHBOARD_URL]
```

### Emissions Test Reminders

Same escalation pattern as city stickers:

| Days Until | Email Subject | SMS Tone | Context |
|-----------|--------------|----------|---------|
| 90-60 | "Emissions Test due in [X] days" | Reminder 🏭 | Early heads-up |
| 30 | "Emissions Test Reminder - 30 Days Left" | Reminder 📋 | Plan ahead |
| 14 | "Emissions Test due in 2 weeks" | Urgent 🚨 | "Can't register without it" |
| 7 | "Emissions Test due in 1 week" | Urgent 🚨 | Final week emphasis |
| 1 | "Emissions Test due TOMORROW" | Critical 🔥 | Last chance |
| 0 | "Emissions Test due TODAY" | Critical 🚨 | Must complete immediately |

### Post-Purchase Confirmations

**Day 0-1: Sticker Purchased Email**
```
Subject: "Your City Sticker Has Been Purchased! 🎉"
Content:
- License plate and purchase date
- Expected delivery (7-10 business days)
- Instructions to apply upon arrival
- CTA: "This is why you have Autopilot Protection"
```

**Day 9-11: Delivery Reminder**
```
Subject: "Your City Sticker Should Be Arriving Soon"
Content:
- "Check Your Mailbox!" header
- Warning: Still get tickets if not applied
- "Haven't received after 14 days? Reply to email"
```

**Day 13-15: Application Confirmation**
```
Subject: "Did You Apply Your New City Sticker?"
Content:
- Two-option buttons: "Yes, Applied It!" / "Not Yet / Problem"
- Warning about tickets without sticker display
- Fallback: Email support if problems
```

---

## 4. LOGIC THAT STOPS NOTIFICATIONS

### When Notifications Stop

**1. After Purchase**
- When `sticker_purchased_at` is set, user is moved from "pending renewal" to "purchased"
- Remitter daily digest filters: `.is('sticker_purchased_at', null)` 
- Users with purchased stickers no longer appear in remitter digest
- Post-purchase notifications follow 3 specific milestones (days 0, 10, 14), then stop

**2. After Emissions Completion**
- When `emissions_completed = true`, emissions reminders stop
- License plate renewal processing checks: `if (emissionsRequired && !emissionsCompleted)`
- Once marked complete, user is no longer returned by query:
  ```typescript
  .or('emissions_completed.is.null,emissions_completed.eq.false')
  ```

**3. After Payment Succeeds**
- When renewal charge status = 'succeeded', that renewal instance won't be processed again
- System checks: `status = 'succeeded'` to skip already-processed renewals
- Exception: If payment fails, system notifies user and awaits manual resolution

**4. Idempotency (No Duplicate Notifications)**
- Each notification is logged in `notification_log` table with:
  - `user_id`
  - `message_key` (unique identifier like "emissions_reminder_30_[DATE]")
  - `notification_type` (e.g., "emissions_reminder", "sticker_purchased")
  - `channel` (email, sms)
  - `metadata` (timestamp, days_until_deadline)

- Before sending, system checks:
  ```typescript
  const alreadySent = await wasNotificationSent(userId, messageKey);
  if (alreadySent) return; // Skip
  ```

**5. Outside Window Logic**
- `process-all-renewals.ts`: Only processes renewals in 0-30 day window
- Reminders sent at specific milestones (60, 45, 30, 21, 14 days) - not daily to same user
- License expiration: Only notifies if 60+ days until city sticker renewal

---

## 5. NOTIFICATION TRACKING & LOGGING

### notification_log Table Structure
```typescript
{
  user_id: string;
  notification_type: string;  // e.g., "emissions_reminder", "sticker_purchased"
  channel: string;             // "email" or "sms"
  message_key: string;         // Unique: "emissions_reminder_30_2025-01-15"
  metadata: {
    sent_at: ISO timestamp;
    days_until_deadline?: number;
  }
}
```

### Duplicate Prevention
- Uses `upsert: false` on insert to detect duplicates
- If insert fails with error code '23505' (unique constraint), notification was already sent
- Prevents sending same reminder twice to same user for same deadline

---

## 6. EMAIL/SMS PROVIDERS

- **Email**: Resend API (`https://api.resend.com/emails`)
- **SMS**: ClickSend (`https://rest.clicksend.com/v3/sms/send`)
- **From Email**: `Autopilot America <noreply@autopilotamerica.com>`

---

## 7. CRITICAL BUSINESS LOGIC

### City Sticker Renewal Flow
1. **Day 30 before expiry**: First reminder email/SMS sent
2. **Day 14 before expiry**: Last reminder + system auto-charges customer
3. **Day 14 (after charge)**: Charge success email sent, order created for remitter
4. **Day 0-1 (after purchase): "Sticker Purchased" email sent (optional, when `sticker_purchased_at` set)
5. **Day 10**: Delivery reminder email
6. **Day 14**: "Did you apply?" confirmation email

### License Plate Renewal Block
- Cannot process until emissions test is marked `emissions_completed = true`
- If deadline approaching and test not done: blocks renewal and sends urgent emissions reminder
- Error logged as: `failure_reason: 'Emissions test not completed - required for IL license plate renewal'`

### Remitter Model
- System charges customer the full amount
- Sends remitter their cut via Stripe Connect transfer
- Remitter gets daily digest showing:
  - Users ready to process (profile confirmed)
  - Urgent deadlines (<7 days)
  - All pending renewals with status

---

## 8. SUMMARY: COMPLETE NOTIFICATION LIFECYCLE

```
User Buys Protection Plan (has_protection = true)
                    ↓
        [30 days before expiry]
                    ↓
Email/SMS Reminder #1 ← Logged in notification_log
                    ↓
        [14 days before expiry]
                    ↓
Email/SMS Reminder #2 + Auto-charge card
                    ↓
        [Charge succeeds]
                    ↓
Charge confirmation email sent
Remitter gets order notification
Remitter daily digest updated
                    ↓
        [Remitter purchases sticker]
                    ↓
sticker_purchased_at field set
                    ↓
        [Day 0 after purchase]
                    ↓
"Sticker Purchased!" email (last notification this segment)
                    ↓
        [Day 10 after purchase]
                    ↓
"Check your mailbox" delivery reminder
                    ↓
        [Day 14 after purchase]
                    ↓
"Did you apply?" confirmation email
                    ↓
Cycle resets next year
```

