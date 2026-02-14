# MyStreetCleaning (MSC) Supabase Database Audit Report

## Executive Summary

The codebase currently uses **TWO separate Supabase databases**:

1. **Main AA (Autopilot America) database** - Primary app database (NEXT_PUBLIC_SUPABASE_URL)
2. **MyStreetCleaning (MSC) database** - Contains street cleaning zone data (MSC_SUPABASE_URL)

**Key Finding:** The `street_cleaning_schedule` table EXISTS IN BOTH databases, but:
- MSC database: Contains full spatial data (geometry, PostGIS functions)
- AA database: Contains the same table structure for compatibility (read-only usage)

---

## Files Using MSC Database

### 1. Library Files

#### `/lib/street-cleaning-schedule-matcher.ts`
**Type:** READ-ONLY | Database: MSC | Table: street_cleaning_schedule

**Purpose:** Converts GPS coordinates to street cleaning schedule timing; used for mobile app

**Operations:**
- Uses PostGIS RPC: `get_nearest_street_cleaning_zone(lat, lng, max_distance_meters)`
- Queries: ward, section, cleaning_date

**Key Code:**
```typescript
const MSC_URL = process.env.MSC_SUPABASE_URL;
const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
let mscSupabase = createClient(MSC_URL, MSC_KEY);
// Calls: mscSupabase.rpc('get_nearest_street_cleaning_zone', {...})
// Queries: street_cleaning_schedule with eq('ward'), eq('section'), gte('cleaning_date')
```

---

### 2. API Endpoints

#### `/pages/api/validate-address.ts`
**Type:** READ-ONLY | Database: MSC | Table: street_cleaning_schedule (via RPC)

**Purpose:** Validates Chicago addresses during signup; looks up ward/section from coordinates

**Operations:**
- Uses RPC: `find_section_for_point(lon, lat)` - Returns ward/section for coordinates
- SELECT operations only

**Key Code:**
```typescript
const mscSupabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_ANON_KEY);
const { data, error } = await mscSupabase.rpc('find_section_for_point', {lon: lng, lat: lat});
```

---

#### `/pages/api/get-street-cleaning-data.ts`
**Type:** READ-ONLY | Database: MSC | Table: street_cleaning_schedule

**Purpose:** Bulk fetch of all street cleaning zones for map visualization

**Operations:**
- Handles pagination (1000+ rows)
- SELECT (ward, section, geom_simplified, cleaning_date)
- Filters out invalid Sunday dates

**Key Code:**
```typescript
const mscSupabase = createClient(MSC_URL, MSC_KEY);
const { data: firstBatch, error: allZonesError, count } = await mscSupabase
  .from('street_cleaning_schedule')
  .select('ward, section, geom_simplified', { count: 'exact' })
  .not('geom_simplified', 'is', null)
  .range(0, 999);
```

---

#### `/pages/api/find-section.ts`
**Type:** READ-ONLY | Database: MSC | Table: street_cleaning_schedule

**Purpose:** Main endpoint for finding street cleaning info by address; supports single date or date range queries

**Operations:**
- PostGIS lookup: `find_section_for_point`
- Geometry query for zone boundaries
- Schedule query for next cleaning date
- Date range queries for trip planning

**Key Code:**
```typescript
const mscSupabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_ANON_KEY);
const result = await mscSupabase.rpc('find_section_for_point', {lon: coordinates.lng, lat: coordinates.lat});
const { data: geometryData } = await mscSupabase
  .from('street_cleaning_schedule')
  .select('geom_simplified')
  .eq('ward', foundWard)
  .eq('section', foundSection);
```

---

#### `/pages/api/find-alternative-parking.ts`
**Type:** READ-ONLY | Database: MSC | Table: street_cleaning_schedule

**Purpose:** Finds safe parking alternatives without cleaning conflicts; uses haversine distance

**Operations:**
- Fetches all zones (deduplicated ward-section)
- Gets geometry for distance calculations
- Queries cleaning schedule for conflict detection

**Key Code:**
```typescript
const { data: allZones } = await mscSupabase
  .from('street_cleaning_schedule')
  .select('ward, section');
const { data: zoneGeoms } = await mscSupabase
  .from('street_cleaning_schedule')
  .select('ward, section, geom_simplified')
  .not('geom_simplified', 'is', null);
```

