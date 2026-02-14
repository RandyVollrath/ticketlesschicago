# Towed Vehicles Alert System - Comprehensive Documentation

## Overview

The Towed Vehicles Alert System is a real-time monitoring system that:
1. **Syncs** Chicago's towed vehicle data hourly from the city's open data portal
2. **Monitors** user vehicles for tow incidents
3. **Alerts** users immediately via SMS and/or email when their vehicle is found
4. **Integrates** with the contest intelligence system for tow dispute management
5. **Tracks** notification status to prevent duplicate alerts

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Chicago Towed Vehicles Data Portal                         │
│  (https://data.cityofchicago.org/resource/ygr5-vcbg.json)  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │ CRON JOB: SYNC │
        │ Every Hour     │
        └────────┬───────┘
                 │ pages/api/cron/sync-towing-data.ts
                 │
                 ▼
        ┌──────────────────────────────────┐
        │  towed_vehicles TABLE            │
        │  (Stores latest tow records)     │
        └────────────┬─────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │ CRON JOB: CHECK TOWS   │
        │ Every Hour             │
        └────────┬───────────────┘
                 │ pages/api/cron/check-towed-vehicles.ts
                 │
        ┌────────┴──────────────┐
        │                       │
        ▼                       ▼
   ╔═════════╗          ╔════════════╗
   ║  TWILIO ║          ║   RESEND   ║
   ║   SMS   ║          ║   EMAIL    ║
   ╚═════════╝          ╚════════════╝
   (ClickSend API)      (Resend API)
        │                       │
        ▼                       ▼
   Send SMS Alert         Send Email Alert
        │                       │
        └───────────┬───────────┘
                    │
                    ▼
        ┌──────────────────────────────┐
        │ tow_boot_alerts TABLE        │
        │ (Contest Intelligence)       │
        └──────────────────────────────┘
```

---

## Database Schema

### 1. `towed_vehicles` Table
**Purpose**: Stores all towed vehicles from Chicago's data portal

```sql
CREATE TABLE towed_vehicles (
  id SERIAL PRIMARY KEY,
  tow_date TIMESTAMP WITH TIME ZONE NOT NULL,
  make TEXT,
  style TEXT,
  color TEXT,
  plate TEXT NOT NULL,
  state TEXT,
  towed_to_address TEXT,
  tow_facility_phone TEXT,
  inventory_number TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notified_users TEXT[] DEFAULT '{}'  -- User IDs already notified about this tow
);

-- INDEXES
CREATE INDEX idx_towed_plate ON towed_vehicles(plate);
CREATE INDEX idx_towed_date ON towed_vehicles(tow_date DESC);
CREATE INDEX idx_towed_plate_date ON towed_vehicles(plate, tow_date DESC);
CREATE INDEX idx_towed_inventory ON towed_vehicles(inventory_number);
```

**Key Fields**:
- `notified_users[]`: Array of user IDs who have been notified (prevents duplicate alerts)
- `plate`: License plate (case-insensitive matching in queries)
- `state`: License plate state (defaults to 'IL')
- `tow_date`: When vehicle was towed (from Chicago API, no time component)

---

### 2. `user_profiles` Table (Relevant Fields)
**Purpose**: User configuration for tow alerts

```sql
-- NOTIFICATION PREFERENCES
notify_tow BOOLEAN DEFAULT NULL      -- Enable/disable tow notifications
notify_sms BOOLEAN DEFAULT NULL      -- Enable/disable SMS
notify_email BOOLEAN DEFAULT NULL    -- Enable/disable email

-- VEHICLE INFORMATION
license_plate TEXT                   -- User's license plate to monitor
license_state TEXT                   -- License plate state (default 'IL')

-- CONTACT INFO
phone_number TEXT                    -- Phone for SMS alerts
email TEXT                           -- Email for notifications

-- LOCATION
city TEXT                            -- City filter (case-insensitive 'chicago')
```

**Notification Logic**:
- `notify_tow = false` → Skip tow alerts entirely
- `notify_sms = true` + `phone_number` → Send SMS
- `notify_email = true` + `email` → Send email
- Both can be enabled for dual notifications

---

### 3. `tow_boot_alerts` Table (Contest Intelligence)
**Purpose**: Tracks tow alerts linked to contest system

```sql
CREATE TABLE tow_boot_alerts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  alert_type TEXT CHECK (alert_type IN ('tow', 'boot', 'impound')),
  
  -- Vehicle info
  plate TEXT NOT NULL,
  state TEXT DEFAULT 'IL',
  
  -- Location
  tow_location TEXT,
  impound_location TEXT,
  impound_address TEXT,
  impound_phone TEXT,
  
  -- Timing
  tow_date TIMESTAMP WITH TIME ZONE,
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Associated tickets
  related_ticket_ids UUID[],
  total_ticket_amount DECIMAL(10,2),
  
  -- Fees
  tow_fee DECIMAL(10,2),
  daily_storage_fee DECIMAL(10,2),
  boot_fee DECIMAL(10,2),
  total_fees DECIMAL(10,2),
  
  -- Status
  status TEXT DEFAULT 'active' 
    CHECK (status IN ('active', 'resolved', 'vehicle_retrieved', 'contested')),
  
  -- Contest info
  contesting_tow BOOLEAN DEFAULT false,
  tow_contest_filed_at TIMESTAMP WITH TIME ZONE,
  tow_contest_outcome TEXT,
  
  -- Notification tracking
  user_notified BOOLEAN DEFAULT false,
  notified_at TIMESTAMP WITH TIME ZONE,
  notification_method TEXT,
  
  -- Resolution
  resolved_at TIMESTAMP WITH TIME ZONE,
  amount_paid DECIMAL(10,2),
  amount_waived DECIMAL(10,2),
  
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);

