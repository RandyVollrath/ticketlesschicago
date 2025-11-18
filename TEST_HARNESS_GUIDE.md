# Test Harness & Monitoring Guide

**Complete guide to automated testing and monitoring for the messaging system**

---

## 🧪 Test Harness

The test harness generates fake users and runs automated scenarios to verify messaging logic works correctly.

### What It Does

- ✅ Generates 10 fake test users in various states
- ✅ Runs scenarios to test all message paths
- ✅ Verifies expected messages were sent/skipped
- ✅ Supports dry run mode (safe testing)
- ✅ Auto-cleanup of test data

### Test Scenarios Covered

1. **renewal_30_days_protection** - Protection user, City Sticker due in 30 days
2. **renewal_30_days_free** - Free user, City Sticker due in 30 days
3. **renewal_14_days_post_purchase** - Protection user, 14 days (post-purchase window)
4. **permit_zone_60_days** - Protection + Permit zone, 60 days
5. **license_plate_7_days** - License Plate renewal, 7 days
6. **emissions_test_1_day** - Emissions test due tomorrow
7. **missing_phone_number** - User with no phone (should skip SMS)
8. **sms_disabled** - User disabled SMS in preferences
9. **multiple_renewals** - User with multiple renewals due simultaneously
10. **deduplication_test** - Tests 48h deduplication works

---

## 📋 How To Use The Test Harness

### Step 1: Generate Test Users

```bash
curl -X POST https://autopilotamerica.com/api/admin/test-harness?action=generate
```

**Response:**
```json
{
  "success": true,
  "message": "Generated 10 test users",
  "userIds": ["uuid1", "uuid2", ...],
  "instructions": {
    "next_step": "Run scenarios with: POST /api/admin/test-harness?action=runAll&dryRun=true",
    "view_users": "SELECT * FROM user_profiles WHERE email LIKE '%@autopilottest.com'",
    "cleanup": "POST /api/admin/test-harness?action=cleanup"
  }
}
```

**What this creates:**
- 10 test users with emails like `test-protection-30d@autopilottest.com`
- Various renewal dates (30 days, 14 days, 7 days, 1 day, 60 days)
- Different user states (Protection vs Free, permit zone, preferences)
- All marked with `metadata.is_test_user = true`

---

### Step 2: Run All Scenarios (Dry Run)

```bash
curl -X POST "https://autopilotamerica.com/api/admin/test-harness?action=runAll&dryRun=true"
```

**Response:**
```json
{
  "success": true,
  "mode": "dry_run",
  "summary": {
    "total_scenarios": 10,
    "total_processed": 20,
    "total_sent": 18,
    "total_skipped": 2,
    "total_errors": 0
  },
  "scenarios": [
    {
      "success": true,
      "scenario": "renewal_30_days_protection",
      "messagesProcessed": 2,
      "messagesSent": 2,
      "messagesSkipped": 0,
      "errors": []
    },
    ...
  ]
}
```

**What this does:**
- Runs notification scheduler in DRY RUN mode
- Processes all test users
- Logs messages but DOESN'T actually send
- All messages visible in `/admin/message-audit` with `[DRY RUN]` prefix

---

### Step 3: Verify Results

```bash
# Verify a specific scenario
curl "https://autopilotamerica.com/api/admin/test-harness?action=verify&scenario=renewal_30_days_protection"
```

**Response:**
```json
{
  "scenario": "renewal_30_days_protection",
  "passed": true,
  "issues": [],
  "message": "✅ All expectations met"
}
```

**Or check manually:**
1. Visit `/admin/message-audit`
2. Filter by email: `test-protection-30d@autopilottest.com`
3. Verify correct messages were logged

---

### Step 4: Run Individual Scenario

```bash
# Run just one scenario
curl -X POST "https://autopilotamerica.com/api/admin/test-harness?action=run&scenario=missing_phone_number&dryRun=true"
```

---

### Step 5: Cleanup Test Data

```bash
curl -X POST https://autopilotamerica.com/api/admin/test-harness?action=cleanup
```

**Response:**
```json
{
  "success": true,
  "message": "Deleted 10 test users",
  "deletedCount": 10
}
```

**What this deletes:**
- All users with `@autopilottest.com` emails
- All audit log entries for those users
- Leaves production data untouched

