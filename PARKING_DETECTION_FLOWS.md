# Parking Detection System - Visual Flows

## Android Parking Detection Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    CAR CONNECTED (BT ACL)                   │
│             (OnDeviceConnected callback fires)               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         ParkingDetectionStateMachine.btConnected()           │
│                  (line 223-245)                              │
│                                                              │
│  DRIVING ──────────────────────► (no-op, already driving)    │
│  IDLE ────► DRIVING              (start camera alerts)       │
│  PARKING_PENDING ──► DRIVING    (transient disconnect ended) │
│  PARKED ──► DRIVING              (DEPARTURE EVENT!)          │
└─────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────┐
│              CAR DISCONNECTED (BT ACL Broken)                │
│             (OnDeviceDisconnected callback)                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         BluetoothService.notifyDisconnected()                │
│        Emits 'BtMonitorCarDisconnected' event                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│   BackgroundTaskService receives native event                │
│        (line 701-710)                                        │
│                                                              │
│  ParkingDetectionStateMachine.btDisconnected('bt_acl')      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│            STATE TRANSITION: DRIVING → PARKING_PENDING       │
│                  (line 252-267)                              │
│                                                              │
│  ┌─ startDebounce(3000ms) ─────────────────────────────┐   │
│  │ Timer starts: wait 3s for BT reconnect              │   │
│  │ If BT reconnects within 3s:                         │   │
│  │   → DEBOUNCE_CANCELLED                              │   │
│  │   → PARKING_PENDING → DRIVING                        │   │
│  │   → No parking check! (was just red light)           │   │
│  └────────────────────────────────────────────────────┘   │
│                                                              │
│  If NO BT reconnect within 3s:                             │
│   → Timer expires (line 554-571)                            │
│   → transition('PARKED', 'PARKING_CONFIRMED', 'system')     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│     STATE TRANSITION: PARKING_PENDING → PARKED               │
│                                                              │
│  Registered callback fires (line 176-183):                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │ 'PARKING_PENDING->PARKED' event                    │    │
│  │   → handleCarDisconnection()                       │    │
│  │   → stopCameraAlerts()                             │    │
│  │   → Send diagnostic notification                   │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│        handleCarDisconnection() [line 1056-1110]             │
│                                                              │
│  1. Debounce check (30s) - skip if recent                   │
│  2. Finalize previous parking's departure                   │
│  3. Clear location cache for fresh GPS                      │
│  4. Record disconnect timestamp                             │
│  5. Call triggerParkingCheck()                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
           ┌───────────┴──────────────┐
           │                          │
           ▼                          ▼
    ┌────────────────┐      ┌────────────────────┐
    │  PHASE 1: GPS  │      │  PHASE 2: BURST    │
    │  Fast Fix      │      │  Refinement        │
    │  (1-3 seconds) │      │  (background)      │
    │                │      │                    │
    │ Get location   │      │ If drift > 25m:    │
    │ immediately    │      │ - Re-check rules   │
    │ for fast       │      │ - Update history   │
    │ notification   │      │ - Re-notify user   │
    └────────┬───────┘      └─────────┬──────────┘
             │                        │
             └────────────┬───────────┘
                          │
                          ▼
         ┌──────────────────────────────────┐
         │ LocationService.checkParkingLocation()
         │ Call backend API with coordinates
         │ Returns: { rules, address, ... }
         └────────────┬─────────────────────┘
                      │
           ┌──────────┴──────────┐
           ▼                     ▼
    ┌─────────────┐      ┌──────────────┐
    │Save History │      │Save to Server│
    │(local DB)   │      │(for push     │
    │             │      │reminders)    │
    └─────────────┘      └──────────────┘
           │                     │
           └──────────┬──────────┘
                      │
                      ▼
         ┌───────────────────────┐
         │ Send Notification     │
         │                       │
         │ ▪ "Restrictions here" │
         │   (if rules found)    │
         │ ▪ "All clear"         │
         │   (if no rules)       │
         └──────────┬────────────┘
                    │
                    ▼
         ┌───────────────────────┐
         │ Schedule Reminders    │
         │ • Street cleaning     │
         │ • Permit zones        │
         │ • Snow forecasts      │
         └───────────────────────┘
```

## iOS Parking Detection Flow

```
┌────────────────────────────────────────────────────┐
│         CoreMotion Detects: automotive             │
│      (M-series coprocessor, near-zero battery)     │
│                                                    │
│  Sets: isDriving = true                            │
│        startContinuousGps()                        │
│        lastDrivingLocation = [continuously updated]
└────────────────────────────────────────────────────┘
                       │
                       │ [User drives...]
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│     GPS Speed > 2.5 m/s (moving)                   │
│     speedSaysMoving = true                         │
│                                                    │
│     [User continues driving...]                   │
└────────────────────────────────────────────────────┘
                       │
                       │ [User approaching parking spot]
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│        GPS Speed ≤ 0.5 m/s (stopped)               │
│                                                    │
│  1. Capture locationAtStopStart = location         │
│  2. Start speedZeroTimer (repeating, 3s interval)  │
│  3. speedZeroStartTime = now                       │
│  4. stationaryLocation = location                  │
└────────────────┬─────────────────────────────────┘
                 │
                 │ [Repeat every 3 seconds]
                 ▼
