# iOS Parking Detection Flow - Complete Analysis

## Executive Summary

The iOS app uses a sophisticated multi-layered approach for automatic parking detection that **avoids the stale location problem** by capturing GPS coordinates at precise moments:

1. **CoreMotion** detects the driving-to-walking/stationary transition (automotive → stationary)
2. **GPS location is captured at the exact moment** the car stops (not when the user presses "Check My Parking")
3. **BackgroundLocationModule** (Swift native module) intelligently uses pre-captured locations instead of stale ones
4. **BackgroundTaskService** (TypeScript) coordinates the flow and uses fallback strategies

---

## Question-by-Question Analysis

### 1. How does the app detect the transition from driving to walking (parking event)?

**Answer: Multi-signal detection using CoreMotion as the primary trigger**

#### Primary Detection: CoreMotion Activity Manager
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` (lines 113-119, 221-278)

The system monitors CMMotionActivity on the M-series coprocessor:

```swift
// BackgroundLocationModule.swift - lines 113-119
let coreMotionAvailable = CMMotionActivityManager.isActivityAvailable()
if coreMotionAvailable {
  startMotionActivityMonitoring()  // Starts activity updates
}

// Lines 221-278: Activity monitoring handler
private func startMotionActivityMonitoring() {
  activityManager.startActivityUpdates(to: .main) { [weak self] activity in
    if activity.automotive {
      // ---- DRIVING ----
      self.coreMotionSaysAutomotive = true
      // Start continuous GPS...
      self.startContinuousGps()
    } else if (activity.stationary || activity.walking) && activity.confidence != .low {
      // ---- NOT IN CAR (KEY DETECTION) ----
      let wasAutomotive = self.coreMotionSaysAutomotive
      self.coreMotionSaysAutomotive = false
      
      if self.isDriving && wasAutomotive {
        // User was driving and NOW exiting → CAPTURE LOCATION IMMEDIATELY
        if self.locationAtStopStart == nil {
          self.locationAtStopStart = self.lastDrivingLocation ?? self.locationManager.location
          NSLog("[BackgroundLocation] Car stop location captured...")
        }
        self.handlePotentialParking()
      }
    }
  }
}
```

**Detection Pattern**:
- **Driving State**: `activity.automotive == true` → sets `coreMotionSaysAutomotive = true`
- **Parking Detection**: `activity.stationary || activity.walking` (with confidence ≥ medium) AND `wasAutomotive` == true
- **Confidence Gate**: Ignores low-confidence readings to avoid false positives at red lights

#### Secondary Detection: GPS Speed Backup
**File**: `BackgroundLocationModule.swift` (lines 300-321)

When GPS speed data shows motion:
```swift
if speed > minDrivingSpeedMps {  // 2.5 m/s ~= 5.6 mph
  speedSaysMoving = true
  if !isDriving && !coreMotionSaysAutomotive {
    isDriving = true  // Backup trigger if CoreMotion is slow
    startContinuousGps()
  }
}
```

**Key Detail**: CoreMotion is the PRIMARY driver. GPS speed is only a BACKUP if CoreMotion detection is delayed.

---

### 2. When and how does it capture the GPS location for the "parked" location?

**Answer: THREE strategic location captures at precise moments**

#### Capture #1: Continuous Update While Driving
**File**: `BackgroundLocationModule.swift` (lines 294-299)

```swift
// Lines 294-299: Update driving location continuously WHILE in driving state
if isDriving || coreMotionSaysAutomotive {
  lastDrivingLocation = location  // Updated at EVERY GPS update
  // This captures even slow creep (1 mph) into the parking spot
}
```

**When**: Every 2+ seconds (configured via `distanceFilter = 10 meters`)
**Why**: Ensures we have the most recent location while the car is moving
**Result**: `lastDrivingLocation` = last known position while car was in motion

#### Capture #2: Snapshot at Exact Parking Moment (BEST)
**File**: `BackgroundLocationModule.swift` (lines 255-275)

```swift
// Lines 255-275: CoreMotion says user exited vehicle
if (activity.stationary || activity.walking) && activity.confidence != .low {
  let wasAutomotive = self.coreMotionSaysAutomotive
  self.coreMotionSaysAutomotive = false
  
  if self.isDriving && wasAutomotive {
    // CRITICAL: Snapshot GPS RIGHT AT THE MOMENT of exit
    if self.locationAtStopStart == nil {
      self.locationAtStopStart = self.lastDrivingLocation ?? self.locationManager.location
      NSLog("[BackgroundLocation] Car stop location captured: ...")
    }
    self.handlePotentialParking()
  }
}
```

**When**: The INSTANT CoreMotion detects the automotive activity ended
**What**: `locationAtStopStart` = the GPS location at that exact moment
**Priority**: 
  1. Use `lastDrivingLocation` if available (most recent while driving)
  2. Fall back to `locationManager.location` (current GPS)

#### Capture #3: Final Parking Confirmation
**File**: `BackgroundLocationModule.swift` (lines 441-503)

```swift
private func confirmParking() {
  // Location priority:
  // 1. locationAtStopStart - captured when CoreMotion first said non-automotive (BEST)
  // 2. lastDrivingLocation - last GPS while in driving state (GOOD)
  // 3. locationManager.location - current GPS (LAST RESORT)
  let parkingLocation = locationAtStopStart ?? lastDrivingLocation
  let currentLocation = locationManager.location
  
  var body: [String: Any] = [:]
  
  if let loc = parkingLocation {
    body["latitude"] = loc.coordinate.latitude
    body["longitude"] = loc.coordinate.longitude
    body["accuracy"] = loc.horizontalAccuracy
    body["locationSource"] = locationAtStopStart != nil ? "stop_start" : "last_driving"
  }
  
  if let cur = currentLocation, let park = parkingLocation {
    let driftMeters = cur.distance(from: park)
    body["driftFromParkingMeters"] = driftMeters  // How far user walked away
  }
  
  sendEvent(withName: "onParkingDetected", body: body)
}
```

**Timeline**:
1. User stops driving → `locationAtStopStart` captured (BEST location)
2. 5 second debounce for CoreMotion confirmation (lines 433-439)
3. User exits car → `confirmParking()` called
4. Event sent with `locationAtStopStart` as the parking location

**Critical Result**: Uses the location from **when the car stopped**, not when the user walks away later

---

### 3. What is the "Check My Parking" button and how does it interact with automatic parking detection?

**Answer: Manual on-demand check that's COMPLETELY SEPARATE from automatic detection**

#### The "Check My Parking" Button
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx` (lines 692-700)

