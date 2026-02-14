# Parking Check API Architecture - Complete Analysis

## Overview
The parking check system works as follows:
1. **Mobile app** detects parking event (BT disconnect on Android, CoreMotion on iOS)
2. **BackgroundTaskService** triggers `triggerParkingCheck()` 
3. API call to `/api/mobile/check-parking` (query params: lat, lng, accuracy, confidence)
4. Server returns parking restrictions with timing data
5. **LocalNotificationService** schedules timed reminders based on restriction times
6. Server also saves location to `user_parked_vehicles` for server-side push reminders

---

## 1. MOBILE: triggerParkingCheck() Function

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Lines**: 1122-1347 (full implementation of triggerParkingCheck)

### Key Signature
```typescript
private async triggerParkingCheck(
  presetCoords?: { latitude: number; longitude: number; accuracy?: number },
  isRealParkingEvent: boolean = true,
  nativeTimestamp?: number,
  persistParkingEvent: boolean = true
): Promise<void>
```

### Call Flow (Lines 1228-1240)
```typescript
// Line 1228: API call through LocationService
const result = await LocationService.checkParkingLocation(coords);

// Lines 1238-1240: Save result
await LocationService.saveParkingCheckResult(result);
AppEvents.emit('parking-check-updated');

// Lines 1245-1256: Save to history
if (persistParkingEvent) {
  await ParkingHistoryService.addToHistory(coords, result.rules, result.address, nativeTimestamp);
  AppEvents.emit('parking-history-updated');
}
```

### What It Does
- Gets GPS location (fast single fix + background burst refinement)
- Calls API to check restrictions
- Saves result locally and to server
- **Lines 1315-1321**: Schedules restriction reminders via LocalNotificationService
- Sends immediate parking notification to user

---

## 2. MOBILE: LocationService.checkParkingLocation()

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`

**Lines**: 808-929

### Signature
```typescript
async checkParkingLocation(coords: Coordinates): Promise<ParkingCheckResult>
```

### API Call (Lines 825-840)
```typescript
const endpoint = `/api/mobile/check-parking?lat=${coords.latitude}&lng=${coords.longitude}${accuracyParam}${confidenceParam}`;

const response = await RateLimiter.rateLimitedRequest(
  endpoint,
  async () => {
    return ApiClient.get<any>(endpoint, {
      retries: 3,
      timeout: 20000,
      showErrorAlert: false,
    });
  },
  { cacheDurationMs: 30000 } // Cache 30 seconds
);
```

### Query Parameters
- `lat`: latitude
- `lng`: longitude  
- `accuracy` (optional): GPS accuracy in meters
- `confidence` (optional): confidence level from burst sampling

### Response Processing (Lines 865-929)
Parses API response and builds `ParkingRule[]`:

```typescript
export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'tow_zone';
  message: string;
  severity: 'critical' | 'warning' | 'info';
  schedule?: string;
  zoneName?: string;
  nextDate?: string;
  isActiveNow?: boolean;
}
```

**Returned Structure**:
```typescript
export interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[];
  timestamp: number;
  rawApiData?: any;  // Full API response for reminder scheduling
}
```

---

## 3. BACKEND: API Endpoint

**File**: `/home/randy-vollrath/ticketless-chicago/pages/api/check-parking-location-enhanced.ts`

**Lines**: 1-92

### Request/Response
```typescript
// INPUT: POST request with JSON body
const { latitude, longitude } = req.body;