┌────────────────────────────────────────────────────┐
│   SPEED ZERO TIMER TICK [line 622-676]             │
│                                                    │
│  Check 1: Is CoreMotion non-automotive?           │
│  ├─ YES → confirmParking("gps_coremotion_agree")  │
│  └─ NO → continue...                              │
│                                                    │
│  Check 2: Phone stationary 2+ min & within 50m?   │
│  ├─ YES → confirmParking("location_stationary")   │
│  └─ NO → continue...                              │
│                                                    │
│  Check 3: Speed resumed > 2.5 m/s?                │
│  ├─ YES → Cancel timer (red light ended)          │
│  └─ NO → Loop again in 3 seconds                  │
└────────────────────────────────────────────────────┘
           │
           │ One of the above conditions met
           │
           ▼
┌────────────────────────────────────────────────────┐
│         confirmParking(source)                     │
│                                [line 800-909]      │
│                                                    │
│  isDriving = false                                │
│  coreMotionSaysAutomotive = false                 │
│  speedSaysMoving = false                          │
│  stopContinuousGps()                              │
│  hasConfirmedParkingThisSession = true            │
│                                                    │
│  Select parking location:                         │
│  1. locationAtStopStart (best)                    │
│  2. lastDrivingLocation (good)                    │
│  3. locationManager.location (fallback)           │
│                                                    │
│  Use GPS timestamp from location (when car        │
│  actually stopped), not timer fire time           │
│                                                    │
│  sendEvent("onParkingDetected", {                 │
│    timestamp,                                     │
│    latitude, longitude, accuracy,                 │
│    drivingDurationSec, locationSource             │
│  })                                               │
│                                                    │
│  NOTE: Keep CoreMotion RUNNING [line 899-908]     │
│  Only stop continuous GPS to save battery         │
└────────────────┬─────────────────────────────────┘
                 │
                 ▼
    ┌──────────────────────────────────┐
    │  BackgroundTaskService receives   │
    │  "onParkingDetected" event        │
    │  [line 403-425]                   │
    │                                   │
    │  handleCarDisconnection(          │
    │    parkingCoords,                 │
    │    nativeTimestamp                │
    │  )                                │
    └──────────────┬───────────────────┘
                   │
        ┌──────────▼──────────┐
        │ IDENTICAL TO ANDROID│
        │ Phase 1 GPS, Phase 2│
        │ Burst, API call,    │
        │ Save, Notify        │
        └─────────────────────┘
```

## RED LIGHT vs PARKING Decision Tree (iOS)

```
    START DRIVING
         │
         ▼
    CoreMotion says: AUTOMOTIVE
    isDriving = true
    startContinuousGps()
         │
         │ [Approaching traffic light]
         │
         ▼
    GPS speed drops to ≈0
    speedZeroTimer starts
         │
         ├─── 3 seconds pass ───┐
         │                      │
         ▼                      ▼
    Light turns GREEN       Phone stays at 0 speed
    GPS speed > 2.5 m/s     │
    │                       ├─── Wait for 2 minutes ───┐
    │                       │                          │
    ▼                       ▼                          ▼
    Cancel timer       At 1:59 still        At 2:00+ still at
    No parking event   at red light         same spot
         │             │                    │
         │             ├─ User walked away? ├─ No, user is in car
         │             │  (> 50m from spot) │  (not walking)
         │             │                    │
         │             ▼                    ▼
         │         Speed check again    Location-based override:
         │         Speed > 2.5?         CONFIRM PARKING
         │         │                    locationSource: "location_stationary"
         │         ├─ YES: Cancel timer │
         │         │ No parking         │
         │         │                    │
         │         └─ NO: Keep waiting  │
         │           (up to some limit) │
         │                              │
         │                              │
         └──────────────┬───────────────┘
                        │
            RED LIGHT:  │  ACTUAL PARKING:
            No parking  │  Confirm parking ✓
            detected ✓  │
```

## State Machine State Diagram

```
                    ┌─────────────────┐
                    │  INITIALIZING   │
                    │  (at app start) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        BT_INIT_    BT_INIT_       [timeout]
        CONNECTED   DISCONNECTED
              │              │              │
              ▼              ▼              ▼
         ┌────────┐    ┌────────┐    ┌────────┐
         │ DRIVING│    │ IDLE   │    │ IDLE   │
         └───┬────┘    └────┬───┘    └────┬───┘
             │              │              │
      BT_DISCONNECTED  BT_CONNECTED  (same)
             │              │
             ▼              ▼
        ┌─────────────────────────┐
        │  PARKING_PENDING        │
        │  (3-second debounce)    │
        │                         │
        │  [If BT reconnects:] ───┼──→ DRIVING
        │  DEBOUNCE_CANCELLED      │
        │                          │
        │  [If no reconnect:] ─────┼──→ PARKED
        │  DEBOUNCE_EXPIRED        │
        │  PARKING_CONFIRMED       │
        └─────────────────────────┘
             │              │
             └──────┬───────┘
                    │
              BT_RECONNECTED
              DEPARTURE_DETECTED
                    │
                    ▼
              ┌──────────┐
              │ PARKED   │◄─────────────────┐
              └────┬─────┘                  │
                   │                       │
              BT_CONNECTED                 │
              (user driving again)         │
                   │                       │
                   ▼                       │
              ┌──────────┐                 │
              │ DRIVING  │                 │
              └──────────┘      [Manual or server restore]
                                │
                                └─ MANUAL_PARKING_SET