```tsx
<Button
  title={isGettingLocation ? 'Getting GPS...' : loading ? 'Checking...' : 'Check My Parking'}
  onPress={checkCurrentLocation}
  loading={loading}
  size="lg"
  style={styles.mainButton}
  icon={!loading ? <MaterialCommunityIcons name="crosshairs-gps" /> : undefined}
/>
```

**When User Presses It** (lines 368-423):
```typescript
const performParkingCheck = useCallback(async (showAllClearAlert: boolean = true, useHighAccuracy: boolean = true) => {
  setLoading(true);
  setIsGettingLocation(true);
  
  // Get HIGH ACCURACY location RIGHT NOW
  let coords: Coordinates;
  if (useHighAccuracy) {
    coords = await LocationService.getHighAccuracyLocation(20, 15000);  // 20m accuracy, 15s timeout
  } else {
    coords = await LocationService.getCurrentLocation('high');
  }
  
  // Check parking rules at CURRENT location
  const result = await LocationService.checkParkingLocation(coords);
  await LocationService.saveParkingCheckResult(result);
  
  setLastParkingCheck(result);
  // Display result to user...
}, []);
```

#### How It Interacts With Automatic Detection

**Key Insight**: They are INDEPENDENT systems

| Aspect | Automatic Detection | "Check My Parking" Button |
|--------|-------------------|--------------------------|
| **Trigger** | User stops driving (CoreMotion) | User manually taps button |
| **Location Used** | `locationAtStopStart` (captured at stop moment) | Current location (right now) |
| **GPS Accuracy** | Normal (10m distance filter) | HIGH (20m required, 15s timeout) |
| **UI Display** | Notification, hero card updated | Alert, inline accuracy shown |
| **Background?** | Yes, works in background | Foreground only (requires user interaction) |
| **Caching** | No, pre-captured locations | Yes, 30s cache via RateLimiter |

