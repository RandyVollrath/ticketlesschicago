# Street Cleaning Pipeline - Bug Fix Implementation Plan

## Status Summary

### Completed Fixes
- [x] **BUG #6**: Removed duplicate evening cron hour (vercel.json line 140)
  - Commit: f9f47cc0
  - Impact: Prevents duplicate evening notifications (7 PM + 8 PM CDT)

### Critical Fixes In Progress (Priority Order)

## BUG #1: Fix `getChicagoTime()` - CRITICAL

**File**: `lib/chicago-timezone-utils.ts` lines 11-13  
**Severity**: CRITICAL - Affects ALL hour-based cron logic  
**Impact**: Wrong hour calculation breaks timezone-sensitive notifications

### Root Cause
```typescript
// BROKEN: toLocaleString returns string "MM/DD/YYYY, HH:MM:SS AM/PM"
// When you do new Date(string), it interprets it in SERVER timezone (UTC)
// Result: time is offset by timezone diff (5-6 hours)
export function getChicagoTime(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}
```

### The Fix
Use `Intl.DateTimeFormat` instead of `toLocaleString()` + `new Date()`:

```typescript
/**
 * Get current hour in Chicago (0-23)
 * CORRECT way: uses Intl.DateTimeFormat, not broken toLocaleString() + new Date()
 */
export function getChicagoHour(): number {
  const now = new Date();
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }).format(now)
  );
  return hour;
}

/**
 * Get Chicago date string in ISO format (YYYY-MM-DD)
 * CORRECT way: use Intl.DateTimeFormat to get individual components
 */
export function getChicagoDateISO(): string {
  const now = new Date();
  const year = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric'
    }).format(now)
  );
  const month = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: '2-digit'
    }).format(now)
  );
  const day = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      day: '2-digit'
    }).format(now)
  );

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
```

