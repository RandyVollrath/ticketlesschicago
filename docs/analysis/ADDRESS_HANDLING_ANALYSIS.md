# Ticketless Chicago - Address Handling Analysis

## Executive Summary
The application handles addresses through a multi-layer system involving:
1. **Frontend address capture** during signup and settings
2. **Address parsing** to extract components (number, direction, name, type)
3. **Ward/Section lookup** using PostGIS geospatial queries
4. **Permit zone validation** for residential parking zones
5. **Address storage** in user_profiles table with multiple address fields

---

## 1. WHERE USERS ENTER THEIR HOME ADDRESS

### A. Signup Flow
**File:** `/home/randy-vollrath/ticketless-chicago/components/EnhancedSignupFlow.tsx`

- **Step 1:** Multi-step onboarding component
- **UI Input:** Text field for "Your Chicago Address"
- **Placeholder:** "123 Main St, Chicago, IL 60601"
- **Validation:** 
  - Basic keyword check: must contain 'chicago', 'il', 'illinois', or '606'
  - No detailed address parsing at signup
  - Phone number required if SMS notification selected
  - Phone formatting: stores as `+1XXXXXXXXXX` (E.164 format)

- **Data Flow:**
  1. User enters address in form
  2. Stored in localStorage as pending signup data
  3. Passed to OAuth flow with Google
  4. Handled by callback (`/pages/api/auth/oauth-callback.ts`)

### B. Settings/Profile Update
**File:** `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx`

- Users can update their address in Settings
- Address update triggers permit zone detection
- Shows notification if address changed to/from permit zone
- Updates multiple address fields in user_profiles

---

## 2. ADDRESS VALIDATION LOGIC

### A. Address Parser Utility
**File:** `/home/randy-vollrath/ticketless-chicago/lib/address-parser.ts`

Parses Chicago addresses into structured components:

```typescript
interface ParsedAddress {
  number: number;           // Street number (1710)
  direction: string | null; // N, S, E, W, NE, NW, SE, SW
  name: string;            // Street name (CLINTON)
  type: string | null;     // ST, AVE, BLVD, DR, RD, LN, PL, CT, PKWY, TER, WAY
  isOdd: boolean;          // Whether address number is odd or even
  original: string;        // Original input
}
```

**Key Validations:**
- Requires minimum format: `<number> <street_name>`
- Normalizes uppercase and whitespace
- Extracts direction (N, S, E, W, NE, NW, SE, SW)
- Identifies street type (ST, AVE, BLVD, etc.)
- Calculates odd/even parity

**Examples:**
- "1710 S Clinton St" → {number: 1710, direction: "S", name: "CLINTON", type: "ST"}
- "123 North Michigan Avenue" → {number: 123, direction: "N", name: "MICHIGAN", type: "AVE"}

### B. Permit Zone Validation
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/check-permit-zone.ts`

Validates addresses against Chicago parking permit zones:

1. **Parse address** using address-parser.ts
2. **Query database** for matching permit zones:
   - Matches street_name (must be exact after parsing)
   - Matches street_direction (if present in zone)
   - Matches street_type (if present in zone)
   - Checks address range (number between range_low and range_high)
   - Filters by odd/even if zone specifies (O, E, or null for both)

3. **Returns:**
   - `hasPermitZone`: boolean
   - `zones`: array of matching zones with ward info
   - `parsedAddress`: the parsed components

**Database Query:**
```sql
SELECT * FROM parking_permit_zones
WHERE street_name = 'CLINTON'
  AND status = 'ACTIVE'
  AND address_range_low <= 1710
  AND address_range_high >= 1710
  AND (street_direction IS NULL OR street_direction = 'S')
  AND (odd_even IS NULL OR odd_even = 'E')
