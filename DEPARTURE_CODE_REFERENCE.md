# Full Method Implementations — Departure Matching Flow

## 1. iOS `onDrivingStarted` Handler (Lines 622-636)

```typescript
622→            // onDrivingStarted - fires when user starts driving
623→            (drivingTimestamp?: number) => {
624→              this.lastIosDrivingStartedAt = drivingTimestamp || Date.now();
625→              this.currentDriveSessionId = null;
626→              void this.captureIosHealthSnapshot('onDrivingStarted', { force: true, includeLogTail: true });
627→              log.info('DRIVING STARTED - user departing', {
628→                nativeTimestamp: drivingTimestamp ? new Date(drivingTimestamp).toISOString() : 'none',
629→              });
630→              // Camera alerts disabled on iOS for App Store compliance (2.5.4)
631→              if (Platform.OS !== 'ios') {
632→                void CameraAlertService.prewarmAudio('onDrivingStarted');
633→              }
634→              this.startCameraAlerts();
635→              this.handleCarReconnection(drivingTimestamp);
636→            },
```

**Key Issue**: This callback can fire multiple times in sequence. Each time it calls `handleCarReconnection()` independently, creating separate departure tracking flows.

---

## 2. `handleCarReconnection()` (Lines 985-996)

```typescript
985→  private async handleCarReconnection(nativeDrivingTimestamp?: number): Promise<void> {
986→    void this.captureIosHealthSnapshot('handleCarReconnection', { force: true, includeLogTail: true });
987→    log.info('Car reconnection detected via Bluetooth');
988→    void BackgroundLocationService.appendToDecisionLog('js_car_reconnection', {
989→      nativeTimestamp: nativeDrivingTimestamp ? new Date(nativeDrivingTimestamp).toISOString() : null,
990→      delayMs: nativeDrivingTimestamp ? Date.now() - nativeDrivingTimestamp : null,
991→      smState: ParkingDetectionStateMachine.state,
992→      hasPendingDeparture: !!this.state.pendingDepartureConfirmation,
993→      driveSessionId: this.currentDriveSessionId,
994→    });
995→    await this.markCarReconnected(nativeDrivingTimestamp);
996→  }
```

**Triggers**: Called from `onDrivingStarted` (line 635) and from iOS MotionActivityManager callbacks (lines 673, 682).

---

## 3. `markCarReconnected()` (Lines 3444-3640, showing key sections)

### Part 1: Duplicate Prevention (Lines 3444-3461)

```typescript
3444→  async markCarReconnected(nativeDrivingTimestamp?: number): Promise<void> {
3445→    log.info('Car reconnection detected');
3446→    // Use the native driving-start timestamp as the departure time
3447→    const departureTime = nativeDrivingTimestamp || Date.now();
3448→    if (nativeDrivingTimestamp) {
3449→      const delayMs = Date.now() - nativeDrivingTimestamp;
3450→      log.info(`Native driving-start timestamp: ${new Date(nativeDrivingTimestamp).toISOString()} (${Math.round(delayMs / 1000)}s ago)`);
3451→    }
3452→
3453→    // If we already have a pending departure captured very recently, avoid
3454→    // re-initializing it from duplicate reconnect signals.
3455→    if (this.state.pendingDepartureConfirmation) {
3456→      const existingAgeMs = Date.now() - this.state.pendingDepartureConfirmation.scheduledAt;
3457→      if (existingAgeMs < 5 * 60 * 1000) {
3458→        log.info(`Skipping duplicate reconnection handling: departure confirmation already pending (${Math.round(existingAgeMs / 1000)}s old)`);
3459→        return;
3460→      }
3461→    }
```

**Issue**: Only prevents re-entry if there's ALREADY a pending departure within 5 minutes. If the first departure finalized or the history changed, a second `onDrivingStarted` will re-enter.

### Part 2: Server-Mode Departure Scheduling (Lines 3498-3535)

```typescript
3498→    try {
3499→      const response = await LocationService.clearParkedLocation();
3500→
3501→      if (response.parking_history_id && response.parked_location) {
3502→        log.info('Parked location cleared via server, scheduling departure confirmation', {
3503→          historyId: response.parking_history_id,
3504→          delayMs: DEPARTURE_CONFIRMATION_DELAY_MS,
3505→        });
3506→
3507→        const localHistoryMatch = await this.findBestLocalHistoryItemId(departureTime);  // <-- CRITICAL LINE
3508→
3509→        // Store pending departure confirmation (server mode)
3510→        this.state.pendingDepartureConfirmation = {
3511→          parkingHistoryId: response.parking_history_id,
3512→          parkedLocation: response.parked_location,
3513→          clearedAt: response.cleared_at,
3514→          retryCount: 0,
3515→          scheduledAt: Date.now(),
3516→          departedAt: departureTime, // When driving actually started (native timestamp)
3517→          localHistoryItemId: localHistoryMatch,  // <-- STORES RESULT OF findBest...()
3518→        };
3519→        await this.saveState();
3520→        this.scheduleDepartureConfirmation();
3521→        serverSucceeded = true;
```

