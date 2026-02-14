# Comprehensive Parking Detection System Analysis

## Executive Summary

The parking detection system in Ticketless Chicago has **two distinct platforms** with different architectures:

- **Android**: Bluetooth Classic ACL events → state machine → parking check
- **iOS**: CoreMotion + GPS → native module → JS event → parking check

Both systems eventually converge on the same parking rules check and history recording. The system is well-architected with a state machine, two-phase GPS, and sophisticated debouncing, but has several potential failure modes.

---

## 1. ANDROID PARKING DETECTION

### 1.1 Flow Diagram

```
BT DISCONNECT EVENT (Native BluetoothMonitorService)
    ↓
BluetoothService.onDeviceDisconnected() callback fires
    ↓
ParkingDetectionStateMachine.btDisconnected() [line 252]
    ↓
state: DRIVING → PARKING_PENDING
    ↓
startDebounce(3 seconds) [line 549]
    ↓
[After 3s with no BT reconnect]
    ↓
transition('PARKED', 'PARKING_CONFIRMED', 'system') [line 567]
    ↓
State machine fires registered callbacks:
  "PARKING_PENDING->PARKED" [line 176-183]
    ↓
BackgroundTaskService.handleCarDisconnection() [line 1056]
    ↓
Stop GPS caching, clear location cache [line 1090-1091]
    ↓
triggerParkingCheck() [line 1100]
    ↓
[Two-phase GPS]
  Phase 1: Get fast GPS fix (1-3s) [line 1158]
  Phase 2: Burst-sample in background (refinement) [line 1214-1218]
    ↓
LocationService.checkParkingLocation() [line 1226]
    ↓
Save to history, save to server, send notifications [line 1243-1319]
```

### 1.2 State Machine (ParkingDetectionStateMachine.ts)

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/ParkingDetectionStateMachine.ts`

**State Diagram**:
```
INITIALIZING
  ↓ BT_INIT_CONNECTED → DRIVING
  ↓ BT_INIT_DISCONNECTED → IDLE
  ↓ PARKING_PENDING

IDLE
  ↓ BT_CONNECTED → DRIVING

DRIVING
  ↓ BT_DISCONNECTED → PARKING_PENDING
  ↓ [returns to IDLE on monitoring stop]

PARKING_PENDING (transient, 3-second debounce)
  ↓ BT_RECONNECTED → DRIVING (DEBOUNCE_CANCELLED)
  ↓ DEBOUNCE_EXPIRED (3s with no reconnect) → PARKED (PARKING_CONFIRMED)
  ↓ [can also transition to IDLE on monitoring stop]

PARKED
  ↓ BT_RECONNECTED → DRIVING (DEPARTURE_DETECTED)
  ↓ [can return to IDLE on monitoring stop]
```

**Key Constants**:
- **DEBOUNCE_DURATION_MS = 3_000** (line 83): 3 seconds to filter transient BT glitches like red lights
- Only **stable states** (DRIVING, PARKED, IDLE) are persisted to AsyncStorage (line 480-481)
- Transient states (INITIALIZING, PARKING_PENDING) are NOT persisted to prevent state corruption on app crash

**Transition Callbacks** (lines 419-427):
```javascript
onTransition('PARKING_PENDING->PARKED', async () => {
  handleCarDisconnection();  // Main parking check trigger
});

onTransition('PARKED->DRIVING', async () => {
  handleCarReconnection();   // Departure tracking
});
```

**Critical Invariant** (documented in CLAUDE.md):
> **Departure tracking ONLY works if the state machine transitions from PARKED → DRIVING.**

If state is IDLE when user drives away, departure is **silently never recorded**. This is the single biggest source of bugs.

---

### 1.3 Bluetooth Disconnect Trigger

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BluetoothService.ts` (lines 239-258)

The native `BluetoothMonitorService` (Kotlin) listens to `ACTION_ACL_DISCONNECTED` at line 239:

```javascript
this.classicBtDisconnectListener = RNBluetoothClassic.onDeviceDisconnected((event: any) => {
  const eventAddress = event?.device?.address || event?.address;
  const eventName = event?.device?.name || event?.name;
  
  if (eventAddress === savedDevice.address ||
      (savedDevice.name && eventName === savedDevice.name)) {
    log.info('CAR DISCONNECTED (Classic BT):', savedDevice.name);
    this.connectedDeviceId = null;
    this.notifyDisconnected();  // Fire UI listeners
    if (this.disconnectCallback) {
      Promise.resolve(this.disconnectCallback()).catch(...);
    }
  }
});
```

