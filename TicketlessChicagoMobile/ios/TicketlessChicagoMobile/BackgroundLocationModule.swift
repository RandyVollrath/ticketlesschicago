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
  private var coreMotionSaysAutomotive = false  // True when CoreMotion reports automotive
  private var drivingStartTime: Date? = nil
  private var lastDrivingLocation: CLLocation? = nil  // Updated continuously while driving (any speed)
  private var lastHighSpeedLocation: CLLocation? = nil // Updated only above speed threshold
  private var locationAtStopStart: CLLocation? = nil   // Snapshot GPS at exact moment we stop
  private var lastStationaryTime: Date? = nil

  // Configuration
  private let minDrivingDurationSec: TimeInterval = 120  // 2 minutes of driving before we care about stops
  private let minStopDurationSec: TimeInterval = 90       // 90 seconds stopped = probably parked, not a light
  private let minDrivingSpeedMps: Double = 2.5            // ~5.6 mph - threshold to START driving state

  // Debounce timer for parking detection
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
      // Need to upgrade to Always
      locationManager.requestAlwaysAuthorization()
      resolve("when_in_use")
    case .notDetermined:
      // Request When In Use first (Apple requires two-step)
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
    case .authorizedAlways:
      resolve("always")
    case .authorizedWhenInUse:
      resolve("when_in_use")
    case .notDetermined:
      resolve("not_determined")
    case .denied:
      resolve("denied")
    case .restricted:
      resolve("restricted")
    @unknown default:
      resolve("unknown")
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

    // Start significant location change monitoring (works in background, wakes app)
    locationManager.startMonitoringSignificantLocationChanges()

    // Also start continuous location updates for more precise detection
    locationManager.startUpdatingLocation()

    // Start motion activity monitoring to detect driving
    if CMMotionActivityManager.isActivityAvailable() {
      startMotionActivityMonitoring()
    }

    isMonitoring = true
    NSLog("[BackgroundLocation] Monitoring started (significant changes + continuous + motion)")
    resolve(true)
  }

  /// Stop all monitoring
  @objc func stopMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    locationManager.stopMonitoringSignificantLocationChanges()
    locationManager.stopUpdatingLocation()
    activityManager.stopActivityUpdates()

    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = nil

    isMonitoring = false
    isDriving = false
    drivingStartTime = nil
    lastDrivingLocation = nil
    lastStationaryTime = nil

    NSLog("[BackgroundLocation] Monitoring stopped")
    resolve(true)
  }

  /// Get current monitoring status
  @objc func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    var result: [String: Any] = [
      "isMonitoring": isMonitoring,
      "isDriving": isDriving,
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

  // MARK: - Motion Activity Monitoring

  private func startMotionActivityMonitoring() {
    activityManager.startActivityUpdates(to: .main) { [weak self] activity in
      guard let self = self, let activity = activity else { return }

      if activity.automotive && activity.confidence != .low {
        // CoreMotion says user is in a vehicle
        self.coreMotionSaysAutomotive = true

        if !self.isDriving {
          self.isDriving = true
          self.drivingStartTime = Date()
          self.lastStationaryTime = nil
          self.locationAtStopStart = nil
          self.parkingConfirmationTimer?.invalidate()
          NSLog("[BackgroundLocation] Driving started (motion)")
          self.sendEvent(withName: "onDrivingStarted", body: [
            "timestamp": Date().timeIntervalSince1970 * 1000,
          ])
        }
      } else if activity.stationary || activity.walking {
        let wasAutomotive = self.coreMotionSaysAutomotive
        self.coreMotionSaysAutomotive = false

        // Only treat as potential parking if we were driving
        if self.isDriving {
          // Snapshot GPS right now - this is the moment the car stopped
          // (before the user walks away)
          if self.locationAtStopStart == nil {
            self.locationAtStopStart = self.locationManager.location
            NSLog("[BackgroundLocation] Captured stop-start location: \(self.locationAtStopStart?.coordinate.latitude ?? 0), \(self.locationAtStopStart?.coordinate.longitude ?? 0)")
          }

          NSLog("[BackgroundLocation] Stopped moving (motion: \(activity.stationary ? "stationary" : "walking"), wasAutomotive: \(wasAutomotive))")
          self.handlePotentialParking()
        }
      }
    }
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }

    let speed = location.speed  // m/s, -1 if unknown

    // --- Update driving location continuously while in driving state ---
    // This is the key fix: save position at ALL speeds while driving,
    // so we capture the exact spot even when creeping at 1 mph into a parking spot
    if isDriving || coreMotionSaysAutomotive {
      lastDrivingLocation = location
    }

    // --- Speed-based driving detection (backup for CoreMotion) ---
    if speed > minDrivingSpeedMps {
      // Definitely driving based on speed
      lastHighSpeedLocation = location

      if !isDriving {
        isDriving = true
        drivingStartTime = Date()
        lastStationaryTime = nil
        locationAtStopStart = nil
        parkingConfirmationTimer?.invalidate()
        NSLog("[BackgroundLocation] Driving started (speed: \(String(format: "%.1f", speed)) m/s)")
        sendEvent(withName: "onDrivingStarted", body: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "speed": speed,
        ])
      }
    } else if speed >= 0 && speed <= 0.5 && isDriving {
      // Speed near zero while we were driving - potential parking
      // Snapshot the location at the moment we first stop
      if locationAtStopStart == nil {
        locationAtStopStart = location
        NSLog("[BackgroundLocation] Captured stop-start location (GPS speed=0): \(location.coordinate.latitude), \(location.coordinate.longitude)")
      }
      handlePotentialParking()
    }

    // Send location updates to JS for debugging/display
    sendEvent(withName: "onLocationUpdate", body: [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "accuracy": location.horizontalAccuracy,
      "speed": location.speed,
      "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
    ])
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("[BackgroundLocation] Location error: \(error.localizedDescription)")
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    NSLog("[BackgroundLocation] Auth changed: \(status.rawValue)")

    // If we just got When In Use, request upgrade to Always
    if status == .authorizedWhenInUse {
      manager.requestAlwaysAuthorization()
    }
  }

  // MARK: - Parking Detection Logic

  private func handlePotentialParking() {
    // Check if we were driving long enough (avoids red light detection)
    guard let drivingStart = drivingStartTime else {
      NSLog("[BackgroundLocation] No driving start time - ignoring stop")
      return
    }

    let drivingDuration = Date().timeIntervalSince(drivingStart)
    guard drivingDuration >= minDrivingDurationSec else {
      NSLog("[BackgroundLocation] Driving too short (\(String(format: "%.0f", drivingDuration))s < \(minDrivingDurationSec)s) - ignoring")
      return
    }

    // Start the stop timer if not already running
    if lastStationaryTime == nil {
      lastStationaryTime = Date()
      NSLog("[BackgroundLocation] Stop timer started (drove \(String(format: "%.0f", drivingDuration))s)")
    }

    // Cancel any existing confirmation timer
    parkingConfirmationTimer?.invalidate()

    // Set a timer - if still stopped after minStopDurationSec, confirm parking
    parkingConfirmationTimer = Timer.scheduledTimer(withTimeInterval: minStopDurationSec, repeats: false) { [weak self] _ in
      self?.confirmParking()
    }
  }

  private func confirmParking() {
    guard isDriving || drivingStartTime != nil else { return }

    NSLog("[BackgroundLocation] PARKING CONFIRMED - triggering check")

    // Priority order for parking location:
    // 1. locationAtStopStart - GPS snapshot at the exact moment speed hit 0 (best)
    // 2. lastDrivingLocation - last GPS while CoreMotion said automotive (very good)
    // 3. lastHighSpeedLocation - last GPS above speed threshold (good)
    // 4. locationManager.location - current GPS (worst - user may have walked away)
    //
    // We do NOT use current location because 90 seconds have passed since the car stopped.
    // The user could have walked 100+ meters from their car by now.
    let parkingLocation = locationAtStopStart ?? lastDrivingLocation ?? lastHighSpeedLocation

    // Also capture current location for comparison/debugging
    let currentLocation = locationManager.location

    var body: [String: Any] = [
      "timestamp": Date().timeIntervalSince1970 * 1000,
    ]

    if let loc = parkingLocation {
      body["latitude"] = loc.coordinate.latitude
      body["longitude"] = loc.coordinate.longitude
      body["accuracy"] = loc.horizontalAccuracy
      body["locationSource"] = locationAtStopStart != nil ? "stop_start" :
                               lastDrivingLocation != nil ? "last_driving" : "last_high_speed"
      NSLog("[BackgroundLocation] Parking location (\(body["locationSource"]!)): \(loc.coordinate.latitude), \(loc.coordinate.longitude) ±\(loc.horizontalAccuracy)m")
    } else if let loc = currentLocation {
      // Last resort - better than nothing
      body["latitude"] = loc.coordinate.latitude
      body["longitude"] = loc.coordinate.longitude
      body["accuracy"] = loc.horizontalAccuracy
      body["locationSource"] = "current_fallback"
      NSLog("[BackgroundLocation] WARNING: Using current location as fallback (user may have walked)")
    }

    // Include current location separately so JS side can log the drift
    if let cur = currentLocation, let park = parkingLocation {
      let driftMeters = cur.distance(from: park)
      body["driftFromParkingMeters"] = driftMeters
      NSLog("[BackgroundLocation] Drift from parking spot: \(String(format: "%.0f", driftMeters))m")
    }

    if let drivingStart = drivingStartTime {
      body["drivingDurationSec"] = Date().timeIntervalSince(drivingStart)
    }

    sendEvent(withName: "onParkingDetected", body: body)

    // Reset driving state but keep lastDrivingLocation for getLastDrivingLocation() API
    isDriving = false
    coreMotionSaysAutomotive = false
    drivingStartTime = nil
    lastStationaryTime = nil
    locationAtStopStart = nil
    // Note: lastDrivingLocation is intentionally NOT cleared - it's the parking spot reference
  }
}
