# Departure Matching Bug Analysis

## User Report
- **4733 N Wolcott Ave**: Departure recorded at 9:16 AM, but this is actually when they left 1901 W Byron St
- **3857 N Lincoln Ave**: False positive parking during drive from Wolcott to Byron, departure would be correct for Wolcott if matched there
- **Pattern**: Each departure got matched to the PREVIOUS parking event (shifted by one position)

## Root Cause: Multiple Sequential `onDrivingStarted` Events

The bug occurs when iOS fires multiple `onDrivingStarted` callbacks in sequence from a single `BackgroundLocationService.startMonitoring()` call. Each call to `onDrivingStarted` triggers a separate departure tracking flow:

### Mechanism

1. **BackgroundLocationModule.swift** (native iOS code) fires callbacks to JavaScript via the `BackgroundLocationService.startMonitoring()` subscription in `BackgroundTaskService.ts` (lines 504-650)

2. Each callback is async and independent. Multiple callbacks can queue up if:
   - User parks, drives to new location, parks again (two `onParkingDetected` + two `onDrivingStarted`)
   - Native CoreMotion detection fires multiple times during a single continuous drive
   - Recovery code (`checkForMissedParking`) emits synthetic parking events that trigger new `onDrivingStarted` callbacks

3. **The critical code path** (lines 622-635):
   ```typescript
   (drivingTimestamp?: number) => {
     this.lastIosDrivingStartedAt = drivingTimestamp || Date.now();
     this.currentDriveSessionId = null;
     // ...
     this.handleCarReconnection(drivingTimestamp);  // FIRES DEPARTURE TRACKING
   }
   ```

4. Each `handleCarReconnection()` call:
   - Calls `markCarReconnected(nativeDrivingTimestamp)` (line 995)
   - Which calls `findBestLocalHistoryItemId(departureTime)` (line 3507)
   - Which finds the most recent parking record WITHOUT a departure
   - Stores it in `this.state.pendingDepartureConfirmation.localHistoryItemId`
   - Schedules `confirmDeparture()` after 60 seconds

## Why Departures Shift by One Position

### Example Scenario: Three-Drive Day

**Real events:**
1. Park at A (1:00 PM)
2. Drive to B (1:30 PM) → `onDrivingStarted` fires
3. Park at B (1:35 PM)
4. Drive to C (2:00 PM) → `onDrivingStarted` fires
5. Park at C (2:05 PM)

**False positive inserted during step 4:**
- False positive parking detected at location X (between B and C, while driving)
- Creates parking record for X
- State machine might transition to PARKED
- Later a legitimate `onDrivingStarted` fires or parking is recovered

**What happens in the bug:**

1. `onDrivingStarted` fires at ~1:30 PM (departure from A)
   - `findBestLocalHistoryItemId(1:30 PM)` searches history
   - Finds: [Parking at A (1:00 PM, no departure)]
   - Matches correctly: A's departure timestamp = 1:30 PM ✓
   - Scheduled: `confirmDeparture()` after 60s

2. `onDrivingStarted` fires at ~2:00 PM (departure from B)
   - `findBestLocalHistoryItemId(2:00 PM)` searches history
   - History now contains:
     - Parking at A (1:00 PM, departure ~1:30 PM) ← HAS DEPARTURE, SKIPPED
     - Parking at X (1:50 PM, no departure) ← FALSE POSITIVE
     - Parking at B (1:35 PM, no departure) ← REAL PARKING
   - Filter (line 3913): `.filter(item => !item.departure && item.timestamp <= referenceTimestamp)`
   - Candidates: [X at 1:50 PM, B at 1:35 PM]
   - **BUG**: Returns X (closest to 2:00 PM reference time)
   - Should return: B (actual parking location before departure)
   - **Result**: Departure from B gets matched to false positive at X instead

## Critical Code Review

### `findBestLocalHistoryItemId` (lines 3896-3949)

```typescript
private async findBestLocalHistoryItemId(referenceTimestamp: number): Promise<string | undefined> {
  const history = await ParkingHistoryService.getHistory();
  
  const candidates = history
    .filter(item => !item.departure && item.timestamp <= referenceTimestamp)
    .map(item => ({ id: item.id, diffMs: referenceTimestamp - item.timestamp }))
    .sort((a, b) => a.diffMs - b.diffMs);  // LINE 3915: sorts by closest time

  // Returns candidates[0] — the CLOSEST parking event in time
  return candidates[0].id;
}
```

### THE BUG: Timestamp-Only Matching

The function matches by **timestamp proximity alone**. No location validation. When a false positive parking exists between two real parking events:

- Real timeline: A (parked 1:00) → B (parked 1:35) → departure from B (2:00)
- History with false positive: A (1:00, dep) → X (1:50, no dep) → B (1:35, no dep)
- When `onDrivingStarted` fires at 2:00:
  - Candidates: [X at 1:50 (10 min away), B at 1:35 (25 min away)]
  - **Selects X because it's temporally closest**
  - **Wrong location**: Departure marked for X instead of B

### `markCarReconnected` (lines 3444-3640)

The method stores `localHistoryMatch` in pending state:

