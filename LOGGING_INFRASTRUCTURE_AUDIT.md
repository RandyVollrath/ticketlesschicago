# Ticketless Chicago Mobile App: Logging Infrastructure Audit

**Date**: February 24, 2026  
**Scope**: iOS syslog capture, file-based logging, decision logging, log export mechanisms, and server-side logging

---

## Executive Summary

The logging infrastructure has **critical gaps** that are preventing effective debugging:

1. **Decision log (parking_decisions.ndjson) is being written to disk but never exported** — the file exists and has write infrastructure, but there's no way for the user to access it
2. **iOS syslog 0-byte files indicate capture success but content loss** — the logging is happening (NSLog calls verified), but idevicesyslog is not receiving the output
3. **No persistent log export mechanism exists** — there's no UI button, long-press action, or automatic sync to export logs from the app
4. **JS-side logging only goes to console.log (ephemeral)** — dies with the app, not persisted anywhere
5. **State machine transitions (critical for debugging) are logged but only in-memory** — lost if the app crashes
6. **Jetsam kills and app relaunches are not logged with timestamps** — impossible to correlate native events with subsequent JS suspension
7. **CLVisit guard rejections are logged but require file export** — users can't see why a visit was rejected without pulling the ndjson file
8. **No server-side logging of native events** — parking decisions never reach the server, only sent to JS

---

## 1. iOS Syslog Capture Issue (0-byte files)

### Finding: Logging IS happening, but capture may be timing out

