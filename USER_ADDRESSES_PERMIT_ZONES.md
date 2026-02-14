# Autopilot America: User Address Storage & Permit Zone Derivation

## Executive Summary

**YES, you can derive Chicago permit zones from user profile addresses.** The system is already designed to support this through the `parking_permit_zones` and `industrial_parking_zones` tables, and address parsing logic is already implemented.

---

## 1. ADDRESS FIELDS STORED ON USER_PROFILES TABLE

The `user_profiles` table stores multiple address fields for each user:

| Field Name | Type | Purpose | Notes |
|---|---|---|---|
| `home_address_full` | `string \| null` | Full residential address | e.g., "1710 S Clinton St" |
| `home_address_section` | `string \| null` | Parsed section for spatial queries | Part of residency validation |
| `home_address_ward` | `string \| null` | Ward number extracted from address | Used for administrative grouping |
| `mailing_address` | `string \| null` | Mailing/billing address | May differ from home address |
| `street_address` | `string \| null` | Alternative street address field | Legacy/alternate format |
| `mailing_city` | `string \| null` | City for mailing address | Usually "Chicago" |
| `mailing_state` | `string \| null` | State for mailing address | Usually "IL" |
| `mailing_zip` | `string \| null` | ZIP code | 5-digit postal code |
| `has_permit_zone` | `boolean \| null` | **ALREADY TRACKED** | Flag indicating user is in permit zone |
| `permit_zone_number` | `string \| null` | **ALREADY STORED** | The actual permit zone (e.g., "168") |

**Key Finding:** The system ALREADY tracks whether a user has a permit zone and stores the zone number!

---

## 2. HOW PERMIT ZONES ARE CURRENTLY DETERMINED

### A. From GPS Coordinates (Spatial Lookup)

**File:** `/home/randy-vollrath/ticketless-chicago/lib/unified-parking-checker.ts`

The system uses **address-based matching** from reverse-geocoding:

```typescript
// STEP 1: Reverse geocode GPS → address
const geocodeResult = await reverseGeocode(latitude, longitude);

// STEP 2: Parse address into components
const parsedAddress = parseChicagoAddress(`${streetNumber} ${streetName}`);
// Result: { number: 1710, direction: "S", name: "CLINTON", type: "ST", isOdd: true }

// STEP 3: Query permit zones table
const permitZones = await supabaseAdmin
  .from('parking_permit_zones')
  .select('zone, odd_even, address_range_low, address_range_high, street_direction, street_name, street_type')
  .eq('street_name', parsedAddress.name)                      // Match street name
  .eq('status', 'ACTIVE')
  .lte('address_range_low', parsedAddress.number)             // Check address range
  .gte('address_range_high', parsedAddress.number);

// STEP 4: Filter by odd/even if applicable
const matchingZones = permitZones.filter(zone => {
  if (zone.odd_even) {
    return parsedAddress.isOdd ? zone.odd_even === 'O' : zone.odd_even === 'E';
  }
  return true;
});
```

### B. Query Pattern (Address → Permit Zone)

**File:** `/home/randy-vollrath/ticketless-chicago/pages/api/check-permit-zone.ts`

This endpoint accepts a full address string and returns the permit zone:

```
GET /api/check-permit-zone?address=1710+S+Clinton+St
```

**Response:**
```json
{
  "hasPermitZone": true,
  "zones": [
    {
      "zone": "168",
      "status": "ACTIVE",
      "addressRange": "1700-1799 S CLINTON ST",
      "ward": "Ward 27"
    }
  ],
  "parsedAddress": {
    "number": 1710,
    "direction": "S",
    "name": "CLINTON",
    "type": "ST"
  }
}
```

---

## 3. DATABASE TABLES USED FOR PERMIT ZONE LOOKUP

### parking_permit_zones Table

Stores residential permit parking zones with address ranges:

| Column | Type | Purpose |
|---|---|---|
| `zone` | string | Zone identifier (e.g., "168") |
| `street_name` | string | Street name normalized (e.g., "CLINTON") |
| `street_direction` | string \| null | N, S, E, W, NE, NW, SE, SW |
| `street_type` | string \| null | ST, AVE, BLVD, DR, etc. |
| `address_range_low` | number | Lowest address number on street (e.g., 1700) |
| `address_range_high` | number | Highest address number on street (e.g., 1799) |
| `odd_even` | string \| null | "O" for odd, "E" for even, null for both |
| `ward_low` | number \| null | Administrative ward number |
| `ward_high` | number \| null | Upper bound if spanning wards |
| `status` | string | "ACTIVE" or other status |

### industrial_parking_zones Table

Similar structure for industrial zones with additional restrictions:

