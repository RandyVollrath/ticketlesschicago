# Complete Notification Testing Guide

## 📋 All Notification Systems (14 Total)

### ✅ PURCHASE & ONBOARDING (2)

#### 1. Protection Purchase Confirmation ✅
**Trigger**: Immediately when Stripe webhook receives `checkout.session.completed`
**Location**: `pages/api/stripe-webhook.ts:430-488` (new users), `605-690` (existing users)
**Subject**: "Welcome to Autopilot America - Complete Your Profile"
**Content**: Magic link + welcome message + permit setup reminder (if applicable)

**Test**:
```bash
# 1. Sign up for Protection at /protection
# 2. Complete Stripe checkout with test card: 4242 4242 4242 4242
# 3. Check email for confirmation + magic link
```

**Expected**: Email sent within 30 seconds of payment

---

#### 2. Profile Completion Reminders (3-Day, 7-Day, 14-Day) ✅ NEW
**Trigger**: Daily at 10 AM CT
**Location**: `pages/api/cron/notify-incomplete-profiles.ts`
**Schedule**: 3, 7, and 14 days after Protection signup
**Criteria**: Missing city sticker date, license plate date, DL upload, or residency proof

**Test**:
```bash
# Create test user with incomplete profile
# Set created_at to 3 days ago
psql -c "UPDATE user_profiles SET created_at = NOW() - INTERVAL '3 days'
WHERE email = 'test@example.com'"

# Trigger cron
curl -X POST https://autopilotamerica.com/api/cron/notify-incomplete-profiles \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Expected Emails**:
- Day 3: "Quick Reminder: Complete Your Protection Profile"
- Day 7: "Your Protection Profile Needs Attention"
- Day 14: "🚨 Final Reminder: Complete Your Protection Profile"

---

### 🅿️ PERMIT & RESIDENCY PROOF (4)

#### 3. Email Forwarding Setup Reminders (2-Day, 5-Day, 10-Day) ✅ NEW
**Trigger**: Daily at 11 AM CT
**Location**: `pages/api/cron/notify-email-forwarding-setup.ts`
**Schedule**: 2, 5, and 10 days after Protection signup
**Criteria**: Permit user without email forwarding OR manual residency proof

**Test**:
```bash
# Create permit user without forwarding
psql -c "UPDATE user_profiles SET
  created_at = NOW() - INTERVAL '2 days',
  has_permit_zone = true,
  permit_requested = true,
  residency_forwarding_enabled = false,
  residency_proof_path = NULL
WHERE email = 'test@example.com'"

# Trigger cron
curl -X POST https://autopilotamerica.com/api/cron/notify-email-forwarding-setup \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Expected Emails**:
- Day 2: "Set Up Email Forwarding (2 Minutes)"
- Day 5: "Reminder: Email Forwarding Setup"
- Day 10: "📋 Final Reminder: Proof of Residency Setup"

---

#### 4. Missing Residency Proof Reminders (45-Day, 30-Day, 14-Day) ✅ NEW
**Trigger**: Daily at 9 AM CT
**Location**: `pages/api/cron/notify-missing-residency-proof.ts`
**Schedule**: 45, 30, and 14 days BEFORE city sticker renewal
**Criteria**: Permit user without email forwarding OR residency proof

**Test**:
```bash
# Create user with renewal in 30 days, no proof
psql -c "UPDATE user_profiles SET
  city_sticker_expiry = (NOW() + INTERVAL '30 days')::date,
  has_permit_zone = true,
  permit_requested = true,
  residency_forwarding_enabled = false,
  residency_proof_path = NULL
WHERE email = 'test@example.com'"

# Trigger cron
curl -X POST https://autopilotamerica.com/api/cron/notify-missing-residency-proof \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Expected Emails**:
- 45 days: "Action Needed: Set Up Proof of Residency"
- 30 days: "⏰ Reminder: Proof of Residency Needed"
- 14 days: "🚨 URGENT: Proof of Residency Needed in 2 Weeks"

---

#### 5. Missing Permit Documents (Admin Alert) ✅
**Trigger**: Daily at 8 AM CT
**Location**: `pages/api/cron/check-missing-permit-docs.ts`
**Audience**: ADMIN ONLY (not user-facing)
**Purpose**: Alert admin about users within 30 days of renewal without documents

**Test**:
```bash
curl -X POST https://autopilotamerica.com/api/cron/check-missing-permit-docs \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Expected**: Email to admin with list of users needing documents