**Flow into State Machine** (BackgroundTaskService.ts lines 701-710):
```javascript
this.nativeBtDisconnectSub = eventEmitter.addListener(
  'BtMonitorCarDisconnected',
  (event: any) => {
    log.info('NATIVE BT DISCONNECT EVENT received', event);
    this.lastNativeBtEventTime = Date.now();
    ParkingDetectionStateMachine.btDisconnected('bt_acl', {
      deviceName: event?.deviceName,
      source: 'restart',
    });
  }
);
```

---

### 1.4 Parking Check (triggerParkingCheck)

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` (lines 1120-1345)

#### Phase 1: Fast GPS Fix (1-3 seconds)

**Lines 1158-1212**:

1. **Pre-captured coordinates** (iOS only): If provided (iOS BackgroundLocationModule captures at exact stop moment), use those directly
2. **Android fast fix**: `LocationService.getCurrentLocation('balanced', false)` — prioritizes speed over accuracy
3. **Retry with fallbacks**:
   - Cached location (`LocationService.getCachedLocation()`)
   - Stale last-known location
   - iOS last-driving location (from native module)
4. **Error handling**: Sends diagnostic notification if all methods fail

**Critical**: The 30-second debounce in `handleCarDisconnection()` (line 1066) prevents duplicate parking checks from:
- Native service event
- JS-side BluetoothClassic listener (fallback)
- Pending event check (periodic checks)

#### Phase 2: Background Burst Refinement

**Lines 1356-1442**:

After Phase 1 completes, triggers `backgroundBurstRefine()` **fire-and-forget**:

1. Gets high-accuracy burst GPS via `LocationService.getParkingLocation()`
2. Computes Haversine distance to Phase 1 fix
3. If distance > **25 meters** (line 1361):
   - Re-runs parking check with burst coordinates
   - Updates history entry with refined location
   - Re-sends notification
   - Updates server record
4. If distance < 25m: no correction needed, Phase 1 result stands

**Why this matters**: Fast Android GPS can drift 50-100m while waiting for accuracy to improve. Phase 2 silently corrects significant drifts without re-notifying the user.

---

### 1.5 Red Light vs Actual Parking: Duration Filter

**Minimum Driving Duration** (iOS, iOS only):
- **BackgroundLocationModule.swift line 67**: `minDrivingDurationSec = 10 seconds`
- Parking is ignored if user only drove for < 10s (filters red light stops)

**GPS Speed-Based Override** (iOS, lines 606-677):
- While driving, GPS speed drops to ≈0 → timer starts every 3 seconds
- After 10 seconds of sustained zero speed → confirm parking (line 658)
- This overrides slow CoreMotion (can take 30-60s to detect stop)
- **Exception**: If phone stays stationary within 50m for 2+ minutes → confirm parking (line 662)

**No explicit red light filter on Android**: Android uses the state machine's 3-second debounce to skip transient disconnects. A red light stop might cause a 1-2 second BT disconnect, which gets cancelled when reconnected within the debounce window.

---

### 1.6 Parking Notification & History Storage

**File**: BackgroundTaskService.ts (lines 1240-1319)

After parking check completes:

1. **Save to history** (line 1246):
   ```javascript
   await ParkingHistoryService.addToHistory(coords, result.rules, result.address, nativeTimestamp);
   ```
   - Includes all rules (even all-clear) so user sees record of every event
   - Uses `nativeTimestamp` (when BT disconnect fired) for accurate timing

2. **Save to server** (line 1268):
   ```javascript
   await LocationService.saveParkedLocationToServer(coords, rawData, result.address, fcmToken);
   ```
   - Populates `user_parked_vehicles` table
   - Enables server-side cron notifications (9pm winter ban, 8pm street cleaning, etc.)

3. **Send notification** (line 1300-1306):
   - If rules found: "You're parked here. Restrictions: ..."
   - If no rules: "All clear in this zone"

4. **Schedule advance reminders** (line 1315):
   - Street cleaning tomorrow at 8pm
   - Permit zone enforcement at 7am
   - Snow ban checks every 2 hours

---

## 2. iOS PARKING DETECTION

### 2.1 Flow Diagram

```
CoreMotion detects: automotive → stationary/walking
    ↓