| Column | Type | Notes |
|---|---|---|
| `zone` | string | Industrial zone identifier |
| `street_name` | string | Street name |
| `street_direction` | string \| null | Direction abbreviation |
| `street_type` | string \| null | Street type abbreviation |
| `address_range_low` | number | Low address |
| `address_range_high` | number | High address |
| `restriction_hours` | string | e.g., "8:00 AM - 3:00 PM" |
| `restriction_days` | string | e.g., "Mon-Fri" |
| `status` | string | "ACTIVE" or inactive |

---

## 4. ADDRESS PARSING LOGIC

**File:** `/home/randy-vollrath/ticketless-chicago/lib/address-parser.ts`

The `parseChicagoAddress()` function breaks down addresses into queryable components:

```typescript
parseChicagoAddress("1710 S Clinton St") returns:
{
  number: 1710,           // Street number
  direction: "S",         // Direction (S, N, E, W, NE, NW, SE, SW)
  name: "CLINTON",        // Street name (normalized to uppercase)
  type: "ST",             // Street type (ST, AVE, BLVD, DR, RD, LN, PL, CT, PKWY, TER, WAY)
  isOdd: false,           // Boolean: true if odd-numbered address
  original: "1710 S Clinton St"  // Original input
}
```

**Supported formats:**
- `1710 S Clinton St`
- `123 North Michigan Avenue`
- `456 East Elm Drive`

---

## 5. HOW TO DERIVE PERMIT ZONES FROM USER ADDRESSES

### Option A: Use Existing API Endpoint

**Simplest approach** - reuse existing infrastructure:

```typescript
// Step 1: Get user's home address from profile
const userProfile = await supabaseAdmin
  .from('user_profiles')
  .select('home_address_full')
  .eq('user_id', userId)
  .single();

// Step 2: Call existing permit zone check endpoint
const zoneCheckResponse = await fetch(
  `/api/check-permit-zone?address=${encodeURIComponent(userProfile.home_address_full)}`
);

const zoneData = await zoneCheckResponse.json();
if (zoneData.hasPermitZone) {
  const permitZone = zoneData.zones[0].zone; // e.g., "168"
}
```

**File Reference:** Already implemented in `/home/randy-vollrath/ticketless-chicago/pages/api/user/update-address.ts` (lines 50-56)

### Option B: Direct Database Query

**More efficient** - query database directly in backend logic:

```typescript
import { parseChicagoAddress } from './address-parser';
import { supabaseAdmin } from './supabase';

async function getPermitZoneForAddress(address: string): Promise<string | null> {
  // Parse address
  const parsed = parseChicagoAddress(address);
  if (!parsed) return null;

  // Query permit zones table
  const { data: zones } = await supabaseAdmin
    .from('parking_permit_zones')
    .select('zone, odd_even')
    .eq('street_name', parsed.name)
    .eq('status', 'ACTIVE')
    .lte('address_range_low', parsed.number)
    .gte('address_range_high', parsed.number);

  if (!zones?.length) return null;

  // Filter by odd/even
  const matching = zones.filter(zone => {
    if (!zone.odd_even) return true;
    return parsed.isOdd ? zone.odd_even === 'O' : zone.odd_even === 'E';
  });

  return matching[0]?.zone || null;
}
```

### Option C: Batch Process All Users

```typescript
async function derivePermitZonesForAllUsers() {
  // Get all users with addresses
  const { data: users } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, home_address_full')
    .not('home_address_full', 'is', null);

  for (const user of users) {
    const zone = await getPermitZoneForAddress(user.home_address_full);
    
    // Update profile
    if (zone) {
      await supabaseAdmin
        .from('user_profiles')
        .update({
          permit_zone_number: zone,
          has_permit_zone: true,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.user_id);
    }
  }
}
```

---

## 6. EXISTING IMPLEMENTATION: Address → Permit Zone Flow

The system **already has this integrated** at `/home/randy-vollrath/ticketless-chicago/pages/api/user/update-address.ts`:

```typescript
// When user updates their address:
const newAddress = req.body.newAddress;  // e.g., "1710 S Clinton St"

// Check if new address is in a permit zone
const zoneCheckResponse = await fetch(
  `/api/check-permit-zone?address=${encodeURIComponent(newAddress)}`
);

const zoneCheck = await zoneCheckResponse.json();
const newHasZone = zoneCheck.hasPermitZone;  // Boolean

// Update user profile
await supabaseAdmin
  .from('user_profiles')
  .update({
    home_address_full: newAddress,
    has_permit_zone: newHasZone,
    updated_at: new Date().toISOString()
  })
  .eq('user_id', userId);

// If moved INTO permit zone, charge $30 fee and email user
if (movedIntoZone) {
  // Create Stripe payment link
  // Send notification email
}

// If moved OUT OF permit zone, process potential refund
if (movedOutOfZone) {
  // Flag for manual review
  // Notify admin
}
```

**This is ALREADY PRODUCTION CODE** - it's handling permit zone detection and billing!

---

## 7. KEY FIELDS FOR AUTOPILOT INTEGRATION

