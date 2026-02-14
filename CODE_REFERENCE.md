# Complete Code Reference - Parking Detection Implementation

## File Structure Map

```
TicketlessChicagoMobile/
├── src/
│   └── services/
│       ├── BackgroundTaskService.ts                  [MAIN ORCHESTRATOR]
│       ├── BackgroundLocationService.ts              [iOS interface]
│       ├── MotionActivityService.ts                  [iOS fallback]
│       ├── BluetoothService.ts                       [Android BT interface]
│       ├── LocationService.ts                        [Parking API client]
│       └── parking-detection/
│           ├── ParkingDetectionService.ts            [Config + types]
│           ├── MotionService.ts                      [Stub - not used]
│           └── DetectionStateMachine.ts              [Stub - not used]
├── android/app/src/main/java/fyi/ticketless/app/
│   ├── BluetoothMonitorService.kt                    [ANDROID BT SERVICE]
│   ├── BluetoothMonitorModule.kt                     [ANDROID NATIVE MODULE]
│   └── BluetoothMonitorPackage.kt
└── ios/TicketlessChicagoMobile/
    ├── BackgroundLocationModule.swift                [iOS LOCATION + MOTION]
    └── MotionActivityModule.swift                    [iOS MOTION FALLBACK]
```

---

## Critical Constants & Thresholds

### BackgroundTaskService.ts
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts`

| Line | Constant | Value | Purpose |
|------|----------|-------|---------|
| 35 | `BACKGROUND_TASK_ID` | 'ticketless-parking-check' | Task identifier |
| 36 | `CHECK_INTERVAL_MS` | 15 * 60 * 1000 | 15 minutes periodic check |
| 37 | `MIN_DISCONNECT_DURATION_MS` | 30 * 1000 | 30 seconds (debounce) |
| 38 | `DEPARTURE_CONFIRMATION_DELAY_MS` | 120 * 1000 | 2 minutes after reconnect |
| 39 | `MIN_PARKING_CHECK_INTERVAL_MS` | 5 * 60 * 1000 | 5 minutes (duplicate prevention) |

---

### BackgroundLocationModule.swift (iOS)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`

| Line | Constant | Value | Purpose |
|------|----------|-------|---------|
| 24 | `minDrivingDurationSec` | 60 | Must drive 1 min before parking matters |
| 25 | `exitDebounceSec` | 5 | Debounce after CoreMotion says exit |
| 26 | `minDrivingSpeedMps` | 2.5 | ~5.6 mph threshold to start driving |
| 39 | `distanceFilter` | 10 | 10 meters GPS update threshold |
| 330 | Speed threshold | 0.5 | Speed ≤ 0.5 m/s = stopped |
| 350 | Speed timer | 8.0 | 8 seconds at speed ≈ 0 = parking |

---

