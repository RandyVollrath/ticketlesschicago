# Address Handling - Quick Reference

## User Address Entry Points

| Location | Purpose | File |
|----------|---------|------|
| Signup Form | Initial address capture | `components/EnhancedSignupFlow.tsx` |
| Settings Page | Address update/change | `pages/settings.tsx` |

## Validation Layers

```
Frontend Input
    ↓
Keyword Validation (chicago, il, illinois, 606)
    ↓
Address Parsing (extract number, direction, street, type)
    ↓
Permit Zone Lookup (database query)
    ↓
Geocoding (Google API → lat/lng)
    ↓
PostGIS Lookup (find ward/section)
    ↓
Storage in user_profiles
```

## Key APIs and Functions

### Address Parsing
```typescript
// File: lib/address-parser.ts
parseChicagoAddress(address: string): ParsedAddress | null
// Input: "1710 S Clinton St"
// Output: {number: 1710, direction: "S", name: "CLINTON", type: "ST", isOdd: false}
```

### Ward/Section Lookup
```typescript
// File: pages/api/find-section.ts
GET /api/find-section?address=1710%20S%20Clinton%20St
// Returns: {ward: "13", section: "8A", nextCleaningDate: "2025-01-15", ...}
```

### Permit Zone Check
```typescript
// File: pages/api/check-permit-zone.ts
GET /api/check-permit-zone?address=1710%20S%20Clinton%20St
// Returns: {hasPermitZone: true, zones: [...], parsedAddress: {...}}
```

### Update Address (Triggers Zone Detection)
```typescript
// File: pages/api/user/update-address.ts
POST /api/user/update-address
// Body: {userId, newAddress}
// Detects if user moved INTO or OUT OF permit zone
```

## Database Tables

### user_profiles (where addresses are stored)
- `home_address_full` - Full address string
- `home_address_ward` - Numeric ward (1-50)
- `home_address_section` - Section code (e.g., "8A")
- `street_address` - Alternative address field
- `zip_code`, `mailing_address`, `mailing_city`, `mailing_state`, `mailing_zip`
- `has_permit_zone` - Boolean flag

### parking_permit_zones (permit zone lookup table)
- Cached from Chicago Open Data portal
- Indexed by: street_name, street_direction, street_type, status
- Contains: address ranges, odd/even, ward info
- Used for permit fee detection

### street_cleaning_schedule (PostGIS geometry table)
- Contains: ward, section, cleaning_date, geospatial geometry
- Located in MyStreetCleaning Supabase (separate instance)
- RPC function: `find_section_for_point(lat, lng)` → ward, section

## API Environment Variables

| Variable | Purpose | Used By |
|----------|---------|---------|
| `GOOGLE_API_KEY` | Geocoding | find-section.ts |
| `GOOGLE_MAPS_API_KEY` | Reverse geocoding | reverse-geocoder.ts |
| `MSC_SUPABASE_URL` | MyStreetCleaning DB | profile-update.ts |
| `MSC_SUPABASE_SERVICE_ROLE_KEY` | MyStreetCleaning auth | profile-update.ts |

## Flow Examples

### Scenario 1: New Signup
```
1. User enters "123 S Main St, Chicago, IL"
2. Frontend checks for Chicago keywords ✓
3. Stores in localStorage
4. OAuth flow initiated
5. Address saved to user_profiles (no ward/section yet)
6. Manual trigger or background job runs find-section.ts
7. Ward/section populated
8. check-permit-zone runs to determine if $30 fee needed
```

### Scenario 2: Address Update (Already Registered)
```
1. User changes address in settings
2. Frontend validates
3. POST to /api/user/update-address
4. Check permit zone status BEFORE
5. Check permit zone status AFTER
6. If moved INTO zone → create Stripe payment link for $30
7. If moved OUT of zone → flag for manual refund review
8. Update user_profiles
9. Sync to MyStreetCleaning database
10. Street cleaning notifications now use new address
```

## Address Format Requirements

### Accepted Formats
- "1710 S Clinton St"
- "123 North Michigan Avenue"
- "456 W Madison Street, Chicago, IL"
- "789 East 79th Place, Chicago, IL 60619"

### Required Elements
- Street number (digits)
- Street name
- Must contain "chicago", "il", "illinois", or "606" in signup

### Optional Elements
- Direction (N, S, E, W, NE, NW, SE, SW, North, South, East, West, etc.)
- Street type (St, Avenue, Blvd, Drive, Road, etc.)
- City, State, Zip

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| Address not found | Geocoding failed | Show user friendly error, suggest format |
| Not in Chicago | Geocoded outside city | Confirm address is in Chicago |
| No section found | Address in boundary/gap | Explain coverage limitations |
| Permit zone ambiguous | Multiple zones match | Show options or use PostGIS for clarity |

## Performance Notes

- Address parsing: ~1ms (synchronous)
- Geocoding: ~300-500ms (with retries up to 2 seconds)
- PostGIS lookup: ~50-100ms
- Permit zone lookup: ~10-50ms (database query)
- Reverse geocoding: Cached (24hr TTL, max 1000 entries)

## Integration Points

1. **Google Maps API** - Geocoding, Reverse Geocoding
2. **MyStreetCleaning Database** - PostGIS geometry, ward/section lookup
3. **Stripe** - Permit zone fee payment
4. **Resend (Email)** - Permit zone notifications
5. **ClickSend** - SMS/Voice notifications