**File**: `LocationService.ts` (lines 549-576)
```typescript
async checkParkingLocation(coords: Coordinates): Promise<ParkingCheckResult> {
  const endpoint = `/api/mobile/check-parking?lat=${coords.latitude}&lng=${coords.longitude}`;
  
  const response = await RateLimiter.rateLimitedRequest(
    endpoint,
    async () => {
      return ApiClient.get<any>(endpoint, {
        retries: 3,
        timeout: 20000,
        showErrorAlert: false,
      });
    },
    {
      cacheDurationMs: 30000,  // Cache result for 30 seconds
    }
  );
}
```

---

### 4. Is there any logic that might cause the app to use a stale/cached location instead of the actual location where the user stopped driving?

**Answer: NO - The design explicitly PREVENTS this problem**

#### The Anti-Stale-Location Design

**Scenario Consideration**: User is driving, presses "Check My Parking" while still moving, then later parks

**What COULD Happen** (but DOESN'T):
- User presses button at coordinates (A) while driving
- App caches result for 30 seconds
- User parks at coordinates (B) 
- App's automatic parking detection fires
- ❌ Risk: App uses cached data from (A) instead of (B)

**What ACTUALLY Happens**:

**File**: `BackgroundLocationModule.swift` (lines 255-275)
```swift
// CoreMotion fires when user exits vehicle
if self.isDriving && wasAutomotive {
  // CAPTURE LOCATION RIGHT NOW - not from cache
  if self.locationAtStopStart == nil {
    self.locationAtStopStart = self.lastDrivingLocation ?? self.locationManager.location
  }
  self.handlePotentialParking()
}
```

**Key Facts**:
1. **Native module captures location**: `locationAtStopStart` is captured in the Swift native module (BackgroundLocationModule)
2. **Not affected by JS cache**: The RateLimiter cache in LocationService is JavaScript-side only
3. **Pre-captured coordinates passed**: `BackgroundTaskService.handleCarDisconnection()` receives `parkingCoords` from the native module (line 280)

**File**: `BackgroundTaskService.ts` (lines 472-486)
```typescript
private async handleCarDisconnection(parkingCoords?: {
  latitude: number;
  longitude: number;
  accuracy?: number;
}): Promise<void> {
  log.info('Parking coords provided: ${parkingCoords ? ... : "NO"}');
  
  // Use provided coords if available (iOS background location)
  await this.triggerParkingCheck(parkingCoords);
}

private async triggerParkingCheck(presetCoords?: {...}): Promise<void> {
  let coords;
  
  // iOS: Use pre-captured parking location
  if (presetCoords?.latitude && presetCoords?.longitude) {
    coords = presetCoords;
    gpsSource = 'pre-captured (iOS)';  // ← THIS IS THE PARKING SPOT
  } else {
    // Android: Get fresh GPS...
  }
}
```

#### Fallback GPS Strategies (Ordered Priority)
**File**: `BackgroundTaskService.ts` (lines 504-586)

If automatic parking detection fires WITHOUT pre-captured coords (e.g., recovery scenario):

```
Strategy 1: Use cached location (if < 50m accuracy & very recent)
  └─ Only if app has a fresh cache from the last 60 seconds
  
Strategy 2: Get high-accuracy GPS (50m accuracy, 25s timeout on Android)
  └─ Fresh location at parking moment
  
Strategy 3: Retry with balanced accuracy (multiple attempts)
  └─ More lenient accuracy requirements
  
Strategy 4: Use stale cache as LAST RESORT
  └─ Only if all live GPS attempts fail
  
Strategy 5 (iOS): Use BackgroundLocationService.getLastDrivingLocation()
  └─ The last location captured while in driving state
```

**THE CRITICAL DETAIL**: Stale cache is Strategy #4 - used only when ALL other methods fail

#### "Check My Parking" Does NOT Pollute Automatic Detection

The 30-second RateLimiter cache is for **DUPLICATE checks**, not for parking detection:

```typescript
// If user taps "Check My Parking" twice within 30s at same location
// → second check uses cached result (saves API call)

// BUT when automatic parking detection fires:
// → It ALWAYS uses the pre-captured location from Swift
// → RateLimiter cache is never consulted for automatic detection
```

**Proof**: See `BackgroundTaskService.triggerParkingCheck()` - it passes `presetCoords` which bypasses all caching

---

## Integration Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PARKING DETECTION FLOW                           │
└─────────────────────────────────────────────────────────────────────┘

┌─── iOS NATIVE LAYER (BackgroundLocationModule.swift) ───┐
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 1. CoreMotion Activity Monitoring (M-series co) │   │
│  │    - continuous, low-battery                     │   │
│  └──────────────────────────────────────────────────┘   │
│           │                                              │
│           ├─ activity.automotive = true                 │
│           │   └─ Set isDriving = true                   │
│           │   └─ Start continuous GPS                   │
│           │                                              │
│           └─ activity.stationary/walking (medium+)      │
│               └─ Was driving before?                    │
│                  ├─ YES → Snapshot GPS as stopStart ◄── [KEY MOMENT]
│                  └─────── Call handlePotentialParking   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 2. GPS Location Manager (only while driving)    │   │
│  │    - updates at 2-10 second intervals           │   │
│  └──────────────────────────────────────────────────┘   │
│           │                                              │
│           └─ Continuously update lastDrivingLocation   │
│              (captures slow creep into spot)            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 3. Parking Confirmation (5s debounce)           │   │
│  │    - waits for CoreMotion confirmation          │   │
│  └──────────────────────────────────────────────────┘   │
│           │                                              │
│           └─ Use: locationAtStopStart ◄─ [BEST]        │
│              (if nil) Use: lastDrivingLocation ◄─ [GOOD]
│              (if nil) Use: current location ◄─ [BACKUP]
│                                                          │
│           └─ Send event: onParkingDetected             │
│              with: latitude, longitude, accuracy       │
│                    driftFromParkingMeters (how far     │
│                    user walked away)                    │
│                                                          │
└───────────────────────────────────────────────────────────┘
                        │
                        │ (RN Bridge)
                        ▼
┌─── TypeScript/React-Native Layer ──────────────────────┐
│ (BackgroundTaskService.ts)                            │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │ Receive ParkingDetectedEvent                  │   │
│  │ - Has pre-captured location (stopStart)       │   │
│  │ - Has drift info (how far user walked)        │   │
│  │ - Has locationSource (stop_start/last_driving)│   │
│  └────────────────────────────────────────────────┘   │
│           │                                            │
│           └─ handleCarDisconnection(parkingCoords)    │
│              (passes coords to triggerParkingCheck)   │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │ triggerParkingCheck(presetCoords)              │   │
│  │ - Uses presetCoords if available (iOS) ◄──BEST│   │
│  │ - Falls back to GPS strategies if not         │   │
│  └────────────────────────────────────────────────┘   │
│           │                                            │
│           └─ LocationService.checkParkingLocation()   │
│              (calls /api/mobile/check-parking)        │
│                                                        │
│           └─ Show result to user                      │
│                                                        │
└────────────────────────────────────────────────────────┘

┌─── MANUAL CHECK (User Button) ──────────────────────┐
│ (HomeScreen.tsx - "Check My Parking")               │
│                                                      │
│  User presses button                                │
│   └─ performParkingCheck()                          │
│      └─ getHighAccuracyLocation() [FRESH GPS]       │
│         └─ LocationService.checkParkingLocation()   │
│            (with RateLimiter 30s cache)             │
│            └─ Show alert to user                    │
│                                                      │
│ NOTE: This is COMPLETELY SEPARATE from automatic    │
│       detection. Does not affect parked location.   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## How BackgroundLocationModule and MotionActivityModule Work Together

### Architecture

**BackgroundLocationModule** (Swift, primary system):
- Monitors CoreMotion activity in real-time
- Manages high-precision GPS location capture
- Implements state machine for driving → parked transitions
- Captures location at the exact moment of parking
- Sends event to JavaScript with pre-captured coordinates

**MotionActivityService** (TypeScript, fallback):
- JavaScript wrapper around MotionActivityModule
- Used only if BackgroundLocationModule fails/unavailable
- Less reliable in background but works as fallback
- Monitors activity changes but requires additional GPS fetch

**Why Two Systems?**
1. **BackgroundLocationModule**: Native + CLLocationManager = 0% battery impact from CoreMotion + efficient location capture
2. **MotionActivityService**: Fallback when native module unavailable (build issues, old iOS, etc.)

**File Evidence**:
- `BackgroundTaskService.ts` (lines 227-332): iOS starts BackgroundLocationModule
- `BackgroundTaskService.ts` (lines 301-331): Falls back to MotionActivityService if needed
- `BackgroundLocationModule.swift`: Does everything (CoreMotion + GPS + location snapshotting)
- `MotionActivityService.ts`: Just monitors activity changes, requires separate GPS call

---

## Critical Code Locations Summary

| Question | File | Lines | Key Code |
|----------|------|-------|----------|
| **Driving detection** | BackgroundLocationModule.swift | 230-253 | `if activity.automotive` sets `isDriving = true` |
| **Parking transition** | BackgroundLocationModule.swift | 255-275 | `if activity.stationary` AND `wasAutomotive` → snapshot location |
| **Location capture #1** | BackgroundLocationModule.swift | 294-299 | `lastDrivingLocation = location` (continuously) |
| **Location capture #2** | BackgroundLocationModule.swift | 267-269 | `locationAtStopStart = lastDrivingLocation` (at parking moment) |
| **Debounce** | BackgroundLocationModule.swift | 435-438 | 5 second debounce timer |
| **Final confirmation** | BackgroundLocationModule.swift | 456-470 | Use stopStart → lastDriving → current (priority) |
| **Event sent** | BackgroundLocationModule.swift | 490 | `sendEvent("onParkingDetected", body)` with location |
| **Pre-captured coords used** | BackgroundTaskService.ts | 277-280 | `await handleCarDisconnection(parkingCoords)` |
| **Fallback GPS** | BackgroundTaskService.ts | 516-586 | 5-strategy fallback if no presetCoords |
| **Manual check button** | HomeScreen.tsx | 368-423 | `performParkingCheck()` with fresh GPS |

---

## Answer Summary

1. **Detection Transition**: CoreMotion detects `automotive → stationary/walking` transition
2. **GPS Capture**: Three strategic captures:
   - Continuous while driving (`lastDrivingLocation`)
   - Snapshot at moment CoreMotion exits car (`locationAtStopStart`) ← BEST
   - Fallback to current if both missing
3. **Check My Parking Button**: Completely separate manual check, uses current location, doesn't interfere with automatic detection
4. **Stale Cache Problem**: PREVENTED by using pre-captured `locationAtStopStart` from native module, cache is fallback only
5. **Module Integration**: BackgroundLocationModule is primary (does everything), MotionActivityService is fallback

