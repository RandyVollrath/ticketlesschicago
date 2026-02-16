# Parking Detection Reliability Analysis - Ticketless Chicago Mobile

## 2026-02-16 Reliability Update

Implemented and now active in code:

- Multi-signal parking confidence gate in iOS native flow (`BackgroundLocationModule.swift`) to suppress weak red-light stop candidates before confirmation.
- Intersection-risk awareness (camera-proximity proxy) added to confidence scoring for conservative decisions near signalized corridors.
- Decision observability added to status payloads:
  - `lastParkingDecisionConfidence`
  - `lastParkingDecisionHoldReason`
  - `lastParkingDecisionSource`
  - `lastParkingDecisionTs`
- In-app ground-truth correction banner added on Home screen so users can immediately mark false parking detections or confirm true ones.
- Intersection dwell guard added:
  - near-intersection short stops without walking/car-disconnect evidence are blocked before parking confirmation.
  - quick resume from an intersection dwell now auto-adds hotspot signal and extends temporary lockout.
- Post-confirm unwind added:
  - if rapid real driving movement shortly after a low-confidence/risky parking confirm indicates false positive, native logic auto-unwinds parking assumptions and applies lockout/hotspot learning.
- New synthetic camera validation harness: `scripts/camera-drive-harness.js`.
- New daily tuning report generator: `scripts/daily-parking-camera-report.js`.
- Camera audio reliability hardening:
  - iOS SpeechModule warmup hook added to prime AVAudioSession before first drive alert.
  - Camera alerts now use retry-on-failure (`~1.2s` retry window) before fallback.
  - If TTS fails after retry, app emits an immediate local notification fallback so the user still gets warned.
  - Added per-drive camera audio metrics (attempts, success, failures, retries, fallback notifications).
- Drive-session traceability:
  - Camera alert engine now generates a `driveSessionId` per drive and includes it in trip summaries.
  - Parking rejection logs now include drive session linkage for cross-event debugging.
- Camera runtime heartbeat:
  - Added minute-level heartbeat checks while camera alerts are active; if GPS update flow stalls, the app logs/surfaces a diagnostic signal.
- Ground-truth loop foundation:
  - Mobile now queues and flushes parking/camera ground-truth events (`GroundTruthService`) to `/api/mobile/ground-truth`.
  - Added API ingestion route for `mobile_ground_truth_events` so user feedback can be used for recurring threshold tuning.
  - Added Supabase migration `20260216074000_create_mobile_ground_truth_events.sql` with indexes + RLS for production persistence.
  - Added periodic `camera_opportunity_digest` telemetry events (throttled) so we capture near-miss context, not only final alerts.
- Auto-tuning + release gates:
  - Added `scripts/auto-tune-reliability.js` to produce threshold recommendations from recent logs.
  - Added `scripts/reliability-release-gate.js` to fail releases when miss/unwind/fallback rates exceed configured limits.
  - Added `npm run deploy:safe` to run reliability gate before prod deploy.
- Additional parking confirmation hardening:
  - Queued parking recovery no longer depends only on walking evidence; it can now recover with sustained non-automotive + zero-speed evidence or recent car-disconnect evidence.
  - Added stale-location guard at confirmation time and fresh-GPS refinement (`current_refined`) so old/low-quality stop snapshots are replaced or blocked before final parking confirmation.
  - Stale-location blocks now queue a retry candidate (`stale_retry_candidate`) instead of dropping the parking pipeline, reducing missed parks when GPS quality catches up a few seconds later.
  - Added trip-summary counter `parkingStaleLocationBlockedCount` so stale-fix pressure is visible in post-drive diagnostics.
  - Added adaptive GPS fallback for missed driving starts: when a recent car-audio signal exists, fallback driving promotion uses lower speed/distance/duration thresholds to reduce missed departures and delayed camera startup.
  - Added native `monitoring_heartbeat` diagnostics every 20 seconds while monitoring is active (plus stop snapshot), capturing motion/gps/timer/queue/lockout/vehicle-signal state for full timeline debugging.
  - Expanded iOS status payload with queue/timer/signal/heartbeat fields so runtime state can be inspected without pulling full raw logs.
  - Added heartbeat environment fields (`locationAuthRaw`, background refresh status, low-power mode) and explicit `location_auth_changed` decision events for permission-state correlation.
  - Added automatic rotation for debug/decision logs with `.prev` backups so high-volume logging remains stable over long sessions.
