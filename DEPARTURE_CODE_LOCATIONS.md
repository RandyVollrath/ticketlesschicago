# EXACT CODE LOCATIONS: DEPARTURE FLOW CLEARING OPERATIONS

## File 1: BackgroundTaskService.ts — markCarReconnected()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Key Function**: `async markCarReconnected(nativeDrivingTimestamp?: number): Promise<void>`
**Lines**: 3541-3750+ (spans multiple stages)

### Stage 2A: Clear AsyncStorage Parking Data (Lines 3572-3585)

```typescript
// *** CRITICAL: CLEAR PARKING DATA FROM ASYNCSTORAGE ***
try {
  await AsyncStorage.multiRemove([
    StorageKeys.LAST_PARKING_LOCATION,     // Line: 3575
    StorageKeys.LAST_PARKED_COORDS,        // Line: 3576
    StorageKeys.RESCAN_LAST_RUN,           // Line: 3577
    StorageKeys.RESCAN_LAST_RULES,         // Line: 3578
    StorageKeys.SNOW_FORECAST_LAST_CHECK,  // Line: 3579
    StorageKeys.SNOW_FORECAST_NOTIFIED,    // Line: 3580
  ]);
  log.info('Cleared parking data and rescan/snow state from AsyncStorage');
} catch (e) {
  log.warn('Failed to clear parking data', e);
}
```

**What it clears**:
- `LAST_PARKING_LOCATION` - Hero card display (address, timestamp)
- `LAST_PARKED_COORDS` - Parking coords used by rescan/snow monitoring
- `RESCAN_LAST_RUN` - Last timestamp when periodic rescan ran
- `RESCAN_LAST_RULES` - Dedup key for rescan rules
- `SNOW_FORECAST_LAST_CHECK` - Last timestamp of snow check
- `SNOW_FORECAST_NOTIFIED` - Flag indicating snow warning shown

### Stage 2B: Call HomeScreen Callback (Lines 3587-3590)

```typescript
// Call the reconnect callback if provided (tells HomeScreen to clear UI)
if (this.reconnectCallback) {
  this.reconnectCallback();
}
```

This callback is:
- Set in `BackgroundTaskService.setReconnectCallback()` 
- Defined in HomeScreen as `handleCarReconnect()`

### Stage 2C: Stop Scheduled Tasks (Lines 3564-3570)

```typescript
// Cancel any scheduled parking reminder notifications
await LocalNotificationService.cancelAllScheduledNotifications();
log.info('Cancelled scheduled parking reminders');

// Stop periodic rescan and snow monitoring
this.stopRescanTimer();
this.stopSnowForecastMonitoring();
```

---

## File 2: HomeScreen.tsx — handleCarReconnect()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`

**Function**: `const handleCarReconnect = () => { ... }`
**Lines**: 654-668

```typescript
const handleCarReconnect = () => {
  log.info('Driving started - clearing stale parking result');
  // Clear the parking result so user sees a clean "monitoring" state
  // while driving. BackgroundTaskService.markCarReconnected() already
  // cleared AsyncStorage; we also clear React state so the UI updates.
  setLastParkingCheck(null);                    // Line: 659
  setIsCarConnected(true);                      // Line: 660
  
  // On iOS, immediately set activity to automotive so the hero card
  // switches to "Driving" right away. The 15s CoreMotion poll can lag
  // behind the native onDrivingStarted event that triggers this callback.
  if (Platform.OS === 'ios') {
    setCurrentActivity('automotive');           // Line: 665
    setCurrentConfidence('high');               // Line: 666
  }
};
```

**What it clears**:
- `lastParkingCheck` React state → Set to `null` (clears hero card display)

**What it sets**:
- `isCarConnected` → `true` (indicates car is connected)
- `currentActivity` → `'automotive'` (iOS only, for immediate UI update)

### Where it's called:

**Lines**: 589
```typescript
const started = await BackgroundTaskService.startMonitoring(handleCarDisconnect, handleCarReconnect);
```

The callback is passed to `BackgroundTaskService` which stores it as `this.reconnectCallback` and calls it from `markCarReconnected()`.

---

## File 3: HomeScreen.tsx — handleCarDisconnect()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`

**Function**: `const handleCarDisconnect = async () => { ... }`
**Lines**: 638-652

