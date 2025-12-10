# License Plate Renewal System - Illinois Secretary of State

## Overview

Complete system for automatic Illinois license plate renewals through remitters. Supports all vehicle types with accurate fee calculation based on Illinois Secretary of State pricing.

## Supported Plate Types & Fees

### Standard Plates

| Plate Type | Base Cost | Personalized | Vanity |
|------------|-----------|--------------|--------|
| **Passenger** | $151 | $158 (+$7) | $164 (+$13) |
| **Motorcycle** | $41 | $48 (+$7) | $54 (+$13) |
| **B-Truck** | $151 | $158 (+$7) | $164 (+$13) |
| **C-Truck** | $218 | N/A | N/A |
| **Persons with Disabilities** | $151 | $158 (+$7) | $164 (+$13) |

### Weight-Based Plates

**Recreational Trailer (RT)**
| Weight Range | Cost |
|--------------|------|
| ≤ 3,000 lbs | $18 |
| 3,001 - 8,000 lbs | $30 |
| 8,001 - 10,000 lbs | $38 |
| 10,001+ lbs | $50 |

**Recreational Vehicle (RV)**
| Weight Range | Cost |
|--------------|------|
| ≤ 8,000 lbs | $78 |
| 8,001 - 10,000 lbs | $90 |
| 10,001+ lbs | $102 |

## Database Schema

### New Fields in `user_profiles`

```sql
license_plate_renewal_cost    DECIMAL(10,2)  -- Auto-calculated
license_plate_type            TEXT           -- PASSENGER, MOTORCYCLE, etc.
license_plate_is_personalized BOOLEAN        -- +$7 fee
license_plate_is_vanity       BOOLEAN        -- +$13 fee
license_plate_last_accessed_at TIMESTAMPTZ   -- Remitter access tracking
trailer_weight                INTEGER        -- For RT plates
rv_weight                     INTEGER        -- For RV plates
```

### Auto-Calculation Function

```sql
calculate_plate_renewal_cost(
  plate_type TEXT,
  is_personalized BOOLEAN,
  is_vanity BOOLEAN,
  trailer_weight_lbs INTEGER,
  rv_weight_lbs INTEGER
) RETURNS DECIMAL(10,2)
```

Automatically triggered when any of these fields change.

## User Flow

### 1. User Sets Up License Plate Renewal

**Settings Page** (`/settings`):
1. User enters license plate expiry date
2. User selects Illinois plate type (dropdown with prices)
3. If RT/RV: User enters vehicle weight
4. User checks personalized/vanity boxes if applicable
5. System automatically calculates and displays renewal cost

**Protection Users Only**: License plate type fields only visible to users with `has_protection = true`.

### 2. System Tracks Renewal

30 days before `license_plate_expiry`:
- System notifies remitter
- Remitter calls `/api/license-plate/get-renewal-info?userId={uuid}`

### 3. Remitter Processes Renewal

**Endpoint**: `GET /api/license-plate/get-renewal-info?userId={uuid}`

**Response**:
```json
{
  "success": true,
  "renewalInfo": {
    "licensePlate": "ABC123",
    "licenseState": "IL",
    "expiryDate": "2025-06-30",
    "daysUntilExpiry": 25,
    "plateType": "PASSENGER",
    "isPersonalized": false,
    "isVanity": false,
    "renewalCost": 151.00,
    "trailerWeight": null,
    "rvWeight": null
  },
  "vehicleInfo": {
    "type": "passenger",
    "year": 2020,
    "vin": "1HGCM82633A123456"
  },
  "mailingAddress": {
    "name": "John Doe",
    "street": "123 Main St",
    "city": "Chicago",
    "state": "IL",
    "zip": "60601"
  },
  "message": "Renewal info retrieved. Submit to Illinois Secretary of State immediately."
}
```

**Important**: This endpoint updates `license_plate_last_accessed_at` timestamp. Similar to driver's license access tracking.

### 4. Remitter Submits to State

Remitter uses provided information to:
1. Log into Illinois Secretary of State renewal portal
2. Enter license plate number and user details
3. Pay renewal fee using system funds
4. Receive confirmation and new registration
5. Notify user of completion

## Relationship to City Sticker Renewals

**Both Renewals Handled by Same Remitter**:
- City sticker renewal: 30 days before `city_sticker_expiry`
- License plate renewal: 30 days before `license_plate_expiry`
- Often happen at different times (different renewal cycles)
- Remitter can batch process for efficiency

**Documents Required**:
- **City Sticker**: Requires driver's license + utility bill (if permit zone)
- **License Plate**: Only requires renewal info (no documents)

## Fee Calculation Examples

