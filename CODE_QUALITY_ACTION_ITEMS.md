# Code Quality Review - Quick Action Items

## Immediate Fixes (This Week)

### 1. Fix Fire-and-Forget Patterns (30 min)
**Files to modify:**
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts:132`
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts:~1600`
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BluetoothService.ts`

**Changes:**
```typescript
// Before
fetchCameraLocations().catch(() => {});

// After
fetchCameraLocations().catch(error => {
  log.warn('Failed to fetch camera locations — using cached data', error);
});
```

### 2. Add State Machine Error Recovery (1 hour)
**File:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

**Changes needed:**
- Wrap parking check in try-catch
- If exception, force transition to PARKED so state machine doesn't deadlock
- Add timeout cleanup for `pendingDepartureConfirmation` after MAX_RETRIES

### 3. Extract Haversine to Shared Utility (30 min)
**New file:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/GeoDistance.ts`

**Remove from:**
- `LocationService.ts:619-632`
- `CameraAlertService.ts:814-831`

### 4. Add Named Constants to HomeScreen (30 min)
**File:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`

**Add to top:**
```typescript
// GPS acquisition constants
const GPS_HIGH_ACCURACY_TARGET_METERS = 20;
const GPS_HIGH_ACCURACY_MAX_WAIT_MS = 15000;
const GPS_PARKING_LOCATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// Parking check constants
const PARKING_CHECK_TIMEOUT_MS = 30000;
const ACTIVITY_POLL_INTERVAL_MS = 15000;
```

### 5. Fix Async State Initialization Race (45 min)
**File:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx:163-179`

**Before:**
```typescript
const smSnapshot = Platform.OS === 'android' ? ParkingDetectionStateMachine.snapshot : null;
const [isCarConnected, setIsCarConnected] = useState(smSnapshot?.isConnectedToCar ?? false);
```

**After:**
```typescript
const [isCarConnected, setIsCarConnected] = useState(
  Platform.OS === 'android' && ParkingDetectionStateMachine.isConnectedToCar
    ? ParkingDetectionStateMachine.isConnectedToCar()
    : false
);
```

(Requires adding `isConnectedToCar()` getter to ParkingDetectionStateMachine if missing)

---

## Phase 1: Reduce Monolithic Files (Week 2)

### Create ParkingCheckEngine.ts
**File:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/ParkingCheckEngine.ts`

**Extract from:**
- HomeScreen.performParkingCheck() lines 526-652
- BackgroundTaskService.handleCarDisconnection() ~1500+

**New file logic:**
```typescript
export class ParkingCheckEngine {
  async performCheck(
    coords?: Coordinates,
    highAccuracy?: boolean
  ): Promise<ParkingCheckResult> {
    // All shared parking check logic here
    // Remove duplication between HomeScreen and BackgroundTaskService
    
    const finalCoords = coords || await this.acquireCoordinates(highAccuracy);
    return await LocationService.checkParkingLocation(finalCoords);
  }

  private async acquireCoordinates(highAccuracy?: boolean): Promise<Coordinates> {
    // iOS parking location cache attempt
    // Fallback to current/high-accuracy location
  }
}
```

**Then update:**
- `HomeScreen.tsx` calls: `const result = await parkingEngine.performCheck();`
- `BackgroundTaskService.ts` calls: `const result = await parkingEngine.performCheck(detectedCoords);`

### Create DepartureTrackingService.ts
**File:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/DepartureTrackingService.ts`

**Extract from:** `BackgroundTaskService.ts` (departure tracking logic, ~200 lines)

**Reduces BackgroundTaskService from 2,940 to ~2,700 lines**

---

## Phase 2: Add Type Safety (Week 2)

### Define Supabase Row Types
**New file:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/types/supabase.ts`

```typescript
export interface ParkingLocationHistoryRow {
  parked_at: string;
  latitude: number;
  longitude: number;
  address: string | null;
  on_winter_ban_street: boolean;
  winter_ban_street_name: string | null;
  // ... all fields from schema ...
}

export interface UserParkedVehiclesRow {
  // ... similar ...
}
```

**Then update:** `HistoryScreen.tsx:117` to use typed `select<'*', ParkingLocationHistoryRow>('*')`

---

## Phase 3: Add Tests (Week 3)

### Unit Test: GeoDistance.ts
**File:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/__tests__/utils/GeoDistance.test.ts`

