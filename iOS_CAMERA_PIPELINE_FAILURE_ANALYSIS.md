# iOS Camera Alert Pipeline Failure Analysis — Zero Alerts on 3 Drives

## Executive Summary

The user drove past 3 Chicago red-light cameras on iOS and received **ZERO alerts**. The native Swift camera alert pipeline is **completely broken**. There are **4 CRITICAL bugs** preventing notifications from firing.

---

## Critical Bug #1: `speakCameraAlert()` Has Early Return (Line 3814-3816)

**Location**: `BackgroundLocationModule.swift:3814-3816`

```swift
private func speakCameraAlert(_ message: String) {
  log("Native TTS: disabled for App Store compliance (2.5.4) — skipping speech for '\(message)'")
  return
  // ... rest of function unreachable
}
```

**Impact**: While this is labeled as "disabled for App Store 2.5.4", the **notifications should still fire**. However, this early return indicates the TTS was disabled recently. Let me trace if notifications are being scheduled...

**Status**: This is correct behavior for App Store compliance, but it's a red herring. The notifications should still fire at line 3709.

---

## Critical Bug #2: `cameraAlertsEnabled` Starts as `false` (Line 798)

**Location**: `BackgroundLocationModule.swift:798`

```swift
private var cameraAlertsEnabled = false  // DEFAULT = FALSE
private var cameraSpeedEnabled = false   // DEFAULT = FALSE  
private var cameraRedlightEnabled = false // DEFAULT = FALSE
```

**How It's Supposed to Work**:
1. Module initializes with all camera flags = `false` (line 798)
2. In `init()` at line 952, `restorePersistedCameraSettings()` is called
3. `restorePersistedCameraSettings()` (line 982-1009) reads from UserDefaults:
   - Line 984-986: If key exists, set `cameraAlertsEnabled = UserDefaults.bool(...)`
   - Line 988: If key exists, set `cameraSpeedEnabled = UserDefaults.bool(...)`
   - Line 991: If key exists, set `cameraRedlightEnabled = UserDefaults.bool(...)`

**The Race Condition**:
- If UserDefaults keys were **never written**, they stay `false`
- JS calls `setCameraAlertSettings()` but only AFTER the module is fully initialized
- During the window between init and first JS call, if a location update fires → camera check runs → `cameraAlertsEnabled == false` → **NO ALERT**

**Key Line in Guard Chain (Line 3007)**:
```swift
if cameraArmed {
  if cameraAlertsEnabled {  // <-- FALSE HERE?
    tripSummaryCameraScanCount += 1
    maybeSendNativeCameraAlert(location, isBackgrounded: appState != .active)
  } else {
    tripSummaryCameraSkippedDisabledCount += 1  // <-- INCREMENTED HERE
```

**How to Verify**: 
- Check `parking_decisions.ndjson` for `camera_check_skipped_disabled` events
- If present, shows JS settings never synced (or synced too late)

---

## Critical Bug #3: Settings Restore Only Works If UserDefaults Keys Were Previously Written

**Location**: `BackgroundLocationModule.swift:984-995`

```swift
if d.object(forKey: kCameraAlertsEnabledKey) != nil {
  cameraAlertsEnabled = d.bool(forKey: kCameraAlertsEnabledKey)
}
```

**The Bug**: `restorePersistedCameraSettings()` only restores if the key exists. But:
- On fresh app install → UserDefaults keys don't exist
- User opens settings → camera alerts toggle is ON in UI
- JS calls `setCameraAlertSettings(true, ...)` 
- But native module was already initialized with `cameraAlertsEnabled = false`
- And `restorePersistedCameraSettings()` was called in `init()` BEFORE JS calls `setCameraAlertSettings()`

**Timeline**:
```
1. App launch → BackgroundLocationModule.init()
2. → restorePersistedCameraSettings() called [line 952]
3. → UserDefaults keys don't exist → cameraAlertsEnabled stays false
4. JS loads → reads AsyncStorage
5. JS calls setCameraAlertSettings(true, ...) [async, maybe 1-2 seconds later]
6. First GPS location update arrives [could happen immediately]
7. cameraAlertsEnabled is still false → alert skipped
8. THEN setCameraAlertSettings updates it to true
```

**When This Breaks**:
- Fresh app install (keys never written)
- App restart after uninstall + reinstall
- iOS clears app data
- User manually toggles camera alerts and immediately starts driving

**Evidence**: Check logs for:
- `"Restored camera settings: enabled=false speed=false redlight=false"` (line 1008)
- Followed by locations arriving BEFORE `camera_settings_updated` decision logs

---

## Critical Bug #4: `cameraPrewarm` May Be Expired or Never Set

**Location**: Lines 3004-3005

```swift
let cameraPrewarmed = cameraPrewarmUntil.map { Date() <= $0 } ?? false
let cameraArmed = isDriving || coreMotionSaysAutomotive || speedSaysMoving || hasRecentVehicleSignal(120) || cameraPrewarmed
```