**Bug**: Line 3507 calls `findBestLocalHistoryItemId(departureTime)` which uses ONLY timestamp matching.

### Part 3: Local-Only Fallback (Lines 3540-3570)

```typescript
3540→    if (!serverSucceeded) {
3541→      try {
3542→        const recentItem = await ParkingHistoryService.getMostRecent();
3543→        if (recentItem && recentItem.coords) {
3543→          log.info('Using local-only departure tracking fallback', {
3544→            historyItemId: recentItem.id,
3545→            parkedAt: `${recentItem.coords.latitude.toFixed(6)}, ${recentItem.coords.longitude.toFixed(6)}`,
3546→          });
3547→
3548→          this.state.pendingDepartureConfirmation = {
3549→            parkingHistoryId: null, // null = local-only mode
3550→            parkedLocation: {
3551→              latitude: recentItem.coords.latitude,
3552→              longitude: recentItem.coords.longitude,
3553→            },
3554→            clearedAt: new Date().toISOString(),
3555→            retryCount: 0,
3556→            scheduledAt: Date.now(),
3557→            departedAt: departureTime, // When driving actually started (native timestamp)
3558→            localHistoryItemId: recentItem.id,  // <-- USES MOST RECENT
3559→          };
```

**Issue**: When server mode fails, it uses the MOST RECENT parking history item without validating if it's correct. If multiple parking records exist, this can be wrong.

---

## 4. `scheduleDepartureConfirmation()` (Lines 3649-3660)

```typescript
3649→  private scheduleDepartureConfirmation(): void {
3650→    // Clear any existing timeout
3651→    if (this.departureConfirmationTimeout) {
3652→      clearTimeout(this.departureConfirmationTimeout);
3653→    }
3654→
3655→    this.departureConfirmationTimeout = setTimeout(async () => {
3656→      await this.confirmDeparture();
3657→    }, DEPARTURE_CONFIRMATION_DELAY_MS);
3658→
3659→    log.info(`Departure confirmation scheduled in ${DEPARTURE_CONFIRMATION_DELAY_MS / 1000}s`);
3660→  }
```

**Timing**: Waits 60 seconds (`DEPARTURE_CONFIRMATION_DELAY_MS`) before calling `confirmDeparture()`.

---

## 5. `finalizePendingDepartureImmediately()` (Lines 3671-3709)

```typescript
3671→  private async finalizePendingDepartureImmediately(): Promise<void> {
3672→    const pending = this.state.pendingDepartureConfirmation;
3673→    if (!pending) return;
3674→
3675→    // Cancel the pending timer
3676→    if (this.departureConfirmationTimeout) {
3677→      clearTimeout(this.departureConfirmationTimeout);
3678→      this.departureConfirmationTimeout = null;
3679→    }
3680→
3681→    const departureTime = pending.departedAt || Date.now();
3682→    log.info(`Immediately finalizing departure from previous spot at ${new Date(departureTime).toISOString()}`);
3683→
3684→    try {
3685→      const departureData = {
3686→        departure: {
3687→          confirmedAt: departureTime,
3688→          distanceMeters: 0, // Unknown — we didn't wait for GPS
3689→          isConclusive: true, // User clearly left (they parked somewhere new)
3690→          latitude: 0,
3691→          longitude: 0,
3692→        },
3693→      };
3694→
3695→      const targetItemId = pending.localHistoryItemId || await this.findBestLocalHistoryItemId(pending.departedAt || Date.now());  // <-- RE-SEARCH
3696→      if (targetItemId) {
3697→        await ParkingHistoryService.updateItem(targetItemId, departureData);
3698→        log.info('Previous departure finalized (local mode)', targetItemId);
3699→      } else {
3700→        log.warn('Could not find matching local history row to finalize previous departure');
3701→      }
3702→    } catch (error) {
3703→      log.warn('Failed to finalize previous departure (non-critical)', error);
3704→    }
3705→
3706→    // Clear the pending state
3707→    this.state.pendingDepartureConfirmation = null;
3708→    await this.saveState();
3709→  }
```

**Critical Bug Line 3695**: If `pending.localHistoryItemId` is null, it RE-SEARCHES. This can find a DIFFERENT record than was originally stored, causing the wrong record to be updated.

Called from `handleCarDisconnection()` (line 1400) when a new parking event arrives while a departure is still pending.

---

## 6. `confirmDeparture()` (Lines 3718-3844, key sections)

