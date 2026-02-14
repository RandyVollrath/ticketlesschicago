# Ticketless Chicago App - Parking Restrictions Protection Summary

## Overview
The Ticketless Chicago app currently protects users from **4 major parking restrictions**. The system uses a unified parking checker that performs efficient geolocation-based queries with a single reverse geocode call and batch database lookups.

---

## 1. WINTER/SNOW PARKING BANS (2 distinct types)

### A. Winter Overnight Parking Ban (3am-7am, Dec 1 - Apr 1)
**Status:** IMPLEMENTED and ACTIVE

**File:** `/lib/winter-ban-matcher.ts`, `/lib/winter-ban-checker.ts`

**How it works:**
- Checks if user's parked address is on a designated "Winter Overnight Parking Ban" street
- Operates seasonally: December 1 through April 1
- Restriction windows: 3am-7am every night during season
- Uses street name matching against `winter_overnight_parking_ban_streets` database table

**Data Source:**
- Supabase table: `winter_overnight_parking_ban_streets`
- Contains: street names, from_location, to_location
- Data appears to be from Chicago city parking regulations

**Protection Features:**
- Alerts user if currently in ban hours (3am-7am)
- Calculates hours until next ban period
- Escalates severity to "critical" if on snow route AND ban is active AND currently during ban hours
- Message example: "Winter ban starts in 2 hour(s) on [STREET]. Move before 3 AM."

---

### B. Two-Inch Snow Ban (Emergency restriction)
**Status:** IMPLEMENTED and ACTIVE

**File:** `/lib/two-inch-snow-ban-checker.ts`

**How it works:**
- Triggered when 2+ inches of snow accumulates on 500 designated "snow routes"
- Can be activated ANY time of day, ANY calendar date (not seasonal like winter ban)
- When active, cars may be ticketed OR relocated for snow clearing
- Uses GPS location matching to determine if parked on snow route

**Data Sources:**
- Supabase table: `snow_route_status` (tracks activation status)
  - Fields: is_active, activation_date, snow_amount_inches
- Supabase spatial query: `get_snow_route_at_location_enhanced()` (PostGIS)
  - Queries: `snow_routes` table (500 miles of main streets)
- Supabase table: `snow_events` (tracks forecast vs. confirmation)
  - Fields: event_date, is_active, forecast_sent, two_inch_ban_triggered

**Protection Features:**
- Distinguishes between forecast (predicted snow) vs. confirmation (actual accumulation)
- Shows estimated snow amount (e.g., "2 inches")
- Critical alert if parked on snow route when ban is confirmed active
- Message example: "2-INCH SNOW BAN ACTIVATED! You parked on [STREET]. 2" of snow has accumulated. Your car may be ticketed or relocated."

**Notification Types:**
- "confirmation" - Snow has actually accumulated (highest severity)
- "forecast" - Snow is predicted but not yet accumulated (warning severity)

---

## 2. STREET CLEANING RESTRICTIONS

**Status:** IMPLEMENTED and ACTIVE

**File:** `/lib/street-cleaning-schedule-matcher.ts`

**How it works:**
- Uses GPS coordinates to find street cleaning zone (ward + section)
- Looks up next scheduled cleaning date for that zone
- Chicago has organized street cleaning by ward/section with regular schedules
- Assumes 9am cleaning start time for timing calculations

**Data Source:**
- **Primary Database:** MyStreetCleaning (MSC) Supabase instance
  - Separate from main Ticketless Chicago database
  - Environment variables: `MSC_SUPABASE_URL`, `MSC_SUPABASE_SERVICE_ROLE_KEY`
- Tables in MSC database:
  - `street_cleaning_zones` - Zone geometries (PostGIS)
  - `street_cleaning_schedule` - Cleaning dates by ward/section
- Spatial query: `get_nearest_street_cleaning_zone()` (PostGIS)
  - Searches within 50 meters of location
  - Returns: ward, section, geospatial data

**Protection Features:**
- Calculates days until next cleaning
- Calculates hours until next cleaning
- Identifies urgency:
  - "CRITICAL" if cleaning is today within 4 hours
  - "WARNING" if cleaning is today but more than 4 hours away
  - "INFO" if cleaning is tomorrow or within 7 days
- Message example: "Street cleaning TOMORROW at 9am - Ward 2 Section 3"

**Limitations:**
- Assumes all streets in zone are cleaned (no segment-level detail)
- Assumes 9am start time (may vary in reality)
- Depends on external MyStreetCleaning database being maintained

---

## 3. RUSH HOUR PARKING RESTRICTIONS

**Status:** IMPLEMENTED BUT DISABLED

**File:** `/lib/contest-kits/rush-hour.ts` (contest kit with defense strategies)

**How it's supposed to work (NOT CURRENTLY ACTIVE):**
- Check if parked location is on a major arterial street with rush hour restrictions
- Most restrict parking during 7-9am (morning) and/or 4-6pm (evening)
- Restrictions typically Monday-Friday only
- Federal holidays usually exempt

**Data Source:**
- **Currently: NO data source implemented**
- Would need segment-level street data identifying which streets have rush hour restrictions
- City of Chicago appears to have this data (e.g., Michigan Ave, Lake Shore Drive, etc.)