```

### C. Chicago Address Basic Validation (Signup)
**File:** `/home/randy-vollrath/ticketless-chicago/components/EnhancedSignupFlow.tsx`

```typescript
const validateChicagoAddress = (address: string): boolean => {
  const chicagoKeywords = ['chicago', 'il', 'illinois', '606'];
  const lowerAddress = address.toLowerCase();
  return chicagoKeywords.some(keyword => lowerAddress.includes(keyword));
};
```

---

## 3. WARD AND SECTION DATA - STORAGE AND RETRIEVAL

### A. Database Storage
**File:** Database schema in user_profiles table

**Address-related fields in user_profiles:**
```
- home_address_full        // Full address string
- home_address_ward        // Numeric ward (1-50)
- home_address_section     // Alphanumeric section code
- street_address           // Alternative address field
- street_side              // Which side of street?
- zip_code
- mailing_address
- mailing_city
- mailing_state
- mailing_zip
```

### B. Ward/Section Lookup Process
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/find-section.ts`

**Multi-step process:**

1. **Geocode Address to Coordinates**
   - Convert address string to lat/lng using Google Geocoding API
   - Validates result is in Chicago
   - Handles rate limiting with retries

2. **PostGIS Lookup**
   - Calls Supabase RPC function: `find_section_for_point()`
   - Database has street_cleaning_schedule table with geospatial data
   - PostGIS query: `ST_Contains(geom, ST_SetSRID(ST_MakePoint(lon, lat), 4326))`
   - Returns: ward number + section code

3. **Database:**
   - **street_cleaning_schedule table:**
     ```
     id (UUID)
     ward (text)           // "1", "2", etc.
     section (text)        // "1A", "2B", etc.
     cleaning_date (date)
     geom_simplified (PostGIS geometry)
     ```
   - Indexed for fast lookups: `idx_ward_section_date`

**PostGIS Function (in MyStreetCleaning database):**
```sql
CREATE OR REPLACE FUNCTION find_section_for_point(lat float8, lon float8)
RETURNS TABLE(ward text, section text) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.ward::text,
    s.section::text
  FROM street_cleaning_schedule s
  WHERE s.geom IS NOT NULL 
    AND ST_Contains(s.geom, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
```

### C. Ward/Section Storage on Profile Update
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/profile-update.ts`

When address changes:
1. New ward/section can be provided directly or looked up
2. Updated in user_profiles table
3. Synced to MyStreetCleaning database for street cleaning notifications
4. Triggers street cleaning schedule re-calculation

---

## 4. GEOCODING AND ADDRESS LOOKUP APIS

### A. Google Geocoding API
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/find-section.ts`

**Endpoint:** `https://maps.googleapis.com/maps/api/geocode/json`

**Configuration:**
- API Key: `process.env.GOOGLE_API_KEY`
- Normalizes address with ", Chicago, IL, USA" suffix
- **Retry logic:** Up to 2 retries on rate limiting or network errors
- **Timeout:** Integrated error handling for rate limits (OVER_QUERY_LIMIT)
- **Validation:** Confirms result is in Chicago locality

**Response handling:**
- Returns GeocodingResult with lat/lng
- Validates Chicago containment
- Falls back gracefully on geocoding failures
- Returns 404 if address not found

### B. Reverse Geocoding (Coordinates to Address)
**File:** `/home/randy-vollrath/ticketless-chicago/lib/reverse-geocoder.ts`

**Purpose:** Convert GPS coordinates to street addresses

**Features:**
- **Caching:** In-memory cache with 24-hour TTL
- **Coordinate rounding:** 5 decimal places (~1m precision)
- **Cache size limit:** Max 1000 entries with oldest-entry eviction
- **API Key:** `process.env.GOOGLE_MAPS_API_KEY`
- **Timeout:** 5 second abort timeout

**Parsed Output:**
```typescript
{
  formatted_address: string;
  street_name: string | null;
  street_number: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  neighborhood: string | null;
}
```

### C. MyStreetCleaning Integration
**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/profile-update.ts`

**Purpose:** Sync address changes to MyStreetCleaning database

**When triggered:**
- Address changes (home_address_full, ward, section)
- Notification preferences change
- Phone number updates

**Sync includes:**
- Full address
- Ward/section
- Phone number
- Notification preferences
- Evening before notification flag
- SMS follow-up flag

---

## 5. CURRENT FLOW FOR ADDRESS ENTRY

### New User Signup Flow:
```
1. User visits signup form
   ↓
2. Enters address ("123 S Main St, Chicago, IL")
   ↓
3. Frontend validates Chicago keywords only
   ↓