### MotionActivityService.ts (iOS Fallback)
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/MotionActivityService.ts`

| Line | Constant | Value | Purpose |
|------|----------|-------|---------|
| 43 | `MIN_DRIVING_DURATION_MS` | 60 * 1000 | 1 minute minimum drive |
| 44 | `PARKING_CHECK_COOLDOWN_MS` | 5 * 60 * 1000 | 5 min between checks |

---

## Complete Call Chain - From BT Disconnect to Parking Notification

### 1. Android: BT Disconnect Event
**BluetoothMonitorService.kt:199-201**
```kotlin
BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
  Log.i(TAG, "TARGET CAR DISCONNECTED: $deviceName ($deviceAddress)")
  handleDisconnect(deviceName ?: targetName ?: "Car", deviceAddress ?: targetAddress ?: "")
}
```
↓

### 2. Android: Notify Java → JavaScript Bridge
**BluetoothMonitorService.kt:245-265**
```kotlin
private fun handleDisconnect(name: String, address: String) {
  val listener = eventListener
  if (listener != null) {
    listener.onCarDisconnected(name, address)
  } else {
    prefs.edit().putBoolean(KEY_PENDING_DISCONNECT, true).apply()
  }
}
```
↓

### 3. JavaScript: Native Event Listener
**BackgroundTaskService.ts:393-404**
```typescript
this.nativeBtDisconnectSub = eventEmitter.addListener(
  'BtMonitorCarDisconnected',
  async (event: any) => {
    log.info('NATIVE BT DISCONNECT EVENT - triggering parking check', event);
    this.stopCameraAlerts();
    await this.handleCarDisconnection();  // ← MAIN ENTRY POINT
  }
);
```
↓

### 4. JavaScript: handleCarDisconnection()
**BackgroundTaskService.ts:701-732**
```typescript
private async handleCarDisconnection(parkingCoords?: {
  latitude: number;
  longitude: number;
  accuracy?: number;
}): Promise<void> {
  log.info('=== CAR DISCONNECTION HANDLER TRIGGERED ===');
  
  this.stopGpsCaching();
  LocationService.clearLocationCache();
  
  this.state.lastDisconnectTime = Date.now();
  this.state.lastCarConnectionStatus = false;
  await this.saveState();
  
  await this.triggerParkingCheck(parkingCoords);  // ← NEXT STEP
  
  if (this.disconnectCallback) {
    await Promise.resolve(this.disconnectCallback());
  }
}
```
↓

### 5. JavaScript: triggerParkingCheck() - GPS Acquisition
**BackgroundTaskService.ts:742-843**

**Step 5a: Use preset coords (iOS) if available (lines 764-767)**
```typescript
if (presetCoords?.latitude && presetCoords?.longitude) {
  coords = presetCoords;
  gpsSource = 'pre-captured (iOS)';
  log.info(`Using pre-captured parking location: ...`);
} else {
  // Android/fallback: get fresh GPS
  try {
    const timeout = Platform.OS === 'android' ? 25000 : 15000;
    coords = await LocationService.getHighAccuracyLocation(50, timeout, true);
    gpsSource = `high-accuracy (${coords.accuracy?.toFixed(1)}m)`;
```

**Step 5b: Call parking API (lines 845-858)**
```typescript
log.info(`GPS acquired via ${gpsSource}. Now calling parking API...`);

let result;
try {
  result = await LocationService.checkParkingLocation(coords);
} catch (apiError) {
  // ... error handling
}
```
↓

### 6. JavaScript: Save Result & Notifications
**BackgroundTaskService.ts:860-915**
```typescript
// Save to AsyncStorage (HomeScreen hero card)
await LocationService.saveParkingCheckResult(result);

// Save to parking history
await ParkingHistoryService.addToHistory(coords, result.rules, result.address);

// Save to server for push notifications
const fcmToken = await PushNotificationService.getToken();
await LocationService.saveParkedLocationToServer(coords, rawData, result.address, fcmToken);

// Filter permit zone if user's home zone
const filteredResult = await this.filterOwnPermitZone(result);

// Send notification
if (filteredResult.rules.length > 0) {
  await this.sendParkingNotification(filteredResult, coords.accuracy);
  await this.scheduleRestrictionReminders(filteredResult, coords);
} else {
  await this.sendSafeNotification(filteredResult.address, coords.accuracy);
}
```

---

## iOS-Specific Flow (BackgroundLocationModule.swift)

### CoreMotion Activity Monitoring
**Lines 226-284**
```swift
private func startMotionActivityMonitoring() {
  activityManager.startActivityUpdates(to: .main) { [weak self] activity in
    // Line 231: Log every update
    NSLog("[BackgroundLocation] CoreMotion update: automotive=\(activity.automotive) ...")
    
    if activity.automotive {
      // Lines 233-258: DRIVING STATE
      self.coreMotionSaysAutomotive = true
      self.isDriving = true
      self.drivingStartTime = Date()
      self.startContinuousGps()
      
    } else if (activity.stationary || activity.walking) && (activity.confidence != .low || !self.speedSaysMoving) {
      // Lines 260-280: EXIT VEHICLE DETECTED
      if self.isDriving && wasAutomotive {
        self.locationAtStopStart = self.lastDrivingLocation ?? self.locationManager.location
        self.handlePotentialParking()
      }
    }
  }
}
```
↓

### GPS Speed Detection (while driving)
**Lines 288-374** (delegated method called on each GPS update)
```swift
func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
  guard let location = locations.last else { return }
  let speed = location.speed  // m/s, -1 if unknown
  
  // Lines 302-304: Update driving location continuously
  if isDriving || coreMotionSaysAutomotive {
    lastDrivingLocation = location
  }
  
  // Lines 307-329: Speed > 2.5 m/s = DRIVING
  if speed > minDrivingSpeedMps {
    speedSaysMoving = true
    speedZeroTimer?.invalidate()  // Cancel any parking timer
    locationAtStopStart = nil  // Reset stop location
    
  // Lines 330-360: Speed ≤ 0.5 m/s = STOPPED
  } else if speed >= 0 && speed <= 0.5 {
    speedSaysMoving = false
    
    // Capture stop location when speed drops to 0
    if isDriving && locationAtStopStart == nil {
      locationAtStopStart = lastDrivingLocation ?? location
      NSLog("[BackgroundLocation] GPS speed≈0 while driving. Captured stop location...")
    }
    
    // START 8-SECOND PARKING TIMER if conditions met
    if isDriving,
       let drivingStart = drivingStartTime,
       Date().timeIntervalSince(drivingStart) >= minDrivingDurationSec,  // 60s+
       speedZeroTimer == nil {
      
      NSLog("[BackgroundLocation] GPS speed≈0 after 1+min driving. Starting 8s timer.")
      speedZeroTimer = Timer.scheduledTimer(withTimeInterval: 8.0, repeats: false) { [weak self] _ in
        // FIRES after 8 seconds
        guard let self = self else { return }
        if !self.speedSaysMoving {  // Speed still ≈ 0?
          NSLog("[BackgroundLocation] Speed timer fired. Confirming parking via GPS.")
          self.confirmParking(source: "gps_speed")
        } else {
          NSLog("[BackgroundLocation] Speed resumed during timer. Was a red light.")
        }
      }
    }
  }
}
```
↓

### Parking Confirmation
**Lines 483-555**
```swift
private func confirmParking(source: String = "coremotion") {
  guard isDriving || drivingStartTime != nil else { return }
  
  // If CoreMotion flipped back to automotive (and not GPS-based), abort
  if coreMotionSaysAutomotive && source != "gps_speed" {
    NSLog("[BackgroundLocation] CoreMotion says automotive again - aborting")
    return
  }
  
  // Cancel the other timer
  if source == "gps_speed" {
    parkingConfirmationTimer?.invalidate()
  } else {
    speedZeroTimer?.invalidate()
  }
  
  NSLog("[BackgroundLocation] PARKING CONFIRMED (source: \(source))")
  
  // Location priority: stop_start > last_driving > current_fallback
  let parkingLocation = locationAtStopStart ?? lastDrivingLocation
  
  var body: [String: Any] = [
    "timestamp": Date().timeIntervalSince1970 * 1000,
  ]
  
  if let loc = parkingLocation {
    body["latitude"] = loc.coordinate.latitude
    body["longitude"] = loc.coordinate.longitude
    body["accuracy"] = loc.horizontalAccuracy
    body["locationSource"] = locationAtStopStart != nil ? "stop_start" : "last_driving"
  }
  
  if let drivingStart = drivingStartTime {
    body["drivingDurationSec"] = Date().timeIntervalSince(drivingStart)
  }
  
  // Send event to JavaScript
  sendEvent(withName: "onParkingDetected", body: body)
  
  // Reset driving state
  isDriving = false
  coreMotionSaysAutomotive = false
  drivingStartTime = nil
  locationAtStopStart = nil
  
  // Stop continuous GPS (save battery)
  stopContinuousGps()
}
```

---

## MotionActivityService.ts - iOS Fallback
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/MotionActivityService.ts`

**Activity Change Detection (Lines 165-198)**
```typescript
private handleActivityChange(event: ActivityChangeEvent): void {
  log.debug('Activity change', event);

  const { activity, previousActivity, confidence } = event;
  this.state.currentActivity = activity;

  // Track when driving
  if (activity === 'automotive') {
    this.state.lastAutomotiveTime = Date.now();
    this.state.wasRecentlyDriving = true;
  }

  // DETECT PARKING: Automotive → Stationary/Walking
  if (
    previousActivity === 'automotive' &&
    (activity === 'stationary' || activity === 'walking') &&
    confidence !== 'low'  // Require medium+ confidence
  ) {
    this.handlePotentialParking();
  }

  // DETECT DEPARTURE: Was parked, now driving
  if (
    (previousActivity === 'stationary' || previousActivity === 'walking') &&
    activity === 'automotive' &&
    this.state.lastParkingCheckTime !== null
  ) {
    this.handleDeparture();
  }

  this.saveState();
}
```

**Potential Parking Handler (Lines 203-227)**
```typescript
private handlePotentialParking(): void {
  if (!this.state.lastAutomotiveTime) {
    log.debug('No recent driving detected - ignoring');
    return;
  }

  const drivingDuration = Date.now() - this.state.lastAutomotiveTime;
  if (drivingDuration < MIN_DRIVING_DURATION_MS) {  // 60s
    log.debug('Driving duration too short - likely false positive');
    return;
  }

  // Check cooldown
  if (this.state.lastParkingCheckTime) {
    const timeSinceLastCheck = Date.now() - this.state.lastParkingCheckTime;
    if (timeSinceLastCheck < PARKING_CHECK_COOLDOWN_MS) {  // 5 min
      log.debug('Parking check cooldown active - skipping');
      return;
    }
  }

  log.info('Parking detected - triggering check immediately');
  this.confirmParking().catch(err => log.error('Error in parking confirmation', err));
}
```

---

## Android Native Code

### BluetoothMonitorService.kt
**File**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/java/fyi/ticketless/app/BluetoothMonitorService.kt`

**ACL Receiver Registration (Lines 171-227)**
```kotlin
private fun registerAclReceiver() {
  if (aclReceiver != null) return

  aclReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val action = intent.action ?: return
      val device: BluetoothDevice? = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
      val deviceAddress = device?.address
      val deviceName = device?.name

      Log.d(TAG, "ACL event: $action device=$deviceName ($deviceAddress)")

      // Check if this is our target car
      val isTargetDevice = (deviceAddress != null && deviceAddress == targetAddress) ||
        (targetName != null && deviceName != null && deviceName == targetName)

      if (!isTargetDevice) return

      when (action) {
        BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
          Log.i(TAG, "TARGET CAR DISCONNECTED: $deviceName ($deviceAddress)")
          handleDisconnect(deviceName ?: "Car", deviceAddress ?: "")
        }
        BluetoothDevice.ACTION_ACL_CONNECTED -> {
          Log.i(TAG, "TARGET CAR CONNECTED: $deviceName ($deviceAddress)")
          handleConnect(deviceName ?: "Car", deviceAddress ?: "")
        }
      }
    }
  }

  val filter = IntentFilter().apply {
    addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
    addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
    addAction(BluetoothDevice.ACTION_ACL_DISCONNECT_REQUESTED)
  }

  registerReceiver(aclReceiver, filter, Context.RECEIVER_EXPORTED)
  Log.i(TAG, "ACL BroadcastReceiver registered (persistent)")
}
```

**Disconnect Handler (Lines 245-265)**
```kotlin
private fun handleDisconnect(name: String, address: String) {
  val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  prefs.edit()
    .putBoolean(KEY_IS_CONNECTED, false)
    .putLong(KEY_LAST_EVENT_TIME, System.currentTimeMillis())
    .apply()

  // Try to notify JS directly
  val listener = eventListener
  if (listener != null) {
    Log.d(TAG, "Delivering disconnect to JS listener directly")
    listener.onCarDisconnected(name, address)  // ← JS receives this
  } else {
    // JS bridge not active — store as pending event
    Log.d(TAG, "JS bridge not active, storing pending disconnect")
    prefs.edit().putBoolean(KEY_PENDING_DISCONNECT, true).apply()
  }

  updateNotification("Parked - checking rules...")
}
```

---

## Key Differences: iOS vs Android

| Aspect | iOS | Android |
|--------|-----|---------|
| **Primary detection** | CoreMotion (activity classifier) | BT disconnect |
| **Speed verification** | Yes (8s at ≤0.5 m/s) | No |
| **Motion confirmation** | Yes (automotive→stationary) | No |
| **Minimum driving duration** | 60s | 30s (disconnect debounce only) |
| **False positive protection** | HIGH (dual confirmation) | LOW (BT only) |
| **Red light vulnerability** | Protected | Vulnerable if car audio BT also disconnects |

