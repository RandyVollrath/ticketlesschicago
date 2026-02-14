# Parking Detection System - Quick Reference for Metered Parking Integration

## THE FLOW (High Level)

1. **Car Disconnects (Bluetooth or CoreMotion)** → ParkingDetectionStateMachine emits `PARKING_PENDING->PARKED`
2. **BackgroundTaskService receives callback** → calls `handleCarDisconnection()`
3. **Get GPS location** (2-phase: fast single fix + background burst refinement)
4. **Call parking API** → `/api/check-parking` returns active restrictions + raw API data
5. **Save results** to localStorage, history, and server
6. **Send immediate notification** (if restrictions) or "all clear" notification
7. **Schedule advance reminders** via `LocalNotificationService.scheduleNotificationsForParking()`
   - Street cleaning: 9pm night before + 7am morning of
   - Winter ban: 9pm before 3am ban
   - Permit zone: 7am before 8am enforcement
   - Snow ban: Server push (not local)
8. **User drives away** → BT reconnects → `PARKED->DRIVING` → cancel all scheduled notifications

---

## KEY FILES & LINE NUMBERS

### Parking Check Orchestration
- **BackgroundTaskService.ts**
  - Line 178: State machine callback `PARKING_PENDING->PARKED` triggers parking check
  - Line 1058: `handleCarDisconnection()` - debounces, clears stale GPS, triggers check
  - Line 1122: `triggerParkingCheck()` - **THE CORE FLOW** (GPS → API → notifications → scheduling)
  - Line 1305: `sendParkingNotification()` - immediate "restriction active" notification
  - Line 1307: `sendSafeNotification()` - "all clear" notification
  - Line 1317: `scheduleRestrictionReminders()` - creates timed local notifications

### Restriction Reminder Scheduling
- **BackgroundTaskService.ts, Line 1530: `scheduleRestrictionReminders()`**
  - **Street cleaning reminders**: Lines 1540-1588
    - Parses `result.streetCleaning.nextDate` and `result.streetCleaning.schedule`
    - Creates 2 notifications: 9pm night before + 7am morning of
  - **Winter ban reminder**: Lines 1590-1617
    - Checks `result.winterOvernightBan?.active || result.winterBan?.found`
    - Creates 1 notification: 9pm
  - **Permit zone reminder**: Lines 1619-1657
    - Checks `result.permitZone?.inPermitZone && !result.permitZone?.permitRequired`
    - Creates 1 notification: 7am next weekday
  - **Enforcement risk follow-up**: Lines 1662-1703
    - HIGH urgency only, scheduled halfway through peak window

### Local Notification Scheduling
- **LocalNotificationService.ts, Line 126: `scheduleNotificationsForParking(restrictions: ParkingRestriction[])`**
  - Lines 156-267: `scheduleRestrictionNotification()` - schedules individual notification
  - Uses `notifee.createTriggerNotification()` with `TriggerType.TIMESTAMP`
  - Line 340: `cancelAllScheduledNotifications()` - called when user drives away

### Camera Proximity Pattern (REUSABLE FOR METERED PARKING)
- **CameraAlertService.ts, Line 731: `findNearbyCameras(lat, lng, heading, alertRadius)`**
  - Lines 739-750: Bounding box pre-filter (~280m box)
  - Line 753: Haversine distance for bbox candidates
  - Line 754: Check within alert radius
  - Lines 757-761: Direction matching + "camera ahead" bearing filter
  - **KEY CONSTANTS** (lines 143-184):
    - `BASE_ALERT_RADIUS_METERS = 150` (base distance)
    - `MAX_ALERT_RADIUS_METERS = 250` (prevents parallel street false alerts)
    - `BBOX_DEGREES = 0.0025` (~280m at Chicago latitude)

---

## FOR METERED PARKING: 3 INTEGRATION POINTS

### 1. API Response Integration
**Where**: `LocationService.checkParkingLocation()` backend response
- Add `meteredParking: { active, meterRate?, daysActive?, hoursActive? }` to `ParkingRule[]`
- If user parked on an active metered street, add to `rules` array
- Include timing info in `rawApiData` for reminder scheduling

