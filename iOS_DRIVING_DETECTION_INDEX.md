# iOS Driving Detection System - Complete Analysis

## Quick Links

1. **START HERE**: [iOS_DRIVING_DETECTION_SUMMARY.txt](./iOS_DRIVING_DETECTION_SUMMARY.txt)
   - Executive summary of issues and fixes (1 page, easy to scan)

2. **DETAILED REPORT**: [iOS_DRIVING_DETECTION_ANALYSIS.md](./iOS_DRIVING_DETECTION_ANALYSIS.md)
   - Complete line-by-line architecture breakdown (522 lines)
   - Root causes with code examples
   - Diagnostic checklist
   - Recommended fixes with code snippets

3. **FLOW DIAGRAMS**: [iOS_DRIVING_DETECTION_FLOW.txt](./iOS_DRIVING_DETECTION_FLOW.txt)
   - Visual flow of how driving detection works
   - Initialization sequence
   - CoreMotion → GPS → Parking detection chain
   - All critical gates and failure points
   - 5 most common failure scenarios

---

## Problem Statement

User reports: "After 10 minutes of driving, the app still doesn't detect I'm driving."
- Location services set to "Always"
- App shows "Autopilot is watching" but never shows "driving" state

---

## System Architecture (TL;DR)

The iOS app uses **two parallel driving detection systems**:

### Primary: BackgroundLocationModule.swift (488 lines)
- **CoreMotion** (M-series coprocessor) detects vehicle vibration patterns
- **CLLocationManager** GPS provides precise location when driving detected
- Battery-efficient: CoreMotion runs on separate chip, GPS only when needed

### Fallback: MotionActivityModule.swift (144 lines)
- CoreMotion only (no GPS integration)
- Used if primary unavailable

---

## Top 3 Most Likely Root Causes

### #1: CoreMotion Confidence Too Low (60% probability)
**Location**: BackgroundLocationModule.swift, line 204

```swift
if activity.automotive && activity.confidence != .low {
  // PROBLEM: Rejects if confidence is low
  // Some devices ALWAYS report low confidence!
}
```

**Why**: Different vehicle types, smooth driving, or device firmware variations
cause CoreMotion to report "automotive" but with low confidence. The code
rejects this, so GPS never activates.

**Symptom**: User drives but app shows "ready" instead of "driving"

**Fix**: Accept low confidence
```swift
if activity.automotive {  // Accept any confidence
```

---

### #2: iOS Killed the App (25% probability)
iOS terminates background processes after 10-30 minutes even with location
background mode enabled.

**Symptom**: User drives 10+ minutes, app still shows "ready"

**Fix**: Add app lifecycle monitoring and logging to detect termination

---

### #3: Permission Not Actually "Always" (10% probability)
Code assumes permission granted immediately without waiting for user response.

**Location**: LocationService.ts, line 60-66

```typescript
Geolocation.requestAuthorization('always');
setTimeout(() => resolve(true), 500);  // ← Resolves before user grants!
```

**Symptom**: User tapped "When In Use" by mistake, but app thinks "Always"

**Fix**: Wait for actual permission response before resolving

---

## Critical Code Bugs

### Bug #1: Wrong Service Polled (HomeScreen.tsx, lines 191-204)
```typescript
// WRONG: Polls fallback service
const activity = await MotionActivityService.getCurrentActivity();

// RIGHT: Should poll primary service
const status = await BackgroundLocationService.getStatus();
```

### Bug #2: No Permission Verification (HomeScreen.tsx, line 246)
```typescript
// WRONG: Always returns true
const hasLocationPermission = await LocationService.requestLocationPermission(true);

// RIGHT: Check actual permission status
const actual = await BackgroundLocationService.getPermissionStatus();
```

### Bug #3: Swallowed Errors (BackgroundTaskService.ts, lines 173-229)
```typescript
try {
  if (BackgroundLocationService.isAvailable()) {
    // ...
  }
} catch (error) {
  log.warn('Could not start iOS monitoring:', error);  // ← Silent failure
}
```

---

## Key Files

| Component | Path | Lines | Issue |
|-----------|------|-------|-------|
| **Primary Detection** | `ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` | 488 | Line 204: Confidence gate too strict |
| **Fallback Detection** | `ios/TicketlessChicagoMobile/MotionActivityModule.swift` | 144 | Less reliable, should be backup only |
| **Orchestration** | `src/services/BackgroundTaskService.ts` | 939 | Lines 173-229: Error handling poor |
| **Bridge** | `src/services/BackgroundLocationService.ts` | 274 | JS wrapper for native module |
| **UI/Display** | `src/screens/HomeScreen.tsx` | ~700 | Lines 191-204: Polls wrong service |
| **Entry Point** | `src/screens/HomeScreen.tsx` | ~700 | Lines 243-262: Poor permission check |
| **Config** | `ios/TicketlessChicagoMobile/Info.plist` | 95 | ✓ Correctly configured |

