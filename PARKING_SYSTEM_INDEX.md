# Parking Detection & Notification System - Complete Documentation Index

**Created**: February 10, 2026
**Total Lines of Documentation**: 2,746+

## START HERE

### For Quick Understanding
1. **README_PARKING_SYSTEM.md** (6 KB)
   - 5-10 minute overview
   - Key files reference
   - Quick start guide
   - Common issues & solutions

### For Implementation
2. **METERED_PARKING_INTEGRATION_GUIDE.md** (8 KB)
   - 3 specific integration points with code examples
   - Testing checklist
   - Data structure modifications
   - Optional proximity alerts pattern

### For Deep Technical Understanding
3. **PARKING_SYSTEM_SUMMARY.md** (18 KB)
   - Complete function reference with exact line numbers
   - Flow diagrams (text)
   - Notification library details (notifee, Firebase)
   - All data structures and types
   - Camera proximity pattern (reusable)

4. **PARKING_DETECTION_FLOW.md** (15 KB)
   - Detailed 12-section technical reference
   - Entry points (Android & iOS)
   - GPS acquisition strategy (2-phase)
   - Parking API response structure
   - Local notification scheduling by type
   - Restrictions map implementation

## NEW DOCUMENTS (This Session)

These 4 documents comprehensively document the parking detection, notification, and restrictions system:

| Document | Size | Purpose | Key Content |
|----------|------|---------|-------------|
| README_PARKING_SYSTEM.md | 6.2 KB | Entry point, quick reference | Flow diagram, key files, common issues |
| PARKING_SYSTEM_SUMMARY.md | 18 KB | Executive summary + complete reference | All functions, line numbers, data structures |
| PARKING_DETECTION_FLOW.md | 15 KB | Detailed technical flow | Step-by-step flow, GPS strategy, API response |
| METERED_PARKING_INTEGRATION_GUIDE.md | 8 KB | Implementation guide | 3 integration points, code examples, testing |

## EXISTING DOCUMENTS (For Context)

These documents analyze specific subsystems (created in earlier sessions):

- **iOS_PARKING_DETECTION_FLOW.md** (23 KB) - CoreMotion + background location details
- **iOS_PARKING_DETECTION_ANALYSIS.md** (20 KB) - Detailed iOS implementation analysis
- **iOS_PARKING_DETECTION_FILE_REFERENCE.md** (14 KB) - iOS file paths and modules
- **iOS_PARKING_DETECTION_INDEX.md** (7.7 KB) - iOS-specific quick reference
- **PARKING_DETECTION_ANALYSIS.md** (33 KB) - Complete system analysis (Android focus)
- **PARKING_DETECTION_FLOWS.md** (27 KB) - Detailed flow diagrams
- **PARKING_RESTRICTIONS_ANALYSIS.md** (11 KB) - Street cleaning, winter ban, permit zones

## Reading Guide by Role

### If You're...

#### Learning the System
```
1. Start: README_PARKING_SYSTEM.md (quick overview)
2. Read: PARKING_SYSTEM_SUMMARY.md (high-level architecture)
3. Deep dive: PARKING_DETECTION_FLOW.md (detailed flows)
4. Reference: iOS_PARKING_DETECTION_FLOW.md (iOS specifics)
Time: 1-2 hours
```

#### Adding Metered Parking
```
1. Start: README_PARKING_SYSTEM.md (understand existing flow)
2. Reference: METERED_PARKING_INTEGRATION_GUIDE.md (3 integration points)
3. Check: PARKING_SYSTEM_SUMMARY.md (function line numbers)
4. Implement: Add cases to LocalNotificationService, BackgroundTaskService
Time: 2-4 hours
```

#### Debugging a Problem
```
1. Check: README_PARKING_SYSTEM.md (common issues section)
2. Trace: PARKING_DETECTION_FLOW.md (find the relevant step)
3. Reference: PARKING_SYSTEM_SUMMARY.md (get exact line numbers)
4. Look at: Corresponding .ts file with line number as guide
Time: 30 minutes - 1 hour
```

#### Working on iOS Specifics
```
1. Start: README_PARKING_SYSTEM.md (Android flow first)
2. Read: iOS_PARKING_DETECTION_FLOW.md (iOS-specific details)
3. Reference: iOS_PARKING_DETECTION_ANALYSIS.md (deep dive)
4. Files: iOS_PARKING_DETECTION_FILE_REFERENCE.md (module locations)
Time: 2 hours
```

## Key Information Summary

### The Parking Check Flow (2 minutes)

```
1. User parks → Bluetooth disconnects (Android) or CoreMotion detects stationary (iOS)
2. ParkingDetectionStateMachine starts 10-second debounce
3. After debounce: triggers ParkingDetectionStateMachine.parkingConfirmed()
4. BackgroundTaskService callback fires:
   a. Get GPS (2-phase: fast 1-3s + burst refine 6s)
   b. Call backend /api/check-parking
   c. Send immediate notification ("Active Restrictions" or "All Clear")
   d. Schedule advance reminders (9pm, 7am, etc.) via LocalNotificationService
5. User drives away → BT reconnects → all notifications cancelled
```

