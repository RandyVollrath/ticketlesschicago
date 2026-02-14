# iOS Parking Detection - Complete File Reference

## File Paths (All Absolute)

### Swift Native Modules (iOS)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`
  - **Lines 1-50**: Imports, initialization, configuration constants
  - **Lines 51-68**: Permission request methods
  - **Lines 84-162**: Start/stop monitoring & status API
  - **Lines 113-119**: CoreMotion startup
  - **Lines 204-219**: GPS on-demand battery management
  - **Lines 221-278**: Core activity monitoring handler (PRIMARY LOGIC)
  - **Lines 230-253**: Driving state detection
  - **Lines 255-275**: Parking transition detection & location snapshot
  - **Lines 282-334**: CLLocationManager delegate with GPS updates
  - **Lines 294-299**: Continuous location update while driving
  - **Lines 300-321**: GPS speed backup driving detection
  - **Lines 340-398**: Recovery check for missed parking events
  - **Lines 414-439**: Potential parking handler with debounce
  - **Lines 441-503**: Final parking confirmation (LOCATION PRIORITY)
  - **Lines 456-470**: Location source selection (stopStart > lastDriving > current)
  - **Lines 507-514**: Helper functions

- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/MotionActivityModule.swift`
  - **Lines 1-27**: Imports and class setup
  - **Lines 24-62**: Activity monitoring start
  - **Lines 115-130**: Activity type mapping
  - **Lines 72-102**: Current activity query

### TypeScript/React-Native Services

#### BackgroundTaskService (Orchestration Layer)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`
- **Lines 1-66**: Type definitions and state management
- **Lines 72-104**: Initialize method
- **Lines 111-152**: iOS self-test for module verification
- **Lines 171-191**: Start monitoring
- **Lines 196-215**: Stop monitoring
- **Lines 223-390**: Start foreground monitoring (ORCHESTRATION)
  - **Lines 227-332**: iOS setup with BackgroundLocationService
  - **Lines 260-287**: Parking detected callback registration
  - **Lines 301-331**: Fallback to motion-only if needed
  - **Lines 333-375**: Android Bluetooth setup
  - **Lines 426-443**: GPS pre-caching for Android
- **Lines 472-496**: handleCarDisconnection - RECEIVES parkingCoords from native
  - **Lines 477-478**: Logs parking coords source
  - **Lines 486**: Calls triggerParkingCheck with presetCoords
- **Lines 504-632**: triggerParkingCheck - USES PRE-CAPTURED LOCATION (CRITICAL)
  - **Lines 517-520**: Uses presetCoords if available (iOS)
  - **Lines 528-586**: Fallback GPS strategies (5-tier priority)
  - **Lines 516**: Strategy comment: Pre-captured (iOS) is BEST
  - **Lines 552-556**: Stale cache as last resort
  - **Lines 557-567**: Last driving location fallback
- **Lines 638-752**: Schedule restriction reminders
- **Lines 844-882**: Periodic check as backup
- **Lines 959-1001**: Mark car reconnected & departure confirmation

#### BackgroundLocationService (JavaScript Wrapper)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundLocationService.ts`
- **Lines 1-46**: Type definitions for ParkingDetectedEvent
  - **Line 31-38**: Event structure includes locationSource & driftFromParkingMeters
- **Lines 58-70**: Initialization
- **Lines 120-177**: Start monitoring - registers callbacks
  - **Lines 141-154**: onParkingDetected event listener
  - **Lines 168**: BackgroundLocationModule.startMonitoring()
- **Lines 242-258**: getLastDrivingLocation() - location fallback method
- **Lines 263-270**: addLocationListener for debugging

#### LocationService (API & GPS Management)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts`
- **Lines 509-521**: Location caching methods (getCachedLocation, getLastKnownLocation, clearLocationCache)
- **Lines 549-576**: checkParkingLocation - API CALL WITH CACHE
  - **Lines 561-576**: RateLimiter with 30-second cache (for duplicate checks only)
  - **Line 574**: `cacheDurationMs: 30000` - cache duration
- **Lines 600-648**: Rule extraction from API response (no location re-processing)

### UI Layer

