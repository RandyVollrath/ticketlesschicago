# Message Registry - Complete Documentation

**Last Updated:** 2025-11-17
**Purpose:** Single source of truth for all message types, triggers, and logic

This document defines every message that can be sent by the system. Every message has:
- **Key:** Unique identifier
- **Description:** What it's for
- **Trigger Type:** How it fires (cron, event, manual)
- **Trigger Logic:** Exact conditions
- **Code Location:** Where the logic lives
- **Active:** Whether it's enabled
- **Template:** Actual message content

---

## 📋 Renewal Reminders (Cron-Based)

### City Sticker Reminders

| Key | Days Before | Trigger Logic | Active |
|-----|-------------|---------------|--------|
| `renewal_city_sticker_60day` | 60 | Cron runs daily at 12 UTC. Finds users with `city_sticker_expiry` = 60 days from today AND `has_protection = true`. | ✅ |
| `renewal_city_sticker_45day` | 45 | Same as above, 45 days before expiry. | ✅ |
| `renewal_city_sticker_37day` | 37 | Same as above, 37 days before expiry (1 week before charge). | ✅ |
| `renewal_city_sticker_30day` | 30 | Same as above, 30 days before expiry (charge day). | ✅ |
| `renewal_city_sticker_14day` | 14 | Same as above, 14 days before expiry (post-purchase confirmation). | ✅ |
| `renewal_city_sticker_7day` | 7 | Same as above, 7 days before expiry. | ✅ |
| `renewal_city_sticker_1day` | 1 | Same as above, 1 day before expiry. | ✅ |

**Code Location:** `lib/notifications-fixed.ts` lines 52-240

**Template Logic:**
- **Free users:** Simple reminder to renew themselves
- **Protection users (before day 30):** "We'll charge your card on [date]. Confirm your info is current."
- **Protection users (day 30):** "We're charging your card TODAY."
- **Protection users (after day 30):**
  - If `city_payment_status = 'paid'`: "We already purchased your sticker."
  - Else: "We're processing your renewal purchase."

**Channels:** SMS, Email, Voice (based on user preferences)