-- INDEXES
CREATE INDEX idx_tow_alerts_user ON tow_boot_alerts(user_id);
CREATE INDEX idx_tow_alerts_plate ON tow_boot_alerts(plate, state);
CREATE INDEX idx_tow_alerts_status ON tow_boot_alerts(status);
CREATE INDEX idx_tow_alerts_date ON tow_boot_alerts(tow_date DESC);
```

---

## Cron Jobs

### 1. Sync Towing Data Cron
**File**: `pages/api/cron/sync-towing-data.ts`
**Schedule**: Every hour (Vercel cron)
**Purpose**: Fetch latest towed vehicles from Chicago API and store in database

**Flow**:
```
1. Fetch latest 5,000 tows from Chicago API
2. Filter records with null/empty plates
3. Transform data:
   - Convert plate to uppercase
   - Default state to 'IL'
   - Map all fields from API
4. Upsert to database using inventory_number as conflict key
5. Return count of synced records
```

**Key Code**:
```typescript
const url = `https://data.cityofchicago.org/resource/ygr5-vcbg.json?$limit=5000&$order=tow_date DESC`;

const records = data
  .filter((item: any) => item.plate && item.plate.trim() !== '')
  .map((item: any) => ({
    tow_date: item.tow_date,
    make: item.make,
    style: item.style,
    color: item.color,
    plate: item.plate.trim().toUpperCase(),
    state: item.state || 'IL',
    towed_to_address: item.towed_to_address,
    tow_facility_phone: item.tow_facility_phone,
    inventory_number: item.inventory_number
  }));

await supabaseAdmin.from('towed_vehicles').upsert(records, {
  onConflict: 'inventory_number',
  ignoreDuplicates: true
});
```

**Data Source**: Chicago's official towed vehicles dataset
- API: `https://data.cityofchicago.org/resource/ygr5-vcbg.json`
- Updated by Chicago Department of Finance

---

### 2. Check Towed Vehicles Cron
**File**: `pages/api/cron/check-towed-vehicles.ts`
**Schedule**: Every hour (Vercel cron)
**Purpose**: Check if any user's vehicle was towed and send alerts