- New npm script entry points:
  - `npm run harness:camera-drive`
  - `npm run report:parking-camera`

Purpose of this update:

- Reduce false-positive parking detections at red lights.
- Preserve true parking detection by requiring stronger, multi-signal evidence.
- Improve root-cause speed by logging explicit decision confidence, hold reasons, and summary metrics.

### Next Reliability Hardening (Recommended)

1. Add an "intersection dwell" guard:
   - If a candidate stop occurs within intersection-risk radius and movement resumes within a short window, auto-mark as non-parking and extend temporary lockout.
2. Add "post-confirm unwind":
   - If parking is confirmed but trip-like movement resumes quickly (distance + speed thresholds), automatically revert that parking event as false positive.
3. Add per-trip server-ingested diagnostics:
   - Upload compact trip summary events (start/end, hold reason, confidence buckets, camera reject reasons) so tuning does not depend on manual local log pulls.
4. Build threshold sweep tooling:
   - Run offline replay across recent trips using multiple confidence/hold thresholds and output precision/recall tradeoff table for deterministic tuning.
5. Add camera heartbeat safety:
   - While `isDriving=true`, emit periodic camera-engine heartbeat counters and "last camera candidate ts" to detect silent background stalls.
6. Add optional high-signal integrations (feature-flagged):
   - Car Bluetooth/CarPlay disconnect as a confidence boost only (never sole trigger), with safe fallback when unavailable.
7. Add production reliability SLO dashboard:
   - Track daily parking false-positive rate, missed parking reports, camera alert rate per drive hour, and unknown-CoreMotion ratio.

Target outcomes:
- Parking detection reliability toward 99%+ practical accuracy in normal urban driving.
- Red-light stop false positives reduced to near-zero.
- Camera notifications become observable and auditable when background constraints interfere.

## Why This Should Work Now (Current Theory)

### What we changed in this cycle

1. Parking false-positive suppression got stronger at intersections.
   - Added intersection dwell guard before parking confirmation.
   - Added quick-resume logic that treats short intersection stops followed by movement as non-parking and learns hotspot + lockout.

2. False parking confirms can now self-correct.
   - Added post-confirm unwind logic:
     - if movement patterns shortly after confirm look like real driving,
     - and the original confirm was low-confidence/risky,
     - system unwinds parking assumptions and records the location as a false-positive hotspot.

3. Camera delivery became multi-path instead of single-path.
   - High confidence: audio-first (with retry), then fallback notification if audio fails.
   - Medium confidence: notification-only (no audio spam).
   - Low confidence: suppressed.

4. Audio startup race conditions were reduced.
   - Added iOS SpeechModule warmup hook.
   - Triggered prewarm on early-driving signals (`onPossibleDriving`, `onDrivingStarted`, and camera-start path).

5. Observability was expanded to per-drive, not just per-event.
   - Added `driveSessionId` lifecycle in camera pipeline.
   - Added per-drive delivery counters: attempts/success/failures/retries/fallbacks.
   - Added camera heartbeat stall detection while driving.
   - Added parking/camera ground-truth queue + ingestion endpoint.

6. Reliability is now gateable before release.
   - Added auto-tune recommendation script (`tune:reliability`).
   - Added release gate script (`gate:reliability`) to fail bad reliability profiles.

7. Confirmation now guards stale GPS snapshots.
   - If the captured stop location is old/weak, the system now prefers a fresh, high-quality current fix.
   - If location quality is too stale/coarse and there is no strong parking evidence, confirmation is blocked instead of emitting a likely-wrong event.

### Core hypotheses behind this version

1. Most parking false positives are “short stop + no true exit evidence” events at intersections.
   - Therefore: intersection dwell + no-walking/no-disconnect guard should block most of them.

2. Remaining false positives can be detected by immediate post-confirm behavior.
   - Therefore: unwind-on-rapid-movement should prevent one bad confirm from poisoning later state.

3. Camera misses are often delivery failures, not candidate-detection failures.
   - Therefore: retry + fallback notification + prewarm should increase delivered alerts even when background audio is flaky.

