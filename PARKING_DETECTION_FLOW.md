# Parking Detection and Notification System Flow

## Overview
This document traces the complete flow from parking detection to notification for street cleaning, snow removal, and other parking restrictions in the Ticketless Chicago mobile app.

---

## 1. PARKING DETECTION TRIGGER

### Entry Points (Android)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

1. **Via ParkingDetectionStateMachine** (lines 175-203)
   - State transition callback: `PARKING_PENDING->PARKED` (line 178)
   - Triggered when BT disconnect debounce expires (10 seconds)
   - Calls: `handleCarDisconnection()` → `triggerParkingCheck()`

2. **Via Bluetooth Disconnect** (lines 178-185)
   - State machine emits `PARKING_PENDING->PARKED` event
   - Executes callback at line 185: `await this.handleCarDisconnection()`

### Entry Point (iOS)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundLocationService.ts`
- CoreMotion detects automotive → stationary (5-second debounce)
- Triggers `onParkingDetected` event with GPS coordinates captured at parking moment
- Feeds into `handleCarDisconnection()` via BackgroundTaskService

---

## 2. HANDLE CAR DISCONNECTION

**Function**: `handleCarDisconnection()` at line 1058 in BackgroundTaskService.ts

```typescript
private async handleCarDisconnection(
  parkingCoords?: { latitude: number; longitude: number; accuracy?: number },
  nativeTimestamp?: number
): Promise<void>
```

**Key Steps**:
1. **Debounce** (line 1063-1072): Skip if called in last 30 seconds (prevents duplicate triggers)
2. **Finalize pending departures** (line 1084-1087): Complete any previous departure tracking
3. **Clear GPS cache** (line 1089-1094): Don't use stale driving positions
4. **Trigger parking check** (line 1102): `await this.triggerParkingCheck(parkingCoords, true, nativeTimestamp)`
5. **UI callback** (line 1105-1111): Notify HomeScreen component

---

## 3. TRIGGER PARKING CHECK (THE CORE FLOW)

**Function**: `triggerParkingCheck()` at line 1122 in BackgroundTaskService.ts

```typescript
private async triggerParkingCheck(
  presetCoords?: { latitude: number; longitude: number; accuracy?: number },
  isRealParkingEvent: boolean = true,
  nativeTimestamp?: number,
  persistParkingEvent: boolean = true
): Promise<void>
```

### Step 3.1: Get GPS Coordinates
Lines 1122-1221: Two-phase GPS acquisition
- **Phase 1**: Fast single GPS fix (1-3 seconds) - used for immediate notification
- **Phase 2**: Burst refinement in background (5 GPS samples over 6s) - improves accuracy for history

### Step 3.2: Call Parking API
Lines 1223-1236: `LocationService.checkParkingLocation(coords)`

**API Endpoint**: Backend `/api/check-parking`
**Returns**: 
```typescript
{
  address: string;
  rules: ParkingRule[]; // Active restrictions
  timestamp: number;
  rawApiData: {
    streetCleaning: { hasRestriction, nextDate, schedule, ... },
    winterOvernightBan: { active, streetName, ... },
    winterBan: { found, ... },
    permitZone: { inPermitZone, permitRequired, zoneName, restrictionSchedule },
    twoInchSnowBan: boolean,
    enforcementRisk: { urgency, in_peak_window, peak_window, ... }
  }
}
```

### Step 3.3: Save Results
- **Save to UI state** (line 1239): `LocationService.saveParkingCheckResult(result)`
- **Save to history** (line 1245-1256): `ParkingHistoryService.addToHistory()`
- **Save to server** (line 1264-1280): `LocationService.saveParkedLocationToServer()` - enables server-side push notifications

### Step 3.4: Filter User's Own Permit Zone
Lines 1299-1300: Remove permit zone restrictions if user has a permit there

### Step 3.5: Send Immediate Notification
Lines 1302-1308:
- **If restrictions active**: `sendParkingNotification()` (line 1305)
- **If all clear**: `sendSafeNotification()` (line 1307)
- **Always sent**: User knows the scan ran

