# React Native Mobile App: DEPARTURE FLOW ANALYSIS

## Overview
When the user **drives away from parking** (car Bluetooth reconnects on Android, CoreMotion detects automotive on iOS), the app follows a multi-stage departure tracking pipeline.

---

## STAGE 1: RECONNECTION DETECTION & HERO CARD CLEARING

### Trigger
- **Android**: Bluetooth ACL_CONNECTED event (from native `BluetoothMonitorService.kt`)
- **iOS**: CoreMotion detects `automotive` activity, triggers native `onDrivingStarted` callback

### Entry Point: `handleCarReconnection()`

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
**Lines**: 1030-1042

```typescript
private async handleCarReconnection(nativeDrivingTimestamp?: number): Promise<void> {
  void this.captureIosHealthSnapshot('handleCarReconnection', { force: true, includeLogTail: true });
  log.info('Car reconnection detected via Bluetooth');
  void AnalyticsService.logDrivingStarted(Platform.OS === 'ios' ? 'ios_coremotion' : 'android_bluetooth');
  void BackgroundLocationService.appendToDecisionLog('js_car_reconnection', {
    nativeDrivingTimestamp: nativeDrivingTimestamp ? new Date(nativeDrivingTimestamp).toISOString() : null,
    delayMs: nativeDrivingTimestamp ? Date.now() - nativeDrivingTimestamp : null,
    smState: ParkingDetectionStateMachine.state,
    hasPendingDeparture: !!this.state.pendingDepartureConfirmation,
    driveSessionId: this.currentDriveSessionId,
  });
  await this.markCarReconnected(nativeDrivingTimestamp);
}
```

**What happens**: Logs telemetry, then calls `markCarReconnected()` with the native timestamp indicating when driving actually started.

---

## STAGE 2: PARKING DATA CLEARING & HERO CARD UI UPDATE

### Main Function: `markCarReconnected()`

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
**Lines**: 3541-3630 (and extends further to line ~3750)

```typescript
async markCarReconnected(nativeDrivingTimestamp?: number): Promise<void> {
  log.info('Car reconnection detected');
  const departureTime = nativeDrivingTimestamp || Date.now();
  
  // ... duplicate check (if departure already pending, return early)
  
  // UPDATE STATE MACHINE
  this.state.lastCarConnectionStatus = true;
  this.state.lastDisconnectTime = null;
  await this.saveState();
  
  // CANCEL SCHEDULED PARKING REMINDERS
  await LocalNotificationService.cancelAllScheduledNotifications();
  log.info('Cancelled scheduled parking reminders');
  
  // STOP RESCAN & SNOW MONITORING
  this.stopRescanTimer();
  this.stopSnowForecastMonitoring();
  
  // *** CRITICAL: CLEAR PARKING DATA FROM ASYNCSTORAGE ***
  try {
    await AsyncStorage.multiRemove([
      StorageKeys.LAST_PARKING_LOCATION,     // Hero card display data
      StorageKeys.LAST_PARKED_COORDS,        // Rescan/snow monitoring state
      StorageKeys.RESCAN_LAST_RUN,           // Periodic rescan timestamp
      StorageKeys.RESCAN_LAST_RULES,         // Rescan dedup key
      StorageKeys.SNOW_FORECAST_LAST_CHECK,  // Snow forecast check time
      StorageKeys.SNOW_FORECAST_NOTIFIED,    // Snow notification flag
    ]);
    log.info('Cleared parking data and rescan/snow state from AsyncStorage');
  } catch (e) {
    log.warn('Failed to clear parking data', e);
  }
  
  // CALL HOMESCREEN CALLBACK TO CLEAR UI
  if (this.reconnectCallback) {
    this.reconnectCallback();  // Clears React state in HomeScreen
  }
  
  // ... then proceed to departure tracking (STAGE 3)
}
```

### AsyncStorage Keys Being Cleared

**Defined in**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/constants/StorageKeys.ts`

| Key | Line | Purpose | Cleared? |
|-----|------|---------|----------|
| `LAST_PARKING_LOCATION` | 24 | Hero card display (address + timestamp) | **YES** ✓ |
| `LAST_PARKED_COORDS` | 55 | Parking coords for rescan/snow monitoring | **YES** ✓ |
| `RESCAN_LAST_RUN` | 56 | ISO timestamp of last periodic rescan | **YES** ✓ |
| `RESCAN_LAST_RULES` | 57 | Dedup key (sorted rule summaries) | **YES** ✓ |
| `SNOW_FORECAST_LAST_CHECK` | 60 | Snow forecast check timestamp | **YES** ✓ |
| `SNOW_FORECAST_NOTIFIED` | 61 | Snow notification flag | **YES** ✓ |

### HomeScreen UI Callback

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`
**Lines**: 654-668

