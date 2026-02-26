# iOS vs Android Camera Alert Logic Comparison Guide

## Quick Reference for Cross-Platform Validation

This document provides side-by-side mapping of iOS camera alert functionality to help identify discrepancies with the Android Kotlin implementation.

### File Locations
- **iOS**: `TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` (Lines 2772-3889)
- **Android**: `TicketlessChicagoMobile/android/app/src/main/java/.../BluetoothMonitorModule.kt` (camera alert section) OR separate CameraAlertService
- **Full iOS Extract**: `iOS_CAMERA_ALERTS_COMPLETE_EXTRACT.md` (this repo)

---

## 1. Camera Definition Structure

### iOS
```swift
private struct NativeCameraDef {
  let type: String   // "speed" | "redlight"
  let address: String
  let lat: Double
  let lng: Double
  let approaches: [String]  // ["NB", "WB", "EB", "SB"] etc
}
```

**Compare Android to:**
- Does it have `type` field (speed vs redlight)?
- Does it have `approaches` array?
- How is bearing/heading validation implemented?

---

## 2. Tuning Constants

### iOS Constants (Lines 879-905)

| Constant | Value | Purpose |
|----------|-------|---------|
| `camBaseAlertRadiusMeters` | 150m | Minimum alert radius |
| `camMaxAlertRadiusMeters` | 250m | Maximum alert radius cap |
| `camTargetWarningSec` | 10s | Lookahead time (speed × 10) |
| `camCooldownRadiusMeters` | 400m | Radius to clear per-camera dedupe |
| `camMinSpeedSpeedCamMps` | 3.2 m/s | Min speed to alert (speed camera) ~7.2 mph |
| `camMinSpeedRedlightMps` | 1.0 m/s | Min speed to alert (red-light) ~2.2 mph |
| `camAnnounceMinIntervalSec` | 5s | Global min interval ANY camera alert |
| `camAlertDedupeSec` | 180s | Per-camera cooldown (same camera won't alert for 3 min) |
| `camBBoxDegrees` | 0.0025 | Bounding box size (~280m) |
| `camHeadingToleranceDeg` | 45° | Approach direction tolerance |
| `camMaxBearingOffHeadingDeg` | 30° | Bearing-to-heading angle tolerance |
| `speedCamEnforceStartHour` | 6 | Speed cameras active 6:00 AM |
| `speedCamEnforceEndHour` | 23 | Speed cameras off at 11:00 PM |

**Action Items:**
- [ ] Find these constants in Android implementation
- [ ] Verify they match (or if different, understand why)
- [ ] Check if both implementations have the 6am-11pm schedule for speed cameras

---

## 3. GPS Accuracy Rejection (Critical Edge Case)

### iOS (Line 3307)
```swift
if acc <= 0 || acc > 120 { return }  // Reject if accuracy > 120m
```

**Meaning:** If GPS horizontal accuracy is worse than 120 meters, skip ALL camera processing this location update.

**Compare Android:**
- What accuracy threshold does it use?
- Does it reject entirely or alert with degraded confidence?
- Is this the source of "false alerts from cell-tower GPS"?

---

## 4. Speed-Adaptive Alert Radius

### iOS (Lines 3455-3459)
```swift
private func cameraAlertRadiusMeters(speedMps: Double) -> Double {
  if speedMps < 0 { return camBaseAlertRadiusMeters }
  let dynamic = speedMps * camTargetWarningSec  // speed × 10
  return max(camBaseAlertRadiusMeters, min(dynamic, camMaxAlertRadiusMeters))
}
```

**Examples:**
- 5 m/s (11 mph) → 50m clamped to 150m → **150m**
- 15 m/s (33 mph) → 150m → **150m**
- 20 m/s (45 mph) → 200m → **200m**
- 25 m/s (56 mph) → 250m → **250m**
- 30+ m/s (67+ mph) → clamped to 250m → **250m**

**Compare Android:**
- Does it use the same formula (speed × 10)?
- Are the min/max bounds the same (150m/250m)?

---

## 5. Camera Filtering: Type & Schedule

### iOS (Lines 3342-3348)
```swift
if cam.type == "speed" {
  guard cameraSpeedEnabled else { continue }
  let hour = Calendar.current.component(.hour, from: Date())
  if hour < speedCamEnforceStartHour || hour >= speedCamEnforceEndHour { continue }
} else {
  guard cameraRedlightEnabled else { continue }
}
```

**Behavior:**
- Speed cameras: Only alert if `cameraSpeedEnabled == true` AND time is 6am-11pm
- Red-light cameras: Always alert if `cameraRedlightEnabled == true` (no time restriction)

**Compare Android:**
- Does it have the same 6am-11pm enforcement for speed cameras?
- Is the schedule using device local time (not UTC)?
- Are red-light cameras unrestricted by time?

---

## 6. Heading & Direction Validation

### Two-Part Heading Check

#### Part 1: isHeadingMatch (Lines 3867-3889)
Validates that user heading matches ANY camera approach direction (within 45°).

```swift
let mapping: [String: Double] = [
  "NB": 0,      // North-Bound
  "NEB": 45,    // North-East-Bound
  "EB": 90,     // East-Bound
  "SEB": 135,   // South-East-Bound
  "SB": 180,    // South-Bound
  "SWB": 225,   // South-West-Bound
  "WB": 270,    // West-Bound
  "NWB": 315,   // North-West-Bound
]
```

**Example:**
- Camera approaches: `["WB"]` (270°)
- User heading: 275°
- Diff: 5° ≤ 45° → **MATCH**

- User heading: 90° (opposite direction)
- Diff: 180° → **NO MATCH**

#### Part 2: isCameraAhead (Lines 3859-3865)
Validates that camera bearing is within 30° of user heading.

```swift
let bearing = bearingTo(...)  // compass direction FROM user TO camera
var diff = abs(headingDeg - bearing)
if diff > 180 { diff = 360 - diff }  // normalize wrap-around
return diff <= camMaxBearingOffHeadingDeg  // 30° tolerance
```

**Compare Android:**
- Does it have BOTH checks?
- Are the tolerances 45° (approach) and 30° (bearing) the same?
- Does it use the same compass bearing calculation?

---

## 7. Proximity Loop & Rejection Order

### iOS (Lines 3338-3386)

The main loop filters 510 cameras with these checks in order:

```
1. Type + Schedule filters (speed/redlight, time enforcement)
2. Bounding box filter (fast pre-filter)
3. Distance calculation + Heading + Bearing checks
4. Rejection tests (in order):
   a. speed < minSpeed                   → "speed_below_min"
   b. distance > alertRadius              → "outside_radius"
   c. per-camera dedupe (< 3 min ago)    → "per_camera_dedupe"
   d. heading doesn't match approaches    → "heading_mismatch"
   e. camera not ahead (bearing > 30°)    → "camera_not_ahead"
5. Pick nearest passing camera
```

**Compare Android:**
- Does it check conditions in the same order?
- Does it pick "nearest" or use different logic?
- Are rejection reason strings identical (used in decision log)?

---

## 8. Per-Camera Dedupe Cooldown

### iOS (Line 3356)
```swift
let perCameraDeduped = alertedCameraAtByIndex[i].map { Date().timeIntervalSince($0) < camAlertDedupeSec } ?? false
```

**Behavior:**
- Track the last alert time for each camera by index
- Don't re-alert if the same camera fired within 180 seconds (3 minutes)
- When user moves > 400m away, clear that camera's cooldown

**Compare Android:**
- Does it track per-camera cooldown?
- Is it 3 minutes (same as iOS)?
- Is the cooldown cleared radius 400m?

---

## 9. Global Announcement Cooldown

### iOS (Lines 3310-3312)
```swift
if let last = lastCameraAlertAt, Date().timeIntervalSince(last) < camAnnounceMinIntervalSec {
  return
}
```

**Behavior:**
- Minimum 5 seconds between ANY camera alert (global rate limiting)
- Even if a different camera triggers, wait 5 seconds after the last alert

**Compare Android:**
- Does it have global rate limiting?
- Is it 5 seconds?

---

## 10. TTS (Text-To-Speech) Implementation

### iOS (Lines 3540-3601)

**Key Properties:**
- Uses `AVSpeechSynthesizer` (native iOS)
- Runs on BOTH foreground and background (unique to iOS)
- Speech rate: **0.52** (slightly fast but clear)
- Volume: Configurable via `cameraAlertVolume` (0-1.0)
- Audio session: `.playback` mode with `.duckOthers` (lowers music instead of pausing)

**Background Task Safety:**
```swift
backgroundSpeechTaskId = UIApplication.shared.beginBackgroundTask(withName: "CameraAlertSpeech")
// Prevents iOS from suspending process mid-speech
```

**Compare Android:**
- Does it use TTS?
- What is the speech rate?
- How does it handle background audio?
- Does it use TextToSpeech API or similar?

---

## 11. Local Notifications

### iOS (Lines 3461-3486)

**Behavior:**
- Fire local notification banner with title "Red-light camera ahead" or "Speed camera ahead"
- NO sound (TTS provides audio feedback)
- 1-second delay to avoid iOS dropping same-tick notifications

**Compare Android:**
- Does it fire local notifications?
- Does it also mute the notification sound in favor of TTS?

---

## 12. Red-Light Evidence Capture

### iOS (Lines 3632-3720)

**When Fired:**
- Only for RED-LIGHT cameras (not speed cameras)
- Triggered when camera alert fires and user is driving

**Data Captured:**
- Last 30 seconds of accelerometer trace (x, y, z, gx, gy, gz)
- Single GPS point (current location)
- Peak deceleration (G-force)
- Speed (m/s and mph)
- Camera address & coordinates
- Heading and accuracy

**Storage:**
- Stored in `UserDefaults` with key `bg_pending_redlight_evidence_v1`
- Max 20 entries (older ones dropped)
- JS retrieves via `getPendingRedLightEvidence()`
- Entries expire after 24 hours

**Compare Android:**
- Does it capture evidence for red-light cameras?
- What data is captured (accel, GPS, speed)?
- Where is it stored (SharedPreferences, database, file)?
- How does JS retrieve it?

---

## 13. Settings Configuration from JS

### iOS (Lines 967-982)

**Method:** `setCameraAlertSettings(enabled, speedEnabled, redlightEnabled, volume)`

**Parameters:**
- `enabled`: Master on/off for all camera alerts
- `speedEnabled`: Enable/disable speed camera alerts
- `redlightEnabled`: Enable/disable red-light camera alerts
- `volume`: TTS volume (0-1.0)

**Persistence:**
- Stored in UserDefaults with keys:
  - `bg_camera_alerts_enabled`
  - `bg_camera_alerts_speed_enabled`
  - `bg_camera_alerts_redlight_enabled`
  - `bg_camera_alert_volume`

**Compare Android:**
- Does it have the same 4 settings?
- How are they persisted?
- Are the setting keys the same?

---

## 14. Rejection Logging (Decision Log)

### iOS (Lines 3388-3418)

Every rejected camera candidate (within debug radius) is logged with:

```swift
decision("native_camera_candidate_rejected", [
  "idx": cameraIndex,
  "type": "speed" | "redlight",
  "address": cameraAddress,
  "reason": "speed_below_min" | "outside_radius" | "heading_mismatch" | "camera_not_ahead" | "per_camera_dedupe",
  "distanceMeters": distance,
  "alertRadiusMeters": calculatedRadius,
  "speedMps": userSpeed,
  "heading": userHeading,
  "accuracy": gpsAccuracy,
])
```

**Compare Android:**
- Does it log rejected candidates?
- Are the same rejection reason strings used?
- Can you replay decision logs to debug mismatches?

---

## 15. Alert Fired Logging

### iOS (Lines 3442-3451)

When an alert fires:

```swift
decision("native_camera_alert_fired", [
  "idx": cameraIndex,
  "type": "speed" | "redlight",
  "address": cameraAddress,
  "distanceMeters": distance,
  "alertRadiusMeters": calculatedRadius,
  "speedMps": userSpeed,
  "heading": userHeading,
  "accuracy": gpsAccuracy,
])
```

**Compare Android:**
- Does it log fired alerts?
- Are the fields identical?

---

## 16. Edge Cases & Fail-Safes

### iOS Behavior When Conditions Fail

| Condition | iOS Behavior | Compare Android |
|-----------|--------------|-----------------|
| Heading unavailable (-1) | Return true (fail-open), alert anyway | Does Android also fail-open? |
| GPS accuracy > 120m | Skip entirely, no alert | What threshold does Android use? |
| GPS speed < minSpeed | Reject with "speed_below_min" | Same behavior? |
| Notification permission denied | Skip local notification, TTS still plays | How does Android handle permission denial? |
| Audio session config fails | Log error, skip TTS | Graceful degradation in Android? |
| Approaches array empty | Return true (fail-open) | Same? |
| Unknown approach string | Return true (fail-open) | Same? |

---

## 17. Integration Points (Where Camera Logic Runs)

### iOS (Line 3301+)

**Called From:**
- `locationManager(_ manager:, didUpdateLocations:)`

**Conditions for Execution:**
- AND `isDriving == true` OR
- AND `coreMotionSaysAutomotive == true` OR
- AND `speedSaysMoving == true` OR
- AND `hasRecentVehicleSignal(120)` OR
- AND `cameraPrewarmed == true`

**Update Frequency:**
- GPS location updates: ~10-30 Hz (continuous in background)
- Runs on EVERY location update while any of above is true

**Compare Android:**
- What triggers camera alert checks?
- Is it also location-based?
- What's the update frequency?

---

## Checklist: Questions to Answer About Android

1. **Structure & Data**
   - [ ] Does Android have NativeCameraDef or equivalent with `type`, `approaches` fields?
   - [ ] How are 510 cameras stored (array, database, file)?

2. **Constants**
   - [ ] Are all tuning constants the same? (150m, 250m, 3.2 m/s, etc.)
   - [ ] Is the 6am-11pm speed camera schedule enforced?

3. **GPS Accuracy**
   - [ ] What's the accuracy threshold (iOS: 120m)?
   - [ ] Does it reject entirely or degrade gracefully?

4. **Heading Validation**
   - [ ] Are there TWO heading checks (approach + bearing)?
   - [ ] Are tolerances 45° and 30°?

5. **Filtering & Deduplication**
   - [ ] Per-camera cooldown: 3 minutes?
   - [ ] Cooldown radius: 400m?
   - [ ] Global alert cooldown: 5 seconds?

6. **TTS & Audio**
   - [ ] Does Android speak alerts in background?
   - [ ] What's the speech rate?
   - [ ] How does it handle audio permissions?

7. **Red-Light Evidence**
   - [ ] Is evidence captured only for red-light cameras?
   - [ ] What data is captured (accel, GPS, speed)?
   - [ ] How is it persisted and retrieved by JS?

8. **Settings Sync**
   - [ ] 4 settings: enabled, speedEnabled, redlightEnabled, volume?
   - [ ] How are they persisted?

9. **Logging & Debugging**
   - [ ] Are rejected cameras logged with reason strings?
   - [ ] Can decision logs be replayed?

10. **Integration**
    - [ ] When do camera checks run (location updates)?
    - [ ] What are the trigger conditions (isDriving, speed, etc.)?

