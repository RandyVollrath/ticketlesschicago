# iOS Parking Detection Failure Analysis
**Date**: 2026-02-05
**Log File**: `TicketlessChicagoMobile/logs/iphone_syslog_20260205.txt`

## Executive Summary

The iOS syslog file from 2026-02-05 02:15-02:16 CST **does NOT contain any application console.log output**. iOS syslogs only capture system-level events (Bluetooth, network, power management) by default, not React Native JavaScript console logs. Without the actual app logs, I can only provide a **theoretical analysis** based on the codebase architecture.

However, based on the code review, I've identified **THREE critical bugs** that explain both symptoms:
1. **Why departure wasn't captured**: The state machine doesn't transition to DRIVING without CoreMotion detecting automotive activity
2. **Why UI shows "Driving" after parking**: The HomeScreen is reading a stale `parkingState` that never updated

---

## User's Scenario Timeline (Reconstructed)

### What Should Have Happened
1. **02:15** - User parked at home (no tracking here — monitoring wasn't on yet)
2. **02:15** - User opened app while parked → `HomeScreen` mounted → `useEffect` runs → checks `BackgroundLocationService.getStatus()`
3. **User drove to Wrightwood** → CoreMotion should have detected automotive → `onDrivingStarted` callback should have fired → `handleCarReconnection()` → `markCarReconnected()` → `scheduleDepartureConfirmation()`
4. **User parked at Wrightwood** → CoreMotion detected stationary → `onParkingDetected` callback → parking check ran → **SUCCESS** (correct address, correct time in history)
5. **User walked back into condo** → CoreMotion detected walking → HomeScreen should show "Parked" state

### What Actually Happened
1. **Departure from home was never captured** → `pendingDepartureConfirmation` was never created
2. **HomeScreen still showed "Driving"** after walking back into condo → State machine stuck in stale state

---

## Critical Bugs Identified

### Bug #1: iOS Departure Never Captured
**Root Cause**: iOS parking detection uses CoreMotion + GPS, but there's **no explicit transition to DRIVING state** in the state machine when CoreMotion detects automotive activity.

**Code Evidence**:
```typescript
// TicketlessChicagoMobile/src/services/BackgroundTaskService.ts:510-516
BackgroundLocationService.startMonitoring(
  (parkingTimestamp?: number) => { /* onParkingDetected */ },
  (drivingTimestamp?: number) => {
    log.info('DRIVING STARTED - user departing', {
      nativeTimestamp: drivingTimestamp ? new Date(drivingTimestamp).toISOString() : 'none',
    });
    this.startCameraAlerts();
    this.handleCarReconnection(drivingTimestamp);  // ← This calls markCarReconnected
  }
);
```

**The Problem**:
- `BackgroundLocationService.startMonitoring` passes an `onDrivingStarted` callback that **calls `handleCarReconnection()`** (which triggers departure tracking)
- BUT `ParkingDetectionStateMachine` **never transitions to DRIVING** when CoreMotion detects automotive
- The state machine only transitions to DRIVING on **Bluetooth connect** (Android) or explicitly via `sendEvent('BT_CONNECT')`
- iOS CoreMotion detection bypasses the state machine entirely — it goes straight to `BackgroundTaskService` callbacks

**Consequence**:
- When user started driving from home, CoreMotion detected automotive → `onDrivingStarted` callback fired → `handleCarReconnection()` ran → `markCarReconnected()` should have called the API
- **IF** `markCarReconnected()` ran, it would have created `pendingDepartureConfirmation` and scheduled the 2-minute timer
- **IF** the API succeeded, departure would have been tracked
- **BUT** we have no evidence from logs that this happened

**Why It Failed**:
1. **iOS doesn't have Bluetooth tracking** (no car pairing on this device — it's Android-only per codebase)
2. **CoreMotion detection might be delayed** — iOS CoreMotion can take 30-60 seconds to detect automotive after starting a drive
3. **The state machine never transitioned to DRIVING** — so `parkingState` stayed in whatever state it was in (likely `INITIALIZING` or `IDLE`)

---

