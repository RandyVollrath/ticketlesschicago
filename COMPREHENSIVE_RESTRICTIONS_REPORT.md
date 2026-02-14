# Ticketless Chicago - Comprehensive Parking Restrictions & Violation Types Report

**Generated:** 2026-02-01  
**Codebase Version:** Main branch  
**Focus Areas:** Restriction types, data sources, implementation status

---

## EXECUTIVE SUMMARY

The Ticketless Chicago app **currently implements 4 major parking restrictions** with real-time location-based protection. The codebase also includes **20 violation/restriction types** with contest kits and defense strategies, though only 4 are actively used for location-based alerts.

Additionally, the app tracks **28+ Chicago parking violation codes** from the municipal code, with comprehensive contest intelligence including win rates, common defenses, and evidence requirements.

---

## PART 1: RESTRICTION TYPES IMPLEMENTED WITH REAL DATA

### 1. WINTER OVERNIGHT PARKING BAN (December 1 - April 1, 3am-7am)

**Status:** ✅ FULLY IMPLEMENTED AND ACTIVE

**Files:**
- `/lib/winter-overnight-ban-checker.ts`
- `/lib/winter-ban-matcher.ts`
- `/lib/unified-parking-checker.ts` (lines 277-308)

**How It Works:**
- Checks if parking location falls on a designated winter overnight parking ban street
- Seasonal activation: December 1 through April 1
- Daily ban window: 3:00 AM - 7:00 AM every night during season
- Uses street name matching against database

**Data Sources:**
- **Primary:** Supabase table `winter_overnight_parking_ban_streets`
  - Fields: street_name, from_location, to_location
  - Synced from Chicago Data Portal: `https://data.cityofchicago.org/resource/mcad-r2g5.json`
- **Sync Function:** `syncWinterBanStreets()` in `/lib/winter-sync-helpers.ts`
- **Manual Sync:** Should run once per year around December 1

**Alert Features:**
- "CRITICAL" severity during ban hours (3am-7am)
- "WARNING" severity if ban starts within 4 hours
- "INFO" severity otherwise during season
- Shows hours until next ban period
- Sample alert: "WINTER BAN ACTIVE on [STREET]! No parking 3-7 AM. Move car immediately or face $175 ticket + tow."

**Violation Code:** 9-64-081 (Winter Overnight Parking Ban)
- Fine: $175
- Tow risk: YES
- Contest win rate: ~35-45%

**TODOs/Known Issues:**
- Line comment: "TODO: Add geometry data to winter_overnight_parking_ban_streets table"
- Currently uses street name matching only (could be improved with spatial geometry)

---

### 2. TWO-INCH SNOW BAN (Emergency activation, any time/date)

**Status:** ✅ FULLY IMPLEMENTED AND ACTIVE

**Files:**
- `/lib/two-inch-snow-ban-checker.ts`
- `/lib/snow-route-matcher.ts`
- `/lib/unified-parking-checker.ts` (lines 261-275)

**How It Works:**
- Triggered when 2+ inches of snow accumulates on ~500 miles of designated snow routes
- Can activate ANY time of year, ANY day of week (not seasonal like winter ban)
- When active: cars may be ticketed ($150) or relocated for snow clearing operations
- Uses GPS spatial queries to find if parked on a snow route

**Data Sources:**
- **Snow Routes:** Supabase spatial table `snow_routes` with PostGIS geometry
  - Spatial query: `get_snow_route_at_location_enhanced(user_lat, user_lng, distance_meters)`
  - Coverage: ~500 miles of main arterial streets in Chicago
- **Ban Status:** Supabase table `snow_route_status`
  - Fields: is_active, activation_date, snow_amount_inches
- **Event Tracking:** Supabase table `snow_events`
  - Distinguishes forecast (predicted) vs. confirmation (actual accumulation)
  - Used for notification timing
- **Data Source:** Chicago Data Portal `https://data.cityofchicago.org/resource/i6k4-giaj.json`
- **Sync Function:** `syncSnowRoutes()` in `/lib/winter-sync-helpers.ts`
- **Manual Sync:** Should run once per year around November 1

**Alert Features:**
- **Confirmation alerts** (actual snow accumulation):
  - "CRITICAL" severity
  - Message: "2-INCH SNOW BAN ACTIVATED! 2+ inches of snow has accumulated. Your car may be TICKETED or RELOCATED."
- **Forecast alerts** (predicted snow):
  - "WARNING" severity
  - Message: "2+ inches of snow is forecasted. If accumulation reaches 2 inches, parking ban may be activated."