When syncing Autopilot America user profiles, extract and store:

| Field | Example | Priority | Use |
|---|---|---|---|
| `home_address_full` | "1710 S Clinton St" | **CRITICAL** | Permit zone lookup |
| `mailing_address` | "1710 S Clinton St" | High | Billing/correspondence |
| `city` | "Chicago" | Medium | City validation |
| `mailing_zip` | "60616" | Medium | ZIP-based filtering |
| `has_permit_zone` | `true` | Medium | Pre-computed flag |
| `permit_zone_number` | "168" | Medium | Pre-computed zone |

---

## 8. DATA QUALITY CONSIDERATIONS

### Address Parsing Success Rate

The `parseChicagoAddress()` function requires:
- Valid street number (integer)
- Valid street name
- Optional: direction (N, S, E, W, NE, NW, SE, SW)
- Optional: street type (ST, AVE, BLVD, etc.)

**Common issues:**
- Incomplete addresses: `"Clinton St"` (missing number) → ❌ fails
- Invalid formats: `"Chicago, IL 60616"` → ❌ fails
- Leading spaces: `" 1710 S Clinton St"` → ✅ handled (trimmed)
- Variations: `"1710 South Clinton Street"` → ✅ normalized

### Validation Checklist

Before querying permit zones, validate:
1. ✅ Address is not null/empty
2. ✅ Address contains a street number
3. ✅ Address contains a street name
4. ✅ Address parses successfully
5. ✅ Parsed number is within database ranges

---

## 9. RECOMMENDED IMPLEMENTATION FOR AUTOPILOT

### Step 1: Data Sync Schema

```typescript
interface AutopilotUserProfile {
  id: string;                    // Autopilot user ID
  email: string;
  firstName: string;
  lastName: string;
  homeAddress: string;           // Maps to home_address_full
  mailingAddress?: string;       // Maps to mailing_address
  city?: string;                 // Maps to city
  state?: string;                // Maps to mailing_state
  zipCode?: string;              // Maps to mailing_zip
}
```

### Step 2: Sync Function

```typescript
async function syncAutopilotUserToTicketless(autopilotUser: AutopilotUserProfile) {
  // Parse address
  const parsed = parseChicagoAddress(autopilotUser.homeAddress);
  
  // Lookup permit zone
  let permitZone: string | null = null;
  let hasPermitZone = false;
  
  if (parsed) {
    const { data } = await supabaseAdmin
      .from('parking_permit_zones')
      .select('zone')
      .eq('street_name', parsed.name)
      .eq('status', 'ACTIVE')
      .lte('address_range_low', parsed.number)
      .gte('address_range_high', parsed.number)
      .limit(1);
    
    if (data?.[0]?.zone) {
      permitZone = data[0].zone;
      hasPermitZone = true;
    }
  }

  // Create or update user in Ticketless
  await supabaseAdmin.from('user_profiles').upsert({
    user_id: autopilotUser.id,
    email: autopilotUser.email,
    first_name: autopilotUser.firstName,
    last_name: autopilotUser.lastName,
    home_address_full: autopilotUser.homeAddress,
    mailing_address: autopilotUser.mailingAddress || autopilotUser.homeAddress,
    city: autopilotUser.city || 'Chicago',
    mailing_state: autopilotUser.state || 'IL',
    mailing_zip: autopilotUser.zipCode,
    has_permit_zone: hasPermitZone,
    permit_zone_number: permitZone,
    updated_at: new Date().toISOString()
  });
}
```

---

## 10. SUMMARY

### Can we derive permit zones from user addresses?

**YES, absolutely.** ✅

### What's the mechanism?

1. User address stored in `user_profiles.home_address_full`
2. Address parsed into components (number, direction, name, type)
3. Components matched against `parking_permit_zones` table with address ranges
4. Odd/even filtering applied if configured
5. Zone number returned and stored in `permit_zone_number`

### Is this already implemented?

**YES, partially.** ✅
- Address parsing: ✅ Fully implemented
- Permit zone lookup: ✅ Fully implemented
- API endpoint: ✅ Exists (`/api/check-permit-zone`)
- Auto-detection on address update: ✅ Implemented

### What's missing for Autopilot integration?

1. Sync logic from Autopilot → Ticketless database
2. Scheduled cron job to bulk-derive permit zones for existing users
3. Webhook handler for real-time user updates

### Files to reference

- Address parser: `/home/randy-vollrath/ticketless-chicago/lib/address-parser.ts`
- Unified checker: `/home/randy-vollrath/ticketless-chicago/lib/unified-parking-checker.ts`
- API endpoint: `/home/randy-vollrath/ticketless-chicago/pages/api/check-permit-zone.ts`
- Address updater: `/home/randy-vollrath/ticketless-chicago/pages/api/user/update-address.ts`
- Database types: `/home/randy-vollrath/ticketless-chicago/lib/database.types.ts`

