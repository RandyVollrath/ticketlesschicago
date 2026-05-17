# iOS Parking/Driving Detection — Critical Rules

> Extracted from CLAUDE.md. Covers CoreMotion + CLLocationManager parking detection, CLVisit monitoring, checkForMissedParking recovery, CoreMotion permission handling, and GPS-only fallback.

iOS parking detection uses CoreMotion (M-series coprocessor) + CLLocationManager. The detection flow is: CoreMotion detects automotive → `isDriving = true` → GPS tracks position → CoreMotion detects stationary/walking → 5-second debounce → parking confirmed → `onParkingDetected` event fires.

## Lesson #9: NEVER stop CoreMotion after parking confirmation
CoreMotion (`CMMotionActivityManager`) uses the dedicated M-series coprocessor — it is near-zero battery cost. Stopping it after parking and relying on `significantLocationChange` (cell tower changes, ~100-500m) to restart it causes **TWO silent failures**:

1. **Departure never captured**: `onDrivingStarted` never fires for the next drive because CoreMotion isn't running. The server never records that the user left their parking spot. This has been a recurring bug — the user reported it multiple times.
2. **Second parking never detected**: If the user parks, drives somewhere else (e.g. home), and parks again — the second parking is never detected because `isDriving` is never set back to true (no CoreMotion to detect it).

**Rule**: Keep CoreMotion running always. Keep GPS in low-frequency "keepalive" mode (50m, 100m accuracy) after parking — never fully stop it. Fully stopping GPS lets iOS kill the app process, which also kills CoreMotion callbacks. `significantLocationChange` alone is too unreliable for detecting the START of a new drive — it depends on cell tower geometry, can take minutes, and doesn't fire at all for short same-area trips.

## Architecture
- **Native module**: `BackgroundLocationModule.swift` — CLLocationManager + CMMotionActivityManager
- **JS orchestrator**: `BackgroundTaskService.ts` — receives `onParkingDetected` and `onDrivingStarted` events, runs parking rule checks, handles departure tracking
- **Departure flow**: `onDrivingStarted` → `handleCarReconnection()` → `markCarReconnected()` → `scheduleDepartureConfirmation()` (2-min delay to capture new GPS) → `confirmDeparture()`

## Rules
1. **CoreMotion AND keepalive GPS must stay active at all times while monitoring is on.** GPS drops to low-frequency (50m, 100m) after parking but is NEVER fully stopped — this prevents iOS from killing the process and provides enough updates to detect short drives via speed when CoreMotion misses them.
2. **Departure depends on `onDrivingStarted`** firing when the user starts their next drive. If CoreMotion is stopped, this event never fires and departure is never recorded.
3. **The `minDrivingDurationSec` (10s) check is enforced in `handlePotentialParking()` BEFORE the 8s debounce timer starts.** It rejects ALL stops — including walking-detected ones — if driving lasted less than 10 seconds. This is enforced unconditionally; no path bypasses it. (Bug: Mar 18 2026 — this check was missing, and a 3-4s alley stop on Sheffield 2300 confirmed as parking via `coremotion_walking`.)
4. **Walking evidence reduces the GPS zero-speed requirement but does NOT eliminate it.** The `coremotion_walking` path requires 8 seconds of GPS speed ≈ 0 even when walking is detected. CoreMotion can misclassify phone jostling during slow turns/creeping as "walking." Without GPS confirmation, brief alley stops and yield-sign pauses trigger false positives. If GPS hasn't been zero long enough, the walking path defers to the `speedZeroTimer` (same as no-walking). (Bug: Mar 18 2026 — walking evidence was bypassing GPS entirely, causing the Sheffield alley false positive.)
5. **The speed-based override (10s of zero speed)** catches cases where CoreMotion is slow to report stationary. Don't remove it.
6. **After parking confirmation, `isDriving` resets to false.** The ONLY way it gets set back to true is via CoreMotion reporting automotive or GPS speed > 2.5 m/s. If neither is running, the app is permanently stuck in "parked" state.
7. **GPS noise filter**: Require 2 consecutive above-threshold GPS readings before cancelling the parking timer. Reset `speedMovingConsecutiveCount = 0` in ALL paths where `speedSaysMoving` is set to false.
8. **CLVisit monitoring must be started alongside significantLocationChange.** Visits are the ONLY way to get coordinates for stops that happened while the app was killed.
9. **NEVER let ANY parking confirmation path bypass BOTH `minDrivingDurationSec` AND GPS zero-speed checks.** Every path through `handlePotentialParking()` → `confirmParking()` must pass at least: (a) 10s of driving, AND (b) some GPS zero-speed evidence. Walking evidence can reduce thresholds but cannot eliminate them. This rule exists because of repeated regressions where new code paths or refactors accidentally removed guards.