### Step 3.6: Schedule Advance Reminders
Lines 1315-1321: `scheduleRestrictionReminders(rawData, coords)`

---

## 4. SCHEDULE RESTRICTION REMINDERS (KEY FOR METERED PARKING)

**Function**: `scheduleRestrictionReminders()` at line 1530 in BackgroundTaskService.ts

This function parses the API response and schedules local notifications BEFORE restrictions start.

### Street Cleaning (lines 1540-1588)
When: `result.streetCleaning?.hasRestriction && result.streetCleaning?.nextDate`
- **9pm night before**: "Move your car tonight to avoid a $60 ticket"
- **7am morning of**: "Street cleaning starts at 9am — MOVE YOUR CAR NOW"

### Winter Ban (lines 1590-1617)
When: `result.winterOvernightBan?.active || result.winterBan?.found`
- **9pm tonight** (or tomorrow if past 9pm): "Winter overnight parking ban 3am–7am. Move before 3am or risk towing"

### Permit Zone (lines 1619-1657)
When: `result.permitZone?.inPermitZone && !result.permitZone?.permitRequired`
- **7am next weekday**: "Permit zone — enforcement: Mon–Fri 8am–6pm. Move by 8am or risk a $60 ticket"

### Snow Ban (line 1659-1660)
- Handled by **server-side push notifications** (not local scheduling)
- Server cron sends push to users with `on_snow_route=true` in `user_parked_vehicles` table

### Enforcement Risk Follow-up (lines 1662-1703)
When: High urgency enforcement detected
- Schedules follow-up notification **halfway through peak enforcement window**
- Max cap: 2 hours from now (not 4+ hours out)

**Returns**: Array of `ParkingRestriction` objects sent to `LocalNotificationService.scheduleNotificationsForParking()`

---