**Flow**:
```
1. Get all Chicago users with license plates
   SELECT: user_id, phone_number, email, license_plate, 
           license_state, notify_sms, notify_email, notify_tow
   WHERE: city ILIKE 'chicago' AND license_plate IS NOT NULL

2. For each user:
   a. Query towed_vehicles table:
      - Match plate (case-insensitive)
      - Match state (default IL)
      - Towed within last 48 hours
      - Order by tow_date DESC (most recent first)
   
   b. Check if already notified:
      - If user_id in tow.notified_users[], skip
      - Prevents duplicate notifications
   
   c. Check if notifications enabled:
      - If notify_tow === false, skip
      - Else check notify_sms and notify_email
   
   d. Send SMS alert (if notify_sms && phone_number):
      - Use ClickSend API via sendClickSendSMS()
      - Includes vehicle details, impound location, fees
      - Has circuit breaker protection
   
   e. Send email alert (if notify_email && email):
      - Use Resend API
      - HTML formatted with vehicle info and location
      - Subject: "🚨 Your Car Was Towed - Act Now"
   
   f. Create tow alert in intelligence system:
      - createTowAlert() - links to contest system
      - markAlertNotified() - records notification method
   
   g. Update notified_users array:
      - Add user_id to tow.notified_users[]
      - Prevents re-alerting on next cron run

3. Return summary:
   - users_checked
   - notifications_sent
   - notified_users (list of user IDs alerted)
```

---

## Notification System

### SMS Notifications