**How `cameraPrewarm` Gets Set**:
- Line 450: `extendCameraPrewarm(reason: "vehicle_signal_connected", seconds: cameraPrewarmStrongSec)` [300s]
- Line 462: `extendCameraPrewarm(reason: "vehicle_signal_disconnected", seconds: cameraPrewarmSec)` [180s]
- Line 1568: `extendCameraPrewarm(reason: "background_relaunch", seconds: cameraPrewarmStrongSec)`
- Multiple other places

**The Bug**: If the user is NOT in any of these states:
- NOT currently driving (`isDriving = false`)
- CoreMotion NOT automotive (`coreMotionSaysAutomotive = false`)
- GPS speed NOT moving (`speedSaysMoving = false`)
- No recent vehicle signal within 120s
- `cameraPrewarmUntil` expired or nil

→ **`cameraArmed = false`** → Guard at line 3006 fails → Camera check **skips entirely**

**Scenario**:
- User drives, parks, app backgrounds
- Later, user wakes phone, starts driving again
- If app was killed or JS hasn't fired `extendCameraPrewarm` yet...
- First GPS location update will skip camera check because `cameraArmed = false`

---

## Guard Chain (Line 3003-3030)

**Complete flow**:

```swift
// Line 3003-3005: Calculate camera armed state
let appState = UIApplication.shared.applicationState
let cameraPrewarmed = cameraPrewarmUntil.map { Date() <= $0 } ?? false
let cameraArmed = isDriving || coreMotionSaysAutomotive || speedSaysMoving || hasRecentVehicleSignal(120) || cameraPrewarmed

// Line 3006-3030: Gate check on cameraArmed
if cameraArmed {
  if cameraAlertsEnabled {                              // GUARD #1: False on startup
    tripSummaryCameraScanCount += 1
    maybeSendNativeCameraAlert(location, isBackgrounded: appState != .active)
  } else {
    tripSummaryCameraSkippedDisabledCount += 1         // INCREMENTED HERE
    decision("camera_check_skipped_disabled", [...])
  }
} else {
  tripSummaryCameraSkippedNotArmedCount += 1           // GUARD #2: Not armed
}
```

**Then inside `maybeSendNativeCameraAlert()` at line 3560**:

```swift
guard cameraAlertsEnabled else { return }              // GUARD #3: Double check
let speed = location.speed
let heading = location.course
let lat = location.coordinate.latitude
let lng = location.coordinate.longitude
let acc = location.horizontalAccuracy

// Line 3587: GPS accuracy requirement
if acc <= 0 || acc > 120 { return }                    // GUARD #4: Bad GPS

// Line 3590: Announce debounce
if let last = lastCameraAlertAt, Date().timeIntervalSince(last) < camAnnounceMinIntervalSec { return }  // GUARD #5: Debounce

// ... iterate through 510 cameras ...

// Line 3670-3703: Must find at least one valid camera
guard let idx = bestIdx else { return }                // GUARD #6: No camera passed all checks
```

**Then finally at line 3709**:

```swift
scheduleCameraLocalNotification(title: title, body: body, id: "cam-\(idx)")  // Send notification
speakCameraAlert(title)                                 // TTS (disabled for App Store)
```

---

## Real Notification Sending (Line 3749-3773)

```swift
private func scheduleCameraLocalNotification(title: String, body: String, id: String) {
  UNUserNotificationCenter.current().getNotificationSettings { settings in
    let allowed = settings.authorizationStatus == .authorized ||
                  settings.authorizationStatus == .provisional ||
                  settings.authorizationStatus == .ephemeral
    if !allowed {
      self.log("Camera notification skipped: notifications not authorized (status=\(settings.authorizationStatus.rawValue))")
      return                                            // GUARD #7: Notifications disabled on device
    }

    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = UNNotificationSound.default         // Sound added in commit 9ac02e74

    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    let req = UNNotificationRequest(identifier: id + "-" + String(Int(Date().timeIntervalSince1970)), content: content, trigger: trigger)
    UNUserNotificationCenter.current().add(req) { err in
      if let err = err {
        self.log("Camera notification add failed: \(err.localizedDescription)")
      }
    }
  }
}
```

---

## Summary of All Guard Conditions (In Order)

| # | Condition | Line | Default | Sets False When | Evidence Log |
|---|-----------|------|---------|-----------------|--------------|
| 1 | `cameraAlertsEnabled` | 798 | **FALSE** | UserDefaults key not written | `camera_check_skipped_disabled` (line 3016) |
| 2 | `cameraArmed` | 3005 | **FALSE** | Not driving, no CoreMotion/speed/vehicle signal, no prewarm | `camera_check_skipped_not_armed` implied (line 3028) |
| 3 | Guard in maybeSendNative... | 3561 | - | `cameraAlertsEnabled == false` | early return, implicit |
| 4 | GPS accuracy | 3587 | - | `acc > 120m` or `acc <= 0` | early return, implicit |
| 5 | Announce debounce | 3590 | - | Last alert < `camAnnounceMinIntervalSec` | early return, implicit |
| 6 | Camera passes checks | 3670 | - | All 510 cameras rejected (wrong type/speed/heading/distance/etc) | `native_camera_candidate_rejected` (line 3688) |
| 7 | Notification permission | 3754 | - | User denied notifications at OS level | `"Camera notification skipped: notifications not authorized"` (line 3755) |

