# Testing Guide - New Messaging Features

Complete guide to test all newly built features.

---

## 1. Remitter Email System

### Prerequisites
- Set `REMITTER_EMAIL` environment variable (or use default from code)
- Ensure `RESEND_API_KEY` is configured

### Test Steps

#### A. Check if there are pending renewals
```bash
# Check the database for pending renewals
curl https://autopilotamerica.com/api/remitter/pending-renewals
```

**Expected:** JSON with list of renewals where `payment_status='paid'` and `city_payment_status='pending'`

#### B. Send test remitter email
```bash
# Send to your email for testing
curl -X POST "https://autopilotamerica.com/api/admin/send-remitter-email?email=randy.vollrath@gmail.com"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Sent email with X pending renewals",
  "renewalCount": X,
  "sentTo": "randy.vollrath@gmail.com"
}
```

**Check your email:**
- Should receive HTML email with beautiful template
- Contains summary (X city stickers, Y license plates)
- Each renewal has user details, plate, VIN, address
- "Mark as Submitted" button for each renewal

#### C. Test one-click confirmation
1. Click "Mark as Submitted" button in email
2. Should open web form with renewal details
3. Enter fake confirmation number: `CHI-TEST-12345`
4. Click "Confirm Submission"
5. Should see success page
6. Check database - renewal should be marked as paid
7. Check user profile - expiry date should be updated to next year

#### D. Test already-confirmed flow
1. Click the same "Mark as Submitted" link again
2. Should show "Already Confirmed" page with details

---

## 2. Enhanced Admin Dashboard

### Test Steps

#### A. View the dashboard
```bash
# Open in browser (must be logged in as admin)
open https://autopilotamerica.com/admin/message-audit
```

**Visual Checks:**
- ✅ Gradient background (gray to blue)
- ✅ Modern stats cards with gradients
- ✅ Percentages shown on stats cards
- ✅ System health indicator in top-right (green/yellow/red)
- ✅ Hover effects on cards
- ✅ Beautiful table header with gradient

#### B. Test health indicator
1. Click the "System Healthy" (or Warning/Critical) badge
2. Should expand to show 4 health checks:
   - Error Rate
   - Message Volume
   - API Keys
   - Database
3. Each should show status, message, and details
4. Click again to collapse

#### C. Test filters
1. Filter by Result: Select "Sent" - should show only sent messages
2. Filter by Channel: Select "SMS" - should show only SMS
3. Filter by Date: Pick yesterday - should show yesterday's messages
4. Search: Type an email address - should filter to that user

#### D. Test refresh
1. Click "🔄 Refresh" button
2. Page should reload with latest data

---

## 3. Health & Reliability Checks

### Test Health Scenarios

#### A. Healthy System (Expected Current State)
**What to check:**
- Error rate: Should be 0% or very low (<5%)
- Message volume: Should have messages in last 24h (if cron is running)
- API keys: Both Resend and ClickSend should be configured
- Database: Should show "Database connection OK"
- Overall: Should be GREEN/Healthy

#### B. Simulate Warning State
**How to test:**
1. Temporarily remove one API key from env (e.g., remove `RESEND_API_KEY`)
2. Redeploy or restart
3. Visit dashboard
4. Health should be YELLOW/Warning
5. API Keys check should show "Some API keys missing"

#### C. Check Error Rate Monitoring
```bash
# If you have errors in the audit log, check the health
# Error rate >5% = Warning
# Error rate >10% = Critical
```

**To verify calculation:**
1. Look at stats cards: "Errors" count
2. Look at "Last 24h" count
3. Error rate = (Errors / Last24h) * 100%
4. Should match health check details

---

## 4. Email/Slack Daily Digest

### Test Steps

#### A. Test manual email digest
```bash
# Send to your email
curl -X POST "https://autopilotamerica.com/api/admin/send-daily-digest?email=randy.vollrath@gmail.com&useDefault=false"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Daily digest sent successfully via email",
  "emailSent": true,
  "slackSent": false
}
```

**Check your email:**
- Should receive "Daily Messaging Digest" email
- Beautiful header with gradient (blue to indigo)
- 4 colored stats cards (Sent, Skipped, Errors, Total)
- Full digest text in monospace font
- Link to admin dashboard
- If anomalies detected, they appear at bottom

#### B. Test Slack integration (if configured)
```bash
# First, set up a Slack incoming webhook
# https://api.slack.com/messaging/webhooks

# Add to Vercel env vars:
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Test sending to Slack
curl -X POST "https://autopilotamerica.com/api/admin/send-daily-digest?slack=https://hooks.slack.com/services/YOUR/WEBHOOK/URL&useDefault=false"
```

