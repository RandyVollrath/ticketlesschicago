# Parking Check API - Executive Summary

## Files You Need to Read

1. **BackgroundTaskService.ts** (Primary mobile orchestrator)
   - `triggerParkingCheck()` - Lines 1122-1347
   - `scheduleRestrictionReminders()` - Lines 1530-1709

2. **LocationService.ts** (Mobile-to-API bridge)
   - `checkParkingLocation()` - Lines 808-929 (CALLS ENDPOINT)
   - `saveParkedLocationToServer()` - Lines 942-983
   - Interfaces ParkingRule, ParkingCheckResult - Lines 14-75

3. **LocalNotificationService.ts** (Notification scheduling)
   - `scheduleNotificationsForParking()` - Lines 126-267
   - Interfaces ParkingRestriction, ReminderPreferences - Lines 45-66

4. **check-parking-location-enhanced.ts** (Backend API endpoint)
   - Full handler - Lines 1-92
   - Called via: `GET /api/mobile/check-parking?lat=X&lng=Y&accuracy=Z&confidence=C`

---

## Data Flow at a Glance

```
Car Disconnects (Bluetooth)
    ↓
BackgroundTaskService.triggerParkingCheck()
    ├─ Get GPS coordinates
    ├─ Call: LocationService.checkParkingLocation(coords)
    │    └─ GET /api/mobile/check-parking?lat=X&lng=Y&accuracy=Z&confidence=C
    │         ↓ [API checks street cleaning, winter ban, snow ban, permit zones]
    │         ↓ Returns: { address, rules[], rawApiData }
    ├─ Save result locally & to history
    ├─ Send immediate notification to user
    ├─ Call: LocationService.saveParkedLocationToServer() 
    │    └─ POST /api/mobile/save-parked-location (sends metadata for server reminders)
    └─ Call: BackgroundTaskService.scheduleRestrictionReminders()
         └─ Parse rawApiData
         └─ Calculate exact notification times (9pm, 7am, etc.)
         └─ Create ParkingRestriction[] with restrictionStartTime (Date object)
         └─ Call: LocalNotificationService.scheduleNotificationsForParking(restrictions)
              └─ For each restriction:
                 └─ Create TimestampTrigger with unix milliseconds timestamp
                 └─ Call: notifee.createTriggerNotification()
                 └─ Native OS handles scheduling (survives app kill)
```

---

## Critical Data Structures

### ParkingRule (What the API returns, after parsing)
```typescript
{
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'tow_zone',
  message: string,           // User-facing description
  severity: 'critical' | 'warning' | 'info',
  schedule?: string,         // e.g., "9am-3pm"
  zoneName?: string,         // For permit zones
  nextDate?: string,         // e.g., "2025-02-15" for street cleaning
  isActiveNow?: boolean
}
```

### ParkingRestriction (Passed to LocalNotificationService)
```typescript
{
  type: 'street_cleaning' | 'winter_ban' | 'snow_ban' | 'permit_zone',
  restrictionStartTime: Date,  // ACTUAL notification time (9pm, 7am, etc.)
  address: string,
  details?: string,            // Notification body text
  latitude?: number,
  longitude?: number
}
```

### API Response Raw Data (rawApiData)
```typescript
{
  streetCleaning?: {
    hasRestriction: boolean,
    timing: 'NOW' | 'TODAY' | 'UPCOMING',
    schedule: string,        // "9am-3pm"
    nextDate: string,        // "2025-02-15"
    ward: string,
    section: string
  },
  winterOvernightBan?: {
    active: boolean,
    message: string,
    severity: string,
    startTime: string,       // "3am"
    endTime: string          // "7am"
  },
  twoInchSnowBan?: {
    active: boolean,
    message: string,
    severity: string
  },
  permitZone?: {
    inPermitZone: boolean,
    zoneName: string,
    permitRequired: boolean,
    restrictionSchedule: string  // "Mon-Fri 8am-6pm"
  }
}
```

---

## API Endpoint Details

### Request
```
GET /api/mobile/check-parking?lat=41.8781&lng=-87.6298&accuracy=8.5&confidence=high

Query Parameters:
- lat: float (required)
- lng: float (required)
- accuracy: float (optional, GPS accuracy in meters)
- confidence: string (optional, 'high'|'medium'|'low'|'very_low')
```

### Response
```json
{
  "success": true,
  "location": {
    "latitude": 41.8781,
    "longitude": -87.6298,
    "address": "123 Main St, Chicago, IL"
  },
  "restrictions": {
    "found": true,
    "count": 1,
    "highest_severity": "warning",
    "summary": {
      "title": "Street Cleaning Tomorrow",
      "message": "..."
    },
    "details": [
      {
        "type": "street_cleaning",
        "message": "...",
        "severity": "warning",
        "schedule": "9am-3pm",
        "nextDate": "2025-02-15"
      }
    ]
  },
  "raw_data": {
    "street_cleaning": { /* full data */ },
    "winter_overnight_ban": null,
    "two_inch_snow_ban": null
  }
}
```

---

## Integration Points for New Restriction Types

### 1. API Endpoint (`check-parking-location-enhanced.ts:31-54`)
Add new check function and format it:
```typescript
const [streetCleaningMatch, winterOvernightBanStatus, twoInchSnowBanStatus, 
        meteredParkingStatus, address] = await Promise.all([
  matchStreetCleaningSchedule(latitude, longitude),
  checkWinterOvernightBan(latitude, longitude),
  checkLocationTwoInchSnowBan(latitude, longitude),
  checkMeteredParking(latitude, longitude),  // NEW
  getFormattedAddress(latitude, longitude),
]);

const meteredParkingRestriction = formatMeteredParkingRestriction(meteredParkingStatus);
if (meteredParkingRestriction) {
  restrictions.push(meteredParkingRestriction);
}
```