#### HomeScreen (UI with Manual Check Button)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx`
- **Lines 139-162**: Component state setup
- **Lines 209-273**: Activity polling (iOS motion debug)
- **Lines 242-273**: Real-time location debug listener
- **Lines 312-334**: autoStartMonitoring - calls BackgroundTaskService.startMonitoring
- **Lines 322-330**: BackgroundTaskService initialization
- **Lines 354-357**: handleCarDisconnect callback from monitoring
- **Lines 368-423**: performParkingCheck - MANUAL CHECK WITH FRESH GPS
  - **Line 393-395**: getHighAccuracyLocation(20m accuracy, 15s timeout)
  - **Line 402-403**: Calls checkParkingLocation with fresh coords
  - **Line 406**: Saves result to storage
- **Lines 425-427**: checkCurrentLocation button handler
- **Lines 464-486**: getHeroState - determines UI state based on monitoring/activity
  - **Lines 468-475**: Shows "driving" if CoreMotion says automotive
- **Lines 692-700**: Button definition
  - **Line 694**: Loading states (Getting GPS / Checking)
  - **Line 695**: Calls checkCurrentLocation on press

### Service Initialization Chain

1. **App.tsx** → calls `HomeScreen.tsx`
2. **HomeScreen.tsx** `autoStartMonitoring()` → calls `BackgroundTaskService.initialize()`
3. **BackgroundTaskService.initialize()**
   - Calls `BackgroundTaskService.startMonitoring()`
   - On iOS: Calls `BackgroundLocationService.startMonitoring()`
   - Which calls: `BackgroundLocationModule.startMonitoring()` (Swift)
4. **Swift module starts**: CoreMotion + GPS monitoring
5. **Parking event**: Swift `sendEvent("onParkingDetected", body)` → TypeScript receives via NativeEventEmitter
6. **TypeScript callback**: `BackgroundTaskService.handleCarDisconnection(parkingCoords)`
7. **Checks parking**: `triggerParkingCheck(presetCoords)` uses pre-captured location

---

## Key Variable Tracking

### In BackgroundLocationModule.swift

| Variable | Purpose | Updated | Used For |
|----------|---------|---------|----------|
| `isDriving` | Driving state | Lines 244, 304, 308 | Core state machine |
| `coreMotionSaysAutomotive` | CoreMotion activity flag | Lines 235, 262 | Transition detection |
| `drivingStartTime` | When driving began | Line 245, 307 | Duration calculation |
| `lastDrivingLocation` | Last GPS while driving | Lines 297, 318 | Fallback location |
| `locationAtStopStart` | **PARKING LOCATION** | Line 268 | **SENT TO JS** (best location) |
| `lastStationaryTime` | When stopped began | Line 428 | Debounce timer |
| `continuousGpsActive` | GPS power state | Lines 208, 217 | Battery optimization |

### In BackgroundTaskService.ts

| Variable | Purpose | Set From | Used For |
|----------|---------|----------|----------|
| `parkingCoords` | Pre-captured location from native | Event from BackgroundLocationModule | Passed to triggerParkingCheck |
| `presetCoords` | iOS location parameter | `parkingCoords` from native | Used if available |
| `gpsSource` | Location source description | Strategy selection | Logging |
| `lastParkingCheckTime` | When last check occurred | triggerParkingCheck | Cooldown tracking |

---

## Data Flow Diagram (With Line Numbers)

