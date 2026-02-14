# Parking Detection & Notification System - Complete Analysis

## Executive Summary

This codebase has a sophisticated, production-grade parking detection and notification system that:

1. **Detects parking** via Bluetooth (Android) or CoreMotion (iOS) with 10-second debounce
2. **Gets GPS location** in 2 phases: fast single fix (1-3s) → background burst refinement (6s)
3. **Checks restrictions** against a backend API that returns active rules + raw timing data
4. **Sends immediate notification** ("Parking Alert" or "All Clear")
5. **Schedules advance reminders** locally using native notifications (9pm, 7am, etc.)
6. **Cancels reminders** automatically when user drives away

For **metered parking**, you need to integrate at 3 points in this flow (all documented in attached guides).

---

## Document Deliverables

### 1. PARKING_DETECTION_FLOW.md (388 lines)
**Complete technical reference** covering:
- Parking detection triggers (Android BT, iOS CoreMotion)
- `handleCarDisconnection()` → `triggerParkingCheck()` main flow
- GPS acquisition strategy (2-phase)
- Parking API integration
- Notification lifecycle
- Local reminder scheduling by restriction type
- Camera proximity pattern (reusable for metered parking)
- Data structures and types
- Integration points for metered parking

**Use this for**: Understanding the entire system, line-by-line flow, debugging

### 2. METERED_PARKING_INTEGRATION_GUIDE.md (187 lines)
**Implementation guide** for metered parking featuring:
- High-level flow summary
- Key files and line numbers for quick reference
- 3 specific integration points:
  1. API response (add metered violation to `ParkingRule[]`)
  2. Reminder scheduling (schedule at restriction start time)
  3. Notification config (display message + rate)
- Optional 4th: proximity alerts while driving
- Testing checklist
- Data structure modifications

**Use this for**: Actually implementing metered parking detection

---

## 1. THE EXACT FLOW FOR PARKING TRIGGERING & RESTRICTIONS CHECK

### Entry Point 1: Bluetooth Disconnect (Android, most common)
```
BluetoothMonitorService (native foreground service)
  ↓ ACL disconnect event
NativeEventEmitter fires "BtMonitorCarDisconnected"
  ↓
BackgroundTaskService subscribes (line 455-470)
  ↓
ParkingDetectionStateMachine.btDisconnected() (line 252)
  ↓ Starts 10-second debounce timer
After 10s if still disconnected:
  ↓
ParkingDetectionStateMachine.transition('PARKED', 'PARKING_CONFIRMED')
  ↓
Registered callback executes (line 178 in BackgroundTaskService):
  ↓
handleCarDisconnection() → triggerParkingCheck()
```

### Entry Point 2: CoreMotion Detection (iOS)
```
BackgroundLocationService detects: automotive → stationary (5s debounce)
  ↓
Captures GPS coordinates at exact parking moment
  ↓
Fires onParkingDetected event with coordinates
  ↓
BackgroundTaskService.handleCarDisconnection(parkingCoords)
  ↓
triggerParkingCheck(parkingCoords) [skips GPS acquisition]
```

### The Core Parking Check Flow (triggerParkingCheck)

```
1. GET GPS (2-phase):
   Phase 1: Fast single fix (1-3 sec) → used for immediate notification
   Phase 2: Burst refine (6 sec max) → run in background for accuracy
   
2. CALL API: POST /api/check-parking { lat, lng }
   Response includes:
   - address
   - rules[] (active restrictions)
   - rawApiData: {
       streetCleaning: { hasRestriction, nextDate, schedule },
       winterOvernightBan: { active, streetName },
       permitZone: { inPermitZone, permitRequired, zoneName },
       twoInchSnowBan,
       enforcementRisk: { urgency, peak_window, ... }
     }

3. SAVE RESULTS:
   - AsyncStorage (for HomeScreen hero card)
   - ParkingHistoryService (for History tab)
   - Server user_parked_vehicles (for server-side pushes)

4. SEND IMMEDIATE NOTIFICATION:
   If rules.length > 0:
     → sendParkingNotification() with restriction list
   Else:
     → sendSafeNotification() with "all clear"

5. SCHEDULE ADVANCE REMINDERS:
   Parse rawApiData and create ParkingRestriction[] objects:
   
   Street cleaning:
     - 9pm night before
     - 7am morning of
   
   Winter ban:
     - 9pm before 3am ban
   
   Permit zone:
     - 7am next weekday
   
   Pass to LocalNotificationService.scheduleNotificationsForParking()
```

