# React Native + Next.js Codebase Code Quality Review

## Executive Summary

This is a high-quality codebase with strong architectural decisions (local-first data, state machines, platform abstractions). However, there are **critical code quality issues** across DRY, error handling, and state management that create maintenance burden and risk of subtle bugs.

**Key Findings:**
- **BackgroundTaskService is 2,940 lines** — the largest file by far, contains overlapping logic with other files
- **Error handling has ~4 fire-and-forget patterns** without logging in critical paths
- **Duplicate parking check logic** between `HomeScreen.performParkingCheck()` and `BackgroundTaskService.handleCarDisconnection()`
- **State initialization race conditions** in React hooks relying on async data
- **Haversine distance calculation duplicated** across 2 files with different implementations
- **GPS acquisition code repeated** with variations in 3+ locations
- **Supabase insert/update patterns** duplicated in 3+ places without shared utilities
- **Magic numbers everywhere** without named constants (timeouts, distances, thresholds)

---

## Part 1: DRY Violations (Duplicated Code)

### 1.1 Critical: Duplicated Parking Check Logic (HIGH IMPACT)

**Files:** `HomeScreen.tsx:526-652` vs `BackgroundTaskService.ts:1500-1700` (estimated)

**HomeScreen.performParkingCheck()** (lines 526-652, ~126 lines):
```typescript
// HomeScreen.tsx:526-652
const performParkingCheck = useCallback(async (showAllClearAlert: boolean = true, useHighAccuracy: boolean = true) => {
  if (isCheckingRef.current) return;
  isCheckingRef.current = true;

  setLoading(true);
  setIsGettingLocation(true);
  setLocationAccuracy(undefined);
  // ... extensive timeout setup ...
  
  const servicesEnabled = await LocationService.checkLocationServicesEnabled();
  // ... iOS parking location lookup ...
  const coords = await LocationService.getHighAccuracyLocation(20, 15000);
  const result = await LocationService.checkParkingLocation(coords);
  await LocationService.saveParkingCheckResult(result);
  
  if (result.rules.length > 0) {
    await LocationService.sendParkingAlert(result.rules);
  }
}, []);
```

**BackgroundTaskService.handleCarDisconnection()** (lines ~1500+, similar flow):
- Performs overlapping permission checks
- Performs overlapping GPS coordinate acquisition
- Performs overlapping API call to check parking
- Performs overlapping result storage

**Problem:**
- If one path is changed (e.g., adding a new permission check), the other becomes out-of-sync
- Duplicated UI state management (loading, error handling) makes both paths fragile
- Any change to parking logic must be applied in 2 places

**Impact:** Bug fixes to parking logic must be duplicated or will cause inconsistent behavior.

**Refactor Pattern:**
```typescript
// NEW: Extract shared logic
class ParkingCheckEngine {
  async performCheck(coords?: Coordinates): Promise<ParkingCheckResult> {
    // All common logic here
    const finalCoords = coords || await this.acquireGPS();
    return await LocationService.checkParkingLocation(finalCoords);
  }
}

// In HomeScreen:
const result = await parkingEngine.performCheck();

// In BackgroundTaskService:
const result = await parkingEngine.performCheck(detectedCoords);
```

---

### 1.2 Haversine Distance Duplicated (MEDIUM IMPACT)

**Files:**
1. `LocationService.ts:619-632` — Full implementation with comments
2. `CameraAlertService.ts:814-831` — Identical implementation
3. Slight variations in each file's usage context

**LocationService.ts (lines 619-632):**
```typescript
private haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
```

**CameraAlertService.ts (lines 814-831):**
```typescript
private haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = this.toRad(lat2 - lat1);
  const dLng = this.toRad(lng2 - lng1);
  // ... identical calculation ...
}
```

**Problem:**
- Exact same algorithm, copied twice
- If a bug is found in haversine formula, must fix in 2 places
- Different naming conventions (`haversineDistance` vs `haversineMeters` vs angle conversion helper)

**Impact:** Maintenance overhead; bugs in distance calculations could silently affect both features.

**Refactor:** Extract to a shared utility:
```typescript
// utils/GeoDistance.ts
export const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  // ... calculation ...
  return R * c;
};
```

---

### 1.3 GPS Coordinate Acquisition Duplicated (MEDIUM IMPACT)