---

## 📊 Monitoring Dashboard

Tracks message activity and detects anomalies.

### Get Statistics

```bash
# Stats for last 24 hours
curl "https://autopilotamerica.com/api/admin/monitoring?action=stats&days=1"

# Stats for last 7 days
curl "https://autopilotamerica.com/api/admin/monitoring?action=stats&days=7"
```

**Response:**
```json
{
  "success": true,
  "period": {
    "days": 7,
    "startDate": "2025-11-10T12:00:00Z",
    "endDate": "2025-11-17T12:00:00Z"
  },
  "stats": {
    "total": 450,
    "sent": 380,
    "skipped": 60,
    "blocked": 5,
    "errors": 5,
    "byChannel": {
      "sms": 200,
      "email": 220,
      "voice": 30
    },
    "byMessageKey": {
      "renewal_city_sticker_30day": 120,
      "renewal_license_plate_7day": 80,
      ...
    },
    "topSkipReasons": [
      { "reason": "already_sent_48h", "count": 45 },
      { "reason": "user_disabled_sms", "count": 10 },
      { "reason": "missing_phone_number", "count": 5 }
    ],
    "topErrors": [
      { "reason": "api_error", "count": 3 },
      { "reason": "invalid_phone", "count": 2 }
    ],
    "costTotal": 1240
  },
  "metrics": {
    "success_rate": "84.4%",
    "error_rate": "1.1%",
    "skip_rate": "13.3%",
    "avg_cost_per_message": "$0.0028",
    "total_cost": "$12.40"
  }
}
```

---

### Generate Daily Digest

```bash
curl "https://autopilotamerica.com/api/admin/monitoring?action=digest"
```

**Response:**
```json
{
  "success": true,
  "digest": "📊 Autopilot America - Daily Message Digest\n...",
  "stats": { ... },
  "instructions": {
    "send_email": "You can email this digest to admin@autopilotamerica.com",
    "slack_webhook": "Or send to Slack webhook for daily notifications"
  }
}
```

**Example Digest:**
```
📊 Autopilot America - Daily Message Digest
Date: 11/17/2025

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUMMARY (Last 24 Hours)
  Total Messages: 65
  ✅ Sent: 58
  ⏭️  Skipped: 5
  🚫 Blocked: 1
  ❌ Errors: 1

SUCCESS RATE: 89.2%
ERROR RATE: 1.5%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BY CHANNEL
  📱 SMS: 30
  📧 Email: 30
  📞 Voice: 5

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP MESSAGE TYPES
  renewal_city_sticker_30day: 25
  renewal_license_plate_7day: 15
  street_cleaning_1day: 10
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP SKIP REASONS
  already_sent_48h: 3
  user_disabled_sms: 2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ERRORS
  api_error: 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COSTS
  Total: $1.70
  SMS: ~60¢ = $0.60
  Voice: ~25¢ = $0.25
  Email: ~0¢

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Detect Anomalies

```bash
curl "https://autopilotamerica.com/api/admin/monitoring?action=anomalies"
```

**Response:**
```json
{
  "success": true,
  "anomalies": [
    {
      "type": "error_spike",
      "severity": "medium",
      "message": "Error rate spiked to 15.2% (was 1.1%)",
      "data": {
        "today": 12,
        "yesterday": 1
      }
    }
  ],
  "alert_level": "medium",
  "message": "⚠️ 1 anomaly detected",
  "recommendations": [
    "Check /admin/message-audit for error details",
    "Verify ClickSend/Resend API status",
    "Check recent code changes for bugs"
  ]
}
```

**Anomaly Types:**
- **error_spike** - Error rate increased 2x or more
- **volume_spike** - Message volume increased 2x or more
- **skip_spike** - >50% of messages being skipped
- **cost_spike** - Daily costs increased 2x or more

**Severity Levels:**
- **low** - Informational, review when convenient
- **medium** - Should investigate soon
- **high** - Investigate immediately

---

## 🔄 Complete Testing Workflow

### Full Test Cycle (Every Time You Change Message Logic)

```bash
# 1. Generate test users
curl -X POST https://autopilotamerica.com/api/admin/test-harness?action=generate