### Part 1: Setup (Lines 3718-3745)

```typescript
3718→  private async confirmDeparture(): Promise<void> {
3719→    if (!this.state.pendingDepartureConfirmation) {
3720→      log.debug('No pending departure confirmation');
3721→      return;
3722→    }
3723→
3724→    const pending = this.state.pendingDepartureConfirmation;
3725→    const isLocalOnly = !pending.parkingHistoryId;
3726→
3727→    try {
3728→      log.info('Confirming departure...', {
3729→        attempt: pending.retryCount + 1,
3730→        mode: isLocalOnly ? 'local-only' : 'server',
3731→      });
3732→
3733→      // Get fresh GPS — where the car is NOW after ~60s of driving.
3734→      // Compare against parkedLocation to prove the car left the block.
3735→      // This is a "clearance record": proof for ticket contesting.
3736→      let currentCoords;
3737→      try {
3738→        currentCoords = await LocationService.getHighAccuracyLocation(30, 20000);
3739→        log.info(`Clearance GPS (current position): ${currentCoords.latitude.toFixed(6)}, ${currentCoords.longitude.toFixed(6)} (±${currentCoords.accuracy?.toFixed(1)}m)`);
3740→      } catch (error) {
3741→        log.warn('High accuracy location failed, trying fallback', error);
3742→        currentCoords = await LocationService.getLocationWithRetry(3);
3743→      }
3744→
3745→      let distanceMeters: number;
```

### Part 2: Update Local History (Lines 3784-3810)

```typescript
3784→      // Save clearance record to parking history.
3785→      // Coords = where the car is NOW (proof it's not at the parking spot).
3786→      // Timestamp = when driving started (departedAt), not when we confirmed.
3787→      const departureTime = pending.departedAt || Date.now();
3788→      const confirmationDelay = Math.round((Date.now() - departureTime) / 1000);
3789→      log.info(`Clearance time: ${new Date(departureTime).toISOString()} (confirmed ${confirmationDelay}s later)`);
3790→
3791→      try {
3792→        const clearanceData = {
3793→          departure: {
3794→            confirmedAt: departureTime,
3795→            distanceMeters,
3796→            isConclusive,
3797→            latitude: currentCoords.latitude,
3798→            longitude: currentCoords.longitude,
3799→          },
3800→        };
3801→
3802→        const targetItemId = pending.localHistoryItemId || await this.findBestLocalHistoryItemId(departureTime);  // <-- SECOND RE-SEARCH
3803→        if (targetItemId) {
3804→          await ParkingHistoryService.updateItem(targetItemId, clearanceData);  // <-- UPDATES (POTENTIALLY WRONG) RECORD
3805→          log.info('Clearance record saved (local mode)', targetItemId);
3806→        } else {
3807→          log.warn('Could not find matching local history row for clearance record');
3808→        }
3809→      } catch (historyError) {
3810→        log.warn('Failed to save clearance record (non-critical)', historyError);
3811→      }
3812→
3813→      // Clear pending confirmation on success
3814→      this.state.pendingDepartureConfirmation = null;
3815→      await this.saveState();
```

**Critical Bug Line 3802**: Even if `localHistoryItemId` was stored from line 3517, if it becomes null for any reason, `confirmDeparture` RE-SEARCHES. This can return a DIFFERENT record if history changed.

---

## 7. `findBestLocalHistoryItemId()` (Lines 3896-3949) — THE CORE BUG