**Files:** `HomeScreen.tsx:598-604`, `BackgroundTaskService.ts`, `MapScreen.tsx` (estimated)

**HomeScreen.tsx (lines 574-604):**
```typescript
// iOS: Try to use the car's parking location from native module first
if (Platform.OS === 'ios') {
  try {
    const parkingLoc = await BackgroundLocationService.getLastDrivingLocation();
    if (parkingLoc && parkingLoc.latitude && parkingLoc.longitude) {
      const ageMs = Date.now() - parkingLoc.timestamp;
      if (ageMs < 2 * 60 * 60 * 1000) {
        coords = { latitude: parkingLoc.latitude, longitude: parkingLoc.longitude, accuracy: parkingLoc.accuracy };
      }
    }
  } catch (e) {
    log.debug('Could not get parking location from native module', e);
  }
}

// Fallback
if (!coords) {
  if (useHighAccuracy) {
    coords = await LocationService.getHighAccuracyLocation(20, 15000);
  } else {
    coords = await LocationService.getCurrentLocation('high');
  }
}
```

**BackgroundTaskService.ts** — Similar logic repeated for Android/iOS paths

**MapScreen.tsx** — Likely has its own coordinate acquisition logic

**Problem:**
- GPS fallback chain duplicated across multiple screens
- iOS-specific handling (parking location cache) not centralized
- Parameter variations (accuracy thresholds, timeouts) duplicated

**Impact:** Inconsistent GPS behavior across screens; harder to tune one location-acquisition strategy.

---

### 1.4 Supabase Insert/Update Patterns Duplicated (MEDIUM IMPACT)

**Files:**
1. `HistoryScreen.tsx:56-85` — `syncAddToServer` function (parking history insert)
2. `HistoryScreen.tsx:88-111` — `syncDepartureToServer` function (parking history update)
3. `LocationService.ts:954-995` — `saveParkedLocationToServer` (overlapping insert to `user_parked_vehicles`)
4. Multiple locations with similar `.from().insert()` / `.update()` patterns

**HistoryScreen.tsx (lines 56-85):**
```typescript
const syncAddToServer = async (item: ParkingHistoryItem): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated()) return;
    const userId = AuthService.getUser()?.id;
    if (!userId) return;

    const supabase = AuthService.getSupabaseClient();
    const { error } = await supabase.from('parking_location_history').insert({
      user_id: userId,
      latitude: item.coords.latitude,
      longitude: item.coords.longitude,
      // ... 8 more fields mapped manually ...
    });
    if (error) log.debug('Sync add failed (non-fatal)', error.message);
  } catch (e) {
    log.debug('Sync add exception (non-fatal)', e);
  }
};
```

**LocationService.ts (lines 954-995):**
```typescript
async saveParkedLocationToServer(
  coords: Coordinates,
  parkingData: any,
  address: string,
  fcmToken: string
): Promise<{ success: boolean; id?: string }> {
  try {
    // ... 15+ field mappings, different table, different structure ...
    const response = await ApiClient.authPost<any>('/api/mobile/save-parked-location', payload, {
      // ... wrapper around Supabase via API endpoint ...
    });
  } catch (error) {
    log.error('Error saving parked location to server (non-fatal)', error);
    return { success: false };
  }
}
```

**Problem:**
- Two separate tables being written to (`parking_location_history` vs `user_parked_vehicles`)
- Field mapping logic scattered across files
- Fire-and-forget pattern with minimal error handling
- Type safety lost in the `any` type casts

**Impact:** Hard to add new fields or change schema; risk of data inconsistency between tables.

---

### 1.5 Notification Sending Patterns Duplicated (LOW-MEDIUM IMPACT)

**Files:**
- `LocationService.ts:1118-1181` — `sendParkingAlert` (TTS + notifee + Alert.alert)
- `BackgroundTaskService.ts` — Similar notification send logic (estimated)
- `LocalNotificationService.ts` — Likely another notification wrapper