# 2. Run all scenarios in dry run mode
curl -X POST "https://autopilotamerica.com/api/admin/test-harness?action=runAll&dryRun=true"

# 3. Review results in audit dashboard
# Visit: /admin/message-audit
# Filter: email contains "@autopilottest.com"

# 4. Verify specific scenarios
curl "https://autopilotamerica.com/api/admin/test-harness?action=verify&scenario=renewal_30_days_protection"
curl "https://autopilotamerica.com/api/admin/test-harness?action=verify&scenario=missing_phone_number"

# 5. If all looks good, run LIVE (optional - only if testing actual sends)
curl -X POST "https://autopilotamerica.com/api/admin/test-harness?action=runAll&dryRun=false"

# 6. Cleanup test data
curl -X POST https://autopilotamerica.com/api/admin/test-harness?action=cleanup
```

---

## 📅 Daily Monitoring Routine

### Morning Check (5 minutes)

```bash
# 1. Get yesterday's stats
curl "https://autopilotamerica.com/api/admin/monitoring?action=stats&days=1"

# 2. Check for anomalies
curl "https://autopilotamerica.com/api/admin/monitoring?action=anomalies"

# 3. If anomalies found, check audit log
# Visit: /admin/message-audit
# Filter by: result = error, date = yesterday
```

### Weekly Review (15 minutes)

```bash
# 1. Get 7-day stats
curl "https://autopilotamerica.com/api/admin/monitoring?action=stats&days=7"

# 2. Generate digest
curl "https://autopilotamerica.com/api/admin/monitoring?action=digest"

# 3. Review trends:
#    - Is error rate increasing?
#    - Are costs growing as expected?
#    - Any unexpected skip patterns?

# 4. Run test harness to verify nothing broke
curl -X POST https://autopilotamerica.com/api/admin/test-harness?action=generate
curl -X POST "https://autopilotamerica.com/api/admin/test-harness?action=runAll&dryRun=true"
curl -X POST https://autopilotamerica.com/api/admin/test-harness?action=cleanup
```

---

## 🎯 Use Cases

### Before Deploying New Message Logic

```bash
# Test the change won't break anything
curl -X POST https://autopilotamerica.com/api/admin/test-harness?action=generate
curl -X POST "https://autopilotamerica.com/api/admin/test-harness?action=runAll&dryRun=true"

# Review results, verify new logic works
# Visit /admin/message-audit

# Deploy with confidence!
```

### After User Reports "Didn't Get Message"

```bash
# Check if message was sent
# Visit /admin/message-audit
# Search: user's email
# See: sent, skipped (reason), or error (details)

# Common findings:
# - "skipped: already_sent_48h" = Deduplication working
# - "skipped: user_disabled_sms" = User preference
# - "skipped: missing_phone_number" = User has no phone
# - "error: api_error" = ClickSend/Resend issue
```

### Investigating High Costs

```bash
# Get detailed stats
curl "https://autopilotamerica.com/api/admin/monitoring?action=stats&days=7"

# Check for:
# - Volume spike (more users = more messages = more cost)
# - Duplicate sends (bug in deduplication)
# - Test users not cleaned up
```

---

## 🔗 API Reference

### Test Harness Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/test-harness?action=generate` | POST | Create 10 test users |
| `/api/admin/test-harness?action=run&scenario=X` | POST | Run single scenario |
| `/api/admin/test-harness?action=runAll` | POST | Run all scenarios |
| `/api/admin/test-harness?action=verify&scenario=X` | GET | Verify scenario results |
| `/api/admin/test-harness?action=cleanup` | POST | Delete all test users |

### Monitoring Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/monitoring?action=stats&days=N` | GET | Get stats for last N days |
| `/api/admin/monitoring?action=digest` | GET | Generate daily digest |
| `/api/admin/monitoring?action=anomalies` | GET | Detect anomalies |

---

## ✅ Summary

**Test Harness gives you:**
- ✅ Automated scenario testing
- ✅ Fake user generation
- ✅ Verification of expected behavior
- ✅ Safe dry run mode
- ✅ Easy cleanup

**Monitoring gives you:**
- ✅ Daily/weekly stats
- ✅ Anomaly detection
- ✅ Cost tracking
- ✅ Error analysis
- ✅ Skip reason insights

**Together they prevent disasters!** 🎸