```sql
-- Standard passenger car
SELECT calculate_plate_renewal_cost('PASSENGER', false, false, NULL, NULL);
-- Returns: $151.00

-- Personalized motorcycle
SELECT calculate_plate_renewal_cost('MOTORCYCLE', true, false, NULL, NULL);
-- Returns: $48.00 ($41 + $7)

-- Vanity passenger plate
SELECT calculate_plate_renewal_cost('PASSENGER', false, true, NULL, NULL);
-- Returns: $164.00 ($151 + $13)

-- Small recreational trailer (2,500 lbs)
SELECT calculate_plate_renewal_cost('RT', false, false, 2500, NULL);
-- Returns: $18.00

-- Large recreational trailer (9,000 lbs)
SELECT calculate_plate_renewal_cost('RT', false, false, 9000, NULL);
-- Returns: $38.00

-- Medium RV (9,500 lbs)
SELECT calculate_plate_renewal_cost('RV', false, false, NULL, 9500);
-- Returns: $90.00
```

## Privacy & Data Handling

### No Documents Required
Unlike city stickers, license plate renewals don't require document storage:
- ✅ No license image needed
- ✅ No utility bill needed
- ✅ Only renewal info (plate number, expiry, type)

### Access Tracking
`license_plate_last_accessed_at` tracks when remitter accesses renewal info:
- Updated when `/api/license-plate/get-renewal-info` is called
- Can be used for auditing and debugging
- Does NOT trigger 48h deletion (no PII stored)

## Settings Page UI

**License Plate Type Section** (Protection users only):
1. **Dropdown**: Select plate type with prices shown
2. **Conditional Inputs**: Weight inputs appear for RT/RV plates
3. **Checkboxes**: Personalized (+$7) and Vanity (+$13)
4. **Calculated Cost Display**: Shows total renewal cost in blue box

Example:
```
Illinois License Plate Type (Required for automatic renewal)
[Select plate type ▼]
  Passenger ($151/year)
  Motorcycle ($41/year)
  B-Truck ($151/year)
  ...

☐ Personalized Plate (+$7/year)
☐ Vanity Plate (+$13/year)

┌──────────────────────────────────┐
│ Calculated Renewal Cost: $151.00 │
└──────────────────────────────────┘
```

## Files Created/Modified

### New Files:
- `database/migrations/add_license_plate_renewal_support.sql` - Complete migration with fee calculation function
- `pages/api/license-plate/get-renewal-info.ts` - Remitter endpoint for renewal info
- `LICENSE_PLATE_RENEWAL_SYSTEM.md` - This documentation

### Modified Files:
- `pages/settings.tsx` - Added license plate type UI fields
- `pages/api/cron/cleanup-residency-proofs.ts` - Changed to 31-day deletion

## Testing Checklist

- [ ] Run SQL migration successfully
- [ ] Test fee calculation function with all plate types
- [ ] Verify UI shows plate type dropdown for Protection users
- [ ] Test weight inputs appear for RT/RV plates
- [ ] Verify calculated cost updates when fields change
- [ ] Test remitter endpoint returns correct renewal info
- [ ] Verify `license_plate_last_accessed_at` updates on endpoint call
- [ ] Test with personalized and vanity plates
- [ ] Verify different weight ranges for RT/RV

## Migration Commands

```bash
# 1. Run email forwarding migration (if not already run)
psql $DATABASE_URL -f database/migrations/add_email_forwarding_id.sql

# 2. Run license plate renewal migration
psql $DATABASE_URL -f database/migrations/add_license_plate_renewal_support.sql
```

## Remitter Integration

Remitters should:
1. **Monitor both renewal dates**: `city_sticker_expiry` AND `license_plate_expiry`
2. **Call appropriate endpoint**:
   - City sticker: `/api/city-sticker/get-driver-license` + `/api/city-sticker/get-residency-proof`
   - License plate: `/api/license-plate/get-renewal-info`
3. **Submit to correct authority**:
   - City sticker: Chicago City Clerk
   - License plate: Illinois Secretary of State
4. **Track separately**: Different renewal cycles, different authorities

## Cost Recovery

**Renewal Cost Breakdown**:
- User pays: Subscription ($15-25/month for Protection)
- System pays: Renewal fees to state ($41-$218/year depending on plate type)
- System profit: Subscription revenue minus renewal costs

**Example**:
- User with passenger car: $151/year renewal cost
- User pays $25/month = $300/year
- System profit: $300 - $151 = $149/year (before other costs)

## Future Enhancements

1. **Specialty Plates**: Add support for specialty plates (sports teams, organizations)
2. **Multi-Vehicle**: Support users with multiple vehicles/plates
3. **Auto-Detect**: Use VIN decoder to suggest plate type
4. **Renewal Reminders**: Send reminders when renewal processed
5. **Receipt Storage**: Store renewal confirmations from state
