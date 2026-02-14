# Towed Vehicles Alert System - Quick Reference

## File Locations

### Core Files
- **Sync Cron**: `/pages/api/cron/sync-towing-data.ts` - Hourly data sync from Chicago API
- **Check Cron**: `/pages/api/cron/check-towed-vehicles.ts` - Hourly user notification check
- **SMS Service**: `/lib/sms-service.ts` - ClickSend SMS integration with circuit breaker
- **Circuit Breaker**: `/lib/circuit-breaker.ts` - Failure resilience pattern
- **Tow Alerts Module**: `/lib/contest-intelligence/tow-alerts.ts` - Intelligence system integration
- **Types**: `/lib/contest-intelligence/types.ts` - TypeScript interfaces
- **Database Types**: `/lib/database.types.ts` - Supabase schema

### Database Migration
- **Schema**: `/database/create-towed-vehicles-table.sql` - towed_vehicles table definition
- **Intelligence Schema**: `/supabase/migrations/20250121_contest_intelligence_system.sql` - tow_boot_alerts table

### Testing/Debugging
- `debug-tow-alert.js` - Manual alert creation
- `test-tow-alert-manual.js` - End-to-end test
- `test-towing-alert.js` - Notification test
- `check-cron-health.js` - Health check
- `manual-sync-tow.js` - Manual data sync

---

## Database Tables

### towed_vehicles
```
id | tow_date | make | style | color | plate | state | towed_to_address | tow_facility_phone | inventory_number | notified_users | created_at
```
- **Key Indexes**: `idx_towed_plate`, `idx_towed_date`, `idx_towed_plate_date`, `idx_towed_inventory`
- **Unique**: `inventory_number`
- **Updates**: Hourly via sync-towing-data cron

### user_profiles (Relevant Fields)
```
license_plate | license_state | phone_number | email | city |
notify_tow | notify_sms | notify_email
```
- **Filter**: WHERE city ILIKE 'chicago' AND license_plate IS NOT NULL

### tow_boot_alerts
```
id | user_id | vehicle_id | alert_type | plate | state | tow_date | discovered_at |
tow_location | impound_location | impound_address | impound_phone |
related_ticket_ids | tow_fee | daily_storage_fee | boot_fee | total_fees |
status | contesting_tow | user_notified | notified_at | notification_method |
resolved_at | amount_paid | amount_waived
```
- **Created By**: `createTowAlert()` function
- **RLS Policy**: Users can only see their own alerts

---

## Key Functions

### SMS (`lib/sms-service.ts`)
```typescript
sendClickSendSMS(to: string, message: string, options?: {...})
  → Promise<{success, error?, attempts?, messageId?, circuitOpen?}>
```

### Tow Alerts (`lib/contest-intelligence/tow-alerts.ts`)
```typescript
createTowAlert(supabase, alert) → Promise<TowBootAlert | null>
getUserActiveAlerts(supabase, userId) → Promise<TowBootAlert[]>
getUserAlerts(supabase, userId, options) → Promise<TowBootAlert[]>
markAlertNotified(supabase, alertId, method) → Promise<boolean>
markTowContested(supabase, alertId) → Promise<boolean>
calculateCurrentFees(alert) → {tow_fee, boot_fee, storage_fees, total, days_stored}
evaluateTowContestEligibility(alert, relatedTickets) → {eligible, reasons, recommendations}
```

### Circuit Breaker (`lib/circuit-breaker.ts`)
```typescript
circuitBreakers.sms.execute(fn, context)
circuitBreakers.email.execute(fn, context)
circuitBreakers.voice.execute(fn, context)
```

---

## Cron Job Flow

### Sync (Every Hour - Minute 0)
```
1. Fetch https://data.cityofchicago.org/resource/ygr5-vcbg.json?$limit=5000
2. Filter nulls, uppercase plates, default state to IL
3. Upsert to towed_vehicles (inventory_number as conflict key)
4. Return count synced
```

### Check (Every Hour - Minute 15)
```
1. GET users WHERE city ILIKE 'chicago' AND license_plate IS NOT NULL
2. For each user:
   a. SELECT FROM towed_vehicles WHERE plate = user.plate 
      AND state = user.state AND tow_date > NOW() - 2 days
   b. IF tow found AND user_id NOT IN tow.notified_users:
      - Send SMS (if notify_sms && phone_number)
      - Send Email (if notify_email && email)
      - Create tow_boot_alert record
      - Mark alert as notified
      - Add user_id to tow.notified_users[]
   c. Else: SKIP
3. Return summary {usersChecked, notificationsSent, notifiedUsers}
```

---

## Notification Templates

### SMS (Max ~160 chars)
```
🚨 AUTOPILOT AMERICA ALERT
Your car was towed!

Vehicle: [COLOR] [MAKE]
Plate: [PLATE] ([STATE])
Towed: [DATE]

IMPOUND LOT:
[ADDRESS]
[PHONE]

Inventory #: [INVENTORY]

Call immediately. Fees increase daily.

Reply STOP to unsubscribe.
```

### Email
From: `Autopilot America <alerts@autopilotamerica.com>`
Subject: `🚨 Your Car Was Towed - Act Now`
Content: HTML formatted with vehicle details, impound location, phone, inventory number

---

## Notification Services

