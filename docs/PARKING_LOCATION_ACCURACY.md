# Parking Location Accuracy

**Read this document EVERY TIME before making changes to parking location detection.**

## Golden Rule

**The parking location is where the CAR is, not where the PHONE is.**

GPS must be captured at the moment the car stops — never after walking begins. Any "refinement" that runs after the user starts walking makes accuracy WORSE, not better.

## Known Failure Modes (with real examples)

### 1. Walk-Away Drift (THE #1 PROBLEM as of April 2026)

The phone captures GPS after the user has already started walking away from the car. The coordinates are accurate for the phone's position but wrong for the car.

**Real example (2026-04-11):** User parked on Belden near Kenmore. Walked east on Belden toward Sheffield, then turned south on Sheffield. GPS captured after walking = near Sheffield. Snap correctly found Belden at 6.6m, heading (89° E-W) confirmed Belden. But Nominatim saw the walked-to GPS position near Sheffield and OVERRODE the correct snap result. Two bugs: (1) GPS captured too late (walk-away), (2) Nominatim overrode a heading-confirmed snap.

**Fix (2026-04-12):** When heading confirms the snap's orientation (snap=E-W street + heading=E-W), Nominatim is no longer allowed to override. The agreement between two independent signals (snap geometry + heading direction) outweighs Nominatim looking at a potentially walked-away GPS point.

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

## Working Thesis (as of April 2026)

**The parking location should come from the LAST DRIVING GPS fixes, not from any post-parking GPS.**