**Expected in Slack:**
- Message with title "📊 Daily Messaging Digest - [Date]"
- Stats in fields (Sent, Skipped, Errors, Total)
- Digest in code block
- Anomalies section if any detected
- "View Dashboard" button

#### C. Test default scheduled digest
```bash
# This uses ADMIN_EMAIL and SLACK_WEBHOOK_URL from env
curl -X POST https://autopilotamerica.com/api/admin/send-daily-digest
```

**Expected:**
- Sends to both email and Slack (if both configured)
- Uses ADMIN_EMAIL env var (or defaults to randy.vollrath@gmail.com)
- Includes anomaly detection

#### D. Test cron schedule
**The cron is configured to run daily at 2pm UTC (9am EST)**

To verify it's scheduled:
```bash
# Check vercel.json
cat vercel.json | grep -A 2 "send-daily-digest"
```

Should show:
```json
{
  "path": "/api/admin/send-daily-digest",
  "schedule": "0 14 * * *"
}
```

**To test cron:**
- Wait until 2pm UTC tomorrow
- Check your email for automatic digest
- Or check Vercel logs: `vercel logs --prod`

---

## 5. User Notification Preferences UI

### Test Steps

#### A. Access the preferences page
```bash
# Open in browser (must be logged in)
open https://autopilotamerica.com/notification-preferences
```

**Initial State:**
- Should show all defaults (most things enabled)
- Master toggle: ON
- SMS: ON
- Email: ON
- Voice: OFF
- Renewals: ON (with 60, 30, 7, 1 days selected)
- Street Cleaning: ON (24 hours before)
- Emergency: ON
- Payments: ON
- Quiet Hours: OFF

#### B. Test master toggle
1. Click master "Enable Notifications" toggle to OFF
2. All other toggles should become disabled (grayed out)
3. Click master toggle back to ON
4. Other toggles should become enabled again

#### C. Test channel toggles
1. Toggle SMS OFF
2. Toggle Email OFF
3. Toggle Voice ON
4. All should update visually with smooth transitions

#### D. Test renewal preferences
1. Click "60 days before" button - should deselect
2. Click "14 days before" button - should select
3. Selected buttons should be blue/white
4. Unselected buttons should be white/gray

#### E. Test street cleaning preferences
1. Open "Street Cleaning Hours Before" dropdown
2. Select "12 hours"
3. Should update the selected value

#### F. Test quiet hours
1. Toggle "Quiet Hours" ON
2. Time pickers should appear
3. Set start time: 10:00 PM
4. Set end time: 8:00 AM
5. Toggle OFF - time pickers should hide

#### G. Test save functionality
1. Make several changes
2. Click "💾 Save Preferences"
3. Button should show loading spinner: "Saving..."
4. After save, should show "✅ Saved!" with green button
5. Refresh the page
6. All your changes should persist

#### H. Test database persistence
```bash
# Check that preferences are saved in database
# (You'll need database access for this)

# In Supabase dashboard or psql:
SELECT notification_preferences
FROM user_profiles
WHERE email = 'your-email@example.com';
```

Should return JSON with your preferences.

---

## 6. Integration Testing

### Test Complete User Flow

#### Scenario: New user sets preferences and receives renewal notification

1. **Create test user** (or use existing)
   - Sign up at `/signup`
   - Complete profile with phone number
   - Set city sticker expiry to 30 days from now

2. **Set notification preferences**
   - Go to `/notification-preferences`
   - Enable SMS and Email
   - Select "30 days before" for renewals
   - Save preferences

3. **Trigger renewal notification** (manually)
   ```bash
   curl -X POST https://autopilotamerica.com/api/notifications/process
   ```

4. **Check audit log**
   - Go to `/admin/message-audit`
   - Should see new message logged for test user
   - Should show channel (SMS/Email)
   - Should show result (sent/skipped)

5. **Check user received notification**
   - Check SMS inbox (if SMS enabled)
   - Check email inbox (if Email enabled)
   - Message should mention "30 days" before renewal

---

## 7. Error Scenarios to Test

### A. Missing API Keys
```bash
# Remove RESEND_API_KEY from env
# Try to send digest
curl -X POST https://autopilotamerica.com/api/admin/send-daily-digest
```

**Expected:**
- Should fail gracefully
- Error message: "Email requested but RESEND_API_KEY not configured"

### B. Invalid Email Address
```bash
curl -X POST "https://autopilotamerica.com/api/admin/send-remitter-email?email=invalid-email"
```

**Expected:**
- Should return error from Resend API
- Should not crash

