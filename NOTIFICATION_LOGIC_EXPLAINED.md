# Notification Logic Explained

## 📨 How Renewal Notifications Work

### Overview

The system sends reminders for 3 types of renewals:
1. **City Sticker** (can be auto-purchased for Protection users)
2. **License Plate** (can be auto-purchased for Protection users)
3. **Emissions Test** (REMINDER ONLY - cannot be auto-purchased)

---

## 🎯 Notification Triggers

### Reminder Days

**Protection Users (has_protection = true):**
- 60 days before
- 45 days before
- 37 days before (1 week before charge)
- 30 days before (charge day)
- 14 days before (after purchase)
- 7 days before
- 1 day before

**Free Users (has_protection = false):**
- 30 days before
- 7 days before
- 1 day before

Users can customize their reminder days in settings.

---

## 📅 Message Timeline (Protection Users)

### City Sticker & License Plate (Auto-Purchasable)

#### 60, 45 days before expiry:
```
"Your City Sticker expires in X days. We'll charge your card on [DATE]
(30 days before expiration). Please confirm your profile is up-to-date."
```

#### 37 days before expiry (1 week before charge):
```
"Your City Sticker expires in 37 days. We'll charge your card in 7 days
(on [DATE]). This is your last reminder before charge day!"
```

#### 30 days before expiry (CHARGE DAY):
```
"We're charging your card TODAY for your City Sticker renewal
(expires in 30 days). Reply NOW if you have changes!"
```

#### 14-29 days before expiry (AFTER PURCHASE):
```
✅ "Good news! We already purchased your City Sticker.
Your sticker will arrive by mail within 10-14 days."
```

**This is the message you received!** It triggers when:
- You have Protection (`has_protection = true`)
- Your city sticker expiry is 14-29 days away
- The system assumes the purchase happened at the 30-day mark

#### 1-13 days before expiry (STICKER IN TRANSIT):
```
"Your City Sticker sticker should arrive soon (if it hasn't already).
We purchased it on [DATE] and it typically takes 10-14 days to arrive."
```

---

### Emissions Test (Reminder Only - CANNOT Auto-Purchase)

**ALL users (Free AND Protection)** get reminder messages:

#### 30, 7 days before:
```
"Your Emissions Test is due in X days.
Find test locations at illinoisveip.com."
```

#### 1 day before:
```
"Your Emissions Test is due TOMORROW. Schedule your test today."
```

#### Day of:
```
"Your Emissions Test is due TODAY.
Schedule your test now at illinoisveip.com."
```

**Emissions tests NEVER say "we already purchased" because:**
- Tests cannot be done remotely
- User must bring vehicle to testing facility
- Cannot be automated

---

## 🔍 Why Did You Get the "Already Purchased" Message?

### Trigger Conditions

You received: `"Good news! We already purchased your City Sticker"`

**This happens when ALL of these are true:**
1. ✅ `has_protection = true` (you have Protection plan)
2. ✅ `city_sticker_expiry` is 14-29 days from today
3. ✅ One of your reminder days falls in this 14-29 day range

### Example Timeline

Let's say your city sticker expires **December 15, 2025**:

| Date | Days Until | Message |
|------|------------|---------|
| Oct 16 | 60 days | "We'll charge on Nov 15" |
| Oct 31 | 45 days | "We'll charge on Nov 15" |
| Nov 8 | 37 days | "We'll charge in 7 days" |
| **Nov 15** | **30 days** | **"Charging your card TODAY"** |
| Nov 20 | 25 days | ✅ "We already purchased" |
| Nov 25 | 20 days | ✅ "We already purchased" |
| Nov 30 | 15 days | ✅ "We already purchased" |
| **Dec 1** | **14 days** | ✅ **"We already purchased"** |
| Dec 8 | 7 days | "Sticker should arrive soon" |
| Dec 14 | 1 day | "Sticker should arrive soon" |

**The 14-29 day window is the "post-purchase" notification range.**

