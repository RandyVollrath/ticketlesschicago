# Street Cleaning Data Sources and Implementation Analysis

## Overview
The ticketless-chicago codebase implements a comprehensive street cleaning detection system that:
- Connects to the MyStreetCleaning.com Supabase database (separate from main Ticketless America DB)
- Uses PostGIS spatial queries to match GPS coordinates to street cleaning zones
- Stores ward/section-based cleaning schedules
- Provides real-time alerts via SMS, email, and voice calls

---

## 1. STREET CLEANING CHECKER IMPLEMENTATION

### Primary Function: `matchStreetCleaningSchedule()`
**File:** `/home/randy-vollrath/ticketless-chicago/lib/street-cleaning-schedule-matcher.ts`

#### How It Works:
1. **GPS-Based Zone Lookup (Spatial Query)**
   - Takes latitude/longitude coordinates
   - Uses PostGIS function `get_nearest_street_cleaning_zone()`
   - Searches within 50 meters for matching zone
   - Returns ward and section for the location

2. **Schedule Query by Ward/Section**
   ```typescript
   // Query the street_cleaning_schedule table
   .from('street_cleaning_schedule')
   .select('cleaning_date')
   .eq('ward', ward)
   .eq('section', section)
   .gte('cleaning_date', todayISO)
   .order('cleaning_date', { ascending: true })
   .limit(1)
   ```

3. **Timing Calculation**
   - Assumes 9am start time (hardcoded)
   - Calculates `days_until` and `hours_until`
   - Determines severity: critical (4 hours or less), warning (same day), info (this week), none

### Output Structure:
```typescript
interface StreetCleaningMatch {
  found: boolean;
  ward: string | null;
  section: string | null;
  nextCleaningDate: string | null;  // ISO date string
  timing: {
    is_now: boolean;                 // Within 4 hours
    is_today: boolean;
    is_tomorrow: boolean;
    is_this_week: boolean;
    days_until: number;
    hours_until: number;
    relative_description: string;
  };
  severity: 'critical' | 'warning' | 'info' | 'none';
  message: string;
}
```

### Secondary Function: `getStreetCleaningByWardSection()`
- Alternative lookup if ward/section already known (e.g., from user profile)
- Useful for already-parsed addresses
- Same query logic, no spatial lookup needed

---

## 2. MYSTREETCLEANING SUPABASE DATABASE SCHEMA

### Key Tables in MSC Database

#### `street_cleaning_schedule` (Main Table)
**Location:** MyStreetCleaning Supabase (separate from Ticketless America)

```sql
CREATE TABLE street_cleaning_schedule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ward text NOT NULL,
    section text NOT NULL,
    cleaning_date date NOT NULL,
    street_name text,
    side text,
    
    -- Geographic boundaries
    east_block text,
    west_block text,
    north_block text,
    south_block text,
    
    -- Detailed boundary information
    east_street text,
    east_block_number text,
    east_direction text,
    west_street text,
    west_block_number text,
    west_direction text,
    north_street text,
    north_block_number text,
    north_direction text,
    south_street text,
    south_block_number text,
    south_direction text,
    
    -- Composite key
    ward_section text,
    
    -- PostGIS Geometry Column
    geom_simplified GEOMETRY(Geometry, 4326),
    geom GEOMETRY (POLYGON, 4326),
    
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Indexes
CREATE INDEX street_cleaning_composite_idx 
  ON street_cleaning_schedule(ward, section, cleaning_date);
CREATE INDEX street_cleaning_geom_simple_idx 
  ON street_cleaning_schedule USING GIST(geom_simplified);
```

**Key Observations:**
- Each row represents a zone (ward + section combination) on a specific date
- One entry per cleaning date per zone
- `geom_simplified` is the spatial column used for PostGIS queries (30m buffer)
- `geom` is the full polygon boundary

---

## 3. SIGN TYPE DISTINCTIONS: Temporary vs. Permanent

### Current Implementation Status: **NOT DISTINGUISHED**

The codebase treats ALL street cleaning restrictions the same way - it does NOT currently distinguish between:

#### Type 1: Temporary Posted Signs (9am-2pm daily)
- Physical signs posted the morning of cleaning
- Valid for that day only
- Not stored separately in database

#### Type 2: Permanent Posted Signs (e.g., "7am-9am Fridays April 1 - Oct 31")
- Permanent installations
- Season-based or recurring schedules
- Should be recurring dates, not unique per day

### How Chicago Street Cleaning Actually Works:
Chicago uses **recurring permanent schedules** by ward/section (NOT temporary daily signs):
- Example: "Monday 9am-2pm" for Ward 1, Section A
- This translates to: Every Monday in the cleaning season

### Database Reality:
The `street_cleaning_schedule` table contains:
- **Individual rows for each cleaning DATE**
- No sign_type or schedule_pattern column
- No distinction between recurring vs. one-off cleanings
- Data is likely pre-calculated from the schedule and imported as individual dates

