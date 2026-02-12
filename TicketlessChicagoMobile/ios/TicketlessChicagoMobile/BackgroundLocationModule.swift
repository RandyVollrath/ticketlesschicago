import Foundation
import CoreLocation
import CoreMotion
import React

@objc(BackgroundLocationModule)
class BackgroundLocationModule: RCTEventEmitter, CLLocationManagerDelegate {

  private let locationManager = CLLocationManager()
  private let activityManager = CMMotionActivityManager()
  private var isMonitoring = false

  // File-based logging for debugging (NSLog doesn't appear in syslog reliably)
  private var logFileHandle: FileHandle?
  private let logFileName = "parking_detection.log"
  private let dateFormatter: DateFormatter = {
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    return df
  }()

  private func log(_ message: String) {
    let timestamp = dateFormatter.string(from: Date())
    let logLine = "[\(timestamp)] \(message)\n"

    // Also NSLog for Xcode console
    NSLog("[BackgroundLocation] %@", message)

    // Write to file
    if let data = logLine.data(using: .utf8) {
      logFileHandle?.write(data)
      logFileHandle?.synchronizeFile()  // Flush immediately
    }
  }

  private func setupLogFile() {
    let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
    guard let documentsDirectory = paths.first else { return }
    let logFileURL = documentsDirectory.appendingPathComponent(logFileName)

    // Create or append to log file
    if !FileManager.default.fileExists(atPath: logFileURL.path) {
      FileManager.default.createFile(atPath: logFileURL.path, contents: nil, attributes: nil)
    }

    logFileHandle = try? FileHandle(forWritingTo: logFileURL)
    logFileHandle?.seekToEndOfFile()

    log("=== Log file opened ===")
    log("Log path: \(logFileURL.path)")
  }

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
  private var automotiveSessionStart: Date? = nil       // When current automotive session began (for flicker filtering)
  private var lastConfirmedParkingLocation: CLLocation? = nil  // Where we last confirmed parking (for distance-based flicker check)

  // Configuration
  private let minDrivingDurationSec: TimeInterval = 10   // 10 sec of driving before we care about stops (was 120→60→30→10; covers moving car one block for street cleaning)
  private let exitDebounceSec: TimeInterval = 5          // 5 sec debounce after CoreMotion confirms exit
  private let minDrivingSpeedMps: Double = 2.5           // ~5.6 mph - threshold to START driving state via speed
  private let speedCheckIntervalSec: TimeInterval = 3    // Re-check parking every 3s while speed≈0
  private let stationaryRadiusMeters: Double = 50        // Consider "same location" if within 50m
  private let stationaryDurationSec: TimeInterval = 120  // 2 minutes in same spot = definitely parked

  // Debounce timer for parking confirmation
  private var parkingConfirmationTimer: Timer?
  private var speedZeroTimer: Timer?  // GPS speed-based parking trigger (repeating, checks every 3s)
  private var speedZeroStartTime: Date?  // When GPS speed first dropped to ≈0 during this driving session
  private var stationaryLocation: CLLocation?  // Location when we first stopped moving
  private var stationaryStartTime: Date?  // When we first stopped at stationaryLocation

  // After parking, require GPS confirmation before restarting driving (prevents CoreMotion flicker)
  private var hasConfirmedParkingThisSession = false

  // CoreMotion stability tracking: prevents false parking at red lights.
  // Tracks when CoreMotion last transitioned FROM automotive to non-automotive.
  // The gps_coremotion_agree path requires CoreMotion to have been non-automotive
  // for at least coreMotionStabilitySec continuously, not just at one timer tick.
  private var coreMotionNotAutomotiveSince: Date? = nil
  private let coreMotionStabilitySec: TimeInterval = 8  // CoreMotion must be non-automotive for 8s
  private let minZeroSpeedForAgreeSec: TimeInterval = 15  // GPS speed≈0 for 15s before gps_coremotion_agree can fire