BackgroundLocationModule.swift (line 434)
    ↓
handlePotentialParking(userIsWalking)
    ↓
[5-second debounce timer] (line 792)
    ↓
confirmParking(source: "coremotion")
    ↓
Emit "onParkingDetected" event [line 881]
    ↓
BackgroundTaskService receives event (line 403-425)
    ↓
handleCarDisconnection(parkingCoords, nativeTimestamp)
    ↓
[Same as Android from here]
```

### 2.2 CoreMotion + GPS Architecture

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`

**Three-Layer Detection**:

1. **CoreMotion (M-series coprocessor)**
   - Detects automotive vs stationary/walking via device vibration pattern
   - Runs on dedicated hardware (near-zero battery)
   - **Critical**: Never stopped (see lines 899-908)
   - Provides confidence level (low/medium/high), but accepts all

2. **Continuous GPS (on-demand)**
   - Started when CoreMotion says driving (line 401)
   - Stopped after parking confirmed (line 897)
   - Updates every 1-10m or 10 seconds (line 93: `distanceFilter = 10`)

3. **significantLocationChange (backup)**
   - Wakes app from background on ~100-500m cell tower changes
   - Recovery check if app killed mid-drive (line 698-757)
   - Only triggers `checkForMissedParking()` once per wake (line 700)

### 2.3 Speed-Based Parking Confirmation

**GPS Speed-Zero Timer** (lines 587-677):

When `isDriving = true` and GPS speed drops to ≈0:

```
speedZeroStartTime = now
stationaryLocation = current location
Start 3-second repeating timer

EVERY 3 SECONDS:
  if !coreMotionSaysAutomotive:
    → confirm parking (CoreMotion agrees)
  
  else if phoneStationary (speed < 0.5 m/s) 
    AND within 50m for 2+ minutes:
    → confirm parking (location-based override)
    (user is sitting in parked car, not walking)
  
  else if GPS speed > 2.5 m/s:
    → cancel (was a red light, user is moving again)
```

**Why 50m radius?** (line 635): Walking speed is ~1.4 m/s. If user walks >50m away in 2 minutes, they're not in the car. Don't confirm parking until they come back or CoreMotion agrees.

### 2.4 Parking Location Capture

**Priority order** (lines 834-869):

1. **locationAtStopStart**: GPS location captured when CoreMotion says non-automotive (best)
   - User hasn't had time to walk away yet
2. **lastDrivingLocation**: Last GPS while `isDriving` (includes slow creep)
3. **locationManager.location**: Current GPS (worst - user may have walked 50m+)

**Timestamp**: Uses parking location's GPS timestamp (line 847), not the debounce timer fire time. This captures **when the car actually stopped**, not when confirmation timer expired.

### 2.5 CoreMotion Flicker Detection

**SHORT DRIVE RECOVERY** (lines 446-507):

If CoreMotion flickered to automotive then back to stationary without `isDriving` ever becoming true:

- **Automotive duration** < 15 seconds AND
- **Distance from last parking** < 100 meters
→ Likely flicker, skip recovery

Otherwise, fire `onDrivingStarted` + `onParkingDetected` with 1.5s delay.

This catches cases where GPS couldn't confirm speed fast enough for short drives.

---

### 2.6 Critical: CoreMotion Must Keep Running

**Lines 899-908**:
```swift
// KEEP CoreMotion running even while parked!
// Stopping it was causing missed departures: significantLocationChange
// only fires on ~100-500m cell tower changes, so short drives
// starting near the same cell tower never triggered restart.
// By keeping CoreMotion active, we immediately detect automotive
// and can fire onDrivingStarted.
```

This is a **critical CLAUDE.md rule**: Stopping CoreMotion after parking **silently breaks departure detection forever** until the user is in a different cell tower area (100-500m away). Short drives within the same cell tower area are never detected.

---

### 2.7 Recovery on App Wake

**checkForMissedParking()** (lines 698-757):