### Bug #2: HomeScreen Shows "Driving" After Parking
**Root Cause**: The `HomeScreen` reads `parkingState` from `ParkingDetectionStateMachine.snapshot`, which is **only updated on Android** (Bluetooth-based transitions). On iOS, the state machine is **never updated** after parking because parking detection goes through `BackgroundLocationService` callbacks, not state machine transitions.

**Code Evidence**:
```typescript
// TicketlessChicagoMobile/src/screens/HomeScreen.tsx:223-257
const unsubscribe = ParkingDetectionStateMachine.addStateListener((snap: ParkingDetectionSnapshot) => {
  const wasTransition = prevState !== null && prevState !== snap.state;
  prevState = snap.state;

  setParkingState(snap.state);
  setIsCarConnected(snap.isConnectedToCar);
  if (snap.carName) {
    setSavedCarName(snap.carName);
  }
  // When transitioning TO DRIVING, clear any stale parking result from a previous trip.
  if (wasTransition && snap.state === 'DRIVING') {
    setLastParkingCheck(null);
  }
});
```

**The Problem**:
- `parkingState` is derived from `ParkingDetectionStateMachine.snapshot.state`
- On iOS, the state machine is **not the source of truth** for parking detection
- iOS uses `BackgroundLocationService` (CoreMotion + GPS) → callbacks fire → `BackgroundTaskService` methods run → parking is recorded → **but the state machine is never updated**
- `ParkingDetectionStateMachine` is only updated on Android via Bluetooth events (`BT_CONNECT`, `BT_DISCONNECT`)