---

### 📸 DRIVER'S LICENSE (2)

#### 6. Expiring Driver's License Reminders ✅
**Trigger**: Daily at 3 AM CT
**Location**: `pages/api/cron/notify-expiring-licenses.ts`
**Schedule**: When DL expires BEFORE next city sticker renewal (60+ days notice)
**Subject**: "🚨 Update Your Driver's License - City Sticker Renewal"

**Test**:
```bash
# Set license to expire before city sticker renewal
psql -c "UPDATE user_profiles SET
  license_valid_until = (NOW() + INTERVAL '65 days')::date,
  city_sticker_expiry = (NOW() + INTERVAL '90 days')::date,
  license_reuse_consent_given = true,
  has_protection = true
WHERE email = 'test@example.com'"

# Trigger cron
curl -X POST https://autopilotamerica.com/api/cron/notify-expiring-licenses \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Expected**: Email reminding user to upload new DL before renewal

---

#### 7. License Upload Confirmation
**Trigger**: When user uploads driver's license
**Location**: `pages/api/city-sticker/upload-driver-license.ts` (implied)
**Status**: ⚠️ CHECK IF EXISTS

**Test**:
```bash
# Upload license via settings page
# Check if confirmation email is sent
```

---

### 🚗 RENEWAL REMINDERS (3)

#### 8. City Sticker Renewal Reminders
**Trigger**: 30 days before city_sticker_expiry
**Location**: `pages/api/cron/process-all-renewals.ts` (renewal processing)
**Status**: ⚠️ CHECK IF REMINDER EMAIL EXISTS

**Test**:
```bash
# Set city sticker to expire in 30 days
psql -c "UPDATE user_profiles SET
  city_sticker_expiry = (NOW() + INTERVAL '30 days')::date,
  has_protection = true
WHERE email = 'test@example.com'"

# Trigger renewal processing
curl -X POST https://autopilotamerica.com/api/cron/process-all-renewals \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

#### 9. License Plate Renewal Reminders
**Trigger**: 30 days before license_plate_expiry
**Location**: `pages/api/cron/process-all-renewals.ts` (renewal processing)
**Status**: ⚠️ CHECK IF REMINDER EMAIL EXISTS

**Test**: Same as city sticker test above

---

#### 10. Renewal Payment Confirmation
**Trigger**: When renewal payment is processed
**Location**: Stripe webhook for renewal charges
**Status**: ⚠️ CHECK IF EXISTS

---

### 🎟️ TICKET NOTIFICATIONS (2)

#### 11. New Ticket Alert
**Trigger**: When new parking ticket detected
**Location**: `pages/api/cron/check-user-tickets.ts`
**Status**: ⚠️ CHECK IF EMAIL NOTIFICATION EXISTS

**Test**:
```bash
curl -X POST https://autopilotamerica.com/api/cron/check-user-tickets \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

#### 12. Ticket Reimbursement Status
**Trigger**: When ticket is submitted for reimbursement
**Location**: TBD
**Status**: ❌ NEEDS TO BE BUILT

---

### 🚨 STREET CLEANING (1)

#### 13. Street Cleaning Alerts
**Trigger**: Based on user's ward/section and notify_days_array
**Location**: MyStreetCleaning integration
**Status**: ✅ EXISTS (external system)

**Test**: Use MyStreetCleaning directly

---

### ❄️ WINTER BAN (1)

#### 14. Winter Ban Notifications
**Trigger**: When new Protection user signs up during winter (Dec 1 - Apr 1)
**Location**: `pages/api/stripe-webhook.ts` calls `lib/winter-ban-notifications.ts`
**Subject**: "❄️ Winter Parking Ban Alert - Your Address"

**Test**:
```bash
# Sign up for Protection with address on winter ban street
# Between Dec 1 - Apr 1
# Check email for winter ban notification
```

---

## 🧪 Quick Test Commands

### Test All Notification Crons (Development)
```bash
#!/bin/bash

# Set your cron secret
export CRON_SECRET="your_cron_secret_here"

echo "Testing all notification crons..."

# Profile completion reminders
curl -X POST http://localhost:3000/api/cron/notify-incomplete-profiles \
  -H "Authorization: Bearer $CRON_SECRET"