### Files That Will Benefit
- `pages/api/cron/mobile-parking-reminders.ts` line 319 (BUG #10)
- `pages/api/cron/mobile-parking-reminders.ts` lines 280-296 (BUG #14)
- `pages/api/cron/mobile-parking-reminders.ts` lines 743-749 (BUG #12) 
- Any other code using `getChicagoTime()` for hour comparisons

### Testing After Fix
```bash
# After fixing chicago-timezone-utils.ts, verify these no longer fail:
1. Evening notifications should NOT be sent at 8 PM (removed hour 1)
2. Morning cron at 7 AM should use correct hour (12 UTC)
3. Mobile parking reminders should show correct date for current time
4. Permit zone enforcement should fire at correct time (uses getChicagoTime())
```

---

## BUG #3: Fix Database Views - CRITICAL

**Files**: `consolidate-to-user-profiles-migration.sql` views  
**Severity**: CRITICAL - Targets wrong users for notifications  
**Impact**: Users in 7pm-midnight CT window missed by queries returning 1 day off

### Root Cause
Database views use `CURRENT_DATE` (UTC) instead of Chicago date:

```sql
-- BROKEN: CURRENT_DATE is UTC timezone
CREATE VIEW report_one_day AS
  SELECT ... FROM street_cleaning_schedule scs
  WHERE scs.cleaning_date = CURRENT_DATE + INTERVAL '1 day'
  AND ... ;

-- When it's 11 PM Chicago time (7 AM next day UTC):
-- CURRENT_DATE = tomorrow UTC
-- But we need to compare against today Chicago
-- Result: Query looks 2 days ahead instead of 1
```

### The Fix
Replace all `CURRENT_DATE` with Chicago-aware date calculations:

```sql
-- CORRECT: Use Chicago timezone
CREATE OR REPLACE VIEW report_one_day AS
SELECT 
  up.id,
  up.user_id,
  up.notify_sms,
  up.notify_email,
  up.phone_call_enabled,
  up.notify_days_array,
  scs.cleaning_date,
  scs.ward,
  scs.section,
  ... (other columns)
FROM user_profiles up
JOIN street_cleaning_schedule scs 
  ON up.home_address_ward = scs.ward 
  AND up.home_address_section = scs.section
WHERE 
  -- Fix: Use Chicago date, not UTC CURRENT_DATE
  scs.cleaning_date = (CURRENT_DATE AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day'
  AND up.notify_sms = true
  AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE AT TIME ZONE 'America/Chicago'::date)
  AND 0 = ANY(up.notify_days_array);  -- 0 = 1 day before

CREATE OR REPLACE VIEW report_follow_up AS
SELECT 
  up.id,
  up.user_id,
  up.notify_sms,
  up.notify_email,
  up.phone_call_enabled,
  up.notify_days_array,
  scs.cleaning_date,
  scs.ward,
  scs.section,
  ... (other columns)
FROM user_profiles up
JOIN street_cleaning_schedule scs 
  ON up.home_address_ward = scs.ward 
  AND up.home_address_section = scs.section
WHERE 
  -- Fix: Use Chicago date, not UTC CURRENT_DATE
  scs.cleaning_date = (CURRENT_DATE AT TIME ZONE 'America/Chicago')::date
  AND up.notify_sms = true
  AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE AT TIME ZONE 'America/Chicago'::date)
  AND (0 = ANY(up.notify_days_array) OR NULL = ANY(up.notify_days_array));  -- 0 or NULL = day-of
```

### Step-by-Step Implementation
1. Create migration file: `supabase/migrations/20260323_fix_street_cleaning_views.sql`
2. Drop existing views (CASCADE if needed)
3. Create corrected views with Chicago time zone
4. Test query returns correct users
5. Deploy and verify notifications send at correct times

### Files That Use These Views
- `pages/api/street-cleaning/process.ts` lines 134, 137

### Testing After Fix
```bash
# Test at 11 PM Chicago time (7 AM UTC+1)
1. Query report_one_day should return users for TOMORROW (Chicago time)
2. Query report_follow_up should return users for TODAY (Chicago time)
3. No users should be returned if it's UTC day X but Chicago day X-1
```

---

## BUG #5: Fix Deduplication Window - CRITICAL

**File**: `pages/api/street-cleaning/process.ts` lines 255-264  
**Severity**: CRITICAL - Users get duplicate notifications 12-24h apart  
**Impact**: Same user notified multiple times for same event

### Root Cause
```typescript
// BROKEN: Uses "beginning of today" as cutoff
// At midnight: sent_at >= "2026-03-23 00:00:00"
// But next check 12h later uses NEW "today": sent_at >= "2026-03-23 00:00:00" (same)
// At 1 PM: sent_at >= "2026-03-23 00:00:00" -- old notification OLDER than 12h, gets sent again
const cleaningDate = new Date(scs.cleaning_date);
const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);

const { data: recentNotifs } = await supabaseAdmin
  .from('user_notifications')
  .select('*')
  .eq('user_id', user.id)
  .eq('type', 'street_cleaning_' + cleaningTypeDesc)
  .gte('sent_at', todayStart.toISOString());  // BROKEN: this is 12h wide, not per-date
```

### The Fix
Dedup window should be per-cleaning-date, not per-calendar-day:

```typescript
const cleaningDate = scs.cleaning_date; // e.g., "2026-03-23"
// CORRECT: Use midnight of the CLEANING date, not today
const cleaningDateStart = new Date(cleaningDate + 'T00:00:00Z');

const { data: recentNotifs } = await supabaseAdmin
  .from('user_notifications')
  .select('*')
  .eq('user_id', user.id)
  .eq('type', 'street_cleaning_' + cleaningTypeDesc)
  .eq('cleaning_date', cleaningDate)  // Better: explicit date match
  .gte('sent_at', cleaningDateStart.toISOString());
```

**Even Better**: Add `cleaning_date` column to `user_notifications` table and filter by it directly instead of time window.

### Testing After Fix
```bash
# Send notification at 7 AM for 3/24 cleaning
# Check notification log: sent_at = 2026-03-23T07:00:00, cleaning_date = 2026-03-24

# At 7 PM same day, send again
# Dedup check: cleaning_date match found, skip duplicate
# No notification sent ✓

# Next morning at 7 AM for follow-up
# cleaning_date = 2026-03-24 (same)
# But type = 'street_cleaning_follow_up' (different)
# Send follow-up ✓
```

---

## BUG #10: Fix Mobile Parking Date Extraction - CRITICAL

**File**: `pages/api/cron/mobile-parking-reminders.ts` line 319  
**Severity**: CRITICAL - Mobile push notifications show wrong date (7pm-midnight)  
**Impact**: Users see incorrect cleaning schedule timing during evening hours

### Root Cause
Uses broken `getChicagoTime()`, then extracts date via `toISOString()`:

```typescript
// BROKEN: getChicagoTime() returns UTC+offset Date object
// toISOString() then reads UTC time, extracting wrong date during evening
const today = chicagoTime.toISOString().split('T')[0];
// At 11 PM Chicago (7 AM UTC), chicagoTime is off by 6h
// toISOString() extracts UTC date (next day)
// Result: today = "2026-03-24" but Chicago today is "2026-03-23"
```

### The Fix
Use the already-fixed `getChicagoDateISO()` function:

```typescript
// CORRECT: Returns Chicago date string directly
const today = getChicagoDateISO();  // "2026-03-23"
// No timezone conversion needed, already in Chicago format
```

### Files to Update
- Import: `import { getChicagoDateISO } from '../../lib/chicago-timezone-utils';`
- Line 319: Change `const today = chicagoTime.toISOString().split('T')[0];`
           To: `const today = getChicagoDateISO();`

### Testing After Fix
```bash
# Test at 11 PM Chicago (7 AM UTC)
# Mobile push should show street cleaning for TODAY
# Before fix: would show TOMORROW
```

---

## BUG #4: Add SMS Check to Voice Calls - HIGH

**File**: `pages/api/street-cleaning/process.ts` lines 413-430  
**Severity**: HIGH - Voice calls sent even when SMS disabled  
**Impact**: User gets unwanted calls despite disabling SMS notifications

### Root Cause
Voice call logic doesn't check `notify_sms` flag:

```typescript
// BROKEN: Sends voice call regardless of SMS preference
if (user.phone_call_enabled && user.phone) {
  await sendClickSendVoiceCall(...);
}
```

### The Fix
Add SMS preference check (voice call is audio version of SMS):

```typescript
// CORRECT: Only send voice if user enabled SMS notifications
// Voice is just audio version of SMS, should respect SMS preference
if (user.phone_call_enabled && user.phone && user.notify_sms !== false) {
  // User wants SMS notifications, so voice calls are OK
  await sendClickSendVoiceCall(...);
  // OR could be AND with email: (user.notify_sms !== false || user.notify_email !== false)
}
```

### Testing After Fix
```bash
# Create test user: notify_sms=false, phone_call_enabled=true
# Run street cleaning cron
# Verify: SMS not sent, voice call not sent
# Compare with notify_sms=true: both SMS and voice sent
```

---

## BUG #7: Fix Canary User Follow-Up Logic - HIGH

**File**: `pages/api/street-cleaning/process.ts` lines 186-214 (canary section)  
**Severity**: HIGH - Canary follow-ups don't fire on weekends  
**Impact**: Testing notifications broken on Sat/Sun

### Root Cause
Follow-up type always uses `daysToAdd` calculation, which skips weekends:

```typescript
// BROKEN: follow_up uses same logic as other types
} else if (type === 'follow_up') {
  const nextCleaning = streetCleaningScheduleMatches.find(m => m.daysUntil === 1);
  if (!nextCleaning) return;
  
  // daysToAdd comes from schedule calculation that skips non-cleaning days
  // On weekend, there's no next cleaning, so daysToAdd is undefined
  // Result: follow-up never fires on weekends
  daysUntil = daysToAdd;  // Could be 0, 1, 2, or undefined on weekends
}
```

### The Fix
Follow-up should fire day-of cleaning, regardless of schedule:

```typescript
} else if (type === 'follow_up') {
  // Follow-up fires on the actual cleaning date, not based on schedule
  // For canaries, we send it same day as cleaning event
  daysUntil = 0;  // Always today for follow-up
}
```

**Or better**: Add special canary follow-up flag that ignores schedule logic entirely.

---

## BUG #8: Fix notify_days_array Default - HIGH

**File**: `pages/api/street-cleaning/process.ts` line 299  
**Severity**: HIGH - View returns users that then get skipped  
**Impact**: Some users who should get notifications are filtered out

### Root Cause
Default doesn't match what view returns:

```typescript
// BROKEN: Defaults to [0] but view includes NULL
// If user.notify_days_array is NULL, defaults to [0]
// But view's WHERE clause includes NULL: "NULL = ANY(notify_days_array)"
// Result: View returns user, but filter rejects them
const notifyDays = user.notify_days_array || [0];
// Then later: if (!notifyDays.includes(daysUntil)) return;
// If notifyDays=[0] but daysUntil=1, user gets skipped
```

### The Fix
Change default to match view logic (include day-before):

```typescript
// CORRECT: Default to both [0, 1] to match view
// 0 = day of cleaning, 1 = day before
const notifyDays = user.notify_days_array || [0, 1];

// Now filter works:
// Evening cron (1 day before): daysUntil=1, notifyDays includes 1 → sent
// Morning cron (day of): daysUntil=0, notifyDays includes 0 → sent
```

---

## BUG #14: Fix Permit Zone Enforcement Time - HIGH

**File**: `pages/api/cron/mobile-parking-reminders.ts` lines 280-296  
**Severity**: HIGH - Permit alerts fire 6 hours off  
**Impact**: Permit zone parking alerts at wrong time

### Root Cause
Uses broken `getChicagoTime()` to calculate enforcement timing:

```typescript
// BROKEN: getChicagoTime() is 6h off
const currentTime = getChicagoTime();
// currentTime is actually (UTC - 6h), not Chicago time
// Enforcement time comparison uses broken time
// Result: alerts fire at wrong hour
```

### The Fix
Use correct Intl.DateTimeFormat approach:

```typescript
// CORRECT: Get actual Chicago hour and minute
const now = new Date();
const chicagoHour = parseInt(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false
  }).format(now)
);
const chicagoMinute = parseInt(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    minute: '2-digit'
  }).format(now)
);
const currentTimeMinutes = chicagoHour * 60 + chicagoMinute;

// Now enforcement time check is accurate
const isEnforcementTime = currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes;
```

---

## Remaining Issues (Lower Priority)

### BUG #2: Evening Reminder Timing - Already OK
- No change needed, cron and query logic are correct after BUG #6 fix

### BUG #9: "Street Cleaning Now" Alert Never Fires - LOW
- Cron doesn't run at 6 AM when `is_now` would be true
- Fix: Add 6 AM cron or adjust logic to fire at 7 AM instead

### BUG #11: Sweeper Error Handling - MEDIUM
- Replace fragile string matching with error codes
- Use `error.code === 'PGRST116'` instead of message matching

### BUG #12: Vehicle Cleanup UTC Time - MEDIUM  
- Vehicle deactivation uses UTC cutoff, should use Chicago time
- Adjust timezone offset in calculation

### BUG #13: Call Alert Window Too Narrow - MEDIUM
- 15-minute window with 15-minute cron can miss alerts
- Increase window to ±15 minutes

### BUG #15: Zone Number String Comparison - MEDIUM
- Parse both to integer for reliable comparison
- Use `parseInt(homeZone, 10) === parseInt(parkedZone, 10)`

---

## Deployment Checklist

After implementing each fix:

1. [ ] Verify no TypeScript compilation errors
2. [ ] Run relevant cron handlers in test environment
3. [ ] Check notification logs for correct dates/times
4. [ ] Verify deduplication prevents double-sends
5. [ ] Test on both iOS and Android if mobile-specific
6. [ ] Deploy to production via `npx vercel --prod`
7. [ ] Monitor logs for 24 hours post-deployment
8. [ ] Document in git commit with detailed explanation

---

## References

- Full audit: `STREET_CLEANING_PIPELINE_AUDIT.md`
- Quick reference: `STREET_CLEANING_BUGS_QUICK_REFERENCE.md`
- Code patterns: `pages/api/street-cleaning/process.ts` (correct implementations)