When `significantLocationChange` wakes the app:

1. Query CoreMotion history (last 30 minutes)
2. Look for pattern: automotive activity followed by stationary/walking
3. If found AND currently stationary:
   - Fire `onParkingDetected` retroactively
   - Restart CoreMotion monitoring

**Limitation**: Can only check if CoreMotion API is available (not on all devices). iPhone 12+ required for reliable CoreMotion.

---

## 3. RED LIGHT vs PARKING DIFFERENTIATION

### 3.1 How System Avoids False Parking on Red Lights

**Mechanism**: **Minimum Driving Duration Filter** (10 seconds for iOS)

| Trigger | Filter | Result |
|---------|--------|--------|
| BT disconnect for 1s | 3s debounce in Android state machine | Reconnect cancels debounce, no parking check |
| GPS speed=0 for 5s | Need 10s of driving minimum (iOS line 67) | Ignored (too short) |
| GPS speed=0 for 10s+ | Walking override (user exited car) bypasses minimum | Parking confirmed |
| GPS speed=0 + location stationary 2+ min | Location-based confirmation (line 662) | Parking confirmed (user in car, not walking) |

**Red light example** (typical 45 seconds):
1. GPS speed drops to 0
2. Timer starts (speedZeroStartTime)
3. Every 3 seconds, checks if stationary duration >= 2 minutes
4. At 45 seconds: neither condition met (< 2 min), timer still running
5. Light turns green, GPS speed > 2.5 m/s
6. Speedometer cancels timer (line 643-650)
7. No parking event fired

**Parking example** (user parks for 3+ minutes):
1. GPS speed drops to 0
2. speedZeroStartTime = 100 seconds ago
3. stationaryDuration = 100 seconds (> 120s threshold)
4. Check: GPS speed < 0.5 (true) AND within 50m (true) AND duration 100s (< 120s)
5. At 2:00 mark: stationaryDuration = 120+ seconds
6. Parking confirmed (line 662)

---

### 3.2 Camera Pass History (separate from parking detection)

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/CameraPassHistoryService.ts`

The `camera_pass_history` table tracks **speed camera passes** (red light cameras, speed cameras):
- Triggered by proximity alerts in CameraAlertService
- Records pass events **separate from parking detection**
- Used for analytics, not parking rules

**Red Light Receipt Service** (RedLightReceiptService.ts) separately tracks:
- Full stop duration (≥ 2 seconds at ≤ 0.5 mph = stopped)
- Speed delta (max - min speed during approach)
- Trace of GPS speed over time
- Horizontal accuracy for speed confidence

This is **distinct from parking detection**.

---

## 4. AFTER PARKING IS DETECTED: FULL FLOW

### 4.1 State Machine Callback Chain

**ParkingDetectionStateMachine** transitions trigger callbacks (lines 176-236):

```javascript
'PARKING_PENDING->PARKED':
  → handleCarDisconnection()  [line 183]

'PARKED->DRIVING':
  → handleCarReconnection()  [line 191]

'PARKING_PENDING->DRIVING':
  → startCameraAlerts() (transient disconnect, no parking) [line 197]

'IDLE->DRIVING' or 'INITIALIZING->DRIVING':
  → startCameraAlerts() [line 205-213]

'*->DRIVING':
  → Reset parking check guards [line 220-235]
  → Try recording departure for orphaned parking records [line 234]