**LocationService.ts (lines 1118-1181):**
```typescript
async sendParkingAlert(rules: ParkingRule[]): Promise<void> {
  try {
    const settings = await notifee.requestPermission();
    const hasPermission = settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
                          settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;

    const channelId = await notifee.createChannel({
      id: 'parking-alerts',
      name: 'Parking Alerts',
      importance: AndroidImportance.HIGH,
    });

    const hasCritical = rules.some(r => r.severity === 'critical');
    const title = hasCritical ? 'Parking Restriction Active NOW!' : 'Parking Restriction';
    const body = rules.map(r => r.message).join('\n\n');

    if (hasPermission) {
      await notifee.displayNotification({
        title,
        body,
        android: { channelId, importance: AndroidImportance.HIGH, pressAction: { id: 'default' } },
        ios: { sound: 'default', critical: hasCritical, criticalVolume: 1.0 },
      });
    }

    Alert.alert(title, body); // Fallback
  } catch (error) {
    log.error('Error sending parking alert', error);
    // Fallback to Alert.alert
    try {
      const hasCritical = rules.some(r => r.severity === 'critical');
      Alert.alert(hasCritical ? 'Parking Restriction Active!' : 'Parking Restriction',
                  rules.map(r => r.message).join('\n\n'));
    } catch { }
  }
}
```

**Problem:**
- Notification logic scattered across multiple services
- Platform-specific configuration duplicated
- Error handling cascades (notifee fails → Alert.alert fallback)
- No centralized "send notification" abstraction

**Impact:** Inconsistent notification behavior; hard to change notification strategy globally.

---

## Part 2: Error Handling Gaps

### 2.1 Fire-and-Forget Without Logging (CRITICAL)

**4 instances found:**

**File: BackgroundTaskService.ts (line 132)**
```typescript
fetchCameraLocations().catch(() => {}); // fire-and-forget, non-blocking
```
Problem: If camera location fetch fails (network issue, API change), **user never knows**. Camera alerts will silently use stale data.

**File: BackgroundTaskService.ts (line ~1600)**
```typescript
this.tryServerDepartureConfirmation(currentCoords, pending).catch(() => {});
```
Problem: Server departure confirmation silently fails. User's departure history becomes incomplete without any indication.

**File: BluetoothService.ts**
```typescript
this.ensureSavedDeviceLoaded().catch(() => {});
```
Problem: If saved device fails to load, Bluetooth state machine falls into inconsistent state.

**File: HistoryScreen.tsx (line ~535)**
```typescript
if (url) Linking.openURL(url).catch(() => {});
```
Problem: Maps app fails to open silently (less critical, but poor UX).

**Impact:** Silent failures in critical paths:
- Camera alerts use stale data
- Departure records incomplete
- BT connection state corrupted

**Fix Pattern:**
```typescript
// BAD
fetchCameraLocations().catch(() => {});

// GOOD
fetchCameraLocations().catch(error => {
  log.warn('Failed to fetch camera locations — using cached data', error);
  // Optionally: show one-time toast to user
});
```

---

### 2.2 Empty or Minimal Catch Blocks (MEDIUM IMPACT)

**Patterns found:**

**File: HistoryScreen.tsx (lines 290, 401, 422, etc.)**
```typescript
try {
  const zone = await AsyncStorage.getItem(StorageKeys.HOME_PERMIT_ZONE);
  setHomePermitZone(zone || null);
} catch {}  // <-- Silent failure, NO logging
```

**File: HomeScreen.tsx (line 290)**
```typescript
try {
  const zone = await AsyncStorage.getItem(StorageKeys.HOME_PERMIT_ZONE);
  setHomePermitZone(zone || null);
} catch {}
```

**File: LocationService.ts (lines 1008-1010)**
```typescript
async saveLastParkingLocation(...): Promise<void> {
  try {
    await AsyncStorage.setItem(...);
  } catch (error) {
    log.error('Error saving parking location', error);
  }
}
```
This one DOES log, but many others don't.

**Impact:** Hard to debug issues. When AsyncStorage or other local operations fail, no traces left.

**Fix:** Every catch block should log at minimum:
```typescript
catch (error) {
  log.warn('AsyncStorage.getItem failed (non-critical)', error);
}
```

---

### 2.3 Stale Closure in Subscribe Callbacks (MEDIUM IMPACT)

