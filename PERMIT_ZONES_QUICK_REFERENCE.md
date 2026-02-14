# Permit Zone System - Quick Reference

## Button Flow (Simplified)

```
HomeScreen.tsx (Line 691)
  ↓ checkCurrentLocation()
LocationService.ts (Line 546) checkParkingLocation()
  ↓ GET /api/mobile/check-parking?lat=X&lng=Y
check-parking.ts (Line 63)
  ↓ checkAllParkingRestrictions()
unified-parking-checker.ts (Line 95)
  ├─ reverseGeocode(lat,lng) → "1710 S Clinton St"
  ├─ parseChicagoAddress() → {number:1710, name:"CLINTON"}
  ├─ Query DB: parking_permit_zones WHERE street_name=CLINTON
  ├─ validatePermitZone() → check if active now
  └─ return { found, zoneName, permitRequired, message, severity }
```

## Key Files at a Glance

| What | Where | Lines |
|------|-------|-------|
| Button | HomeScreen.tsx | 691-698 |
| GPS Call | LocationService.ts | 546 |
| API Endpoint | check-parking.ts | 63 |
| Core Logic | unified-parking-checker.ts | 95 |
| DB Query | unified-parking-checker.ts | 223-234 |
| Time Check | permit-zone-time-validator.ts | 201 |
| Address Parse | address-parser.ts | 63 |

## Database Query Explained

```typescript
// Step 1: Parse reverse-geocoded address
"1710 S Clinton St" → {
  number: 1710,
  name: "CLINTON",
  direction: "S",
  type: "ST"
}

// Step 2: Query database
SELECT * FROM parking_permit_zones
WHERE
  street_name = 'CLINTON'          // Exact match
  AND address_range_low <= 1710    // In range
  AND address_range_high >= 1710   // In range
  AND status = 'ACTIVE'            // Active zones only
  AND (odd_even IS NULL OR
       (1710 % 2 = 0 AND odd_even = 'E'))  // Odd/even match

// Step 3: Check time
Is it Monday-Friday AND 6am-6pm (Chicago time)?
  YES → severity = "critical", permitRequired = true
  NO  → severity = "warning" or "info"
```

## Response Format

```json
{
  "permitZone": {
    "inPermitZone": true,
    "message": "PERMIT REQUIRED - Zone 123. Mon-Fri 6am-6pm. $100 ticket risk.",
    "zoneName": "Zone 123",
    "permitRequired": true,
    "severity": "critical",
    "restrictionSchedule": "Mon-Fri 6am-6pm"
  }
}
```

## Severity Meanings

| Level | Active Now? | Urgent? |
|-------|-------------|---------|
| **critical** | YES | MOVE NOW |
| **warning** | NO (within 2h) | SOON |
| **info** | NO (>2h) | FYI |
| **none** | N/A | OK |

## Testing Addresses

Real Chicago permit zones:
- 1710 S Clinton St (Zone 2483)
- 1234 W Diversey Ave
- 900 N Michigan Ave
- 3100 N Clybourn Ave

## Data Source

**Chicago Open Data Portal:**
https://data.cityofchicago.org/Transportation/Parking-Permit-Zones/u9xt-hiju

**Sync Location:** `/api/cron/sync-permit-zones`

## Performance

- API Response: 500ms-2s
- Cached: 30s on mobile
- Accuracy: within 30m GPS

## Error Handling

If query fails:
1. Catch error silently
2. Return `{ found: false, message: "Error checking..." }`
3. App continues with other restrictions

---

For complete details, see: `PERMIT_ZONE_DETECTION_RESEARCH.md`