```typescript
const handleCarDisconnect = async () => {
  log.info('Parking detected - refreshing UI');
  // Small delay to ensure AsyncStorage write from BackgroundTaskService completes
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 300));
  await loadLastCheck();                        // Line: 642 — Reloads parking data from AsyncStorage
  
  // On iOS, force currentActivity to 'stationary' immediately.
  // The native parking detection module already confirmed the user stopped
  // driving — CoreMotion activity polling can lag minutes behind, leaving
  // the hero card stuck on "Driving" even though parking was detected.
  if (Platform.OS === 'ios') {
    setCurrentActivity('stationary');           // Line: 649
    setCurrentConfidence('high');               // Line: 650
  }
};
```

**What it does**: Reloads parking data (opposite of `handleCarReconnect`)

---

## File 4: Constants — StorageKeys.ts

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/constants/StorageKeys.ts`

**Key Storage Keys Cleared on Departure**:

```typescript
export const StorageKeys = {
  // ...
  
  // Parking Data (Line 23-28)
  LAST_PARKING_LOCATION: 'lastParkingLocation',      // Line 24
  PARKING_HISTORY: 'parkingHistory',
  CAMERA_PASS_HISTORY: 'cameraPassHistory',
  RED_LIGHT_RECEIPTS: 'redLightReceipts',
  SAVED_DESTINATIONS: 'savedDestinations',
  
  // ...
  
  // Periodic Rescan (Line 54-57)
  LAST_PARKED_COORDS: 'lastParkedCoords',            // Line 55
  RESCAN_LAST_RUN: 'rescanLastRun',                  // Line 56
  RESCAN_LAST_RULES: 'rescanLastRules',              // Line 57
  
  // Snow Forecast Monitoring (Line 59-61)
  SNOW_FORECAST_LAST_CHECK: 'snowForecastLastCheck', // Line 60
  SNOW_FORECAST_NOTIFIED: 'snowForecastNotified',    // Line 61
  
  // ...
}
```

---

## File 5: LocationService.ts — clearParkedLocation()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`

**Function**: `async clearParkedLocation(): Promise<{ ... }>`
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
      '/api/mobile/clear-parked-location',    // Backend API endpoint
      {},
      { retries: 2, timeout: 15000, showErrorAlert: false }
    );
    
    // ... error handling ...
    
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
  }
}
```

**Called from**: `BackgroundTaskService.markCarReconnected()` at line 3596

---

## File 6: BackgroundTaskService.ts — scheduleDepartureConfirmation()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Function**: `private scheduleDepartureConfirmation(): void`
**Lines**: 3746-3757

```typescript
private scheduleDepartureConfirmation(): void {
  // Clear any existing timeout
  if (this.departureConfirmationTimeout) {
    clearTimeout(this.departureConfirmationTimeout);
  }
  
  this.departureConfirmationTimeout = setTimeout(async () => {
    await this.confirmDeparture();
  }, DEPARTURE_CONFIRMATION_DELAY_MS);  // 60000 ms = 60 seconds
  
  log.info(`Departure confirmation scheduled in ${DEPARTURE_CONFIRMATION_DELAY_MS / 1000}s`);
}
```

**Triggers**: After 60 seconds, calls `confirmDeparture()`

---

## File 7: BackgroundTaskService.ts — confirmDeparture()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Function**: `private async confirmDeparture(): Promise<void>`
**Lines**: 3815-3947

Key sections:

### Get Fresh GPS (Lines 3830-3840)
```typescript
let currentCoords;
try {
  currentCoords = await LocationService.getHighAccuracyLocation(30, 20000);
  log.info(`Clearance GPS (current position): ${currentCoords.latitude.toFixed(6)}, ${currentCoords.longitude.toFixed(6)}`);
} catch (error) {
  log.warn('High accuracy location failed, trying fallback', error);
  currentCoords = await LocationService.getLocationWithRetry(3);
}
```

### Calculate Distance (Lines 3842-3879)
```typescript
let distanceMeters: number;
let isConclusive: boolean;
const CONCLUSIVE_DISTANCE_M = 50;  // 50m threshold