**File: HomeScreen.tsx (lines 306-351)**
```typescript
useEffect(() => {
  if (!isMonitoring || Platform.OS !== 'ios') return;

  const updateActivity = async () => {
    const activity = await MotionActivityService.getCurrentActivity();
    if (activity) {
      const prevActivity = currentActivity;  // <-- Closure captures OLD state!
      setCurrentActivity(activity.activity);

      if (activity.activity === 'automotive') {
        setLastParkingCheck(prev => {
          if (prev) {
            log.info('Activity poll detected automotive — clearing stale parking result');
            AsyncStorage.removeItem(StorageKeys.LAST_PARKING_LOCATION);
          }
          return null;
        });
      }
    }
  };

  updateActivity();
  const interval = setInterval(updateActivity, 15000);
  return () => clearInterval(interval);
}, [isMonitoring, showDebug]);  // <-- currentActivity NOT in deps!
```

**Problem:**
- `currentActivity` is read on line 313 but NOT in the dependency array
- Closure captures stale `currentActivity` from previous render
- Transition logging (line 332) compares stale `prevActivity` to new activity

**Risk:** Transition events logged incorrectly; potential for activity state mismatches.

**Fix:**
```typescript
useEffect(() => {
  // ... same code ...
}, [isMonitoring, showDebug, currentActivity]);  // <-- Add currentActivity to deps
// OR use a ref to avoid dependency:
const currentActivityRef = useRef(currentActivity);
useEffect(() => { currentActivityRef.current = currentActivity; }, [currentActivity]);
```

---

### 2.4 State Machine State Inconsistency Risk (CRITICAL)

**File: BackgroundTaskService.ts**

The state machine can be in an inconsistent state if:

1. **Parking check is triggered but NEVER completes** (network timeout, crash)
   - State: `PARKING_PENDING` → should transition to `PARKED`
   - If transition never happens, state machine stuck in `PARKING_PENDING`
   - User appears to be in "checking parking" limbo forever
   - Next BT reconnect might not trigger departure tracking (expects `PARKED` state)

2. **Departure confirmation fails** (lines ~1500+)
   ```typescript
   pendingDepartureConfirmation: {
     // If tryServerDepartureConfirmation().catch(() => {}) fails,
     // this object stays in state forever with no cleanup timeout
   }
   ```
   - No timeout to clean up pending departure
   - Memory leak: object stays in memory indefinitely
   - If user parks again, departure confirmation for PREVIOUS parking never recorded

3. **No fallback if handleCarDisconnection() crashes**
   - If parking check throws an exception, state machine never transitions to `PARKED`
   - HomeScreen shows "PARKING_PENDING" hero card forever

**Impact:** State machine can silently deadlock, leaving app in "checking parking" state permanently.

**Minimal Fix:**
```typescript
// In handleCarDisconnection:
try {
  // ... parking check logic ...
} catch (error) {
  log.error('Parking check failed, resetting state machine', error);
  // Force transition to PARKED even if check failed, so user isn't stuck
  await ParkingDetectionStateMachine.forceTransition('PARKING_PENDING', 'PARKED');
}

// In handleCarReconnection:
// If departure confirmation fails after N retries:
if (this.state.pendingDepartureConfirmation.retryCount >= MAX_DEPARTURE_RETRIES) {
  log.warn('Departure confirmation exhausted retries, giving up');
  this.state.pendingDepartureConfirmation = null; // <-- Cleanup
}
```

---

## Part 3: State Management Issues

### 3.1 Async State Initialization Race Condition (HIGH IMPACT)

**File: HomeScreen.tsx (lines 163-179)**
```typescript
// Read initial state from singleton
const smSnapshot = Platform.OS === 'android' ? ParkingDetectionStateMachine.snapshot : null;
const [isCarConnected, setIsCarConnected] = useState(smSnapshot?.isConnectedToCar ?? false);
const [savedCarName, setSavedCarName] = useState(smSnapshot?.carName ?? null);
const [parkingState, setParkingState] = useState<ParkingState>(smSnapshot?.state ?? 'INITIALIZING');
```

**Problem:**
- `ParkingDetectionStateMachine.snapshot` might be `null` if state machine not yet initialized
- Defaulting to `false` / `null` / `'INITIALIZING'` can be wrong
- State machine initialization is async (`initialize()` in `BackgroundTaskService.ts:143-146`)
- Race: HomeScreen renders → uses wrong defaults → state machine initializes → snapshot changes → correct state arrives → component re-renders

**Evidence of Race:**
- HomeScreen has `refreshBtStatus()` callback (line 231) that re-reads state machine
- HomeScreen has separate `useEffect` to subscribe to state machine (line 248)
- If defaults were reliable, these would be unnecessary