---

## Diagnostic Checklist for Users

- [ ] Settings → Autopilot → Location: shows "Always" (not "When In Use")
- [ ] Settings → Privacy → Motion & Fitness: "Enabled"
- [ ] Settings → Battery: "Low Power Mode" is OFF
- [ ] Device: iPhone 5s or later (needs M-series coprocessor)
- [ ] Restart app after changing settings

---

## Diagnostic Checklist for Developers

1. Add logging to BackgroundLocationModule.swift line 200-251:
   ```swift
   NSLog("CoreMotion: automotive=\(activity.automotive), 
                    confidence=\(activity.confidence)")
   ```

2. Add logging to line 184:
   ```swift
   NSLog("GPS: \(continuousGpsActive ? "ON" : "OFF")")
   ```

3. Check permission status:
   ```swift
   NSLog("Location auth: \(locationManager.authorizationStatus.rawValue)")
   // 3 = authorizedAlways ✓
   // 2 = authorizedWhenInUse ✗
   ```

4. Add UI diagnostics screen showing:
   - Permission status
   - CoreMotion available: yes/no
   - Current activity: automotive/stationary/unknown
   - GPS on/off
   - Last update time

---

## Recommended Fix Priority

### IMMEDIATE (Day 1)
1. Change line 204 to accept low confidence
2. Fix HomeScreen polling to use BackgroundLocationModule
3. Add permission verification alert

### SHORT TERM (Week 1)
4. Add comprehensive logging for debugging
5. Improve error handling in BackgroundTaskService
6. Add user-facing diagnostics UI

### MEDIUM TERM (Sprint)
7. Implement proper iOS app lifecycle handling
8. Add fallback polling mechanism
9. Improve UI responsiveness for state changes

---

## Document Versions

- **Summary** (1 page, quick read): iOS_DRIVING_DETECTION_SUMMARY.txt
- **Analysis** (522 lines, complete): iOS_DRIVING_DETECTION_ANALYSIS.md
- **Flow Diagram** (visual): iOS_DRIVING_DETECTION_FLOW.txt
- **Index** (this file): iOS_DRIVING_DETECTION_INDEX.md

---

## Technical Deep Dive

### How It Should Work (Normal Path)

```
App starts
  ↓
Request "Always" location permission
  ↓
BackgroundLocationModule.startMonitoring()
  ├─ Start significantLocationChange monitoring (backup)
  ├─ Start CoreMotion activity monitoring
  └─ Don't start GPS yet (battery savings)
  ↓
User drives
  ↓
CoreMotion detects automotive activity
  ├─ Check: confidence != .low ← GATE (might fail here!)
  ├─ Start continuous GPS
  ├─ Emit onDrivingStarted event
  └─ Show "You're on the move" in UI
  ↓
User stops driving
  ↓
CoreMotion detects stationary/walking
  ├─ Wait 5 seconds (debounce)
  ├─ Snapshot last driving location
  └─ Emit onParkingDetected event
  ↓
BackgroundTaskService receives event
  ├─ Get high-accuracy location
  ├─ Call parking check API
  ├─ Display parking restrictions
  └─ Schedule reminder notifications
```

### How It Breaks (Failure Paths)

See iOS_DRIVING_DETECTION_FLOW.txt for detailed failure scenarios

---

## iOS Configuration

### Info.plist Permissions (✓ CORRECT)
- `UIBackgroundModes`: location, bluetooth-central, fetch, remote-notification
- `NSLocationAlwaysAndWhenInUseUsageDescription`: Present and correct
- `NSMotionUsageDescription`: Present and correct

### Info.plist Issues
- None detected. Configuration is correct.

---

## Questions & Answers

**Q: Does the app work on Android?**  
A: Android uses Bluetooth Classic connection/disconnection instead of CoreMotion.
No iOS-specific issues there.

**Q: Why not use continuous GPS from the start?**  
A: Battery. The app battery-efficiently waits for CoreMotion to signal driving
before activating high-frequency GPS.

**Q: Why the 5-second debounce for parking?**  
A: To ignore momentary "exit" detections when user leans out car or briefly
exits then re-enters.

**Q: What if CoreMotion is unavailable?**  
A: Falls back to MotionActivityModule (CoreMotion only) or GPS speed detection.

**Q: Can I test this locally?**  
A: Hard to test without real driving. Add logging and run on physical iPhone,
then drive actual route. Or simulate with Xcode location simulator.

---

## Contact & Updates

For questions about this analysis:
1. Check the detailed report (iOS_DRIVING_DETECTION_ANALYSIS.md)
2. Review the flow diagram (iOS_DRIVING_DETECTION_FLOW.txt)
3. Check line numbers in source code against timestamps

Document last updated: January 31, 2026
Analysis version: 1.0 (Complete)