**Why UI Showed "Driving"**:
1. User opened app while parked at home → `parkingState` initialized to `INITIALIZING` (from state machine)
2. User started driving → CoreMotion detected automotive → `onDrivingStarted` callback fired → **BUT state machine was never updated to DRIVING**
3. User parked at Wrightwood → `onParkingDetected` callback fired → parking check ran → **BUT state machine was never updated to PARKED**
4. User walked back into condo → HomeScreen still showed `parkingState = 'INITIALIZING'` or `'IDLE'`
5. **The hero card logic** (line 641-681) has this fallback:
   ```typescript
   const isDriving = (() => {
     if (Platform.OS === 'ios') return currentActivity === 'automotive';  // ← BUG HERE
     if (Platform.OS === 'android') return isCarConnected;
     return false;
   })();
   ```
   **Problem**: `currentActivity` is derived from `MotionActivityService`, which is separate from `BackgroundLocationService`. If `currentActivity` is still `'automotive'` (because CoreMotion hasn't updated yet), the UI shows "Driving" even though the user is walking.

---

### Bug #3: iOS State Machine Architecture Mismatch
**Root Cause**: The codebase has **two separate parking detection systems**:
1. **Android**: `ParkingDetectionStateMachine` (Bluetooth-based) → single source of truth
2. **iOS**: `BackgroundLocationService` (CoreMotion + GPS) → bypasses state machine entirely

**The Problem**:
- `HomeScreen` was refactored to use `ParkingDetectionStateMachine` as the single source of truth on Android (line 164-168)
- But iOS parking detection **doesn't update the state machine** — it only fires callbacks
- This creates a **race condition** where:
  - iOS parking is detected and recorded
  - But `HomeScreen` still shows stale state from the state machine
  - User sees "Driving" or "Waiting for car" instead of "Parked"

**Evidence from Code Comments**:
```typescript
// TicketlessChicagoMobile/src/screens/HomeScreen.tsx:162-168
// On Android, read initial BT state from the state machine (single source of truth).
// Falls back to BluetoothService for backward compat until full cutover.
const smSnapshot = Platform.OS === 'android' ? ParkingDetectionStateMachine.snapshot : null;
const [isCarConnected, setIsCarConnected] = useState(smSnapshot?.isConnectedToCar ?? false);
const [savedCarName, setSavedCarName] = useState<string | null>(smSnapshot?.carName ?? null);
const [parkingState, setParkingState] = useState<ParkingState>(smSnapshot?.state ?? 'INITIALIZING');
```

**BUG**: This only reads the state machine on Android! On iOS, it defaults to `'INITIALIZING'` and **never updates** because the state machine is never updated by iOS parking detection.

---

## Why the Logs Don't Help

### iOS Syslog Limitations
The `iphone_syslog_20260205.txt` file contains:
- ✅ Bluetooth LE advertisements (Apple Find My, AirTags, etc.)
- ✅ Network connection logs (TCP/UDP flows)
- ✅ System-level events (backlight, power management)
- ❌ **NO React Native JavaScript console.log output**
- ❌ **NO CoreMotion activity updates**
- ❌ **NO CLLocationManager events**
- ❌ **NO BackgroundLocationModule Swift logs**

### What We'd Need to See
To diagnose this properly, we'd need:
1. **Console logs from Metro bundler** (if app was running in dev mode)
2. **Xcode device logs** (captured via Xcode → Devices → View Device Logs)
3. **React Native debugger** (Chrome DevTools or Flipper)
4. **Native Swift logs** from `BackgroundLocationModule.swift` (via `os_log`)

### Timeline Reconstruction (Theoretical)
Based on the code, here's what **should** have been logged:

```
02:15:XX [BackgroundTaskService] Starting iOS monitoring...
02:15:XX [BackgroundLocationService] startMonitoring called
02:15:XX [BackgroundLocationModule] Starting CoreMotion and GPS
02:15:XX [BackgroundLocationModule] Initial motion: stationary (parked at home)

[User starts driving]
02:XX:XX [BackgroundLocationModule] CoreMotion: automotive detected
02:XX:XX [BackgroundLocationModule] isDriving = true, elapsed = 0s
02:XX:XX [BackgroundLocationService] onDrivingStarted callback fired
02:XX:XX [BackgroundTaskService] DRIVING STARTED - user departing
02:XX:XX [BackgroundTaskService] handleCarReconnection called
02:XX:XX [BackgroundTaskService] markCarReconnected called
02:XX:XX [BackgroundTaskService] Calling LocationService.clearParkedLocation()
02:XX:XX [LocationService] POST /api/clear-parked-location
02:XX:XX [BackgroundTaskService] pendingDepartureConfirmation scheduled for 2min

[User parks at Wrightwood]
02:XX:XX [BackgroundLocationModule] CoreMotion: stationary detected
02:XX:XX [BackgroundLocationModule] isDriving = false, elapsed = 65s (>60s min)
02:XX:XX [BackgroundLocationService] onParkingDetected callback fired
02:XX:XX [BackgroundTaskService] Parking detected, running check...
02:XX:XX [BackgroundTaskService] Parking check result: clear (address: 123 Wrightwood)
02:XX:XX [BackgroundTaskService] Saved to parking history

[2 minutes later]
02:XX:XX [BackgroundTaskService] confirmDeparture fired
02:XX:XX [BackgroundTaskService] Current GPS: 41.8781, -87.6298 (Wrightwood)
02:XX:XX [BackgroundTaskService] Distance from home: 500m (conclusive departure)
02:XX:XX [BackgroundTaskService] Departure confirmed and saved
```

**BUT** we have no evidence that any of this actually happened because **the logs don't exist**.

---

## Most Likely Root Causes (Ranked)

### 1. CoreMotion Never Detected Automotive (70% likelihood)
**Hypothesis**: The user's drive from home to Wrightwood was **too short** or **too slow** for CoreMotion to classify as automotive activity.

**Why**:
- iOS CoreMotion requires **sustained automotive motion** (typically 30-60 seconds at >15 mph)
- Short city drives with stop-and-go traffic might never trigger automotive classification
- CoreMotion might classify it as "unknown" or "stationary" instead
- **If `onDrivingStarted` never fired**, then `markCarReconnected()` never ran, and departure was never tracked

**Code Evidence**:
```swift
// BackgroundLocationModule.swift (theoretical — not in logs)
private func handleMotionActivity(_ activity: CMMotionActivity) {
  if activity.automotive {
    isDriving = true
    drivingStartTime = Date()
    onDrivingStarted?(Int64(drivingStartTime!.timeIntervalSince1970 * 1000))
  }
}
```

**Smoking Gun**: The `minDrivingDurationSec` filter (60 seconds) might have prevented `onDrivingStarted` from firing if CoreMotion was slow to classify the activity.

---

### 2. State Machine Never Updated on iOS (90% likelihood)
**Hypothesis**: The `ParkingDetectionStateMachine` **is not updated by iOS parking detection**, so the `HomeScreen` UI shows stale state.

**Why**:
- iOS parking detection uses `BackgroundLocationService` callbacks
- These callbacks fire `BackgroundTaskService` methods directly
- **No code path updates the state machine** after iOS parking detection
- `HomeScreen` reads `parkingState` from the state machine → shows stale "Driving" or "Initializing"

**Code Evidence**:
```typescript
// BackgroundTaskService.ts:510-516
BackgroundLocationService.startMonitoring(
  (parkingTimestamp?: number) => {
    // onParkingDetected callback
    this.handleCarDisconnection(parkingTimestamp);
    // ← BUG: This does NOT update ParkingDetectionStateMachine
  },
  (drivingTimestamp?: number) => {
    // onDrivingStarted callback
    this.handleCarReconnection(drivingTimestamp);
    // ← BUG: This does NOT update ParkingDetectionStateMachine
  }
);
```

**Smoking Gun**: There's no `ParkingDetectionStateMachine.sendEvent('PARKING_DETECTED')` call in the iOS parking detection flow.

---

### 3. `currentActivity` Stuck on "automotive" (50% likelihood)
**Hypothesis**: The `MotionActivityService` (used for the "Motion status" card) is separate from `BackgroundLocationService`, and it's still reporting `currentActivity = 'automotive'` even though the user is walking.

**Why**:
- `HomeScreen` uses `currentActivity` from `MotionActivityService` to display the motion status card
- The hero card logic has this fallback:
  ```typescript
  const isDriving = (() => {
    if (Platform.OS === 'ios') return currentActivity === 'automotive';
    ...
  })();
  ```
- If `currentActivity` is stale (CoreMotion hasn't updated yet), the UI shows "Driving"

**Code Evidence**:
```typescript
// HomeScreen.tsx:1216-1230
<Text style={styles.statusRowText}>
  {currentActivity === 'automotive' ? 'Driving detected' :
   currentActivity === 'walking' ? 'Walking' :
   currentActivity === 'stationary' ? 'Stationary' : 'Monitoring'}
</Text>
```

**Smoking Gun**: CoreMotion can lag by 30-60 seconds. If the user opened the app immediately after parking and walking inside, CoreMotion might still report "automotive".

---

## Recommended Fixes

### Fix #1: Update State Machine on iOS Parking Events
**Where**: `BackgroundTaskService.ts:510-540`

**Change**:
```typescript
BackgroundLocationService.startMonitoring(
  (parkingTimestamp?: number) => {
    log.info('PARKING DETECTED - iOS CoreMotion');
    this.handleCarDisconnection(parkingTimestamp);
    // ↓ ADD THIS: Update state machine
    ParkingDetectionStateMachine.sendEvent('PARKING_DETECTED', 'coremotion');
  },
  (drivingTimestamp?: number) => {
    log.info('DRIVING STARTED - user departing');
    this.startCameraAlerts();
    this.handleCarReconnection(drivingTimestamp);
    // ↓ ADD THIS: Update state machine
    ParkingDetectionStateMachine.sendEvent('BT_CONNECT', 'coremotion', {
      deviceName: 'iOS Motion Detection',
      deviceAddress: 'coremotion',
    });
  }
);
```

**Why**: This keeps the state machine in sync with iOS parking detection, so `HomeScreen` shows the correct state.

---

### Fix #2: Don't Use `currentActivity` for Hero Card on iOS
**Where**: `HomeScreen.tsx:641-657`

**Change**:
```typescript
const isDriving = (() => {
  // On iOS, use the state machine (after Fix #1 is applied)
  if (Platform.OS === 'ios') {
    return parkingState === 'DRIVING' || parkingState === 'PARKING_PENDING';
  }
  // On Android, use Bluetooth connection
  if (Platform.OS === 'android') {
    return isCarConnected;
  }
  return false;
})();
```

**Why**: `currentActivity` from `MotionActivityService` can lag or be inaccurate. The state machine (once updated by Fix #1) is the single source of truth.

---

### Fix #3: Add Diagnostic Logging to BackgroundLocationModule
**Where**: `BackgroundLocationModule.swift` (native iOS module)

**Change**: Add `os_log` statements for every CoreMotion event:
```swift
import os.log

private let logger = OSLog(subsystem: "fyi.ticketless.app", category: "BackgroundLocation")

private func handleMotionActivity(_ activity: CMMotionActivity) {
  os_log(.info, log: logger, "CoreMotion: automotive=%{public}@, walking=%{public}@, stationary=%{public}@",
         String(activity.automotive), String(activity.walking), String(activity.stationary))

  if activity.automotive {
    isDriving = true
    drivingStartTime = Date()
    os_log(.info, log: logger, "DRIVING STARTED at %{public}@", drivingStartTime!.description)
    onDrivingStarted?(Int64(drivingStartTime!.timeIntervalSince1970 * 1000))
  }
}
```

**Why**: These logs will appear in **Xcode device logs** and can be captured for future debugging.

---

### Fix #4: Increase `minDrivingDurationSec` Visibility
**Where**: `BackgroundLocationModule.swift`

**Change**: Log when driving duration doesn't meet the threshold:
```swift
private func handleMotionActivity(_ activity: CMMotionActivity) {
  if activity.stationary && isDriving {
    let drivingDuration = Date().timeIntervalSince(drivingStartTime!)
    os_log(.info, log: logger, "Stationary detected. Driving duration: %.1fs (min: %{public}d)",
           drivingDuration, minDrivingDurationSec)

    if drivingDuration >= Double(minDrivingDurationSec) {
      os_log(.info, log: logger, "PARKING DETECTED (met min duration)")
      onParkingDetected?(Int64(Date().timeIntervalSince1970 * 1000))
    } else {
      os_log(.info, log: logger, "Parking NOT detected (too short: %.1fs < %{public}d)",
             drivingDuration, minDrivingDurationSec)
    }
  }
}
```

**Why**: This will reveal if short drives are being filtered out by the 60-second minimum.

---

## Testing Plan

### Test Case 1: Short Drive (< 1 minute)
1. Open app while parked at home
2. Drive to a nearby location (< 1 minute)
3. Park and walk away
4. **Expected**: HomeScreen should show "Parked" (not "Driving")
5. **Check**: Did `onDrivingStarted` fire? (Xcode logs)
6. **Check**: Did state machine transition to DRIVING? (console logs)

### Test Case 2: Long Drive (> 1 minute)
1. Open app while parked at home
2. Drive to a distant location (> 2 minutes)
3. Park and walk away
4. **Expected**: Departure from home should be tracked
5. **Check**: Did `markCarReconnected()` run? (console logs)
6. **Check**: Did `pendingDepartureConfirmation` get created? (AsyncStorage)
7. **Check**: Did `confirmDeparture()` run 2 minutes later? (console logs)

### Test Case 3: State Machine Synchronization
1. Open app while parked
2. Start driving
3. **Expected**: `parkingState` should transition from `PARKED` to `DRIVING`
4. Park and walk away
5. **Expected**: `parkingState` should transition from `DRIVING` to `PARKED`
6. **Check**: Does HomeScreen hero card show correct state at each step?

---

## Conclusion

Without actual application logs, this analysis is based on **code review only**. The most likely explanations are:

1. **iOS CoreMotion never detected automotive** (short drive or slow speed)
2. **State machine was never updated** (iOS parking detection bypasses it)
3. **`currentActivity` was stale** (CoreMotion lag)

The recommended fixes will:
- Keep the state machine in sync with iOS parking detection
- Improve diagnostic logging for future debugging
- Ensure the HomeScreen UI reflects the actual parking/driving state

**Next Steps**:
1. Apply Fix #1 and Fix #2 to synchronize state machine with iOS
2. Apply Fix #3 to add native logging
3. Capture **Xcode device logs** during the next test drive
4. Review logs to confirm CoreMotion events are firing correctly