---

## 2. HOW NOTIFICATIONS ARE SENT (LIBRARY & FLOW)

### Libraries Used
- **@notifee/react-native**: Scheduled + foreground notifications
- **@react-native-firebase/messaging**: FCM push token registration

### Notification Channels (Android)
```
parking-alerts (HIGH importance):
  - Sound: default
  - Used for: street cleaning ("MOVE NOW"), winter ban, snow ban

reminders (DEFAULT importance):
  - Sound: default
  - Used for: permit zone, regular street cleaning night-before

general (LOW importance):
  - Sound: none
  - Used for: other updates
```

### Immediate Notification (Sent at parking moment)
**Function**: `sendParkingNotification()` or `sendSafeNotification()`
**Method**: `notifee.displayNotification()` (fires immediately)
**Data**: address + active restrictions + enforcement risk context
**Example**: "⚠️ Parked — Restriction Active!\n123 Main St (±30m)\nStreet cleaning today 9am-3pm"

### Scheduled Reminders (Fire at specific times)
**Function**: `LocalNotificationService.scheduleNotificationsForParking()`
**Method**: `notifee.createTriggerNotification({ trigger: { type: TIMESTAMP, timestamp } })`
**Timing**:
- Street cleaning night-before: 9pm
- Street cleaning morning-of: 7am
- Winter ban: 9pm
- Permit zone: 7am
- Enforcement risk: halfway through peak window

### Notification Cancellation
**When**: User drives away (BT reconnects)
**Function**: `LocalNotificationService.cancelAllScheduledNotifications()`
**Method**: `notifee.cancelTriggerNotification(id)`
**Filter**: Only parking-related notifications (street-cleaning-, winter-ban-, permit-zone-, etc.)

---

## 3. HOW THE RESTRICTIONS MAP WORKS (WHAT DATA IT SHOWS)

### MapScreen Component
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/MapScreen.tsx`

**Data displayed**:
```typescript
interface ParkingCheckResult {
  address: string;              // "123 Main St, Chicago, IL 60601"
  rules: ParkingRule[];          // Active restrictions
  coords: Coordinates;           // lat, lng, accuracy
  timestamp: number;             // When check was performed
}

interface ParkingRule {
  type: string;                  // 'street_cleaning' | 'winter_ban' | ...
  message: string;               // "Street cleaning 9am-3pm"
  severity: 'critical' | 'warning' | 'info';
  schedule?: string;             // "Mon-Fri 8am-6pm"
  zoneName?: string;             // "Zone 2B"
  nextDate?: string;             // "2026-02-15"
}
```

**Display logic**:
1. Load last check from AsyncStorage (line 149)
2. Show address
3. For each rule in `rules[]`:
   - Display icon by type (🧹 street cleaning, ❄️ winter ban, 🅿️ permit zone)
   - Display message and schedule
   - Color by severity (red for critical, yellow for warning, green for info)
4. If no rules: "✅ All Clear — You're good to park here"

**Notification deep linking**:
- Push notification includes `lat` + `lng` params
- User taps notification → MapScreen navigates with coordinates
- Screen checks parking at those exact coordinates
- Useful for: "You parked at X — tap to see current rules"

**Streets shown**:
- **Active restrictions**: Individual streets from `rules[]` array
- **Cameras**: 510 Chicago speed/red-light cameras (overlay on map)
- **Metered zones**: (could add) Metered parking areas from chicago-metered-parking.ts

---

## 4. CAMERA PROXIMITY DETECTION PATTERN (REUSABLE FOR METERED PARKING)

### How It Works
**File**: CameraAlertService.ts
**Purpose**: Speak TTS alerts when driving near speed/red-light cameras

### Algorithm: Fast Bounding Box → Haversine → Direction Filter

```
For each GPS update (lat, lng, heading):

