# Admin Panel Testing Guide

## How to Access Admin Panel

Go to: `https://ticketless-chicago.vercel.app/admin/profile-updates`

You'll be auto-redirected to the admin panel if you're logged in as:
- randyvollrath@gmail.com
- carenvollrath@gmail.com

---

## 🎫 Testing Reimbursement System

### Test 1: Submit a Ticket (As Protection User)

**You'll need a test Protection user:**
1. Sign up at `/protection` and complete checkout (use Stripe test mode)
2. Go to `/settings` and click "Submit Ticket"
3. Fill out the form:
   - Ticket Type: Street Cleaning
   - Date: Today's date
   - Amount: $65.00
   - Address: 123 Main St, Chicago
   - Upload front/back photos (any images work)
   - Payment Method: Venmo
   - Venmo handle: @testuser

**Expected Results:**
- ✅ Form submits successfully
- ✅ Email sent to admin with ticket details
- ✅ Shows remaining coverage ($200 - $0 = $200 remaining)

### Test 2: Review Ticket in Admin Panel

Go to `/admin/profile-updates` and scroll to "🎫 Ticket Reimbursement Requests"

**Expected to see:**
- Yellow banner: "⏳ 1 pending request"
- Red background card with ticket details
- Ticket info: type, date, amount ($65), expected reimbursement ($52)
- "Coverage Remaining: $200 / $200"
- Payment info: Venmo: @testuser
- "View Front Photo" and "View Back Photo" buttons

### Test 3: Approve Reimbursement

Click "Approve" button on the pending ticket

**What happens:**
1. Prompt asks for reimbursement amount (suggests $52.00)
2. Enter custom amount or use suggested
3. Prompt asks for admin notes (optional)
4. Card turns green background
5. Status changes to "APPROVED"
6. Shows approved amount and payment details
7. New button: "Mark as Paid"

### Test 4: Mark as Paid

Click "Mark as Paid" button

**Expected:**
- Card turns light green
- Status changes to "PAID"
- Shows "✅ Paid $52.00 on [date]"
- No action buttons (completed)

### Test 5: Submit Second Ticket (Coverage Limit)

Submit another ticket for $200

**Expected:**
- System shows remaining coverage: $148 / $200
- Admin panel shows total reimbursed this year
- Warning if trying to exceed $200 limit

### Test 6: Deny a Ticket

Submit a ticket and click "Deny" in admin panel

**Expected:**
- Prompt for denial reason
- Status changes to "DENIED"
- Gray background
- Shows admin notes with denial reason

---

## 💰 Testing Affiliate Commission Tracking

### Test 1: Simulate Affiliate Sale

**To create an affiliate sale:**
1. Go to `/protection` in incognito/private window
2. Open browser console and run:
   ```javascript
   window.Rewardful = { referral: 'test-referral-123' }
   ```
3. Complete Protection checkout

**Expected Results:**
- ✅ Email sent to admin about affiliate sale
- ✅ New entry appears in admin panel "💰 Affiliate Commission Tracker"
- 🚨 Big RED banner: "X Commissions Need Manual Adjustment"
- Red background row with commission details
- Warning icon ⚠️ next to commission amount

### Test 2: Mark Commission as Adjusted

Find the affiliate sale in admin panel and **check the checkbox** in the first column

**Expected:**
- Checkbox becomes checked ✅
- Row background turns GREEN
- Red banner updates (or disappears if this was the only one)
- Warning icon ⚠️ disappears
- Hover over checkbox shows: "Adjusted by [your-email] on [date]"

### Test 3: Test Checkbox Persistence (Multi-Admin)

**What this tests:** Both admins see the same checkbox state

1. Admin 1 (randyvollrath@gmail.com) checks a commission box
2. Admin 2 (carenvollrath@gmail.com) refreshes the page
3. **Expected:** Admin 2 sees the checkbox as checked (shared state)

### Test 4: Check Email Notification

After an affiliate sale, check your email

**Expected email content:**
- Subject: "🎉 Affiliate Sale - Manual Commission Adjustment Needed"
- Customer email
- Plan type (monthly/annual)
- Total charge amount
- Expected commission ($2.40 or $24)
- Actual commission Rewardful will calculate (~$53.40 or more)
- Link to Rewardful dashboard

---

## 📅 Testing Upcoming Renewals Section

### Test 1: View Upcoming Renewals

Scroll to "📅 Upcoming Renewals (Next 90 Days)" in admin panel

**Expected:**
- Table of users with renewals coming up
- Checkbox column for bulk selection
- Shows: Name, Email, License Plate, Expiry Dates, Protection status
- Color-coded days until expiry

### Test 2: Select Users for Notification

1. Check boxes for 2-3 users
2. Click "Send Sticker Notifications (X selected)"
3. Modal opens with sticker type options

**Expected:**
- Can select City Sticker and/or License Plate
- Send button triggers notifications
- Success message appears

---

## 📱 Testing Profile Update Messages

### Test 1: View SMS Replies

Scroll to bottom section with tabs: "Unprocessed" / "All Messages"

**Expected:**
- Shows incoming SMS from users
- Each message shows user info, phone number, message content
- Edit button to update user profile
- "Mark as Processed" button

### Test 2: Edit User Profile from Message

Click "Edit" on a message with profile update info

**Expected:**
- Form expands showing user's current info
- Can update: license plate, VIN, address, expiry dates
- Save button updates profile
- Message can be marked as processed

---

## 🐛 Common Issues to Check

### Issue: Admin Panel Blank or Not Loading
**Solution:** Make sure you're logged in with an admin email (randyvollrath@gmail.com or carenvollrath@gmail.com)

### Issue: No Reimbursement Requests Showing
**Solution:** Test user must have Protection plan active AND submit via `/submit-ticket`

### Issue: Storage Upload Fails
**Solution:** Verify Supabase storage bucket `ticket-photos` exists with RLS policies

### Issue: Commission Checkbox Not Saving
**Solution:** Check browser console for errors, verify database table exists

### Issue: Email Notifications Not Received
**Solution:**
- Check spam folder
- Verify RESEND_API_KEY is set in Vercel environment variables
- Check Vercel deployment logs

---

## 📊 Quick Test Checklist

- [ ] Can access admin panel at `/admin/profile-updates`
- [ ] Reimbursement section loads
- [ ] Commission tracker section loads
- [ ] Renewals section loads
- [ ] SMS messages section loads
- [ ] Can submit test reimbursement ticket
- [ ] Receive email for new ticket submission
- [ ] Can approve/deny tickets in admin panel
- [ ] Can mark tickets as paid
- [ ] Commission checkboxes work
- [ ] Commission checkboxes persist across refreshes
- [ ] Receive email for affiliate sales
- [ ] Map shows RED zones for cleaning today
- [ ] Alternative parking list shows "🚨 Street cleaning TODAY" in red

---

## 🎯 Success Criteria

**System is working correctly if:**
1. ✅ Protected route works (non-admins can't access)
2. ✅ All 4 main sections load without errors
3. ✅ Email notifications sent for both reimbursements and commissions
4. ✅ Checkboxes persist and sync across admin users
5. ✅ Status updates work (pending → approved → paid)
6. ✅ Coverage tracking shows correct amounts
7. ✅ Red warnings appear for unadjusted commissions
8. ✅ Maps show red for zones with cleaning today
9. ✅ Photos can be uploaded and viewed
10. ✅ Payment method details captured correctly