```
User Drives
   │
   └─ CoreMotion: activity.automotive = true
      │
      └─ BackgroundLocationModule.swift:230-253
         │
         └─ Set isDriving = true (line 244)
         └─ startContinuousGps() (line 247)
         └─ sendEvent("onDrivingStarted") (line 249)

User Parks Car
   │
   └─ CoreMotion: activity.stationary/walking
      │
      └─ BackgroundLocationModule.swift:255-275
         │
         └─ Detect wasAutomotive (line 261)
         └─ Snapshot location (line 268):
            ├─ locationAtStopStart = lastDrivingLocation
            └─ OR locationAtStopStart = locationManager.location
         │
         └─ handlePotentialParking() (line 273)
            │
            └─ Check driving duration (line 422)
            └─ Set lastStationaryTime (line 428)
            └─ Schedule 5s debounce timer (lines 435-438)

5 Seconds Later (Debounce)
   │
   └─ confirmParking() (line 437)
      │
      └─ Select best location (line 459):
         ├─ locationAtStopStart (BEST - line 470)
         ├─ lastDrivingLocation (GOOD)
         └─ locationManager.location (LAST RESORT)
      │
      └─ Calculate drift: currentLocation - parkingLocation (line 481)
      │
      └─ Build event body (lines 462-488):
         ├─ latitude, longitude, accuracy
         ├─ locationSource: "stop_start" or "last_driving"
         └─ driftFromParkingMeters
      │
      └─ sendEvent("onParkingDetected", body) (line 490)
      │
      └─ Reset state (lines 493-499)
      └─ Stop GPS (line 502)

JavaScript Receives Event
   │
   └─ BackgroundLocationService.ts:141-154
      │
      └─ Callback: onParkingDetected(event)
         │
         └─ BackgroundTaskService.ts:262-281
            │
            └─ handleCarDisconnection(parkingCoords)
               ├─ parkingCoords = { latitude, longitude, accuracy }
               └─ locationSource = event.locationSource
               │
               └─ triggerParkingCheck(parkingCoords) (line 280)
                  │
                  └─ Check presetCoords (lines 517-520)
                     │
                     └─ IF iOS && presetCoords:
                        └─ USE presetCoords (line 518)
                        └─ gpsSource = "pre-captured (iOS)"
                     │
                     └─ ELSE (Android/fallback):
                        └─ 5-strategy GPS fallback (lines 528-586)
                           ├─ Strategy 1: Cached location (< 60s old)
                           ├─ Strategy 2: High accuracy GPS (50m, 25s)
                           ├─ Strategy 3: Retry balanced GPS
                           ├─ Strategy 4: Stale cache (LAST RESORT)
                           └─ Strategy 5: LastDrivingLocation (iOS)
                  │
                  └─ LocationService.checkParkingLocation(coords) (line 594)
                     │
                     └─ /api/mobile/check-parking API call (line 561)
                        └─ With RateLimiter cache (30s for DUPLICATE checks)
                     │
                     └─ Return rules, address, etc.
                  │
                  └─ Save result (line 605)
                  └─ Send notification (line 613)

User Manually Checks (Button Press)
   │
   └─ HomeScreen.tsx:368-423 performParkingCheck()
      │
      └─ Get HIGH ACCURACY location:
         ├─ getHighAccuracyLocation(20m accuracy, 15s timeout)
         └─ getCurrentLocation('high') (as fallback)
      │
      └─ LocationService.checkParkingLocation(coords) (line 402)
         │
         └─ RateLimiter: If checked in last 30s at same location,
            │           return cached result (saves API call)
            └─ Else: Call API with fresh location
      │
      └─ Save result to AsyncStorage (line 403)
      └─ Show alert to user (line 414)

NOTE: Manual check is COMPLETELY SEPARATE
      Does NOT affect automatic parking detection location
```

---

## All Related Files Summary

```
iOS Parking Detection System Files:

Tier 1 - Core Detection (Swift, Native)
├─ BackgroundLocationModule.swift
│  └─ CoreMotion activity monitoring
│  └─ GPS location capture at 3 strategic moments
│  └─ State machine for driving/parking transitions
│  └─ Event emission to JavaScript
│
├─ MotionActivityModule.swift
│  └─ CoreMotion activity wrapper (fallback only)
│  └─ Less reliable, requires additional GPS
│
Tier 2 - Orchestration (TypeScript)
├─ BackgroundTaskService.ts
│  └─ Coordinates native modules
│  └─ Implements fallback strategies
│  └─ Handles pre-captured coordinates from Swift
│  └─ Makes API calls with location data
│
├─ BackgroundLocationService.ts
│  └─ JavaScript wrapper for BackgroundLocationModule
│  └─ Registers callbacks for events
│  └─ Handles permissions
│
├─ LocationService.ts
│  └─ GPS acquisition methods
│  └─ API call to check-parking endpoint
│  └─ Location caching (30s for duplicate checks)
│
├─ MotionActivityService.ts
│  └─ JavaScript wrapper for MotionActivityModule
│  └─ Fallback if BackgroundLocationModule unavailable
│
Tier 3 - UI (React Native)
├─ HomeScreen.tsx
│  └─ Manual "Check My Parking" button
│  └─ Activity/driving state display
│  └─ Auto-start monitoring on app load
│  └─ iOS debug overlay
│
├─ MotionActivityService.ts (also used directly)
│  └─ getCurrentActivity() called for UI display
│
Related Config/Setup
├─ App.tsx
│  └─ App initialization
│
├─ AppDelegate.swift
│  └─ Native app setup
│
Dependencies
├─ react-native-background-fetch
├─ @react-native-community/hooks
├─ CoreLocation (iOS)
├─ CoreMotion (iOS)
```