**How it flows**: 
```
API response → LocationService.checkParkingLocation() 
→ result.rules includes metered violation
→ sendParkingNotification() displays: "Metered parking 8am-6pm. Rate: $2/hour"
→ scheduleRestrictionReminders() creates reminders
```

### 2. Reminder Scheduling Integration
**Where**: `BackgroundTaskService.ts, scheduleRestrictionReminders()` (line 1530)
- Add section for metered parking (after permit zone section)
- Parse: `result.meteredParking?.active && result.meteredParking?.hoursActive`
- Schedule reminders **at restriction start time** (e.g., 8am) and optionally periodically
- Example:
  ```typescript
  // Metered parking reminders
  if (result.meteredParking?.active && result.meteredParking?.hoursActive) {
    const { startHour, endHour, ratePerHour } = result.meteredParking;
    const nextStart = new Date(now);
    nextStart.setHours(startHour, 0, 0, 0);
    if (currentHour >= startHour) {
      nextStart.setDate(nextStart.getDate() + 1); // Tomorrow
    }
    
    restrictions.push({
      type: 'metered_parking',
      restrictionStartTime: nextStart,
      address: result.address,
      details: `Metered parking ${startHour}am-${endHour}pm. Rate: $${ratePerHour}/hr`,
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }
  ```

### 3. Notification Configuration Integration
**Where**: `LocalNotificationService.ts, scheduleRestrictionNotification()` (line 156)
- Add `case 'metered_parking'`:
  ```typescript
  case 'metered_parking':
    hoursBefore = 0;
    notificationId = `metered-parking-${Date.now()}`;
    channelId = 'reminders'; // DEFAULT importance
    title = '⏰ Metered Parking Active';
    body = `${address}\n${details || 'You are parked at a metered spot with active rates. Move or pay.'}`;
    break;
  ```

### 4. (Optional) Proximity Alerts During Driving
**Where**: CameraAlertService-style module for metered zones
- Reuse `findNearbyCameras()` bounding box + Haversine pattern
- Pre-alert user when approaching expensive metered zone
- TTS: "Metered parking coming up — $3 per hour during 8am-6pm"

---

## IMPORTANT BEHAVIORS

### Debouncing
- `handleCarDisconnection()` won't fire twice in 30 seconds (line 1063-1072)
- Prevents duplicate parking checks from multiple trigger sources

### GPS Accuracy
- 2-phase acquisition: fast (1-3s) for notification + burst refine (6s max) for history
- Fallbacks: cached location → recent cached → stale cache → last driving location
- See lines 1160-1214 in BackgroundTaskService.ts

### Notification Cancellation
- When user drives away: BT reconnects → state machine `PARKED->DRIVING`
- BackgroundTaskService callback at line 190-194 calls `handleCarReconnection()`
- Cancels ALL scheduled notifications via `LocalNotificationService.cancelAllScheduledNotifications()`

### Server Integration
- **Parked location saved**: `LocationService.saveParkedLocationToServer()` (line 1270)
  - Populates `user_parked_vehicles` table with lat, lng, FCM token
  - Enables server-side push for snow bans (weather-dependent, can't pre-schedule locally)

---

## DATA STRUCTURES TO MODIFY

### Add to ParkingRestriction (LocalNotificationService.ts, line 52)
```typescript
type: 'street_cleaning' | 'winter_ban' | 'snow_ban' | 'permit_zone' | 'metered_parking';
```

### Add to ParkingRule (LocationService.ts, line 14)
```typescript
type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'tow_zone' | 'metered_parking';
```

### New structure (optional, if API returns metered data separately)
```typescript
interface MeteredParkingRestriction {
  active: boolean;
  startHour: number; // 8
  endHour: number; // 6
  daysActive: string[]; // ['Mon', 'Tue', ...]
  ratePerHour: number; // 2.50
}
```

---

## TESTING CHECKLIST FOR METERED PARKING

- [ ] Park at a metered location
- [ ] Receive "metered parking active" notification within 5 seconds
- [ ] Check notification includes address + rate/hour
- [ ] Verify reminder notification scheduled at restriction start time
- [ ] Drive away → reminder notifications automatically cancel
- [ ] Check History screen shows metered parking entry
- [ ] Test at night (after hours) → no notification (active: false)
- [ ] Test in different zones with different rates
- [ ] Test server integration: `user_parked_vehicles` table updated

