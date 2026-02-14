# Street Cleaning System - Quick Reference

## Files to Know

| File | Purpose |
|------|---------|
| `lib/street-cleaning-schedule-matcher.ts` | Main GPS lookup & schedule matching |
| `pages/api/get-street-cleaning-data.ts` | API endpoint for map data |
| `pages/api/street-cleaning/process.ts` | Cron job for SMS/email notifications |
| `database/create-enhanced-spatial-functions.sql` | PostGIS functions |
| `lib/contest-kits/street-cleaning.ts` | Legal defense kit (9-64-010) |
| `add-street-cleaning-migration-correct.sql` | Full database schema |
| `scripts/import-street-cleaning-csv.js` | CSV importer |

## Database Tables

### MyStreetCleaning DB
- `street_cleaning_schedule` - Ward/Section/Date combinations with geometry

### Ticketless America DB  
- `user_profiles` - User street cleaning preferences
- `user_addresses` - Multiple addresses per user
- `user_notifications` - Audit trail of sent notifications
- `sms_logs` / `email_logs` - Delivery tracking

## How It Works: 3 Steps

### Step 1: Location → Ward/Section
```
User GPS coordinates (lat, lng)
↓ PostGIS spatial query (50m buffer)
↓ find street_cleaning_schedule with ST_DWithin
↓ Returns: Ward, Section
```

### Step 2: Ward/Section → Next Cleaning Date
```
Ward + Section
↓ Query street_cleaning_schedule table
↓ Find first row where cleaning_date >= today
↓ Returns: ISO date (e.g., "2025-01-20")
```

### Step 3: Calculate Timing & Send Notification
```
Next cleaning date - today = days_until
↓ Severity: critical (0-4 hrs), warning (today), info (week), none
↓ Send SMS/email/voice call per user preferences
```

## Key Constraints

| Item | Value | Location |
|------|-------|----------|
| Search radius | 50 meters | `street-cleaning-schedule-matcher.ts:82` |
| Assumed cleaning time | 9:00 AM | `street-cleaning-schedule-matcher.ts:122` |
| "Critical" threshold | 4 hours | `street-cleaning-schedule-matcher.ts:129` |
| Cron 1 | 7:00 AM Chicago | `pages/api/street-cleaning/process.ts:61` |
| Cron 2 | 3:00 PM Chicago | `pages/api/street-cleaning/process.ts:64` |
| Cron 3 | 7:00 PM Chicago | `pages/api/street-cleaning/process.ts:67` |

## Notification User Preferences

```typescript
{
  home_address_ward: string,        // Ward number
  home_address_section: string,     // Section letter/number
  notify_days_array: [0,1,2,3],    // Send alerts 0/1/2/3 days before
  notify_evening_before: boolean,   // Send 7pm alert (tomorrow)
  notify_sms: boolean,              // Send SMS (default)
  notify_email: boolean,            // Send email (default)
  phone_call_enabled: boolean,      // Send voice call
  snooze_until_date: date          // Temporary disable
}
```

## Data Flow: Imports

```
Chicago's PDF schedule (manual source)
    ↓
CSV file: ward, section, cleaning_date
    ↓
import-street-cleaning-csv.js
    ↓
INSERT into street_cleaning_schedule (MSC DB)
    ↓
App queries for real-time checks
```

## Common Queries

### Get all cleaning dates for Ward 1, Section A (next 30 days)
```sql
SELECT cleaning_date FROM street_cleaning_schedule
WHERE ward = '1' AND section = 'A'
AND cleaning_date >= CURRENT_DATE
ORDER BY cleaning_date
LIMIT 30;
```

### Get users due for notification at 7am
```sql
SELECT * FROM user_profiles
WHERE home_address_ward IS NOT NULL
AND notify_days_array @> ARRAY[0]  -- 0 days before = today
AND (snooze_until_date IS NULL OR snooze_until_date < CURRENT_DATE);
```

### Check if location has street cleaning (GPS)
```sql
SELECT ward, section FROM street_cleaning_schedule
WHERE ST_DWithin(
  ST_SetSRID(ST_MakePoint(-87.6298, 41.8781), 4326)::geography,
  geom_simplified::geography,
  50
)
LIMIT 1;
```

## Common Issues & Fixes

### Issue: "No street cleaning zone found at location"
**Cause:** geom_simplified is NULL for that zone  
**Fix:** Run migration to populate geometry data

### Issue: Users getting alerts at wrong time
**Cause:** Chicago timezone calculation error  
**Fix:** Check `chicago-timezone-utils.ts` - uses `Intl.DateTimeFormat` correctly

### Issue: Old cleaning dates showing as active
**Cause:** Sunday dates (9 am - 2 pm cleanings don't happen Sunday)  
**Fix:** Filter applied in `get-street-cleaning-data.ts:98-106`

### Issue: GPS lookup failing
**Cause:** User too far from zone boundary (>50m)  
**Fix:** Fall back to ward/section lookup if user has home address

## Legal Reference

- **Chicago Ordinance:** 9-64-010 (Street Cleaning)
- **Fine:** $60
- **Win Rate:** ~34% (relatively high)
- **Strongest Defense:** Missing/obscured signage (45% win)
- **Secondary Defense:** Weather conditions (40% win)

## Performance Notes

- Spatial queries use GIST index on geom_simplified
- Composite index on (ward, section, cleaning_date) for range queries
- Pagination at 1000 rows for large result sets (see `get-street-cleaning-data.ts:43-58`)