**Deduplication:** 48-hour window (won't send same message within 48h)

---

### License Plate Reminders

| Key | Days Before | Trigger Logic | Active |
|-----|-------------|---------------|--------|
| `renewal_license_plate_60day` | 60 | Cron runs daily. Finds users with `license_plate_expiry` = 60 days from today. | ✅ |
| `renewal_license_plate_45day` | 45 | Same as above, 45 days. | ✅ |
| `renewal_license_plate_37day` | 37 | Same as above, 37 days. | ✅ |
| `renewal_license_plate_30day` | 30 | Same as above, 30 days (charge day for Protection users). | ✅ |
| `renewal_license_plate_14day` | 14 | Same as above, 14 days. | ✅ |
| `renewal_license_plate_7day` | 7 | Same as above, 7 days. | ✅ |
| `renewal_license_plate_1day` | 1 | Same as above, 1 day. | ✅ |

**Code Location:** `lib/notifications-fixed.ts` lines 52-240

**Template Logic:** Same as City Sticker (above)

**Can Auto-Purchase:** ✅ Yes

---

### Emissions Test Reminders

| Key | Days Before | Trigger Logic | Active |
|-----|-------------|---------------|--------|
| `renewal_emissions_test_60day` | 60 | Cron runs daily. Finds users with `emissions_date` = 60 days from today. | ✅ |
| `renewal_emissions_test_45day` | 45 | Same as above, 45 days. | ✅ |
| `renewal_emissions_test_30day` | 30 | Same as above, 30 days. | ✅ |
| `renewal_emissions_test_14day` | 14 | Same as above, 14 days. | ✅ |
| `renewal_emissions_test_7day` | 7 | Same as above, 7 days. | ✅ |
| `renewal_emissions_test_1day` | 1 | Same as above, 1 day. | ✅ |

**Code Location:** `lib/notifications-fixed.ts` lines 52-240

**Template Logic:**
- **NEVER** says "we'll purchase" or "we already purchased"
- Always: "Schedule your test at illinoisveip.com"
- Reminder-only (user must bring vehicle to testing facility)

**Can Auto-Purchase:** ❌ No (must be done in person)

---

## 🚗 Street Cleaning Alerts (Cron-Based)

### Street Cleaning Notifications

| Key | Timing | Trigger Logic | Active |
|-----|--------|---------------|--------|
| `street_cleaning_3day` | 3 days before | Cron checks Chicago street cleaning calendar. Finds users with plates in affected zones 3 days before event. | ✅ |
| `street_cleaning_1day` | 1 day before | Same as above, 1 day before. | ✅ |
| `street_cleaning_today` | Day of | Same as above, day of event. | ✅ |

**Code Location:** `lib/street-cleaning-notifications.ts` (if exists) or separate cron

**Template:**
```
Autopilot: Street cleaning on [street] tomorrow [date] [time]. Move your car to avoid tickets. Zone [zone].
```

**Channels:** SMS, Email

**Deduplication:** 24-hour window per street/date combination

---

## 📝 Registration Flow (Event-Driven)

### Registration Started

| Key | Trigger | Logic | Active |
|-----|---------|-------|--------|
| `reg_profile_needed` | User enters registration flow | When user clicks "Register my vehicle" but profile incomplete (missing DL, insurance, plate, or VIN). | ✅ |

**Code Location:** Registration page component

**Template:**
```
Autopilot: To complete your vehicle registration, we need:
[list of missing items]
Upload at autopilotamerica.com/register
```

**Channels:** SMS, Email

**Cooldown:** 72 hours (don't send again within 72h)

---

### Registration Submitted to City

| Key | Trigger | Logic | Active |
|-----|---------|-------|--------|
| `reg_submitted` | Remitter confirms submission | Triggered by webhook or manual confirmation when remitter marks registration as submitted to Illinois SOS. | ✅ |

**Code Location:** Remitter confirmation endpoint (similar to `/api/remitter/confirm-payment`)

**Template:**
```
Autopilot: Great news! We submitted your vehicle registration to the state. You'll receive your plates by mail in 7-10 business days. Confirmation: [confirmation_number]
```

**Channels:** SMS, Email

**Requires Human Review:** Yes (remitter must confirm actual submission)

---

### Registration Status Update

| Key | Trigger | Logic | Active |
|-----|---------|-------|--------|
| `reg_status_update` | Database status change | Triggered when `registrations.status` field changes to user-facing status (e.g., 'processing', 'delayed', 'completed'). | ⚠️ Planned |

**Code Location:** Not yet implemented - needs database trigger or webhook

**Template:** Varies by status
- **processing:** "Your registration is being processed..."
- **delayed:** "There's a delay with your registration..."
- **completed:** "Your registration is complete!"

---

## 💳 Payment & Purchase Confirmations (Event-Driven)

### City Sticker Purchased

| Key | Trigger | Logic | Active |
|-----|---------|-------|--------|
| `city_sticker_purchased` | Remitter confirms payment | Triggered when remitter calls `/api/remitter/confirm-payment` with `city_payment_status = 'paid'`. | ✅ |

**Code Location:** `/api/remitter/confirm-payment.ts` lines 130-200

**Template:**
```
Autopilot: Good news! We purchased your City Sticker. It will arrive by mail within 10-14 days. Confirmation: [city_confirmation_number]
```

**Channels:** SMS, Email

**Automatic:** Yes (fires immediately when remitter confirms)

---

### Subscription Renewed

| Key | Trigger | Logic | Active |
|-----|---------|-------|--------|
| `subscription_renewed` | Stripe webhook | Triggered by `invoice.paid` webhook for subscription renewals. | ✅ |

**Code Location:** `/api/stripe-webhook.ts`

**Template:**
```
Autopilot: Your Protection subscription has renewed for another year. Thank you for staying protected! $120 charged to card ending in [last4].
```

**Channels:** Email

---

## 🚨 Error & Alert Messages (System-Generated)

### Payment Failed

| Key | Trigger | Logic | Active |
|-----|---------|-------|--------|
| `payment_failed` | Stripe webhook | Triggered by `payment_intent.payment_failed` webhook. | ✅ |

**Code Location:** `/api/stripe-webhook.ts`

**Template:**
```
Autopilot: Your payment failed. Please update your payment method at autopilotamerica.com/settings to keep your Protection active.
```

**Channels:** SMS, Email

**Urgency:** High

---

### Permit Zone Documents Needed

| Key | Trigger | Logic | Active |
|-----|---------|-------|--------|
| `permit_docs_needed` | City Sticker renewal for permit zone | When user is in permit zone (`has_permit_zone = true`) AND no approved documents on file AND City Sticker renewal is within 60 days. | ✅ |

**Code Location:** `lib/notifications-fixed.ts` lines 92-104

**Template:**
```
URGENT: We need your permit zone documents (driver's license front/back + proof of residency). Text photos to [phone] or email to documents@autopilotamerica.com
```

**Channels:** SMS, Email (appended to renewal reminders)

**Requires Human Review:** Yes (documents must be manually verified)

---

## 📊 Message Key Naming Convention

**Format:** `[category]_[type]_[timing/trigger]`

**Examples:**
- `renewal_city_sticker_30day` - Renewal category, city sticker type, 30 days timing
- `street_cleaning_1day` - Street cleaning category, 1 day timing
- `reg_profile_needed` - Registration category, profile needed trigger
- `payment_failed` - Payment category, failed trigger

**Suffixes for channels:**
- No suffix = SMS (default)
- `_email` = Email variant
- `_voice` = Voice call variant

---

## 🔧 Trigger Types

### Cron (Scheduled)
- **How:** Runs daily at 12:00 UTC via Vercel Cron
- **Endpoint:** `/api/cron/process-reminders`
- **Examples:** All renewal reminders, street cleaning alerts
- **Deduplication:** 48-hour window (won't send duplicate within 48h)

### Event (Real-time)
- **How:** Triggered by database changes, webhooks, or API calls
- **Examples:** Registration submitted, payment confirmed, Stripe events
- **Timing:** Immediate (within seconds)

### Manual (Admin-triggered)
- **How:** Admin runs endpoint manually
- **Endpoint:** `/api/admin/test-notifications`
- **Use Case:** Testing, one-off sends, manual interventions

---

## 🧪 Testing Messages

### Dry Run Mode (Shadow Mode)
Test what messages WOULD be sent without actually sending:

```bash
# Run all cron messages in dry run mode (logs only)
curl https://autopilotamerica.com/api/admin/test-notifications?dryRun=true

# View what would be sent
Visit: /admin/message-audit
Filter: external_message_id starts with "dryrun-"
```

### Populate Test Data
Create sample audit log entries:

```bash
# Create 8 sample messages
curl -X POST https://autopilotamerica.com/api/admin/test-audit-log
```

---

## 📈 Message States & Results

### Results (from audit log)
- **sent** - Successfully sent to provider (ClickSend/Resend)
- **skipped** - Not sent due to business logic (deduplication, preferences)
- **blocked** - User opted out or blocked
- **error** - Failed to send (API error, invalid contact info)
- **queued** - Queued for later delivery

### Common Skip Reasons
- `already_sent_48h` - Deduplication (message sent within 48h)
- `user_disabled_sms` - User disabled SMS in preferences
- `user_disabled_email` - User disabled email in preferences
- `missing_phone_number` - User has no phone on file
- `missing_email` - User has no email on file

---

## ✅ Adding a New Message Type

1. **Choose a key:** Follow naming convention
2. **Add to this doc:** Document trigger logic, template, code location
3. **Implement code:** Add to appropriate file (`lib/notifications-fixed.ts`, etc.)
4. **Add to audit logging:** Use `logMessageSent()`, `logMessageSkipped()`, etc.
5. **Test in dry run:** Run with `?dryRun=true` first
6. **Monitor:** Check `/admin/message-audit` for results

---

## 🎯 Current Message Count

- **Renewal Reminders:** 21 (7 × City Sticker, 7 × License Plate, 7 × Emissions)
- **Street Cleaning:** 3 (3-day, 1-day, today)
- **Registration:** 3 (profile needed, submitted, status update)
- **Payments:** 2 (purchased, subscription renewed)
- **Alerts:** 2 (payment failed, permit docs needed)

**Total:** 31 message types

---

## 🔗 Related Files

- **Notification Engine:** `lib/notifications-fixed.ts`
- **Message Audit Logger:** `lib/message-audit-logger.ts`
- **Audit Dashboard:** `pages/admin/message-audit.tsx`
- **Test Endpoint:** `pages/api/admin/test-notifications.ts`
- **Remitter Confirmation:** `pages/api/remitter/confirm-payment.ts`
- **Stripe Webhooks:** `pages/api/stripe-webhook.ts`

---

**This is your messaging bible. Every new message goes here first.**