## CLVisit Monitoring (Safety Net for App Kill)

iOS's `CLLocationManager.startMonitoringVisits()` tracks places where the user dwells and delivers `CLVisit` objects with coordinates + arrival/departure times. Crucially, these are delivered even when the app was killed — they're queued by iOS and delivered on next launch.

**How it works in our stack:**
1. `startMonitoring()` calls `locationManager.startMonitoringVisits()` alongside significantLocationChange
2. `didVisit()` receives visits with coordinates, stores them in a ring buffer for coordinate enrichment
3. **When monitoring is active**: CLVisit ONLY stores visits — it does NOT independently emit parking events. The normal CoreMotion+GPS pipeline handles parking detection.
4. **When monitoring is NOT active** (app was killed, visits delivered on cold relaunch): CLVisit emits `onParkingDetected` for visits that don't match recent confirmed parking.
5. Visits are persisted to UserDefaults (`com.ticketless.visitHistory`) as a ring buffer (max 20, pruned at 24h)
6. The CoreMotion recovery function (`checkForMissedParking`) calls `findVisitForTimestamp()` to match intermediate trips with CLVisit coordinates
7. When a match is found, the parking event gets real coordinates → JS can check rules → user gets notified

**CLVisit limitations:**
- Minimum dwell time is typically 2-5 minutes (iOS decides, not configurable)
- Accuracy varies (50-200m) — good enough for parking rule checks but not exact spot
- Delivery can be delayed by minutes (iOS batches them)
- Not all stops register as visits — short stops (<2 min) are unreliable
- **CLVisit fires REPEATEDLY while dwelling** — iOS sends updates as accuracy improves or time passes. This caused false parking notifications when the user was sitting at a library.

**Rules:**
1. **Never remove `startMonitoringVisits()`** — it's the only fallback with coordinates when the app is killed
2. **CLVisit must NOT emit parking events when `isMonitoring == true`** — the normal pipeline handles it. CLVisit only stores visits for `findVisitForTimestamp()` coordinate enrichment while monitoring is active. However, **CLVisit DEPARTURE events DO trigger a GPS boost** (see rule 9).
9. **CLVisit departure triggers GPS boost when monitoring is active (added Mar 2026).** Even with 50m/100m keepalive, CoreMotion may miss a short drive entirely. CLVisit correctly detects the user left a dwelling location. On departure-confirmed visits (within 10 min, not already driving, GPS in keepalive), `startBootstrapGpsWindow("clvisit_departure")` boosts GPS to full accuracy for 75 seconds, giving the speed pipeline a chance to detect any ongoing driving. Conditions: `isDeparture && !isDriving && departureAge < 600 && gpsInKeepaliveMode`.
3. **`findVisitForTimestamp()` uses 600s (10 min) tolerance** — CLVisit arrival times may not match CoreMotion timestamps exactly
4. **Always check `lastConfirmedParkingLocation` before emitting a visit-based parking event** — prevents duplicates when the normal pipeline already caught the stop
5. **Visit history is persisted to UserDefaults**, not just in-memory — must survive app kill + relaunch cycle
6. **False positive hotspot checks** must be applied to CLVisit-based parking events (and recovery events). `hotspotBlockMinReports = 1` means one user "Not parked" tap permanently blocks that location.
7. **CLVisit-only parking (when `isMonitoring == false`) bypasses ALL normal guards.** No speed check, no CoreMotion validation, no intersection check, no confidence scoring. It MUST have its own guards to prevent false positives:
   - **Require departure confirmed** (not arrival-only visits) — arrival-only means iOS hasn't confirmed the user stayed
   - **Require 3+ minute dwell** — shorter stops are traffic slowdowns, pickups, complex intersections
   - **Reject visits older than 2 hours** — stale post-Jetsam visits should be handled by `checkForMissedParking` (which validates against CoreMotion history) instead
   - **GPS speed sanity check** — if current GPS shows movement (speed > 2.5 m/s within last 30s), skip the visit