---

#### `/pages/api/get-zone-geometry.ts`
**Type:** READ-ONLY | Database: MSC | Table: street_cleaning_schedule

**Purpose:** Returns GeoJSON features for map zones; includes street boundaries

**Operations:**
- Batch geometry fetch by ward/section
- Queries block boundaries (north_block, south_block, east_block, west_block)
- Gets next cleaning date for status

**Key Code:**
```typescript
const { data: geometryData } = await mscSupabase
  .from('street_cleaning_schedule')
  .select('geom_simplified, ward, section, cleaning_date, north_block, south_block, east_block, west_block')
  .eq('ward', zone.ward)
  .eq('section', zone.section)
  .not('geom_simplified', 'is', null);
```

---

#### `/pages/api/get-cleaning-schedule.ts`
**Type:** READ-ONLY | Database: **MAIN AA** (not MSC) | Table: street_cleaning_schedule

**Purpose:** Simple schedule query by ward/section

**Operations:**
- SELECT (cleaning_date)
- Basic filtering by ward/section

**Key Code:**
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const { data, error } = await supabase
  .from('street_cleaning_schedule')
  .select('cleaning_date')
  .eq('ward', ward)
  .eq('section', section);
```

---

#### `/pages/api/street-cleaning/process.ts` (CRON JOB)
**Type:** MIXED | Database: MAIN AA | Tables: street_cleaning_schedule (READ), user_notifications (WRITE)

**Purpose:** Daily scheduled notifications for users about upcoming street cleaning (7am, 3pm, 7pm Chicago time)

**Operations:**
- READ from street_cleaning_schedule (gets next cleaning date for each user)
- WRITE to user_notifications (logs notification sent)

**Key Code:**
```typescript
// READ from street_cleaning_schedule:
const { data: schedule } = await supabase
  .from('street_cleaning_schedule')
  .select('cleaning_date')
  .eq('ward', user.home_address_ward)
  .eq('section', user.home_address_section)
  .gte('cleaning_date', minDate.toISOString());

// WRITE to user_notifications:
await supabase
  .from('user_notifications')
  .insert({
    user_id: userId,
    notification_type: 'street_cleaning',
    sent_at: new Date().toISOString(),
    status: 'sent',
    ward: ward,
    section: section,
    cleaning_date: cleaningDate.toISOString()
  });
```

---

## Summary Table

| File | Database | Table(s) | Read/Write | Primary Function |
|------|----------|----------|-----------|------------------|
| `lib/street-cleaning-schedule-matcher.ts` | MSC | street_cleaning_schedule | READ | GPS to schedule matching |
| `pages/api/validate-address.ts` | MSC | street_cleaning_schedule | READ | Address validation lookup |
| `pages/api/get-street-cleaning-data.ts` | MSC | street_cleaning_schedule | READ | Map zone visualization |
| `pages/api/find-section.ts` | MSC | street_cleaning_schedule | READ | Main address-to-schedule endpoint |
| `pages/api/find-alternative-parking.ts` | MSC | street_cleaning_schedule | READ | Safe parking finder |
| `pages/api/get-zone-geometry.ts` | MSC | street_cleaning_schedule | READ | Zone GeoJSON + boundaries |
| `pages/api/get-cleaning-schedule.ts` | AA | street_cleaning_schedule | READ | Simple schedule query |
| `pages/api/street-cleaning/process.ts` | AA | street_cleaning_schedule + user_notifications | READ + WRITE | Notification cron job |

---

## Write Operations Summary

**IMPORTANT:** No files write TO the MSC database. All writes are to the MAIN AA database:

- **`pages/api/street-cleaning/process.ts`**: Writes to `user_notifications` table in AA database for logging notifications (NOT to street_cleaning_schedule)

---

## Environment Variables Required

**For MSC Database:**
```
MSC_SUPABASE_URL=https://zqljxkqdgfibfzdjfjiq.supabase.co
MSC_SUPABASE_ANON_KEY=<anon key>
MSC_SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