- Shows estimated snow amount
- Real-time push notifications to mobile app

**Violation Codes:**
- 9-64-080 (Snow Route Parking Ban)
  - Fine: $150-175
  - Tow risk: YES (immediate)
  - Contest win rate: ~30-35%

**Database Tables:**
```
snow_routes
├── geometry (PostGIS - street segments)
├── street_name
└── other_field_names

snow_route_status
├── id (typically 1)
├── is_active (boolean)
├── activation_date (timestamp)
└── snow_amount_inches (number)

snow_events
├── event_date
├── is_active
├── forecast_sent
└── two_inch_ban_triggered
```

---

### 3. STREET CLEANING RESTRICTIONS (April 1 - November 30)

**Status:** ✅ FULLY IMPLEMENTED AND ACTIVE

**Files:**
- `/lib/street-cleaning-schedule-matcher.ts`
- `/lib/unified-parking-checker.ts` (lines 239-259)

**How It Works:**
- Uses GPS coordinates to find street cleaning zone (ward + section)
- Looks up next scheduled cleaning date for that zone
- Assumes 9:00 AM cleaning start time (appears to be standard)
- Seasonal: April 1 through November 30

**Data Sources:**
- **Primary Database:** Separate Supabase instance called "MyStreetCleaning" (MSC)
  - Connection: `MSC_SUPABASE_URL`, `MSC_SUPABASE_SERVICE_ROLE_KEY` environment variables
  - This is NOT the main Ticketless Chicago database
- **Tables in MSC Database:**
  - `street_cleaning_zones` - Zone boundaries with PostGIS geometry
  - `street_cleaning_schedule` - Next scheduled cleaning date by ward/section
- **Spatial Query:** `get_nearest_street_cleaning_zone()` (PostGIS)
  - Searches within 50 meters of user's GPS location
  - Returns: ward, section, zone_id, geospatial data

**Alert Features:**
- Calculates days and hours until next cleaning
- Escalates severity based on timing:
  - "CRITICAL" if cleaning is TODAY and within 4 hours
  - "WARNING" if cleaning is TODAY but more than 4 hours away
  - "INFO" if cleaning is tomorrow or within 7 days
- Sample alert: "Street cleaning in 30 minutes - MOVE NOW! Ward 3 Section 2"

**Violation Code:** 9-64-050(a) (Street Cleaning)
- Fine: $65
- Late fee: $50
- Tow risk: NO
- Contest win rate: ~34-35%
- Common defenses: No signage, signs obscured, vehicle moved before sweeper

**Implementation Notes:**
- Ward/section organization is specific to Chicago Street Services
- Assumes all streets in zone are cleaned on same date
- Assumes 9am start time (may vary in practice - sign says 2pm on some streets)
- Depends on external MSC database being maintained

**Limitation:** Line comment notes "Actually 2pm per spec" - app may show inaccurate time

---

### 4. RESIDENTIAL & INDUSTRIAL PERMIT ZONES

**Status:** ✅ FULLY IMPLEMENTED AND ACTIVE

**Files:**
- `/lib/permit-zone-time-validator.ts`
- `/lib/unified-parking-checker.ts` (lines 310-399)

**How It Works:**
- Address-based matching: parsed street address matched against permit zone ranges
- Uses odd/even address matching for some zones
- Checks if current time falls within restriction period
- Default restriction: Monday-Friday 6:00 AM - 6:00 PM

**Data Sources:**
- **Residential Permit Zones:** Supabase table `parking_permit_zones`
  - Fields: zone, odd_even, address_range_low, address_range_high, street_direction, street_name, street_type, status
  - Address matching via range lookup (e.g., "address 500 on N Main St falls within zone 4")
- **Industrial Permit Zones:** Supabase table `industrial_parking_zones`
  - Fields: zone, street_name, street_direction, street_type, address_range_low, address_range_high, restriction_hours, restriction_days
- **Permit Hours Lookup:** Supabase table `permit_zone_hours`
  - Stores confirmed restriction schedules (not all assumptions)
  - Fields: zone, zone_type, restriction_schedule, confidence level

**Alert Features:**
- **Residential Zones:**
  - "CRITICAL" if permit required NOW
  - "WARNING" if permit required within 2 hours
  - "INFO" otherwise
  - Sample: "PERMIT REQUIRED - Zone 4. Mon-Fri 6am-6pm. $100 ticket risk."
  