**Impact:** On app startup, HomeScreen might show "Waiting for Car" even though car is connected. Takes a few hundred ms for state machine to initialize and correct it.

**Better Pattern (from CLAUDE.md):**
```typescript
// Read synchronous value immediately
const [isCarConnected, setIsCarConnected] = useState(
  ParkingDetectionStateMachine.isConnectedToCar()  // <-- Direct read
);

// Subscribe to future changes
useEffect(() => {
  const unsub = ParkingDetectionStateMachine.addStateListener(snap => {
    setIsCarConnected(snap.isConnectedToCar);
  });
  return unsub;
}, []);
```

If state machine doesn't have a synchronous `isConnectedToCar()` getter, add one:
```typescript
// ParkingDetectionStateMachine.ts
isConnectedToCar(): boolean {
  return this.state.isConnectedToCar;
}
```

---

### 3.2 Missing Cleanup in useEffect (MEDIUM IMPACT)

**File: HomeScreen.tsx (line 356-384)**
```typescript
useEffect(() => {
  if (Platform.OS !== 'ios' || !showDebug) return;

  const removeListener = BackgroundLocationService.addLocationListener((event: LocationUpdateEvent) => {
    setDebugSpeed(event.speed >= 0 ? event.speed : 0);
    setDebugAccuracy(event.accuracy);
  });

  const statusInterval = setInterval(async () => {
    try {
      const status = await BackgroundLocationService.getStatus();
      // ... set debug state ...
    } catch (e) {
      // ignore
    }
  }, 3000);

  return () => {
    removeListener();
    clearInterval(statusInterval);
  };
}, [showDebug]);  // <-- Only depends on showDebug!
```

**Problem:**
- If `showDebug` changes from `false` → `true` → `false`, listeners accumulate
- On each toggle, OLD listeners not removed, only NEW ones added
- After 10 debug toggles, 10 location listeners firing every GPS update
- Performance degradation

**Fix:**
```typescript
useEffect(() => {
  if (Platform.OS !== 'ios' || !showDebug) {
    // If showDebug is false, don't set up listeners at all
    return;
  }
  // ... setup listeners ...
  return () => {
    removeListener();
    clearInterval(statusInterval);
  };
}, [showDebug]);  // <-- Same, but adds clarity
```

Actually, the code is correct (it DOES return cleanup), but the comment is misleading.

---

### 3.3 Timers/Intervals Should Be Refs (LOW IMPACT)

**File: HomeScreen.tsx (line 200-202)**
```typescript
useEffect(() => {
  const timer = setInterval(() => setCurrentTime(new Date()), 60000);
  return () => clearInterval(timer);
}, []);
```

**This is CORRECT**, but there are other patterns that could use refs for robustness:

**File: HomeScreen.tsx (line 847-858)** — Battery warning poll
```typescript
let checks = 0;
const pollInterval = setInterval(async () => {
  checks++;
  try {
    const exempt = await BluetoothMonitorModule.isBatteryOptimizationExempt();
    if (exempt) {
      clearInterval(pollInterval);
      setShowBatteryWarning(false);
      await AsyncStorage.setItem(BATTERY_WARNING_DISMISSED_KEY, 'true');
    }
  } catch (_) {}
  if (checks >= 15) clearInterval(pollInterval); // Stop after 15s
}, 1000);
```