```typescript
3896→  private async findBestLocalHistoryItemId(referenceTimestamp: number): Promise<string | undefined> {
3897→    try {
3898→      const history = await ParkingHistoryService.getHistory();
3899→      if (!history || history.length === 0) {
3900→        void BackgroundLocationService.appendToDecisionLog('js_departure_match', {
3901→          result: 'no_history',
3902→          referenceTime: new Date(referenceTimestamp).toISOString(),
3903→        });
3904→        return undefined;
3905→      }
3906→
3907→      const DAY_MS = 24 * 60 * 60 * 1000;
3908→      // Only consider parking records that were created BEFORE or AT the departure
3909→      // time. A departure can't be for a parking event that hasn't happened yet.
3910→      // Using Math.abs() previously allowed matching a NEWER parking record,
3911→      // causing departure_confirmed_at < parked_at (impossible in reality).
3912→      const candidates = history
3913→        .filter(item => !item.departure && item.timestamp <= referenceTimestamp)  // <-- FILTER BY TIMESTAMP
3914→        .map(item => ({ id: item.id, diffMs: referenceTimestamp - item.timestamp }))
3915→        .sort((a, b) => a.diffMs - b.diffMs);  // <-- SORT BY CLOSEST TIME
3916→
3917→      if (candidates.length === 0) {
3918→        void BackgroundLocationService.appendToDecisionLog('js_departure_match', {
3919→          result: 'no_candidates',
3920→          referenceTime: new Date(referenceTimestamp).toISOString(),
3921→          totalHistory: history.length,
3922→          withDeparture: history.filter(i => !!i.departure).length,
3923→          afterReference: history.filter(i => i.timestamp > referenceTimestamp).length,
3924→        });
3925→        return undefined;
3926→      }
3927→      if (candidates[0].diffMs > DAY_MS) {
3928→        void BackgroundLocationService.appendToDecisionLog('js_departure_match', {
3929→          result: 'too_old',
3930→          referenceTime: new Date(referenceTimestamp).toISOString(),
3931→          bestCandidateId: candidates[0].id,
3932→          bestCandidateAgeHrs: +(candidates[0].diffMs / 3600000).toFixed(1),
3933→        });
3934→        return undefined;
3935→      }
3936→
3937→      void BackgroundLocationService.appendToDecisionLog('js_departure_match', {
3938→        result: 'matched',
3938→        referenceTime: new Date(referenceTimestamp).toISOString(),
3939→        matchedId: candidates[0].id,
3940→        matchedAgeMin: +(candidates[0].diffMs / 60000).toFixed(1),
3941→        candidateCount: candidates.length,
3942→      });
3943→      return candidates[0].id;  // <-- RETURNS TEMPORALLY CLOSEST, NOT LOCATION-VALIDATED
3944→    } catch (error) {
3945→      log.warn('findBestLocalHistoryItemId failed', error);
3946→      return undefined;
3947→    }
3948→  }
```

**THE BUG**: 
- Line 3913: Filters candidates by `!item.departure && item.timestamp <= referenceTimestamp`
- Line 3915: Sorts by **temporal distance only** (closest time to reference)
- Line 3943: Returns the temporally closest candidate WITHOUT validating location
- **NO LOCATION VALIDATION**: A false positive parking (wrong location) can be selected if it's more recent than the real parking location

---

## 8. Where `handleCarDisconnection()` Fits In (Lines 1359-1452, key parts)

```typescript
1359→  private async handleCarDisconnection(parkingCoords?: {
1360→    latitude: number;
1361→    longitude: number;
1362→    accuracy?: number;
1363→  }, nativeTimestamp?: number): Promise<void> {
1364→    const detectionMeta = this.pendingNativeDetectionMeta;
1365→    void this.captureIosHealthSnapshot('handleCarDisconnection', { force: true, includeLogTail: true });
   ...
1395→    // If there's a pending departure from a PREVIOUS parking spot, finalize it NOW
1396→    // with the current time as the departure time (since driving has clearly happened).
1397→    // This prevents the old departure timer from firing AFTER the new parking is recorded.
1398→    if (this.state.pendingDepartureConfirmation) {
1399→      log.info('Finalizing previous departure before recording new parking');
1400→      await this.finalizePendingDepartureImmediately();  // <-- CALLS FINALIZE (WHICH RE-SEARCHES)
1401→    }
1402→
   ...
1417→    // Check parking - use provided coords if available (iOS background location)
1418→    await this.triggerParkingCheck(parkingCoords, true, nativeTimestamp, true, detectionMeta || undefined);
1419→
   ...
1427→    if (Platform.OS === 'ios') {
1428→      const smState = ParkingDetectionStateMachine.state;
1429→      if (smState !== 'PARKED') {
1430→        log.info(`iOS parking confirmed: transitioning state machine from ${smState} to PARKED for departure tracking`);
1431→        ParkingDetectionStateMachine.iosNativeParkingConfirmed({
1432→          source: 'ios_native_parking_detected',
1433→          previousState: smState,
1434→        });
```

---

## Summary: The Departure Matching Flow

1. **iOS fires `onDrivingStarted`** (line 623) with departure timestamp
2. **Calls `handleCarReconnection()`** (line 635)
3. **Calls `markCarReconnected()`** (line 995)
4. **Calls `findBestLocalHistoryItemId()`** (line 3507) ← **BUG: timestamp-only matching**
5. **Stores result in pending state** (line 3517)
6. **Schedules 60-second delay** (line 3520)
7. **`confirmDeparture()` waits 60s then runs** (line 3655-3656)
8. **Uses stored ID OR re-searches if null** (line 3802) ← **BUG: can find different record**
9. **Updates parking history with departure** (line 3804) ← **BUG: might be wrong record**

The bug happens when:
- Multiple `onDrivingStarted` events fire in sequence
- A false positive parking is inserted between real parkings
- `findBestLocalHistoryItemId()` returns the false positive because it's temporally closest
- Or a re-search (at lines 3695 or 3802) returns a different record due to history changing