# Email forwarding setup
curl -X POST http://localhost:3000/api/cron/notify-email-forwarding-setup \
  -H "Authorization: Bearer $CRON_SECRET"

# Missing residency proof
curl -X POST http://localhost:3000/api/cron/notify-missing-residency-proof \
  -H "Authorization: Bearer $CRON_SECRET"

# Expiring driver's licenses
curl -X POST http://localhost:3000/api/cron/notify-expiring-licenses \
  -H "Authorization: Bearer $CRON_SECRET"

# Missing permit docs (admin alert)
curl -X POST http://localhost:3000/api/cron/check-missing-permit-docs \
  -H "Authorization: Bearer $CRON_SECRET"

echo "All tests triggered! Check logs and email."
```

### Test All Notification Crons (Production)
```bash
#!/bin/bash

export CRON_SECRET="your_production_cron_secret"

# Same commands but with production URL
curl -X POST https://autopilotamerica.com/api/cron/notify-incomplete-profiles \
  -H "Authorization: Bearer $CRON_SECRET"

# ... etc
```

---

## 📅 Notification Schedule (Vercel Cron)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/notify-expiring-licenses",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/check-missing-permit-docs",
      "schedule": "0 13 * * *"
    },
    {
      "path": "/api/cron/notify-missing-residency-proof",
      "schedule": "0 14 * * *"
    },
    {
      "path": "/api/cron/notify-incomplete-profiles",
      "schedule": "0 15 * * *"
    },
    {
      "path": "/api/cron/notify-email-forwarding-setup",
      "schedule": "0 16 * * *"
    }
  ]
}
```

**Times in UTC** (Central Time + 6 hours):
- 3 AM CT = 9 AM UTC (expiring licenses)
- 8 AM CT = 2 PM UTC (missing permit docs)
- 9 AM CT = 3 PM UTC (missing residency proof)
- 10 AM CT = 4 PM UTC (incomplete profiles)
- 11 AM CT = 5 PM UTC (email forwarding setup)

---

## ⚠️ Notifications That Need Review/Building

### HIGH PRIORITY
1. ❓ **Renewal Payment Confirmation** - Does this exist in webhook?
2. ❓ **City Sticker Renewal Reminder Email** - Check if exists in process-all-renewals
3. ❓ **License Plate Renewal Reminder Email** - Check if exists in process-all-renewals

### MEDIUM PRIORITY
4. ❌ **Ticket Reimbursement Status** - Needs to be built
5. ❓ **New Ticket Detection Email** - Check if exists in check-user-tickets
6. ❓ **License Upload Confirmation** - Check if exists

### LOW PRIORITY
7. ❓ **Password Reset Email** - Standard Supabase Auth (should exist)
8. ❓ **Email Verification** - Standard Supabase Auth (should exist)

---

## 🎯 Testing Best Practices

1. **Use Test Email Addresses**: Create `test+variant@autopilotamerica.com` addresses
2. **Test in Development First**: Use localhost before production
3. **Check Email Service Logs**: Monitor Resend dashboard for delivery
4. **Test Edge Cases**:
   - User with no email
   - User with invalid email
   - User who unsubscribed
5. **Test Timing**: Manually adjust database dates to trigger different reminders
6. **Check Spam Folders**: Ensure emails aren't marked as spam
7. **Test Email Rendering**: Check desktop + mobile rendering

---

## 📊 Notification Metrics to Track

- **Delivery Rate**: % of emails successfully delivered
- **Open Rate**: % of delivered emails opened
- **Click-Through Rate**: % of emails with link clicks
- **Conversion Rate**: % of users who complete action after email
- **Bounce Rate**: % of emails that bounce
- **Unsubscribe Rate**: % of users who unsubscribe

Monitor in Resend dashboard.

---

## 🔒 Security Notes

- All cron endpoints protected by `CRON_SECRET`
- Use environment variables for API keys
- Never expose user data in logs
- Comply with CAN-SPAM Act (unsubscribe links)
- Rate limit email sending to avoid spam flags

---

## 📝 Next Steps

1. Review the "⚠️ Notifications That Need Review/Building" section
2. Test all existing notifications with real test users
3. Add Vercel cron configuration for new notifications
4. Monitor email delivery and engagement metrics
5. Iterate on email copy based on user feedback