1. BOUNDING BOX PRE-FILTER (FAST, O(n) but quick comparisons)
   - Create 0.0025° box around user (~280m at Chicago latitude)
   - Iterate all 510 cameras, keep those inside box → typically 2-5 candidates
   
2. HAVERSINE DISTANCE (EXACT, O(1) per candidate)
   - For each bbox candidate: distance = haversine(userLat, userLng, camLat, camLng)
   - Keep those within alert radius: distance <= alertRadius
   
3. DIRECTION MATCH (FILTER)
   - User heading must match camera's monitored approaches
   - Camera monitors: ['NB', 'SB'] (north/south bound)
   - User heading: 350° (NNW) → matches NB within tolerance
   
4. CAMERA AHEAD FILTER (MOST IMPORTANT)
   - Calculate bearing from user to camera: bearing(userLat, userLng, camLat, camLng)
   - Check if bearing is within ±30° of user's heading
   - This filters out cameras on parallel streets one block away
   
5. ALERT IF ALL PASS
   - Speak TTS: "Speed camera ahead. Settle below 30 mph"
   - Track as "alerted" with cooldown (400m to re-alert)
```

### Key Constants
```typescript
BASE_ALERT_RADIUS_METERS = 150        // When speed unknown
MAX_ALERT_RADIUS_METERS = 250         // Prevents parallel street false alerts
TARGET_WARNING_SECONDS = 10           // Speed-adaptive: radius = speed × 10s
COOLDOWN_RADIUS_METERS = 400          // Distance to move before re-alert
BBOX_DEGREES = 0.0025                 // ~280m box
MAX_BEARING_OFF_HEADING_DEGREES = 30  // Camera must be ahead (±30° cone)
```

### Speed-Adaptive Alert Radius
```typescript
getAlertRadius(speedMps: number): number {
  if (speedMps <= 0) return BASE_ALERT_RADIUS_METERS;  // 150m
  const adaptive = speedMps * TARGET_WARNING_SECONDS;  // speed × 10s
  return Math.max(BASE_ALERT_RADIUS_METERS, 
         Math.min(MAX_ALERT_RADIUS_METERS, adaptive));  // clamped 150-250m
}
// At 30 mph (13.4 m/s): 13.4 × 10 = 134m → 150m (clamped to min)
// At 45 mph (20.1 m/s): 20.1 × 10 = 201m (in range)
// At 60 mph (26.8 m/s): 26.8 × 10 = 268m → 250m (clamped to max)
```

### FOR METERED PARKING: Could be adapted to:
```
1. Pre-alert approaching expensive metered zones ($2.50+/hr)
2. Bounding box filter to nearby payboxes
3. Bearing check to keep on correct street
4. TTS: "Metered parking ahead — $2.50/hour, 8am-6pm"
```

---

## 5. FILE PATHS & LINE NUMBERS FOR ALL KEY FUNCTIONS

### Parking Detection State Machine
```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/ParkingDetectionStateMachine.ts

Line 223: btConnected(source, metadata)
  → Transition from PARKING_PENDING/IDLE → DRIVING

Line 252: btDisconnected(source, metadata)
  → Transition from DRIVING → PARKING_PENDING, starts 10s debounce

Line 311: parkingConfirmed(metadata)
  → Transition from PARKING_PENDING → PARKED (fired by debounce expiry)

Line 419: onTransition(key, callback)
  → Register callbacks like "PARKING_PENDING->PARKED"
  → THIS IS HOW BackgroundTaskService hooks in