4. One-size-fits-all alerting causes either misses or noise.
   - Therefore: confidence-tier routing should preserve important alerts while reducing low-confidence noise.

5. We need explicit feedback loops to finish tuning.
   - Therefore: ground-truth events + per-drive metrics + release gates should let us tighten toward reliable operation instead of guessing.

### What would falsify these hypotheses

1. Continued red-light false positives with:
   - intersection dwell guard firing rarely,
   - but post-confirm unwind firing often.
   This would imply guard thresholds are still too permissive before confirm.

2. Continued camera “I passed one but got nothing” reports with:
   - candidate counts present,
   - but no delivery attempts.
   This would imply upstream candidate logic still misses real opportunities.

3. High fallback notification rates despite prewarm and retry.
   This would imply deeper audio-session/OS interruption constraints need different handling.

### Near-term success criteria

1. Parking:
   - lower false-positive reports at known intersection corridors,
   - low post-confirm unwind rate over normal drives,
   - stable parking detection rate after true departures.

2. Camera:
   - increase in delivered alerts (audio or fallback) per camera opportunity,
   - lower “silent miss” reports,
   - fallback used as safety net, not dominant path.

## Executive Summary

The parking detection system has **solid architecture with good recovery mechanisms**, but there are **several critical gaps** that can cause missed parking detections, particularly around app death, force-kill, and Android lifecycle events.

**Key Risk Level: MEDIUM-HIGH**

---

## Critical Gaps & Failure Modes

### 1. ANDROID BOOT-UP RECOVERY - MISSING BOOT RECEIVER

**Status: CRITICAL GAP**

**The Problem:**
- AndroidManifest.xml declares `RECEIVE_BOOT_COMPLETED` permission but **NO BroadcastReceiver is registered** to handle it
- When phone reboots after app was monitoring:
  - Service is NOT automatically restarted
  - Bluetooth monitoring completely stops
  - Any parking that happens post-reboot is undetected
  - This is especially dangerous for overnight parking scenarios

**Location:**
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/AndroidManifest.xml` (line 14)
  - Declares permission but no receiver
- No BootBroadcastReceiver.kt file exists

**Impact:**
- User's car could be parked, phone reboots, monitoring never resumes
- Missed parking violations in critical periods (overnight bans, street cleaning)
- User has no awareness that monitoring stopped

**Example Failure Scenario:**
```
1. User driving at 11 PM → parking at 11:15 PM
2. Phone dies/reboots (low battery, crash, etc.)
3. Winter overnight ban starts at 3 AM
4. Monitoring never resumed → NO NOTIFICATION
5. User wakes up at 7 AM to ticket
```

**Fixable: YES - PRIORITY HIGH**
- Create a BootBroadcastReceiver that:
  - Listens for ACTION_BOOT_COMPLETED
  - Retrieves saved car device from SharedPreferences
  - Starts BluetoothMonitorService via foreground service
  - Logs completion for diagnostics

---

### 2. ANDROID FOREGROUND SERVICE - START_STICKY RACE CONDITION

**Status: MEDIUM GAP**

**The Problem:**
- BluetoothMonitorService uses `START_STICKY` (line 146, BluetoothMonitorService.kt)
  - ✅ Good: Service restarts if killed
  - ❌ Problem: Restart happens AFTER service is killed
  - Race condition: BT disconnect event fires while service is being restarted

**Scenario:**
```
1. App in background, service monitoring BT
2. System kills service (memory pressure, Doze mode)
3. BT disconnect happens at exact moment of death
4. Service tries to emit event to JS but:
   - JS bridge may not exist yet (new process)
   - eventListener is null (being reconstructed)
5. Event stored as pending, but...
6. App never comes to foreground → pending event never checked
```

**Location:**
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/java/fyi/ticketless/app/BluetoothMonitorService.kt` (line 146)

**Impact:**
- Rarely but critically, the parking check is never triggered
- More likely on low-memory devices

**Current Mitigations:**
- Periodic check (15 min) as backup - GOOD
- Pending event storage in SharedPreferences - GOOD
- But: pending check only happens on app resume

**Fixable: MEDIUM (requires architectural thinking)**
- Option A: Post a foreground notification on intent restart to ensure it's fresh
- Option B: Use work scheduler (WorkManager) with exponential backoff
- Option C: Extend timeout for pending checks (currently infinite)