```typescript
const handleCarReconnect = () => {
  log.info('Driving started - clearing stale parking result');
  // Clear the parking result so user sees a clean "monitoring" state
  // while driving. BackgroundTaskService.markCarReconnected() already
  // cleared AsyncStorage; we also clear React state so the UI updates.
  setLastParkingCheck(null);                    // React state: clears hero card
  setIsCarConnected(true);
  
  // On iOS, immediately set activity to automotive so the hero card
  // switches to "Driving" right away.
  if (Platform.OS === 'ios') {
    setCurrentActivity('automotive');
    setCurrentConfidence('high');
  }
};
```

**What clears**: 
- React state variable `lastParkingCheck` → hero card display disappears
- AsyncStorage `LAST_PARKING_LOCATION` → persisted hero card data removed

---

## STAGE 3: DEPARTURE TRACKING PIPELINE

After clearing parking data, `markCarReconnected()` continues to schedule departure confirmation.

### Substage 3A: Server-Side Clear

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
**Lines**: 3595-3629

```typescript
try {
  const response = await LocationService.clearParkedLocation();
  
  if (response.parking_history_id && response.parked_location) {
    log.info('Parked location cleared via server, scheduling departure confirmation', {
      historyId: response.parking_history_id,
      delayMs: DEPARTURE_CONFIRMATION_DELAY_MS,
    });
    
    const localHistoryMatch = await this.findBestLocalHistoryItemId(departureTime);
    
    // Store pending departure confirmation (SERVER MODE)
    this.state.pendingDepartureConfirmation = {
      parkingHistoryId: response.parking_history_id,      // Server parking record ID
      parkedLocation: response.parked_location,           // Parking coords from server
      clearedAt: response.cleared_at,                     // Server-side clear timestamp
      retryCount: 0,
      scheduledAt: Date.now(),
      departedAt: departureTime,                          // Native driving-start time
      localHistoryItemId: localHistoryMatch,              // Local match for dedup
    };
    await this.saveState();
    this.scheduleDepartureConfirmation();                 // Start 60s countdown
    serverSucceeded = true;
  }
} catch (error) {
  log.warn('Server clear-parked-location failed (will use local fallback)', error);
}
```