// OUTPUT: JSON response
{
  success: true,
  location: {
    latitude,
    longitude,
    address: string
  },
  restrictions: {
    found: boolean,
    count: number,
    highest_severity: string,
    summary: {
      title: string,
      message: string
    },
    details: FormattedRestriction[]  // Array of restriction objects
  },
  raw_data: {
    street_cleaning: any,
    winter_overnight_ban: any,
    two_inch_snow_ban: any
  }
}
```

### Restriction Checks (Lines 31-54)
The API checks **3 types** in parallel:

1. **Street Cleaning** (Lines 31-43)
   ```typescript
   const streetCleaningMatch = matchStreetCleaningSchedule(latitude, longitude);
   ```
   - Uses `get_street_cleaning_at_location` Supabase RPC
   - Returns schedule, street name, next date, etc.

2. **Winter Overnight Ban** (Lines 46-48)
   ```typescript
   const winterOvernightBanStatus = checkWinterOvernightBan(latitude, longitude);
   ```
   - Returns active status, hours (3am-7am), severity

3. **Two-Inch Snow Ban** (Lines 51-53)
   ```typescript
   const twoInchSnowBanStatus = checkLocationTwoInchSnowBan(latitude, longitude);
   ```
   - Checks if location is on a snow route AND 2+ inches have fallen

4. **Reverse Geocoding** (Lines 31-35)
   ```typescript
   const address = getFormattedAddress(latitude, longitude);
   ```

### Response Fields
Each restriction object has:
- `type`: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban'
- `message`: Human-readable description
- `severity`: 'critical' | 'warning' | 'info'
- `schedule` (optional): When the restriction applies (e.g., "9am-3pm")
- `nextDate` (optional): Date when restriction begins (e.g., "2025-02-15")
- `zoneName` (optional): For permit zones
- `restrictionSchedule` (optional): Mon-Fri 8am-6pm, etc.

---

## 4. MOBILE: scheduleRestrictionReminders()

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Lines**: 1530-1709

### Called From
**Line 1317** in `triggerParkingCheck()`:
```typescript
await this.scheduleRestrictionReminders(rawData, coords);
```

### Signature
```typescript
private async scheduleRestrictionReminders(
  result: any,  // rawApiData from API response
  coords: { latitude: number; longitude: number }
): Promise<void>
```

### What It Does
Reads the raw API data and creates `ParkingRestriction[]` objects with **specific notification times**:

1. **Street Cleaning** (Lines 1541-1587)
   - Two notifications:
     - **9pm night before**: "Move your car tonight"
     - **7am morning of**: "MOVE YOUR CAR NOW"
   - Uses `result.streetCleaning.nextDate` to calculate times

2. **Winter Ban** (Lines 1591-1617)
   - **9pm today** (or tomorrow if past 9pm)
   - Message: "Ban 3am-7am. Move before 3am or risk towing"

3. **Permit Zone** (Lines 1620-1657)
   - **7am next weekday** (skips weekends)
   - Message: "Enforcement starts at 8am"
   - Only if permit is required

4. **Enforcement Risk Follow-up** (Lines 1663-1703)
   - If HIGH urgency: mid-way through peak window
   - Message: "You're still in peak enforcement window"

### Passes to LocalNotificationService
```typescript
// Line 1706
await LocalNotificationService.scheduleNotificationsForParking(restrictions);

// restrictions is ParkingRestriction[]
export interface ParkingRestriction {
  type: 'street_cleaning' | 'winter_ban' | 'snow_ban' | 'permit_zone';
  restrictionStartTime: Date;      // NOTIFICATION TIME (pre-computed)
  address: string;
  details?: string;
  latitude?: number;
  longitude?: number;
}
```

---

## 5. MOBILE: LocalNotificationService.scheduleNotificationsForParking()

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocalNotificationService.ts`

**Lines**: 126-151 (main entry) and 156-267 (schedule single notification)

### Signature
```typescript
async scheduleNotificationsForParking(restrictions: ParkingRestriction[]): Promise<void>
```

### How Notifications Are Triggered
Uses **notifee's `createTriggerNotification`** with **TimestampTrigger**:

