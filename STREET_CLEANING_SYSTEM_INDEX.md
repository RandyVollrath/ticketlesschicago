# Street Cleaning System - Complete Documentation Index

This index provides a comprehensive guide to understanding the street cleaning implementation in ticketless-chicago.

## Quick Start

1. **First Time?** Read `/home/randy-vollrath/ticketless-chicago/STREET_CLEANING_QUICK_REFERENCE.md` (5 min read)
2. **Need Details?** Read `/home/randy-vollrath/ticketless-chicago/STREET_CLEANING_DATA_SOURCES.md` (20 min read)
3. **Looking for Code?** Jump to "Source Files" section below

---

## Documentation Files

### Reference Guides (NEW)

| File | Purpose | Length | Read Time |
|------|---------|--------|-----------|
| `STREET_CLEANING_QUICK_REFERENCE.md` | Quick lookup, common queries, troubleshooting | 152 lines | 5 min |
| `STREET_CLEANING_DATA_SOURCES.md` | Comprehensive analysis with all implementation details | 493 lines | 20 min |
| `STREET_CLEANING_SYSTEM_INDEX.md` | This file - navigation guide | - | 5 min |

### Original Documentation

| File | Purpose |
|------|---------|
| `docs/analysis/MYSTREETCLEANING_INTEGRATION.md` | Integration details with MyStreetCleaning.com |

---

## Source Files by Function

### Core Implementation
- **Location Matcher**: `/home/randy-vollrath/ticketless-chicago/lib/street-cleaning-schedule-matcher.ts`
  - Primary GPS-to-ward/section conversion
  - Schedule lookups
  - Timing calculations

- **Unified Checker**: `/home/randy-vollrath/ticketless-chicago/lib/unified-parking-checker.ts`
  - Integrates street cleaning with other parking restrictions
  - One-call solution for all checks

### API Endpoints
- **Map Data**: `/home/randy-vollrath/ticketless-chicago/pages/api/get-street-cleaning-data.ts`
  - Returns all zones with geometry for map display
  - Handles pagination for large result sets

- **Cron Job**: `/home/randy-vollrath/ticketless-chicago/pages/api/street-cleaning/process.ts`
  - Executes at 7am, 3pm, 7pm Chicago time
  - Sends SMS/email/voice notifications
  - Filters by user preferences

### Database & Schema
- **Complete Migration**: `/home/randy-vollrath/ticketless-chicago/add-street-cleaning-migration-correct.sql`
  - Full schema for both databases
  - Triggers and functions
  - RLS policies

- **PostGIS Functions**: `/home/randy-vollrath/ticketless-chicago/database/create-enhanced-spatial-functions.sql`
  - `get_street_cleaning_at_location_enhanced()`
  - Spatial queries with distance calculations

- **PostGIS Setup**: `/home/randy-vollrath/ticketless-chicago/add-postgis-function.sql`
  - `find_section_for_point()`
  - Basic spatial queries

- **Distance Function**: `/home/randy-vollrath/ticketless-chicago/calculate_distance_from_point.sql`
  - PostGIS distance calculations
  - Zone boundary matching

### Data Import
- **CSV Importer**: `/home/randy-vollrath/ticketless-chicago/scripts/import-street-cleaning-csv.js`
  - Reads manually maintained CSV
  - Validates and imports data
  - No automated updates

### Legal / Contest
- **Street Cleaning Kit**: `/home/randy-vollrath/ticketless-chicago/lib/contest-kits/street-cleaning.ts`
  - Chicago Ordinance 9-64-010
  - Contest arguments (signage, weather, vehicle moved, etc.)
  - Evidence types and win rates (34% historical)

### Supporting Libraries
- **Timezone Utilities**: `/home/randy-vollrath/ticketless-chicago/lib/chicago-timezone-utils.ts`
  - Correct Chicago time calculations for cron jobs
  - Uses `Intl.DateTimeFormat` (not `new Date()` parsing)

- **Ordinances Database**: `/home/randy-vollrath/ticketless-chicago/lib/chicago-ordinances.ts`
  - Ordinance definitions
  - Win rates by violation code

---

## Key Concepts

### Two-Step Location Matching
1. **GPS → Ward/Section** (PostGIS spatial query, 50m buffer)
2. **Ward/Section → Cleaning Date** (Schedule table query)

### Database Architecture
- **MyStreetCleaning DB** (separate project)
  - `street_cleaning_schedule` - Zones with geometry & dates
- **Ticketless America DB** (main project)
  - `user_profiles` - User preferences
  - `user_addresses` - Multiple addresses per user
  - `user_notifications` - Audit trail