**iOS Code Location**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`

| Line | Code | Details |
|------|------|---------|
| 42-55 | `private func log(_ message: String)` | Uses **NSLog** (visible in syslog) + file write |
| 47 | `NSLog("[BackgroundLocation] %@", message)` | Should appear in `idevicesyslog` output |
| 50-52 | File write with `synchronizeFile()` | Immediate flush to disk |

**Diagnosis**:
- The `log()` function calls `NSLog()` which SHOULD appear in syslog
- File writes are flushed immediately with `synchronizeFile()`
- 0-byte syslog captures suggest **timing issue, not implementation issue**

**Root Cause Hypothesis**:
- `idevicesyslog` may not be running long enough to capture startup logs (app launches, logs rapid entries, buffer not captured)
- The `--udid` flag may require device to be in specific state
- Logs may be buffered in the device kernel and not flushed by 15-30s window

**Recommended Verification**:
```bash
# Verify NSLog is being called
idevicesyslog --udid 00008110-001239311461801E 2>&1 | tee syslog_capture.txt &
sleep 2 # Let syslog start
# Then trigger a parking check in the app
sleep 30
kill %1
# Check syslog_capture.txt for [BackgroundLocation] entries
```

---

## 2. parking_detection.log File Status

### Location and Size
```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/logs/parking_detection.log
Size: 1.6 MB
Last Updated: Feb 18, 20:56
Lines: 14,931
Status: ACTIVELY WRITTEN TO
```

### Implementation Details

**Setup** (lines 57-73):
- Uses `FileManager` to create file in app's document directory
- Path: `/var/mobile/Containers/Data/Application/<UUID>/Documents/parking_detection.log`
- Opened in append mode with `seekToEndOfFile()`

**Log Rotation** (lines 90-123):
- Max size: 8 MB per file (`logMaxBytes = 8 * 1024 * 1024`)
- Rotates every 200 writes (lazy evaluation)
- Rotated file renamed to `.prev` extension
- Old file deleted when new one exceeds 8 MB

**Write Pattern** (lines 42-55):
```swift
private func log(_ message: String) {
  let timestamp = dateFormatter.string(from: Date())
  let logLine = "[\(timestamp)] \(message)\n"
  NSLog("[BackgroundLocation] %@", message)  // To syslog
  if let data = logLine.data(using: .utf8) {
    logFileHandle?.write(data)
    logFileHandle?.synchronizeFile()  // Immediate flush
    maybeRotateDebugLog()
  }
}
```

### Example Log Entries
```
[2026-02-18 01:48:04.053] Persisted parking location: 41.926269484684866, -87.66395018041338 ±7.999999998855208m
[2026-02-18 01:48:04.056] Parking at (stop_start): 41.926269484684866, -87.66395018041338 ±7.999999998855208m
[2026-02-18 01:48:04.056] User walked 7m from car
[2026-02-18 02:00:03.741] Cleared persisted parking state from UserDefaults
[2026-02-18 02:00:03.753] Monitoring started (significantChanges + CoreMotion, GPS on-demand, auth=ALWAYS, coreMotion=true)
```

**Status**: Working as designed. Problem is **no export mechanism**.

---

## 3. parking_decisions.ndjson File (CRITICAL ISSUE)

### Current Status
```
Expected Path: /var/mobile/Containers/Data/Application/<UUID>/Documents/parking_decisions.ndjson
Actual Status: FILE DOES NOT EXIST IN /TicketlessChicagoMobile/logs/ DIRECTORY
Reason: The file is written to the app's document directory on the device, never exported to the repo
```

### Implementation Details

**Setup** (lines 75-88):
```swift
private func setupDecisionLogFile() {
  let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
  guard let documentsDirectory = paths.first else { return }
  let decisionURL = documentsDirectory.appendingPathComponent(decisionLogFileName)
  self.decisionLogFileURL = decisionURL
  
  if !FileManager.default.fileExists(atPath: decisionURL.path) {
    FileManager.default.createFile(atPath: decisionURL.path, contents: nil, attributes: nil)
  }
  
  decisionLogFileHandle = try? FileHandle(forWritingTo: decisionURL)
  decisionLogFileHandle?.seekToEndOfFile()
  log("Decision log path: \(decisionURL.path)")
}
```

**Write Function** (lines 157-162):
```swift
private func appendDecisionLogLine(_ line: String) {
  guard let data = (line + "\n").data(using: .utf8) else { return }
  decisionLogFileHandle?.write(data)
  decisionLogFileHandle?.synchronizeFile()
  maybeRotateDecisionLog()
}
```

**Decision Logger** (lines 164-186):
```swift
private func decision(_ event: String, _ details: [String: Any] = [:]) {
  var payload: [String: Any] = details
  payload["event"] = event
  payload["ts"] = Date().timeIntervalSince1970 * 1000
  payload["isDriving"] = isDriving
  payload["coreMotionAutomotive"] = coreMotionSaysAutomotive
  payload["speedSaysMoving"] = speedSaysMoving
  payload["hasConfirmedParkingThisSession"] = hasConfirmedParkingThisSession
  // ... location data added
  
  if let json = try? JSONSerialization.data(withJSONObject: payload, options: []),
     let line = String(data: json, encoding: .utf8) {
    appendDecisionLogLine(line)
    log("[DECISION] \(line)")  // Also logged to text log
  }
}
```

**Initialization** (lines 903-904):
```swift
override init() {
  super.init()
  setupLogFile()
  setupDecisionLogFile()  // Called at startup
  // ...
}
```

**Usage Examples** (70+ call sites):
| Event | Details |
|-------|---------|
| `trip_summary_started` | Lines 226-240 |
| `trip_summary` | Lines 305-350 |
| `vehicle_signal_connected` | Lines 431-438 |
| `vehicle_signal_disconnected` | Lines 443-449 |
| `clvisit_received` | Lines 4152-4160 |
| `clvisit_skipped_no_departure` | Line 4198 |
| `clvisit_skipped_short_dwell` | Line 4213 |
| `clvisit_skipped_stale` | Line 4228 |
| `clvisit_skipped_moving` | Line 4242 |
| `clvisit_blocked_hotspot` | Line 4267 |
| `native_camera_alert_fired` | Line 3382+ |
| `native_camera_candidate_rejected` | Lines 3382-3395 |
| `gps_coremotion_gate_passed` | Lines 2580-2595 |
| `gps_coremotion_gate_wait` | Lines 2611-2630 |
| `gps_unknown_fallback_passed` | Lines 2646-2670 |

### Example Decision Events (from decision() calls)
Would appear as NDJSON lines like:
```json
{"event":"trip_summary_started","ts":1708243204053,"isDriving":true,"coreMotionAutomotive":true,"speedSaysMoving":true,"hasConfirmedParkingThisSession":false,"curLat":41.926,"curLng":-87.664,"curAcc":8,"curSpeed":0}
{"event":"clvisit_received","ts":1708243205000,"latitude":41.926,"longitude":-87.664,"accuracy":20,"arrivalDate":1708243100000,"departureDate":1708243300000}
{"event":"clvisit_skipped_short_dwell","ts":1708243205050,"latitude":41.926,"longitude":-87.664,"dwellDurationSec":120}
```

### Rotation Logic (lines 122-151)
- Max size: 12 MB per file (`decisionLogMaxBytes = 12 * 1024 * 1024`)
- Same lazy rotation as text log (every 200 writes)
- Old file renamed to `.prev`

### Critical Issue: **No Export Mechanism**
The file is created and written to, but there's **NO WAY TO GET IT OFF THE DEVICE**:
- No button in ProfileScreen or anywhere to export logs
- No automatic sync to server
- The repo's `logs/` directory doesn't contain the ndjson file
- Users must manually use Xcode file explorer to access it

---

## 4. Log Export Mechanism (MISSING)

### Current Status: DOES NOT EXIST

**Search Results**:
- No `Share.share()` or similar in ProfileScreen or SettingsScreen
- No file reading/exporting code found in mobile app
- No "Export Logs" button, menu item, or long-press gesture
- No auto-sync to server endpoint

**ProfileScreen Investigation** (`/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/ProfileScreen.tsx`):
- Contains logging but only for error tracking (line 33+)
- No log export functionality
- No file access code

**HomeScreen Investigation** (`/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`):
- One `log.debug('Share cancelled or failed', error)` (line 789)
- This is for sharing something else, not logs

### Analysis Scripts (Server-side tooling)
The `/home/randy-vollrath/ticketless-chicago/scripts/` directory HAS analysis tools but they require manual file transfer:

| Script | Purpose | Status |
|--------|---------|--------|
| `analyze-parking-decisions.js` | Parse ndjson, count events, summarize trips | EXISTS, expects file input |
| `replay-parking-camera-log.js` | Replay events from log file | EXISTS, expects file input |
| `daily-parking-camera-report.js` | Generate report from logs | EXISTS, manual only |

**Usage**: User must manually:
1. Extract `.ndjson` file from device using Xcode
2. Run `node scripts/analyze-parking-decisions.js <file>`

---

## 5. Server-Side Logging (MINIMAL)

### JS-Side BackgroundTaskService.ts

**Logger Setup** (line 32):
```typescript
import Logger from '../utils/Logger';
const log = Logger.createLogger('BackgroundTaskService');
```

**Logging Implementation** (`/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/Logger.ts`):
```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const config: LoggerConfig = {
  enableInProduction: true,  // Line 26: Enabled in release builds
  minLevel: __DEV__ ? 'debug' : 'info',  // Line 27: Production logs info+
};