**Called API**: `LocationService.clearParkedLocation()`

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`
**Lines**: 1064-1095

```typescript
async clearParkedLocation(): Promise<{
  success: boolean;
  parking_history_id: string | null;
  cleared_at: string;
  parked_location: { latitude: number; longitude: number; address: string | null } | null;
  departure_confirmation_delay_ms: number;
}> {
  try {
    const response = await ApiClient.authPost<any>(
      '/api/mobile/clear-parked-location',    // Backend endpoint
      {},
      { retries: 2, timeout: 15000, showErrorAlert: false }
    );
    
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to clear parked location');
    }
    
    log.info('Parked location cleared', {
      historyId: response.data.parking_history_id,
      clearedAt: response.data.cleared_at,
    });
    
    return {
      success: true,
      parking_history_id: response.data.parking_history_id || null,
      cleared_at: response.data.cleared_at,
      parked_location: response.data.parked_location,
      departure_confirmation_delay_ms: response.data.departure_confirmation_delay_ms,
    };
  } catch (error) {
    // ... error handling
  }
}
```

**What this does**: 
- Calls backend `/api/mobile/clear-parked-location` endpoint
- Returns the parking history ID (needed for departure confirmation)
- Sets up server-side pending departure record

### Substage 3B: Local Fallback (if server fails)

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
**Lines**: 3636-3668

```typescript
if (!serverSucceeded) {
  try {
    const recentItem = await ParkingHistoryService.getMostRecent();
    if (recentItem && recentItem.coords) {
      log.info('Using local-only departure tracking fallback', {
        historyItemId: recentItem.id,
        parkedAt: `${recentItem.coords.latitude.toFixed(6)}, ${recentItem.coords.longitude.toFixed(6)}`,
      });
      
      // Store pending departure confirmation (LOCAL-ONLY MODE)
      this.state.pendingDepartureConfirmation = {
        parkingHistoryId: null,              // null = local-only (no server sync)
        parkedLocation: {
          latitude: recentItem.coords.latitude,
          longitude: recentItem.coords.longitude,
        },
        clearedAt: new Date().toISOString(),
        retryCount: 0,
        scheduledAt: Date.now(),
        departedAt: departureTime,
        localHistoryItemId: recentItem.id,
      };
      await this.saveState();
      this.scheduleDepartureConfirmation();
    } else {
      // Last resort: capture current GPS
      // (app was parked when loaded, no parking history exists)
      // This captures approximate parking spot from current GPS
    }
  }
}
```

---

## STAGE 4: DEPARTURE CONFIRMATION (After ~60 seconds)

### Scheduling Function

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
**Lines**: 3746-3757

```typescript
private scheduleDepartureConfirmation(): void {
  if (this.departureConfirmationTimeout) {
    clearTimeout(this.departureConfirmationTimeout);
  }
  
  this.departureConfirmationTimeout = setTimeout(async () => {
    await this.confirmDeparture();
  }, DEPARTURE_CONFIRMATION_DELAY_MS);  // DEPARTURE_CONFIRMATION_DELAY_MS = 60000 (60 seconds)
  
  log.info(`Departure confirmation scheduled in ${DEPARTURE_CONFIRMATION_DELAY_MS / 1000}s`);
}
```

### Confirmation Function: `confirmDeparture()`

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
**Lines**: 3815-3947

```typescript
private async confirmDeparture(): Promise<void> {
  if (!this.state.pendingDepartureConfirmation) {
    log.debug('No pending departure confirmation');
    return;
  }
  
  const pending = this.state.pendingDepartureConfirmation;
  const isLocalOnly = !pending.parkingHistoryId;
  
  try {
    log.info('Confirming departure...', {
      attempt: pending.retryCount + 1,
      mode: isLocalOnly ? 'local-only' : 'server',
    });
    
    // GET FRESH GPS (current position after 60s of driving)
    let currentCoords;
    try {
      currentCoords = await LocationService.getHighAccuracyLocation(30, 20000);
      log.info(`Clearance GPS (current position): ${currentCoords.latitude.toFixed(6)}, 
               ${currentCoords.longitude.toFixed(6)} (±${currentCoords.accuracy?.toFixed(1)}m)`);
    } catch (error) {
      log.warn('High accuracy location failed, trying fallback', error);
      currentCoords = await LocationService.getLocationWithRetry(3);
    }
    
    let distanceMeters: number;
    let isConclusive: boolean;
    const CONCLUSIVE_DISTANCE_M = 50;  // 50m threshold
    
    if (isLocalOnly) {
      // LOCAL-ONLY: calculate distance locally
      distanceMeters = haversineDistance(
        pending.parkedLocation.latitude,
        pending.parkedLocation.longitude,
        currentCoords.latitude,
        currentCoords.longitude
      );
      isConclusive = distanceMeters > CONCLUSIVE_DISTANCE_M;
      
      log.info('Clearance calculation:', {
        parkedLat: pending.parkedLocation.latitude,
        parkedLng: pending.parkedLocation.longitude,
        currentLat: currentCoords.latitude,
        currentLng: currentCoords.longitude,
        distance: distanceMeters,
        isConclusive,
      });
      
      // Save locally
      this.finalizeDepartureRecordLocally(pending, currentCoords, distanceMeters, isConclusive);
      
      // Also try to sync with server (fire-and-forget)
      this.tryServerDepartureConfirmation(currentCoords, pending).catch((e) => 
        log.warn('Server departure confirmation failed (local-only fallback used)', e)
      );
    } else {
      // SERVER MODE: call server to confirm departure
      const result = await LocationService.confirmDeparture(
        pending.parkingHistoryId!,
        currentCoords.latitude,
        currentCoords.longitude,
        currentCoords.accuracy
      );
      
      distanceMeters = result.distance_from_parked_meters;
      isConclusive = distanceMeters > CONCLUSIVE_DISTANCE_M;
      
      log.info('Server clearance confirmed:', {
        distance: distanceMeters,
        isConclusive,
        threshold: CONCLUSIVE_DISTANCE_M,
      });
    }
    
    // SAVE CLEARANCE RECORD TO LOCAL PARKING HISTORY
    const departureTime = pending.departedAt || Date.now();
    const confirmationDelay = Math.round((Date.now() - departureTime) / 1000);
    log.info(`Clearance time: ${new Date(departureTime).toISOString()} (confirmed ${confirmationDelay}s later)`);
    
    try {
      const clearanceData = {
        departure: {
          confirmedAt: departureTime,
          distanceMeters,
          isConclusive,
          latitude: currentCoords.latitude,
          longitude: currentCoords.longitude,
        },
      };
      
      const targetItemId = pending.localHistoryItemId || await this.findBestLocalHistoryItemId(departureTime);
      if (targetItemId) {
        await ParkingHistoryService.updateItem(targetItemId, clearanceData);
        log.info('Clearance record saved (local mode)', targetItemId);
      } else {
        log.warn('Could not find matching local history row for clearance record');
      }
    } catch (e) {
      log.warn('Failed to save clearance record locally', e);
    }
    
    // CLEAR PENDING DEPARTURE
    this.state.pendingDepartureConfirmation = null;
    await this.saveState();
    log.info('Departure confirmation complete');
    
  } catch (error) {
    // ... retry logic (max 3 retries, then give up)
  }
}
```

### Server-Side Confirmation API

**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`
**Lines**: 1105-1150