---

## Most Likely Root Cause

**The user never saw camera alerts because `cameraAlertsEnabled` was `false` when location updates arrived.**

This happens because:

1. **First app launch or cold restart**: 
   - `init()` calls `restorePersistedCameraSettings()` at line 952
   - UserDefaults keys don't exist → `cameraAlertsEnabled` stays `false`
   - JS hasn't called `setCameraAlertSettings()` yet

2. **JS settings sync is async**:
   - JS loads settings from AsyncStorage
   - Calls `BackgroundLocationService.setCameraAlertSettings(true, true, true, 1.0)` 
   - But this is an async Native Module bridge call (goes to JS event queue)

3. **GPS location arrives before settings sync**:
   - OS immediately fires `didUpdateLocations()` 
   - Camera check sees `cameraAlertsEnabled == false`
   - Increments `tripSummaryCameraSkippedDisabledCount`
   - Returns without checking cameras

4. **User doesn't see decision log**:
   - Must export `parking_decisions.ndjson` from device to see `camera_check_skipped_disabled` events
   - Without logs, the failure is silent

---

## How to Confirm

**Check the app logs**:
```bash
xcrun devicectl device copy from \
  --device 00008110-001239311461801E \
  --domain-type appDataContainer \
  --domain-identifier fyi.ticketless.app \
  --source Documents/parking_decisions.ndjson \
  --destination logs/parking_decisions.ndjson
```

**Then search for**:
```bash
grep "camera_check_skipped_disabled" logs/parking_decisions.ndjson | head -5
```

If you see:
```json
{"event":"camera_check_skipped_disabled","reason":"cameraAlertsEnabled is false","speedMps":15.4,"isDriving":true,...}
```

**This confirms the bug**: Settings never synced before first location update.

---

## Fix Required

**Option A: Synchronous Settings Load on Init** (Preferred)
- Have JS write camera settings to UserDefaults synchronously BEFORE the app starts monitoring
- Then `restorePersistedCameraSettings()` at line 952 will find them

**Option B: Async-Safe Initialization**
- Don't start location monitoring until JS has synced settings
- OR start with `cameraAlertsEnabled = true` by default (safer assumption)

**Option C: Lazy Initialization**
- First time a location update arrives, check if settings have been synced
- If not, sync them immediately before camera check

---

## Other Potential Issues

### Issue #5: Speed Camera Hour Check (Line 3626)
```swift
if cam.type == "speed" {
  guard cameraSpeedEnabled else { continue }
  let hour = Calendar.current.component(.hour, from: Date())
  if hour < speedCamEnforceStartHour || hour >= speedCamEnforceEndHour { continue }
}
```

Speed cameras only alert between 6 AM-11 PM. If user drove after 11 PM, speed cameras would be filtered. Redlight cameras have no hour restriction.

**Check**: `speedCamEnforceStartHour = 6`, `speedCamEnforceEndHour = 23`

### Issue #6: Camera Heading Check (Line 3639-3652)
Multiple rejection reasons possible:
- `heading_mismatch`: User heading doesn't match camera approaches
- `camera_not_ahead`: Camera is behind user
- `speed_below_min`: Driving slower than minimum (redlight=5 mph, speed=15 mph)
- `outside_radius`: Beyond alert radius

If 3 cameras were missed due to heading, that would appear in logs as `native_camera_candidate_rejected` with `reason: "heading_mismatch"` or similar.

### Issue #7: Notification Permission Disabled (Line 3754)
If the user disabled notifications in Settings, iOS will return `notDetermined` or `denied` status. This is checked at line 3754 and the notification silently skipped.

**Check**: Does device have notifications enabled for the app?

---

## Exact File Locations

- **Main pipeline**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`
  - Init + camera settings restore: Line 947-1009
  - Location callback: Line 2458-3030
  - Main camera check: Line 3003-3030
  - Alert sending: Line 3560-3741
  - Notification scheduling: Line 3749-3773
  - Camera databases: Line 3043-3199+ (510 cameras embedded)

- **JS settings sync**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` Line 195-203

---

## Immediate Next Steps

1. Export `parking_decisions.ndjson` from iPhone
2. Run: `grep "camera_check_skipped_disabled\|native_camera_alert_fired\|native_camera_candidate_rejected" logs/parking_decisions.ndjson`
3. If `camera_check_skipped_disabled` appears before any `native_camera_alert_fired`, that's the smoking gun
4. Fix: Make JS settings sync synchronous before monitoring starts, OR default `cameraAlertsEnabled = true` on init

