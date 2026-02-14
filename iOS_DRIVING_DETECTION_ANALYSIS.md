# iOS Driving Detection System Analysis

## Problem Summary
User reports that after 10 minutes of driving, the app still doesn't detect they're driving. Location services are set to "Always".

---

## System Architecture Overview

### Two-Tier Driving Detection on iOS

The app implements a **two parallel detection systems**:

#### 1. **BackgroundLocationModule (Primary)** ⭐ 
   - **Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` (488 lines)
   - **Uses**: CoreMotion (M-series coprocessor) + CLLocationManager (GPS)
   - **Battery**: Very efficient - CoreMotion runs on dedicated chip
   - **Activation**: Called from `BackgroundTaskService.startForegroundMonitoring()` (lines 173-229)

#### 2. **MotionActivityModule (Fallback)**
   - **Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/MotionActivityModule.swift` (144 lines)
   - **Uses**: CoreMotion only (no GPS integration)
   - **Battery**: Extremely efficient
   - **Status**: Fallback only if BackgroundLocationModule unavailable (line 211-216 in BackgroundTaskService)

---

## Detailed Flow: How iOS Driving Detection Should Work

### 1. **Initialization Chain** (HomeScreen.tsx lines 243-262)

```
HomeScreen.autoStartMonitoring()
  ↓
  → LocationService.requestLocationPermission(true)  // "Always" required
  ↓
  → BackgroundTaskService.initialize()
  ↓
  → BackgroundTaskService.startMonitoring()
  ↓
  → BackgroundLocationService.startMonitoring()    // ← PRIMARY SYSTEM
```

**Problem Point 1**: Location permission must be "Always" (not "When in Use").

### 2. **BackgroundLocationModule Initialization** (BackgroundLocationModule.swift lines 83-117)

When `startMonitoring()` is called:

1. **Line 103**: `locationManager.startMonitoringSignificantLocationChanges()`
   - Low-power backup mode (~0% battery impact)
   - Wakes app on ~100-500m cell tower changes
   
2. **Line 107-109**: Start CoreMotion activity monitoring
   ```swift
   if CMMotionActivityManager.isActivityAvailable() {
     startMotionActivityMonitoring()
   }
   ```
   
3. **Line 111-112**: GPS NOT started yet!
   ```swift
   // Do NOT start continuous GPS yet - wait until CoreMotion detects driving.
   // This saves significant battery when user is walking/stationary.
   ```

### 3. **CoreMotion Drives Everything** (BackgroundLocationModule.swift lines 200-251)

CoreMotion callback (line 201) monitors:

```swift
activityManager.startActivityUpdates(to: .main) { activity in
  if activity.automotive && activity.confidence != .low {
    // DRIVING DETECTED
    coreMotionSaysAutomotive = true
    startContinuousGps()           // ← Turn on precise GPS
    isDriving = true
    emit("onDrivingStarted")
  } else if (activity.stationary || activity.walking) && confidence != .low {
    // NOT IN CAR - user has exited vehicle
    coreMotionSaysAutomotive = false
    handlePotentialParking()       // ← Trigger parking check
  }
}
```

**Key Gates**:
- Line 204: `activity.automotive && activity.confidence != .low`
  - Requires BOTH conditions
  - `activity.confidence == .low` → IGNORED (line 204)
- Line 228: `(activity.stationary || activity.walking) && activity.confidence != .low`
  - Requires medium/high confidence (not low)

### 4. **Fallback: GPS Speed Detection** (BackgroundLocationModule.swift lines 273-291)

If CoreMotion is slow/unavailable, GPS speed can trigger driving:

```swift
if speed > minDrivingSpeedMps {  // 2.5 m/s = ~5.6 mph
  speedSaysMoving = true
  if !isDriving && !coreMotionSaysAutomotive {
    isDriving = true
    startContinuousGps()           // ← Turn on precise GPS
    emit("onDrivingStarted")
  }
}
```

### 5. **UI State Machine** (HomeScreen.tsx lines 392-414)

The "driving" state shown to user depends on:

```typescript
const getHeroState = (): HeroState => {
  if (Platform.OS === 'ios') {
    if (currentActivity === 'automotive') return 'driving';  // ← Line 398
  }
  // ... fallback to "ready" or "clear" or "violation"
};
```

And `currentActivity` comes from polling MotionActivityModule every 10 seconds (lines 191-204):