**Provider**: ClickSend (https://www.clicksend.com/)

**Service**: `lib/sms-service.ts`
- Function: `sendClickSendSMS(to, message, options)`
- Returns: `{success, error?, attempts?, messageId?, circuitOpen?}`

**Configuration**:
```typescript
const username = process.env.CLICKSEND_USERNAME;
const apiKey = process.env.CLICKSEND_API_KEY;

// API Endpoint: https://rest.clicksend.com/v3/sms/send
// Authentication: Basic Auth (username:apiKey)
```

**SMS Message Template**:
```
🚨 AUTOPILOT AMERICA ALERT
Your car was towed!

Vehicle: [COLOR] [MAKE]
Plate: [PLATE] ([STATE])
Towed: [DATE]

IMPOUND LOT:
[ADDRESS]
[PHONE]

Inventory #: [INVENTORY_NUMBER]

Call immediately to retrieve your vehicle. Fees increase daily.

Reply STOP to unsubscribe from Autopilot America alerts.
```

**Circuit Breaker Settings** (for SMS):
```typescript
failureThreshold: 5      // Open after 5 failures
resetTimeout: 120000     // Wait 2 minutes before retry
successThreshold: 2      // 2 successes in half-open to close
failureWindow: 300000    // 5-minute sliding window
```

**Retry Logic**:
```typescript
// Exponential backoff retry
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  const result = await sendClickSendSMSOnce(to, message);
  
  if (result.success) {
    return { ...result, attempts: attempt };
  }
  
  // Don't retry on credential/invalid number errors
  if (result.error?.includes('No credentials') || 
      result.error?.includes('INVALID_RECIPIENT')) {
    return { ...result, attempts: attempt };
  }
  
  if (attempt < maxRetries) {
    // Exponential backoff: 1s, 2s, 3s, ...
    await sleep(RETRY_DELAY_MS * attempt);
  }
}
```

---

### Email Notifications

**Provider**: Resend (https://resend.com/)

**Configuration**:
```typescript
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// API Endpoint: https://api.resend.com/emails
// Authentication: Bearer token in Authorization header
```

**Email Template**:
```html
<h2 style="color: #dc2626;">🚨 Your Car Was Towed</h2>
<p><strong>Vehicle:</strong> [COLOR] [MAKE]</p>
<p><strong>License Plate:</strong> [PLATE] ([STATE])</p>
<p><strong>Towed:</strong> [DATE]</p>
<hr>
<h3>Impound Location</h3>
<p><strong>Address:</strong> [ADDRESS]</p>
<p><strong>Phone:</strong> [PHONE]</p>
<p><strong>Inventory Number:</strong> [INVENTORY_NUMBER]</p>
<hr>
<p style="color: #dc2626; font-weight: bold;">
  ⚠️ Call immediately to retrieve your vehicle. Impound fees increase daily.
</p>
<p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
  - Autopilot America
</p>
```

**Email Configuration**:
```typescript
{
  from: 'Autopilot America <alerts@autopilotamerica.com>',
  to: user.email,
  subject: '🚨 Your Car Was Towed - Act Now',
  html: emailHtml
}
```

**Circuit Breaker Settings** (for Email):
```typescript
failureThreshold: 10     // More tolerant than SMS
resetTimeout: 60000      // Wait 1 minute before retry
successThreshold: 3      // 3 successes to close
failureWindow: 300000    // 5-minute sliding window
```

---

## Circuit Breaker Pattern

**File**: `lib/circuit-breaker.ts`

**Purpose**: Prevent cascading failures when SMS/Email services are down

**States**:
- **CLOSED**: Normal operation, requests go through
- **OPEN**: Service failing, requests rejected immediately
- **HALF_OPEN**: Testing recovery, limited requests allowed

**Pre-configured Breakers**:
```typescript
circuitBreakers.sms = CircuitBreaker('clicksend-sms', {
  failureThreshold: 5,      // Opens after 5 failures
  resetTimeout: 120000,     // Waits 2 min before testing recovery
  successThreshold: 2,      // Needs 2 successes to fully close
  failureWindow: 300000     // Counts failures in last 5 min
});

circuitBreakers.email = CircuitBreaker('resend-email', {
  failureThreshold: 10,     // More failures allowed
  resetTimeout: 60000,
  successThreshold: 3,
  failureWindow: 300000
});

circuitBreakers.voice = CircuitBreaker('clicksend-voice', {
  failureThreshold: 3,      // Low threshold for expensive calls
  resetTimeout: 180000,     // Longer wait (3 min)
  successThreshold: 2,
  failureWindow: 300000
});
```

**Usage in Cron Job**:
```typescript
// SMS with circuit breaker
if (user.notify_sms && user.phone_number) {
  try {
    const result = await sendClickSendSMS(user.phone_number, message);
    if (result.success) {
      console.log(`✓ SMS sent to ${user.phone_number}`);
      notificationsSent++;
    } else if (result.circuitOpen) {
      console.warn(`SMS service temporarily unavailable`);
    }
  } catch (smsError) {
    console.error(`Error sending SMS:`, smsError);
  }
}
```

---

## Contest Intelligence Integration

**File**: `lib/contest-intelligence/tow-alerts.ts`

The tow alert system integrates with the broader contest intelligence system to help users dispute wrongful tows.

### Key Functions

**1. `createTowAlert(supabase, alert)`**
Creates a tow alert record linked to the contest system
```typescript
const towAlert = await createTowAlert(supabaseAdmin, {
  user_id: user.user_id,
  alert_type: 'tow',
  plate: plate,
  state: state,
  tow_location: tow.tow_zone,
  impound_location: tow.towed_to,
  impound_address: tow.towed_to_address,
  impound_phone: tow.tow_facility_phone,
  tow_date: tow.tow_date,
  discovered_at: new Date().toISOString(),
  related_ticket_ids: [],
  contesting_tow: false,
});
```

**2. `markAlertNotified(supabase, alertId, method)`**
Records that user was notified
```typescript
await markAlertNotified(supabaseAdmin, towAlert.id, 
  user.notify_sms && user.phone_number ? 'sms' : 'email');
```

**3. `calculateCurrentFees(alert)`**
Calculates total fees including daily storage
```typescript
const fees = calculateCurrentFees(alert);
// Returns: {
//   tow_fee: 150,
//   boot_fee: 0,
//   storage_fees: 75,          // Calculated from days stored
//   administrative_fees: 85,
//   total: 310,
//   days_stored: 3
// }
```

**4. `evaluateTowContestEligibility(alert, relatedTickets)`**
Determines if tow can be contested
```typescript
const eligibility = evaluateTowContestEligibility(alert);
// Returns: {
//   eligible: true,
//   reasons: ["Related ticket contested"],
//   recommendations: ["Contest through traffic ticket system"]
// }
```

### Chicago Impound Lots
Pre-configured in `tow-alerts.ts`:
```typescript
const CHICAGO_IMPOUND_LOTS = {
  '701': {
    name: 'O\'Hare Auto Pound',
    address: '10301 W Zemke Rd, Chicago, IL 60666',
    phone: '312-744-7550',
  },
  '702': {
    name: '103rd Street Auto Pound',
    address: '10300 S Doty Ave, Chicago, IL 60628',
    phone: '312-744-4444',
  },
  '705': {
    name: 'North Auto Pound',
    address: '3353 S Sacramento Ave, Chicago, IL 60623',
    phone: '312-744-1771',
  },
  '706': {
    name: '215 N Sacramento Auto Pound',
    address: '215 N Sacramento Blvd, Chicago, IL 60612',
    phone: '312-744-2584',
  },
  '707': {
    name: 'Foster Auto Pound',
    address: '5231 N Foster Ave, Chicago, IL 60630',
    phone: '312-744-9494',
  },
};
```

### Chicago Tow Fees (as of 2024)
```typescript
const CHICAGO_TOW_FEES = {
  tow_fee: 150,
  boot_fee: 100,
  daily_storage: 25,
  administrative_fee: 60,
  release_fee: 25,
};
```

---

## Type Definitions

**File**: `lib/contest-intelligence/types.ts`

### TowBootAlert Type
```typescript
export interface TowBootAlert {
  id: string;
  user_id: string;
  vehicle_id?: string;
  alert_type: 'tow' | 'boot' | 'impound';
  plate: string;
  state: string;
  
  tow_location?: string;
  impound_location?: string;
  impound_address?: string;
  impound_phone?: string;
  
  tow_date?: string;
  discovered_at: string;
  
  related_ticket_ids: string[];
  total_ticket_amount?: number;
  tow_fee?: number;
  daily_storage_fee?: number;
  boot_fee?: number;
  total_fees?: number;
  
  status: 'active' | 'resolved' | 'vehicle_retrieved' | 'contested';
  
  contesting_tow: boolean;
  tow_contest_filed_at?: string;
  tow_contest_outcome?: string;
  
  user_notified: boolean;
  notified_at?: string;
  notification_method?: string;
  
  resolved_at?: string;
  amount_paid?: number;
  amount_waived?: number;
  
  created_at: string;
}
```

---

## Flow Diagrams

### Complete Tow Alert Flow

```
1. USER SETUP
   └─ User sets license_plate in profile
   └─ Enables notify_tow, notify_sms, notify_email
   └─ Provides phone_number and email

2. HOURLY SYNC (sync-towing-data.ts)
   └─ Fetch 5,000 latest tows from Chicago API
   └─ Insert/update in towed_vehicles table

3. HOURLY CHECK (check-towed-vehicles.ts)
   ├─ Get all Chicago users with plates
   ├─ For each user:
   │  ├─ Query: SELECT FROM towed_vehicles
   │  │          WHERE plate = user.license_plate
   │  │          AND tow_date > NOW() - 2 days
   │  │          ORDER BY tow_date DESC
   │  │
   │  ├─ If tow found:
   │  │  ├─ Check if user_id in tow.notified_users
   │  │  │  └─ If yes: SKIP (already notified)
   │  │  │
   │  │  ├─ Check notify_tow, notify_sms, notify_email
   │  │  │
   │  │  ├─ Send SMS (if enabled):
   │  │  │  ├─ Call sendClickSendSMS()
   │  │  │  ├─ Circuit breaker checks
   │  │  │  ├─ Retry with exponential backoff
   │  │  │  └─ Log result
   │  │  │
   │  │  ├─ Send Email (if enabled):
   │  │  │  ├─ Call Resend API
   │  │  │  ├─ HTML formatted message
   │  │  │  └─ Log result
   │  │  │
   │  │  ├─ Create tow alert:
   │  │  │  ├─ Call createTowAlert()
   │  │  │  ├─ Links to contest system
   │  │  │  └─ Records alert ID
   │  │  │
   │  │  ├─ Mark alert as notified:
   │  │  │  ├─ Call markAlertNotified()
   │  │  │  ├─ Records notification method
   │  │  │  └─ Sets notified_at timestamp
   │  │  │
   │  │  └─ Update towed_vehicles:
   │  │     └─ Add user_id to notified_users[]
   │  │
   │  └─ If no tow: CONTINUE to next user
   │
   └─ Return summary

4. USER RECEIVES ALERT
   ├─ SMS arrives with:
   │  ├─ Vehicle details
   │  ├─ Impound location and phone
   │  ├─ Inventory number
   │  └─ Instructions to call immediately
   │
   └─ Email arrives with:
      ├─ Vehicle details
      ├─ Impound location and phone
      ├─ Inventory number
      └─ Cost breakdown (tow + storage + fees)

5. USER ACTION
   ├─ Option 1: Retrieve vehicle
   │  └─ Call impound lot, pay fees
   │
   └─ Option 2: Contest tow
      └─ Access contest intelligence system
      └─ Check if related tickets can be disputed
      └─ File tow contest if eligible
```

---

## Error Handling

### Circuit Breaker Responses

When SMS circuit breaker is open:
```typescript
{
  success: false,
  error: "SMS service temporarily unavailable. Retry in 120s.",
  circuitOpen: true
}
```

Cron job logs warning and continues:
```typescript
if (result.circuitOpen) {
  console.warn(`🚫 SMS circuit OPEN - not attempting send`);
  // Continue to next user instead of failing entire job
}
```

### Credential Errors

If ClickSend credentials missing:
```typescript
console.log('📱 MOCK: No ClickSend credentials configured');
return { success: false, error: 'No credentials' };
```

Cron job does NOT retry when credentials missing.

### Database Errors

Tow alert creation failures are caught and logged:
```typescript
try {
  const towAlert = await createTowAlert(supabaseAdmin, {...});
  if (towAlert) {
    console.log(`✓ Created tow alert ${towAlert.id}`);
  }
} catch (alertError) {
  console.error(`Failed to create tow alert:`, alertError);
  // Continue with next user, don't block on intelligence system
}
```

---

## Monitoring & Debugging

### Cron Job Response Format
```json
{
  "success": true,
  "message": "Towing check complete",
  "usersChecked": 1250,
  "notificationsSent": 3,
  "notifiedUsers": ["user-id-1", "user-id-2", "user-id-3"]
}
```

### Logging
Every cron run logs:
- Users checked
- Tows found (with inventory numbers)
- SMS sent successfully (with phone number masked)
- Email sent successfully (with email masked)
- Failures and circuit breaker events
- Total notifications sent

Example logs:
```
Checking for towed user vehicles...
Checking 1250 user vehicles...
FOUND TOW: ABC123 (IL) - User: user-uuid-123
✓ SMS sent to ••••••••••7890
✓ Email sent to ••••••••••@gmail.com
✓ Created tow alert 550e8400-e29b-41d4-a716-446655440000 for user user-uuid-123
Already notified user-uuid-456 about tow INV-789
✓ Checked 1250 users, sent 3 notifications
```

### Testing Hooks
Debug scripts available:
- `debug-tow-alert.js` - Manual tow alert creation
- `test-tow-alert-manual.js` - End-to-end test
- `test-towing-alert.js` - Notification test
- `check-cron-health.js` - Cron job health check

---

## Security Considerations

1. **PII Protection**:
   - Phone numbers and emails masked in logs
   - Sensitive data not exposed in error messages
   - Uses `sanitizeErrorMessage()` utility

2. **Rate Limiting**:
   - 1-second delay between user notifications
   - Prevents API rate limit issues
   - Allows circuit breakers to stabilize

3. **Authentication**:
   - CRON_SECRET required in Authorization header
   - Bearer token validation on every cron request
   - Prevents unauthorized cron trigger attempts

4. **RLS Policies**:
   - Users can only see their own tow alerts
   - Contact info not exposed via API
   - Intelligence tables publicly readable (anonymized)

---

## Deployment Notes

### Environment Variables Required
```
CRON_SECRET=<secret-token>
CLICKSEND_USERNAME=<clicksend-username>
CLICKSEND_API_KEY (set in environment)
RESEND_API_KEY (set in environment)
SUPABASE_URL=<supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### Cron Configuration (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/cron/sync-towing-data",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/check-towed-vehicles",
      "schedule": "15 * * * *"
    }
  ]
}
```

Note: Check runs 15 minutes after sync to ensure latest data is available.

---

## Performance Metrics

- **Database Queries**: O(1) lookup by plate using indexed column
- **Cron Job Duration**: ~1-2 minutes for 1,000+ users (depends on SMS/email speeds)
- **API Rate Limits**:
  - ClickSend: 1,000 SMS/day
  - Resend: 100 emails/day (free tier)
  - Chicago API: No rate limits, but returns max 5,000 records

---

## Future Enhancements

1. **Push Notifications**: Add mobile push alerts in addition to SMS/email
2. **Webhook Monitoring**: Listen for tow events via webhooks instead of polling
3. **User Preferences**: More granular notification settings (time windows, priorities)
4. **Batch Processing**: Queue notifications instead of synchronous sending
5. **Tow Contest Automation**: Auto-contest eligible tows based on related tickets
6. **Analytics Dashboard**: Track tow prevention success rates
7. **Integration**: Link to payment processing for immediate fee payment