```typescript
async confirmDeparture(
  parkingHistoryId: string,
  latitude: number,
  longitude: number,
  accuracyMeters?: number
): Promise<{
  parking_history_id: string;
  parked_at: string;
  cleared_at: string;
  departure_confirmed_at: string;
  distance_from_parked_meters: number;
  is_conclusive: boolean;
}> {
  try {
    const response = await ApiClient.authPost<any>('/api/mobile/confirm-departure', {
      parking_history_id: parkingHistoryId,
      latitude,
      longitude,
      accuracy_meters: accuracyMeters,
    }, {
      retries: 2,
      timeout: 15000,
      showErrorAlert: false,
    });
    
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to confirm departure');
    }
    
    log.info('Departure confirmed', {
      historyId: response.data.parking_history_id,
      distance: response.data.distance_from_parked_meters,
      isConclusive: response.data.is_conclusive,
    });
    
    return {
      parking_history_id: response.data.parking_history_id,
      parked_at: response.data.parked_at,
      cleared_at: response.data.cleared_at,
      departure_confirmed_at: response.data.departure_confirmed_at,
      distance_from_parked_meters: response.data.distance_from_parked_meters,
      is_conclusive: response.data.is_conclusive,
    };
  } catch (error) {
    // ... error handling
  }
}
```

**What this does**:
- Calls backend `/api/mobile/confirm-departure` endpoint
- Backend calculates distance from parked location to current GPS
- Server-side parking record is updated with departure data

---

## SUMMARY: WHAT GETS CLEARED ON DEPARTURE

### Immediate (when `markCarReconnected()` is called):

1. **AsyncStorage Keys** (via `multiRemove()`):
   - `StorageKeys.LAST_PARKING_LOCATION` - Hero card display data
   - `StorageKeys.LAST_PARKED_COORDS` - Parking coords for rescan/snow
   - `StorageKeys.RESCAN_LAST_RUN` - Rescan timestamp
   - `StorageKeys.RESCAN_LAST_RULES` - Rescan dedup key
   - `StorageKeys.SNOW_FORECAST_LAST_CHECK` - Snow check time
   - `StorageKeys.SNOW_FORECAST_NOTIFIED` - Snow notification flag

2. **React State** (in HomeScreen):
   - `lastParkingCheck` → Set to `null` (clears hero card UI)
   - `isCarConnected` → Set to `true`

3. **Scheduled Tasks**:
   - All scheduled parking reminder notifications (canceled)
   - Rescan timer (stopped)
   - Snow forecast monitoring (stopped)

### After ~60 seconds (when `confirmDeparture()` completes):

4. **Pending Departure State**:
   - `this.state.pendingDepartureConfirmation` → Set to `null`

---

## CRITICAL DATA THAT DOES NOT GET CLEARED

The following data is **intentionally preserved** for parking history/evidence:

- **Parking history database** (`ParkingHistoryService`)
  - Parking records are UPDATED with departure data, not deleted
  - Departure timestamp, distance, GPS coords recorded
  - Used for ticket contesting evidence

- **Decision logs** (`BackgroundLocationService.appendToDecisionLog()`)
  - Full audit trail of all decisions preserved
  - For diagnostics and debugging

---

## ANSWER TO KEY QUESTIONS

### Q1: Is `LAST_PARKED_COORDS` cleared on departure?
**YES** ✓ - Cleared via `AsyncStorage.multiRemove()` in `markCarReconnected()` at line 3576.

### Q2: Is `LAST_PARKING_LOCATION` cleared on departure?
**YES** ✓ - Cleared via `AsyncStorage.multiRemove()` in `markCarReconnected()` at line 3575.

### Q3: Does `handleCarReconnect` in HomeScreen.tsx clear the hero card state?
**YES** ✓ - Sets `setLastParkingCheck(null)` at line 659.

### Q4: Does `handleCarReconnect` clear AsyncStorage directly?
**NO** - `handleCarReconnect` only clears React state. The AsyncStorage clearing is done in `markCarReconnected()` (BackgroundTaskService) before `handleCarReconnect` is called.

### Q5: When does departure confirmation happen?
**60 seconds after driving starts** - Scheduled by `scheduleDepartureConfirmation()` (line 3746), which sets a setTimeout for 60 seconds, then `confirmDeparture()` is called.

### Q6: What if the user parks again before the 60-second confirmation completes?
**Immediate finalization** - Function `finalizePendingDepartureImmediately()` (line 3768) records the departure immediately (without waiting for GPS clearance proof) because the new parking event proves they left the previous spot.