- **Industrial Zones:**
  - Only shown if NO residential zone found
  - Sample: "INDUSTRIAL PERMIT REQUIRED - Zone 12. Mon-Fri 8am-3pm."

**Violation Codes:**
- 9-64-070 (Residential Permit Parking Without Permit) / 9-64-170(a)
  - Fine: $65-100
  - Contest win rate: ~40-54%
  - Common defenses: Permit displayed but not visible, new resident, guest parking

---

## PART 2: VIOLATION TYPES WITH CONTEST KITS (Not all actively checked)

The app includes **20 violation/restriction types** with detailed contest kits. These are used for helping users contest tickets but are NOT automatically checked during location-based parking checks.

**Available Contest Kits by Win Rate** (from FOIA 2023-2024 data):

### Highest Win Rates (50%+)
1. **Expired Plates/Registration** (Code: 9-76-160 / 9-80-190)
   - Win Rate: 75%
   - File: `/lib/contest-kits/expired-plates.ts`
   
2. **City Sticker** (Code: 9-100-010)
   - Win Rate: 70%
   - File: `/lib/contest-kits/city-sticker.ts`
   - Common defense: Sticker purchased but not yet received
   
3. **Handicapped/Disabled Zone** (Code: 9-64-180)
   - Win Rate: 68%
   - File: `/lib/contest-kits/handicapped-zone.ts`
   
4. **Expired Meter** (Code: 9-64-170)
   - Win Rate: 67%
   - File: `/lib/contest-kits/expired-meter.ts`
   - Common defense: Meter malfunction, app payment error

### Medium Win Rates (40-50%)
5. **Commercial Loading** (Code: 9-64-160)
   - Win Rate: 59%
   - File: `/lib/contest-kits/commercial-loading.ts`
   - Duration: Usually 3-30 minutes allowed
   
6. **No Standing/Time Restricted** (Code: 9-64-140)
   - Win Rate: 58%
   - File: `/lib/contest-kits/no-standing.ts`
   
7. **Residential Permit** (Code: 9-64-070)
   - Win Rate: 54%
   - File: `/lib/contest-kits/residential-permit.ts`
   
8. **Missing/Obscured License Plate** (Code: 9-80-040)
   - Win Rate: 54%
   - File: `/lib/contest-kits/missing-plate.ts`

### Lower Win Rates (20-40%)
9. **Fire Hydrant** (Code: 9-64-130)
   - Win Rate: 44%
   - File: `/lib/contest-kits/fire-hydrant.ts`
   - Distance: 15 feet from hydrant required
   
10. **Rush Hour** (Code: 9-64-190)
    - Win Rate: 37%
    - File: `/lib/contest-kits/rush-hour.ts`
    - **STATUS: Disabled** - See section below
    
11. **Street Cleaning** (Code: 9-64-010)
    - Win Rate: 34-35%
    - File: `/lib/contest-kits/street-cleaning.ts`
    
12. **Snow Route** (Code: 9-64-100)
    - Win Rate: 30-35%
    - File: `/lib/contest-kits/snow-route.ts`
    
13. **Double Parking** (Code: 9-64-160)
    - Win Rate: 25%
    - File: `/lib/contest-kits/double-parking.ts`
    
14. **Parking in Alley** (Code: 9-64-020)
    - Win Rate: 25%
    - File: `/lib/contest-kits/parking-alley.ts`

### Lowest Win Rates (10-20%)
15. **Bus Stop** (Code: 9-64-050)
    - Win Rate: 20%
    - File: `/lib/contest-kits/bus-stop.ts`
    
16. **Bike Lane** (Code: 9-64-090)
    - Win Rate: 18%
    - File: `/lib/contest-kits/bike-lane.ts`
    
17. **Red Light Camera** (Code: 9-102-020)
    - Win Rate: 10%
    - File: `/lib/red-light-cameras.ts` (data only, no kit)
    - Note: VERY LOW win rate - special handling required
    
18. **Speed Camera** (Code: 9-102-075, 9-102-076)
    - Win Rate: 8%
    - File: `/lib/speed-cameras.ts` (data only, no kit)
    - Note: VERY LOW win rate - requires expert analysis

### Specialty Kits
19. **Policy Engine** (Meta-tool)
    - File: `/lib/contest-kits/policy-engine.ts`
    - Evaluates contests and recommends best arguments based on evidence
    
20. **Evidence Guidance**
    - File: `/lib/contest-kits/evidence-guidance.ts`
    - Recommends what evidence to collect for each violation type

---

## PART 3: DISABLED RESTRICTIONS

