# Notification Flow Analysis

## Overview

This document maps all notification flows in Autopilot America, identifying when notifications are sent, to whom, and for what purpose.

---

## 1. STREET CLEANING NOTIFICATIONS

**Cron Job:** `/api/street-cleaning/process.ts`
**Schedule:** Runs hourly, but only sends at specific Chicago times:
- **7:00 AM** - Morning reminder
- **3:00 PM** - Follow-up reminder
- **7:00 PM** - Evening reminder (for next-day cleaning)

**Recipients:** Users who have:
- `home_address_ward` and `home_address_section` set
- `notify_sms = true`
- Not snoozed (`snooze_until_date` is null or past)
- Street cleaning scheduled in their ward/section

**Notification Channels:**
- SMS (primary)
- Email (if enabled)
- Phone call (if `phone_call_enabled = true`)

**User Preferences:**
- `notify_days_array` - Which days in advance to notify (e.g., [0, 1, 2, 3])
- `notify_evening_before` - Get evening alert the night before
- `phone_call_time_preference` - When to receive voice calls

---

## 2. SNOW BAN NOTIFICATIONS

**Cron Job:** `/api/cron/monitor-snow.ts`
**Trigger:** Weather API detects snow conditions

**Recipients:** All users with addresses in affected areas

**Notification Channels:**
- SMS
- Email
- Phone call (for urgent situations)

---

## 3. REGISTRATION RENEWAL NOTIFICATIONS

### For FREE ALERT Users:
**Purpose:** Simple reminder to renew themselves

**Schedule:** Notifications at these intervals before expiration:
- 60 days
- 45 days
- 30 days
- 21 days
- 14 days
- 7 days (if still not renewed)
- 1 day (emergency)
- Day of (emergency)

**Content:**
- Reminder that renewal is due
- Link to renew online
- Tip about how to renew
- Upsell to Protection plan

### For PAID PROTECTION Users:
**Purpose:** Confirm profile is up to date before we purchase on their behalf

**Schedule:** Same intervals, but different content:
- 60 days: "Renewal coming up - we'll handle it"
- 45 days: "Reminder - let us know if anything changed"
- 30 days: "We'll purchase in ~2 weeks - confirm your info"
- 21 days: "Purchasing in 7 days - last chance to update"
- 14 days: "Purchasing TODAY - reply NOW if info changed"

**Required Actions from User:**
1. Confirm VIN is current (no new vehicle)
2. Confirm license plate is current
3. Confirm mailing address is current
4. Upload permit zone documents (if applicable)

**If user has permit zone (`has_permit_zone = true`):**
- Additional reminder to upload:
  - Driver's license (front + back)
  - Proof of residency

---

## 4. EMISSIONS TEST NOTIFICATIONS

**Critical Logic:** Illinois requires valid emissions test to renew license plates.

**Current State:**
- `emissions_date` - When emissions test is due
- `emissions_completed` - Whether user has done the test

**Issue:** If emissions not completed, license plate renewal CANNOT proceed.

**Notification Flow:**
1. Check `emissions_date` against plate expiry
2. If emissions required and not completed:
   - Block license plate renewal processing
   - Send urgent emissions reminder
3. Mark renewal as `blocked` with reason `emissions_required`

**Proposed Enhancement:**
- Send emissions reminders at: 90, 60, 45, 30, 14, 7 days before emissions deadline
- More frequent as deadline approaches
- Provide list of testing locations
- Offer to schedule appointment (future feature)

---

## 5. POST-RENEWAL NOTIFICATIONS

### When Payment Processed:
**Email to Customer:**
- Confirmation of charge
- Amount charged
- What happens next
- Timeline for sticker delivery

**Email to Remitter:**
- New order notification
- Customer details
- Payment received amount
- Instructions to process

### When Sticker Shipped:
**TODO - Not yet implemented**
- Notification that sticker was purchased
- Expected delivery timeframe (10 days)
- Reminder to put sticker on car

### When Sticker Should Be Applied:
**TODO - Not yet implemented**
- Follow-up 10-14 days after purchase
- "Did you receive and apply your sticker?"
- Link to report issues

---

## 6. PROFILE COMPLETION NOTIFICATIONS

**Cron Job:** `/api/cron/notify-incomplete-profiles.ts`

**Recipients:** Users with incomplete profiles

**Checks for:**
- Missing phone number
- Missing address
- Missing vehicle info
- Missing renewal dates

---

## 7. PERMIT ZONE DOCUMENT NOTIFICATIONS

**Cron Jobs:**
- `/api/cron/notify-missing-residency-proof.ts`
- `/api/cron/check-missing-permit-docs.ts`