---

### 3. ANDROID FORCE-KILL / USER CLEARS APP DATA

**Status: HIGH GAP**

**The Problem:**
- User force-kills app or clears app data → all SharedPreferences wiped
- Saved car device is lost
- Service has no target device to monitor
- On next launch, user must re-pair car

**Current Behavior:**
```kotlin
// BluetoothMonitorService line 121-122
targetAddress = intent?.getStringExtra(EXTRA_DEVICE_ADDRESS)
    ?: getStoredTargetAddress()  // Returns null if prefs wiped
```

- If `targetAddress == null`, service stops (line 138-140)

**Impact:**
- User force-kills app during parking detection
- Service stops silently
- App relaunches but has no car paired
- Parking check fails with "No saved car device" error

**Fixable: MEDIUM**
- Store car device in app's private encrypted storage (harder to wipe)
- Offer quick re-pairing flow on app launch if device missing
- Add user prompt: "Clear app data will disable parking monitoring"

---

### 4. ANDROID BATTERY OPTIMIZATION KILLING FOREGROUND SERVICE

**Status: MEDIUM-HIGH GAP**

**The Problem:**
- Aggressive battery optimization (Xiaomi, Samsung, OPPO) can kill foreground services
- Even with START_STICKY, the system may refuse to restart
- BluetoothMonitorService declares `android:foregroundServiceType="connectedDevice"`
  - This is CORRECT for Bluetooth monitoring
  - But doesn't protect against:
    - Manufacturer battery savers
    - "App permissions manager" killing services
    - Doze mode + aggressive battery drain