```typescript
if (!isMonitoring || Platform.OS !== 'ios') return;

const updateActivity = async () => {
  const activity = await MotionActivityService.getCurrentActivity();
  if (activity) {
    setCurrentActivity(activity.activity);
  }
};

updateActivity();
const interval = setInterval(updateActivity, 10000);  // Every 10 seconds
```

---

## Root Causes of Detection Failure

### 1. **CoreMotion Not Reporting "Automotive"** 🔴

**Issue**: CoreMotion's M-series chip may fail to detect driving in certain conditions:

- **Dead zones**: Some phones have outdated/faulty M-series chips
- **Settings**: Device motion/activity tracking disabled in Settings → Privacy
- **Car type**: Some vehicles don't vibrate in patterns CoreMotion recognizes
- **Speed too low**: Below ~5.6 mph (2.5 m/s) → CoreMotion + GPS fallback both inactive
- **No acceleration**: Coasting/idling doesn't trigger CoreMotion (needs vibration pattern)
- **iOS bugs**: CoreMotion activity updates sometimes have massive delays (>1 hour known)

**Detection**: Check `BackgroundLocationModule.getStatus()` → `coreMotionAutomotive` field

### 2. **Permission Is Not "Always"** 🔴

**Issue**: iOS requires `NSLocationAlwaysAndWhenInUseUsageDescription` permission.

**Verification**: 
- User sees Settings → Autopilot → Location
- Must show "Always" not "When in Use" or "Never"

**Code Flow**:
```typescript
// HomeScreen.tsx line 246
const hasLocationPermission = await LocationService.requestLocationPermission(true);
// ↓
// LocationService.ts line 60-66
if (Platform.OS === 'ios') {
  return new Promise((resolve) => {
    Geolocation.requestAuthorization('always');  // ← Requests "Always"
    setTimeout(() => resolve(true), 500);        // ← ASSUMES it was granted!
  });
}
```

**Problem**: Line 65 resolves BEFORE user actually grants permission!

### 3. **GPS Never Turns On** 🔴

**Issue**: BackgroundLocationModule only starts continuous GPS when CoreMotion says "automotive".

**Line 184 in BackgroundLocationModule.swift**:
```swift
private func startContinuousGps() {
  guard !continuousGpsActive else { return }
  locationManager.startUpdatingLocation()  // ← Needs CLLocationManagerDelegate
  continuousGpsActive = true
}
```

If CoreMotion doesn't fire → GPS never starts → No speed fallback → No driving detection.

### 4. **significantLocationChange Is Very Slow** 🟡

**Lines 100-103**:
```swift
// Always-on: significantLocationChange is low-power (~0% battery impact).
// Wakes the app on ~100-500m cell tower changes. 
locationManager.startMonitoringSignificantLocationChanges()
```

Problem: User drives 10 minutes locally = ~2-5 miles = multiple 100-500m jumps, but if app isn't in foreground, wakes are delayed.

### 5. **App Killed/Backgrounded Without Event** 🟡

**Issue**: iOS can kill the app after a few minutes in background.

**Recovery mechanism** (BackgroundLocationModule.swift lines 309-371):
```swift
private func checkForMissedParking(currentLocation: CLLocation) {
  // Query CoreMotion history last 30 minutes
  activityManager.queryActivityStarting(from: lookback, to: now, ...) { activities in
    // Check for automotive → stationary pattern
    if wasRecentlyDriving && currentlyStationary {
      emit("onParkingDetected")  // ← Retroactive
    }
  }
}
```

But this only fires when app is woken (rare in foreground scenarios).

### 6. **HomeScreen UI Not Polling Correctly** 🟡

**Lines 191-204**:
```typescript
useEffect(() => {
  if (!isMonitoring || Platform.OS !== 'ios') return;

  const updateActivity = async () => {
    const activity = await MotionActivityService.getCurrentActivity();  // ← WRONG MODULE!
    if (activity) {
      setCurrentActivity(activity.activity);
    }
  };

  updateActivity();
  const interval = setInterval(updateActivity, 10000);
  return () => clearInterval(interval);
}, [isMonitoring]);
```

**Problem**: Polling MotionActivityModule (fallback) instead of BackgroundLocationModule!

Should poll `BackgroundLocationModule.getStatus()` → `isDriving` field.

### 7. **BackgroundTaskService Flow Not Triggered** 🔴