### Example Data Structure:
```
Ward 1, Section A, 2025-01-20  <- One row per date
Ward 1, Section A, 2025-01-27  <- Next Monday
Ward 1, Section A, 2025-02-03  <- Continues pattern
...
```

**Important:** The system assumes all cleaning dates in the table are valid. There's no metadata about:
- Whether this is a permanent or temporary restriction
- The time window (always assumes 9am)
- Season start/end dates
- Exceptions

---

## 4. CHICAGO'S STREET CLEANING PDF SCHEDULES

### Data Source
**Reference:** Chicago Municipal Code Section 9-64-010 (Street Cleaning Parking Violations)

The system references but does NOT directly parse Chicago's official PDFs. Instead:

#### How Data Gets Into System:
1. **CSV Import Process**
   - File: `/home/randy-vollrath/ticketless-chicago/scripts/import-street-cleaning-csv.js`
   - Manually maintained CSV with columns: `ward`, `section`, `cleaning_date`
   - Expected format: YYYY-MM-DD dates

2. **Data Flow:**
   ```
   Chicago's Street Cleaning PDFs (manual source)
       ↓
   CSV file (manually created/updated)
       ↓
   import-street-cleaning-csv.js script
       ↓
   street_cleaning_schedule table in MSC Supabase
   ```

3. **No Automatic Updates**
   - Data is static until manually re-imported
   - No automated PDF parsing or web scraping
   - Relies on manual update process

#### CSV Format Expected:
```csv
ward,section,cleaning_date
1,1,2025-01-20
1,2,2025-01-21
...
```

---

## 5. LOCATION LOOKUP METHODS: Ward/Section vs. GPS

### Method 1: GPS-Based Lookup (Primary)
**Used in:** Mobile app, real-time parking checks

```typescript
// From lib/street-cleaning-schedule-matcher.ts
await mscSupabase.rpc('get_nearest_street_cleaning_zone', {
  user_lat: latitude,
  user_lng: longitude,
  max_distance_meters: 50
});
```

**PostGIS Function (Backend):**
```sql
-- Finds nearest street cleaning zone within 50 meters
SELECT 
  sc.ward,
  sc.section,
  ST_Distance(
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    sc.geom_simplified::geography
  ) as dist
FROM street_cleaning_schedule sc
WHERE sc.geom_simplified IS NOT NULL
  AND ST_DWithin(
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    sc.geom_simplified::geography,
    50  -- 50 meter buffer
  )
ORDER BY dist
LIMIT 1;
```

**Advantages:**
- Real-time, no address parsing needed
- Works on street corners and mid-block
- Automatic when user enables location sharing

**Limitations:**
- Must be within 50 meters of zone boundary
- Requires geometry data (geom_simplified) to be populated
- Won't work if geom_simplified is NULL

### Method 2: Ward/Section Direct Lookup (Secondary)
**Used in:** Web app, pre-saved user addresses

```typescript
// If user already has home_address_ward and home_address_section
await getStreetCleaningByWardSection(ward, section);
```

**Process:**
1. User enters address (or admin geocodes it)
2. Reverse geocode to get full address
3. Address parser extracts ward/section
4. Direct query to street_cleaning_schedule table

**Advantages:**
- No GPS required
- Works for planning (user can check their home address anytime)
- Matches user's stored address

**Limitations:**
- Requires separate address parsing/geocoding step
- Not real-time - limited to stored addresses

### Method 3: Spatial Functions (Enhanced Version)
**File:** `/home/randy-vollrath/ticketless-chicago/database/create-enhanced-spatial-functions.sql`

```sql
CREATE OR REPLACE FUNCTION get_street_cleaning_at_location_enhanced(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  ward TEXT,
  section TEXT,
  street_name TEXT,
  next_cleaning_date DATE,
  distance FLOAT
)
```

This enhanced version:
- Queries nearest zone with geography distance
- Returns distance in meters
- Limits to 30 meters by default (vs. 50)
- Single function query that gets next cleaning date

---

## 6. UNIFIED PARKING CHECKER INTEGRATION

**File:** `/home/randy-vollrath/ticketless-chicago/lib/unified-parking-checker.ts`

The street cleaning lookup is part of a larger system that checks:
1. Street Cleaning (spatial query)
2. Winter Overnight Ban (address match)
3. 2-Inch Snow Ban (spatial query)
4. Permit Zones (address match)
5. Rush Hour Restrictions (major arterials)

All with a single GPS location.

---

## 7. CRON JOB SYSTEM

