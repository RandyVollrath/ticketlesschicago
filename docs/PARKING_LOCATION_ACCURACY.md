# Parking Location Accuracy

**Read this document EVERY TIME before making changes to parking location detection.**

## Golden Rule

**The parking location is where the CAR is, not where the PHONE is.**

GPS must be captured at the moment the car stops — never after walking begins. Any "refinement" that runs after the user starts walking makes accuracy WORSE, not better.

## Known Failure Modes (with real examples)

### 1. Walk-Away Drift (THE #1 PROBLEM as of April 2026)

The phone captures GPS after the user has already started walking away from the car. The coordinates are accurate for the phone's position but wrong for the car.

**Real example (2026-04-11):** User parked on Belden near Kenmore. Walked south toward Sheffield. GPS captured after walking = "2320 N Sheffield." The snap-to-street correctly found Belden at 6.6m, but Nominatim saw the walked-to position and overrode to Sheffield.

**Real example (2026-04-12):** User parked on Wolcott near Lawrence. Walked toward Lawrence. GPS captured after walking = "2047 W Lawrence." Both snap AND Nominatim agreed on Lawrence because the phone was already 5.5m from Lawrence's centerline.

**Fix (implemented 2026-04-12):** Freeze parking location at stop-detection moment. Never update with post-walking GPS. If CoreMotion/accelerometer detects walking, lock the location.

### 2. Stale GPS Heading After Turns

GPS heading requires speed > 1 m/s. When you slow down, turn, and park, the last heading is from BEFORE the turn.

**Real example (2026-04-11):** Heading 89deg (east, from driving on Lawrence) used to disambiguate at Belden/Sheffield intersection. Heading was actually from the previous street.

**Fix (implemented 2026-04-10):** Nominatim cross-reference detects orientation mismatch and discards stale heading. Compass heading (magnetometer, works at zero speed) added as primary signal on iOS (2026-04-12).

### 3. House Number Rounding (Odd/Even Parity)

Grid estimator rounds to nearest integer. On the boundary between 4759 and 4760, rounding is a coin flip. Odd = east side, even = west side in Chicago.

**Real example (2026-04-10):** Parked on east side of Rockwell. Grid estimated 4760 (even = west). Wrong side.

**Fix (implemented 2026-04-10):** SnapGeometry cross-product determines which side of the street centerline the GPS point is on, forces correct odd/even parity.

### 4. Wrong Street at Intersections

Two streets within 15m. Heading-based disambiguation fails when heading is stale.

**Mitigation:** Nominatim cross-reference, compass heading (when available). Future: intersection detection with dual-street fallback (Phase 3 of accuracy plan).

### 5. GPS Urban Canyon Drift (10-30m)

Buildings deflect GPS signals systematically. A 25m drift near an intersection can put you on the wrong street entirely.

**Mitigation:** Snap-to-street corrects for this. Future: per-block GPS correction model learned from parking history (Phase 4 of accuracy plan).

## Architecture: How Parking Location Is Captured

### iOS (`BackgroundLocationModule.swift`)
1. CoreMotion detects automotive -> stationary transition
2. `locationAtStopStart` captures CLLocation at the moment speed drops to ~0
3. `recentLowSpeedLocations` buffer collects GPS fixes when speed < 3 m/s (last 10)
4. At parking finalization: inverse-variance weighted average of coherent fixes
5. `compassHeading` collected via CLLocationManager magnetometer (10 samples, circular mean)
6. Event emitted with: lat, lng, accuracy, heading, compassHeading, averagedLat/Lng

### Android (`BackgroundTaskService.ts`)
1. Bluetooth disconnect triggers parking detection
2. `LocationService.getCurrentLocation('high')` gets a fresh GPS fix
3. Burst sampling: 8 samples over 10s, outlier filtering, inverse-variance averaging
4. `lastDrivingHeading` injected if current heading unavailable
5. Coordinates sent to server API

### Server (`check-parking.ts`)
1. Snap-to-street (PostGIS): finds nearest street centerline within 25-50m
2. Heading-based disambiguation: picks street matching heading orientation
3. Nominatim cross-reference: validates snap against OSM road identification
4. Grid estimation: estimates house number from Chicago's address grid
5. Side-of-street: SnapGeometry cross-product for parity, heading for side

## Rules for Future Changes

1. **NEVER use GPS fixes captured after walking starts.** The car doesn't move. The phone does.
2. **NEVER trust GPS heading at low speed.** Below 1 m/s, GPS heading is noise. Use compass (magnetometer) or last valid driving heading.
3. **NEVER override a snap-to-street result with Nominatim when the GPS point has walked away from the car.** Nominatim is accurate for where the phone IS, not where the car WAS.
4. **Test with real parking events.** Check Vercel logs for `[check-parking]` messages. Verify street name, side, and address against actual parking location.
5. **Log the full decision chain.** Every parking check should log: snap result, heading source, Nominatim result, address, side determination. Without logs, we can't debug.
6. **Prefer the earliest accurate GPS fix.** The first fix at stop time is closest to the car. Later fixes are further from the car.
7. **Measure before and after.** Before deploying accuracy changes, log 5+ real parking events and compare results.

## Accuracy Improvement Plan

See `/home/randy-vollrath/.claude/plans/magical-hugging-quail.md` for the full phased plan:
- Phase 1: Inverse-variance GPS averaging, burst window increase (DONE)
- Phase 2: Compass heading at park time (DONE - iOS, pending Android)
- Phase 3: Meter proximity cross-check, intersection detection (TODO)
- Phase 4: Per-block GPS correction model (TODO)
- Phase 5: Smart side-of-street confirmation prompt (TODO)

## Key Files

| File | What it does |
|------|-------------|
| `TicketlessChicagoMobile/ios/.../BackgroundLocationModule.swift` | iOS parking detection, GPS capture, compass heading |
| `TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` | Android parking orchestration, GPS acquisition |
| `TicketlessChicagoMobile/src/services/LocationService.ts` | GPS burst sampling, API call to server |
| `pages/api/mobile/check-parking.ts` | Server: snap, disambiguate, geocode, check restrictions |
| `lib/chicago-grid-estimator.ts` | House number estimation, side-of-street parity |
| `lib/reverse-geocoder.ts` | Nominatim + grid + Google geocoding |
| `lib/metered-parking-checker.ts` | Side-of-street determination, meter filtering |
| `supabase/migrations/20260226_create_snap_to_nearest_street.sql` | PostGIS snap function |

## Change Log

| Date | Change | Result |
|------|--------|--------|
| 2026-04-10 | SnapGeometry cross-product for house number parity | Fixed Rockwell east/west misidentification |
| 2026-04-10 | Discard heading on Nominatim street override | Prevents stale heading from forcing wrong street |
| 2026-04-12 | iOS inverse-variance GPS averaging | Better position from mixed-quality fixes |
| 2026-04-12 | Android burst sampling 5/6s -> 8/10s | More samples for tighter average |
| 2026-04-12 | iOS compass heading (CLLocationManager) | Fresh heading at zero speed, eliminates stale heading |
| 2026-04-12 | Server compass heading preference | Compass used as primary heading signal when available |
| 2026-04-12 | Walk-away drift fix | Freeze location at stop-detection, reject post-walking GPS |