STABLE STATES (persisted to AsyncStorage):
  • DRIVING
  • PARKED
  • IDLE

TRANSIENT STATES (NOT persisted - discarded on app crash):
  • INITIALIZING
  • PARKING_PENDING
```

## Departure Tracking Flow

```
┌────────────────────────────────────────┐
│   User Starts Driving From Parked Spot │
│                                        │
│   Android: BT reconnects               │
│   iOS: CoreMotion automotive +         │
│        GPS speed > 2.5 m/s             │
└────────────────┬───────────────────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ State Machine:       │
      │ PARKED → DRIVING     │
      │ (Transition event)   │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────────────────┐
      │ Callback fires:                  │
      │ "PARKED->DRIVING"                │
      │ [line 188-192]                   │
      │                                  │
      │ handleCarReconnection()           │
      │   └─ markCarReconnected()         │
      └──────────┬───────────────────────┘
                 │
                 ▼
      ┌──────────────────────────────────┐
      │ markCarReconnected()              │
      │ [Implementation not in visible    │
      │  code - NEEDS VERIFICATION]      │
      │                                  │
      │ Expected behavior:                │
      │ 1. Get most recent parking       │
      │    without departure              │
      │ 2. Set departure = now            │
      │ 3. Save to history                │
      │ 4. Notify "You left at [time]"   │
      └──────────┬───────────────────────┘
                 │
                 ▼
      ┌──────────────────────────────────┐
      │ Try Orphaned Recovery             │
      │ [line 234]                        │
      │                                  │
      │ If state machine state was lost  │
      │ but parking history still exists │
      │ (app reinstall, AsyncStorage     │
      │  cleared):                        │
      │                                  │
      │ tryRecordDepartureForOrphanedPk()│
      │ - Finds parking without          │
      │   departure                      │
      │ - Records departure              │
      │ - Only if < 24 hours old         │
      └──────────────────────────────────┘

FAILURE SCENARIO:
┌──────────────────────────────────────┐
│ State Machine NOT in PARKED state    │
│ (e.g. in IDLE, INITIALIZING, or     │
│  stuck in PARKING_PENDING)           │
└────────────────┬────────────────────┘
                 │
                 ▼
     ┌───────────────────────────────┐
     │ PARKED→DRIVING transition     │
     │ DOES NOT FIRE                 │
     │                               │
     │ handleCarReconnection()        │
     │ NOT CALLED                    │
     │                               │
     │ Departure NOT recorded        │
     │                               │
     │ User sees:                    │
     │ "Departure not recorded"      │
     │ in parking history            │
     └───────────────────────────────┘
```

## Critical Invariants & Assumptions

```
INVARIANT #1: STATE MACHINE PARKED REQUIREMENT
├─ Rule: Departure tracking requires PARKED→DRIVING transition
├─ Why: handleCarReconnection() only called on this transition
├─ Consequence: If state is IDLE, departure silently lost
└─ Prevention: MUST call manualParkingConfirmed() on manual checks

INVARIANT #2: COREMOTION MUST STAY ACTIVE (iOS)
├─ Rule: Never stop CoreMotion after parking
├─ Why: Restarting from significantLocationChange is unreliable
│       Only fires on 100-500m cell tower changes
│       Short drives in same tower never restart it
├─ Consequence: No driving detection → no departure
└─ Current code: Keeps CoreMotion running (lines 899-908)

INVARIANT #3: TWO-PHASE GPS
├─ Rule: Phase 1 = speed, Phase 2 = accuracy
├─ Why: User notification in 3-5s, silent refinement after
├─ Consequence: If Phase 2 drifts > 25m, rules might change
└─ Coverage: Handles GPS drift, doesn't lose accuracy

INVARIANT #4: 3-SECOND DEBOUNCE (Android)
├─ Rule: BT reconnect within 3s cancels parking check
├─ Why: Filters transient disconnects (red lights, tunnels)
├─ Consequence: Double-parking within 5 min is allowed
└─ Coverage: Red lights (1-2s disconnect) filtered, parking (3s+) detected

INVARIANT #5: 2-MINUTE STATIONARY THRESHOLD (iOS)
├─ Rule: Phone must stay in 50m radius for 2+ minutes
├─ Why: Filters red lights (45s typical) from parking (3+ min)
├─ Consequence: User walking away extends stationary timer
└─ Coverage: Unless CoreMotion says non-automotive (exit car)
```