## 5. LOCAL NOTIFICATION SERVICE

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocalNotificationService.ts`

### Function: `scheduleNotificationsForParking()`
Line 126: Receives array of `ParkingRestriction` objects

**For each restriction**:
1. Calls `scheduleRestrictionNotification()` (line 156)
2. Uses **notifee** library: `notifee.createTriggerNotification()`
3. **TriggerType.TIMESTAMP**: Notification fires at exact time (not polling)

### Notification Details by Type

#### Street Cleaning
- **Notification ID prefix**: `street-cleaning-{timestamp}`
- **Channels**:
  - "peak enforcement window" → `parking-alerts` (HIGH importance, sound)
  - "MOVE YOUR CAR NOW" → `parking-alerts` (HIGH importance, sound)
  - Night before → `reminders` (DEFAULT importance)
- **Examples** (lines 177-188):
  ```
  Title: "🧹 Street Cleaning Tomorrow"
  Body: "123 Main St\nMove your car tonight to avoid a $60 ticket."
  
  Title: "🧹 Street Cleaning Today — Move Now!"
  Body: "123 Main St\nStreet cleaning starts at 9am. Move your car NOW — $60 ticket."
  ```

#### Winter Ban
- **Notification ID prefix**: `winter-ban-{timestamp}`
- **Channel**: `parking-alerts` (HIGH importance, sound)
- **Title**: "❄️ Winter Parking Ban Tonight"
- **Body**: "Address\nWinter overnight parking ban 3am–7am. Move before 3am or risk towing ($150+)."

#### Snow Ban (Weather-dependent)
- **Notification ID prefix**: `snow-ban-{timestamp}`
- **Channel**: `parking-alerts` (HIGH importance)
- **Title**: "🌨️ Snow Ban Alert!"
- **Body**: "Address\nSnow ban may be active. Check conditions and move if needed."

#### Permit Zone
- **Notification ID prefix**: `permit-zone-{timestamp}`
- **Channel**: `reminders` (DEFAULT importance)
- **Title**: "🅿️ Permit Zone — Move by 8am"
- **Body**: "Zone Name\nEnforcement: Mon–Fri 8am–6pm. Move your car or risk a $60 ticket."

### Cancel Notifications
**Function**: `cancelAllScheduledNotifications()` at line 340
- Called when user drives away (BT reconnect → `PARKED->DRIVING` transition)
- Removes all pending reminders
- Filters by notification ID prefixes (street-cleaning-, winter-ban-, snow-ban-, permit-zone-, custom-reminder-)

---

## 6. SEND IMMEDIATE PARKING NOTIFICATION

**Function**: `sendParkingNotification()` at line 1854 in BackgroundTaskService.ts

Uses: `notifee.displayNotification()` (library: `@notifee/react-native`)

### Title Logic (lines 1892-1901)
- **Critical restriction**: "⚠️ Parked — Restriction Active!"
- **High enforcement risk**: "⚠️ Parked — Peak Enforcement Window"
- **Default**: "⚠️ Parked — Heads Up"

### Body Construction (lines 1855-1890)
1. Address + GPS accuracy
2. Active restriction messages (from `result.rules[]`)
3. Enforcement risk context (if available)
4. Upcoming restrictions NOT already active (e.g., street cleaning tomorrow)

### Android Config (lines 1906-1910)
- Channel: `parking-monitoring`
- Importance: HIGH
- Sound: Default
- Icon: `ic_notification`

### iOS Config (lines 1912-1916)
- Sound: Default
- Critical flag: `hasCritical` (triggers override of silent/DND modes)
- Critical volume: 1.0

---

## 7. SEND SAFE NOTIFICATION (ALL CLEAR)

**Function**: `sendSafeNotification()` at line 1924 in BackgroundTaskService.ts

### Title Logic (lines 1948-1952)
- **High enforcement risk (even if clear)**: "⚠️ Parked — Peak Enforcement Area"
- **Default**: "✅ Parked — All Clear"

### Body Construction (lines 1924-1946)
1. Address + GPS accuracy
2. "No active restrictions right now"
3. Enforcement risk context
4. **Upcoming restrictions** (e.g., "Street cleaning tomorrow at 9am")
5. "We'll remind you before these start"

---

## 8. CAMERA PROXIMITY DETECTION PATTERN (REUSABLE FOR METERED PARKING)

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/CameraAlertService.ts`

### Key Constants (lines 143-184)
- **BASE_ALERT_RADIUS_METERS**: 150m (when speed unknown)
- **MAX_ALERT_RADIUS_METERS**: 250m (prevents false alerts from parallel streets)
- **COOLDOWN_RADIUS_METERS**: 400m (distance to move before re-alerting)
- **BBOX_DEGREES**: 0.0025 (bounding box ~280m at Chicago latitude)
- **TARGET_WARNING_SECONDS**: 10 (adaptive radius = speed × 10s)

### Proximity Logic (lines 731-770)
```typescript
findNearbyCameras(lat, lng, heading, alertRadius)
```

**Steps**:
1. **Bounding box pre-filter** (lines 739-750): O(1) fast filter
   - `BBOX_DEGREES` around current position
   - Typically narrows 510 cameras to 2-5 candidates
   
2. **Exact distance via Haversine** (line 753): `distanceMeters(lat, lng, cam.lat, cam.lng)`
   - Only computed for bbox candidates
   
3. **Within alert radius** (line 754): `distance <= alertRadius`
   
4. **Direction match** (line 757): User heading matches camera approaches
   
5. **Camera ahead filter** (line 761): Camera must be in forward cone (±30°)
   - Uses bearing calculation (line 858): `bearingTo(userLat, userLng, camLat, camLng)`
   - Prevents false alerts from parallel streets one block over

**Result**: `Array<{ index, camera, distance }>`

### Cooldown Tracking
- **Map**: `alertedCameras: Map<cameraIndex, timestamp>`
- **Clear old entries** (lines 776-785): When user moves >400m from camera
- **Prevents repeated alerts** until user moves away