### Data Flow
```
Chicago PDFs (manual)
    ↓
CSV file (ward, section, cleaning_date)
    ↓
import-street-cleaning-csv.js
    ↓
street_cleaning_schedule table
    ↓
API queries (GPS or ward/section)
    ↓
Notifications (SMS/email/voice)
```

### Notification System
- **Timing**: 7am (morning), 3pm (follow-up), 7pm (evening before)
- **User Controls**: notify_days_array [0,1,2,3], snooze_until_date, channel preferences
- **Channels**: SMS, Email, Voice calls (ClickSend)

---

## FAQ

### Q: Where is street cleaning data stored?
A: In the **MyStreetCleaning Supabase database**, separate from Ticketless America. Table: `street_cleaning_schedule`

### Q: How does GPS matching work?
A: PostGIS `ST_DWithin()` function searches for zones within 50 meters, returns ward/section. Uses `geom_simplified` column for efficiency.

### Q: Are temporary and permanent signs distinguished?
A: **No.** The system treats all entries the same. Chicago uses recurring permanent schedules pre-calculated into individual date rows.

### Q: How is Chicago's street cleaning data imported?
A: **Manually.** CSV file with (ward, section, cleaning_date) is imported via `import-street-cleaning-csv.js`. No automated PDF parsing.

### Q: What time is assumed for cleaning?
A: **9:00 AM** (hardcoded in `street-cleaning-schedule-matcher.ts` line 122).

### Q: What's the win rate for contesting street cleaning tickets?
A: **34%** historically. Strongest defense: missing/obscured signage (45% win rate).

---

## Common Queries & Tasks

### Run Street Cleaning Importer
```bash
cd /home/randy-vollrath/ticketless-chicago
node scripts/import-street-cleaning-csv.js
```

### Check Cleaning Schedule for Ward/Section
```sql
SELECT cleaning_date FROM street_cleaning_schedule
WHERE ward = '1' AND section = 'A'
AND cleaning_date >= CURRENT_DATE
ORDER BY cleaning_date
LIMIT 10;
```

### Get Users Due for Notification (7am)
```sql
SELECT * FROM user_profiles
WHERE home_address_ward IS NOT NULL
AND notify_days_array @> ARRAY[0]  -- 0 = today
AND (snooze_until_date IS NULL OR snooze_until_date < CURRENT_DATE);
```

### Test GPS-Based Lookup
```sql
SELECT ward, section FROM street_cleaning_schedule
WHERE ST_DWithin(
  ST_SetSRID(ST_MakePoint(-87.6298, 41.8781), 4326)::geography,
  geom_simplified::geography,
  50
)
LIMIT 1;
```

---

## Troubleshooting Guide

| Issue | Cause | Solution |
|-------|-------|----------|
| "No street cleaning zone found" | geom_simplified is NULL | Populate geometry data |
| GPS lookup failing | User >50m from zone boundary | Fall back to ward/section lookup |
| Wrong notification times | Chicago timezone calculation | Check chicago-timezone-utils.ts |
| Old dates showing as active | Sunday dates included | Filtered in get-street-cleaning-data.ts:98-106 |
| No data updates | Manual import not run | Run import-street-cleaning-csv.js |

---

## Performance Considerations

- **Spatial Index**: GIST index on `geom_simplified` for fast zone lookups
- **Composite Index**: (ward, section, cleaning_date) for schedule queries
- **Pagination**: Results paginated at 1000 rows (see get-street-cleaning-data.ts:43-58)
- **Caching**: Consider caching zone data since geometry rarely changes

---

## Integration Points

### Mobile App
- Uses GPS-based lookup
- Real-time zone identification
- Push notifications for alerts

### Web App
- Address-based lookup
- Pre-saved user addresses
- Email/SMS notifications

### Admin Tools
- Manual data import (CSV)
- User notification logs
- Contest tracking (9-64-010)

---

## Legal Reference

- **Chicago Ordinance**: 9-64-010 (Street Cleaning Violations)
- **Fine Amount**: $60
- **Contest Deadline**: 21 days
- **Win Rate**: ~34% (relatively high for parking violations)

---

## Environment Variables

```bash
# MyStreetCleaning Database
MSC_SUPABASE_URL=https://[project].supabase.co
MSC_SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Main Database
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## Related Documentation

- `lib/chicago-ordinances.ts` - All parking violation ordinances
- `lib/contest-kits/street-cleaning.ts` - Contest kit with arguments
- `lib/unified-parking-checker.ts` - Unified restriction checker
- `docs/analysis/MYSTREETCLEANING_INTEGRATION.md` - Integration details

---

Last Updated: 2026-01-22
Created as part of street cleaning system analysis
