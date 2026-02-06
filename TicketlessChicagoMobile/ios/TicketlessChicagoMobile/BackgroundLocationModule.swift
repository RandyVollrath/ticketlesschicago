import Foundation
import CoreLocation
import CoreMotion
import React

@objc(BackgroundLocationModule)
class BackgroundLocationModule: RCTEventEmitter, CLLocationManagerDelegate {

  private let locationManager = CLLocationManager()
  private let activityManager = CMMotionActivityManager()
  private var isMonitoring = false

  // Driving state tracking
  private var isDriving = false
  private var coreMotionSaysAutomotive = false  // True when CoreMotion chip reports automotive
  private var speedSaysMoving = false            // True when GPS speed > threshold
  private var drivingStartTime: Date? = nil
  private var lastDrivingLocation: CLLocation? = nil  // Updated continuously while driving (any speed)
  private var locationAtStopStart: CLLocation? = nil   // Snapshot GPS at exact moment car stops
  private var lastStationaryTime: Date? = nil
  private var continuousGpsActive = false              // Whether high-frequency GPS is running
  private var coreMotionActive = false                  // Whether CoreMotion activity updates are running

  // Configuration
  private let minDrivingDurationSec: TimeInterval = 10   // 10 sec of driving before we care about stops (was 120→60→30→10; covers moving car one block for street cleaning)
  private let exitDebounceSec: TimeInterval = 5          // 5 sec debounce after CoreMotion confirms exit
  private let minDrivingSpeedMps: Double = 2.5           // ~5.6 mph - threshold to START driving state via speed
  private let speedCheckIntervalSec: TimeInterval = 3    // Re-check parking every 3s while speed≈0
  private let speedZeroOverrideSec: TimeInterval = 10    // Override CoreMotion after 10s of sustained zero speed

  // Debounce timer for parking confirmation
  private var parkingConfirmationTimer: Timer?
  private var speedZeroTimer: Timer?  // GPS speed-based parking trigger (repeating, checks every 5s)
  private var speedZeroStartTime: Date?  // When GPS speed first dropped to ≈0 during this driving session