```

### Main Orchestration
```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts

Line 175: registerStateMachineCallbacks()
  → Registers "PARKING_PENDING->PARKED" callback (line 178)
  → Registers "PARKED->DRIVING" callback (line 190)

Line 1058: handleCarDisconnection(parkingCoords?, nativeTimestamp?)
  → Debounces (line 1063-1072)
  → Finalizes previous departures (line 1084)
  → Triggers parking check (line 1102)

Line 1122: triggerParkingCheck(presetCoords?, isRealParkingEvent?, nativeTimestamp?, persistParkingEvent?)
  → Gets GPS: fast fix (line 1161-1170) + burst refine (line 1220)
  → Calls API: LocationService.checkParkingLocation() (line 1228)
  → Saves to AsyncStorage/history/server (lines 1239-1280)
  → Filters user's own permit zone (line 1300)
  → Sends notification (lines 1305-1308)
  → Schedules reminders (line 1317)

Line 1305: sendParkingNotification(result, accuracy?, rawData?)
  → Uses notifee.displayNotification()
  → Title based on severity (lines 1892-1901)
  → Body: address + rules + enforcement risk + upcoming restrictions

Line 1307: sendSafeNotification(address, accuracy?, rawData?)
  → "All Clear" notification with upcoming restrictions context

Line 1530: scheduleRestrictionReminders(rawData, coords)
  → CRITICAL FUNCTION for understanding reminder scheduling
  
  Line 1540: Street cleaning (2 notifications)
    - 9pm night before (line 1556)
    - 7am morning of (line 1572)
  
  Line 1590: Winter ban (1 notification)
    - 9pm (line 1596)
  
  Line 1619: Permit zone (1 notification)
    - 7am next weekday (line 1625)
  
  Line 1662: Enforcement risk follow-up (optional)
    - Halfway through peak window (line 1670)
  
  Returns: ParkingRestriction[] sent to LocalNotificationService

Line 771: handleCarReconnection(nativeDrivingTimestamp?)
  → Called when BT reconnects (user starts driving)
  → Triggers departure tracking (line 773)
```

### Local Notification Scheduling
```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocalNotificationService.ts

Line 126: scheduleNotificationsForParking(restrictions: ParkingRestriction[])
  → Cancels previous notifications (line 133)
  → For each restriction, calls scheduleRestrictionNotification() (line 139)

Line 156: scheduleRestrictionNotification(restriction)
  → Switch on restriction.type (line 168)
  
  Line 169: case 'street_cleaning'
    - Parses details to detect urgency level
    - High priority: "MOVE YOUR CAR NOW" (line 181)
    - Normal: "Move tonight" (line 186)
  
  Line 191: case 'winter_ban'
    - Channel: parking-alerts
    - "Winter overnight parking ban 3am–7am"
  
  Line 199: case 'snow_ban'
    - Channel: parking-alerts
    - "Snow ban may be active"
  
  Line 208: case 'permit_zone'
    - Channel: reminders
    - "Permit zone — Move by 8am"
  
  Line 230: Create TimestampTrigger for notifee
  Line 236: notifee.createTriggerNotification(notification, trigger)

Line 340: cancelAllScheduledNotifications()
  → Called when user drives away
  → Gets all scheduled notifications (line 342)
  → Filters to parking-related ones (lines 345-352)
  → Cancels each via notifee.cancelTriggerNotification()
```

### Location Service (GPS + API)
```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts

Line 82: requestLocationPermission(includeBackground?)
  → iOS: Always request 'always' (line 86)
  → Android: REQUEST_FINE_LOCATION + ACCESS_BACKGROUND_LOCATION (Android 10+)

Line 200: getCurrentLocation(accuracy?, highAccuracy?)
  → Single GPS fix via Geolocation.getCurrentPosition()