**For Main AA Database:**
```
NEXT_PUBLIC_SUPABASE_URL=<main db url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

---

## Migration Risk Assessment

### LOW RISK FACTORS:
✅ **No write operations** to MSC database (only reads)
✅ **Single table dependency** (only street_cleaning_schedule)
✅ **Well-contained** - 7 files using MSC (not counting the 1 using AA)
✅ **Standardized queries** - Simple eq, gte, lte filters, no complex joins
✅ **Target table exists in AA database** - schema already synced
✅ **No custom app logic** - only uses standard PostGIS RPCs

### MIGRATION REQUIREMENTS:
⚠️ **PostGIS RPC functions** must exist in target database:
   - `find_section_for_point(lon, lat)` - Returns ward/section for coordinates
   - `get_nearest_street_cleaning_zone(lat, lng, max_distance_meters)` - Finds nearest zone

⚠️ **Geometry columns** must support PostGIS types:
   - `geom` (full geometry polygon)
   - `geom_simplified` (simplified for performance)

⚠️ **Performance considerations**:
   - MSC database has optimized PostGIS indexes
   - get-street-cleaning-data.ts requires handling 1000+ zones with pagination
   - Alternative parking queries scan all unique zones for distance calculation

⚠️ **Data consistency**:
   - Street cleaning schedules need to be identical in both databases
   - No real-time sync between databases currently exists
   - Migration must ensure all data is copied before switch

---

## Recommended Migration Steps

### Phase 1: Pre-Migration Checks
1. **Verify schema in AA database**
   - Confirm all street_cleaning_schedule columns exist
   - Verify PostGIS geometry columns (geom, geom_simplified)
   - Check spatial indexes exist

2. **Verify RPC functions in AA database**
   - Create/deploy PostGIS RPC functions:
     - `find_section_for_point(lon, lat)`
     - `get_nearest_street_cleaning_zone(lat, lng, max_distance_meters)`

### Phase 2: Data Migration
3. **Sync data from MSC to AA**
   - Copy all street_cleaning_schedule records from MSC to AA
   - Verify row counts match
   - Spot-check random ward/section combinations for data accuracy

4. **Verify spatial data**
   - Test geom and geom_simplified columns
   - Run PostGIS queries to ensure geometry is valid
   - Verify block boundary fields (north_block, south_block, etc.)

### Phase 3: Code Changes
5. **Update environment configuration**
   - Remove MSC_SUPABASE_* variables from production .env
   - Verify AA database credentials are correct

6. **Refactor code** (optional but cleaner)
   - Update `/lib/street-cleaning-schedule-matcher.ts` to use main supabase client
   - Update `/pages/api/validate-address.ts` to use main supabase client
   - Update `/pages/api/get-street-cleaning-data.ts` to use main supabase client
   - Update `/pages/api/find-section.ts` to use main supabase client
   - Update `/pages/api/find-alternative-parking.ts` to use main supabase client
   - Update `/pages/api/get-zone-geometry.ts` to use main supabase client

### Phase 4: Testing
7. **Test all affected endpoints**
   - Test address validation with multiple Chicago addresses
   - Verify map rendering with zones
   - Test alternative parking suggestions
   - Run notification cron job
   - Verify GPS-based schedule matching from mobile app
   - Test date range queries for trip planning

### Phase 5: Deployment
8. **Deploy with monitoring**
   - Deploy code changes with A/B testing or gradual rollout if possible
   - Monitor error logs for any failed queries
   - Monitor API response times for performance regression
   - Verify all notification cron jobs succeed
   - Check user complaints/feedback channels

---

## Rollback Plan

If migration fails:
1. Revert code changes
2. Re-enable MSC_SUPABASE_* environment variables
3. Verify all endpoints work with MSC database again
4. Investigate root cause before retry

---

## Files That DO NOT Use Street Cleaning

Most API files in the codebase don't reference street cleaning at all. Files that use `supabase` (main AA database) for other purposes are unaffected by this migration and require no changes.

Examples of unaffected modules:
- Contest/ticket contesting (uses contest tables)
- Property tax appeals (uses property_tax tables)
- Autopilot checking (uses plates, vehicles tables)
- User profiles/authentication (uses user tables)
- SMS/notification system (uses phone, messages tables)
- Reimbursement tracking (uses reimbursement tables)