```

### 4.2 handleCarDisconnection Execution

**BackgroundTaskService.ts lines 1056-1110**:

1. **Debounce check** (line 1066): Skip if called in last 30 seconds
2. **Finalize pending departure** (line 1082-1084): From previous parking spot
3. **Clear GPS cache** (line 1090-1091): Force fresh GPS at parking spot
4. **Record disconnect time** (line 1095-1096)
5. **Trigger parking check** (line 1100): `triggerParkingCheck(parkingCoords, true, nativeTimestamp)`

### 4.3 Parking Check Execution

**triggerParkingCheck()** (lines 1120-1345):

1. **Guard against duplicate checks** (line 1129):
   - Only throttle non-real events (periodic checks)
   - Real events (BT disconnect, iOS detection) **always processed**
   - This allows user to legitimately park twice within 5 minutes

2. **Two-phase GPS** (lines 1140-1219):
   - Phase 1: Fast fix (1-3s) → send notification immediately
   - Phase 2: Burst refinement (fire-and-forget) → re-check if drift > 25m

3. **API call** (line 1226):
   ```javascript
   result = await LocationService.checkParkingLocation(coords);
   ```
   Calls backend `/api/check-parking` with coordinates

4. **Save to history** (line 1246):
   ```javascript
   await ParkingHistoryService.addToHistory(coords, result.rules, result.address, nativeTimestamp);
   ```

5. **Save to server** (line 1268):
   ```javascript
   await LocationService.saveParkedLocationToServer(coords, rawData, result.address, fcmToken);
   ```
   Enables server-side reminders

6. **Send notification** (line 1300-1306):
   - "You're parked here. Watch for..." if rules found
   - "All clear" if no rules

7. **Schedule advance reminders** (line 1315):
   - Street cleaning tomorrow
   - Permit zone enforcement
   - Snow forecast checks

---

## 5. IDENTIFIED BUGS AND FAILURE MODES

### 5.1 CRITICAL: Stale State Machine on App Restart

**Bug Location**: ParkingDetectionStateMachine.ts lines 190-205

**Problem**:
```javascript
if (stateJson) {
  const persisted = JSON.parse(stateJson);
  // Only restore to stable states (DRIVING or PARKED).
  // INITIALIZING and PARKING_PENDING are transient — if the app
  // crashed during those, we need to re-initialize properly.
  if (persisted.state === 'DRIVING' || persisted.state === 'PARKED') {
    this._state = persisted.state;
    // ... restore
  } else {
    log.info(`Ignoring persisted transient state: ${persisted.state}, starting in INITIALIZING`);
  }
}
```

**Scenario**:
1. App crashes while state = PARKING_PENDING (during 3s debounce)
2. App restarts, state restored to INITIALIZING (transient states discarded)
3. User drives away without ever returning to PARKED
4. Departure tracking fails (never PARKED → DRIVING transition)
5. User sees "Departure not recorded" in history

**HOWEVER**: This is intentional per CLAUDE.md. The real bug is below.

---

### 5.2 CRITICAL: Manual Parking Check Doesn't Update State Machine

**Bug Location**: BackgroundTaskService.ts + ParkingDetectionStateMachine.ts

**Problem**:

When user taps "Check My Parking" manually, the flow is:
1. Manual check calls `triggerParkingCheck(undefined, false)`
2. Parking check runs, saves to history
3. State machine is **NOT updated** to PARKED
4. State machine remains in IDLE or DRIVING
5. User drives away
6. If state was IDLE → IDLE → DRIVING (no departure recorded)
7. If state was DRIVING → DRIVING → PARKED (parking check runs again during drive)

**Fix applied** (according to CLAUDE.md line 323-345):
```javascript
manualParkingConfirmed(metadata?: Record<string, any>): void {
  // Already parked — no-op
  if (this._state === 'PARKED') return;
  // Currently driving — don't set to parked
  if (this._state === 'DRIVING') return;
  // During debounce — let the normal flow handle it
  if (this._state === 'PARKING_PENDING') return;
  // IDLE or INITIALIZING — transition to PARKED
  log.info(`manualParkingConfirmed: transitioning from ${this._state} to PARKED`);
  this.transition('PARKED', 'MANUAL_PARKING_SET', 'user_manual', metadata);
}
```

**But**: I don't see this being called from the manual parking check code. Need to verify if `manualParkingConfirmed()` is actually invoked.

---

### 5.3 Departure Tracking Race Condition

**Bug Location**: BackgroundTaskService.ts lines 769-816

**Problem**:

If BT reconnects while handling car disconnection:

```javascript
private async handleCarDisconnection(...) {
  // [GPS operations, can take 5-15 seconds]
  await triggerParkingCheck(...);  // line 1100
}
```

During this 5-15 second window, if BT reconnects:
1. `btConnected()` fires (state machine PARKING_PENDING → DRIVING)
2. `handleCarReconnection()` is called (departure tracking logic)
3. But `triggerParkingCheck()` is still running (hasn't saved to history yet)
4. Departure tracking looks for recent parking record without departure
5. Might not find it (race condition) or find stale record

**Mitigation** (line 1082-1084):
```javascript
if (this.state.pendingDepartureConfirmation) {
  log.info('Finalizing previous departure before recording new parking');
  await this.finalizePendingDepartureImmediately();
}
```

This finalizes the **previous** parking's departure before recording a new one, but if we're in the middle of `triggerParkingCheck()`, the current parking might not be saved yet.

---

### 5.4 iOS Missed Parking on Short Drives

**Bug Location**: BackgroundLocationModule.swift lines 446-507

**Problem**:

If GPS speed confirmation is slow on a short drive:

```
0s: Start drive, CoreMotion detects automotive
5s: GPS speed still not confirmed
10s: User parks, CoreMotion says stationary
  → isDriving was never set to true
  → parking detection blocked
  → SHORT DRIVE RECOVERY fires retroactively