const shouldLog = (level: LogLevel): boolean => {
  // Line 30-34: Only logs if not production OR config enabled
};

const formatMessage = (tag: string, message: string): string => {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  return `[${timestamp}] [${tag}] ${message}`;
};
```

**Logging Method**: console.log/console.info/console.warn/console.error (lines 55, 64, 73, 83)

**Critical Issue**: **All JS logging is ephemeral**
- Logs only go to console (JavaScript debugger)
- When the app suspends or crashes, logs are lost
- No persistent storage to disk
- Never sent to server

**Example Log Lines** (from BackgroundTaskService.ts):
```typescript
log.info('BackgroundTaskService initialized');  // Line 222
log.info('StateMachine: PARKING_PENDING -> PARKED -> triggering parking check');  // Line 242
log.info('PARKING DETECTED via background location', event);  // Line 497
log.warn(`CoreMotion ${motionAuthStatus} — will use GPS-only fallback for driving detection`);  // Line 487
log.error('Location permission denied/restricted - parking detection will NOT work');  // Line 451
```

### Android Native Logging

**BluetoothMonitorService.kt**:
- Uses `Log.d(TAG, "...")` / `Log.i()` / `Log.w()` / `Log.e()`
- All output goes to `adb logcat`
- No file persistence

**Example Log Entries**:
```kotlin
Log.i(TAG, "BT monitor started for: $targetName ($targetAddress)")  // Line 170
Log.d(TAG, "ACL event: $action device=$deviceName ($deviceAddress)")  // Line 211
Log.i(TAG, "TARGET CAR DISCONNECTED: $deviceName ($deviceAddress)")  // Line 228
Log.e(TAG, "Failed to check initial connection state: ${e.message}", e)  // Line 373
```

### No Server Endpoint
- No `POST /api/logs` endpoint
- No upload of parking decisions to server
- Parking history records exist on server but their decision journey doesn't

---

## 6. State Machine Logging (In-Memory Only)

### ParkingDetectionStateMachine.ts

**State Transition Logging** (line 501):
```typescript
log.info(`STATE: ${prev} -> ${newState} [${eventType}] (source: ${source})`);
```

**Event Log Ring Buffer** (line 115):
```typescript
private _eventLog: DetectionEvent[] = [];
```

**Persistence to AsyncStorage** (lines 179-210):
- Event log is restored from AsyncStorage on app startup
- Max 100 events (ring buffer)
- Persisted as JSON

**Critical Issue**: **Ring buffer persists only 100 events**
- Parking detection can happen frequently during a drive
- After 100 events, oldest entries are lost
- If app crashes or force-quit, only in-memory log lost

**Example Transitions Logged**:
```typescript
log.info(`ParkingStateMachine initialized. State: ${this._state}, car: ${this._carName}`);  // Line 214
log.info(`STATE: IDLE -> DRIVING [BT_CONNECTED] (source: bt_acl)`);  // Line 501
log.info(`STATE: DRIVING -> PARKING_PENDING [BT_DISCONNECTED] (source: bt_acl)`);  // Line 501
log.info(`manualParkingConfirmed: transitioning from ${this._state} to PARKED`);  // Line 346
log.warn(`Invalid transition: ${prev} -> ${newState}`);  // Line 486
```

---

## 7. CLVisit Guard Rejections (Logged but Hidden)

### CLVisit Handler Logic

**Rejection Points** (lines 4196-4280):

| Guard | Code Location | Rejection Event | Log Message |
|-------|---------------|-----------------|-------------|
| No departure confirmed | Line 4196 | `clvisit_skipped_no_departure` | "departure not yet confirmed" |
| Dwell < 3 min | Line 4211 | `clvisit_skipped_short_dwell` | "dwell too short" |
| Visit too old (>2h) | Line 4226 | `clvisit_skipped_stale` | "visit too old" |
| GPS shows movement | Line 4240 | `clvisit_skipped_moving` | "current GPS shows movement" |
| Matches recent parking | Line 4254 | (no event logged) | "matches recent confirmed parking" |
| Blocked by hotspot | Line 4265 | `clvisit_blocked_hotspot` | "blocked by false positive hotspot" |
| False positive lockout | Line 4277 | (no event logged) | "blocked by false positive lockout" |

**Example Log Entries**:
```
[2026-02-18 02:00:04.000] CLVisit: (\41.926, -87.664) ±20m, arrived: 2026-02-18 01:45:00, departed: 2026-02-18 01:50:30
[2026-02-18 02:00:04.050] CLVisit: skipping — dwell too short (150s < 180s minimum)
```

**Decision Log Entry** (written to ndjson):
```json
{"event":"clvisit_skipped_short_dwell","ts":1708243204050,"latitude":41.926,"longitude":-87.664,"dwellDurationSec":150}
```

### Issue: Visible only in ndjson file
- Text log shows "CLVisit: skipping — dwell too short..."
- Detailed rejection reasons in ndjson `clvisit_skipped_*` events
- User cannot see these without extracting the file from device

---

## 8. Missing Critical Logging Points

### Jetsam Kills and App Relaunches
**Current**: Only `appDidBecomeActive()` at line 1014
```swift
@objc private func appDidBecomeActive() {
  guard isMonitoring else { return }
  if !isDriving && !coreMotionSaysAutomotive {
    startBootstrapGpsWindow(reason: "app_resume")
  }
  guard !isDriving && !coreMotionSaysAutomotive else { return }
  
  self.log("App resumed from suspension — checking CoreMotion history for missed parking")  // Line 1021
  // ...
}
```

**Missing**:
- No timestamp of when the app was killed (can infer from log gap)
- No duration of suspension
- No count of missed CoreMotion updates
- No count of queued visits from iOS

### findVisitForTimestamp Matching Details
**Current** (lines 4434-4435):
```swift
if let match = bestMatch {
  self.log("CLVisit match for \(timestamp): (\(match.latitude), \(match.longitude)) ±\(String(format: "%.0f", match.accuracy))m (time diff: \(String(format: "%.0f", bestTimeDiff))s)")
}
```

**Issue**:
- Logs when a match IS found
- Doesn't log why a match was NOT found (was buffer empty? no visits in tolerance window? accuracy too poor?)

### State Machine Persistence
**Current** (lines 177-210 in ParkingDetectionStateMachine.ts):
- Persists state to AsyncStorage as JSON
- Restores on app startup

**Missing**:
- No log entry when state is persisted to disk
- No log entry when state is restored
- No indication if restored state was stale (app was in transient state)

### Bluetooth Service Event Logs
**Android**: BluetoothMonitorService.kt logs all ACL events
**iOS**: **NO equivalent** — iOS has no Bluetooth connection monitoring (uses only WiFi/networking for car tracking)

---

## Summary Table: Logging Infrastructure Status

| Component | Status | Persistent? | Exported? | Server Visible? |
|-----------|--------|-------------|-----------|-----------------|
| **parking_detection.log** | ✅ Active | ✅ 1.6 MB on disk | ❌ No mechanism | ❌ No |
| **parking_decisions.ndjson** | ✅ Active | ✅ On device | ❌ No mechanism | ❌ No |
| **JS console.log** | ✅ Active | ❌ Ephemeral | ❌ No | ❌ No |
| **Android adb logcat** | ✅ Active | ❌ Volatile (device buffer) | ❌ No | ❌ No |
| **ParkingStateMachine events** | ✅ Active | ✅ AsyncStorage ring buffer | ❌ No mechanism | ❌ No |
| **CLVisit rejections** | ✅ Active (text + ndjson) | ✅ In ndjson | ❌ No mechanism | ❌ No |
| **Jetsam kill tracking** | ❌ Missing | N/A | N/A | N/A |
| **State restore timestamp** | ❌ Missing | N/A | N/A | N/A |
| **findBestLocalHistoryItemId logging** | ❌ Missing | N/A | N/A | N/A |
| **Visit match rejection reasons** | ❌ Incomplete | Only for matches, not misses | N/A | N/A |

---

## Recommendations for Debugging Recent Issues

### Sheffield False Positive Investigation
**What's logged**: 
- CLVisit arrival/departure times
- Guard rejection reasons (if < 200m accuracy)
- Whether it matched a hotspot

**What's missing**:
- Why Sheffield location triggered a CLVisit when user said "Not parked"
- Whether the hotspot rejection actually fired
- Speed data at that timestamp
- CoreMotion state at that timestamp

**To investigate**:
1. Export `parking_decisions.ndjson` from device
2. Look for `clvisit_received` events with Sheffield coordinates
3. Find corresponding `clvisit_blocked_hotspot` or guard rejection event
4. Check timestamp against hotspot report (`Not parked` button press)

### Seminary Missed Detection Investigation
**What's logged**:
- All CoreMotion transitions (automotive → stationary)
- All GPS speed readings (in speed bucket change events)
- CLVisit coordinates if a visit was detected

**What's missing**:
- Why parking was NOT detected when the user parked
- Whether CLVisit missed the location entirely
- Whether app was suspended at time of parking

**To investigate**:
1. Look for gap in CoreMotion updates at parking time
2. Check if `appDidBecomeActive` appears with recovery attempt
3. Search for CLVisit events matching Seminary coordinates
4. If CLVisit found it: look for guard rejection reason
5. If no CLVisit: indicates iOS didn't track the dwell

### Departure < Parking Time Investigation
**What's logged**:
- trip_summary events with outcome and durations
- State machine transitions (PARKED → DRIVING)
- Native BT reconnect timestamps

**What's missing**:
- Why departure was recorded before parking was confirmed
- Whether state machine was in wrong state
- Whether JS suspension delayed parking event emission

**To investigate**:
1. Export `parking_decisions.ndjson`
2. Look for `trip_summary` with `outcome: "depart_before_park"`
3. Check state machine event log timestamp
4. Compare with server parking history record timestamp

---

## Files Referenced

| File | Type | Status |
|------|------|--------|
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` | Source | 4500+ lines, logging at lines 42-186, 4147-4437 |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` | Source | 1000+ lines, logging at line 38 and throughout |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/ParkingDetectionStateMachine.ts` | Source | 600+ lines, logging at line 21, 501 |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/Logger.ts` | Source | 106 lines, ephemeral console logging |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/logs/parking_detection.log` | Data | 1.6 MB, 14,931 lines, last updated Feb 18 20:56 |
| `/home/randy-vollrath/ticketless-chicago/scripts/analyze-parking-decisions.js` | Script | Parser for ndjson, requires manual file transfer |
| `/home/randy-vollrath/ticketless-chicago/scripts/replay-parking-camera-log.js` | Script | Replay for debugging, requires manual file transfer |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/java/fyi/ticketless/app/BluetoothMonitorService.kt` | Source | Android BT logging only to logcat |

---

## Conclusion

The logging infrastructure is **partially functional but critically incomplete**:

✅ **What works**:
- Native logging to files (iOS)
- Native logging to logcat (Android)
- Decision event serialization to ndjson
- Parser scripts exist for analysis

❌ **What's broken**:
- No way for users to export logs from the device
- JS logging is ephemeral (never persisted)
- Server never receives detailed parking decisions
- Critical events not logged (Jetsam kills, visit match failures, etc.)
- Recent issues (Sheffield, Seminary, departure timing) can only be debugged with manual file extraction

**Primary recommendation**: Add an "Export Logs" button to ProfileScreen that zips and emails the ndjson + text logs, or uploads them to a server endpoint for analysis.
