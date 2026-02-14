# Parking Detection & Notification System Documentation

This directory contains comprehensive documentation for understanding and extending the Ticketless Chicago parking detection, notification, and restrictions checking system.

## Quick Start

**New to this system?** Start here in order:

1. **PARKING_SYSTEM_SUMMARY.md** (5 min read)
   - Executive overview of the parking detection flow
   - Library details (notifee, Firebase)
   - How each component works at a high level
   - Complete function reference with line numbers

2. **PARKING_DETECTION_FLOW.md** (20 min read)
   - Deep technical reference with all implementation details
   - Step-by-step flow from parking detection to notification
   - Data structures and interfaces
   - Camera proximity pattern (reusable for metered parking)

3. **METERED_PARKING_INTEGRATION_GUIDE.md** (10 min read)
   - If you're implementing metered parking detection
   - Specific integration points with code examples
   - Testing checklist
   - Data structure modifications needed

## Key Files in Codebase

```
TicketlessChicagoMobile/src/services/
├── BackgroundTaskService.ts           (THE MAIN ORCHESTRATOR)
│   ├── Line 1058: handleCarDisconnection()
│   ├── Line 1122: triggerParkingCheck() [CORE FLOW]
│   ├── Line 1305: sendParkingNotification()
│   ├── Line 1530: scheduleRestrictionReminders()
│   └── Line 1854: sendParkingNotification()
│
├── ParkingDetectionStateMachine.ts    (PARKING/DRIVING STATE)
│   ├── Line 252: btDisconnected()
│   ├── Line 311: parkingConfirmed()
│   └── Line 419: onTransition() [HOW BackgroundTaskService hooks in]
│
├── LocationService.ts                  (GPS + PARKING API)
│   ├── Line 200: getCurrentLocation()
│   ├── Line 400+: checkParkingLocation()
│   └── Line 700+: saveParkedLocationToServer()
│
├── LocalNotificationService.ts        (SCHEDULING REMINDERS)
│   ├── Line 126: scheduleNotificationsForParking()
│   ├── Line 156: scheduleRestrictionNotification()
│   └── Line 340: cancelAllScheduledNotifications()
│
├── CameraAlertService.ts              (PROXIMITY PATTERN)
│   ├── Line 731: findNearbyCameras() [REUSABLE FOR METERED PARKING]
│   ├── Line 143-184: Constants
│   └── Line 848: isCameraAhead() [BEARING FILTER]
│
└── chicago-metered-parking.ts         (METERED PARKING DATA)
    ├── Line 37: getMeteredParkingLocations()
    └── Line 45: fetchMeteredParkingLocations()
```

## The Flow (30-second version)

```
User parks car (BT disconnect or CoreMotion)
    ↓
ParkingDetectionStateMachine.btDisconnected() 
    ↓ 10-second debounce
ParkingDetectionStateMachine.parkingConfirmed()
    ↓
BackgroundTaskService callback:
    ↓
handleCarDisconnection() → triggerParkingCheck():
    • Get GPS (2-phase: fast + burst refine)
    • Call /api/check-parking
    • Send notification ("Restriction Active" or "All Clear")
    • Schedule advance reminders (9pm, 7am, etc.)
    ↓
LocalNotificationService.scheduleNotificationsForParking():
    • Street cleaning: 9pm night-before + 7am morning-of
    • Winter ban: 9pm
    • Permit zone: 7am next weekday
    ↓
User drives away (BT reconnects):
    ↓
BackgroundTaskService callback:
    ↓
LocalNotificationService.cancelAllScheduledNotifications()
```

## Key Integration Points for Metered Parking

### 1. API Response (LocationService layer)
- Add metered parking violation to `rules[]` array
- Include timing in `rawApiData`

### 2. Reminder Scheduling (BackgroundTaskService.scheduleRestrictionReminders)
- Parse `result.meteredParking?.active && result.meteredParking?.hoursActive`
- Schedule reminder at restriction start time
- Example: 8am if metered 8am-6pm

### 3. Notification Display (LocalNotificationService)
- Add `case 'metered_parking':` handler
- Show title: "⏰ Metered Parking Active"
- Show body: address + rate/hour

### 4. (Optional) Proximity Alerts During Driving
- Reuse CameraAlertService.findNearbyCameras() pattern
- Bounding box filter for metered payboxes
- TTS alert: "Metered parking coming up — $2.50/hour"

## Notifications & Libraries

### Libraries
- **@notifee/react-native**: Local + scheduled notifications
- **@react-native-firebase/messaging**: FCM push token + background pushes

### Notification Types

| Type | Trigger | Channel | Sound | Example |
|------|---------|---------|-------|---------|
| Immediate (restrict) | User parks with restrictions | parking-alerts | Yes | "Restriction Active!" |
| Immediate (clear) | User parks, all clear | parking-monitoring | Yes | "All Clear!" |
| Scheduled reminder | At specific time (9pm, 7am, etc.) | reminders | Yes | "Street cleaning tomorrow" |
| Server push | Weather/enforcement change | parking-alerts | Yes | "Snow ban alert!" |

### Notification Lifecycle
- **Created**: After parking check completes (line 1317 in BackgroundTaskService)
- **Fires**: At scheduled time (notifee manages this)
- **Cancelled**: When user drives away (line 340 in LocalNotificationService)

## Testing

For any changes to parking detection:

```bash
# Android
adb logcat | grep "BackgroundTaskService\|ParkingStateMachine\|LocalNotifications"

# iOS
Xcode Console, filter by "BackgroundLocation" or "CoreMotion"
```

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Parking never detected | BT disconnect not firing | Check native BluetoothMonitorService initialization |
| Notification delayed | GPS stuck | Check fallback logic in triggerParkingCheck (lines 1160-1214) |
| Reminder doesn't fire | Notification time in past | Check timestamp calculation in scheduleRestrictionReminders |
| Reminders not cancelled | BT reconnect missed | Check state machine PARKED→DRIVING callback registration |
| Metered parking shows in rules but no reminder | scheduleRestrictionReminders needs update | Add metered parking case (see METERED_PARKING_INTEGRATION_GUIDE) |

## Questions?

Refer to:
- **Specific function**: PARKING_SYSTEM_SUMMARY.md → "Summary Table"
- **Full implementation**: PARKING_DETECTION_FLOW.md
- **Line numbers**: Search "line X" in referenced file
- **Integration**: METERED_PARKING_INTEGRATION_GUIDE.md