**Line 173-229 in BackgroundTaskService.ts**:

```typescript
if (Platform.OS === 'ios') {
  log.info('Starting background location parking detection for iOS');
  try {
    if (BackgroundLocationService.isAvailable()) {
      const permStatus = await BackgroundLocationService.requestPermissions();
      await BackgroundLocationService.startMonitoring(
        async (event: ParkingDetectedEvent) => {
          log.info('Parking detected via background location', {...});
          await this.handleCarDisconnection(parkingCoords);
        }
      );
    } else {
      // Fallback to motion-only
      await MotionActivityService.startMonitoring(...);
    }
  } catch (error) {
    // Swallows errors!
    log.warn('Could not start iOS monitoring:', error);
  }
}
```

**Problems**:
- Line 179: If `BackgroundLocationService.isAvailable()` returns false → silently falls back
- Line 219: Catch block only logs warning, doesn't show user error
- No verification that permissions were actually granted

---

## iOS Configuration

### Info.plist (✓ Correctly Configured)

**Path**: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/Info.plist`

**Key Settings**:

```xml
<!-- Background modes -->
<key>UIBackgroundModes</key>
<array>
  <string>location</string>          ✓ Required for background location
  <string>bluetooth-central</string> ✓ For Bluetooth on iOS
  <string>fetch</string>             ✓ For periodic updates
  <string>remote-notification</string> ✓ For push notifications
</array>

