import Foundation
import CoreLocation
import CoreMotion

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

  // Configuration
  private let minDrivingDurationSec: TimeInterval = 120  // 2 min of driving before we care about stops
  private let minStopDurationSec: TimeInterval = 30      // 30 sec after CoreMotion confirms exit from car
  private let minDrivingSpeedMps: Double = 2.5           // ~5.6 mph - threshold to START driving state via speed

  // Debounce timer for parking confirmation
  private var parkingConfirmationTimer: Timer?

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
    if CMMotionActivityManager.isActivityAvailable() {
      startMotionActivityMonitoring()
    }

    // Do NOT start continuous GPS yet - wait until CoreMotion detects driving.
    // This saves significant battery when user is walking/stationary.

    isMonitoring = true
    NSLog("[BackgroundLocation] Monitoring started (significantChanges + CoreMotion, GPS on-demand)")
    resolve(true)
  }

  /// Stop all monitoring
  @objc func stopMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    locationManager.stopMonitoringSignificantLocationChanges()
    stopContinuousGps()
    activityManager.stopActivityUpdates()

    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = nil

    isMonitoring = false
    isDriving = false
    coreMotionSaysAutomotive = false
    speedSaysMoving = false
    drivingStartTime = nil
    lastDrivingLocation = nil
    locationAtStopStart = nil
    lastStationaryTime = nil

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
    locationManager.startUpdatingLocation()
    continuousGpsActive = true
    NSLog("[BackgroundLocation] Continuous GPS ON (driving detected)")
  }

  /// Stop continuous GPS (called after parking confirmed)
  /// significantLocationChange remains active as low-power backup
  private func stopContinuousGps() {
    guard continuousGpsActive else { return }
    locationManager.stopUpdatingLocation()
    continuousGpsActive = false
    NSLog("[BackgroundLocation] Continuous GPS OFF (saving battery)")
  }

  // MARK: - CoreMotion: Primary Driving Detection

  private func startMotionActivityMonitoring() {
    activityManager.startActivityUpdates(to: .main) { [weak self] activity in
      guard let self = self, let activity = activity else { return }

      if activity.automotive && activity.confidence != .low {
        // ---- DRIVING ----
        // CoreMotion's M-series coprocessor detected vehicle vibration pattern.
        // This is the gold standard - works at any speed including 1 mph.
        self.coreMotionSaysAutomotive = true

        // Cancel any pending parking timer - we're still in the car
        self.parkingConfirmationTimer?.invalidate()
        self.parkingConfirmationTimer = nil
        self.lastStationaryTime = nil
        self.locationAtStopStart = nil

        if !self.isDriving {
          self.isDriving = true
          self.drivingStartTime = Date()
          // Spin up precise GPS now that we know user is driving
          self.startContinuousGps()
          NSLog("[BackgroundLocation] Driving started (CoreMotion automotive)")
          self.sendEvent(withName: "onDrivingStarted", body: [
            "timestamp": Date().timeIntervalSince1970 * 1000,
            "source": "coremotion",
          ])
        }

      } else if (activity.stationary || activity.walking) && activity.confidence != .low {
        // ---- NOT IN CAR ----
        // CoreMotion confirms user is NOT in a vehicle.
        // This is the KEY gate: speed=0 at a red light keeps coreMotionSaysAutomotive=true
        // because you're still sitting in the car. Only when you physically exit and walk
        // does CoreMotion report stationary/walking.
        let wasAutomotive = self.coreMotionSaysAutomotive
        self.coreMotionSaysAutomotive = false

        if self.isDriving && wasAutomotive {
          // User was driving and has now exited the vehicle.
          // Snapshot the location RIGHT NOW - this is the parking spot.
          if self.locationAtStopStart == nil {
            self.locationAtStopStart = self.lastDrivingLocation ?? self.locationManager.location
            NSLog("[BackgroundLocation] Car stop location captured: \(self.locationAtStopStart?.coordinate.latitude ?? 0), \(self.locationAtStopStart?.coordinate.longitude ?? 0)")
          }

          NSLog("[BackgroundLocation] Exited vehicle (CoreMotion: \(activity.stationary ? "stationary" : "walking"), confidence: \(self.confidenceString(activity.confidence)))")
          self.handlePotentialParking()
        }
      }
      // Note: cycling, running, unknown → ignore, don't change state
    }
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    let speed = location.speed  // m/s, -1 if unknown

    // --- Update driving location continuously while in driving state ---
    // Save at ANY speed while CoreMotion says automotive (captures 1 mph creep into spot)
    if isDriving || coreMotionSaysAutomotive {
      lastDrivingLocation = location
    }

    // --- Speed-based driving detection (backup if CoreMotion is slow) ---
    if speed > minDrivingSpeedMps {
      speedSaysMoving = true

      if !isDriving && !coreMotionSaysAutomotive {
        // CoreMotion hasn't kicked in yet but GPS speed says driving
        isDriving = true
        drivingStartTime = Date()
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
      // Speed is near zero but we do NOT start parking timer here.
      // We wait for CoreMotion to confirm the user exited the vehicle.
      // This prevents red light / traffic stop false positives.
    }

    // Send location updates to JS (only while continuous GPS is active to save overhead)
    if continuousGpsActive {
      sendEvent(withName: "onLocationUpdate", body: [
        "latitude": location.coordinate.latitude,
        "longitude": location.coordinate.longitude,
        "accuracy": location.horizontalAccuracy,
        "speed": location.speed,
        "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
        "coreMotionAutomotive": coreMotionSaysAutomotive,
      ])
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
  private func handlePotentialParking() {
    guard let drivingStart = drivingStartTime else {
      NSLog("[BackgroundLocation] No driving start time - ignoring")
      return
    }

    let drivingDuration = Date().timeIntervalSince(drivingStart)
    guard drivingDuration >= minDrivingDurationSec else {
      NSLog("[BackgroundLocation] Drove only \(String(format: "%.0f", drivingDuration))s (need \(minDrivingDurationSec)s) - ignoring")
      return
    }

    if lastStationaryTime == nil {
      lastStationaryTime = Date()
      NSLog("[BackgroundLocation] Parking timer started (\(minStopDurationSec)s). Drove \(String(format: "%.0f", drivingDuration))s.")
    }

    // Cancel any existing timer and start fresh
    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = Timer.scheduledTimer(withTimeInterval: minStopDurationSec, repeats: false) { [weak self] _ in
      self?.confirmParking()
    }
  }

  /// Final parking confirmation - fires 30s after CoreMotion says user left the car
  private func confirmParking() {
    guard isDriving || drivingStartTime != nil else { return }

    // If CoreMotion flipped back to automotive during the 30s window, abort
    if coreMotionSaysAutomotive {
      NSLog("[BackgroundLocation] CoreMotion says automotive again during confirmation - aborting")
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }

    NSLog("[BackgroundLocation] PARKING CONFIRMED")

    // Location priority:
    // 1. locationAtStopStart - captured when CoreMotion first said non-automotive (best)
    // 2. lastDrivingLocation - last GPS while in driving state (very good - includes slow creep)
    // 3. locationManager.location - current GPS (last resort - user may have walked)
    let parkingLocation = locationAtStopStart ?? lastDrivingLocation
    let currentLocation = locationManager.location

    var body: [String: Any] = [
      "timestamp": Date().timeIntervalSince1970 * 1000,
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
    // lastDrivingLocation intentionally kept - it's the parking spot reference

    // Stop continuous GPS to save battery - back to significantChanges only
    stopContinuousGps()
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