### RUSH HOUR RESTRICTIONS - DISABLED

**Status:** ⚠️ IMPLEMENTED BUT DISABLED (not actively checked)

**File:** `/lib/contest-kits/rush-hour.ts` (contest kit only)

**Why Disabled:**
As documented in `/lib/unified-parking-checker.ts` (lines 349-355):
```typescript
// --- Rush Hour Restrictions ---
// DISABLED: Rush hour data is based on assumptions about major arterials,
// not actual segment-level restriction data. This causes false positives.
// TODO: Re-enable when we have accurate segment-level rush hour data.
```

**How It Would Work:**
- Would check if parked location is on a street with rush hour restrictions
- Typical restrictions: 7-9 AM (morning) and/or 4-6 PM (evening)
- Usually Monday-Friday only
- Federal holidays exempt

**Missing Data:**
- No segment-level street database with rush hour restriction data
- No Chicago parking sign database integrated
- Would require manual data collection or city data portal integration

**Contest Kit Available:**
- Base win rate: 37%
- Common defenses:
  - Inadequate/missing signage (45% win rate)
  - Parked outside posted hours (50% win rate)
  - Federal holiday exception (60% win rate)
  - Weekend exception (65% win rate)
- Evidence required: Sign photos, timestamp, location photos

**Future Implementation Notes:**
- Would need accurate data source (e.g., from Chicago Data Portal)
- Could potentially integrate with Socrata dataset if available
- Currently has crowdsourced signage reports but not integrated into live checks

---

## PART 4: UNIMPLEMENTED CHICAGO VIOLATION TYPES

The app's database includes all 28 Chicago parking violation codes but only 4 are actively protected:

### Implemented with Real-Time Protection (4)
- ✅ 9-64-050(a) - Street Cleaning
- ✅ 9-64-080 - Snow Route Parking Ban
- ✅ 9-64-081 - Winter Overnight Parking Ban
- ✅ 9-64-070 / 9-64-170(a) - Residential Permit / Expired Meter (permit zones)

### Implemented Contest Kits, No Real-Time Check (16)
- 🛡️ 9-64-010 - Street Cleaning (alternate code)
- 🛡️ 9-64-020 - Parking in Alley
- 🛡️ 9-64-050 - Bus Stop/Stand
- 🛡️ 9-64-090 - Bike Lane
- 🛡️ 9-64-110 - Double Parking
- 🛡️ 9-64-130 - Fire Hydrant (15 feet)
- 🛡️ 9-64-140 - No Standing/Time Restricted
- 🛡️ 9-64-160 - Commercial Loading Zone
- 🛡️ 9-64-170 - Expired Meter
- 🛡️ 9-64-180 - Handicapped Zone Without Permit
- 🛇ⳙ 9-64-190 - Rush Hour (DISABLED - see section above)
- 🛈 9-76-160 - Expired Plates
- 🛈 9-80-040 - Obscured License Plate
- 🛈 9-80-190 - Expired/Missing Registration
- 🛈 9-80-200 - Inoperative Headlights/Taillights
- 🛈 9-100-010 - City Vehicle Sticker

### Mentioned but Not Implemented
- Red Light Camera (9-102-020) - 290+ locations, 10% win rate
- Speed Camera (9-102-075 / 9-102-076) - School/park zones, 8% win rate
- Disobeying Traffic Control (9-40-100)
- Failure to Yield to Pedestrian (9-40-025)
- Illegal Turn (9-40-165)

---

## PART 5: CHICAGO VIOLATIONS DATABASE

### Violation Categories in Chicago Ordinances

**Parking Violations (9-64-xxx series):**
- Street Cleaning (9-64-010, 9-64-050(a))
- Alley Parking (9-64-020)
- Bus Stop (9-64-050)
- Bike Lane (9-64-090)
- Fire Hydrant (9-64-110, 9-64-130)
- Double Parking (9-64-110, 9-64-160)
- Residential Permit (9-64-070, 9-64-170)
- Expired Meter (9-64-170)
- Handicapped Zone (9-64-180)
- Rush Hour (9-64-190)
- Snow Route (9-64-100)
- Winter Ban (9-64-080, 9-64-081)
- Parking Alley (9-64-020)
- No Standing (9-64-140)
- Commercial Loading (9-64-160)

**Sticker/Permit (9-100-xxx, 9-76-xxx series):**
- City Sticker (9-100-010)
- Expired Plates (9-76-160)