**Location:**
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/AndroidManifest.xml` (line 61)
  - Service correctly declared as connectedDevice type
  - But no backup mechanism for optimization scenarios

**Current Fallback:**
- Periodic check (15 min) as backup - GOOD but not fast enough
- JS-side monitoring if native service fails - WEAK (can't work in deep background)

**Impact:**
- On aggressive battery-saver devices, service dies and doesn't restart
- User thinks monitoring is active but it's not
- Parking violations missed

**Fixable: MEDIUM-HIGH**
- Add service health check: periodically verify service is still running
- Use WorkManager with PERSIST constraint for periodic checks
- Add "Whitelist Autopilot in battery settings" onboarding
- Consider adding WiFi-sync recovery (if app has internet, resync state)

---

### 5. iOS: APP KILLED MID-PARKING DETECTION - INCOMPLETE RECOVERY

**Status: MEDIUM GAP**

**The Problem:**
- iOS can kill the app while significantLocationChange is waking it
- BackgroundLocationModule has `checkForMissedParking()` recovery (line 379-437)
- Recovery queries CoreMotion history from last 30 minutes
- BUT: There's a critical flaw in the detection logic

**Code Issue (line 415):**
```swift
if wasRecentlyDriving && currentlyStationary && automotiveDuration >= self.minDrivingDurationSec {
```

- `automotiveDuration` calculated incorrectly
- Line 405: `automotiveDuration += activities[i + 1].startDate.timeIntervalSince(activity.startDate)`
  - This sums the **gap between activities**, not the automotive duration itself
  - Should be tracking only the `.automotive` activities

**Better Logic Should Be:**
```swift
var totalAutomotiveDuration: TimeInterval = 0
for activity in activities {
    if activity.automotive {
        if i + 1 < activities.count {
            totalAutomotiveDuration += activities[i + 1].startDate.timeIntervalSince(activity.startDate)
        }
    }
}
```

**Location:**
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` (line 388-407)

**Impact:**
- Missed parking if: app killed while stopped, no active driving → recovery doesn't trigger
- Users on iOS may miss parking detections in specific scenarios

**Fixable: YES - PRIORITY MEDIUM**
- Fix the driving duration calculation in CoreMotion history query
- Add unit tests for recovery scenarios

---

### 6. iOS: SIGNIFICANT LOCATION CHANGE WAKE-UP DELAY

**Status: LOW-MEDIUM GAP**

**The Problem:**
- iOS significantLocationChange (line 112, BackgroundLocationModule.swift) only fires on 100-500m cell tower changes
- If user parks in same cell tower, it won't wake the app
- Recovery depends on app being woken by significantLocationChange
- In tight urban areas, parking 50m away won't trigger wake

**Current Mitigation:**
- CoreMotion continuous monitoring (running in background on M-series coprocessor)
- ✅ If CoreMotion detects parking in background, event fires immediately
- ❌ If CoreMotion is disabled/not available, significantLocationChange is only backup

**Example Failure:**
```
1. User drives to downtown parking, parks in same cell tower area
2. CoreMotion detects automotive → stationary
3. But if CoreMotion reports LOW confidence, event may not fire
4. significantLocationChange won't wake app (same tower)
5. Parking check delayed until app is manually opened
```

**Location:**
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` (line 112)

**Impact:**
- Delayed parking detection in urban areas with tight cell tower coverage
- Usually <2 minutes, but critical if parking near street cleaning time

**Fixable: MEDIUM**
- Request geofence/region monitoring permission (iOS14+)
- Use Geofences to trigger local parking notifications when user stops
- But: adds significant complexity and battery drain

---

### 7. RACE CONDITION: LOCATION CACHE STALE USAGE

**Status: MEDIUM GAP**

**The Problem:**
- BackgroundTaskService pre-caches GPS every 60 seconds while car is connected (line 543-560)
- On Android, if Bluetooth disconnect happens immediately after a cache update, location could be 60 seconds stale
- Logic to clear cache exists (line 696: `LocationService.clearLocationCache()`)
- BUT: clearLocationCache() is called AFTER triggerParkingCheck() is already running
- Race condition: Parking check uses stale GPS from cache

**Problematic Flow:**
```
1. Car connected, GPS cached at 11:15:00
2. Bluetooth disconnects at 11:15:45
3. handleCarDisconnection() called, line 695-696:
   - stopGpsCaching()
   - LocationService.clearLocationCache()
4. triggerParkingCheck() called (line 705)
5. But if GPS fails, line 784: cachedCoords = LocationService.getCachedLocation()
   - Cache was just cleared... but what if it gets re-populated?
   - No! Cache is cleared BEFORE the check, so it's safe
```

**Actually: This is handled correctly** - cache is cleared before check starts

**Real Issue:** Async timing
```
Line 695: stopGpsCaching() (async, may not complete)
Line 696: LocationService.clearLocationCache()
Line 705: triggerParkingCheck() immediately called
→ If stopGpsCaching hasn't completed, new GPS could be cached
```

**Impact:** Low - but could cause wrong parking location in race condition

**Fixable: YES - PRIORITY LOW**
- Make clearLocationCache() synchronous and awaited
- Or use a flag to prevent new caches during disconnect handling

---

### 8. NO HANDLER FOR ANDROID BATTERY DRAIN DETECTOR / CRASH

**Status: LOW GAP**

**The Problem:**
- BackgroundTaskService registers AppState listener (line 94-97)
- But there's no handler for app crashing → restart scenario
- If app crashes while monitoring:
  - BackgroundTaskService.isMonitoring might be false in restarted process
  - But BluetoothMonitorService continues running (good!)
  - On app restart, monitoring is re-initialized

**Current Behavior (good):**
1. App crashes, BackgroundTaskService dies
2. BluetoothMonitorService (foreground service) keeps running
3. App restarts, BackgroundTaskService.initialize() called
4. BluetoothMonitorService is already running, reconnects

**Location:**
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` (line 83-118)

**Actually: Well-handled** - no gap here

---

### 9. CRITICAL: DOUBLE-PARKING-CHECK BUG ON APP STATE CHANGE

**Status: HIGH GAP - BUT ACKNOWLEDGED**

**The Problem:**
- Comments explicitly note this (line 1150-1155, BackgroundTaskService.ts)
- App backgrounding/foregrounding could trigger duplicate parking checks
- If car is already parked/disconnected, re-registering BT listeners could fire false disconnect event
- This could cause SECOND parking check at wrong location (stale GPS)

**Current Mitigation:**
- handleAppStateChange() does NOT re-register listeners (line 1156+)
- Only restarts periodic check interval if needed
- ✅ This correctly avoids the duplicate-check problem

**Edge Case:**
- What if monitoringInterval was cleared but app thinks it's monitoring?
- Line 1162: checks `!this.monitoringInterval` before restarting
- ✅ Safe

**Impact:** LOW (already mitigated)

---

### 10. PENDING DEPARTURE CONFIRMATION - TIMEOUT INFINITE

**Status: LOW-MEDIUM GAP**

**The Problem:**
- User reconnects to car (marks as connected)
- Departure confirmation scheduled (line 1293-1304)
- If confirmation fails and retries max out, pending state clears
- BUT: What if user re-disconnects before confirmation completes?
- Line 1310: `if (!this.state.pendingDepartureConfirmation)` returns early

**Race Condition:**
```
1. User leaves car, car disconnects → parking check
2. User returns, car reconnects → schedules departure confirmation
3. Confirmation times out waiting for good GPS
4. User leaves again, car disconnects
5. What happens? Is departure confirmation for PREVIOUS leave still pending?
```

**Code Check (line 1310-1313):**
```typescript
private async confirmDeparture(): Promise<void> {
  if (!this.state.pendingDepartureConfirmation) {
    log.debug('No pending departure confirmation');
    return;
  }
```

- If pending state was cleared, this early exit prevents issues
- ✅ Safe - no race condition here

**Impact:** LOW (well-handled)

---

## Summary Table

| Gap | Severity | Fixability | Category | Time to Fix |
|-----|----------|-----------|----------|------------|
| 1. No Boot Receiver | CRITICAL | YES | Android | 2 hours |
| 2. START_STICKY Race | MEDIUM | MEDIUM | Android | 4 hours |
| 3. Force-Kill Data Loss | HIGH | MEDIUM | Android | 3 hours |
| 4. Battery Optimization | MEDIUM-HIGH | MEDIUM | Android | 6 hours |
| 5. iOS Recovery Logic | MEDIUM | YES | iOS | 1 hour |
| 6. Significant Location Delay | LOW-MEDIUM | MEDIUM | iOS | 8 hours |
| 7. Location Cache Race | LOW | YES | Both | 1 hour |
| 8. App Crash Handler | LOW | N/A | Both | ✅ Handled |
| 9. Double Check Bug | HIGH | N/A | Both | ✅ Mitigated |
| 10. Departure Race | LOW | N/A | Both | ✅ Handled |

---

## Recommended Fix Priority

### Phase 1: CRITICAL (Do First)
1. **Add Boot Receiver** - No parking monitoring post-reboot
   - File: New `BootBroadcastReceiver.kt`
   - Time: 2 hours
   - Risk: None (only adds missing feature)

### Phase 2: HIGH (Do Soon)
2. **Fix iOS Recovery Math** - Incorrect driving duration calculation
   - File: BackgroundLocationModule.swift (line 388-437)
   - Time: 1 hour
   - Risk: None (fixes broken code)

3. **Handle Force-Kill** - Add encrypted persistent storage backup
   - Files: BluetoothMonitorService.kt, BluetoothService.ts
   - Time: 3 hours
   - Risk: Low (backward compatible)

### Phase 3: MEDIUM (Do Next Sprint)
4. **Battery Optimization Recovery** - Add service health checks
   - Use WorkManager for periodic verification
   - Time: 6 hours
   - Risk: Low (adds robustness)

5. **Location Cache Safety** - Make clearLocationCache() awaited
   - File: BackgroundTaskService.ts
   - Time: 1 hour
   - Risk: Very low (improves reliability)

### Phase 4: NICE-TO-HAVE (Future)
6. **iOS Geofence Backup** - Regional monitoring for urban areas
   - Time: 8+ hours
   - Risk: Medium (new dependencies, battery impact)

---

## Testing Recommendations

### Android Tests
- [ ] Reboot phone while app monitoring, verify service restarts
- [ ] Kill app (adb shell am kill), verify service persists
- [ ] Clear app data, verify graceful degradation with re-pairing prompt
- [ ] Enable aggressive battery saver, verify periodic checks still fire
- [ ] Multiple fast BT connect/disconnect cycles, verify no duplicate checks

### iOS Tests
- [ ] Simulate app kill mid-parking (ios-deploy terminate)
- [ ] Verify CoreMotion recovery works with <2 min drive duration
- [ ] Test with CoreMotion disabled, verify significantLocationChange works
- [ ] Tight urban area parking, verify detection within 2 minutes

---

## Code Snippets for Fixes

### Boot Receiver (Android)
See end of document.

### iOS CoreMotion Fix
See end of document.