### SMS: ClickSend
- **Endpoint**: `https://rest.clicksend.com/v3/sms/send`
- **Auth**: Basic (username:apiKey)
- **Config**: `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`
- **Circuit Breaker**: 5 failures → OPEN, 2 min wait, 2 successes to close

### Email: Resend
- **Endpoint**: `https://api.resend.com/emails`
- **Auth**: Bearer token
- **Config**: `RESEND_API_KEY`
- **Circuit Breaker**: 10 failures → OPEN, 1 min wait, 3 successes to close

---

## Chicago Impound Lots

| Code | Name | Address | Phone |
|------|------|---------|-------|
| 701 | O'Hare Auto Pound | 10301 W Zemke Rd, Chicago, IL 60666 | 312-744-7550 |
| 702 | 103rd Street Auto Pound | 10300 S Doty Ave, Chicago, IL 60628 | 312-744-4444 |
| 705 | North Auto Pound | 3353 S Sacramento Ave, Chicago, IL 60623 | 312-744-1771 |
| 706 | 215 N Sacramento Auto Pound | 215 N Sacramento Blvd, Chicago, IL 60612 | 312-744-2584 |
| 707 | Foster Auto Pound | 5231 N Foster Ave, Chicago, IL 60630 | 312-744-9494 |

---

## Chicago Tow Fees (2024)

- Tow Fee: $150
- Boot Fee: $100
- Daily Storage: $25
- Administrative Fee: $60
- Release Fee: $25
- **Total (day 1)**: $235 + daily storage

---

## Environment Variables

```bash
CRON_SECRET=<bearer-token-for-cron-auth>
CLICKSEND_USERNAME=<clicksend-account>
CLICKSEND_API_KEY (set in environment)
RESEND_API_KEY (set in environment)
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

---

## Monitoring

### Health Check Script
```bash
node check-cron-health.js
```

### Manual Sync
```bash
node manual-sync-tow.js
```

### Manual Alert Test
```bash
node test-towing-alert.js
```

### Cron Response Format
```json
{
  "success": true,
  "message": "Towing check complete",
  "usersChecked": 1250,
  "notificationsSent": 3,
  "notifiedUsers": ["uuid-1", "uuid-2", "uuid-3"]
}
```

---

## Debugging

### Check Circuit Breaker Status
```typescript
import { circuitBreakers, getAllCircuitStates } from './lib/circuit-breaker';

console.log(getAllCircuitStates());
// {
//   'clicksend-sms': { state: 'CLOSED', stats: {...} },
//   'resend-email': { state: 'OPEN', stats: {...}, timeSinceLastFailure: 45000 }
// }
```

### Reset Circuit Breaker
```typescript
import { circuitBreakers } from './lib/circuit-breaker';

circuitBreakers.sms.reset();
```

### Manual Create Alert
```typescript
import { createTowAlert } from './lib/contest-intelligence';

const alert = await createTowAlert(supabase, {
  user_id: 'user-uuid',
  alert_type: 'tow',
  plate: 'ABC123',
  state: 'IL',
  impound_address: '10300 S Doty Ave, Chicago, IL 60628',
  impound_phone: '312-744-4444',
  tow_date: new Date().toISOString(),
  discovered_at: new Date().toISOString(),
});
```

---

## Common Issues & Solutions

### SMS Not Sending
1. Check `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY` are set
2. Check circuit breaker status: `circuitBreakers.sms.getState()`
3. Verify phone number format (must include country code for non-US)
4. Check ClickSend account balance and rate limits

### Email Not Sending
1. Check `RESEND_API_KEY` is set and valid
2. Check circuit breaker status: `circuitBreakers.email.getState()`
3. Verify recipient email is valid
4. Check Resend account balance
5. Check spam folder for test emails

### Duplicate Alerts
1. Check `notified_users[]` array in towed_vehicles record
2. Verify sync and check cron jobs are running (15 min apart)
3. Check user's `notify_tow` setting (should not be false)

### Missing Tow Data
1. Verify Chicago API is accessible: https://data.cityofchicago.org/resource/ygr5-vcbg.json
2. Check towed_vehicles table has recent data: `SELECT * FROM towed_vehicles ORDER BY tow_date DESC LIMIT 1`
3. Verify sync cron job ran: Check logs for "Starting hourly towing data sync"

### User Not Getting Alerts
1. Verify `city` field in user_profiles is 'chicago' (case-insensitive)
2. Check `license_plate` is not null
3. Check `notify_tow` is not false
4. Verify `notify_sms` and/or `notify_email` is true
5. Verify `phone_number` or `email` is not null

---

## Performance Considerations

- **Database**: Indexes on `plate`, `tow_date`, `plate + tow_date` for fast lookups
- **Cron Duration**: 1-2 minutes for 1000+ users (SMS/email speeds are bottleneck)
- **API Rate Limits**:
  - ClickSend: 1,000 SMS/day
  - Resend: Depends on tier (free tier has limit)
  - Chicago: No limit, but max 5,000 records per request
- **Rate Limiting**: 1-second delay between user notifications (prevents API throttling)

---

## Related Documentation

- Full system docs: `/TOWED_VEHICLES_SYSTEM.md`
- Contest Intelligence: `/lib/contest-intelligence/`
- Circuit Breaker Pattern: `/lib/circuit-breaker.ts`
- SMS Service: `/lib/sms-service.ts`
