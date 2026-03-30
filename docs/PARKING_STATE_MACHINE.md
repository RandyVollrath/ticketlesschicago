# Parking State Machine, Departure Matching, Manual Checks, and Address Display

> Extracted from CLAUDE.md. Covers the parking detection state machine (single source of truth), departure matching rules, manual check vs auto-detect paths, and address display requirements.

## Parking State Machine — Single Source of Truth

The Android parking detection state machine (`ParkingDetectionStateMachine.ts`) is the **single source of truth** for whether the user is driving or parked. Departure tracking DEPENDS on this state machine being in the correct state.

### The Invariant
**Departure tracking ONLY works if the state machine transitions from PARKED → DRIVING.**

If the state machine is in IDLE when the user drives away, departure is silently never recorded. The parking history record exists but has no departure timestamp.

### What Triggers State Machine Transitions
| Trigger | State Transition | Effect |
|---------|-----------------|--------|
| BT disconnect + 10s debounce | DRIVING → PARKING_PENDING → PARKED | `handleCarDisconnection()` |
| BT connect while PARKED | PARKED → DRIVING | `handleCarReconnection()` → departure recorded |
| BT connect while IDLE | IDLE → DRIVING | Camera alerts start, GPS caching starts, **NO departure** |
| Manual parking check | No change (was broken) | Parking recorded to history but state machine untouched |

### The Bug Pattern (Don't Repeat This)
When adding ANY new way to record parking (manual check, server restore, periodic backup, etc.), you MUST also transition the state machine to PARKED. Otherwise:
1. Parking shows in history ✓
2. User drives away
3. State machine is IDLE → DRIVING (not PARKED → DRIVING)
4. `handleCarReconnection()` never called
5. Departure never recorded
6. User sees "Departure not recorded" in history

### Rules for Any Parking-Related Code
1. **ALL parking operations must go through the state machine.** Never write to parking history without also ensuring the state machine is in PARKED state.
2. **Check the state machine before assuming departure will be tracked.** If `ParkingDetectionStateMachine.state !== 'PARKED'`, departure will NOT be captured.
3. **New entry points for parking MUST call `manualParkingConfirmed()` or equivalent.** This includes: manual checks, server restore, periodic backups, any future "assume parked" logic.
4. **The state machine persists to AsyncStorage.** On app restart, it restores to the last stable state (PARKED or DRIVING). If the parking record was from a code path that didn't update the state machine, the restored state will be wrong.

### How to Test Departure Tracking
After any parking-related code change, test ALL entry points:
- [ ] **Auto-detected parking**: BT disconnect → parking check → drive away → departure recorded
- [ ] **Manual parking check**: Tap "Check My Parking" → drive away → departure recorded
- [ ] **App restart while parked**: Kill app → reopen → drive away → departure recorded

## Departure Matching — `findBestLocalHistoryItemId` Rules

`findBestLocalHistoryItemId()` in `BackgroundTaskService.ts` matches a departure event to the correct parking record in local history. It finds the closest parking record (by timestamp) that doesn't already have departure data.

### The Invariant
**A departure can only be for a parking event that happened BEFORE the departure.** The function MUST only consider parking records with `timestamp <= departureTimestamp`. Never use `Math.abs()` for this — it allows matching a newer parking record, producing the impossible state `departure_confirmed_at < parked_at`.

### How It Broke (Feb 2026)
The original code used `Math.abs(item.timestamp - referenceTimestamp)` to find the "closest" parking record. When a false positive created two parking records close together in time, the departure from the second parking got matched to the first (which had the closer absolute distance), producing a departure time before the parking time.

### Rules
1. **Only consider parking records where `item.timestamp <= referenceTimestamp`** — a departure cannot precede its parking event.
2. **Sort by `referenceTimestamp - item.timestamp` (ascending)** — prefer the most recent parking record that's still before the departure.
3. **Cap at 24h** — don't match departures to parking events from days ago.
4. **`pending.localHistoryItemId` takes priority** — it was matched when departure first started and is more reliable than re-matching later.
5. **Prefer non-recovery records over recovery records (fixed Mar 2026):** When the closest candidate by time is from recovery (`locationSource` starts with `recovery_`) and a non-recovery candidate exists within 30 min, prefer the non-recovery one. Recovery records can have drifted CLVisit coords → wrong addresses, while normal pipeline records have accurate GPS.

## Parking History — Manual Checks Must NOT Save to History

Only auto-detected parking (BT disconnect on Android, CoreMotion on iOS) should save to parking history. Manual "Check My Parking" checks must NOT save to history because they use the user's current phone GPS, which may be blocks away from the car — inaccurate locations invalidate ticket contest evidence.

### Two Separate Paths (Don't Confuse Them)