```typescript
async markCarReconnected(nativeDrivingTimestamp?: number): Promise<void> {
  const departureTime = nativeDrivingTimestamp || Date.now();
  
  // ...
  const localHistoryMatch = await this.findBestLocalHistoryItemId(departureTime);  // LINE 3507
  
  this.state.pendingDepartureConfirmation = {
    parkingHistoryId: response.parking_history_id,
    parkedLocation: response.parked_location,
    localHistoryItemId: localHistoryMatch,  // LINE 3517: STORES THE WRONG ID
    departedAt: departureTime,
    // ...
  };
}
```

### `confirmDeparture` (lines 3718-3844)

The method uses the stored (wrong) ID:

```typescript
private async confirmDeparture(): Promise<void> {
  const pending = this.state.pendingDepartureConfirmation;
  
  // ... capture GPS ...
  
  const departureTime = pending.departedAt || Date.now();
  
  const targetItemId = pending.localHistoryItemId || 
    await this.findBestLocalHistoryItemId(departureTime);  // LINE 3802: RE-SEARCHES, might get different result
  
  if (targetItemId) {
    await ParkingHistoryService.updateItem(targetItemId, clearanceData);  // LINE 3804: UPDATES WRONG RECORD
  }
}
```

**Problem**: If the pending history doesn't have a `localHistoryItemId` set (null), `confirmDeparture` searches again. This can return a DIFFERENT result if the parking records have changed.

## Why This Causes the Observed Pattern

### User's Real Scenario (Reconstructed)

**Timeline:**
- Park at Wolcott (8:45 AM) → Parking record created
- Drive toward Byron → At some point during drive, false positive detected at Lincoln Ave
  - Lincoln Ave false positive parking record created
  - State machine might become confused about whether we're still parked
- Park at Byron (9:10 AM) → Second parking record created
- Drive away from Byron (9:16 AM) → `onDrivingStarted` fires

**What went wrong:**

1. Wolcott parking (8:45): Record created, no departure yet
2. Lincoln Ave false positive (9:05): Record created during drive
   - If timing works out, this could happen while "driving" is being detected
   - False positive marked as "parked at Lincoln"
3. Byron parking (9:10): Real parking record created
4. Byron departure (9:16): `onDrivingStarted` fires
   - `findBestLocalHistoryItemId(9:16 AM)` searches:
   - Candidates without departures:
     - Wolcott (8:45, no departure) - 31 minutes old
     - Lincoln (9:05, no departure) - 11 minutes old ← **CLOSEST**
     - Byron (9:10, no departure) - 6 minutes old ← **SHOULD BE THIS**
   - **Actual bug**: Returns Lincoln (false positive) because it's temporally close
   - OR if timing is different, could return Wolcott
   - **Result**: Departure from Byron at 9:16 gets assigned to Wolcott, making it appear Byron never had a departure

## Additional Issues

### 1. Multiple `onDrivingStarted` Events from Recovery

The recovery code (`checkForMissedParking`) can emit synthetic parking events that cause:
- New `onParkingDetected` callback fires
- This triggers `handleCarDisconnection` 
- Which eventually leads to a new `onDrivingStarted` callback being scheduled
- Each creates its own `pendingDepartureConfirmation`

If two depart events are pending:
- First one waits 60s, updates a parking record
- Second one also waits 60s, updates a **different** parking record (wrong one due to timing)

### 2. `onParkingDetected` Before `onDrivingStarted` Processed

On iOS (lines 504-650), callbacks come in rapid succession:
1. `onParkingDetected` (triggered by native CoreMotion)
2. (User drives)
3. `onDrivingStarted` (triggered by native CoreMotion)

If the iOS native code fires both callbacks before JS finishes processing the first, they queue up. By the time `onDrivingStarted` runs, the parking history might have new entries from the first callback's processing.

### 3. `finalizePendingDepartureImmediately` Race Condition

Lines 3671-3709: When a new parking is detected, the code immediately finalizes the previous departure:

```typescript
private async finalizePendingDepartureImmediately(): Promise<void> {
  const pending = this.state.pendingDepartureConfirmation;
  const targetItemId = pending.localHistoryItemId || 
    await this.findBestLocalHistoryItemId(pending.departedAt || Date.now());  // LINE 3695: RE-SEARCH
  
  if (targetItemId) {
    await ParkingHistoryService.updateItem(targetItemId, departureData);  // LINE 3697: UPDATES (maybe wrong?)
  }
}
```

If `pending.localHistoryItemId` was already wrong (stored incorrectly in step 1), and that record now HAS a departure (added by another thread/callback), the filter on line 3913 would skip it. A re-search would find a NEW wrong record.

## Why It's Hard to Detect

1. **Timestamp matching alone** — doesn't validate location
2. **Asynchronous callbacks** — timing-dependent, reproduces intermittently
3. **Recovery code** — synthetic parking events complicate the history
4. **No deduplication in confirmDeparture** — can match the same history record twice if timing aligns

## Fix Strategy

The real fix requires **location-based deduplication** not just timestamp-based:

1. When `findBestLocalHistoryItemId` is called, filter candidates not just by `!item.departure && timestamp <= reference`, but also by **proximity to expected location**

2. Store `parkedLocation` (from server or GPS) in the pending state, and use it to validate candidates

3. Add location-based guards in `confirmDeparture` to reject matches if the record's stored location is too far from expected parking location

4. Prevent multiple `onDrivingStarted` events from queuing by using a debounce/flag that prevents re-entry

5. Ensure `localHistoryItemId` is stored eagerly and never re-searched — re-searching can find different records if history changes