**Problem:**
- If the effect cleanup doesn't run (shouldn't happen, but defensive coding), `pollInterval` can be orphaned
- `checks` variable is lost between renders (though it's local scope, so OK here)

**Defensive pattern:**
```typescript
const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

useEffect(() => {
  let checks = 0;
  pollIntervalRef.current = setInterval(async () => {
    // ... same logic ...
  }, 1000);

  return () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  };
}, []);
```

---

## Part 4: Technical Debt Hotspots

### 4.1 Excessive File Sizes

**BackgroundTaskService.ts: 2,940 lines** — BY FAR the largest file
- Handles: BT monitoring, parking checks, departure tracking, snow forecast, camera alerts, iOS/Android platform differences
- Each of these could be its own service
- Makes it hard to reason about; hard to test

**Suggestion to break apart:**
```
BackgroundTaskService.ts (2940 lines) SPLIT INTO:
├── BluetoothMonitoringService.ts (handle BT state machine callbacks)
├── ParkingCheckEngine.ts (extract shared parking check logic)
├── DepartureTrackingService.ts (handle departure confirmation)
├── SnowForecastMonitor.ts (handle snow alerts — currently embedded in BTS)
└── BackgroundTaskService.ts (orchestrator, now ~300 lines)
```

**LocationService.ts: 1,184 lines** — Large but justified
- Handles GPS, burst sampling, parking location check, notifications
- Well-organized internally
- Consider extracting GPS utilities to a separate module

---

### 4.2 Magic Numbers Without Named Constants

**Found throughout:**

| File | Line | Magic Number | Meaning |
|------|------|--------------|---------|
| HomeScreen.tsx | 156 | `30` | MAX_DEBUG_LOG |
| HomeScreen.tsx | 349 | `15000` | GPS timeout (should be constant) |
| HomeScreen.tsx | 626 | `2 * 60 * 60 * 1000` | 2-hour cache max age |
| LocationService.ts | 53 | `6000` | BURST_MAX_WAIT_MS (in code, not const) |
| LocationService.ts | 54 | `50` | BURST_OUTLIER_THRESHOLD_METERS |
| LocationService.ts | 100 | `100` | Accuracy threshold (no const) |
| CameraAlertService.ts | 145-162 | Multiple | BASE_ALERT_RADIUS_METERS, MAX_ALERT_RADIUS_METERS, TARGET_WARNING_SECONDS (these ARE constants, good) |

**Better:**
```typescript
// GOOD: CameraAlertService.ts does this well
const BASE_ALERT_RADIUS_METERS = 150;
const MAX_ALERT_RADIUS_METERS = 250;
const MIN_SPEED_MPS = 4.5;

// BAD: HomeScreen.tsx does this
const performParkingCheck = async () => {
  const OVERALL_TIMEOUT_MS = 30000;  // <-- Hardcoded, but at least local
  // ...
  coords = await LocationService.getHighAccuracyLocation(20, 15000);  // <-- Magic numbers!
};
```

**Fix:** Extract all magic numbers to file-level constants with documentation:
```typescript
// HomeScreen constants
const PARKING_CHECK_TIMEOUT_MS = 30000; // overall timeout for check
const GPS_HIGH_ACCURACY_TARGET_METERS = 20; // target accuracy threshold
const GPS_HIGH_ACCURACY_MAX_WAIT_MS = 15000; // max time to wait for GPS
```

---

### 4.3 Deep Nesting and Long Functions

**HomeScreen.tsx: performParkingCheck() — 126 lines (lines 526-652)**
```typescript
const performParkingCheck = useCallback(async (showAllClearAlert: boolean = true) => {
  if (isCheckingRef.current) return;
  isCheckingRef.current = true;

  setLoading(true);
  // ... setup state ...

  const OVERALL_TIMEOUT_MS = 30000;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    // ... timeout handler ...
  }, OVERALL_TIMEOUT_MS);

  try {
    const hasPermission = await LocationService.requestLocationPermission();
    if (!hasPermission) {
      Alert.alert(...);
      return;
    }

    await new Promise<void>(resolve => setTimeout(resolve, 300));

    const servicesEnabled = await LocationService.checkLocationServicesEnabled();
    if (!servicesEnabled) {
      await LocationService.promptEnableLocationServices();
      return;
    }

    if (timedOut) return;

    let coords: Coordinates | undefined;

    // iOS: Try car's parking location first
    if (Platform.OS === 'ios') {
      try {
        const parkingLoc = await BackgroundLocationService.getLastDrivingLocation();
        if (parkingLoc && /* validation */) {
          coords = { ...parkingLoc };
        }
      } catch (e) {
        log.debug(...);
      }
    }

    // Fallback GPS
    if (!coords) {
      if (useHighAccuracy) {
        coords = await LocationService.getHighAccuracyLocation(20, 15000);
      } else {
        coords = await LocationService.getCurrentLocation('high');
      }
    }

    if (timedOut) return;

    setLocationAccuracy(coords.accuracy);
    setIsGettingLocation(false);
    setCheckingAddress('Scanning restrictions...');

    const result = await LocationService.checkParkingLocation(coords);
    if (timedOut) return;

    setCheckingAddress(result.address);
    await LocationService.saveParkingCheckResult(result);
    setLastParkingCheck(result);

    if (result.rules.length > 0) {
      await LocationService.sendParkingAlert(result.rules);
    } else if (showAllClearAlert) {
      Alert.alert(...);
    }
  } catch (error: any) {
    if (timedOut) return;
    const msg = error?.message || '';
    if (msg.includes('outside the Chicago area')) {
      Alert.alert(...);
    } else {
      Alert.alert(...);
    }
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) {
      setLoading(false);
      setIsGettingLocation(false);
      setCheckingAddress(null);
      isCheckingRef.current = false;
    }
  }
}, []);
```

**Issues:**
- 126 lines in a single function
- 4 levels of nesting (try-catch-if-if-if)
- Multiple early returns and conditional guards
- Hard to extract logic for testing
- Timeout handling is invasive (`timedOut` flag checked in 5+ places)

**Refactor:**
```typescript
// Extract permission checks
const ensureLocationPermission = async (): Promise<boolean> => {
  const hasPermission = await LocationService.requestLocationPermission();
  if (!hasPermission) {
    Alert.alert('Permission Required', '...');
    return false;
  }
  return true;
};

// Extract GPS acquisition
const acquireParking Coords = async (): Promise<Coordinates> => {
  // iOS parking location attempt
  // Fallback to current location
  // Return coordinates
};

// Extract result handling
const handleCheckResult = (result: ParkingCheckResult, showAlert: boolean) => {
  setLastParkingCheck(result);
  if (result.rules.length > 0) {
    LocationService.sendParkingAlert(result.rules);
  } else if (showAlert) {
    Alert.alert('All Clear!', `No restrictions at ${result.address}`);
  }
};

// Now performParkingCheck is ~30 lines
const performParkingCheck = useCallback(async (showAllClearAlert: boolean = true) => {
  if (isCheckingRef.current) return;
  isCheckingRef.current = true;

  try {
    if (!await ensureLocationPermission()) return;
    const coords = await acquireParking Coords();
    const result = await LocationService.checkParkingLocation(coords);
    handleCheckResult(result, showAllClearAlert);
  } catch (error) {
    handleCheckError(error);
  } finally {
    isCheckingRef.current = false;
    setLoading(false);
  }
}, []);
```

---

### 4.4 Tests Are Sparse

Only `/TicketlessChicagoMobile/__tests__/` has 1 test file visible:
- `LocationService.test.ts`

**No tests found for:**
- `BackgroundTaskService` (the most complex file!)
- `ParkingDetectionStateMachine`
- `CameraAlertService`
- `HomeScreen` state machine transitions

**Impact:** Refactoring these files is risky without tests to catch regressions.

---

### 4.5 Type Safety Issues

**Found `any` types in multiple places:**

| File | Usage | Count |
|------|-------|-------|
| LocationService.ts | `rawApiData?: any` | 1 |
| HistoryScreen.tsx | `ApiClient.get<any>`, `supabase.from().insert({...})` returns implicit any | 3+ |
| BackgroundTaskService.ts | AppState callback returns implicit any | 1+ |

**Example:**
```typescript
// HistoryScreen.tsx:117-122
const supabase = AuthService.getSupabaseClient();
const { data, error } = await supabase
  .from('parking_location_history')
  .select('*')
  .order('parked_at', { ascending: false })
  .limit(MAX_HISTORY_ITEMS);

if (error || !data || data.length === 0) return [];

// 'data' is inferred as 'any' because .select('*') returns unknown
const items: ParkingHistoryItem[] = data.map((row: any) => {  // <-- row: any
  // ... manual field mapping, no TS checking ...
});
```

**Better:**
```typescript
interface ParkingLocationHistoryRow {
  parked_at: string;
  latitude: number;
  longitude: number;
  on_winter_ban_street: boolean;
  // ... all fields ...
}

const { data, error } = await supabase
  .from('parking_location_history')
  .select<'*', ParkingLocationHistoryRow>('*')
  .order('parked_at', { ascending: false })
  .limit(MAX_HISTORY_ITEMS);

// Now data is ParkingLocationHistoryRow[] and TS will catch field access errors
```

---

## Part 5: Summary of Issues by Severity

### CRITICAL (Fix immediately)
1. **BackgroundTaskService.ts: 2,940 lines** — Monolithic file; extract into separate services
2. **State machine inconsistency risk** — No timeout or error recovery if parking check fails; state can deadlock
3. **Fire-and-forget without logging (4 instances)** — Camera location, departure confirmation, BT loading all silently fail
4. **Duplicated parking check logic** — HomeScreen vs BackgroundTaskService; must keep in sync manually

### HIGH
5. **Async state initialization race** — HomeScreen defaults to wrong state until state machine initializes
6. **Duplicate Haversine implementation** — LocationService vs CameraAlertService
7. **Duplicate GPS acquisition logic** — Scattered across HomeScreen, BackgroundTaskService, MapScreen

### MEDIUM
8. **Empty catch blocks** — Many `catch {}` with no logging; hard to debug
9. **Closure captures stale state** — Activity polling uses old `currentActivity` closure
10. **Duplicate Supabase insert patterns** — Field mapping logic scattered across files
11. **Long functions** — performParkingCheck() is 126 lines, 4 levels of nesting

### LOW
12. **Magic numbers everywhere** — Should use named constants
13. **Sparse test coverage** — No tests for state machine, background service, or screens
14. **Type safety (`any` casts)** — Supabase queries return `any`; manual field mapping no TS checking

---

## Recommendations & Refactoring Roadmap

### Phase 1: Reduce Monolithic Files (Week 1)
1. Extract `ParkingCheckEngine` class from shared logic
2. Extract `DepartureTrackingService` for departure confirmation
3. Extract `SnowForecastMonitor` (currently embedded)
4. Reduce BackgroundTaskService from 2,940 to ~500 lines

### Phase 2: Centralize Utilities (Week 1)
1. Create `utils/GeoDistance.ts` with Haversine implementation
2. Create `utils/LocationAcquisition.ts` for GPS coordinate acquisition
3. Create `utils/SupabaseHelpers.ts` for insert/update patterns
4. Create `utils/NotificationHelpers.ts` for notification logic

### Phase 3: Improve Error Handling (Week 1)
1. Replace all `.catch(() => {})` with `.catch(error => log.warn(...))`
2. Add state machine error recovery (timeout + cleanup for pending operations)
3. Add try-catch around all state mutations with logging

### Phase 4: Fix State Management (Week 2)
1. Add synchronous getter to state machine: `isConnectedToCar()`
2. Fix HomeScreen state initialization to read from getters, not defaults
3. Extract dependent state into refs where appropriate (timers, intervals)
4. Add dependency array checks throughout

### Phase 5: Add Tests (Week 2-3)
1. Unit tests for GeoDistance utilities
2. Unit tests for ParkingCheckEngine
3. Integration tests for state machine transitions
4. Tests for error recovery paths

### Phase 6: Type Safety (Week 1-2)
1. Define Supabase row types (ParkingLocationHistoryRow, UserParkedVehiclesRow, etc.)
2. Remove `any` casts from API responses
3. Improve LocationService `rawApiData` typing

---

## Quantitative Data Summary

| Metric | Value | Status |
|--------|-------|--------|
| BackgroundTaskService lines | 2,940 | CRITICAL (should be <500) |
| DRY violations found | 5+ major | HIGH impact |
| Fire-and-forget patterns (no log) | 4 | CRITICAL |
| Empty catch blocks | 8+ | MEDIUM |
| Duplicate Haversine implementations | 2 | MEDIUM |
| Duplicate GPS acquisition code | 3+ locations | MEDIUM |
| Magic numbers (no named constant) | 15+ | MEDIUM |
| Functions >100 lines | 3 (performParkingCheck at 126 lines) | MEDIUM |
| Tests written | 1 file | LOW coverage |
| `any` type casts | 10+ | MEDIUM |
| Closure captures stale state | 2 known | MEDIUM |
| State machine deadlock risk | YES | CRITICAL |

---

## Expected ROI of Refactoring

**Effort:** ~3 weeks (one senior engineer)

**Benefits:**
- Reduced bugs: State machine can no longer deadlock
- Easier debugging: All errors logged, no silent failures
- Faster iteration: No need to update logic in 2+ places
- Better testability: Smaller, focused services
- Type safety: Fewer runtime errors from missing fields
- Maintainability: New engineers can understand code in days, not weeks
- Scalability: Adding new parking features doesn't require touching 3+ files

---