The most reliable parking location is the inverse-variance weighted average of GPS fixes captured while the car was still moving (speed > 1 m/s). These fixes:
1. Were captured when GPS heading was valid (moving = reliable heading)
2. Cluster around the car's actual path and stopping point
3. Predate any walking the user does after parking
4. Are immune to walk-away drift (the #1 accuracy problem)

**Implementation:**
- **iOS:** `recentLowSpeedLocations` buffer (up to 10 CLLocation fixes at speed < 3 m/s), inverse-variance weighted average, emitted as `averagedLatitude`/`averagedLongitude`
- **Android:** `drivingGpsBuffer` ring buffer (up to 10 fixes at speed > 1 m/s from watchPosition), inverse-variance weighted average, used as PRIMARY parking location before any fresh GPS fix
- **Both platforms:** The stop-detection GPS (iOS `locationAtStopStart`, Android cached driving position) is the fallback. Fresh GPS (`getCurrentLocation`) is the LAST resort, and is blocked when walking evidence exists or when the fresh fix is >20m from the stop candidate.

**Never override a driving-buffer or stop-candidate location with a "more accurate" post-walking fix.** A 30m-accuracy fix at the car beats a 5m-accuracy fix at the coffee shop 50m away.

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
- Phase 3: Meter proximity cross-check, intersection detection (PARTIAL — two-source-geocoder override at intersections shipped 2026-04-30 in `pages/api/mobile/check-parking.ts`. When `near_intersection: true` AND Apple Maps' thoroughfare matches Nominatim's street (both disagreeing with the snap), the snap is overridden — defeats the stale-GPS-heading-at-corner failure mode from 2026-04-11.)
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

## Source-Attribution Diagnostic Loop (2026-05-08)

When the app gets a park wrong, run the side-by-side audit:

```bash
node scripts/parking-source-attribution.js --user <email> --limit 1
```

This prints the final answer next to every source's vote (snap initial, snap final after disambiguation, Nominatim, Mapbox reverse, Mapbox map-match, Apple geocode, GPS heading, compass heading) plus the override-trail metadata. Tells you in seconds **which source got it right and which one was outvoted** — without grepping logs.

To close the loop, the user reports ground truth via the in-app feedback prompt (or `pages/api/mobile/parking-feedback.ts`); the script then surfaces user_confirmed_block / corrected_address alongside every source.

## Source Reliability Table (what we know so far)

| Source | When it shines | When it fails | Who it overrules |
|---|---|---|---|
| PostGIS snap (closest centerline) | Mid-block parks with clean GPS | Intersections — closest line is the cross street. Urban canyon drift. | Default winner unless something overrides it |
| Heading disambiguation (GPS course) | Driving straight up to the stop | Stale after turns (1 m/s threshold leaves last fix from prior street) | Picks among snap candidates |
| Heading disambiguation (compass) | Phone is in a cradle / holster while parked, captured immediately at stop | Hand-held phone, magnetic interference (CarPlay, dashboard) | Replaces stale GPS heading when both classify to different grid orientations |
| Trajectory median heading | Long approach on one street | Short final segment after a turn (the relevant block) | Backup when per-fix GPS heading missing |
| Trajectory candidate vote (10 driving points) | Long approach on one street | Same — the 9 fixes from BEFORE the turn drown out the 1 fix from after | Confirms or rejects close-snap pick |
| Nominatim (OSM reverse-geocode) | Mid-block GPS far from any cross street | Walk-away drift; intersection corners (picks whichever way's polyline is closest, not the one the car is on) | Overrides snap when both name a candidate AND no heading contradicts |
| Mapbox reverse (Geocoding v6) | Has address-level numbers (e.g. "West Belden Avenue 1026") | Returns confidence=0 frequently in dense Chicago — gets discarded | Currently only **confirms** Nominatim; only **promotes** over Nominatim when snap distance > 50m |
| Mapbox map-matching (trajectory) | Genuine moving drive ending at the stop | Stationary parked-car traces return matched=true / confidence=0 / empty street (verified rows 48/50/55) | Promotes when confidence ≥ 0.5 (rare in practice) |
| Apple CLGeocoder | iOS only; fresh address pulled at park time, distinct DB | iOS only; sometimes blank thoroughfare | Triggers `two_source_intersection_override` when it agrees with Nominatim against snap at a corner |
| Grid estimator (lib/chicago-grid-estimator.ts) | Side-of-street parity from cross product | Rounds at block boundaries — odd/even can flip | Forces parity correction on snap result |
| Building footprint lookup | Side parity confirmation | Only useful where buildings are tagged with the same parity | Final tiebreaker on side |

## Factors that go into the final location decision

1. **Raw GPS fix** captured at stop-detection (the moment speed → 0).
2. **Driving GPS buffer / `recentLowSpeedLocations`** — last 10 fixes while moving, inverse-variance weighted (iOS) or burst-sampled (Android).
3. **GPS accuracy** (HDOP).
4. **GPS heading** (course) — only valid when speed > 1 m/s.
5. **Compass heading** — magnetometer, captured fresh at park time, 10 samples circular mean (iOS).
6. **Trajectory** — last ~10 driving GPS points used for both median heading AND per-candidate "fixes near this centerline" voting.
7. **CarPlay disconnect timestamp + lat/lng** (iOS) — sharper "parking moment" anchor and trajectory truncation point.
8. **PostGIS snap** to nearest centerline within 25/50m search radius.
9. **All snap candidates** within search radius (used by heading disambiguation).
10. **Nominatim reverse-geocode** of raw GPS → OSM road name.
11. **Mapbox reverse-geocode** (Geocoding v6) of post-correction GPS → address with house number + match-confidence.
12. **Mapbox map-matching** of full trajectory → road segment + per-point confidence.
13. **Apple CLGeocoder** (iOS) — thoroughfare + sub-thoroughfare from Apple's DB, sent in body.
14. **Chicago street-name list** — `getChicagoStreetOrientation()` classifies each street as N-S or E-W.
15. **Building footprints** with parity tags — used for side-of-street confirmation.
16. **"Near intersection?" classifier** — diag.near_intersection set when ≥2 candidates within ~15m.
17. **Walk-away guard** — suppresses notifications when heading evidence is internally inconsistent (>50° disagreement).

## System Improvement Plan

**Goal:** every miss yields a labeled training example so we can quantify which sources are most reliable in which scenarios, instead of relying on case-by-case fixes.

**Phase 1 — Capture (DONE 2026-05-08):**
- `pre_nominatim_snap` snapshot in `native_meta` on every parking diagnostic. Now we know what snap chose **before** any override.
- `scripts/parking-source-attribution.js` for human side-by-side audit.

**Phase 2 — Label (next):**
- Lightweight in-app prompt after every park: tap the address bar to "fix" it. Drops a corrected_address into parking_feedback.
- Periodic admin push: "Was this address right?" with the diag id, so unconfirmed events convert to labeled examples.
- Goal: ≥30 user-confirmed events covering intersections, urban canyons, post-turn parks.

**Phase 3 — Score (after ≥30 labels):**
- For each source, compute: agreement rate with ground truth, conditional on (near_intersection, snap_distance bucket, heading_source, urban canyon proxy).
- Output a per-scenario reliability matrix that drives override priorities, not hard-coded heuristics.
- Specifically test: "When compass and GPS heading classify to different orientations, which source wins more often?" — preliminary data (2026-05-08 Belden case) supports compass; we need volume.

**Phase 4 — Replace heuristics with weighted vote (after Phase 3):**
- Each source produces a (street, side, house_number, confidence) tuple.
- Final answer = weighted vote per the reliability matrix, conditioned on scenario features.
- Override paths today (`nominatim_override_candidate_match`, `two_source_intersection_override`, `mapbox_match_candidate`, etc.) become outputs of the same vote function, not separate code paths.

**Phase 5 — Active learning:**
- When sources disagree by a wide margin AND we don't have a confident winner, prompt the user *before* choosing — turn ambiguity into a label instead of guessing.

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
| 2026-04-12 | Nominatim override guard | Don't let Nominatim override snap when heading confirms snap orientation |
| 2026-04-12 | Android driving GPS ring buffer | Use last 10 driving fixes (weighted avg) as PRIMARY parking location instead of post-parking fresh GPS |
| 2026-04-12 | iOS stop-candidate protection | Never consider stop candidate "weak" when walking. Add 20m proximity guard for refinement. |
| 2026-04-13 | Keep close snap even if heading disagrees | Snap < 15m is strong geometric evidence; stale heading after a turn should not override it |
| 2026-04-13 | Don't let heading protect extended/far snaps from Nominatim | Extended search (>25m) driven by stale heading can find wrong street; Nominatim overrides these |
| 2026-05-08 | Compass heading allowed to contradict Nominatim | Belden/Kenmore case: GPS heading was stale after turn, compass was the chosen disambiguator, but Nominatim override only checked GPS — silently flipping the correct compass-disambiguated snap. Fix: when `effectiveHeadingSource === 'compass'` and snap < 25m, compass orientation contradicts Nominatim → block override. |
| 2026-05-08 | Pre-Nominatim snap captured in native_meta | Diagnostic script can now show what snap chose before any override fired |
| 2026-05-08 | `scripts/parking-source-attribution.js` | One command prints every source's vote side-by-side for a parking event |