8. **The cascading false positive problem**: Once parking is falsely confirmed, `isDriving = false` and `hasConfirmedParkingThisSession = true`. The app cannot detect new parking until departure is detected first. If the false positive location is close to the actual parking spot (<200m), departure detection may never trigger, causing the real parking to be silently missed.

## `checkForMissedParking` Recovery — Deduplication Required

`checkForMissedParking()` queries CoreMotion history (last 6 hours) on app startup/wake and re-emits parking events for drive→park transitions it finds. This runs on EVERY app restart, significantLocationChange wake, and app resume from suspension.

**Critical rule: EVERY trip (intermediate AND last) MUST be deduplicated before emission.** Without this, recovery re-emits parking events the normal pipeline already caught, creating phantom records with drifted CLVisit coordinates (the "3857 N Lincoln Ave" bug — CLVisit GPS drifted 33m from Byron St, causing wrong address).

**Deduplication uses a confirmed parking ring buffer** (`bg_confirmedParkingTimes_v1` in UserDefaults): a persisted array of up to 20 recent confirmed parking timestamps+coords (pruned at 24h). Every `confirmParking()`, `handleRecoveryGpsFix()`, and CLVisit parking path calls `recordConfirmedParkingTime()`. Before emitting any intermediate trip, `isAlreadyConfirmedParking()` checks the ring buffer (1h time tolerance + 500m distance tolerance). The old single-value `lastConfirmedParkingLocation` check is kept as a belt-and-suspenders guard for the last trip only.

**Why `lastConfirmedParkingLocation` alone was insufficient:** It only stores ONE location. When recovery finds 2+ trips (Byron→Wolcott), the last trip (Wolcott at 9:21 PM) doesn't match `lastConfirmedParkingLocation` (Byron at 7:03 PM, timeDiff=2h18m > 1h threshold), so recovery proceeds and re-emits the already-confirmed Byron parking with drifted CLVisit coords.

**JS-side guard for zero-coordinate recovery events (fixed Mar 2026):** Native sends `lat=0, lng=0, accuracy=-1` when no CLVisit match exists for a recovery trip. Previously `event.latitude && event.longitude` in JS treated 0 as falsy → `parkingCoords = undefined` → `triggerParkingCheck(undefined)` → used phone's current GPS (could be at home, hours later). Fix: explicitly check `event.latitude !== 0` and reject recovery events with no valid coordinates entirely (return early, don't create parking record).

**Timestamp bug (fixed Feb 2026):** `handleRecoveryGpsFix()` was using `Date()` (current time) for the parking event timestamp instead of the CoreMotion `parkTime`. This caused parking records to show "parked now" instead of "parked 2 hours ago." Fix: store `recoveryParkTime` from the CoreMotion trip and use it in the event body.

## iOS CoreMotion Permission Handling & GPS-Only Fallback

iOS only prompts the user ONCE for CoreMotion (Motion & Fitness) permission. If denied, the system will never re-prompt — the user must manually enable it in Settings > Privacy > Motion & Fitness.

### Architecture (3 layers)

1. **Pre-permission primer** (`BackgroundTaskService.ts`): Before the first CoreMotion access, if auth is `notDetermined`, shows an `Alert.alert()` explaining why motion sensors are needed. This appears RIGHT BEFORE the iOS system prompt.

2. **GPS-only fallback** (`BackgroundLocationModule.swift`): When CoreMotion is denied/restricted/unavailable, `startMonitoring()` sets `gpsOnlyMode = true` and starts continuous GPS at low frequency (distanceFilter=20m, accuracy=100m) instead of waiting for CoreMotion to detect driving. The existing GPS speed fallback path (requires 4.2 m/s for 8s + 90m displacement) then detects driving from GPS speed alone.

3. **Post-denial recovery banner** (`HomeScreen.tsx`): When `MotionActivityService.getAuthorizationStatus()` returns `denied` or `restricted`, a yellow warning banner appears: "Motion & Fitness disabled — Enable in Settings for best results" with an "Open Settings" button.

### Key Behavior Differences in GPS-Only Mode
- `gpsOnlyMode = true` is set on `BackgroundLocationModule`
- `stopContinuousGps()` NEVER fully stops GPS — drops to keepalive mode (50m, 100m accuracy in normal mode; 20m, 100m in gpsOnly mode) to prevent iOS from killing the process and catch short drives
- Driving detection requires higher speed threshold (4.2 m/s vs 2.5 m/s with CoreMotion) and sustained duration (8s + 90m)
- Camera alerts still work via `speedSaysMoving` flag
- More battery usage than CoreMotion (which runs on M-series coprocessor at near-zero cost)