Line 300: getLocationWithRetry(retries?, timeout?, includeAltitude?)
  → Retry logic for GPS acquisition

Line 400+: checkParkingLocation(coords)
  → Calls backend /api/check-parking
  → Returns ParkingCheckResult with rules[] + rawApiData

Line 700+: saveParkingCheckResult(result)
  → Saves to AsyncStorage for UI (HomeScreen hero card)

Line 800+: saveParkedLocationToServer(coords, rawData, address, fcmToken)
  → Saves to Supabase user_parked_vehicles table
  → Enables server-side pushes for snow bans
```

### Camera Proximity (Reusable Pattern)
```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/CameraAlertService.ts

Line 731: findNearbyCameras(lat, lng, heading, alertRadius)
  → Returns nearby camera array
  
  Line 739: Create bounding box (BBOX_DEGREES = 0.0025)
  Line 744: Iterate CHICAGO_CAMERAS
  Line 749: Bounding box filter (fast O(1) compare)
  Line 753: Haversine distance (exact)
  Line 754: Check within alertRadius
  Line 757: Direction match (isHeadingMatch)
  Line 761: Camera ahead filter (isCameraAhead)
  
  Result: [{index, camera, distance}, ...] sorted by distance

Line 848: isCameraAhead(userLat, userLng, camLat, camLng, heading)
  → Calculate bearing to camera (line 858)
  → Check if bearing within ±30° of heading (line 864)
  → Filters parallel street false alerts

Line 820: bearingTo(lat1, lng1, lat2, lng2)
  → Calculate initial bearing via atan2
  → Returns degrees 0-360
```

### Metered Parking Data
```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/data/chicago-metered-parking.ts

Line 37: getMeteredParkingLocations(): MeteredParkingLocation[]
  → Returns in-memory array (loaded from API or AsyncStorage cache)

Line 45: fetchMeteredParkingLocations(): Promise<void>
  → Async fetch from API
  → Cache in AsyncStorage (7-day TTL)
  → Fire-and-forget (called at app init, line 134 in BackgroundTaskService)
```

---

## SUMMARY TABLE

| What | File | Function | Line | Returns |
|------|------|----------|------|---------|
| State machine parks car | ParkingDetectionStateMachine.ts | parkingConfirmed() | 311 | void |
| Start parking check | BackgroundTaskService.ts | handleCarDisconnection() | 1058 | Promise<void> |
| **Core flow** | BackgroundTaskService.ts | triggerParkingCheck() | 1122 | Promise<void> |
| Get GPS | LocationService.ts | getCurrentLocation() | 200 | Coordinates |
| Call API | LocationService.ts | checkParkingLocation() | 400+ | ParkingCheckResult |
| Parse reminders | BackgroundTaskService.ts | scheduleRestrictionReminders() | 1530 | Promise<void> |
| Schedule local notifications | LocalNotificationService.ts | scheduleNotificationsForParking() | 126 | Promise<void> |
| Send immediate alert | BackgroundTaskService.ts | sendParkingNotification() | 1854 | Promise<void> |
| Send all-clear | BackgroundTaskService.ts | sendSafeNotification() | 1924 | Promise<void> |
| Cancel on departure | LocalNotificationService.ts | cancelAllScheduledNotifications() | 340 | Promise<void> |
| Camera proximity | CameraAlertService.ts | findNearbyCameras() | 731 | Array<{camera,distance}> |

---

## Integration Success Criteria

For metered parking, you'll know integration is complete when:

1. ✅ User parks on a metered street
2. ✅ Within 5 seconds: "⏰ Parked — Metered Parking Active\n[Address]\n[Rate/Hour]" notification
3. ✅ Restriction start time: reminder notification fires
4. ✅ User drives away: all notifications cancel automatically
5. ✅ History screen shows metered parking entry with rate
6. ✅ Server `user_parked_vehicles` updated with metered parking data
7. ✅ Optional: TTS alert 500m before entering metered zone during driving