### C. Missing Renewal ID
```bash
# Try to confirm without ID
open https://autopilotamerica.com/api/remitter/confirm
```

**Expected:**
- HTML page showing "❌ Invalid Link"
- Message: "Missing renewal ID or type"

### D. Unauthenticated Access
```bash
# Try to access admin dashboard without login
# (Use incognito/private browser)
open https://autopilotamerica.com/admin/message-audit
```

**Expected:**
- Redirect to `/login?redirect=/admin/message-audit`

### E. Non-admin Access
```bash
# Log in as regular user (not randy.vollrath@gmail.com)
# Try to access admin dashboard
open https://autopilotamerica.com/admin/message-audit
```

**Expected:**
- Redirect to `/dashboard?error=unauthorized`

---

## 8. Performance Testing

### A. Large Dataset
If you have many messages in audit log:

```bash
# Test pagination/filtering
# Visit dashboard and apply filters
# Should load quickly even with 1000+ messages (limit is 100)
```

### B. Email with Many Renewals
```bash
# If you have 50+ pending renewals
curl -X POST https://autopilotamerica.com/api/admin/send-remitter-email
```

**Expected:**
- Should handle large emails (limit is 100 renewals)
- Email should render properly
- Should not timeout

---

## 9. Quick Smoke Test Checklist

If you just want to verify everything works:

- [ ] Admin dashboard loads and shows health status
- [ ] Click health badge - expands to show 4 checks
- [ ] Stats cards show numbers with percentages
- [ ] Can filter messages by result/channel/date
- [ ] Notification preferences page loads
- [ ] Can toggle preferences and save
- [ ] Send test remitter email - email arrives
- [ ] Click "Mark as Submitted" - form opens
- [ ] Enter confirmation number - success page shows
- [ ] Send test daily digest - email arrives with stats
- [ ] Digest email has gradient header and colored cards

---

## 10. Environment Variables Checklist

Make sure these are set in Vercel:

**Required:**
- ✅ `RESEND_API_KEY` - For sending emails
- ✅ `CLICKSEND_USERNAME` - For sending SMS
- ✅ `CLICKSEND_API_KEY` - For sending SMS
- ✅ `SUPABASE_URL` - Database connection
- ✅ `SUPABASE_ANON_KEY` - Database access
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Admin database access

**Optional:**
- `ADMIN_EMAIL` - Default admin email (defaults to randy.vollrath@gmail.com)
- `REMITTER_EMAIL` - Default remitter email
- `SLACK_WEBHOOK_URL` - For Slack digests
- `NEXT_PUBLIC_BASE_URL` - Base URL (defaults to https://autopilotamerica.com)

---

## 11. Troubleshooting

### Issue: Dashboard shows "System Critical"
**Solution:** Click health badge to see which check failed. Fix that component.

### Issue: Remitter email not sending
**Check:**
1. Is `RESEND_API_KEY` set?
2. Are there pending renewals? (Check `/api/remitter/pending-renewals`)
3. Check Vercel logs for errors

### Issue: Preferences not saving
**Check:**
1. Is user logged in?
2. Check browser console for errors
3. Check Supabase permissions on `user_profiles` table

### Issue: Daily digest not arriving
**Check:**
1. Is cron configured in `vercel.json`?
2. Is `ADMIN_EMAIL` set correctly?
3. Check Vercel logs at 2pm UTC
4. Try manual trigger to test

### Issue: Health checks show warning
**This is normal if:**
- No messages sent in last 24h (cron not run yet)
- One API key missing (if you only use email, not SMS)
- Just deployed (wait for first cron run)

---

## Next Steps After Testing

1. **Set up Slack webhook** (optional)
   - Create incoming webhook at https://api.slack.com/messaging/webhooks
   - Add `SLACK_WEBHOOK_URL` to Vercel env vars
   - Test: `curl -X POST https://autopilotamerica.com/api/admin/send-daily-digest`

2. **Monitor first cron run**
   - Wait until 2pm UTC tomorrow
   - Check email for daily digest
   - Check Vercel logs: `vercel logs --prod | grep send-daily-digest`

3. **Link notification preferences from dashboard**
   - Add a "Notification Settings" button in user dashboard
   - Link to `/notification-preferences`

4. **Document for remitters**
   - Send email to remitter explaining the workflow
   - Include sample email screenshot
   - Explain how to use "Mark as Submitted" button

5. **Set up monitoring**
   - Watch daily digests for anomalies
   - Check admin dashboard health indicator daily
   - Set up alerts if error rate goes above 10%

---

Happy Testing! 🚀