### Rules
1. **Never remove the GPS speed fallback path** (lines ~1593-1660 in BackgroundLocationModule.swift). It's the ONLY driving detection when CoreMotion is denied.
2. **`gpsOnlyMode` must be exposed in `getStatus()`** so JS can detect it and show appropriate UI.
3. **The pre-permission primer must appear BEFORE `startMonitoring()`** — once startMonitoring calls `activityManager.startActivityUpdates()`, the system prompt fires immediately.
4. **`MotionActivityModule.getAuthorizationStatus()`** is the canonical way to check CoreMotion permission from JS. Returns: `authorized`, `denied`, `restricted`, `notDetermined`, or `unknown`.
5. **The recovery banner should NOT show if location is also denied** (location denied is more critical — show that banner instead).

## Parking Detection Error Log

Running log of false positives / negatives that have hit a real user, what
the root cause was, and what was changed. Every new fix to parking or
camera detection should add an entry here. The Change Log in
`PARKING_LOCATION_ACCURACY.md` is for *location accuracy* (where the car
is); this log is for *detection correctness* (did parking/driving happen
at all).

| Date | Symptom (what user saw) | Root cause | Fix |
|------|--------------------------|-----------|-----|
| 2026-05-16 | Phantom red-light camera alert + phantom parking event saved at 800 W Fullerton while sitting still editing video on phone. Hadn't driven for hours. | A GPS speed spike (phone hand-jitter / indoor multipath) sustained ≥4.2 m/s for 8s and ≥90m of perceived drift was enough to trip the `gps_speed_fallback` driving start. CoreMotion never reported `automotive` during the entire 16-min phantom trip (`motionAutomotiveDurationSec: 0`, `motionUnknownDurationSec: 898`), but the existing code path only checked `coreMotionSaysAutomotive` (a flag), not `coreMotionStateLabel` (the actual state). A confidently walking/stationary CoreMotion signal did NOT veto the GPS-only promotion, and there was no cross-check during the trip to tear down a trip that CoreMotion clearly disagrees with. Once `isDriving` was true, the camera scanner ran for 16 min, one alert slipped through the per-camera filter at GPS speed 1.35 m/s (line 774 of `parking_detection.log` from debug report `3e75e6b4`), and finally the parking-confirmation logic saved a fake stop at the same coords. | Two-part fix in `BackgroundLocationModule.swift` (2026-05-17): **(a)** Veto the strict GPS-only fallback at trip-start when `coreMotionStateLabel` is `walking` or `stationary` — only the hard path (≥ `gpsHardDrivingSpeedMps` ≈ 18 mph sustained for ≥6s) can promote when CoreMotion confidently disagrees, because 18 mph isn't reachable on foot. **(b)** Phantom-trip cancellation in the CoreMotion delegate: if a trip started via `gps_speed_fallback` and `tripSummaryAutomotiveUpdates == 0` after `gpsFallbackCancelMinDurationSec` (60s), tear down the trip — emit `trip_summary` with `outcome: cancelled_gps_fallback_no_automotive`, reset `isDriving`, fire `onParkingCheckCancelled`. New decision event: `gps_fallback_trip_cancelled`. |
| 2026-05-17 | (Architectural — addresses the *class* of problem 2026-05-16 belongs to.) Mobile detection bugs can fire a parking event without the user ever having actually driven anywhere, and the old server handler would happily save it — overwriting the user's real parked spot with a phantom. | `pages/api/mobile/save-parked-location.ts` had no check that the user had actually departed from their previous parking spot before saving a new one. There was a single hardcoded `1019 W Fullerton` guard for one specific false-positive coordinate (a leaf-patch), but no principled rule that "you must have left before parking again." Every mobile bug that produces a phantom park ended up writing to the database. | Server-side phantom-trip veto in `save-parked-location.ts` (2026-05-17). Before the deactivate-then-insert flow runs, query the most-recent `parking_location_history` row for this user: if `cleared_at IS NULL` (mobile never reported departure), age ≥ 5 min (older than the in-file dedup window), and proposed coords are within ~300m of the prior — refuse the save. Veto runs BEFORE deactivating, so a phantom can't wipe the user's real active parking record. Rejected events are written to `audit_logs` with `action_type='parking_event_vetoed'` and a full diagnostic payload (prior row id, age, approximate distance, proposed coords) for review. Response: HTTP 200 with `{vetoed: true, veto_reason: 'no_departure_since_previous_park'}` so the mobile client doesn't retry. Smoke: `scripts/smoke-test-phantom-veto.ts` verifies (A) veto fires at same coords + uncleared prior, (B) passes at >300m, (C) passes when prior is cleared. |

