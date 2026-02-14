# Quick Reference: Address to Permit Zone Lookup

## TL;DR

**Question:** Can we derive Chicago permit zones from Autopilot America user addresses?

**Answer:** YES! The system is already built for this.

---

## Address Fields Available

From `user_profiles` table:

```
home_address_full      (e.g., "1710 S Clinton St")     PRIMARY
mailing_address        (billing address)
street_address         (legacy field)
home_address_ward      (pre-computed ward)
has_permit_zone        (boolean flag - ALREADY TRACKED)
permit_zone_number     (zone ID - ALREADY STORED)
```

---

## How It Works (3 Steps)

### Step 1: Parse Address
Input: `"1710 S Clinton St"`
```
Address Parser (/lib/address-parser.ts)
  ↓
Output: {
  number: 1710,
  direction: "S",
  name: "CLINTON",
  type: "ST",
  isOdd: false
}
```

### Step 2: Query Database
```
SELECT zone FROM parking_permit_zones
WHERE street_name = "CLINTON"
  AND address_range_low <= 1710
  AND address_range_high >= 1710
  AND status = "ACTIVE"
  AND (odd_even IS NULL OR odd_even = "E")
```

### Step 3: Return Zone
Output: `"168"` ✅

---

## Database Tables

### parking_permit_zones
- Contains residential permit zone mappings
- Key columns: zone, street_name, address_range_low, address_range_high, odd_even, status

### industrial_parking_zones
- Similar structure for industrial zones
- Additional columns: restriction_hours, restriction_days

---

## API Endpoint (Already Exists)

```
GET /api/check-permit-zone?address=1710+S+Clinton+St
```

Response:
```json
{
  "hasPermitZone": true,
  "zones": [{"zone": "168", "status": "ACTIVE", ...}],
  "parsedAddress": {...}
}
```

---

## Code Files

| File | Purpose |
|------|---------|
| `/lib/address-parser.ts` | Parse address string into components |
| `/pages/api/check-permit-zone.ts` | API endpoint for lookup |
| `/lib/unified-parking-checker.ts` | Complete parking checker (uses this logic) |
| `/pages/api/user/update-address.ts` | Auto-detection on address change |

---

## Implementation Options

### Option 1: API Call (Simplest)
```typescript
const response = await fetch(`/api/check-permit-zone?address=${address}`);
const data = await response.json();
console.log(data.zones[0].zone); // "168"
```

### Option 2: Direct Query (Most Efficient)
```typescript
import { parseChicagoAddress } from '@/lib/address-parser';

const parsed = parseChicagoAddress(address);
const { data } = await supabaseAdmin
  .from('parking_permit_zones')
  .select('zone')
  .eq('street_name', parsed.name)
  .eq('status', 'ACTIVE')
  .lte('address_range_low', parsed.number)
  .gte('address_range_high', parsed.number);
```

### Option 3: Batch Process (For bulk sync)
```typescript
// Query all users
const users = await supabaseAdmin
  .from('user_profiles')
  .select('user_id, home_address_full')
  .not('home_address_full', 'is', null);

// For each user, derive zone and update
for (const user of users) {
  const zone = await getPermitZoneForAddress(user.home_address_full);
  await supabaseAdmin
    .from('user_profiles')
    .update({
      permit_zone_number: zone,
      has_permit_zone: !!zone
    })
    .eq('user_id', user.user_id);
}
```

---

## Address Format Requirements

VALID:
- ✅ "1710 S Clinton St"
- ✅ "123 North Michigan Avenue"
- ✅ "456 East Elm Drive"

INVALID:
- ❌ "Clinton St" (missing number)
- ❌ "Chicago, IL 60616" (city-only format)
- ❌ "PO Box 123" (not a street address)

---

## Critical Fields for Autopilot Sync

| Field | Type | Required | Example |
|-------|------|----------|---------|
| home_address_full | string | YES | "1710 S Clinton St" |
| email | string | YES | user@example.com |
| first_name | string | NO | John |
| last_name | string | NO | Doe |
| mailing_address | string | NO | Same as home_address_full |
| mailing_zip | string | NO | 60616 |

---

## Production Usage Already In Place

The system ALREADY:
- ✅ Parses user addresses on file
- ✅ Detects permit zones automatically
- ✅ Stores zone in `permit_zone_number`
- ✅ Charges $30 fee when user moves into zone
- ✅ Handles zone change detection on address update

See: `/pages/api/user/update-address.ts` (lines 50-80)

---

## Next Steps for Autopilot Integration

1. Extract `homeAddress`, `mailingAddress`, `zip` from Autopilot profiles
2. Call `parseChicagoAddress()` to validate format
3. Query `parking_permit_zones` table to derive zone
4. Store in `home_address_full` and `permit_zone_number` fields
5. Set `has_permit_zone` boolean based on query result

---

## Error Handling

```typescript
try {
  const parsed = parseChicagoAddress(address);
  if (!parsed) {
    // Invalid format - log and skip
    console.log(`Invalid address format: ${address}`);
    return null;
  }

  const zones = await queryPermitZones(parsed);
  if (!zones?.length) {
    // Valid format but not in any zone
    return null;
  }

  return zones[0].zone; // First match
} catch (error) {
  console.error('Permit zone lookup failed:', error);
  return null; // Graceful degradation
}
```

---

## Key Insights

1. **Address-based not GPS-based**: Lookup uses street address, not coordinates
2. **No API calls needed**: All data is in local database, very fast
3. **Odd/even matters**: Some zones split by odd/even addresses
4. **Already in production**: This logic handles $30 permit fees
5. **High success rate**: Most Chicago addresses format correctly