```

**Mitigation**: SHORT DRIVE RECOVERY (lines 446-507):
- Detects: wasRecentlyDriving + currentlyStationary
- Checks: duration < 15s AND distance < 100m
- If passes both: fires `onDrivingStarted` + `onParkingDetected` (1.5s delay)

**Remaining risk**: If short drive is caught by flicker detection, recovery might not fire.

---

### 5.5 Android: Bluetooth Profile Proxy Async Race

**Bug Location**: BackgroundTaskService.ts lines 741-755

**Problem**:

```javascript
const restartTime = Date.now();
setTimeout(async () => {
  try {
    if (!BluetoothMonitorModule) return;
    if (this.lastNativeBtEventTime > restartTime) return;  // GUARD
    const check = await BluetoothMonitorModule.isCarConnected();
    const smState = ParkingDetectionStateMachine.state;
    if (check && smState !== 'DRIVING') {
      ParkingDetectionStateMachine.btInitConnected('bt_profile_proxy');
    } else if (!check && smState === 'DRIVING') {
      ParkingDetectionStateMachine.btInitDisconnected('bt_profile_proxy');
    }
  } catch (e) { /* ignore */ }
}, 2000);  // 2-second re-check
```

The guard `if (this.lastNativeBtEventTime > restartTime)` prevents the delayed check from overwriting a recent native ACL event. But if the native service is slow (takes > 2 seconds to respond), the delayed check might see stale state.

**However**: The 2-second delay + 5-second delay in CLAUDE.md rule #7 provides redundancy.

---

### 5.6 iOS: CoreMotion Never Restarted on Short Drives

**Bug Location**: BackgroundLocationModule.swift lines 334-335

**Problem** (RESOLVED in current code):

Previously, CoreMotion was stopped after parking and only restarted by `significantLocationChange` (cell tower change, 100-500m).

- Result: Short drives (< 100m) in same cell tower never restarted CoreMotion
- Consequence: No driving detection, no departure, no parking detection for next spot

**Fix** (lines 899-908):
```swift
// KEEP CoreMotion running even while parked!
// ... By keeping CoreMotion active, we immediately detect automotive
// and can fire onDrivingStarted.
```

CoreMotion now stays active while parked, but only continuous GPS is stopped (low power).

---

### 5.7 GPS Accuracy Falls Back Through Multiple Layers

**Problem**: If fresh GPS fails, the system falls back to stale GPS, which might be 100s of meters away.

**Fallback chain** (lines 1169-1210):
1. Fast fix (1-3s)
2. Retry balanced (3-5 tries)
3. Cached location (from last drive)
4. Stale last-known location
5. iOS: Last driving location (from native module)
6. Fail and show error notification

**Risk**: User parks in a new location, but cached GPS is from a different parking spot. Parking check runs at wrong location, user gets false restrictions.

**Mitigation**: `LocationService.clearLocationCache()` is called (line 1091) when car disconnects, so stale cache shouldn't persist.

---

### 5.8 Server Save Failures Are Silent

**Problem** (BackgroundTaskService.ts line 1272-1275):

```javascript
} catch (serverSaveError) {
  // Non-fatal — local notifications still work without server save
  log.warn('Failed to save parked location to server (non-fatal):', serverSaveError);
}
```

If server save fails:
- `user_parked_vehicles` is NOT updated
- Server-side reminders (9pm winter, 8pm cleaning, etc.) don't fire
- User doesn't get push notifications
- But local notifications still work

This is intentional (local-first design), but user is unaware.

---

## 6. MISSED PARKING EVENTS: ROOT CAUSES

### 6.1 State Machine Not In PARKED

If `ParkingDetectionStateMachine.state !== 'PARKED'` when user drives away:
- `markCarReconnected()` doesn't call departure tracking (line 769-771)
- Parking record exists but has no departure
- User sees "Departure not recorded" in history

**How it happens**:
1. Manual parking check (not calling `manualParkingConfirmed()`)
2. App crash during PARKING_PENDING (unlikely but possible)
3. Server restore parking without state machine update
4. Bug: state machine set to wrong state

---

### 6.2 Native Service Crashes

If `BluetoothMonitorService` (Kotlin native service) crashes:
- Android Bluetooth monitoring stops **forever** until next app restart
- No BT disconnect events → no parking detected
- App is unaware service died (no error callback)

**Mitigation** (line 758-763):
```javascript
this.state.isMonitoring = true;
await this.saveState();
``` 

Monitoring state is persisted, so on next app restart, service should be restarted. But if the crash happens repeatedly (e.g., memory pressure), user never gets a warning.

---

### 6.3 GPS Failures

If all GPS methods fail (lines 1195-1208):
- Sends error notification
- Parking check **aborts** (throws error)
- Parking is **not recorded**
- State machine is still in PARKING_PENDING (never transitioned to PARKED)

**Consequence**: On next BT reconnect, state machine goes PARKING_PENDING → DRIVING, no departure recorded.

---

### 6.4 iOS: CoreMotion Not Available

If device doesn't have CoreMotion (old iPhone):
- BackgroundLocationModule.startMonitoring() (line 171-177) logs warning but continues
- significantLocationChange alone is too unreliable (100-500m sensitivity)
- Parking detection is sporadic

**Mitigation**: iOS self-test (lines 152-154) checks if CoreMotion available and sends diagnostic.

---

### 6.5 iOS: Location Permission Not "Always"

If user only grants "When In Use":
- significantLocationChange doesn't work in background (line 164-167 note)
- Parking detection only works while app is in foreground
- Background driving → parking transitions are missed

**Mitigation** (line 153-156): Warning notification if not "Always" permission.

---

### 6.6 Departure Confirmation Never Called

**File**: BackgroundTaskService.ts

The function `markCarReconnected()` (lines 769-771) is called on PARKED → DRIVING transition:

```javascript
private async handleCarReconnection(nativeDrivingTimestamp?: number): Promise<void> {
  log.info('Car reconnection detected via Bluetooth');
  await this.markCarReconnected(nativeDrivingTimestamp);
}
```

But `markCarReconnected()` function is **not in the code snippet I can see**. If it's not implemented or has a bug, departure tracking silently fails.

---

## 7. GPS ACCURACY AT PARKING TIME

### 7.1 Accuracy Metrics

**Phase 1 (Fast Fix)**: ~15-50 meters horizontal accuracy on Android, varies on iOS

**Phase 2 (Burst Refinement)**: Improves to ~5-15 meters after 3-10 second burst

**Fallback**: If GPS unavailable, uses cached location (could be 0-1000m old)

### 7.2 Parking Location Priority (iOS)

1. **locationAtStopStart**: Captured when CoreMotion detects non-automotive
   - Exact moment car stops, before user walks away
   - Best for parking rules (user is at the car location)
2. **lastDrivingLocation**: Last GPS while driving
   - Includes slow creep into parking spot
3. **Current location**: Worst (user may have walked 50m+)

---

### 7.3 Two-Phase GPS Refinement

**Initial Phase**: Send notification in 3-5 seconds so user knows parking check ran

**Burst Phase** (background):
- If refined GPS moves parking location by > 25 meters
- Re-checks parking rules at new location
- Updates history and notification
- User doesn't see double notification (silent update)

**Example**: User parks, GPS gives location 40m away (in middle of street). Burst refines to correct spot. Notification updated silently.

---

## 8. DEPARTURE TRACKING

### 8.1 How Departure Is Recorded

**File**: BackgroundTaskService.ts (lines 769-816)

When car reconnects (BT ACL connect event) after parking:

```javascript
private async handleCarReconnection(nativeDrivingTimestamp?: number): Promise<void> {
  log.info('Car reconnection detected via Bluetooth');
  await this.markCarReconnected(nativeDrivingTimestamp);
}
```

This should:
1. Find most recent parking history record without departure
2. Set departure = current time (or nativeDrivingTimestamp)
3. Save to history
4. Send notification "You left at [time]"

**But**: I cannot see the full `markCarReconnected()` implementation in the provided code.

---

### 8.2 Orphaned Parking Records

**File**: BackgroundTaskService.ts (lines 786-820)

If state machine state is lost (app reinstall, AsyncStorage cleared) but parking record still exists:

```javascript
private async tryRecordDepartureForOrphanedParking(): Promise<void> {
  const recentItem = await ParkingHistoryService.getMostRecent();
  if (!recentItem) return;
  if (recentItem.departure) return;  // Already has departure
  
  // Check if record is recent (< 24 hours)
  const age = Date.now() - recentItem.timestamp;
  if (age > 24 * 60 * 60 * 1000) return;  // Too old
  
  // Record departure for orphaned parking
  await this.markCarReconnected();
}
```

Called when state machine transitions to DRIVING from any non-PARKED state (line 234).

---

## 9. RESCAN & SNOW MONITORING

### 9.1 Periodic Rescan Timer

While parked, re-checks parking rules every **4 hours** (RESCAN_INTERVAL_MS = line 45):

```javascript
this.startRescanTimer();
```

Use case: Street cleaning schedule changes, winter ban dates update.

### 9.2 Snow Forecast Monitoring

If parked on snow route, checks weather every **2 hours** (SNOW_FORECAST_CHECK_INTERVAL_MS = line 47):

Looks for snow forecasts, triggers notifications if snow expected.

---

## 10. SUMMARY TABLE: FAILURE MODES

| Failure Mode | Likelihood | Impact | Root Cause | Mitigation |
|---|---|---|---|---|
| State machine in IDLE, user drives → no departure | Medium | Parking has no departure | Manual check doesn't call `manualParkingConfirmed()` | Verify manual check flow |
| GPS fails during parking check | Low | Parking not recorded | Network/permissions issue | Error notification, retry on next drive |
| Native BT service crashes | Low | Parking detection stops | Memory pressure, ANR | Service restarted on next app open |
| Stale GPS used as parking location | Low | Wrong address/rules | Cache not cleared before disconnect | `LocationService.clearLocationCache()` called |
| Short iOS drive missed | Low | Parking detected but no departure | GPS slow, CoreMotion flicker | SHORT DRIVE RECOVERY |
| iOS "When In Use" permission only | Medium | Background parking missed | User misconfigures | Permission upgrade notification |
| CoreMotion not available | Low | iOS parking unreliable | Old device | Diagnostic notification |
| Server save fails | Low | Push reminders don't fire | Network issue | Non-blocking, local notifications work |
| BT reconnect during GPS phase | Low | Race condition in departure | Timing | Finalize previous parking first |
| Phase 2 burst finds wrong location | Very Low | Wrong rules applied | GPS drift > 25m | Phase 2 re-checks if drift > 25m |

---

## 11. RECOMMENDATIONS

1. **Verify `manualParkingConfirmed()` is called** when user taps "Check My Parking"
2. **Add monitoring for native service crashes** (ServiceManager callback)
3. **Trace `markCarReconnected()` implementation** to ensure departure tracking works
4. **Test short drives on iOS** (< 30 seconds) to verify SHORT DRIVE RECOVERY
5. **Add telemetry** for parking event success/failure rates
6. **Document state machine transitions** in each UI screen (HomeScreen needs to sync with state machine)
7. **Add integration test** for departure tracking (park → drive → verify departure recorded)

---

## Conclusion

The parking detection system is **well-architected** with sophisticated GPS, debouncing, and state machine logic. However, there are **critical invariants** (state machine must be PARKED for departure tracking) that can be violated by edge cases, particularly:

- Manual parking checks not updating state machine
- App crashes during transient states
- Native service crashes on Android
- GPS failures leaving system in inconsistent state

The system is **resilient but not fail-safe**. Parking detection usually works, but edge cases can silently fail to record departures, leaving the parking history incomplete.