| Path | Saves to History? | Saves to Hero Card? | GPS Source |
|------|-------------------|---------------------|------------|
| **Auto-detect** (BT disconnect / CoreMotion) | YES — `persistParkingEvent=true` | YES | Car location (at moment of disconnect) |
| **Manual "Check My Parking"** (HomeScreen button) | NO — `persistParkingEvent=false` | YES | Phone location (wherever user is standing) |

### Why Manual Checks Don't Save
Manual checks use `LocationService.checkParkingLocation()` which gets a fresh GPS fix from the phone. If the user walked 3 blocks from their car before tapping the button, the history would record the wrong address. Auto-detect captures GPS at the moment of BT disconnect (while still near the car) and is far more accurate. History records are used as evidence in ticket contests — they must be location-accurate.

### Interference Between Paths
These two paths are designed to NOT interfere with each other:
1. **Throttle**: Only applies when `isRealParkingEvent=false`. Both manual and auto-detect pass `true`, so neither throttles the other.
2. **Hero card**: Both write to `LAST_PARKING_LOCATION` (the hero card display). A manual check can overwrite the hero card, but that's cosmetic — history is unaffected.
3. **Parked coords / rescan / snow monitoring**: Only saved when `persistParkingEvent=true` (auto-detect). Manual checks don't overwrite these.
4. **State machine**: Manual check calls `ParkingDetectionStateMachine.manualParkingConfirmed()` (IDLE→PARKED) so departure tracking still works. Auto-detect goes through DRIVING→PARKING_PENDING→PARKED. These are separate transitions that don't conflict.

### Rules
1. **Manual checks: `persistParkingEvent=false`.** This skips history save, server save, and parked coords save.
2. **Auto-detect checks: `persistParkingEvent=true`.** This is the ONLY path that writes to history.
3. **Never add `ParkingHistoryService.addToHistory()` to the manual check path.** If auto-detect isn't working, fix auto-detect — don't paper over it with manual saves.
4. **Both paths must still update the state machine.** Manual check uses `manualParkingConfirmed()`, auto-detect uses the normal BT disconnect flow. Without state machine updates, departure tracking breaks.

### How to Test
- [ ] **Auto-detect parking**: BT disconnect → open History tab → entry exists with accurate car location
- [ ] **Manual "Check My Parking"**: Tap button → hero card shows result → History tab does NOT have a new entry
- [ ] **Manual then auto-detect**: Tap button → BT disconnect fires → History has ONE entry (from auto-detect only)
- [ ] **Departure after manual check**: Tap "Check My Parking" → drive away → departure recorded (state machine was set to PARKED)

## Address Display — NEVER Show Raw Coordinates

Users must always see human-readable street addresses (e.g. "1234 N Western Ave"), never raw coordinates ("41.939123, -87.667456") or near-coordinate fallbacks ("Near 41.9391, -87.6675"). Raw coordinates are a bug.

### Defense Layers (All Must Be Present)
1. **Server-side geocoding** (`pages/api/mobile/check-my-parking.ts`): Nominatim → Google Maps → null. This handles 99% of cases.
2. **Client-side fallback** (`ClientReverseGeocoder.ts`): If server returns coordinates or null, the mobile client retries via Nominatim directly. 5s timeout, returns `null` on failure.
3. **Display-time guard** (`HistoryScreen.tsx`): `isCoordinateAddress()` checks every address before display. If it's coordinates, shows "Resolving address..." and triggers background resolution.
4. **Startup backfill** (`HistoryScreen.tsx`): On mount, scans all history entries for coordinate-only addresses and resolves them via Nominatim with 1.1s rate limiting.
5. **Deferred backfill** (`BackgroundTaskService.ts`): If a parking entry is saved with coordinates (API failure), schedules exponential-backoff retry at 60s/3min/9min.

### Utility: `ClientReverseGeocoder.ts`
- `isCoordinateAddress(address)`: Returns true if address is raw coords or "Near X, Y"
- `formatCoordinateFallback(lat, lng)`: Returns user-friendly "Near X, Y" (last resort)
- `resolveAddress(address, lat, lng)`: Full chain — if address is real, return it; else try client Nominatim; else return "Near X, Y"

### Rules
1. **Every code path that stores or displays an address MUST check `isCoordinateAddress()`.** If true, resolve it or show a loading state — never display coordinates to the user.
2. **`ParkingHistoryService.addToHistory()` MUST use `formatCoordinateFallback()` instead of raw coordinate strings** when the address is null/undefined.
3. **Server responses that contain coordinate-only addresses** (geocoding failure) MUST be caught and resolved client-side before storage.
4. **The Nominatim User-Agent** must identify the app: `'TicketlessChicago/1.0 (parking app)'`. Nominatim blocks requests without a User-Agent.
