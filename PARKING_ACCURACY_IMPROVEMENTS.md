# Parking Accuracy Improvements — Ongoing Tracker

This document tracks known parking detection accuracy issues, root cause analyses, and fixes. It serves as a living record to prevent regressions and guide future tuning.

---

## Summary of Known Problem Classes

| # | Problem | Status | First Observed |
|---|---------|--------|----------------|
| 1 | Red-light false positives (CoreMotion-only path too lenient) | **Fixed Mar 14 2026** | Jan 2026 |
| 2 | Cascade: false parking blocks real parking detection | **Fixed Mar 14 2026** | Mar 2026 |
| 3 | Recovery emits parking with wrong timestamp | Mitigated | Feb 2026 |
| 4 | CLVisit coordinate drift on recovery re-emit | Fixed | Feb 2026 |
| 5 | `lastConfirmedParkingLocation` dedup insufficient for multi-trip recovery | Fixed | Feb 2026 |

---

## Incident: 2026-03-14 — Grace & Lincoln False Positive + Byron St Missed/Delayed

### What Happened

1. **~7:00 PM** — User stopped at a red light at **Grace St & Lincoln Ave**. The system falsely confirmed this as parking, recorded as "3606 N Lincoln Ave".
2. **~7:03 PM** — User parked for real at **1857 W Byron St** (~1 mile away). The normal pipeline did NOT detect this parking.
3. **~9:00 PM** — The `checkForMissedParking` recovery picked up the Byron parking from CoreMotion history, but the event was emitted hours late with degraded context.

### Root Cause Analysis

#### Issue 1: False parking at Grace & Lincoln (red light)

**Detection path that fired**: `handlePotentialParking()` → 8s debounce → `confirmParking(source: "coremotion")`.

**The problem was simple**: The CoreMotion-only path had NO GPS speed check. It confirmed parking after just 8 seconds of CoreMotion saying "not automotive" — which happens at any red light when the engine is idling quietly. The stricter `gps_coremotion_agree` path requires 10s of GPS speed ≈ 0 + 6s CoreMotion stability + walking/45s-zero-speed/car-disconnect evidence. But the CoreMotion-only path bypassed ALL of that.

**Why other guards didn't help:**
- **Intersection risk check**: Grace & Lincoln has no red-light or speed camera in the dataset, so `isNearSignalizedIntersection()` returned false. No -20 confidence penalty.
- **Confidence score**: Without intersection penalty: `zeroDurationSec >= 20` (+25) + `nonAutoStableSec >= 6` (+20) = **45** (well above the 35 cutoff).
- **Post-confirm unwind**: Had a `likelyFalsePositive` gate requiring intersection risk OR confidence < 65 OR "no_walking" hold reason. None were true for this event, so the unwind never fired even when the user drove away.

#### Issue 2: Byron St parking missed, caught hours late by recovery

**The cascade from the Grace & Lincoln false positive:**

1. False parking confirmation set `isDriving = false`, `hasConfirmedParkingThisSession = true`, stopped GPS.
2. User drove ~1 mile to Byron. The 50m distance bypass allowed `isDriving = true` again eventually, but the drive was very short.
3. `postConfirmUnwind` should have caught the false positive when the user resumed driving (speed >= 3.0 m/s, moved >= 85m within 120s). But the `likelyFalsePositive` confidence gate blocked it. Even if it had fired, it only cleared parking state — it did NOT restart `isDriving`, so the next parking detection depended on the full CoreMotion → GPS speed veto → `isDriving = true` cycle completing in time.
4. Result: Byron parking at 7:03 PM was invisible to the normal pipeline. `checkForMissedParking()` found it in CoreMotion history when the app was opened at ~9 PM.

---

## Fixes Implemented (Mar 14, 2026)

### Fix A: CoreMotion path now requires GPS speed confirmation or walking evidence

**File**: `BackgroundLocationModule.swift` — `handlePotentialParking()`

**Before**: After 8s CoreMotion debounce, called `confirmParking()` directly. No GPS speed check. A red light with quiet engine → false positive in 8 seconds.

**After**: After 8s CoreMotion debounce:
- **If walking detected** (`coreMotionWalkingSince >= 4s`): Confirm immediately via `confirmParking(source: "coremotion_walking")`. Walking = user exited car = definitely parked. No GPS wait needed.
- **If no walking**: Do NOT confirm. Log a `coremotion_deferred_to_gps` decision and let the `speedZeroTimer` (already running in parallel) handle it. The speedZeroTimer uses the `gps_coremotion_agree` path which requires: GPS speed ≈ 0 for 10s + CoreMotion stable for 6s + EITHER walking evidence OR 45s of zero speed OR car disconnect evidence.