**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/street-cleaning/process.ts`

### Schedule
- **7am Chicago time:** Morning reminder (current day)
- **3pm Chicago time:** Follow-up message
- **7pm Chicago time:** Evening reminder (tomorrow)

### Logic
```typescript
const { data: schedule } = await supabase
  .from('street_cleaning_schedule')
  .select('cleaning_date')
  .eq('ward', user.home_address_ward)
  .eq('section', user.home_address_section)
  .gte('cleaning_date', minDate)  // minDate varies by notification type
  .order('cleaning_date', { ascending: true })
  .limit(1);
```

### User Preferences Checked
- `notify_days_array`: [0, 1, 2, 3] - advance days to notify
- `notify_evening_before`: boolean - send 7pm reminder
- `notify_sms`: boolean - prefer SMS
- `notify_email`: boolean - prefer email
- `phone_call_enabled`: boolean - enable voice calls

---

## 8. DATABASE SCHEMA SUMMARY

### Main Tables (Ticketless America DB)

#### `user_profiles`
```sql
CREATE TABLE user_profiles (
    user_id uuid PRIMARY KEY,
    email text,
    home_address_full text,
    home_address_ward text,
    home_address_section text,
    notify_days_array integer[] DEFAULT ARRAY[1],
    notify_evening_before boolean DEFAULT false,
    phone_number text,
    notify_sms boolean DEFAULT false,
    notify_email boolean DEFAULT true,
    follow_up_sms boolean DEFAULT true,
    snooze_until_date date,
    phone_call_enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);
```

#### `user_addresses` (Multiple addresses per user)
```sql
CREATE TABLE user_addresses (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES users(id),
    label text,
    full_address text NOT NULL,
    ward text NOT NULL,
    section text NOT NULL,
    notify_days_array integer[] DEFAULT ARRAY[1],
    is_primary boolean DEFAULT false
);
```

#### `user_notifications` (Audit trail)
```sql
CREATE TABLE user_notifications (
    id uuid PRIMARY KEY,
    user_id uuid,
    notification_type text,  -- 'street_cleaning'
    sent_at timestamp,
    status text,  -- 'pending', 'sent', 'failed'
    ward text,
    section text,
    cleaning_date date,
    metadata jsonb
);
```

#### `sms_logs` & `email_logs`
- Track delivery status
- Include ward, section, cleaning_date fields
- Used for debugging and reporting

---

## 9. CONTEST/TICKET DEFENSE INFORMATION

**File:** `/home/randy-vollrath/ticketless-chicago/lib/contest-kits/street-cleaning.ts`

### Chicago Ordinance Reference
- **Code:** 9-64-010
- **Title:** "Parking During Prohibited Hours"
- **Fine:** $60
- **Historical Win Rate:** ~34-35% (relatively high)

### Contest Grounds Available
1. **Inadequate or Missing Signage** (45% win rate)
   - No visible signs
   - Signs obscured by trees/debris
   - Signs posted >500 feet away

2. **Weather Cancellation** (40% win rate)
   - Snow/ice conditions
   - Heavy rain
   - System automatically checks weather data

3. **Vehicle Was Moved Before Cleaning** (42% win rate)
   - Timestamped evidence
   - Parking app receipts

4. **Street Cleaning Did Not Occur** (35% win rate)
   - Photos showing dirty street after posted time
   - 311 complaint records

### Key Insight: No Sign Type Distinction in Legal Arguments
The contest arguments don't distinguish between permanent vs. temporary signs. The focus is on:
- Whether signs are visible
- Whether they're adequately posted
- Whether cleaning actually occurred

---

## 10. KEY FINDINGS & LIMITATIONS

### What Works Well
✅ GPS-based spatial matching (PostGIS)  
✅ Real-time ward/section identification  
✅ Recurring schedule queries  
✅ Multi-channel notifications (SMS, email, voice)  
✅ User preference management  

### Current Gaps
❌ No automation for PDF schedule parsing  
❌ No distinction between permanent vs. temporary signs  
❌ All times hardcoded to 9am  
❌ No handling of season changes or exceptions  
❌ No support for street cleaning cancellations due to weather  
❌ geom_simplified geometry not populated for all zones  

### Data Quality Issues
- Depends on manual CSV imports (no real-time updates)
- No validation that imported dates align with Chicago's published calendar
- Missing geometry data would break GPS-based matching
- No error handling for zones without geometry

---

## 11. ENVIRONMENT CONFIGURATION

**Required Environment Variables:**
```bash
# MyStreetCleaning Database
MSC_SUPABASE_URL=https://xxx.supabase.co
MSC_SUPABASE_SERVICE_ROLE_KEY=eyJ...xxx

# Main Ticketless America Database  
NEXT_PUBLIC_SUPABASE_URL=https://yyy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...yyy
```

**Connection Architecture:**
- Two separate Supabase projects
- MSC database: Street cleaning schedules + geometry
- Ticketless America database: User profiles + preferences
- One-way sync: Ticketless → MyStreetCleaning (for account creation)