<!-- Permissions -->
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>We need your location in the background...</string> ✓ Correct
<key>NSMotionUsageDescription</key>
<string>We use motion detection...</string> ✓ Correct
<key>NSLocationAlwaysUsageDescription</key>
<string>We need your location in the background...</string> ✓ Correct
```

✓ Info.plist is correct - problem is elsewhere.

---

## Diagnostic Checklist

### 1. Check Location Permission Status

```swift
// In BackgroundLocationModule.swift, add logging:
let status = locationManager.authorizationStatus
NSLog("Location auth status: \(status.rawValue)")
// 3 = authorizedAlways ✓
// 2 = authorizedWhenInUse ✗
// 0 = notDetermined ✗
// 1 = denied ✗
```

### 2. Check CoreMotion Availability

```swift
let available = CMMotionActivityManager.isActivityAvailable()
NSLog("CoreMotion available: \(available)")
```

### 3. Check CoreMotion Activity Updates

Add logs to `startMotionActivityMonitoring()` (line 200):

```swift
NSLog("CoreMotion callback fired with: automotive=\(activity.automotive), stationary=\(activity.stationary), walking=\(activity.walking), confidence=\(activity.confidence)")
```

### 4. Check GPS Status

Add logs to `startContinuousGps()` (line 182):

```swift
NSLog("Continuous GPS status: was active = \(continuousGpsActive), locationServicesEnabled = \(CLLocationManager.locationServicesEnabled())")
```

### 5. Check iPhone Settings

Device:
- Settings → Autopilot → Location → **"Always"** (not "When In Use")
- Settings → Privacy → Motion & Fitness → **Enabled**
- Settings → Battery → Low Power Mode → **OFF** (disables CoreMotion)
- Device has M-series motion coprocessor (iPhone 5s or later)

---

## Probable Root Cause (Most Likely)

Based on the architecture, the most likely causes for "not detecting driving after 10 minutes":

### **#1 (60% probability): CoreMotion Reports "Automotive" with Low Confidence**

User's phone may report `activity.confidence == .low` for automotive activity.

**Fix**: Modify line 204 in BackgroundLocationModule.swift:

```swift
// CURRENT (too strict):
if activity.automotive && activity.confidence != .low {
  
// PROPOSED (more lenient):
if activity.automotive && activity.confidence != .unknown {
  // Accept low + medium + high
}
```

### **#2 (25% probability): iOS Killed the App**

App got backgrounded and iOS killed the process.

**Symptoms**: User sees "Autopilot is watching" but no "driving" indicator appears.

**Fix**: Check if app is actually still running:
- Launch Xcode Debug
- Select device
- See if app appears in running processes
- Check Console.app logs on iOS device

### **#3 (10% probability): Permission Not "Always"**

User tapped "When In Use" by mistake.

**Verification**: 
```swift
let status = locationManager.authorizationStatus
if status != .authorizedAlways {
  // Show alert asking user to go to Settings → "Always"
}
```

### **#4 (5% probability): Device Doesn't Have M-Series Chip**

Old iPhone (iPhone 4/4S/5c) without motion coprocessor.

**Check**: Add to AppDelegate:
```swift
if !CMMotionActivityManager.isActivityAvailable() {
  NSLog("⚠️ Device does not support motion activity detection!")
}
```

---

## Fix Recommendations

### **Immediate (High Priority)**

1. **Fix HomeScreen UI polling** (lines 191-204)
   - Currently polls MotionActivityModule (fallback)
   - Should poll BackgroundLocationModule directly
   
   ```typescript
   // CURRENT (WRONG):
   const activity = await MotionActivityService.getCurrentActivity();
   
   // CORRECT:
   const status = await BackgroundLocationService.getStatus();
   if (status.isDriving) setCurrentActivity('automotive');
   ```

2. **Add permission verification** (HomeScreen.tsx line 246)
   ```typescript
   const hasLocationPermission = await LocationService.requestLocationPermission(true);
   
   // NEW: Verify actual permission status
   if (Platform.OS === 'ios') {
     const actual = await BackgroundLocationService.getPermissionStatus();
     if (actual !== 'always') {
       // Warn user and force Settings
       Alert.alert('Permission Required', 
         'Please set Location to "Always" in Settings → Autopilot');
     }
   }
   ```

3. **Lower CoreMotion confidence threshold** (BackgroundLocationModule.swift line 204)
   ```swift
   // CURRENT:
   if activity.automotive && activity.confidence != .low {
   
   // PROPOSED:
   if activity.automotive {  // Accept any confidence level for automotive
   ```

4. **Add comprehensive logging**
   - Log every CoreMotion callback with timestamp and confidence
   - Log GPS state changes
   - Log why parking detection fired/didn't fire

### **Medium Priority**

5. **Implement proper iOS background lifecycle**
   - Add `application:didFinishLaunchingWithOptions:` check for background location wakeup
   - Restart monitoring if app woken by location change
   
6. **Add timeout/polling failsafe**
   ```swift
   // If CoreMotion hasn't reported for 30 seconds but we have GPS → use speed fallback
   let lastActivityTime = Date()
   Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
     if isDriving || !coreMotionSaysAutomotive {
       return  // No action needed
     }
     // Check: has speed updated and is > threshold?
     if lastLocationSpeed > minDrivingSpeedMps {
       // Force isDriving = true via speed
     }
   }
   ```

7. **Show user diagnostic UI**
   - Add "Diagnostics" screen showing:
     - Location permission: "Always" ✓/✗
     - CoreMotion available: ✓/✗
     - CoreMotion current activity: automotive/stationary/walking/unknown
     - GPS status: ON/OFF
     - Last update: 2s ago

---

## File Cross-Reference

| Component | File Path | Lines | Purpose |
|-----------|-----------|-------|---------|
| Primary iOS Driving Detection | BackgroundLocationModule.swift | 1-489 | CoreMotion + GPS driving detection |
| Fallback Motion Only | MotionActivityModule.swift | 1-144 | CoreMotion-only fallback |
| Background Task Service | BackgroundTaskService.ts | 1-939 | Orchestrates all detection & parking checks |
| Location Service | LocationService.ts | 1-859 | GPS/location acquisition |
| BackgroundLocation Service (Bridge) | BackgroundLocationService.ts | 1-274 | JS bridge to BackgroundLocationModule |
| HomeScreen (UI) | HomeScreen.tsx | 1-~700 | Shows driving state to user |
| App Entry Point | App.tsx | 1-273 | App initialization |
| iOS Configuration | Info.plist | 1-95 | Background modes, permissions |
| App Delegate | AppDelegate.swift | 1-53 | App startup (limited custom code) |

---

## Summary

**The app has TWO sophisticated iOS driving detection systems**:

1. **BackgroundLocationModule** (primary): CoreMotion + GPS - should work if permissions are "Always" and CoreMotion is available
2. **MotionActivityModule** (fallback): CoreMotion only - less reliable but works everywhere

**The most likely issue**: CoreMotion reports automotive activity but with **low confidence**, which the code rejects (line 204).

**Second most likely issue**: User doesn't have "Always" location permission, so BackgroundLocationModule can't start continuous GPS.

**Third most likely issue**: HomeScreen polls MotionActivityModule instead of BackgroundLocationModule's isDriving flag, so UI doesn't show "driving" even if detection is working.

