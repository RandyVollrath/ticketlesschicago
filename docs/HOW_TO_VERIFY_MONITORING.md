# How to Verify Webhook Monitoring is Working

## 🎯 Quick Answer

You have **3 ways** to know the health checks are running:

### 1. **Visual Dashboard** (Easiest)
Visit: **https://www.ticketlesschicago.com/admin/webhook-health**

Shows:
- ✅ Current health status
- 📊 Uptime percentage
- 📅 History of all checks
- ⚠️ Recent failures (if any)
- 📧 Which alerts were sent

### 2. **API Endpoint** (For Scripts)
```bash
curl https://www.ticketlesschicago.com/api/admin/webhook-health-status | jq
```

Returns JSON with all stats and history.

### 3. **Email Alerts** (Only on Failure)
- You get an email ONLY if something fails
- "No email = everything is working"

---

## 📋 Step-by-Step Setup

### Step 1: Run Database Migration

Go to Supabase SQL Editor:
https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql

Run this SQL:
```sql
CREATE TABLE IF NOT EXISTS webhook_health_checks (
  id SERIAL PRIMARY KEY,
  webhook_name TEXT NOT NULL,
  check_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  overall_status TEXT NOT NULL,
  check_results JSONB NOT NULL,
  alert_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_health_checks_webhook_name
  ON webhook_health_checks(webhook_name, check_time DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_health_checks_status
  ON webhook_health_checks(overall_status, check_time DESC);

GRANT SELECT, INSERT ON webhook_health_checks TO authenticated;
GRANT SELECT, INSERT ON webhook_health_checks TO anon;
```

### Step 2: Wait for Deployment

The code will deploy automatically to Vercel in ~1 minute.

### Step 3: Test Manually (Don't Wait for Daily Cron)

Trigger the health check immediately:
```bash
curl https://www.ticketlesschicago.com/api/cron/monitor-utility-bills-webhook
```

This runs the same check that will run daily at 8am CT.

### Step 4: View Results

Visit: **https://www.ticketlesschicago.com/admin/webhook-health**

You should see:
- ✅ Green card showing "Healthy"
- 100% uptime
- 1 check completed
- Timestamp of when you ran the manual test

---

## 📊 What the Dashboard Shows

### Current Status Card
```
✅ Healthy
Last checked: Nov 13, 2025, 12:30 PM
```
OR
```
❌ Unhealthy
Last checked: Nov 13, 2025, 12:30 PM
```

### Stats
- **Uptime %** - Percentage of checks that passed
- **Total Checks** - Number of times health check ran
- **Alerts Sent** - How many failure emails were sent

### Recent Failures
Only shows if there were failures. Lists:
- When it failed
- What checks failed (storage, database, API key, etc.)
- Whether an alert email was sent

### Check History
Timeline of all health checks with:
- ✅ or ❌ status
- Timestamp
- Whether alert was sent

---

## 🔄 Monitoring Schedule

### Automatic Checks
- **Frequency:** Daily at 8am CT (14:00 UTC)
- **Vercel Cron:** `/api/cron/monitor-utility-bills-webhook`
- **Configured in:** `vercel.json` line 113-115

### What Gets Checked
1. Supabase connection works
2. Storage bucket `residency-proofs-temps` exists
3. Database table `user_profiles` accessible
4. Resend API key configured
5. Webhook URL documented correctly

### What Happens on Failure
1. Health check detects problem
2. Result logged to database
3. **Email sent to:** `randyvollrath@gmail.com`
4. Email contains:
   - What failed
   - Error messages
   - Links to check Resend/Vercel dashboards
5. Dashboard shows red ❌ status

### What Happens on Success
1. Health check passes
2. Result logged to database
3. **NO EMAIL SENT** (quiet success)
4. Dashboard shows green ✅ status

---

## ✅ How to Verify It's All Working

### Test 1: Manual Health Check
```bash
curl https://www.ticketlesschicago.com/api/cron/monitor-utility-bills-webhook
```

Should return:
```json
{
  "success": true,
  "health_status": "healthy",
  "checks_run": 5,
  "alert_sent": false
}
```

### Test 2: Check Database Has Result
```bash
curl https://www.ticketlesschicago.com/api/admin/webhook-health-status
```

Should show:
```json
{
  "current_status": "healthy",
  "stats": {
    "total_checks": 1,
    "healthy_checks": 1,
    "uptime_percentage": "100.00"
  }
}
```

### Test 3: View Dashboard
Visit: https://www.ticketlesschicago.com/admin/webhook-health

Should show:
- Green ✅ status card
- 100% uptime
- At least 1 check in history
- No recent failures

---

## 🚨 Troubleshooting

### "Dashboard shows no data"
1. Run the database migration (Step 1 above)
2. Trigger manual health check
3. Refresh dashboard

### "Dashboard shows 0 checks"
The cron hasn't run yet (it runs daily at 8am CT).

**Solution:** Trigger manually:
```bash
curl https://www.ticketlesschicago.com/api/cron/monitor-utility-bills-webhook
```

### "I want to test failure alerts"
You can simulate a failure by temporarily breaking something:

1. Rename the storage bucket in Supabase (residency-proofs-temps → test)
2. Run manual health check
3. Check email for alert
4. View dashboard - should show red ❌
5. Rename bucket back
6. Run health check again - should be green ✅

**WARNING:** Don't do this in production if users are actively using the feature!

---

## 📧 Email Alert Example

When something fails, you'll receive:

```
Subject: 🚨 Utility Bills Webhook Health Check Failed

Status: unhealthy
Time: 2025-11-13T14:00:00.000Z

Failed Checks:
- storage_bucket: Bucket 'residency-proofs-temps' not found

All Check Results:
{
  "storage_bucket": {
    "status": "error",
    "message": "Bucket not found"
  },
  "database": { "status": "ok" },
  "resend_api_key": { "status": "ok" }
}

View Health Check: https://www.ticketlesschicago.com/api/health/utility-bills
Check Resend Webhooks: https://resend.com/webhooks
```

---

## 📱 Mobile/Slack Integration (Optional Future)

For even faster alerts, you could:

1. **Add Slack webhook** to the monitoring cron
2. **Use email-to-SMS gateway** (like email@txt.att.net)
3. **Integrate with PagerDuty/Opsgenie**

Would you like me to set any of these up?

---

## Summary

✅ **Health checks run:** Daily at 8am CT
✅ **Results stored:** In database table `webhook_health_checks`
✅ **View results:** https://www.ticketlesschicago.com/admin/webhook-health
✅ **Get alerted:** Email on failures only
✅ **Test anytime:** `curl .../api/cron/monitor-utility-bills-webhook`

**You'll always know if something breaks within 24 hours!** 🎉