**Why Disabled:**
As noted in `/lib/unified-parking-checker.ts` (lines 349-355):
```typescript
// --- Rush Hour Restrictions ---
// DISABLED: Rush hour data is based on assumptions about major arterials,
// not actual segment-level restriction data. This causes false positives.
// TODO: Re-enable when we have accurate segment-level rush hour data.
```

**Contest Kit Available:**
The app includes comprehensive contest strategies for rush hour tickets:
- Base win rate: 37% (from FOIA data)
- Primary defenses:
  - Inadequate signage (45% win rate)
  - Parking outside posted hours (50% win rate)
  - Federal holiday exception (60% win rate)
  - Weekend exception (65% win rate)
- Required evidence: Sign photos, time documentation, location photos

---

## 4. RESIDENTIAL PERMIT ZONE RESTRICTIONS

**Status:** IMPLEMENTED and ACTIVE

**File:** `/lib/permit-zone-time-validator.ts`

**How it works:**
- Matches address to residential permit parking zones
- Default restriction: Monday-Friday 6am-6pm
- Checks if current time falls within restriction period
- Supports odd/even day restrictions (some zones restrict by odd/even numbered addresses)

**Data Source:**
- Supabase table: `parking_permit_zones`
- Fields: zone, odd_even, address_range_low, address_range_high, street_direction, street_name, street_type, status
- Address matching: Uses parsed address (street number + name) to match against ranges

**Protection Features:**
- Calculates hours until next restriction period
- Shows current permit requirement status
- Critical alert when currently restricted (requires permit)
- Message example: "PERMIT REQUIRED - Zone 4. Mon-Fri 6am-6pm. $100 ticket risk."

---

## 5. DATA SOURCES SUMMARY

### Internal Chicago Data (Ticketless Database)
- `winter_overnight_parking_ban_streets` - Winter ban street list
- `snow_route_status` - Current 2-inch snow ban activation
- `snow_events` - Snow event tracking (forecast vs. actual)
- `snow_routes` - 500 miles of main streets for snow bans
- `parking_permit_zones` - Residential permit zone data

### External Data (MyStreetCleaning)
- Separate Supabase instance for street cleaning schedules
- `street_cleaning_zones` - Zone boundaries
- `street_cleaning_schedule` - When each zone is cleaned

### Missing/Not Implemented
- Chicago parking sign database (for rush hour segment-level data)
- Chicago data portal integrations (e.g., Chicago Data Portal)
- Real-time sign geolocation database

---

## 6. UNIFIED PARKING CHECK API

**Endpoints:**
- `/api/mobile/check-parking` - Mobile app endpoint (optimized)
- `/api/check-parking-location` - Web endpoint
- `/api/check-parking-location-enhanced` - Enhanced version with detailed formatting

**Query Efficiency:**
Single unified check performs:
1. **ONE reverse geocode call** (to get street address)
2. **ONE batch of parallel database queries:**
   - Street cleaning zone lookup (spatial)
   - Snow route lookup (spatial)
   - Snow ban status (single row)
   - Winter overnight ban lookup (spatial)
   - Permit zones (address match)
3. Results in 4 complete restriction profiles

**Performance Notes:**
- Uses PostGIS for efficient spatial queries (within 30-50 meters)
- All database queries run in parallel
- Single geocode call reduces external API costs

---

## 7. WHAT'S NOT CURRENTLY PROTECTED

### NOT Implemented:
1. **Rush Hour Restrictions** - Disabled due to lack of accurate segment-level data
2. **Chicago Data Portal Integration** - No direct integration with city's open data sources
3. **Parking Sign Geolocation Database** - App has crowdsourced signage reporting but not integrated into live checks
4. **Dynamic/Real-time Signs** - No monitoring of temporary parking restrictions
5. **Meter Expiration** - Not checked in location-based protection
6. **Bus Stop/Hydrant Proximity** - Not checked spatially
7. **Bike Lane Restrictions** - Not checked
8. **Loading Zone Violations** - Not checked

### Crowdsourced Data Available (for contests, not live protection):
- **Signage Reports Database** - `/lib/contest-intelligence/signage-database.ts`
  - Tracks problematic signs (faded, damaged, obscured, missing)
  - Tracks contest win rates by sign condition
  - But NOT used in real-time location checks

---

## 8. ARCHITECTURE NOTES

### Reverse Geocoding
- Uses Google Maps Geocoding API
- Extracts: street number, street name, neighborhood
- Used for address parsing and permit zone matching

### Database Efficiency Pattern
- Combined RPC calls (Remote Procedure Calls) for spatial queries
- Reduces round-trips to database
- Enables parallel execution of independent queries

### Mobile App Integration
- Mobile endpoints specifically optimized for cellular bandwidth
- Simplified response format for mobile display
- Real-time updates using push notifications for snow bans

---

## 9. CRON JOBS & BACKGROUND MONITORING

**Active Cron Jobs for Parking Protection:**
- `/pages/api/cron/mobile-snow-notifications` - Alerts users when snow bans activate
- `/pages/api/cron/mobile-parking-reminders` - Periodic parking reminder checks

---

## 10. CONTEST INTELLIGENCE

All 4 active restrictions have associated contest kits with:
- Win rate statistics (from FOIA data)
- Recommended evidence types
- Contest argument templates
- Common defenses
- Tracking fields for outcomes

Examples:
- Street Cleaning: 35% base win rate
- Snow Route: 30% base win rate
- Residential Permit: 40% base win rate
- Rush Hour: 37% base win rate (kit available, restriction checks disabled)