**Recipients:** Users with `has_permit_zone = true` who haven't uploaded required documents

---

## GAPS IDENTIFIED

### 1. Emissions Test Reminders
**Current:** Only blocks renewal when emissions not done
**Needed:** Proactive reminders starting 90 days out

### 2. "Profile Confirmed" Tracking
**Current:** No way to know if user confirmed their profile is up to date
**Needed:**
- `profile_confirmed_at` timestamp
- `profile_confirmed_for_renewal_year` to track which renewal cycle
- Stop sending "confirm your info" notifications once confirmed

### 3. Sticker Shipped/Delivered Notifications
**Current:** None
**Needed:**
- "Your sticker was purchased" notification
- "Expect delivery in ~10 days" message
- "Did you receive your sticker?" follow-up

### 4. "Apply Your Sticker" Reminder
**Current:** None
**Needed:**
- Reminder 10-14 days after purchase
- "Make sure to put the new sticker on your windshield"
- Prevent tickets for expired sticker when new one is sitting at home

### 5. Notification Throttling
**Current:** Users might get multiple notifications in same day
**Needed:**
- Track all notifications sent per user per day
- Limit to reasonable number (e.g., max 3 per day)
- Consolidate when possible

### 6. Notification Preferences Granularity
**Current:** Basic on/off toggles
**Needed:**
- Separate controls for each notification type
- Quiet hours setting
- Channel preference by notification type

---

## RECOMMENDED NOTIFICATION SCHEDULE

### City Sticker (Protection Users):
| Days Before Expiry | Action | Content |
|-------------------|--------|---------|
| 60 | Reminder | "Renewal coming up, we'll handle it" |
| 45 | Reminder | "Please confirm your info is current" |
| 30 | Action Required | "Confirm profile + upload docs if permit zone" |
| 21 | Urgent | "Purchasing in 7 days - reply NOW if changes" |
| 14 | PURCHASE | Auto-charge and submit to remitter |
| 10 | Confirmation | "Your sticker was purchased, arrives in ~10 days" |
| 0 | Follow-up | "Did you apply your new sticker?" |

### City Sticker (Free Users):
| Days Before Expiry | Action | Content |
|-------------------|--------|---------|
| 60 | Reminder | "Your sticker expires in 60 days" |
| 45 | Reminder | "Your sticker expires in 45 days" |
| 30 | Reminder | "Your sticker expires in 30 days - renew soon" |
| 14 | Urgent | "Your sticker expires in 2 weeks!" |
| 7 | Urgent | "Your sticker expires in 1 week!" |
| 1 | Emergency | "Your sticker expires TOMORROW!" |
| 0 | Emergency | "Your sticker expires TODAY!" |

### Emissions Test (All Users):
| Days Before Test Due | Action | Content |
|---------------------|--------|---------|
| 90 | Reminder | "Emissions test due in 3 months" |
| 60 | Reminder | "Emissions test due in 2 months" |
| 45 | Reminder | "Schedule your emissions test soon" |
| 30 | Action | "Emissions test due in 30 days - find a location" |
| 14 | Urgent | "Emissions test due in 2 weeks!" |
| 7 | Urgent | "Emissions test due in 1 week - must complete before plate renewal" |
| 0 | Emergency | "Emissions test due TODAY!" |

---

## IMPLEMENTATION PRIORITIES

1. **Add `profile_confirmed_at` field** - Stop notifications once user confirms
2. **Post-purchase notifications** - "Sticker purchased" and "apply your sticker"
3. **Emissions test reminder system** - Proactive reminders
4. **Notification throttling** - Don't overwhelm users
5. **Better tracking/logging** - Know exactly what was sent when

---

## DATABASE CHANGES NEEDED

```sql
-- Add profile confirmation tracking
ALTER TABLE user_profiles ADD COLUMN profile_confirmed_at TIMESTAMP;
ALTER TABLE user_profiles ADD COLUMN profile_confirmed_for_year INTEGER;

-- Add notification tracking
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL, -- 'sms', 'email', 'voice'
  sent_at TIMESTAMP DEFAULT NOW(),
  message_key TEXT, -- For deduplication
  metadata JSONB
);

-- Add renewal status tracking
ALTER TABLE user_profiles ADD COLUMN renewal_status TEXT; -- 'pending', 'confirmed', 'purchased', 'shipped', 'applied'
ALTER TABLE user_profiles ADD COLUMN sticker_purchased_at TIMESTAMP;
ALTER TABLE user_profiles ADD COLUMN sticker_expected_delivery DATE;
```