  // After parking, require both CoreMotion + GPS to agree before starting new drive
  private var hasConfirmedParkingOnce = false  // True after first parking confirmation

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.allowsBackgroundLocationUpdates = true
    locationManager.pausesLocationUpdatesAutomatically = false
    locationManager.showsBackgroundLocationIndicator = true
    locationManager.distanceFilter = 10 // meters
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onParkingDetected", "onDrivingStarted", "onLocationUpdate"]
  }

  // MARK: - Public API

  /// Request location permissions (Always)
  @objc func requestPermissions(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let status = locationManager.authorizationStatus
    switch status {
    case .authorizedAlways:
      resolve("always")
    case .authorizedWhenInUse:
      locationManager.requestAlwaysAuthorization()
      resolve("when_in_use")
    case .notDetermined:
      locationManager.requestWhenInUseAuthorization()
      resolve("not_determined")
    case .denied, .restricted:
      resolve("denied")
    @unknown default:
      resolve("unknown")
    }
  }

  /// Get current permission status
  @objc func getPermissionStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let status = locationManager.authorizationStatus
    switch status {
    case .authorizedAlways:   resolve("always")
    case .authorizedWhenInUse: resolve("when_in_use")
    case .notDetermined:      resolve("not_determined")
    case .denied:             resolve("denied")
    case .restricted:         resolve("restricted")
    @unknown default:         resolve("unknown")
    }
  }

  /// Start background location monitoring for parking detection
  @objc func startMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CLLocationManager.locationServicesEnabled() else {
      reject("LOCATION_DISABLED", "Location services are disabled", nil)
      return
    }

    let status = locationManager.authorizationStatus
    guard status == .authorizedAlways || status == .authorizedWhenInUse else {
      reject("NO_PERMISSION", "Location permission not granted. Current status: \(status.rawValue)", nil)
      return
    }

    // Warn if only "When In Use" - background detection needs "Always"
    if status == .authorizedWhenInUse {
      NSLog("[BackgroundLocation] WARNING: Only 'When In Use' permission. Background parking detection REQUIRES 'Always'. Requesting upgrade...")
      locationManager.requestAlwaysAuthorization()
      // Continue starting anyway - it will work in foreground at least
    }

    guard !isMonitoring else {
      resolve(true)
      return
    }

    // Always-on: significantLocationChange is low-power (~0% battery impact).
    // Wakes the app on ~100-500m cell tower changes. This is our safety net
    // if iOS kills the app or user force-quits.
    locationManager.startMonitoringSignificantLocationChanges()

    // Start CoreMotion - this is the primary driving detection.
    // Runs on the M-series coprocessor, nearly zero battery.
    let coreMotionAvailable = CMMotionActivityManager.isActivityAvailable()
    NSLog("[BackgroundLocation] CoreMotion available: \(coreMotionAvailable)")
    if coreMotionAvailable {
      startMotionActivityMonitoring()
      NSLog("[BackgroundLocation] CoreMotion activity monitoring started")
    } else {
      NSLog("[BackgroundLocation] WARNING: CoreMotion NOT available on this device")
    }

    // Do NOT start continuous GPS yet - wait until CoreMotion detects driving.
    // This saves significant battery when user is walking/stationary.

    isMonitoring = true
    let authStatus = locationManager.authorizationStatus
    let authString: String
    switch authStatus {
    case .authorizedAlways: authString = "ALWAYS"
    case .authorizedWhenInUse: authString = "WHEN_IN_USE (UPGRADE NEEDED)"
    case .notDetermined: authString = "NOT_DETERMINED"
    case .denied: authString = "DENIED"
    case .restricted: authString = "RESTRICTED"
    @unknown default: authString = "UNKNOWN"
    }
    NSLog("[BackgroundLocation] Monitoring started (significantChanges + CoreMotion, GPS on-demand, auth=\(authString), coreMotion=\(coreMotionAvailable))")
    resolve(true)
  }

  /// Stop all monitoring
  @objc func stopMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    locationManager.stopMonitoringSignificantLocationChanges()
    stopContinuousGps()
    stopMotionActivityMonitoring()

    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = nil
    speedZeroTimer?.invalidate()
    speedZeroTimer = nil
    isMonitoring = false
    isDriving = false
    coreMotionSaysAutomotive = false
    speedSaysMoving = false
    drivingStartTime = nil
    lastDrivingLocation = nil
    locationAtStopStart = nil
    lastStationaryTime = nil
    speedZeroStartTime = nil
    hasConfirmedParkingOnce = false  // Reset for next monitoring session

    NSLog("[BackgroundLocation] Monitoring stopped")
    resolve(true)
  }

  /// Get current monitoring status
  @objc func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    var result: [String: Any] = [
      "isMonitoring": isMonitoring,
      "isDriving": isDriving,
      "coreMotionAutomotive": coreMotionSaysAutomotive,
      "continuousGpsActive": continuousGpsActive,
      "coreMotionActive": coreMotionActive,
      "hasAlwaysPermission": locationManager.authorizationStatus == .authorizedAlways,
      "motionAvailable": CMMotionActivityManager.isActivityAvailable(),
    ]

    if let drivingStart = drivingStartTime {
      result["drivingDurationSec"] = Date().timeIntervalSince(drivingStart)
    }

    if let lastLoc = lastDrivingLocation {
      result["lastDrivingLat"] = lastLoc.coordinate.latitude
      result["lastDrivingLng"] = lastLoc.coordinate.longitude
    }

    resolve(result)
  }

  /// Get the last known driving location (probable parking spot)
  @objc func getLastDrivingLocation(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let loc = lastDrivingLocation else {
      resolve(NSNull())
      return
    }
    resolve([
      "latitude": loc.coordinate.latitude,
      "longitude": loc.coordinate.longitude,
      "accuracy": loc.horizontalAccuracy,
      "speed": loc.speed,
      "timestamp": loc.timestamp.timeIntervalSince1970 * 1000,
    ])
  }

  // MARK: - Battery Management: GPS on-demand

  /// Start continuous GPS (called when CoreMotion detects driving)
  private func startContinuousGps() {
    guard !continuousGpsActive else { return }
    // Remove distance filter during driving so we get GPS updates even when
    // stationary. Without this, distanceFilter=10 means no updates arrive
    // when the car stops, so the speed-zero parking detection never triggers.
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.startUpdatingLocation()
    continuousGpsActive = true
    NSLog("[BackgroundLocation] Continuous GPS ON (driving detected, distanceFilter=none)")
  }

  /// Stop continuous GPS (called after parking confirmed)
  /// significantLocationChange remains active as low-power backup
  private func stopContinuousGps() {
    guard continuousGpsActive else { return }
    locationManager.stopUpdatingLocation()
    // Restore distance filter to save power when not actively driving
    locationManager.distanceFilter = 10
    continuousGpsActive = false
    NSLog("[BackgroundLocation] Continuous GPS OFF (saving battery, distanceFilter=10m)")
  }

  // MARK: - CoreMotion: Primary Driving Detection

  private func startMotionActivityMonitoring() {
    guard !coreMotionActive else {
      NSLog("[BackgroundLocation] CoreMotion already active, skipping restart")
      return
    }
    coreMotionActive = true
    activityManager.startActivityUpdates(to: .main) { [weak self] activity in
      guard let self = self, let activity = activity else { return }

      // Log every CoreMotion update for diagnostics
      NSLog("[BackgroundLocation] CoreMotion update: automotive=\(activity.automotive) stationary=\(activity.stationary) walking=\(activity.walking) confidence=\(self.confidenceString(activity.confidence))")

      if activity.automotive {
        // ---- DRIVING ----
        // CoreMotion's M-series coprocessor detected vehicle vibration pattern.
        // Accept ALL confidence levels - some devices consistently report .low
        // for automotive even when genuinely driving.
        self.coreMotionSaysAutomotive = true

        // GPS SPEED VETO: If GPS says speed ≈ 0, do NOT cancel parking timers.
        // CoreMotion can flicker back to "automotive" from phone vibration/movement
        // while the user is walking away from a parked car. GPS speed is ground truth.
        // Only cancel parking timers if GPS confirms we're actually moving.
        if self.speedSaysMoving {
          // GPS confirms movement — cancel parking timers, we're still driving
          self.parkingConfirmationTimer?.invalidate()
          self.parkingConfirmationTimer = nil
          self.speedZeroTimer?.invalidate()
          self.speedZeroTimer = nil
          self.speedZeroStartTime = nil
          self.lastStationaryTime = nil
          self.locationAtStopStart = nil
          NSLog("[BackgroundLocation] CoreMotion automotive + GPS moving — cancelled parking timers")
        } else if self.parkingConfirmationTimer != nil || self.speedZeroTimer != nil {
          // GPS says speed ≈ 0 but CoreMotion says automotive — CoreMotion is probably wrong.
          // Keep parking timers running. The user is likely stationary.
          NSLog("[BackgroundLocation] CoreMotion says automotive BUT GPS speed ≈ 0 — NOT cancelling parking timers (CoreMotion flicker?)")
        }

        if !self.isDriving {
          // GPS SPEED VETO for starting new drive: If GPS says speed ≈ 0, don't
          // start a new driving session just because CoreMotion flickered to automotive.
          // This prevents false departure detection while walking away from the car.
          if !self.speedSaysMoving {
            NSLog("[BackgroundLocation] CoreMotion says automotive but GPS speed ≈ 0 — NOT starting new drive (waiting for GPS confirmation)")
            return
          }

          // Both CoreMotion AND GPS agree — start driving (no delay needed)
          self.isDriving = true
          self.drivingStartTime = Date()
          // Clear previous parking spot — this is a NEW drive.
          // Without this, if GPS is poor at the next parking spot,
          // we'd fall back to the PREVIOUS drive's lastDrivingLocation.
          self.lastDrivingLocation = nil
          self.locationAtStopStart = nil
          // Spin up precise GPS now that we know user is driving
          self.startContinuousGps()

          // DEPARTURE TIMING: Use GPS timestamp if available for more accurate timing.
          var departureTimestamp = Date().timeIntervalSince1970 * 1000
          var departureSource = "coremotion"

          // If GPS already has a recent location with speed, use that timestamp
          // as it's closer to when driving actually started.
          if let lastLoc = self.locationManager.location,
             lastLoc.speed > self.minDrivingSpeedMps,
             Date().timeIntervalSince(lastLoc.timestamp) < 60 {  // Within last minute
            departureTimestamp = lastLoc.timestamp.timeIntervalSince1970 * 1000
            departureSource = "coremotion_gps_adjusted"
            NSLog("[BackgroundLocation] Using GPS timestamp for departure: \(lastLoc.timestamp) (speed: \(String(format: "%.1f", lastLoc.speed)) m/s)")
          }

          NSLog("[BackgroundLocation] Driving started (CoreMotion automotive + GPS moving, confidence: \(self.confidenceString(activity.confidence)), source: \(departureSource))")
          self.sendEvent(withName: "onDrivingStarted", body: [
            "timestamp": departureTimestamp,
            "source": departureSource,
          ])
        }

      } else if (activity.stationary || activity.walking) && (activity.confidence != .low || !self.speedSaysMoving) {
        // ---- NOT IN CAR ----
        // CoreMotion says user is NOT in a vehicle.
        // Accept medium/high confidence always. Also accept LOW confidence
        // when GPS speed corroborates (speed ≈ 0). This fixes the case where
        // CoreMotion takes 30-60s to reach medium confidence after parking,
        // while GPS immediately shows speed=0.
        let wasAutomotive = self.coreMotionSaysAutomotive
        self.coreMotionSaysAutomotive = false

        if self.isDriving && wasAutomotive {
          // User was driving and has now exited the vehicle.
          // Snapshot the location RIGHT NOW - this is the parking spot.
          if self.locationAtStopStart == nil {
            self.locationAtStopStart = self.lastDrivingLocation ?? self.locationManager.location
            NSLog("[BackgroundLocation] Car stop location captured: \(self.locationAtStopStart?.coordinate.latitude ?? 0), \(self.locationAtStopStart?.coordinate.longitude ?? 0)")
          }

          let isWalking = activity.walking
          NSLog("[BackgroundLocation] Exited vehicle (CoreMotion: \(activity.stationary ? "stationary" : "walking"), confidence: \(self.confidenceString(activity.confidence)))")
          self.handlePotentialParking(userIsWalking: isWalking)
        }
      }
      // Note: cycling, running, unknown → ignore, don't change state
    }
  }

  /// Stop CoreMotion activity updates to save power while parked.
  /// significantLocationChange remains active and will restart CoreMotion
  /// when the user moves ~100-500m (cell tower change).
  private func stopMotionActivityMonitoring() {
    guard coreMotionActive else { return }
    activityManager.stopActivityUpdates()
    coreMotionActive = false
    NSLog("[BackgroundLocation] CoreMotion activity updates STOPPED (parked, saving power)")
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    let speed = location.speed  // m/s, -1 if unknown

    // --- Recovery: app was killed and woken by significantLocationChange ---
    // If we're not tracking driving but we just got a location update,
    // check if CoreMotion says we recently drove and are now stopped.
    // This catches the case where iOS killed us mid-drive.
    if !isDriving && !coreMotionSaysAutomotive && isMonitoring {
      // Restart CoreMotion if it was stopped after parking.
      // significantLocationChange fired, meaning user moved ~100-500m,
      // so they may be starting a new drive.
      if !coreMotionActive && CMMotionActivityManager.isActivityAvailable() {
        NSLog("[BackgroundLocation] significantLocationChange woke us — restarting CoreMotion")
        startMotionActivityMonitoring()
      }
      checkForMissedParking(currentLocation: location)
    }

    // --- Update driving location continuously while in driving state ---
    // Save at ANY speed while CoreMotion says automotive (captures 1 mph creep into spot)
    if isDriving || coreMotionSaysAutomotive {
      lastDrivingLocation = location
    }

    // --- Speed-based driving detection (backup if CoreMotion is slow) ---
    if speed > minDrivingSpeedMps {
      speedSaysMoving = true

      // Cancel speed-based parking timer - still moving (red light ended)
      speedZeroTimer?.invalidate()
      speedZeroTimer = nil
      speedZeroStartTime = nil
      locationAtStopStart = nil  // Reset stop location - wasn't a real stop

      if !isDriving && !coreMotionSaysAutomotive {
        // GPS says driving but CoreMotion hasn't reported automotive yet.
        // AFTER parking has been confirmed once, require CoreMotion agreement.
        // This prevents GPS noise from falsely restarting "Driving" state.
        // BEFORE any parking, allow GPS-only to handle CoreMotion being slow.
        if hasConfirmedParkingOnce {
          NSLog("[BackgroundLocation] GPS speed > threshold but CoreMotion not automotive — waiting for both to agree (post-parking safety)")
          return
        }

        // First drive of the session — CoreMotion might be slow, trust GPS
        isDriving = true
        drivingStartTime = Date()
        lastDrivingLocation = nil  // Clear previous parking spot — new drive
        lastStationaryTime = nil
        locationAtStopStart = nil
        parkingConfirmationTimer?.invalidate()
        startContinuousGps()
        NSLog("[BackgroundLocation] Driving started (GPS speed: \(String(format: "%.1f", speed)) m/s, CoreMotion pending)")
        sendEvent(withName: "onDrivingStarted", body: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "speed": speed,
          "source": "gps_speed",
        ])
      }
    } else if speed >= 0 && speed <= 0.5 {
      speedSaysMoving = false

      // When GPS speed drops to 0 while driving, capture the location
      // immediately. This is likely the parking spot, captured BEFORE the
      // user walks away. Don't wait for CoreMotion confirmation.
      if isDriving && locationAtStopStart == nil {
        locationAtStopStart = lastDrivingLocation ?? location
        NSLog("[BackgroundLocation] GPS speed≈0 while driving. Captured stop location: \(location.coordinate.latitude), \(location.coordinate.longitude)")
      }

      // Start GPS speed-based parking timer: repeating check every 3 seconds.
      // Fast path: if CoreMotion agrees (not automotive), confirm immediately.
      // Fallback: after 10s of sustained zero speed, override CoreMotion and
      // confirm parking anyway. CoreMotion can take 30-60s to transition from
      // automotive after the engine stops — the user shouldn't wait that long.
      // Only requires 15s of driving (not the full minDrivingDurationSec) because
      // sustained zero GPS speed is a strong signal — red lights rarely show
      // 10+ consecutive seconds of true zero GPS speed.
      if isDriving,
         let drivingStart = drivingStartTime,
         Date().timeIntervalSince(drivingStart) >= minDrivingDurationSec,
         speedZeroTimer == nil {
        // Record when speed first hit zero (if not already set from location capture above)
        if speedZeroStartTime == nil {
          speedZeroStartTime = Date()
        }
        NSLog("[BackgroundLocation] GPS speed≈0 after \(String(format: "%.0f", Date().timeIntervalSince(drivingStart)))s driving. Starting repeating speed check (every \(speedCheckIntervalSec)s, override at \(speedZeroOverrideSec)s).")
        speedZeroTimer = Timer.scheduledTimer(withTimeInterval: speedCheckIntervalSec, repeats: true) { [weak self] timer in
          guard let self = self else { timer.invalidate(); return }

          if self.speedSaysMoving {
            NSLog("[BackgroundLocation] Speed check: speed resumed. Cancelling (was a red light).")
            timer.invalidate()
            self.speedZeroTimer = nil
            self.speedZeroStartTime = nil
            return
          }

          let zeroDuration = self.speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0

          if !self.coreMotionSaysAutomotive {
            // CoreMotion agrees user is not in a vehicle — confirm immediately
            NSLog("[BackgroundLocation] Speed-based parking confirmed after \(String(format: "%.0f", zeroDuration))s (CoreMotion agrees).")
            timer.invalidate()
            self.speedZeroTimer = nil
            self.confirmParking(source: "gps_speed")
          } else if zeroDuration >= self.speedZeroOverrideSec {
            // CoreMotion still says automotive but speed has been 0 for 15+ seconds.
            // This is not a red light — engine is off, CoreMotion is just slow to update.
            NSLog("[BackgroundLocation] Speed-based parking confirmed after \(String(format: "%.0f", zeroDuration))s (CoreMotion override — sustained zero speed).")
            timer.invalidate()
            self.speedZeroTimer = nil
            self.confirmParking(source: "gps_speed_override")
          } else {
            NSLog("[BackgroundLocation] Speed≈0 for \(String(format: "%.0f", zeroDuration))s but CoreMotion still automotive. Waiting... (override at \(self.speedZeroOverrideSec)s)")
          }
        }
      }
    }

    // Send location updates to JS (only while continuous GPS is active to save overhead)
    if continuousGpsActive {
      sendEvent(withName: "onLocationUpdate", body: [
        "latitude": location.coordinate.latitude,
        "longitude": location.coordinate.longitude,
        "accuracy": location.horizontalAccuracy,
        "speed": location.speed,
        "heading": location.course,  // CLLocation.course: 0-360 degrees, -1 if invalid
        "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
        "coreMotionAutomotive": coreMotionSaysAutomotive,
      ])
    }
  }

  /// Recovery check: query CoreMotion history to see if we missed a parking event
  /// while the app was killed. Called when significantLocationChange wakes us.
  private var hasCheckedForMissedParking = false

  private func checkForMissedParking(currentLocation: CLLocation) {
    // Only check once per app wake to avoid repeated queries
    guard !hasCheckedForMissedParking else { return }
    guard CMMotionActivityManager.isActivityAvailable() else { return }
    hasCheckedForMissedParking = true

    let now = Date()
    let lookback = now.addingTimeInterval(-30 * 60) // Check last 30 minutes

    activityManager.queryActivityStarting(from: lookback, to: now, to: .main) { [weak self] activities, error in
      guard let self = self, let activities = activities, activities.count > 1 else { return }

      // Look for pattern: automotive activity followed by stationary/walking
      var lastAutomotiveEnd: Date? = nil
      var wasRecentlyDriving = false
      var automotiveDuration: TimeInterval = 0

      for i in 0..<activities.count {
        let activity = activities[i]
        if activity.automotive {
          wasRecentlyDriving = true
          if lastAutomotiveEnd == nil {
            // Track when automotive segment started
          }
          if i + 1 < activities.count {
            lastAutomotiveEnd = activities[i + 1].startDate
            automotiveDuration += activities[i + 1].startDate.timeIntervalSince(activity.startDate)
          }
        }
      }

      // Check if the most recent activity is stationary/walking
      guard let lastActivity = activities.last else { return }
      let currentlyStationary = lastActivity.stationary || lastActivity.walking

      // If user drove for 2+ min and is now stationary, trigger retroactive parking check
      if wasRecentlyDriving && currentlyStationary && automotiveDuration >= self.minDrivingDurationSec {
        NSLog("[BackgroundLocation] RECOVERY: Detected missed parking event. Drove \(String(format: "%.0f", automotiveDuration))s, now stationary. Triggering retroactive check.")

        var body: [String: Any] = [
          "timestamp": now.timeIntervalSince1970 * 1000,
          "latitude": currentLocation.coordinate.latitude,
          "longitude": currentLocation.coordinate.longitude,
          "accuracy": currentLocation.horizontalAccuracy,
          "locationSource": "recovery_significant_change",
          "drivingDurationSec": automotiveDuration,
        ]

        self.sendEvent(withName: "onParkingDetected", body: body)

        // Re-start CoreMotion monitoring since we just woke up
        if !self.coreMotionSaysAutomotive {
          self.startMotionActivityMonitoring()
        }
      } else {
        NSLog("[BackgroundLocation] Recovery check: no missed parking (drove: \(wasRecentlyDriving), stationary: \(currentlyStationary), duration: \(String(format: "%.0f", automotiveDuration))s)")
      }
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("[BackgroundLocation] Location error: \(error.localizedDescription)")
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    NSLog("[BackgroundLocation] Auth changed: \(status.rawValue)")
    if status == .authorizedWhenInUse {
      manager.requestAlwaysAuthorization()
    }
  }

  // MARK: - Parking Detection Logic

  /// Called ONLY when CoreMotion confirms user exited vehicle (not on speed=0 alone)
  /// userIsWalking: if true, CoreMotion detected walking (not just stationary).
  /// Walking means the user got out of the car — bypass the minimum driving duration
  /// filter. Red lights produce "stationary", not "walking", so this is safe.
  private func handlePotentialParking(userIsWalking: Bool = false) {
    guard let drivingStart = drivingStartTime else {
      NSLog("[BackgroundLocation] No driving start time - ignoring")
      return
    }

    let drivingDuration = Date().timeIntervalSince(drivingStart)

    // Walking override: if CoreMotion says "walking", the user exited the car.
    // No need to enforce a minimum driving duration — you don't walk at a red light.
    // Still require at least 10 seconds to filter out sensor noise.
    if userIsWalking && drivingDuration >= 10 {
      NSLog("[BackgroundLocation] Walking detected after \(String(format: "%.0f", drivingDuration))s driving — bypassing duration filter")
    } else if drivingDuration < minDrivingDurationSec {
      NSLog("[BackgroundLocation] Drove only \(String(format: "%.0f", drivingDuration))s (need \(minDrivingDurationSec)s) and not walking - ignoring")
      return
    }

    if lastStationaryTime == nil {
      lastStationaryTime = Date()
      NSLog("[BackgroundLocation] Exit debounce started (\(exitDebounceSec)s). Drove \(String(format: "%.0f", drivingDuration))s.")
    }

    // Cancel any existing timer and start fresh.
    // 5 second debounce: just enough to ignore a momentary CoreMotion flicker
    // (e.g. user leans out car door then gets back in).
    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = Timer.scheduledTimer(withTimeInterval: exitDebounceSec, repeats: false) { [weak self] _ in
      self?.confirmParking()
    }
  }

  /// Final parking confirmation
  /// source: "coremotion" (5s after CoreMotion exit), "gps_speed" (speed≈0 + CoreMotion agrees),
  ///         or "gps_speed_override" (15s sustained zero speed, overrides slow CoreMotion)
  private func confirmParking(source: String = "coremotion") {
    guard isDriving, drivingStartTime != nil else {
      NSLog("[BackgroundLocation] confirmParking(\(source)) skipped: isDriving=\(isDriving), drivingStartTime=\(drivingStartTime != nil)")
      return
    }
    guard isMonitoring else {
      NSLog("[BackgroundLocation] confirmParking(\(source)) skipped: monitoring stopped")
      return
    }

    // ALWAYS cancel BOTH timers first to prevent double-triggering.
    // Previously only the "other" timer was cancelled, leaving the second
    // timer to fire confirmParking() again after the first already ran.
    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = nil
    speedZeroTimer?.invalidate()
    speedZeroTimer = nil

    // If CoreMotion still reports automotive (engine running / vehicle vibrations),
    // abort parking confirmation — UNLESS this is a speed override (15s of zero speed
    // means the engine is off, CoreMotion is just slow to update).
    if coreMotionSaysAutomotive && source != "gps_speed_override" {
      NSLog("[BackgroundLocation] CoreMotion still says automotive — aborting parking confirmation (source: \(source))")
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }

    NSLog("[BackgroundLocation] PARKING CONFIRMED (source: \(source))")

    // After first parking, require both CoreMotion + GPS to agree before restarting driving.
    // This prevents GPS noise alone from falsely triggering "Driving" state.
    hasConfirmedParkingOnce = true

    // Location priority:
    // 1. locationAtStopStart - captured when CoreMotion first said non-automotive (best)
    // 2. lastDrivingLocation - last GPS while in driving state (very good - includes slow creep)
    // 3. locationManager.location - current GPS (last resort - user may have walked)
    let parkingLocation = locationAtStopStart ?? lastDrivingLocation
    let currentLocation = locationManager.location

    // Use the parking location's GPS timestamp if available — this is when the car
    // ACTUALLY stopped, not when the confirmation timer fires (which can be 5-13s later).
    // Falls back to the current time if no parking location timestamp is available.
    let parkingTimestamp: Double
    if let loc = parkingLocation {
      parkingTimestamp = loc.timestamp.timeIntervalSince1970 * 1000
      NSLog("[BackgroundLocation] Using parking location GPS timestamp: \(loc.timestamp) (\(String(format: "%.0f", Date().timeIntervalSince(loc.timestamp)))s ago)")
    } else {
      parkingTimestamp = Date().timeIntervalSince1970 * 1000
    }

    var body: [String: Any] = [
      "timestamp": parkingTimestamp,
    ]

    if let loc = parkingLocation {
      body["latitude"] = loc.coordinate.latitude
      body["longitude"] = loc.coordinate.longitude
      body["accuracy"] = loc.horizontalAccuracy
      body["locationSource"] = locationAtStopStart != nil ? "stop_start" : "last_driving"
      NSLog("[BackgroundLocation] Parking at (\(body["locationSource"]!)): \(loc.coordinate.latitude), \(loc.coordinate.longitude) ±\(loc.horizontalAccuracy)m")
    } else if let loc = currentLocation {
      body["latitude"] = loc.coordinate.latitude
      body["longitude"] = loc.coordinate.longitude
      body["accuracy"] = loc.horizontalAccuracy
      body["locationSource"] = "current_fallback"
      NSLog("[BackgroundLocation] WARNING: Using current location as fallback")
    }

    if let cur = currentLocation, let park = parkingLocation {
      let driftMeters = cur.distance(from: park)
      body["driftFromParkingMeters"] = driftMeters
      NSLog("[BackgroundLocation] User walked \(String(format: "%.0f", driftMeters))m from car")
    }

    if let drivingStart = drivingStartTime {
      body["drivingDurationSec"] = Date().timeIntervalSince(drivingStart)
    }

    sendEvent(withName: "onParkingDetected", body: body)

    // Reset driving state
    isDriving = false
    coreMotionSaysAutomotive = false
    speedSaysMoving = false
    drivingStartTime = nil
    lastStationaryTime = nil
    locationAtStopStart = nil
    speedZeroStartTime = nil
    // lastDrivingLocation intentionally kept after parking - it's the parking spot reference.
    // It gets cleared when the NEXT drive starts (see isDriving=true transitions).

    // Stop continuous GPS to save battery - back to significantChanges only
    stopContinuousGps()

    // KEEP CoreMotion running even while parked!
    // CoreMotion uses the M-series coprocessor (hardware, ~zero CPU) and is
    // extremely low power. Stopping it and relying on significantLocationChange
    // to restart it was causing missed departures: significantLocationChange
    // only fires on cell tower changes (~100-500m), so short drives or drives
    // starting near the same cell tower never triggered it, meaning CoreMotion
    // was never restarted and onDrivingStarted never fired.
    // By keeping CoreMotion active, we immediately detect the next automotive
    // activity and can fire the departure event.
    NSLog("[BackgroundLocation] Keeping CoreMotion active for departure detection (low power)")
  }

  // MARK: - Helpers

  private func confidenceString(_ confidence: CMMotionActivityConfidence) -> String {
    switch confidence {
    case .low: return "low"
    case .medium: return "medium"
    case .high: return "high"
    @unknown default: return "unknown"
    }
  }
}