### How to add an entry

Every fix should land with **both** an Error Log row above AND a regression
fixture in `TicketlessChicagoMobile/tests/detection-fixtures/`. The Error
Log is for humans; the fixture is for the harness.

1. **Pull the debug report** that triggered the fix:
   ```bash
   node scripts/fetch-debug-report.js --list 10
   node scripts/fetch-debug-report.js --id <uuid>
   ```
2. **Identify the bug** in `parking_decisions.ndjson` (each trip ends with a
   `trip_summary` event — that line is the ledger).
3. **Add the Error Log row** above with: symptom (plain English), root
   cause (what variable did the wrong thing, in which file), fix (what
   code changed AND what new `decision()` event was introduced so future
   failures show up in the log).
4. **Create a fixture directory** under
   `TicketlessChicagoMobile/tests/detection-fixtures/<YYYY-MM-DD>-<slug>/`:
   - `parking_decisions.ndjson` — copy from
     `TicketlessChicagoMobile/logs/remote_<slug>/parking_decisions.ndjson`.
     **Scrub uppercase-hex UUIDs** before committing — the repo's pre-commit
     hook flags `[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}`
     as a potential Resend key. tripId values aren't used by the harness, so
     replace with `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`:
     ```bash
     # find unique UUIDs in the fixture, then replace each with x's
     grep -oE '\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b' \
       TicketlessChicagoMobile/tests/detection-fixtures/<slug>/parking_decisions.ndjson \
       | sort -u
     # then sed -i 's/<UUID>/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/g' <file>
     ```
   - `manifest.json` — describe the bug as a *pattern* in event terms:
     - `trip_signature`: how to find this kind of trip in any ndjson
       (event=trip_summary plus signature fields like `startSource`,
       `motionAutomotiveUpdates`, etc.). Numeric comparisons use `_gt`,
       `_gte`, `_lt`, `_lte` suffixes.
     - `trip_must_not_have`: outcomes the trip MUST NOT have if the fix
       is working (e.g. `cameraAlertCount_gt: 0`, `outcome: parked`).
     - `fix_signature_any_of`: at least one of these events must appear
       somewhere in the ndjson for the fix to be considered active.
       Look at the new `decision()` calls your fix introduced.
     - `self_check_against_input.expect`: `bug_present` (the captured
       pre-fix log should show the bug — documents it as a test case)
       or `bug_absent` (rare; used when the fixture is a clean baseline).
     - `fix_commit`: short SHA of the commit that fixes it.
5. **Verify the fixture is well-formed**:
   ```bash
   npm run test:detection
   ```
   Self-check should pass — confirming the manifest's `trip_signature`
   actually matches the captured log.
6. **After deploying the fix**, ask the user to reproduce the scenario
   and send a new debug report. Scan it:
   ```bash
   node scripts/run-detection-regressions.js scan-latest --user <email>
   ```
   The fix is verified when the scan passes (the trip either no longer
   matches the bug pattern, or matches with the fix_signature present).
7. **Going forward**, every new debug report should be scanned:
   ```bash
   node scripts/run-detection-regressions.js scan-latest
   ```
   If any prior bug shows up in a new report, the harness flags it as a
   regression — even if nobody complained.

### What the harness does and doesn't do

**Does:** scan captured NDJSON logs for known-bad patterns. Each fixture
encodes one bug as a pattern + expected fix signature. The harness turns
every fixed bug into a recurrence detector that runs against any new
debug report.

**Doesn't:** replay raw sensor inputs (CoreMotion + GPS + Bluetooth)
through fresh Swift code. That requires extracting the decision logic
out of `BackgroundLocationModule.swift` into pure functions with unit
tests — a separate, larger piece of work. Until then, a code change that
regresses a fix will pass the suite UNTIL a new debug report from a user
encountering the regression is scanned. The `scan-latest` flow makes
that scan automatic — but it's still reactive, not proactive.

Cross-link from `PARKING_LOCATION_ACCURACY.md` Change Log only if the
fix changes *location* output. Detection-correctness fixes (was a trip
real? did parking happen? should a camera alert have fired?) live here.