```typescript
// Lines 229-257
const trigger: TimestampTrigger = {
  type: TriggerType.TIMESTAMP,
  timestamp: notificationTime.getTime(),  // Unix milliseconds
};

await notifee.createTriggerNotification(
  {
    id: notificationId,        // e.g., "street-cleaning-1707123456"
    title,
    body,
    data: {
      type: `${type}_reminder`,
      lat: latitude?.toString() || '',
      lng: longitude?.toString() || '',
    },
    android: {
      channelId: 'parking-alerts' | 'reminders',
      importance: AndroidImportance.HIGH,  // For urgent alerts
      pressAction: { id: 'default' },
      smallIcon: 'ic_notification',
    },
    ios: {
      sound: 'default' | undefined,
    },
  },
  trigger
);
```

### Notification Types & Titles (Lines 169-214)

| Type | Condition | Title | Channel |
|------|-----------|-------|---------|
| street_cleaning | Peak window | ⚠️ Still in Peak Enforcement Window | parking-alerts |
| street_cleaning | Morning (7am) | 🧹 Street Cleaning Today — Move Now! | parking-alerts |
| street_cleaning | Night before | 🧹 Street Cleaning Tomorrow | reminders |
| winter_ban | 9pm | ❄️ Winter Parking Ban Tonight | parking-alerts |
| permit_zone | 7am | 🅿️ Permit Zone — Move by 8am | reminders |
| snow_ban | Immediate | 🌨️ Snow Ban Alert! | parking-alerts |

### Stored Notifications
Tracked in AsyncStorage at `scheduled_parking_notifications`:
```typescript
interface ScheduledNotification {
  id: string;
  type: string;
  scheduledFor: string;  // ISO timestamp
  address: string;
}
```

---

## 6. SERVER: Save Parked Location for Server-Side Reminders

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`

**Lines**: 942-983

### Signature
```typescript
async saveParkedLocationToServer(
  coords: Coordinates,
  parkingData: any,           // rawApiData from API
  address: string,
  fcmToken: string
): Promise<{ success: boolean; id?: string }>
```

### Called From
**Lines 1265-1280** in `triggerParkingCheck()`:
```typescript
const fcmToken = await PushNotificationService.getToken();
if (fcmToken && AuthService.isAuthenticated()) {
  const rawData = result.rawApiData || await this.getRawParkingData(result);
  await LocationService.saveParkedLocationToServer(coords, rawData, result.address, fcmToken);
}
```

### Payload Sent to `/api/mobile/save-parked-location`
```typescript
{
  latitude: number,
  longitude: number,
  address: string,
  fcm_token: string,
  
  // For winter ban reminders
  on_winter_ban_street: boolean,
  winter_ban_street_name: string | null,
  
  // For snow ban reminders
  on_snow_route: boolean,
  snow_route_name: string | null,
  
  // For street cleaning reminders
  street_cleaning_date: string | null,      // "2025-02-15"
  street_cleaning_ward: string | null,
  street_cleaning_section: string | null,
  
  // For permit zone reminders
  permit_zone: string | null,
  permit_restriction_schedule: string | null
}
```

### Purpose
Populates `user_parked_vehicles` table on the server, enabling:
- Server-side cron job `mobile-parking-reminders` 
- Server sends push notifications at scheduled times (9pm, 7am, etc.)
- Backup to local notifications in case app is closed

---

## Adding Metered Parking: Integration Points

To add metered parking as a new restriction type:

### 1. **API Response** 
Add to `/pages/api/check-parking-location-enhanced.ts`:
- New restriction check (e.g., `checkMeteredParking(latitude, longitude)`)
- Return object with timing: `{ hasRestriction, hours, rate, nextDate, ... }`

### 2. **LocationService.checkParkingLocation()** (Lines 808-929)
Add new rule type to the `rules.push()` logic:
```typescript
if (data?.meteredParking?.hasRestriction) {
  rules.push({
    type: 'metered_parking',
    message: data.meteredParking.message,
    severity: 'warning',
    schedule: data.meteredParking.hours,
    // Add custom fields as needed
  });
}
```

### 3. **BackgroundTaskService.scheduleRestrictionReminders()** (Lines 1530-1709)
Add new reminder logic:
```typescript
if (result.meteredParking?.hasRestriction && result.meteredParking?.nextDate) {
  // Calculate notification times (e.g., 1 hour before expiry)
  const expiryTime = new Date(result.meteredParking.nextDate);
  const notificationTime = new Date(expiryTime.getTime() - 60 * 60 * 1000);
  
  restrictions.push({
    type: 'metered_parking',
    restrictionStartTime: notificationTime,
    address: result.address || '',
    details: `Metered parking expires at ${expiryTime.toLocaleTimeString()}. Move your car to avoid a $XX ticket.`,
    latitude: coords.latitude,
    longitude: coords.longitude,
  });
}
```

### 4. **LocalNotificationService.scheduleRestrictionNotification()** (Lines 156-267)
Add case for metered parking:
```typescript
case 'metered_parking':
  hoursBefore = 0;  // Time is pre-computed
  notificationId = `metered-parking-${Date.now()}`;
  channelId = 'parking-alerts';
  title = '🅿️ Metered Parking — Time to Move';
  body = `${address}\n${details || 'Your metered parking time is expiring. Move your car to avoid a ticket.'}`;
  break;
