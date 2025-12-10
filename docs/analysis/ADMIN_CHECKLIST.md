# Ticketless America - Admin Operations Checklist

## Overview
This document outlines all manual and automated tasks required to operate Ticketless America.

---

## 🤖 AUTOMATED Tasks (System Handles These)

### ✅ User Notifications (60, 45, 30, 21, 14 days before)
- **What:** System automatically sends email/SMS reminders to users about upcoming renewals
- **When:** Daily at 2 PM EST
- **How:** Cron job runs `/api/notifications/process`
- **Your Action:** None - this is fully automated

### ✅ Street Cleaning Alerts
- **What:** System sends alerts about street cleaning schedules
- **When:** Daily at 12 AM, 12 PM, and 8 PM EST
- **How:** Cron job runs `/api/street-cleaning/process`
- **Your Action:** None - this is fully automated

---

## 📋 MANUAL Tasks You Need to Do

### 1. **Purchase Stickers (CRITICAL)**
**When:** 30 days before expiry (you'll get an email)

**Email Notification:**
- You'll receive a daily email at 9 AM EST with all renewals due in 30 days
- Email subject: "🚨 X Renewals Due in 30 Days - Action Required"
- Lists all city stickers and license plates that need to be purchased

**Steps:**
1. Check your email every morning for the renewal notification
2. Purchase city stickers at: https://www.chicityclerk.com/citysticker
3. Purchase license plate stickers at: https://www.ilsos.gov
4. Use the user's information from the email (name, address, license plate, VIN)
5. Stickers will be mailed directly to the user's registered address

**Important:**
- Purchase stickers ~30 days before expiry to ensure delivery
- Double-check user information before purchasing
- Keep receipts for your records

---

### 2. **Send Sticker Purchase Notifications**
**When:** After you've purchased stickers for users

**Steps:**
1. Go to: https://ticketlessamerica.com/admin/profile-updates
2. Review the "Upcoming Renewals (Next 90 Days)" table
3. Check the boxes next to users whose stickers you've purchased
4. Click "Send Sticker Notifications"
5. Select which stickers you purchased:
   - ☑️ City Sticker
   - ☑️ License Plate Sticker
   - (or both)
6. Click "Send Notifications"

**What Happens:**
- Users receive email + SMS saying stickers are in the mail
- Green "✓ Notified" badge appears in the admin table
- System tracks which sticker types have been notified

**Pro Tip:**
- You can send notifications separately for city stickers and license plates
- Send city sticker notification when you buy it, then license plate later (or vice versa)

---

### 3. **Update Affiliate Commission Metadata (FIRST MONTH ONLY)**
**When:** When a referred user makes their first payment (annual or monthly)

**Why:** Rewardful doesn't automatically track the first month commission correctly

**Steps:**
1. Check Stripe for new customers with referral IDs
2. For each new referred customer:
   - Note their Stripe customer ID
   - Note the referral ID
   - Calculate expected commission:
     - Annual ($228): Commission = $45.60 (20%)
     - Monthly ($28): Commission = $5.60 (20%)
3. Update Stripe metadata manually:
   - Go to Stripe Dashboard → Customer
   - Add/update metadata fields:
     - `referral_id`: [the referral ID]
     - `commission_first_month`: [calculated amount]
4. Log this in your records for tracking

**Alternative (Automated Script):**
```bash
node scripts/update-stripe-commission-metadata.js
```

**Important:**
- Only need to do this for the FIRST payment from a referred user
- After the first month, Rewardful handles it automatically
- Keep a spreadsheet to track which customers you've already updated

---

### 4. **Monitor Profile Updates from SMS**
**When:** Daily as needed

**Steps:**
1. Go to: https://ticketlessamerica.com/admin/profile-updates
2. Check "Unprocessed" tab for new SMS messages from users
3. Review messages for profile updates (new address, VIN, plate number)
4. Click "Edit" to update user profile with new information
5. Click "Mark as Processed" when done

**Common Updates:**
- New address (moved)
- New VIN (bought a new car)
- New license plate number
- Changed expiry dates

---

### 5. **Handle User Account Issues**
**When:** As needed (user emails support)

**Common Issues:**
- Password resets → Point to login page
- Wrong vehicle info → Update in admin panel
- Missing stickers → Check mail status, resend if needed
- Billing questions → Check Stripe, update if needed

---

## 📊 Monitoring & Reports

### Daily Checks (5 minutes)
1. ✉️ Check 9 AM email for 30-day renewals
2. 📱 Review any new SMS profile updates
3. 💳 Check Stripe for new payments/failures

### Weekly Checks (15 minutes)
1. 📈 Review affiliate sales in admin panel
2. 🎫 Verify no tickets were issued to protected users
3. 💰 Confirm all commissions are tracking correctly

### Monthly Checks (30 minutes)
1. 📊 Review overall revenue in Stripe
2. 🔄 Check subscription renewal rates
3. 👥 Review user growth metrics
4. 🏆 Pay out affiliate commissions via Rewardful

---

## 🚨 Emergency Procedures

### User Got a Ticket Despite Having Service
1. Verify their profile info was correct
2. Check if sticker was purchased on time
3. Check mail delivery status
4. Offer to help contest ticket
5. Issue refund if service failed

### System Not Sending Notifications
1. Check Vercel cron logs
2. Verify email/SMS credits (Resend, ClickSend)
3. Test notification manually: `/api/notifications/test-run`
4. Check error logs in Vercel dashboard

### Payment Processing Issues
1. Check Stripe webhook status
2. Verify webhook secret is correct
3. Check for failed payments in Stripe
4. Reach out to affected users

---

## 📞 Support Contacts

- **Email:** support@ticketlessamerica.com
- **Admin Panel:** https://ticketlessamerica.com/admin/profile-updates
- **Stripe Dashboard:** https://dashboard.stripe.com
- **Vercel Dashboard:** https://vercel.com
- **Rewardful Dashboard:** https://rewardful.com

---

## 🎯 Quick Reference

### What's Automated ✅
- User renewal reminders (60, 45, 30, 21, 14 days)
- Street cleaning alerts
- Admin email at 9 AM for 30-day renewals
- Payment processing
- Subscription management

### What's Manual 📋
1. **Purchase stickers** (when notified at 30 days)
2. **Send "sticker purchased" notifications** (after buying)
3. **Update affiliate commission metadata** (first month only)
4. **Process profile updates from SMS** (as needed)
5. **Handle support issues** (as needed)

### Time Commitment
- Daily: ~5-10 minutes (check email, SMS updates)
- Weekly: ~15 minutes (review metrics)
- Monthly: ~30 minutes (payouts, reports)
- **Peak times:** When renewals are due (sticker purchasing)

---

*Last Updated: 2025-10-06*