**Equipment (9-80-xxx series):**
- Expired/Missing Registration (9-80-190)
- Obscured License Plate (9-80-040)
- Inoperative Lights (9-80-200)

**Moving/Camera Violations (9-40-xxx, 9-102-xxx series):**
- Disobeying Traffic Control (9-40-100)
- Failure to Yield (9-40-025)
- Illegal Turn (9-40-165)
- Red Light Camera (9-102-020) - 10% win rate
- Speed Camera (9-102-075, 9-102-076) - 8% win rate

---

## PART 6: DATA SOURCES USED

### Chicago Open Data Portal (Socrata)

**Winter Parking Data:**
- Winter Ban Streets: `https://data.cityofchicago.org/resource/mcad-r2g5.json`
  - Sync function: `syncWinterBanStreets()` in `/lib/winter-sync-helpers.ts`
- Snow Routes: `https://data.cityofchicago.org/resource/i6k4-giaj.json`
  - Sync function: `syncSnowRoutes()` in `/lib/winter-sync-helpers.ts`

**Camera Locations:**
- Red Light Cameras: Hardcoded in `/lib/red-light-cameras.ts` (290+ locations)
- Speed Cameras: Hardcoded in `/lib/speed-cameras.ts` (102+ locations, growing)

**Towed Vehicles:**
- Reference URL in `/lib/contest-intelligence/tow-alerts.ts`: `https://data.cityofchicago.org/resource/ygr5-vcbg.json`
- Currently commented out - not yet integrated

### Internal Databases (Supabase)

**Main Ticketless Database:**
- `parking_permit_zones` - Residential permit zone boundaries
- `industrial_parking_zones` - Industrial zone restrictions
- `permit_zone_hours` - Zone-specific restriction schedules
- `winter_overnight_parking_ban_streets` - Winter ban street list
- `snow_routes` - 500 miles of snow routes (PostGIS)
- `snow_route_status` - Current ban activation state
- `snow_events` - Snow event tracking

**Separate MyStreetCleaning Database:**
- `street_cleaning_zones` - Zone geometries (PostGIS)
- `street_cleaning_schedule` - Next cleaning dates by ward/section

**Contest Intelligence:**
- `tow_boot_alerts` - Towed/booted vehicle tracking
- Various signage and hearing officer intelligence tables

### External APIs

- **Google Maps Geocoding API** - For reverse geocoding (single call per check)
- **Chicago Data Portal API** - For sync operations (Socrata)

---

## PART 7: SPECIFIC RESTRICTION TYPES YOU ASKED ABOUT

### ✅ Implemented with Live Checking
- **Tow Zones** - Tracked in contest intelligence, not live-checked (`/lib/contest-intelligence/tow-alerts.ts`)
- **Winter Bans** - YES, fully implemented (2 types)
- **Street Cleaning** - YES, fully implemented
- **Snow Routes** - YES, implemented as "2-inch snow ban"

### ⚠️ Mentioned but Not Fully Implemented for Live Checking
- **Loading Zones** - Contest kit exists (9-64-160), not live-checked
- **No-Parking Zones** - Contest kit exists (9-64-140), not live-checked
- **School Zones** - Speed camera enforcement only (9-102-075), 8% win rate
- **Hospital Zones** - NOT mentioned in codebase
- **Disabled Parking** - Contest kit exists (9-64-180), not live-checked
- **Meter Locations** - Expired meter contest kit exists, meter check disabled
- **Rush Hour** - DISABLED (documented reason: needs segment-level data)
- **Construction Zones** - Mentioned in ordinances only, not implemented
- **Temporary Restrictions** - Not systematically tracked

### ❌ NOT Implemented or Not Mentioned
- **Hospital zones** - No implementation found
- **Loading zone duration/commercial plates** - Contest kit only
- **Bike lane** - Contest kit only
- **Sight line/corner restrictions** - Not mentioned
- **Real-time dynamic signs** - Not implemented

---

## PART 8: ARCHITECTURAL OVERVIEW

### Unified Parking Checker Pattern

**File:** `/lib/unified-parking-checker.ts`

**Single API Call Efficiency:**
1. **ONE reverse geocode** (Google Maps Geocoding API)
   - Extracts: street number, street name, neighborhood
   
2. **Parallel database queries:**
   - Street cleaning zone lookup (spatial, 50m radius)
   - Snow route lookup (spatial, 30m radius)
   - Snow ban status (single row)
   - Winter overnight ban lookup (spatial, 30m radius)
   - Residential permit zones (address range match)
   - Industrial permit zones (address range match)
   - Permit zone hours (all rows, small table)