---

## 🤔 What If You Didn't Actually Purchase the City Sticker?

### The Assumption

The notification assumes that **if you're a Protection user and your city sticker expires in 14-29 days, the purchase happened at the 30-day mark.**

### When This Could Be Wrong

1. **New Protection user** - Just signed up but sticker expires soon
2. **Failed payment** - Charge didn't go through at 30 days
3. **Skipped purchase** - Manual intervention or error
4. **Test account** - You're testing the system

### How to Fix

**Option 1: Check if purchase actually happened**
- Look for a charge from 30 days before expiry
- Check renewal_payments table for city sticker purchase
- If no purchase, the message is incorrect

**Option 2: Update the logic to check actual purchase**

Instead of assuming based on days, we could check:
```typescript
// Check if city sticker was actually purchased
const { data: payment } = await supabase
  .from('renewal_payments')
  .select('*')
  .eq('user_id', user.user_id)
  .eq('renewal_type', 'city_sticker')
  .eq('status', 'completed')
  .gte('created_at', purchaseWindowStart)
  .lte('created_at', purchaseWindowEnd)
  .single();

if (payment) {
  message = "We already purchased your city sticker";
} else {
  message = "We'll purchase your city sticker when there are 30 days left";
}
```

---

## 🛠️ Customization

Users can customize reminder days in their notification preferences:

```typescript
notification_preferences: {
  reminder_days: [60, 45, 37, 30, 14, 7, 1],
  sms: true,
  email: true,
  voice: false
}
```

**For Protection users**, 60, 45, and 37 are mandatory until profile is confirmed.

---

## 📊 Notification Channels

### SMS
- Short, actionable messages
- Includes "Reply STOP to opt out"
- Limited to 160 characters (broken into segments if longer)

### Email
- Detailed HTML emails
- Includes buttons to confirm profile or update settings
- Shows full timeline and instructions

### Voice (Optional)
- Automated voice call
- Simple reminder of due date
- Only if user enables voice notifications

---

## 🚨 Edge Cases

### What if sticker arrives late?

The 10-14 day delivery window is an estimate. If delivery takes longer:
- User gets "should arrive soon" messages even if it hasn't arrived
- This is expected - just a reminder that we're waiting on mail delivery

### What if user changes their renewal date?

If a user updates their `city_sticker_expiry` date:
- Next cron run will recalculate days until expiry
- Messages will adjust to new timeline
- No duplicate notifications (notifications are sent based on current date math)

### What if notification runs multiple times in one day?

The notification cron should run ONCE per day. If it runs multiple times:
- Users would get duplicate messages (not ideal)
- **Solution**: Add a `sent_at` tracking table to prevent duplicates

---

## 🔧 Testing Notifications

### Manual Test Script

```bash
node check-notification-logic.js
```

This shows what message would be sent for different scenarios.

### Force Test Notification

```bash
curl -X POST https://autopilotamerica.com/api/notifications/force-test \
  -H "Content-Type: application/json" \
  -d '{"user_id": "your-user-id"}'
```

### Check Notification History

Query the `audit_logs` table:
```sql
SELECT * FROM audit_logs
WHERE user_id = 'your-user-id'
  AND action_type LIKE '%notification%'
ORDER BY created_at DESC
LIMIT 10;
```

---

## 📝 Summary

**City Sticker "Already Purchased" Message:**
- ✅ Correct for Protection users 14-29 days before expiry
- ✅ Assumes purchase happened at 30-day mark
- ⚠️ Could be wrong if purchase failed or user is new

**Emissions Test Messages:**
- ✅ Now fixed to NEVER say "already purchased"
- ✅ Always reminder-only (user must schedule test themselves)
- ✅ Protection users get same messages as free users for emissions

**Next Steps:**
1. Verify actual purchase happened (check payment records)
2. If no purchase, investigate why charge didn't process
3. Consider updating logic to check actual purchase status instead of assuming based on days