  override init() {
    super.init()
    setupLogFile()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.allowsBackgroundLocationUpdates = true
    locationManager.pausesLocationUpdatesAutomatically = false
    locationManager.showsBackgroundLocationIndicator = true
    locationManager.distanceFilter = 10 // meters
    log("BackgroundLocationModule initialized")
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
      self.log("WARNING: Only 'When In Use' permission. Background parking detection REQUIRES 'Always'. Requesting upgrade...")
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
    self.log("CoreMotion available: \(coreMotionAvailable)")
    if coreMotionAvailable {
      startMotionActivityMonitoring()
      self.log("CoreMotion activity monitoring started")
    } else {
      self.log("WARNING: CoreMotion NOT available on this device")
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
    self.log("Monitoring started (significantChanges + CoreMotion, GPS on-demand, auth=\(authString), coreMotion=\(coreMotionAvailable))")
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
    stationaryLocation = nil
    stationaryStartTime = nil
    automotiveSessionStart = nil
    lastConfirmedParkingLocation = nil
    hasConfirmedParkingThisSession = false
    coreMotionNotAutomotiveSince = nil

    self.log("Monitoring stopped")
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

  /// Get the debug log file contents (last N lines)
  @objc func getDebugLogs(_ lineCount: Int, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
    guard let documentsDirectory = paths.first else {
      resolve("")
      return
    }
    let logFileURL = documentsDirectory.appendingPathComponent(logFileName)

    guard let content = try? String(contentsOf: logFileURL, encoding: .utf8) else {
      resolve("")
      return
    }

    // Return last N lines
    let lines = content.components(separatedBy: "\n")
    let lastLines = lines.suffix(lineCount > 0 ? lineCount : 100)
    resolve(lastLines.joined(separator: "\n"))
  }

  /// Clear the debug log file
  @objc func clearDebugLogs(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
    guard let documentsDirectory = paths.first else {
      resolve(false)
      return
    }
    let logFileURL = documentsDirectory.appendingPathComponent(logFileName)

    // Close and reopen to truncate
    logFileHandle?.closeFile()
    try? "".write(to: logFileURL, atomically: true, encoding: .utf8)
    logFileHandle = try? FileHandle(forWritingTo: logFileURL)
    log("=== Log file cleared ===")
    resolve(true)
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
    self.log("Continuous GPS ON (driving detected, distanceFilter=none)")
  }

  /// Stop continuous GPS (called after parking confirmed)
  /// significantLocationChange remains active as low-power backup
  private func stopContinuousGps() {
    guard continuousGpsActive else { return }
    locationManager.stopUpdatingLocation()
    // Restore distance filter to save power when not actively driving
    locationManager.distanceFilter = 10
    continuousGpsActive = false
    self.log("Continuous GPS OFF (saving battery, distanceFilter=10m)")
  }

  // MARK: - CoreMotion: Primary Driving Detection

  private func startMotionActivityMonitoring() {
    guard !coreMotionActive else {
      self.log("CoreMotion already active, skipping restart")
      return
    }
    coreMotionActive = true
    activityManager.startActivityUpdates(to: .main) { [weak self] activity in
      guard let self = self, let activity = activity else { return }

      // Log every CoreMotion update for diagnostics
      self.log("CoreMotion update: automotive=\(activity.automotive) stationary=\(activity.stationary) walking=\(activity.walking) confidence=\(self.confidenceString(activity.confidence))")

      if activity.automotive {
        // ---- DRIVING ----
        // CoreMotion's M-series coprocessor detected vehicle vibration pattern.
        // Accept ALL confidence levels - some devices consistently report .low
        // for automotive even when genuinely driving.
        if !self.coreMotionSaysAutomotive {
          self.automotiveSessionStart = Date()
        }
        self.coreMotionSaysAutomotive = true
        self.coreMotionNotAutomotiveSince = nil  // Reset stability tracker — back to automotive

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
          self.log("CoreMotion automotive + GPS moving — cancelled parking timers")
        } else if self.parkingConfirmationTimer != nil || self.speedZeroTimer != nil {
          // GPS says speed ≈ 0 but CoreMotion says automotive — CoreMotion is probably wrong.
          // Keep parking timers running. The user is likely stationary.
          self.log("CoreMotion says automotive BUT GPS speed ≈ 0 — NOT cancelling parking timers (CoreMotion flicker?)")
        }

        if !self.isDriving {
          // GPS SPEED VETO: Only applies AFTER parking has been confirmed this session.
          // First drive: trust CoreMotion alone (it's the authority on vehicle detection).
          // After parking: require GPS confirmation to prevent CoreMotion flicker from
          // falsely restarting "Driving" state while user is stationary.
          if self.hasConfirmedParkingThisSession && !self.speedSaysMoving {
            // DISTANCE BYPASS: If user has moved >50m from the last confirmed parking
            // location, they are clearly in a moving vehicle — trust CoreMotion immediately.
            // This prevents the stuck state where GPS speed never confirms on short drives
            // (e.g. 7 min grocery run), which blocks isDriving forever:
            //   1. CoreMotion detects automotive → GPS starts for speed verification
            //   2. GPS needs time to get a fix, or phone is in pocket with poor GPS
            //   3. By the time GPS works, user is already slowing/parked → speed ≈ 0
            //   4. isDriving never set → departure + next parking both missed
            if let lastParking = self.lastConfirmedParkingLocation,
               let currentLoc = self.locationManager.location,
               currentLoc.distance(from: lastParking) > 50 {
              self.log("CoreMotion automotive + moved \(String(format: "%.0f", currentLoc.distance(from: lastParking)))m from parking — bypassing GPS speed veto, trusting CoreMotion")
              // Fall through to set isDriving = true below
            } else {
              // Still near parking spot — wait for GPS speed confirmation.
              // Start GPS to GET speed updates. Otherwise we're stuck:
              // - No GPS running (stopped after parking to save power)
              // - speedSaysMoving stays false forever (no GPS = no speed updates)
              // - Driving never detected, departure never recorded
              if !self.continuousGpsActive {
                self.log("CoreMotion says automotive but GPS speed unknown — starting GPS to verify")
                self.startContinuousGps()
              }
              self.log("CoreMotion says automotive but GPS speed ≈ 0 — waiting for GPS speed confirmation")
              return
            }
          }

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
            self.log("Using GPS timestamp for departure: \(lastLoc.timestamp) (speed: \(String(format: "%.1f", lastLoc.speed)) m/s)")
          }

          self.log("Driving started (CoreMotion automotive + GPS moving, confidence: \(self.confidenceString(activity.confidence)), source: \(departureSource))")
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

        // Track when CoreMotion first became non-automotive (for stability check).
        // Only set the timestamp on the TRANSITION, not on every update.
        if wasAutomotive && self.coreMotionNotAutomotiveSince == nil {
          self.coreMotionNotAutomotiveSince = Date()
          self.log("CoreMotion stability: transitioned to non-automotive, tracking stability timer")
        }

        if self.isDriving && wasAutomotive {
          // User was driving and has now exited the vehicle.
          // Snapshot the location RIGHT NOW - this is the parking spot.
          if self.locationAtStopStart == nil {
            self.locationAtStopStart = self.lastDrivingLocation ?? self.locationManager.location
            self.log("Car stop location captured: \(self.locationAtStopStart?.coordinate.latitude ?? 0), \(self.locationAtStopStart?.coordinate.longitude ?? 0)")
          }

          let isWalking = activity.walking
          self.log("Exited vehicle (CoreMotion: \(activity.stationary ? "stationary" : "walking"), confidence: \(self.confidenceString(activity.confidence)))")
          self.handlePotentialParking(userIsWalking: isWalking)

        } else if !self.isDriving && wasAutomotive && self.hasConfirmedParkingThisSession {
          // SHORT DRIVE RECOVERY: CoreMotion went automotive → stationary/walking
          // but isDriving was never set to true. This happens on short drives
          // (e.g. 6 blocks) where GPS couldn't confirm speed before the user parked:
          //   1. CoreMotion detects automotive → starts GPS for speed verification
          //   2. GPS needs 3-10s to get a fix with speed > threshold
          //   3. By then the user is already slowing/parked → GPS shows speed ≈ 0
          //   4. isDriving never becomes true → normal parking detection is blocked
          //
          // Fix: fire onDrivingStarted (for departure tracking on previous spot)
          // then onParkingDetected (for the new spot).

          // FLICKER GUARD: CoreMotion can briefly flicker to automotive from phone
          // vibration while the user is still parked OR flicker to stationary
          // mid-drive. Three guards prevent false parking here:
          //   1. GPS speed veto: if speed > 1.0 m/s, still driving (strongest signal)
          //   2. Automotive duration must be > 30s (flicker is < 5s)
          //   3. Distance from last parking must be > 200m (actually went somewhere)
          // Guards 2 and 3 use AND logic — both must pass for a real drive.
          let automotiveDuration = Date().timeIntervalSince(self.automotiveSessionStart ?? Date())
          let currentLoc = self.locationManager.location
          let currentSpeed = currentLoc?.speed ?? -1
          let distFromLastParking: Double = {
            guard let lastParking = self.lastConfirmedParkingLocation, let cur = currentLoc else { return 0 }
            return cur.distance(from: lastParking)
          }()

          // GUARD 1: GPS speed veto — if GPS says we're moving, the user is
          // still driving and CoreMotion just flickered. This was the Clybourn
          // bug: CoreMotion flickered to stationary mid-drive, 197m from last
          // parking, passing the old flicker guard, and firing a false parking
          // event that also killed camera alerts.
          let gpsStillMoving = currentSpeed > 1.0

          // GUARD 2: Flicker filter — require BOTH conditions to pass:
          //   - Automotive for > 30s (not a brief phone vibration)
          //   - Moved > 200m from last parking (actually went somewhere)
          // Previously used OR logic (either one passing was enough) which
          // let through mid-drive flickers on short drives from false parkings.
          let isLikelyFlicker = automotiveDuration < 30 || distFromLastParking < 200
          self.log("SHORT DRIVE RECOVERY check: automotiveDuration=\(String(format: "%.0f", automotiveDuration))s, distFromLastParking=\(String(format: "%.0f", distFromLastParking))m, gpsSpeed=\(String(format: "%.1f", currentSpeed))m/s, gpsStillMoving=\(gpsStillMoving), isFlicker=\(isLikelyFlicker)")

          if gpsStillMoving {
            self.log("SHORT DRIVE RECOVERY: GPS speed \(String(format: "%.1f", currentSpeed)) m/s > 1.0 — user still driving, skipping (Clybourn bug fix)")
          } else if isLikelyFlicker {
            self.log("SHORT DRIVE RECOVERY: automotive \(String(format: "%.0f", automotiveDuration))s (< 30s) or dist \(String(format: "%.0f", distFromLastParking))m (< 200m) — likely flicker, skipping")
          } else if let loc = self.lastDrivingLocation ?? self.locationManager.location {
            self.log("SHORT DRIVE RECOVERY: CoreMotion automotive→\(activity.stationary ? "stationary" : "walking") but isDriving was false. Firing departure + parking events.")

            // Fire departure event first so previous parking gets a departure time.
            let departureTimestamp = Date().timeIntervalSince1970 * 1000
            self.sendEvent(withName: "onDrivingStarted", body: [
              "timestamp": departureTimestamp,
              "source": "short_drive_recovery",
            ])

            // Delay parking event to give JS time to process departure first.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
              let body: [String: Any] = [
                "timestamp": Date().timeIntervalSince1970 * 1000,
                "latitude": loc.coordinate.latitude,
                "longitude": loc.coordinate.longitude,
                "accuracy": loc.horizontalAccuracy,
                "locationSource": "short_drive_recovery",
                "drivingDurationSec": 0,
              ]
              self.sendEvent(withName: "onParkingDetected", body: body)
              self.log("SHORT DRIVE RECOVERY: onParkingDetected fired at \(loc.coordinate.latitude), \(loc.coordinate.longitude)")
            }

            // Clean up driving state and record this as the new parking location
            self.lastConfirmedParkingLocation = loc
            self.hasConfirmedParkingThisSession = true  // Mark parking confirmed so GPS speed veto + distance bypass works for next drive
            self.stopContinuousGps()
            self.lastDrivingLocation = nil
            self.locationAtStopStart = nil
            self.speedSaysMoving = false
            self.speedZeroStartTime = nil
          } else {
            self.log("SHORT DRIVE RECOVERY: No location available — cannot fire parking event")
          }
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
    self.log("CoreMotion activity updates STOPPED (parked, saving power)")
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
        self.log("significantLocationChange woke us — restarting CoreMotion")
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

      // GPS speed alone does NOT start driving — only CoreMotion can detect
      // "in a vehicle" vs "walking". GPS speed is used as a sanity check
      // to prevent CoreMotion flicker from falsely triggering driving.
      if !isDriving && coreMotionSaysAutomotive {
        // CoreMotion already said automotive but we were waiting for GPS speed
        // confirmation (hasConfirmedParkingThisSession guard). Now GPS confirms
        // driving speed — promote to driving immediately instead of waiting for
        // the next CoreMotion callback (which could be 10-60s away).
        isDriving = true
        drivingStartTime = Date()
        lastDrivingLocation = nil
        locationAtStopStart = nil
        self.log("Driving started (GPS speed \(String(format: "%.1f", speed)) m/s confirmed CoreMotion automotive)")

        var departureTimestamp = Date().timeIntervalSince1970 * 1000
        if location.speed > minDrivingSpeedMps && Date().timeIntervalSince(location.timestamp) < 60 {
          departureTimestamp = location.timestamp.timeIntervalSince1970 * 1000
        }

        sendEvent(withName: "onDrivingStarted", body: [
          "timestamp": departureTimestamp,
          "source": "gps_speed_confirmed",
        ])
      } else if !isDriving && !coreMotionSaysAutomotive {
        self.log("GPS speed > threshold (\(String(format: "%.1f", speed)) m/s) but CoreMotion not automotive — waiting for CoreMotion")
      }
    } else if speed >= 0 && speed <= 0.5 {
      speedSaysMoving = false

      // When GPS speed drops to 0 while driving, capture the location
      // immediately. This is likely the parking spot, captured BEFORE the
      // user walks away. Don't wait for CoreMotion confirmation.
      if isDriving && locationAtStopStart == nil {
        locationAtStopStart = lastDrivingLocation ?? location
        self.log("GPS speed≈0 while driving. Captured stop location: \(location.coordinate.latitude), \(location.coordinate.longitude)")
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
        // Record when speed first hit zero
        if speedZeroStartTime == nil {
          speedZeroStartTime = Date()
        }
        // Record location when we first stopped
        if stationaryLocation == nil {
          stationaryLocation = location
          stationaryStartTime = Date()
          self.log("Stationary location captured: \(location.coordinate.latitude), \(location.coordinate.longitude)")
        }

        self.log("GPS speed≈0 after \(String(format: "%.0f", Date().timeIntervalSince(drivingStart)))s driving. Starting parking check (every \(speedCheckIntervalSec)s).")
        speedZeroTimer = Timer.scheduledTimer(withTimeInterval: speedCheckIntervalSec, repeats: true) { [weak self] timer in
          guard let self = self else { timer.invalidate(); return }

          // Check current GPS speed — the 2-min location check only applies if phone is truly stationary
          // (not walking away from car). Walking is ~1.4 m/s.
          let currentSpeed = self.locationManager.location?.speed ?? -1
          let phoneIsStationary = currentSpeed >= 0 && currentSpeed < 0.5  // truly not moving

          // Check if we've moved significantly from parking spot
          var withinStationaryRadius = false
          if let stationaryLoc = self.stationaryLocation,
             let currentLoc = self.locationManager.location {
            let distanceFromStationary = currentLoc.distance(from: stationaryLoc)
            withinStationaryRadius = distanceFromStationary <= self.stationaryRadiusMeters
            if !withinStationaryRadius {
              // User walked >50m from parking spot — don't use location check
              // but DON'T reset stationaryLocation (that's still where the car is)
              self.log("User is \(String(format: "%.0f", distanceFromStationary))m from parking spot — location check won't apply")
            }
          }

          if self.speedSaysMoving {
            self.log("Speed check: speed resumed. Cancelling parking check (was a red light).")
            timer.invalidate()
            self.speedZeroTimer = nil
            self.speedZeroStartTime = nil
            self.stationaryLocation = nil
            self.stationaryStartTime = nil
            return
          }

          let zeroDuration = self.speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
          let stationaryDuration = self.stationaryStartTime.map { Date().timeIntervalSince($0) } ?? 0

          if !self.coreMotionSaysAutomotive {
            // CoreMotion agrees user is not in a vehicle.
            // THREE guards prevent false positives at red lights:
            // 1. GPS speed must have been ≈ 0 for at least 15s (red lights rarely have 15s of true zero)
            // 2. CoreMotion must have been non-automotive for at least 8s continuously
            //    (not just a single flicker at the instant the timer fires)
            // 3. GPS speed must currently be < 1.0 m/s (final sanity check)
            let coreMotionStableDuration = self.coreMotionNotAutomotiveSince.map { Date().timeIntervalSince($0) } ?? 0
            let currentSpeedCheck = self.locationManager.location?.speed ?? -1
            let gpsSpeedOk = currentSpeedCheck >= 0 && currentSpeedCheck < 1.0

            if zeroDuration >= self.minZeroSpeedForAgreeSec && coreMotionStableDuration >= self.coreMotionStabilitySec && gpsSpeedOk {
              self.log("Parking confirmed: GPS speed≈0 for \(String(format: "%.0f", zeroDuration))s + CoreMotion non-automotive for \(String(format: "%.0f", coreMotionStableDuration))s + GPS speed \(String(format: "%.1f", currentSpeedCheck)) m/s")
              timer.invalidate()
              self.speedZeroTimer = nil
              self.confirmParking(source: "gps_coremotion_agree")
            } else {
              var waitReasons: [String] = []
              if zeroDuration < self.minZeroSpeedForAgreeSec {
                waitReasons.append("speed≈0 only \(String(format: "%.0f", zeroDuration))s (need \(String(format: "%.0f", self.minZeroSpeedForAgreeSec))s)")
              }
              if coreMotionStableDuration < self.coreMotionStabilitySec {
                waitReasons.append("CoreMotion non-automotive only \(String(format: "%.0f", coreMotionStableDuration))s (need \(String(format: "%.0f", self.coreMotionStabilitySec))s)")
              }
              if !gpsSpeedOk {
                waitReasons.append("GPS speed \(String(format: "%.1f", currentSpeedCheck)) m/s (need < 1.0)")
              }
              self.log("CoreMotion agrees (not automotive) but guards not met: \(waitReasons.joined(separator: ", "))")
            }
          } else if phoneIsStationary && withinStationaryRadius && stationaryDuration >= self.stationaryDurationSec {
            // Phone hasn't moved (speed < 0.5 m/s) AND still within 50m of parking spot for 2+ min.
            // This means the user is sitting in their parked car (not walking away).
            // You don't sit in one spot for 2 minutes at a red light — definitely parked.
            self.log("Parking confirmed: phone stationary within \(self.stationaryRadiusMeters)m for \(String(format: "%.0f", stationaryDuration))s (location-based override)")
            timer.invalidate()
            self.speedZeroTimer = nil
            self.confirmParking(source: "location_stationary")
          } else {
            var reason = "CoreMotion still automotive"
            if !phoneIsStationary { reason += ", phone moving (speed: \(String(format: "%.1f", currentSpeed)) m/s)" }
            if !withinStationaryRadius { reason += ", user walked away from parking spot" }
            self.log("Speed≈0 for \(String(format: "%.0f", zeroDuration))s, stationary for \(String(format: "%.0f", stationaryDuration))s. Waiting... (\(reason))")
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

    // GUARD 1: If we already confirmed parking this session, this is NOT a missed
    // parking event — it's a stale CoreMotion history pattern from the earlier drive.
    // Without this guard, significantLocationChange wakes fire false duplicates
    // 10-30 minutes after the user is already home (the Clybourn bug).
    if hasConfirmedParkingThisSession {
      self.log("checkForMissedParking skipped: already confirmed parking this session")
      hasCheckedForMissedParking = true
      return
    }

    // GUARD 2: Reject cell-tower-only GPS fixes. significantLocationChange often
    // provides ~300-500m accuracy from cell tower triangulation. Using that as
    // the parking location is worse than not recording parking at all.
    if currentLocation.horizontalAccuracy > 100 {
      self.log("checkForMissedParking skipped: GPS accuracy \(String(format: "%.0f", currentLocation.horizontalAccuracy))m too poor (>100m) — likely cell tower fix")
      hasCheckedForMissedParking = true
      return
    }

    // GUARD 3: If we have a confirmed parking location and the current location
    // is within 500m of it, this is the SAME parking event, not a new one.
    if let lastParking = lastConfirmedParkingLocation {
      let distFromLastParking = currentLocation.distance(from: lastParking)
      if distFromLastParking < 500 {
        self.log("checkForMissedParking skipped: \(String(format: "%.0f", distFromLastParking))m from last parking (< 500m) — same spot")
        hasCheckedForMissedParking = true
        return
      }
    }

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

      // If user drove at all and is now stationary, trigger retroactive parking check
      // No duration filter - capture every parking event
      if wasRecentlyDriving && currentlyStationary && automotiveDuration > 0 {
        self.log("RECOVERY: Detected missed parking event. Drove \(String(format: "%.0f", automotiveDuration))s, now stationary. Triggering retroactive check.")

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
        self.log("Recovery check: no missed parking (drove: \(wasRecentlyDriving), stationary: \(currentlyStationary), duration: \(String(format: "%.0f", automotiveDuration))s)")
      }
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    self.log("Location error: \(error.localizedDescription)")
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    self.log("Auth changed: \(status.rawValue)")
    if status == .authorizedWhenInUse {
      manager.requestAlwaysAuthorization()
    }
  }

  // MARK: - Parking Detection Logic

  /// Called when CoreMotion transitions from automotive to stationary/walking.
  /// SIMPLE RULE: automotive → not automotive + GPS speed ≈ 0 = parked.
  /// No duration filters. Every parking event is recorded.
  private func handlePotentialParking(userIsWalking: Bool = false) {
    guard drivingStartTime != nil else {
      self.log("No driving start time - ignoring")
      return
    }

    let drivingDuration = Date().timeIntervalSince(drivingStartTime!)
    self.log("Parking detected after \(String(format: "%.0f", drivingDuration))s driving (walking=\(userIsWalking))")

    if lastStationaryTime == nil {
      lastStationaryTime = Date()
    }

    // 8 second debounce: long enough to survive red light CoreMotion flicker
    // (CoreMotion can briefly report stationary at long red lights when the
    // car is vibration-free), short enough to catch real parking quickly.
    // Previously 3s which was causing false positives at major intersections
    // like Ashland & Fullerton where red lights last 30-90s and CoreMotion
    // briefly flickers to stationary from engine-idle vibration loss.
    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = Timer.scheduledTimer(withTimeInterval: 8.0, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      // Re-check CoreMotion state after the 8s debounce — if it went back to
      // automotive during the wait, this was a red light flicker, not parking.
      if self.coreMotionSaysAutomotive {
        self.log("handlePotentialParking: CoreMotion went back to automotive during 8s debounce — red light flicker, aborting")
        self.lastStationaryTime = nil
        self.locationAtStopStart = nil
        return
      }
      self.confirmParking()
    }
  }

  /// Final parking confirmation
  /// source: "coremotion" (5s after CoreMotion exit), "gps_speed" (speed≈0 + CoreMotion agrees),
  ///         or "gps_speed_override" (15s sustained zero speed, overrides slow CoreMotion)
  private func confirmParking(source: String = "coremotion") {
    guard isDriving, drivingStartTime != nil else {
      self.log("confirmParking(\(source)) skipped: isDriving=\(isDriving), drivingStartTime=\(drivingStartTime != nil)")
      return
    }
    guard isMonitoring else {
      self.log("confirmParking(\(source)) skipped: monitoring stopped")
      return
    }

    // ALWAYS cancel BOTH timers first to prevent double-triggering.
    // Previously only the "other" timer was cancelled, leaving the second
    // timer to fire confirmParking() again after the first already ran.
    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = nil
    speedZeroTimer?.invalidate()
    speedZeroTimer = nil

    // GPS SPEED VETO: If GPS currently shows we're moving, abort — this is a
    // red light or brief CoreMotion flicker, not real parking.
    // The "location_stationary" source bypasses this since it already proved
    // 2+ minutes of zero movement which is definitive.
    if source == "coremotion" || source == "gps_coremotion_agree" {
      let currentSpeed = locationManager.location?.speed ?? -1
      if currentSpeed > 1.0 {
        self.log("confirmParking(\(source)) aborted: GPS speed \(String(format: "%.1f", currentSpeed)) m/s — still moving (red light false positive)")
        lastStationaryTime = nil
        locationAtStopStart = nil
        return
      }
    }

    // If CoreMotion still reports automotive (engine running / vehicle vibrations),
    // abort parking confirmation — UNLESS this is a speed override (15s of zero speed
    // means the engine is off, CoreMotion is just slow to update).
    // Also allow "location_stationary" — if in same spot for 2+ min, that's definitely parking.
    if coreMotionSaysAutomotive && source != "location_stationary" {
      self.log("CoreMotion still says automotive — aborting parking confirmation (source: \(source))")
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }

    self.log("PARKING CONFIRMED (source: \(source))")

    // After first parking, require GPS confirmation to restart driving (prevents CoreMotion flicker)
    hasConfirmedParkingThisSession = true

    // Location priority:
    // 1. locationAtStopStart - captured when CoreMotion first said non-automotive (best)
    // 2. lastDrivingLocation - last GPS while in driving state (very good - includes slow creep)
    // 3. locationManager.location - current GPS (last resort - user may have walked)
    let parkingLocation = locationAtStopStart ?? lastDrivingLocation
    lastConfirmedParkingLocation = parkingLocation ?? locationManager.location
    let currentLocation = locationManager.location

    // Use the parking location's GPS timestamp if available — this is when the car
    // ACTUALLY stopped, not when the confirmation timer fires (which can be 5-13s later).
    // Falls back to the current time if no parking location timestamp is available.
    let parkingTimestamp: Double
    if let loc = parkingLocation {
      parkingTimestamp = loc.timestamp.timeIntervalSince1970 * 1000
      self.log("Using parking location GPS timestamp: \(loc.timestamp) (\(String(format: "%.0f", Date().timeIntervalSince(loc.timestamp)))s ago)")
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
      self.log("Parking at (\(body["locationSource"]!)): \(loc.coordinate.latitude), \(loc.coordinate.longitude) ±\(loc.horizontalAccuracy)m")
    } else if let loc = currentLocation {
      body["latitude"] = loc.coordinate.latitude
      body["longitude"] = loc.coordinate.longitude
      body["accuracy"] = loc.horizontalAccuracy
      body["locationSource"] = "current_fallback"
      self.log("WARNING: Using current location as fallback")
    }

    if let cur = currentLocation, let park = parkingLocation {
      let driftMeters = cur.distance(from: park)
      body["driftFromParkingMeters"] = driftMeters
      self.log("User walked \(String(format: "%.0f", driftMeters))m from car")
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
    stationaryLocation = nil
    stationaryStartTime = nil
    coreMotionNotAutomotiveSince = nil
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
    self.log("Keeping CoreMotion active for departure detection (low power)")
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