if (isLocalOnly) {
  distanceMeters = haversineDistance(
    pending.parkedLocation.latitude,
    pending.parkedLocation.longitude,
    currentCoords.latitude,
    currentCoords.longitude
  );
  isConclusive = distanceMeters > CONCLUSIVE_DISTANCE_M;
} else {
  const result = await LocationService.confirmDeparture(
    pending.parkingHistoryId!,
    currentCoords.latitude,
    currentCoords.longitude,
    currentCoords.accuracy
  );
  distanceMeters = result.distance_from_parked_meters;
  isConclusive = distanceMeters > CONCLUSIVE_DISTANCE_M;
}
```

### Clear Pending Departure (Lines 3939-3945)
```typescript
// CLEAR PENDING DEPARTURE STATE
this.state.pendingDepartureConfirmation = null;
await this.saveState();
log.info('Departure confirmation complete');
```

---

## File 8: LocationService.ts — confirmDeparture()

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`

**Function**: `async confirmDeparture(...)`
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
    const response = await ApiClient.authPost<any>(
      '/api/mobile/confirm-departure',     // Backend API endpoint
      {
        parking_history_id: parkingHistoryId,
        latitude,
        longitude,
        accuracy_meters: accuracyMeters,
      },
      { retries: 2, timeout: 15000, showErrorAlert: false }
    );
    
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
  }
}
```

---

## TIMELINE: When Things Get Cleared

| Time | What Happens | Function | File | Lines |
|------|--------------|----------|------|-------|
| **T+0ms** | Car reconnects (BT or CoreMotion) | `handleCarReconnection()` | BackgroundTaskService | 1030-1042 |
| **T+10ms** | AsyncStorage keys removed | `markCarReconnected()` | BackgroundTaskService | 3572-3585 |
| **T+20ms** | React state cleared | `handleCarReconnect()` | HomeScreen | 654-668 |
| **T+30ms** | Rescan/snow timers stopped | `markCarReconnected()` | BackgroundTaskService | 3568-3570 |
| **T+100ms** | Server clear-parked-location called | `clearParkedLocation()` | LocationService | 1064-1095 |
| **T+60000ms (60s)** | Departure confirmation scheduled | `scheduleDepartureConfirmation()` | BackgroundTaskService | 3746-3757 |
| **T+60000ms** | GPS clearance captured | `confirmDeparture()` | BackgroundTaskService | 3830-3840 |
| **T+61000ms** | Server confirm-departure called | `LocationService.confirmDeparture()` | LocationService | 1105-1150 |
| **T+62000ms** | Pending departure cleared | `confirmDeparture()` | BackgroundTaskService | 3939-3945 |

---

## Summary Table: All Cleared Items

| Data | Type | Where | When | Function | File | Line |
|------|------|-------|------|----------|------|------|
| `LAST_PARKING_LOCATION` | AsyncStorage | BackgroundTaskService | T+10ms | `markCarReconnected()` | BackgroundTaskService | 3575 |
| `LAST_PARKED_COORDS` | AsyncStorage | BackgroundTaskService | T+10ms | `markCarReconnected()` | BackgroundTaskService | 3576 |
| `RESCAN_LAST_RUN` | AsyncStorage | BackgroundTaskService | T+10ms | `markCarReconnected()` | BackgroundTaskService | 3577 |
| `RESCAN_LAST_RULES` | AsyncStorage | BackgroundTaskService | T+10ms | `markCarReconnected()` | BackgroundTaskService | 3578 |
| `SNOW_FORECAST_LAST_CHECK` | AsyncStorage | BackgroundTaskService | T+10ms | `markCarReconnected()` | BackgroundTaskService | 3579 |
| `SNOW_FORECAST_NOTIFIED` | AsyncStorage | BackgroundTaskService | T+10ms | `markCarReconnected()` | BackgroundTaskService | 3580 |
| `lastParkingCheck` | React State | HomeScreen | T+20ms | `handleCarReconnect()` | HomeScreen | 659 |
| `Scheduled Notifications` | Local Notifications | BackgroundTaskService | T+30ms | `markCarReconnected()` | BackgroundTaskService | 3565 |
| `rescanTimer` | Interval | BackgroundTaskService | T+30ms | `markCarReconnected()` | BackgroundTaskService | 3569 |
| `snowMonitoringTimer` | Interval | BackgroundTaskService | T+30ms | `markCarReconnected()` | BackgroundTaskService | 3570 |
| `pendingDepartureConfirmation` | BackgroundTaskService state | BackgroundTaskService | T+62s | `confirmDeparture()` | BackgroundTaskService | 3943 |