---

## 9. RESTRICTIONS MAP SCREEN

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/MapScreen.tsx`

### Data Flow
1. **Load last check result** from AsyncStorage (lines 147-150)
2. **Get current location** (line 84): `getCurrentLocationSilent()`
3. **Display restrictions** from `lastLocation.rules[]`

### Notification Deep Linking (lines 24-145)
- Notification with `lat` + `lng` params navigates to MapScreen
- Screen checks parking at those coordinates
- Useful for: "You parked at X — tap to see rules"

---

## 10. DATA STRUCTURES

### ParkingRestriction (LocalNotificationService.ts, line 52)
```typescript
interface ParkingRestriction {
  type: 'street_cleaning' | 'winter_ban' | 'snow_ban' | 'permit_zone';
  restrictionStartTime: Date; // When notification fires
  address: string;
  details?: string; // Custom message
  latitude?: number;
  longitude?: number;
}
```

### ParkingRule (LocationService.ts, line 14)
```typescript
interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'tow_zone';
  message: string; // User-facing message
  severity: 'critical' | 'warning' | 'info';
  schedule?: string;
  zoneName?: string;
  nextDate?: string;
  isActiveNow?: boolean;
}
```

### ParkingCheckResult (LocationService.ts, line 68)
```typescript
interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[]; // Active restrictions
  timestamp: number;
  rawApiData?: {
    streetCleaning: { hasRestriction, nextDate, schedule };
    winterOvernightBan: { active, streetName };
    winterBan: { found };
    permitZone: { inPermitZone, permitRequired, zoneName, restrictionSchedule };
    twoInchSnowBan: boolean;
    enforcementRisk: { urgency, in_peak_window, peak_window, total_block_tickets, top_violation };
  };
}
```

---

## 11. METERED PARKING INTEGRATION POINTS

### Data File
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/data/chicago-metered-parking.ts`

```typescript
interface MeteredParkingLocation {
  meter_id: number;
  address: string;
  latitude: number;
  longitude: number;
  spaces: number;
  status: string;
  meter_type: string;
}

export function getMeteredParkingLocations(): MeteredParkingLocation[]
export async function fetchMeteredParkingLocations(): Promise<void>
```

### Integration Pattern
1. **Fetch on init** (line 134 in BackgroundTaskService): Fire-and-forget async load
2. **Cache in AsyncStorage** (7-day TTL)
3. **Use in parking check flow**:
   - Add metered parking violations to `ParkingRule[]` if user parked at meter with active rates
   - Include in `rawApiData` for scheduling reminders
4. **Add to map display**: Show metered parking zones (similar to cameras)
5. **Proximity alerts** (optional): TTS alert near expensive metered zones (reuse CameraAlertService pattern)

---

## 12. SUMMARY OF KEY FILES

| File | Purpose | Key Functions |
|------|---------|----------------|
| BackgroundTaskService.ts | Orchestrates parking detection | `handleCarDisconnection()`, `triggerParkingCheck()`, `scheduleRestrictionReminders()`, `sendParkingNotification()` |
| ParkingDetectionStateMachine.ts | Single source of truth for driving/parking state | `btDisconnected()`, `parkingConfirmed()`, `onTransition()` |
| LocationService.ts | GPS + parking API calls | `checkParkingLocation()`, `getCurrentLocation()`, `getLocationWithRetry()` |
| LocalNotificationService.ts | Schedule timed reminders | `scheduleNotificationsForParking()`, `cancelAllScheduledNotifications()` |
| PushNotificationService.ts | Firebase push + foreground display | `displayLocalNotification()`, `navigateFromNotification()` |
| CameraAlertService.ts | Speed/red-light camera proximity TTS | `findNearbyCameras()`, `isCameraAhead()`, `clearDistantCooldowns()` |
| chicago-metered-parking.ts | Metered parking location data | `getMeteredParkingLocations()`, `fetchMeteredParkingLocations()` |