```typescript
describe('haversineDistance', () => {
  it('calculates distance between two Chicago points correctly', () => {
    // Millennium Park to Willis Tower (known ~2.6km apart)
    const dist = haversineDistance(41.8827, -87.6233, 41.8789, -87.6359);
    expect(Math.round(dist / 100) * 100).toBe(2600); // Within 100m
  });
});
```

### Unit Test: ParkingCheckEngine.ts
**File:** `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/__tests__/services/ParkingCheckEngine.test.ts`

```typescript
describe('ParkingCheckEngine', () => {
  it('performs parking check with provided coordinates', async () => {
    const engine = new ParkingCheckEngine();
    const result = await engine.performCheck({ latitude: 41.88, longitude: -87.63 });
    expect(result).toBeDefined();
    expect(result.rules).toBeDefined();
  });
});
```

---

## Files Most Critical to Review

### Ranked by Impact of Issues

1. **BackgroundTaskService.ts** (2,940 lines) — CRITICAL
   - Issues: Monolithic, fire-and-forget without logging, state machine deadlock risk
   - Effort to fix: 4 hours (split into 3 services, add error recovery)
   - Impact: Most complex file, hardest to debug

2. **HomeScreen.tsx** (686 lines) — HIGH
   - Issues: 126-line function, stale closure, async init race condition
   - Effort to fix: 2 hours (extract functions, fix state init)
   - Impact: User sees wrong connection state at startup

3. **LocationService.ts** (1,184 lines) — MEDIUM
   - Issues: Duplicate Haversine, magic numbers, notification duplication
   - Effort to fix: 1.5 hours (extract utils, add constants)
   - Impact: Hard to reason about due to size

4. **CameraAlertService.ts** (903 lines) — LOW-MEDIUM
   - Issues: Duplicate Haversine, magic numbers (though constants exist)
   - Effort to fix: 30 min (use GeoDistance utility)
   - Impact: Minimal; code is otherwise well-organized

5. **HistoryScreen.tsx** (1,373 lines) — LOW
   - Issues: Type safety (any casts), Supabase field mapping duplication
   - Effort to fix: 1 hour (add types, remove any casts)
   - Impact: Low; mostly view code

---

## Refactoring Roadmap (3 weeks)

### Week 1: Fix Critical Issues
- Day 1-2: Fire-and-forget → logging, state machine error recovery
- Day 3: Extract Haversine to GeoDistance.ts
- Day 4: Add named constants to HomeScreen
- Day 5: Fix async state initialization race

**Expected reduction:** BackgroundTaskService issues from CRITICAL to MEDIUM

### Week 2: Break Apart Monolithic Files
- Day 1-2: Extract ParkingCheckEngine, reduce duplication
- Day 3-4: Extract DepartureTrackingService
- Day 5: Extract SnowForecastMonitor (if time)

**Expected result:** BackgroundTaskService 2,940 → 500 lines

### Week 3: Type Safety & Testing
- Day 1-2: Add Supabase row types, remove `any` casts
- Day 3-5: Write unit tests for extracted services

**Expected result:** 95% type safety, >80% test coverage for core services

---

## Verification Checklist

After completing fixes, verify:

- [ ] No `.catch(() => {})` patterns remain (all have logging)
- [ ] BackgroundTaskService under 1,000 lines (broken into 3-4 services)
- [ ] No `any` type casts in Supabase queries
- [ ] All magic numbers have named constants
- [ ] performParkingCheck() under 50 lines
- [ ] State machine error recovery in place (no deadlock paths)
- [ ] Unit tests for GeoDistance, ParkingCheckEngine, DepartureTracking
- [ ] HomeScreen shows correct connection state on startup (no async race)

---

## Testing After Refactoring

**Manual testing on real device:**
- [ ] Select car → HomeScreen shows "Connected to [car]" within 2s
- [ ] Car BT disconnects → Parking check triggers after 10s debounce
- [ ] Parking check completes → No state machine deadlock
- [ ] Manual parking check → No duplication between two code paths
- [ ] Drive away while parked → Departure tracked (not stuck in PARKING_PENDING)
- [ ] Camera alert fires → Uses latest camera data (not stale)

---