**Effect on real parking**: When the user parks and walks away from the car (the common case), walking evidence fires within 4-8s and parking is confirmed immediately — no slower than before. When the user parks and stays in the car (reading phone, etc.), the `gps_coremotion_agree` path confirms after ~10-15s of GPS speed ≈ 0. Slightly slower but more accurate.

**Effect on red lights**: The red light ends, user drives off, `speedSaysMoving` becomes true, speedZeroTimer is cancelled. No false positive.

**Parking location accuracy**: The `locationAtStopStart` is captured at the moment CoreMotion exits automotive (before the debounce/GPS wait). So even if confirmation takes 20-45s (user walking away), the recorded location is where the car stopped, not where the user is standing.

### Fix B: Post-confirm unwind now restarts `isDriving` and removes confidence gate

**File**: `BackgroundLocationModule.swift` — `maybeUnwindRecentParkingConfirmation()`

**Two changes:**

1. **Removed `likelyFalsePositive` confidence gate**: Previously required one of: `nearIntersectionRisk`, confidence < 65, or "no_walking" hold reason. This gate missed the Grace & Lincoln false positive because none were true. Now: if the user drives 85m+ at 3+ m/s within 120s of parking confirmation, it is ALWAYS a false positive — no exceptions.

2. **Restarts driving pipeline**: Previously only cleared parking state (`hasConfirmedParkingThisSession = false`, etc.). Now also sets `isDriving = true`, `drivingStartTime = Date()`, starts GPS, and marks `speedSaysMoving = true`. This means the next real parking event will be detected normally by the standard pipeline, even on short subsequent drives.