### 2. LocationService.checkParkingLocation() (`LocationService.ts:865-929`)
Add parsing for new type:
```typescript
if (data?.meteredParking?.hasRestriction) {
  rules.push({
    type: 'metered_parking',
    message: data.meteredParking.message,
    severity: data.meteredParking.severity || 'warning',
    schedule: data.meteredParking.hours,
    nextDate: data.meteredParking.expiryTime,
  });
}
```

### 3. BackgroundTaskService.scheduleRestrictionReminders() (`BackgroundTaskService.ts:1530-1709`)
Add reminder scheduling:
```typescript
if (result.meteredParking?.hasRestriction && result.meteredParking?.expiryTime) {
  const expiryTime = new Date(result.meteredParking.expiryTime);
  const notificationTime = new Date(expiryTime.getTime() - 60 * 60 * 1000);  // 1hr before
  
  if (notificationTime.getTime() > Date.now()) {
    restrictions.push({
      type: 'metered_parking',
      restrictionStartTime: notificationTime,
      address: result.address || '',
      details: `Metered parking expires at ${expiryTime.toLocaleTimeString()}. Move your car.`,
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }
}
```

### 4. LocalNotificationService.scheduleRestrictionNotification() (`LocalNotificationService.ts:156-267`)
Add case in switch:
```typescript
case 'metered_parking':
  hoursBefore = 0;
  notificationId = `metered-parking-${Date.now()}`;
  channelId = 'parking-alerts';
  title = '🅿️ Metered Parking — Time to Move';
  body = `${address}\n${details || 'Your metered parking time is expiring.'}`;
  break;
```

### 5. NOTIFICATION_PREFIX (`LocalNotificationService.ts:28-32`)
```typescript
const NOTIFICATION_PREFIX = {
  STREET_CLEANING: 'street-cleaning-',
  WINTER_BAN: 'winter-ban-',
  SNOW_BAN: 'snow-ban-',
  PERMIT_ZONE: 'permit-zone-',
  METERED_PARKING: 'metered-parking-',  // ADD THIS
};
```

### 6. ReminderPreferences interface (`LocalNotificationService.ts:45-49`)
```typescript
export interface ReminderPreferences {
  streetCleaningHoursBefore: number;
  winterBanHoursBefore: number;
  permitZoneHoursBefore: number;
  meteredParkingHoursBefore: number;  // ADD THIS
  enabled: boolean;
}
```

### 7. cancelAllScheduledNotifications() (`LocalNotificationService.ts:344-351`)
```typescript
const parkingNotificationIds = ids.filter(
  (id) =>
    id.startsWith(NOTIFICATION_PREFIX.STREET_CLEANING) ||
    id.startsWith(NOTIFICATION_PREFIX.WINTER_BAN) ||
    id.startsWith(NOTIFICATION_PREFIX.SNOW_BAN) ||
    id.startsWith(NOTIFICATION_PREFIX.PERMIT_ZONE) ||
    id.startsWith(NOTIFICATION_PREFIX.METERED_PARKING) ||  // ADD THIS
    id.startsWith('custom-reminder-')
);
```

### 8. LocationService.saveParkedLocationToServer() (`LocationService.ts:948-962`)
```typescript
const payload: any = {
  latitude: coords.latitude,
  longitude: coords.longitude,
  address,
  fcm_token: fcmToken,
  // ... existing fields ...
  on_metered_parking: !!(parkingData?.meteredParking?.hasRestriction),
  metered_parking_expiry: parkingData?.meteredParking?.expiryTime || null,
};
```

---

## Key Principles

1. **Notification Times Are Pre-Computed**
   - BackgroundTaskService calculates 9pm, 7am, etc.
   - Passes as `restrictionStartTime` Date object to LocalNotificationService
   - LocalNotificationService uses directly as Unix timestamp
   - NO additional offset math in LocalNotificationService

2. **rawApiData Is Sacred**
   - Must be preserved through the entire chain
   - Contains timing information needed for reminder scheduling
   - If missing, reminder scheduling silently fails

3. **Cancellation Cleanup**
   - When user leaves parking (car reconnects), ALL notifications must be cancelled
   - Uses NOTIFICATION_PREFIX filters to avoid touching other notifications
   - Must stay in sync with new restriction types

4. **Two-Phase GPS**
   - Phase 1: Fast fix (1-3s) for immediate notification
   - Phase 2: Burst sampling in background (5 samples over 6s max)
   - If drift >25m, silently re-runs check and updates notification
   - User sees Phase 1 notification immediately, gets update if Phase 2 corrects

5. **Rate Limiting**
   - Real parking events: Always processed immediately
   - Periodic checks: Must wait 5 minutes between checks
   - API caching: 30 second local cache to prevent duplicate calls

---

## Testing Checklist

- [ ] API returns correct restriction object with all fields
- [ ] LocationService parses and creates ParkingRule with correct type
- [ ] BackgroundTaskService.scheduleRestrictionReminders() creates ParkingRestriction with correct time
- [ ] LocalNotificationService accepts new type in switch statement
- [ ] Notification fires at correct time on Android
- [ ] Notification fires at correct time on iOS
- [ ] Notification title and body are correct
- [ ] Notification can be cancelled when user leaves parking
- [ ] Server receives correct fields in saveParkedLocationToServer payload
- [ ] User preference for reminder offset can be updated
