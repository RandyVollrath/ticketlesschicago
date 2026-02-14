# Mobile App: Permit Zones Quick Start

## What is a Permit Zone?

In Chicago, residential permit parking zones require valid parking permits during restricted hours (usually Monday-Friday 6am-6pm). This feature helps users know if they're in a permit zone before parking.

## Implementation Summary

### Files to Create

1. **Hook** - `/src/hooks/usePermitZoneCheck.ts`
   - Fetches permit zone data from API
   - Manages loading state
   - Caches results

2. **Component** - `/src/components/PermitZoneCard.tsx`
   - Displays warning when in permit zone
   - Shows zone name and restriction hours
   - Color-coded by severity

3. **Integration** - Update `HomeScreen.tsx` and `MapScreen.tsx`
   - Call hook on location change
   - Display card when needed

### Data Flow

```
User Location (GPS)
    ↓
usePermitZoneCheck Hook
    ↓
/api/mobile/check-parking API
    ↓
PermitZoneCard Component
    ↓
User sees alert or map update
```

## API Reference

### Endpoint: `/api/mobile/check-parking`

**Request:**
```typescript
GET /api/mobile/check-parking?lat=41.8734&lng=-87.6281
```

**Response:**
```typescript
{
  permitZone: {
    inPermitZone: boolean,
    message: string,
    zoneName: string | undefined,
    permitRequired: boolean | undefined,
    restrictionSchedule: string | undefined,
    severity: 'critical' | 'warning' | 'info' | 'none'
  }
  // ... other restrictions
}
```

**Severity Levels:**
- `critical`: Permit required NOW
- `warning`: Permit required within 2 hours
- `info`: Permit required today
- `none`: No permit zone

## Example: Quick Integration

### 1. Add Hook to HomeScreen

```typescript
import { usePermitZoneCheck } from '../hooks/usePermitZoneCheck';

export function HomeScreen() {
  const { checkLocationPermits, permitZoneData } = usePermitZoneCheck();

  useEffect(() => {
    const checkParking = async () => {
      await checkLocationPermits();
    };
    
    checkParking();
    const interval = setInterval(checkParking, 300000); // Every 5 min
    return () => clearInterval(interval);
  }, []);

  return (
    <ScrollView>
      {permitZoneData?.inPermitZone && (
        <PermitZoneAlert data={permitZoneData} />
      )}
      {/* Rest of screen */}
    </ScrollView>
  );
}
```

### 2. Simple Alert Component

```typescript
export function PermitZoneAlert({ data }) {
  if (!data?.inPermitZone) return null;

  return (
    <View style={styles.alert}>
      <Text style={styles.emoji}>🅿️</Text>
      <Text style={styles.title}>Permit Zone</Text>
      <Text style={styles.message}>{data.message}</Text>
      {data.permitRequired && (
        <Text style={styles.warning}>Permit required now!</Text>
      )}
    </View>
  );
}
```

## Key Files Already Exist

You don't need to create everything from scratch! Use these:

| File | Purpose | Path |
|------|---------|------|
| API Endpoint | Check all parking restrictions | `/pages/api/mobile/check-parking.ts` |
| Address Parser | Parse Chicago addresses | `/lib/address-parser.ts` |
| Time Validator | Check restriction times | `/lib/permit-zone-time-validator.ts` |
| DB Schema | Permit zone data | `parking_permit_zones` table |

## Testing Addresses

These are real Chicago addresses in permit zones:

- `1710 S Clinton St` - Zone 2483, Ward 25
- `1234 W Diversey Ave` - Loop area
- `900 N Michigan Ave` - Downtown
- `3100 N Clybourn Ave` - Clybourn Corridor

## Common Issues & Fixes

### "No permit zones found"
- Check if address is in Chicago
- Use GPS coordinates (more reliable)
- Verify API is responding

### Slow API response
- Use GPS instead of address lookup
- API caches for 1 hour
- Database has indexes on street_name

### Wrong time shown
- Ensure device timezone is correct
- API uses Chicago time automatically
- Check restriction_schedule field

## Next Steps

1. Create `/src/hooks/usePermitZoneCheck.ts`
2. Create `/src/components/PermitZoneCard.tsx`
3. Update HomeScreen to use hook
4. Test with real GPS data
5. Add to MapScreen for visualization

## Resources

- Main integration guide: `AUTOPILOT_INTEGRATION_SUMMARY.md`
- API docs: `/pages/api/mobile/check-parking.ts`
- Time validator: `/lib/permit-zone-time-validator.ts`
- Example web component: `/components/PermitZoneWarning.tsx`