3. **Combined result object:**
```typescript
{
  location: { ... },
  streetCleaning: { found, ward, section, nextCleaningDate, severity, message },
  winterBan: { found, streetName, isWinterSeason, isBanHours, severity, message },
  snowBan: { found, streetName, isBanActive, snowAmount, severity, message },
  permitZone: { found, zoneName, zoneType, isCurrentlyRestricted, severity, message }
}
```

### Scalability Notes
- Uses PostGIS spatial queries for street segments
- All queries run in parallel (Promise.all)
- Reduced API costs (single geocode call)
- Database optimized with indexes on spatial columns

---

## PART 9: RECENT CHANGES & TODOs

### Recent Additions
- Speed cameras: 102+ cameras with go-live dates extending to 2026
- Contest intelligence system with tow/boot alert tracking
- Industrial parking zones support

### Known TODOs
1. Add geometry data to `winter_overnight_parking_ban_streets`
2. Implement spatial query for winter ban (currently address-only)
3. Re-enable rush hour restrictions with accurate segment-level data
4. Integrate towed vehicle API from Chicago Data Portal
5. Crowdsourced signage reports integration
6. Real-time parking sign database

### Recently Removed
- **Rush hour restrictions** - Disabled due to inaccuracy
- Some parking sign crowdsourcing features (not integrated)

---

## PART 10: SUMMARY TABLE

| Restriction Type | Code | Data Source | Status | Win Rate | Implementation File |
|---|---|---|---|---|---|
| Street Cleaning | 9-64-010/050 | MyStreetCleaning DB | ✅ Active | 34-35% | `/lib/street-cleaning-schedule-matcher.ts` |
| Winter Overnight Ban | 9-64-081 | Chicago Data Portal | ✅ Active | 35-45% | `/lib/winter-overnight-ban-checker.ts` |
| Snow Route (2") | 9-64-080 | Chicago Data Portal | ✅ Active | 30-35% | `/lib/two-inch-snow-ban-checker.ts` |
| Residential Permit | 9-64-070/170 | Supabase DB | ✅ Active | 40-54% | `/lib/permit-zone-time-validator.ts` |
| Rush Hour | 9-64-190 | NONE | ⚠️ Disabled | 37% | `/lib/contest-kits/rush-hour.ts` |
| Expired Plates | 9-76-160 | NONE | 🛡️ Contest Kit | 75% | `/lib/contest-kits/expired-plates.ts` |
| City Sticker | 9-100-010 | NONE | 🛡️ Contest Kit | 70% | `/lib/contest-kits/city-sticker.ts` |
| Handicapped Zone | 9-64-180 | NONE | 🛡️ Contest Kit | 68% | `/lib/contest-kits/handicapped-zone.ts` |
| Expired Meter | 9-64-170 | NONE | 🛡️ Contest Kit | 67% | `/lib/contest-kits/expired-meter.ts` |
| Commercial Loading | 9-64-160 | NONE | 🛡️ Contest Kit | 59% | `/lib/contest-kits/commercial-loading.ts` |
| Bike Lane | 9-64-090 | NONE | 🛡️ Contest Kit | 18% | `/lib/contest-kits/bike-lane.ts` |
| Red Light Camera | 9-102-020 | Chicago Data Portal | 📍 Data only | 10% | `/lib/red-light-cameras.ts` |
| Speed Camera | 9-102-075/076 | Chicago Data Portal | 📍 Data only | 8% | `/lib/speed-cameras.ts` |

---

## CONCLUSIONS

**What's Actively Protected:**
- 4 major restrictions with real-time location-based alerts
- ~290+ red light cameras tracked (data only)
- 102+ speed cameras tracked (data only, expanding)
- Tow alerts via intelligence system

**What Has Contest Support But No Live Checking:**
- 16 additional violation types with detailed contest kits
- Average win rate across all contest types: ~42%

**What's Mentioned But Minimally Implemented:**
- Rush hour restrictions (disabled pending better data)
- Loading zones (contest kit only)
- Hospital/school zones (indirect through speed cameras)

**What's Missing:**
- Hospital zone restrictions
- Real-time dynamic/temporary restriction tracking
- Crowdsourced signage database integration (exists but not live)
- Chicago parking sign geolocation database
- Segment-level rush hour data

**Data Source Summary:**
- **Primary:** Chicago Data Portal (Socrata API)
- **Secondary:** Internal Supabase databases
- **Tertiary:** Google Maps Geocoding API, hardcoded camera locations