**Effect**: If Fix A somehow fails (edge case we haven't thought of) and a false positive slips through, Fix B catches it as a safety net and fully restores the driving pipeline. The next parking is detected normally — no cascade to recovery.

---

## The Intersection Penalty — Simple Explanation

The "intersection risk" system is a **red-light false positive guard** that works like this:

1. The app has a database of ~510 Chicago camera locations (red-light + speed cameras).
2. When parking is about to be confirmed, it checks: "Is this location within 95m of any camera?"
3. If yes: it subtracts 20 points from the confidence score AND requires the stop to be 18s+ before allowing confirmation.
4. The idea is: cameras are at signalized intersections. If you're near one and stopped briefly, you're probably at a red light.

**Why it didn't help at Grace & Lincoln**: There's no camera at that intersection. The nearest camera is at Lincoln/Belmont/Ashland, over a mile south. So the check returned false — no penalty applied. The intersection penalty only works at intersections WITH cameras, which is a small subset of all Chicago intersections.

**Why Fix A is better**: Instead of trying to identify every intersection in Chicago (impossible), Fix A makes the CoreMotion-only path require GPS speed confirmation OR walking evidence. Red lights are inherently temporary — the user drives away after 30-90s. Requiring GPS zero-speed evidence means the speedZeroTimer gets cancelled when the light turns green. No intersection database needed.

---

## Historical False Positive Locations

| Location | Intersection Type | Issue | First Seen | Status |
|----------|------------------|-------|------------|--------|
| Grace St & Lincoln Ave | Standard | CoreMotion exits automotive at idle, no camera in DB | Mar 2026 | Fixed (Fix A) |
| Lincoln/Belmont/Ashland | 6-way | Long red phases (60-90s), hard timeout could trigger | Jan 2026 | Mitigated (90s timeout) |
| Ashland & Fullerton | Standard | 30-90s red lights, CoreMotion flicker | Feb 2026 | Fixed (Fix A) |
| Clybourn & Diversey | Angled | Short cycling, GPS drift | Jan 2026 | Fixed (ring buffer dedup) |

---

## Tuning History

| Date | Change | Parameter | Old / New | Reason |
|------|--------|-----------|-----------|--------|
| Jan 2026 | Raised CoreMotion debounce | `exitDebounceSec` | 3s → 5s → 8s | False positives at Ashland & Fullerton |
| Jan 2026 | Added intersection dwell guard | `intersectionDwellMinStopSec` | N/A → 18s | Block parking near cameras with short stops |
| Jan 2026 | Raised GPS hard timeout | `gpsZeroSpeedHardTimeoutSec` | 45s → 90s | 6-way intersections last > 45s |
| Feb 2026 | Raised no-walking minimum | `minZeroSpeedNoWalkingSec` | 20s → 45s | 20s stop is easily a long red light |
| Feb 2026 | Added confidence scoring | `parkingDecisionConfidenceScore()` | N/A | Multi-factor scoring |
| Feb 2026 | Added post-confirm unwind | `maybeUnwindRecentParkingConfirmation()` | N/A | Detect and reverse false positives |
| Feb 2026 | Added ring buffer dedup | `isAlreadyConfirmedParking()` | N/A | Recovery re-emitting already-confirmed events |
| Mar 2026 | Added CLVisit departure GPS boost | `startBootstrapGpsWindow("clvisit_departure")` | N/A | Catch short drives missed by CoreMotion |
| **Mar 14 2026** | **CoreMotion path requires GPS speed or walking** | `handlePotentialParking()` | **Direct confirm → defer to GPS** | **Grace & Lincoln red-light false positive** |
| **Mar 14 2026** | **Unwind restarts isDriving + removes confidence gate** | `maybeUnwindRecentParkingConfirmation()` | **Clear only → full driving restart** | **Byron St cascade failure** |

---

## How Parking Detection Works Now (Post-Fix A/B)

### Path 1: Walking detected (fastest — ~12s)
CoreMotion exits automotive → 8s debounce → walking evidence >= 4s → `confirmParking("coremotion_walking")` → finalization hold (5-11s) → done.

### Path 2: GPS speed confirms (standard — ~18-25s)
CoreMotion exits automotive → speedZeroTimer starts checking every 3s → GPS speed ≈ 0 for 10s + CoreMotion stable 6s + (walking OR 45s zero OR car disconnect) → `confirmParking("gps_coremotion_agree")` → finalization hold → done.

### Path 3: GPS hard timeout (safety net — ~90s)
GPS speed ≈ 0 for 90s straight → `confirmParking("gps_speed_zero_timeout")` → done. Overrides stuck CoreMotion.

### Path 4: Location stationary (rare — ~120s)
Phone hasn't moved within 50m for 2+ min → `confirmParking("location_stationary")` → done.

### Red light behavior (no false positive)
CoreMotion exits automotive → 8s debounce → no walking → deferred to GPS → speedZeroTimer ticks every 3s → light turns green → user drives → `speedSaysMoving = true` → speedZeroTimer cancelled → no parking event.

### Safety net: False positive still slips through
Parking confirmed → user drives away → `maybeUnwindRecentParkingConfirmation` fires (speed >= 3m/s, moved >= 85m, within 120s) → parking reversed → `isDriving = true` restarted → hotspot recorded → 30min lockout on that location → next real parking detected normally.

---

## Testing Protocol for Parking Accuracy

After any parking detection change, verify these scenarios on a physical device:

### Red-light false positive prevention
- [ ] Drive through signalized intersection with long red (30s+) → no false parking
- [ ] Drive through Grace & Lincoln → no false parking
- [ ] Stop at red for 60s+ → no false parking (unless walking detected)

### Normal parking detection
- [ ] Park on residential street, walk away → parking detected within 12-20s
- [ ] Park near signalized intersection, walk away → parking detected within 12-20s
- [ ] Park and stay in car (no walking) → parking detected within 45-55s (gps_coremotion_agree)
- [ ] Park and stay in car > 90s → parking detected (hard timeout)

### Cascade prevention (THE CRITICAL TEST)
- [ ] Stop at red light (30s+) → drive to destination (~1 mile) → park → real parking detected immediately by normal pipeline, NOT by recovery hours later
- [ ] If false positive somehow fires → drive 85m+ → unwind fires → drive to destination → park → parking detected normally

### Recovery accuracy
- [ ] Kill app while parked → reopen hours later → recovery parking has correct timestamp
- [ ] Two parking events in history → recovery deduplicates, no re-emit

---

## Key Code References

| Component | File | Key Lines (approx) |
|-----------|------|-----------|
| CoreMotion parking trigger | `BackgroundLocationModule.swift` | handlePotentialParking() |
| GPS+CoreMotion agree path | `BackgroundLocationModule.swift` | speedZeroTimer callback |
| GPS hard timeout (90s) | `BackgroundLocationModule.swift` | gpsZeroSpeedHardTimeoutSec |
| Intersection risk check | `BackgroundLocationModule.swift` | isNearSignalizedIntersection() |
| Confidence scoring | `BackgroundLocationModule.swift` | parkingDecisionConfidenceScore() |
| Post-confirm unwind | `BackgroundLocationModule.swift` | maybeUnwindRecentParkingConfirmation() |
| Finalization + state reset | `BackgroundLocationModule.swift` | finalizeParkingConfirmation() |
| Recovery (missed parking) | `BackgroundLocationModule.swift` | checkForMissedParking() |
| GPS speed veto after parking | `BackgroundLocationModule.swift` | hasConfirmedParkingThisSession guard |
| Ring buffer dedup | `BackgroundLocationModule.swift` | isAlreadyConfirmedParking() |
| Stop location capture | `BackgroundLocationModule.swift` | updateStopLocationCandidate() |