### Key Files & Line Numbers

| File | Function | Line | Purpose |
|------|----------|------|---------|
| BackgroundTaskService.ts | handleCarDisconnection | 1058 | Start parking check |
| BackgroundTaskService.ts | triggerParkingCheck | 1122 | **CORE FLOW** |
| BackgroundTaskService.ts | scheduleRestrictionReminders | 1530 | **REMINDER SCHEDULING** |
| BackgroundTaskService.ts | sendParkingNotification | 1854 | Send restriction alert |
| LocalNotificationService.ts | scheduleNotificationsForParking | 126 | Schedule local notifications |
| LocalNotificationService.ts | cancelAllScheduledNotifications | 340 | Cancel when leaving |
| CameraAlertService.ts | findNearbyCameras | 731 | **PROXIMITY PATTERN** (reusable for metered) |
| ParkingDetectionStateMachine.ts | parkingConfirmed | 311 | Complete parking state transition |

### Libraries Used
- **@notifee/react-native**: Scheduled + foreground notifications (with channels)
- **@react-native-firebase/messaging**: FCM push token registration & background pushes
- **react-native-geolocation-service**: GPS acquisition with retry logic
- **react-native-bluetooth-classic**: Bluetooth connection monitoring (Android)

### Notification Types
1. **Immediate Parking Alert**: `notifee.displayNotification()` (fires at parking moment)
2. **Scheduled Reminders**: `notifee.createTriggerNotification()` (fires at scheduled time)
3. **Server Push**: Firebase `messaging().onMessage()` (for weather-dependent snow bans)

### Restriction Types Supported
- Street cleaning (2 notifications: 9pm night-before + 7am morning-of)
- Winter ban (1 notification: 9pm)
- Permit zone (1 notification: 7am next weekday)
- Snow ban (server-side push, weather-dependent)
- Enforcement risk follow-up (optional, mid-peak-window)
- **Metered parking** (to be added - see METERED_PARKING_INTEGRATION_GUIDE.md)

## Integration Checklist for Metered Parking

- [ ] Read METERED_PARKING_INTEGRATION_GUIDE.md
- [ ] Add `'metered_parking'` to `ParkingRestriction.type` union (LocalNotificationService.ts, line 52)
- [ ] Add `'metered_parking'` to `ParkingRule.type` union (LocationService.ts, line 14)
- [ ] Add case in BackgroundTaskService.scheduleRestrictionReminders() (after permit zone, ~line 1657)
- [ ] Add case in LocalNotificationService.scheduleRestrictionNotification() (after permit zone, ~line 208)
- [ ] Test: Park at metered location, verify notification within 5 seconds
- [ ] Test: Verify reminder fires at restriction start time
- [ ] Test: Drive away, verify reminders cancel
- [ ] Test: Check History shows metered parking entry

## Quick Reference: All Files Mentioned

### Service Files
```
TicketlessChicagoMobile/src/services/
├── BackgroundTaskService.ts (2,800+ lines)
├── ParkingDetectionStateMachine.ts (600 lines)
├── LocationService.ts (1,000+ lines)
├── LocalNotificationService.ts (430 lines)
├── PushNotificationService.ts (457 lines)
├── CameraAlertService.ts (900+ lines)
├── BackgroundLocationService.ts (iOS/Android location detection)
├── MotionActivityService.ts (iOS CoreMotion)
└── BluetoothService.ts (BT connection management)
```

### Data Files
```
TicketlessChicagoMobile/src/data/
├── chicago-cameras.ts (510 cameras)
├── chicago-metered-parking.ts (4,600+ payboxes, loaded from API)
└── ingestion/chicago/
    ├── street-cleaning.ts
    ├── winter-ban.ts
    ├── snow-routes.ts
    └── permit-zones.ts
```

### Screen Files
```
TicketlessChicagoMobile/src/screens/
├── MapScreen.tsx (displays restrictions from last check)
├── HomeScreen.tsx (hero card with parking status)
├── HistoryScreen.tsx (parking history with entries)
└── ProfileScreen.tsx (permit zone setup)
```

## Next Steps

### For Learning
→ Read README_PARKING_SYSTEM.md (6 KB, 10 minutes)
→ Then PARKING_SYSTEM_SUMMARY.md (18 KB, 20 minutes)

### For Implementation
→ Read METERED_PARKING_INTEGRATION_GUIDE.md (8 KB, 10 minutes)
→ Reference PARKING_SYSTEM_SUMMARY.md for line numbers

### For Debugging
→ Grep for the function in the file
→ Check README_PARKING_SYSTEM.md common issues
→ Reference PARKING_DETECTION_FLOW.md for complete flow

## Document Status

✅ All 4 new documents completed and saved to `/home/randy-vollrath/ticketless-chicago/`
✅ Line numbers verified against actual source files
✅ Integration points identified for metered parking
✅ Testing checklist provided
✅ Reusable patterns documented (camera proximity for metered alerts)

---

**Total documentation**: 2,746+ lines across 11 files
**Focus areas**: Parking detection flow, notification lifecycle, restrictions checking, metered parking integration
**Audience**: Developers new to system, implementers of metered parking, debuggers