4. Stores in localStorage + passes to OAuth
   ↓
5. Google OAuth callback (/api/auth/oauth-callback)
   ↓
6. Save to user_profiles (address stored as plain text)
   ↓
7. [Manual or triggered] Ward/section lookup via find-section.ts
   - Geocode → Google API
   - PostGIS query → get ward/section
   - Update user_profiles
   ↓
8. [Permit zone check] check-permit-zone.ts
   - Parse address
   - Query parking_permit_zones table
   - Store in has_permit_zone field
```

### Address Update Flow (Settings):
```
1. User updates address in settings
   ↓
2. Frontend validates (basic check)
   ↓
3. POST to /api/user/update-address
   ↓
4. Check permit zone status before/after
   - If moved INTO zone → charge $30 fee
   - If moved OUT of zone → flag for refund review
   ↓
5. Update user_profiles with new address
   ↓
6. Sync to MyStreetCleaning for notifications
   ↓
7. Trigger street cleaning schedule re-lookup
```

---

## 6. EXISTING VALIDATION SUMMARY

| Validation | Location | Type | Scope |
|-----------|----------|------|-------|
| Chicago keyword check | EnhancedSignupFlow | Basic | Must contain "chicago", "il", "illinois", or "606" |
| Address parsing | address-parser.ts | Structural | Extracts number, direction, name, type |
| Permit zone lookup | check-permit-zone.ts | Database | Queries parking_permit_zones table |
| Geocoding success | find-section.ts | API | Google Geocoding API validation |
| Chicago containment | find-section.ts | API | Validates geocoding result is in Chicago |
| Ward/section PostGIS | find-section.ts | Database | Geospatial point-in-polygon check |
| Address range matching | check-permit-zone.ts | Database | Number between zone range |
| Odd/even matching | check-permit-zone.ts | Database | If zone specifies odd/even |
| Phone normalization | profile-update.ts | Format | Converts to E.164: +1XXXXXXXXXX |

---

## 7. AVAILABLE WARD/SECTION DATA

### Coverage
- **Wards:** 1-50 (all Chicago wards)
- **Sections:** Multiple sections per ward (e.g., "1A", "2B", etc.)
- **Data source:** PostGIS-enabled street_cleaning_schedule table with geometry

### Accessible Via
- `find_section_for_point()` RPC function (PostGIS)
- `/pages/api/find-section.ts` endpoint
- Stored in `user_profiles.home_address_ward` and `user_profiles.home_address_section`

### Associated Data
- **Street cleaning dates:** Available for each ward/section
- **Permit zones:** Associated wards in parking_permit_zones table
- **Geometry:** Simplified GeoJSON geometry available for mapping

---

## 8. KEY FILES REFERENCE

| File | Purpose | Lines |
|------|---------|-------|
| `/lib/address-parser.ts` | Parse Chicago addresses | 145 |
| `/pages/api/find-section.ts` | Lookup ward/section via geocoding + PostGIS | 431 |
| `/pages/api/check-permit-zone.ts` | Validate permit zone status | 144 |
| `/pages/api/profile-update.ts` | Update profile + sync addresses | 262 |
| `/pages/api/user/update-address.ts` | Handle address changes + zone detection | 271 |
| `/components/EnhancedSignupFlow.tsx` | Signup form with address entry | 273 |
| `/lib/reverse-geocoder.ts` | Reverse geocoding with caching | 209 |
| `/pages/settings.tsx` | Settings page address update | (100+ lines) |
| `/pages/api/street-cleaning/process.ts` | Notifications using stored ward/section | (150+ lines) |

---

## 9. NOTES AND GAPS

### Current Strengths
- Geospatial queries using PostGIS for accurate ward/section lookup
- Address parsing handles directions and street types properly
- Permit zone detection prevents over-charging in residential areas
- Phone number normalization to E.164 format
- Integration with external street cleaning database

### Potential Areas for Enhancement
- Only basic keyword validation on signup (could use USPS/postal API)
- Reverse geocoding cache is in-memory only (not distributed)
- Address parsing assumes specific format (could be more flexible)
- Permit zone lookup is text-based (not geospatial)
- No validation that parsed address actually exists in Chicago