```

### 5. **LocalNotificationService.ts** (Lines 28-32)
Add prefix:
```typescript
const NOTIFICATION_PREFIX = {
  STREET_CLEANING: 'street-cleaning-',
  WINTER_BAN: 'winter-ban-',
  SNOW_BAN: 'snow-ban-',
  PERMIT_ZONE: 'permit-zone-',
  METERED_PARKING: 'metered-parking-',  // ADD THIS
};
```

### 6. **LocalNotificationService.ts** (Lines 45-49)
Add to preferences:
```typescript
export interface ReminderPreferences {
  streetCleaningHoursBefore: number;
  winterBanHoursBefore: number;
  permitZoneHoursBefore: number;
  meteredParkingHoursBefore: number;  // ADD THIS
  enabled: boolean;
}
```

### 7. **LocalNotificationService.cancelAllScheduledNotifications()** (Lines 340-365)
Add filter for metered parking:
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

### 8. **LocationService.saveParkedLocationToServer()** (Lines 942-983)
Add metered parking payload:
```typescript
const payload: any = {
  // ... existing fields ...
  on_metered_parking: !!(parkingData?.meteredParking?.hasRestriction),
  metered_parking_expiry: parkingData?.meteredParking?.expiryTime || null,
  metered_parking_hourly_rate: parkingData?.meteredParking?.hourlyRate || null,
};
```

---

## Key Timing Details

### Notification Time Calculation
- **Pre-computed by BackgroundTaskService**: Exact times sent to LocalNotificationService
- **Not offsets**: Each `ParkingRestriction.restrictionStartTime` is the **actual notification time**, not an offset
- **No additional hoursBefore math**: `hoursBefore` is always 0 for pre-computed times

### Rate Limiting
- Parking check cached for **30 seconds** (Lines 838-839 in LocationService)
- Non-real events (periodic checks) must wait **5 minutes** between checks (Line 43: `MIN_PARKING_CHECK_INTERVAL_MS`)

### GPS Strategy (Two-Phase)
1. **Phase 1**: Fast single fix (1-3s) for immediate notification
2. **Phase 2**: Burst sampling in background, re-check if position drifts >25m

---

## Testing Checklist for New Restriction Type

- [ ] API returns correct restriction data structure
- [ ] LocationService parses and creates ParkingRule with correct type
- [ ] BackgroundTaskService schedules notifications with correct times
- [ ] LocalNotificationService accepts new type in switch statement
- [ ] Notification fires at correct time on both Android and iOS
- [ ] Notification can be cancelled when user leaves parking spot
- [ ] Server receives correct fields in saveParkedLocationToServer payload
- [ ] Notification preference can be updated for the new restriction type

