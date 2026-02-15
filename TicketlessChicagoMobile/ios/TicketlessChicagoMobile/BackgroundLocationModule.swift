import Foundation
import CoreLocation
import CoreMotion
import React

@objc(BackgroundLocationModule)
class BackgroundLocationModule: RCTEventEmitter, CLLocationManagerDelegate {

  private let locationManager = CLLocationManager()
  private let activityManager = CMMotionActivityManager()
  private let motionManager = CMMotionManager()  // Accelerometer/gyro for evidence
  private var isMonitoring = false

  // Accelerometer rolling buffer for red light evidence (30s at 10Hz = 300 entries)
  private let accelBufferCapacity = 300
  private let accelUpdateIntervalHz: Double = 10.0
  private var accelBuffer: [(timestamp: Double, x: Double, y: Double, z: Double, gx: Double, gy: Double, gz: Double)] = []
  private var accelBufferLock = NSLock()
  private var isRecordingAccel = false

  // File-based logging for debugging (NSLog doesn't appear in syslog reliably)
  private var logFileHandle: FileHandle?
  private let logFileName = "parking_detection.log"
  private var logFileURL: URL?
  private var decisionLogFileHandle: FileHandle?
  private let decisionLogFileName = "parking_decisions.ndjson"
  private var decisionLogFileURL: URL?
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
    self.logFileURL = logFileURL

    // Create or append to log file
    if !FileManager.default.fileExists(atPath: logFileURL.path) {
      FileManager.default.createFile(atPath: logFileURL.path, contents: nil, attributes: nil)
    }

    logFileHandle = try? FileHandle(forWritingTo: logFileURL)
    logFileHandle?.seekToEndOfFile()

    log("=== Log file opened ===")
    log("Log path: \(logFileURL.path)")
  }

  private func setupDecisionLogFile() {
    let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
    guard let documentsDirectory = paths.first else { return }
    let decisionURL = documentsDirectory.appendingPathComponent(decisionLogFileName)
    self.decisionLogFileURL = decisionURL

    if !FileManager.default.fileExists(atPath: decisionURL.path) {
      FileManager.default.createFile(atPath: decisionURL.path, contents: nil, attributes: nil)
    }

    decisionLogFileHandle = try? FileHandle(forWritingTo: decisionURL)
    decisionLogFileHandle?.seekToEndOfFile()
    log("Decision log path: \(decisionURL.path)")
  }

  private func appendDecisionLogLine(_ line: String) {
    guard let data = (line + "\n").data(using: .utf8) else { return }
    decisionLogFileHandle?.write(data)
    decisionLogFileHandle?.synchronizeFile()
  }

  private func decision(_ event: String, _ details: [String: Any] = [:]) {
    var payload: [String: Any] = details
    payload["event"] = event
    payload["ts"] = Date().timeIntervalSince1970 * 1000
    payload["isDriving"] = isDriving
    payload["coreMotionAutomotive"] = coreMotionSaysAutomotive
    payload["speedSaysMoving"] = speedSaysMoving
    payload["hasConfirmedParkingThisSession"] = hasConfirmedParkingThisSession
    if let loc = locationManager.location {
      payload["curLat"] = loc.coordinate.latitude
      payload["curLng"] = loc.coordinate.longitude
      payload["curAcc"] = loc.horizontalAccuracy
      payload["curSpeed"] = loc.speed
    }

    if let json = try? JSONSerialization.data(withJSONObject: payload, options: []),
       let line = String(data: json, encoding: .utf8) {
      appendDecisionLogLine(line)
      log("[DECISION] \(line)")
    } else {
      log("[DECISION] \(event) serialization_failed")
    }
  }

  private func startLocationWatchdog() {
    locationWatchdogTimer?.invalidate()
    let timer = Timer.scheduledTimer(withTimeInterval: locationWatchdogIntervalSec, repeats: true) { [weak self] _ in
      self?.runLocationWatchdog()
    }
    RunLoop.main.add(timer, forMode: .common)
    locationWatchdogTimer = timer
    self.log("Location watchdog started (\(Int(locationWatchdogIntervalSec))s interval, stale>\(Int(locationCallbackStaleSec))s)")
  }

  private func stopLocationWatchdog() {
    locationWatchdogTimer?.invalidate()
    locationWatchdogTimer = nil
  }

  private func runLocationWatchdog() {
    guard isMonitoring else { return }

    guard let lastCallback = lastLocationCallbackTime else {
      if !continuousGpsActive && (isDriving || coreMotionSaysAutomotive) {
        self.log("WATCHDOG: no location callbacks yet while driving/automotive — starting GPS")
        startContinuousGps()
      }
      return
    }

    let staleFor = Date().timeIntervalSince(lastCallback)
    guard staleFor >= locationCallbackStaleSec else { return }

    if let lastRecovery = lastWatchdogRecoveryTime,
       Date().timeIntervalSince(lastRecovery) < watchdogRecoveryCooldownSec {
      return
    }
    lastWatchdogRecoveryTime = Date()

    self.log("WATCHDOG: location callbacks stale for \(String(format: "%.0f", staleFor))s (isDriving=\(isDriving), automotive=\(coreMotionSaysAutomotive), gpsActive=\(continuousGpsActive), coreMotionActive=\(coreMotionActive)).")

    if !coreMotionActive && CMMotionActivityManager.isActivityAvailable() {
      self.log("WATCHDOG: restarting CoreMotion activity updates")
      startMotionActivityMonitoring()
    }

    if continuousGpsActive || isDriving || coreMotionSaysAutomotive {
      self.log("WATCHDOG: restarting continuous GPS")
      stopContinuousGps()
      startContinuousGps()
      return
    }

    if let currentLoc = locationManager.location {
      self.log("WATCHDOG: running missed-parking recovery check")
      hasCheckedForMissedParking = false
      checkForMissedParking(currentLocation: currentLoc)
    } else {
      self.log("WATCHDOG: no current location available for recovery check")
    }
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
  private var lastLocationCallbackTime: Date? = nil
  private var locationWatchdogTimer: Timer?
  private var lastWatchdogRecoveryTime: Date? = nil
  private var lastMotionDecisionSignature: String? = nil
  private var lastSpeedBucket: String? = nil
  private var coreMotionWalkingSince: Date? = nil
  private var coreMotionStationarySince: Date? = nil

  // UserDefaults keys for persisting critical state across app kills.
  // Without persistence, iOS can kill the app, significantLocationChange wakes it
  // with a fresh instance where all guards are nil/false, and cell-tower GPS
  // creates false parking at wrong addresses (the Clybourn bug).
  private let kLastParkingLatKey = "bg_lastConfirmedParkingLat"
  private let kLastParkingLngKey = "bg_lastConfirmedParkingLng"
  private let kLastParkingAccKey = "bg_lastConfirmedParkingAcc"
  private let kLastParkingTimeKey = "bg_lastConfirmedParkingTime"
  private let kHasConfirmedParkingKey = "bg_hasConfirmedParking"

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
  private var parkingFinalizationTimer: Timer?  // Short post-confirm hold to suppress red-light false positives
  private var parkingFinalizationPending = false
  private var pendingParkingLocation: CLLocation? = nil
  private var queuedParkingBody: [String: Any]? = nil
  private var queuedParkingSource: String? = nil
  private var queuedParkingAt: Date? = nil

  // After parking, require GPS confirmation before restarting driving (prevents CoreMotion flicker)
  private var hasConfirmedParkingThisSession = false

  // CoreMotion stability tracking: prevents false parking at red lights.
  // Tracks when CoreMotion last transitioned FROM automotive to non-automotive.
  // The gps_coremotion_agree path requires CoreMotion to have been non-automotive
  // for at least coreMotionStabilitySec continuously, not just at one timer tick.
  private var coreMotionNotAutomotiveSince: Date? = nil
  private let coreMotionStabilitySec: TimeInterval = 6  // CoreMotion must stay non-automotive for 6s
  private let minZeroSpeedForAgreeSec: TimeInterval = 10  // GPS speed≈0 for 10s before gps_coremotion_agree can fire
  private let minWalkingEvidenceSec: TimeInterval = 4
  private let minZeroSpeedNoWalkingSec: TimeInterval = 20
  private let finalizationCancelSpeedMps: Double = 2.2
  private let queuedParkingGraceSec: TimeInterval = 25
  private let parkingFinalizationHoldSec: TimeInterval = 7
  private let parkingFinalizationMaxDriftMeters: Double = 35
  private let locationCallbackStaleSec: TimeInterval = 90
  private let locationWatchdogIntervalSec: TimeInterval = 20
  private let watchdogRecoveryCooldownSec: TimeInterval = 60


  override init() {
    super.init()
    setupLogFile()
    setupDecisionLogFile()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.allowsBackgroundLocationUpdates = true
    locationManager.pausesLocationUpdatesAutomatically = false
    locationManager.showsBackgroundLocationIndicator = true
    locationManager.distanceFilter = 10 // meters

    // Restore persisted parking state from UserDefaults.
    // This is CRITICAL: without it, iOS killing and re-launching the app
    // resets all Clybourn guards to nil/false, allowing significantLocationChange
    // to create false parking at wrong addresses with cell-tower GPS.
    restorePersistedParkingState()

    // Listen for app resuming from iOS suspension. When iOS suspends the app,
    // CoreMotion callbacks freeze — we can miss entire drive+park cycles.
    // On resume, query CoreMotion history to catch any missed parking.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )

    log("BackgroundLocationModule initialized")
    decision("module_initialized")
  }

  @objc private func appDidBecomeActive() {
    guard isMonitoring else { return }
    guard !isDriving && !coreMotionSaysAutomotive else { return }
    guard hasConfirmedParkingThisSession else { return }

    self.log("App resumed from suspension — checking CoreMotion history for missed parking")
    // Reset the flag so checkForMissedParking can run
    hasCheckedForMissedParking = false
    if let currentLoc = locationManager.location {
      checkForMissedParking(currentLocation: currentLoc)
    }
  }

  /// Persist lastConfirmedParkingLocation + hasConfirmedParkingThisSession to UserDefaults
  private func persistParkingState() {
    let defaults = UserDefaults.standard
    if let loc = lastConfirmedParkingLocation {
      defaults.set(loc.coordinate.latitude, forKey: kLastParkingLatKey)
      defaults.set(loc.coordinate.longitude, forKey: kLastParkingLngKey)
      defaults.set(loc.horizontalAccuracy, forKey: kLastParkingAccKey)
      defaults.set(loc.timestamp.timeIntervalSince1970, forKey: kLastParkingTimeKey)
      self.log("Persisted parking location: \(loc.coordinate.latitude), \(loc.coordinate.longitude) ±\(loc.horizontalAccuracy)m")
    }
    defaults.set(hasConfirmedParkingThisSession, forKey: kHasConfirmedParkingKey)
  }

  /// Restore persisted parking state on cold launch
  private func restorePersistedParkingState() {
    let defaults = UserDefaults.standard
    let lat = defaults.double(forKey: kLastParkingLatKey)
    let lng = defaults.double(forKey: kLastParkingLngKey)

    // UserDefaults.double returns 0 if key doesn't exist; (0,0) is not a valid Chicago location
    if lat != 0 && lng != 0 {
      let acc = defaults.double(forKey: kLastParkingAccKey)
      let time = defaults.double(forKey: kLastParkingTimeKey)
      let timestamp = time > 0 ? Date(timeIntervalSince1970: time) : Date()
      lastConfirmedParkingLocation = CLLocation(
        coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
        altitude: 0,
        horizontalAccuracy: acc > 0 ? acc : 10,
        verticalAccuracy: -1,
        timestamp: timestamp
      )
      self.log("Restored persisted parking location: \(lat), \(lng) ±\(acc)m (age: \(String(format: "%.0f", Date().timeIntervalSince(timestamp)))s)")
    }

    hasConfirmedParkingThisSession = defaults.bool(forKey: kHasConfirmedParkingKey)
    if hasConfirmedParkingThisSession {
      self.log("Restored hasConfirmedParkingThisSession = true from UserDefaults")
    }
  }

  /// Clear persisted parking state (called on stopMonitoring)
  private func clearPersistedParkingState() {
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: kLastParkingLatKey)
    defaults.removeObject(forKey: kLastParkingLngKey)
    defaults.removeObject(forKey: kLastParkingAccKey)
    defaults.removeObject(forKey: kLastParkingTimeKey)
    defaults.removeObject(forKey: kHasConfirmedParkingKey)
    self.log("Cleared persisted parking state from UserDefaults")
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onParkingDetected", "onDrivingStarted", "onLocationUpdate", "onPossibleDriving"]
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
      decision("start_monitoring_skipped_already_active")
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
    decision("start_monitoring_success", [
      "authStatusRaw": locationManager.authorizationStatus.rawValue,
      "coreMotionAvailable": coreMotionAvailable,
    ])
    lastLocationCallbackTime = Date()
    startLocationWatchdog()
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
    decision("stop_monitoring_called")
    locationManager.stopMonitoringSignificantLocationChanges()
    stopContinuousGps()
    stopMotionActivityMonitoring()
    stopAccelerometerRecording()
    stopLocationWatchdog()

    parkingConfirmationTimer?.invalidate()
    parkingConfirmationTimer = nil
    speedZeroTimer?.invalidate()
    speedZeroTimer = nil
    parkingFinalizationTimer?.invalidate()
    parkingFinalizationTimer = nil
    recoveryGpsTimer?.invalidate()
    recoveryGpsTimer = nil
    waitingForAccurateGpsForRecovery = false
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
    parkingFinalizationPending = false
    pendingParkingLocation = nil
    queuedParkingBody = nil
    queuedParkingSource = nil
    queuedParkingAt = nil
    automotiveSessionStart = nil
    lastConfirmedParkingLocation = nil
    hasConfirmedParkingThisSession = false
    coreMotionNotAutomotiveSince = nil
    coreMotionWalkingSince = nil
    coreMotionStationarySince = nil
    lastLocationCallbackTime = nil
    lastWatchdogRecoveryTime = nil
    lastMotionDecisionSignature = nil
    lastSpeedBucket = nil
    clearPersistedParkingState()

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

    if let lastCb = lastLocationCallbackTime {
      result["lastLocationCallbackAgeSec"] = Date().timeIntervalSince(lastCb)
    } else {
      result["lastLocationCallbackAgeSec"] = NSNull()
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

  /// Get debug log path + existence/size for diagnostics.
  @objc func getDebugLogInfo(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let logFileURL = self.logFileURL else {
      resolve([
        "exists": false,
        "path": NSNull(),
        "sizeBytes": 0,
      ])
      return
    }

    let exists = FileManager.default.fileExists(atPath: logFileURL.path)
    var sizeBytes: Int64 = 0
    if exists,
       let attrs = try? FileManager.default.attributesOfItem(atPath: logFileURL.path),
       let size = attrs[.size] as? NSNumber {
      sizeBytes = size.int64Value
    }

    resolve([
      "exists": exists,
      "path": logFileURL.path,
      "sizeBytes": sizeBytes,
    ])
  }

  /// Get the decision log file contents (last N lines).
  @objc func getDecisionLogs(_ lineCount: Int, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
    guard let documentsDirectory = paths.first else {
      resolve("")
      return
    }
    let decisionURL = documentsDirectory.appendingPathComponent(decisionLogFileName)

    guard let content = try? String(contentsOf: decisionURL, encoding: .utf8) else {
      resolve("")
      return
    }

    let lines = content.components(separatedBy: "\n")
    let lastLines = lines.suffix(lineCount > 0 ? lineCount : 200)
    resolve(lastLines.joined(separator: "\n"))
  }

  /// Clear the decision log file.
  @objc func clearDecisionLogs(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
    guard let documentsDirectory = paths.first else {
      resolve(false)
      return
    }
    let decisionURL = documentsDirectory.appendingPathComponent(decisionLogFileName)

    decisionLogFileHandle?.closeFile()
    try? "".write(to: decisionURL, atomically: true, encoding: .utf8)
    decisionLogFileHandle = try? FileHandle(forWritingTo: decisionURL)
    decision("decision_log_cleared")
    resolve(true)
  }

  /// Get decision log path + existence/size for diagnostics.
  @objc func getDecisionLogInfo(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let decisionURL = self.decisionLogFileURL else {
      resolve([
        "exists": false,
        "path": NSNull(),
        "sizeBytes": 0,
      ])
      return
    }

    let exists = FileManager.default.fileExists(atPath: decisionURL.path)
    var sizeBytes: Int64 = 0
    if exists,
       let attrs = try? FileManager.default.attributesOfItem(atPath: decisionURL.path),
       let size = attrs[.size] as? NSNumber {
      sizeBytes = size.int64Value
    }

    resolve([
      "exists": exists,
      "path": decisionURL.path,
      "sizeBytes": sizeBytes,
    ])
  }

  /// Copy decision log to tmp with a timestamped name.
  @objc func exportDecisionLog(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let sourceURL = self.decisionLogFileURL else {
      resolve(NSNull())
      return
    }
    guard FileManager.default.fileExists(atPath: sourceURL.path) else {
      resolve(NSNull())
      return
    }

    let formatter = DateFormatter()
    formatter.dateFormat = "yyyyMMdd_HHmmss"
    let stamp = formatter.string(from: Date())
    let destURL = FileManager.default.temporaryDirectory.appendingPathComponent("parking_decisions_\(stamp).ndjson")

    do {
      if FileManager.default.fileExists(atPath: destURL.path) {
        try FileManager.default.removeItem(at: destURL)
      }
      try FileManager.default.copyItem(at: sourceURL, to: destURL)
      resolve(destURL.path)
    } catch {
      reject("EXPORT_DECISION_LOG_FAILED", "Failed to export decision log: \(error.localizedDescription)", error)
    }
  }

  /// Copy debug log to tmp with a timestamped name so tooling can pull it easily.
  @objc func exportDebugLog(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let sourceURL = self.logFileURL else {
      resolve(NSNull())
      return
    }
    guard FileManager.default.fileExists(atPath: sourceURL.path) else {
      resolve(NSNull())
      return
    }

    let formatter = DateFormatter()
    formatter.dateFormat = "yyyyMMdd_HHmmss"
    let stamp = formatter.string(from: Date())
    let destURL = FileManager.default.temporaryDirectory.appendingPathComponent("parking_detection_\(stamp).log")

    do {
      if FileManager.default.fileExists(atPath: destURL.path) {
        try FileManager.default.removeItem(at: destURL)
      }
      try FileManager.default.copyItem(at: sourceURL, to: destURL)
      resolve(destURL.path)
    } catch {
      reject("EXPORT_LOG_FAILED", "Failed to export debug log: \(error.localizedDescription)", error)
    }
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

  // MARK: - Accelerometer: Evidence Recording

  /// Start recording accelerometer + gyro data into a rolling buffer.
  /// Uses the M-series coprocessor — near-zero battery impact.
  /// Called when driving starts; data is retrieved by JS for red light receipts.
  private func startAccelerometerRecording() {
    guard !isRecordingAccel else { return }
    guard motionManager.isDeviceMotionAvailable else {
      self.log("Device motion not available — skipping accelerometer recording")
      return
    }

    motionManager.deviceMotionUpdateInterval = 1.0 / accelUpdateIntervalHz
    let queue = OperationQueue()
    queue.name = "com.ticketless.accelerometer"
    queue.maxConcurrentOperationCount = 1

    motionManager.startDeviceMotionUpdates(to: queue) { [weak self] motion, error in
      guard let self = self, let motion = motion else { return }

      let entry = (
        timestamp: motion.timestamp,
        x: motion.userAcceleration.x,
        y: motion.userAcceleration.y,
        z: motion.userAcceleration.z,
        gx: motion.gravity.x,
        gy: motion.gravity.y,
        gz: motion.gravity.z
      )

      self.accelBufferLock.lock()
      self.accelBuffer.append(entry)
      if self.accelBuffer.count > self.accelBufferCapacity {
        self.accelBuffer.removeFirst(self.accelBuffer.count - self.accelBufferCapacity)
      }
      self.accelBufferLock.unlock()
    }

    isRecordingAccel = true
    self.log("Accelerometer recording started (\(Int(accelUpdateIntervalHz))Hz, \(accelBufferCapacity/Int(accelUpdateIntervalHz))s buffer)")
  }

  /// Stop accelerometer recording. Called when driving stops.
  private func stopAccelerometerRecording() {
    guard isRecordingAccel else { return }
    motionManager.stopDeviceMotionUpdates()
    isRecordingAccel = false
    self.log("Accelerometer recording stopped")
  }

  /// Bridge method: JS calls this to retrieve the last N seconds of accelerometer data.
  /// Returns an array of {timestamp, x, y, z, gx, gy, gz} objects.
  @objc func getRecentAccelerometerData(_ seconds: Double, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    accelBufferLock.lock()
    let buffer = self.accelBuffer
    accelBufferLock.unlock()

    guard !buffer.isEmpty else {
      resolve([])
      return
    }

    let cutoff = buffer.last!.timestamp - seconds
    let filtered = buffer.filter { $0.timestamp >= cutoff }

    let result: [[String: Any]] = filtered.map { entry in
      [
        "timestamp": entry.timestamp,
        "x": round(entry.x * 10000) / 10000,
        "y": round(entry.y * 10000) / 10000,
        "z": round(entry.z * 10000) / 10000,
        "gx": round(entry.gx * 10000) / 10000,
        "gy": round(entry.gy * 10000) / 10000,
        "gz": round(entry.gz * 10000) / 10000,
      ]
    }

    resolve(result)
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
      let motionSig = "\(activity.automotive)-\(activity.stationary)-\(activity.walking)-\(self.confidenceString(activity.confidence))"
      if self.lastMotionDecisionSignature != motionSig {
        self.lastMotionDecisionSignature = motionSig
        self.decision("coremotion_transition", [
          "automotive": activity.automotive,
          "stationary": activity.stationary,
          "walking": activity.walking,
          "confidence": self.confidenceString(activity.confidence),
        ])
      }

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
        self.coreMotionWalkingSince = nil
        self.coreMotionStationarySince = nil

        // GPS SPEED VETO: If GPS says speed ≈ 0, do NOT cancel parking timers.
        // CoreMotion can flicker back to "automotive" from phone vibration/movement
        // while the user is walking away from a parked car. GPS speed is ground truth.
        // Only cancel parking timers if GPS confirms we're actually moving.
        if self.speedSaysMoving {
          // GPS confirms movement — cancel parking timers, we're still driving
          self.cancelPendingParkingFinalization(reason: "CoreMotion+GPS indicate movement")
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
                // Emit onPossibleDriving so camera alerts can start immediately
                // while we wait for GPS to confirm driving. This closes the gap
                // where the user passes nearby cameras during the GPS cold start.
                self.sendEvent(withName: "onPossibleDriving", body: [
                  "timestamp": Date().timeIntervalSince1970 * 1000,
                  "source": "coremotion_pre_gps",
                ])
                self.log("Emitted onPossibleDriving — camera alerts should start now")
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
          // Start recording accelerometer data for red light evidence
          self.startAccelerometerRecording()

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
        if activity.walking {
          if self.coreMotionWalkingSince == nil { self.coreMotionWalkingSince = Date() }
          self.coreMotionStationarySince = nil
        } else if activity.stationary {
          if self.coreMotionStationarySince == nil { self.coreMotionStationarySince = Date() }
          self.coreMotionWalkingSince = nil
        } else {
          self.coreMotionWalkingSince = nil
          self.coreMotionStationarySince = nil
        }

        // Track when CoreMotion first became non-automotive (for stability check).
        // Only set the timestamp on the TRANSITION, not on every update.
        if wasAutomotive && self.coreMotionNotAutomotiveSince == nil {
          self.coreMotionNotAutomotiveSince = Date()
          self.log("CoreMotion stability: transitioned to non-automotive, tracking stability timer")
        }

        if self.isDriving && wasAutomotive {
          // User was driving and has now exited the vehicle.
          // Snapshot the location RIGHT NOW - this is the parking spot.
          if let stopCandidate = self.lastDrivingLocation ?? self.locationManager.location {
            self.updateStopLocationCandidate(stopCandidate, reason: "coremotion_exit")
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

          // GPS speed veto: if GPS says we're moving, user is still driving.
          let gpsStillMoving = currentSpeed > 1.0

          // Flicker filter: BOTH must be true for flicker rejection.
          // A real drive passes if EITHER duration > 15s OR distance > 100m.
          // This was the working logic from Feb 8. The stricter version
          // (OR + 30s/200m) was blocking real short drives.
          let isLikelyFlicker = automotiveDuration < 15 && distFromLastParking < 100
          self.log("SHORT DRIVE RECOVERY check: automotiveDuration=\(String(format: "%.0f", automotiveDuration))s, distFromLastParking=\(String(format: "%.0f", distFromLastParking))m, gpsSpeed=\(String(format: "%.1f", currentSpeed))m/s, gpsStillMoving=\(gpsStillMoving), isFlicker=\(isLikelyFlicker)")

          if gpsStillMoving {
            self.log("SHORT DRIVE RECOVERY: GPS speed \(String(format: "%.1f", currentSpeed)) m/s > 1.0 — still driving, skipping")
          } else if isLikelyFlicker {
            self.log("SHORT DRIVE RECOVERY: automotive \(String(format: "%.0f", automotiveDuration))s (< 15s) AND dist \(String(format: "%.0f", distFromLastParking))m (< 100m) — likely flicker, skipping")
          } else {
            self.log("SHORT DRIVE RECOVERY: CoreMotion automotive→\(activity.stationary ? "stationary" : "walking") but isDriving was false. Recovering departure event only.")

            // Fire departure event first so previous parking gets a departure time.
            // Use the automotive session start time (when CoreMotion first said automotive)
            // instead of current time — the user started driving then, not now.
            let departureTimestamp = (self.automotiveSessionStart?.timeIntervalSince1970 ?? Date().timeIntervalSince1970) * 1000
            self.sendEvent(withName: "onDrivingStarted", body: [
              "timestamp": departureTimestamp,
              "source": "short_drive_recovery",
            ])

            // Do NOT emit a synthetic parking event here.
            // This path can fire at long signal stops and create false positives.
            // We only recover departure here; real parking should come from the
            // normal confirmParking path with stronger evidence.
            self.log("SHORT DRIVE RECOVERY: departure recovered, skipping synthetic onParkingDetected")

            // Clean up driving state (without declaring a new parking confirmation)
            self.lastConfirmedParkingLocation = nil
            self.hasConfirmedParkingThisSession = false
            self.hasCheckedForMissedParking = false      // Allow recovery check on next drive
            self.persistParkingState()  // Survive app kills (Clybourn bug fix)
            self.stopContinuousGps()
            self.lastDrivingLocation = nil
            self.locationAtStopStart = nil
            self.speedSaysMoving = false
            self.speedZeroStartTime = nil
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
    lastLocationCallbackTime = Date()
    let speed = location.speed  // m/s, -1 if unknown
    let speedBucket: String = {
      if speed < 0 { return "unknown" }
      if speed <= 0.5 { return "zeroish" }
      if speed <= minDrivingSpeedMps { return "slow" }
      return "moving"
    }()
    if speedBucket != lastSpeedBucket {
      lastSpeedBucket = speedBucket
      decision("speed_bucket_change", [
        "bucket": speedBucket,
        "speed": speed,
        "accuracy": location.horizontalAccuracy,
      ])
    }
    evaluateQueuedParkingCandidate()

    // --- Recovery GPS: waiting for accurate fix after significantLocationChange wake ---
    // checkForMissedParking starts GPS and sets this flag. We wait here for a
    // satellite fix (≤50m) instead of using the cell-tower location that woke us.
    if waitingForAccurateGpsForRecovery {
      handleRecoveryGpsFix(location)
      return  // Don't process this location through the normal driving pipeline
    }

    // --- Recovery: app was killed/suspended and woken by significantLocationChange ---
    // If we're not tracking driving but we just got a location update,
    // check if CoreMotion says we recently drove and are now stopped.
    // This catches both:
    //   1. App killed by iOS → cold restart → CoreMotion not active
    //   2. App suspended by iOS → CoreMotion "active" but callbacks were frozen
    if !isDriving && !coreMotionSaysAutomotive && isMonitoring {
      // Restart CoreMotion if it was stopped after parking.
      // significantLocationChange fired, meaning user moved ~100-500m,
      // so they may be starting a new drive.
      if !coreMotionActive && CMMotionActivityManager.isActivityAvailable() {
        self.log("significantLocationChange woke us — restarting CoreMotion")
        startMotionActivityMonitoring()
      }
      // Always check for missed parking, even if CoreMotion is "active".
      // When iOS suspends the app, CoreMotion callbacks freeze — the M-chip
      // continues recording but our callback never fires. On wake, we must
      // query CoreMotion history to find any drive+park that happened while
      // we were suspended.
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
      cancelPendingParkingFinalization(reason: "GPS speed resumed above driving threshold")
      if queuedParkingAt != nil {
        decision("parking_candidate_queue_cleared", ["reason": "driving_resumed"])
        queuedParkingAt = nil
        queuedParkingBody = nil
        queuedParkingSource = nil
      }

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
      if isDriving {
        updateStopLocationCandidate(lastDrivingLocation ?? location, reason: "gps_zero_speed")
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
            // Require sustained zero speed + stable non-automotive state to
            // reduce red-light false positives while still confirming quickly.
            let coreMotionStableDuration = self.coreMotionNotAutomotiveSince.map { Date().timeIntervalSince($0) } ?? zeroDuration
            let walkingEvidenceSec = self.coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
            let hasWalkingEvidence = walkingEvidenceSec >= self.minWalkingEvidenceSec
            let longNoWalkingStop = zeroDuration >= self.minZeroSpeedNoWalkingSec
            let currentSpeedCheck = self.locationManager.location?.speed ?? -1
            let gpsSpeedOk = currentSpeedCheck >= 0 && currentSpeedCheck < 1.0

            if zeroDuration >= self.minZeroSpeedForAgreeSec &&
               coreMotionStableDuration >= self.coreMotionStabilitySec &&
               gpsSpeedOk &&
               (hasWalkingEvidence || longNoWalkingStop) {
              self.log("Parking confirmed: GPS speed≈0 for \(String(format: "%.0f", zeroDuration))s + CoreMotion non-automotive for \(String(format: "%.0f", coreMotionStableDuration))s + GPS speed \(String(format: "%.1f", currentSpeedCheck)) m/s")
              self.decision("gps_coremotion_gate_passed", [
                "zeroDurationSec": zeroDuration,
                "coreMotionStableSec": coreMotionStableDuration,
                "gpsSpeed": currentSpeedCheck,
                "walkingEvidenceSec": walkingEvidenceSec,
                "hasWalkingEvidence": hasWalkingEvidence,
                "longNoWalkingStop": longNoWalkingStop,
              ])
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
              if !hasWalkingEvidence && !longNoWalkingStop {
                waitReasons.append("no walking evidence yet (\(String(format: "%.0f", walkingEvidenceSec))s) and stop<\(String(format: "%.0f", self.minZeroSpeedNoWalkingSec))s")
              }
              self.log("CoreMotion agrees (not automotive) but guards not met: \(waitReasons.joined(separator: ", "))")
              self.decision("gps_coremotion_gate_wait", [
                "zeroDurationSec": zeroDuration,
                "coreMotionStableSec": coreMotionStableDuration,
                "gpsSpeed": currentSpeedCheck,
                "walkingEvidenceSec": walkingEvidenceSec,
                "hasWalkingEvidence": hasWalkingEvidence,
                "longNoWalkingStop": longNoWalkingStop,
                "reasons": waitReasons.joined(separator: "; "),
              ])
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
  private var waitingForAccurateGpsForRecovery = false  // true while we spin up GPS for an accurate fix
  private var recoveryDrivingDuration: TimeInterval = 0 // stash the driving duration from CoreMotion query
  private var recoveryGpsTimer: Timer? = nil             // timeout for GPS acquisition

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
      var wasRecentlyDriving = false
      var automotiveDuration: TimeInterval = 0
      var firstAutomotiveStart: Date? = nil  // When driving actually began

      for i in 0..<activities.count {
        let activity = activities[i]
        if activity.automotive {
          wasRecentlyDriving = true
          if firstAutomotiveStart == nil {
            firstAutomotiveStart = activity.startDate
          }
          if i + 1 < activities.count {
            automotiveDuration += activities[i + 1].startDate.timeIntervalSince(activity.startDate)
          }
        }
      }

      // Check if the most recent activity is stationary/walking
      guard let lastActivity = activities.last else { return }
      let currentlyStationary = lastActivity.stationary || lastActivity.walking

      if wasRecentlyDriving && currentlyStationary && automotiveDuration > 0 {
        self.log("RECOVERY: CoreMotion says user drove \(String(format: "%.0f", automotiveDuration))s and is now stationary. Requesting accurate GPS before emitting parking event.")

        // Emit onDrivingStarted so JS records the departure from the previous parking spot.
        // Use the actual automotive start time from CoreMotion history for accurate departure tracking.
        let departureTimestamp = (firstAutomotiveStart?.timeIntervalSince1970 ?? Date().timeIntervalSince1970) * 1000
        self.sendEvent(withName: "onDrivingStarted", body: [
          "timestamp": departureTimestamp,
          "source": "recovery_coremotion_history",
        ])
        self.log("RECOVERY: onDrivingStarted fired (departure from previous parking)")

        // DON'T use the significantLocationChange cell-tower fix as the parking
        // location. That's how the Clybourn bug happens — 300-500m off.
        // Instead, start high-accuracy GPS and wait for a real satellite fix.
        self.recoveryDrivingDuration = automotiveDuration
        self.waitingForAccurateGpsForRecovery = true
        self.startContinuousGps()

        // Safety timeout: if GPS doesn't deliver an accurate fix within 15s,
        // give up rather than emit bad coordinates. The user is already parked;
        // the NEXT normal parking detection will catch them on the next drive.
        self.recoveryGpsTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: false) { [weak self] _ in
          guard let self = self, self.waitingForAccurateGpsForRecovery else { return }
          self.waitingForAccurateGpsForRecovery = false
          self.stopContinuousGps()
          self.log("RECOVERY: GPS timeout — no accurate fix in 15s. Skipping recovery parking to avoid wrong address.")
        }
      } else {
        self.log("Recovery check: no missed parking (drove: \(wasRecentlyDriving), stationary: \(currentlyStationary), duration: \(String(format: "%.0f", automotiveDuration))s)")
      }

      // Force-restart CoreMotion monitoring after wake from suspension.
      // When iOS suspends the app, CoreMotion is technically "active" but
      // callbacks are frozen. Force a stop+start cycle to get fresh callbacks.
      if self.coreMotionActive {
        self.activityManager.stopActivityUpdates()
        self.coreMotionActive = false
        self.log("Force-stopped stale CoreMotion session after recovery wake")
      }
      self.startMotionActivityMonitoring()
    }
  }

  /// Called from didUpdateLocations when waitingForAccurateGpsForRecovery is true.
  /// Waits for a GPS fix with ≤50m accuracy, then emits onParkingDetected with that location.
  private func handleRecoveryGpsFix(_ location: CLLocation) {
    guard waitingForAccurateGpsForRecovery else { return }

    if location.horizontalAccuracy > 50 {
      self.log("RECOVERY: GPS fix \(location.horizontalAccuracy)m accuracy — waiting for ≤50m")
      return
    }

    // Got an accurate fix. Cancel timeout and emit the parking event.
    waitingForAccurateGpsForRecovery = false
    recoveryGpsTimer?.invalidate()
    recoveryGpsTimer = nil
    stopContinuousGps()

    self.log("RECOVERY: Accurate GPS fix: \(location.coordinate.latitude), \(location.coordinate.longitude) ±\(location.horizontalAccuracy)m — emitting parking event")

    let body: [String: Any] = [
      "timestamp": Date().timeIntervalSince1970 * 1000,
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "accuracy": location.horizontalAccuracy,
      "locationSource": "recovery_accurate_gps",
      "drivingDurationSec": recoveryDrivingDuration,
    ]

    lastConfirmedParkingLocation = location
    hasConfirmedParkingThisSession = true
    hasCheckedForMissedParking = false  // Allow recovery check on next drive
    persistParkingState()

    sendEvent(withName: "onParkingDetected", body: body)
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
      decision("confirm_parking_skipped_not_driving", ["source": source])
      return
    }
    guard isMonitoring else {
      self.log("confirmParking(\(source)) skipped: monitoring stopped")
      decision("confirm_parking_skipped_not_monitoring", ["source": source])
      return
    }
    guard !parkingFinalizationPending else {
      self.log("confirmParking(\(source)) skipped: finalization already pending")
      decision("confirm_parking_skipped_finalization_pending", ["source": source])
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
    // Also allow "location_stationary" — if in same spot for 2+ min, that's definitely parking.
    if coreMotionSaysAutomotive && source != "location_stationary" {
      self.log("CoreMotion still says automotive — aborting parking confirmation (source: \(source))")
      decision("confirm_parking_aborted_automotive", ["source": source])
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }

    self.log("PARKING CANDIDATE READY (source: \(source)) — holding \(String(format: "%.0f", parkingFinalizationHoldSec))s for stability")

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

    let confirmationBody = body
    let candidateLocation = parkingLocation

    parkingFinalizationPending = true
    pendingParkingLocation = candidateLocation
    decision("parking_candidate_ready", [
      "source": source,
      "holdSec": parkingFinalizationHoldSec,
      "locationSource": body["locationSource"] as? String ?? "unknown",
      "accuracy": body["accuracy"] as? Double ?? -1,
      "drivingDurationSec": body["drivingDurationSec"] as? Double ?? -1,
      "walkingEvidenceSec": self.coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0,
    ])
    parkingFinalizationTimer?.invalidate()
    parkingFinalizationTimer = Timer.scheduledTimer(withTimeInterval: parkingFinalizationHoldSec, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      self.parkingFinalizationTimer = nil

      if self.coreMotionSaysAutomotive {
        self.cancelPendingParkingFinalization(reason: "CoreMotion returned to automotive during finalization hold")
        return
      }

      let currentSpeed = self.locationManager.location?.speed ?? -1
      let walkingEvidenceSec = self.coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
      let hasWalkingEvidence = walkingEvidenceSec >= self.minWalkingEvidenceSec
      if !hasWalkingEvidence && currentSpeed >= self.finalizationCancelSpeedMps {
        self.queueParkingCandidateForRetry(
          body: confirmationBody,
          source: source,
          reason: "finalization_speed_without_walking"
        )
        self.cancelPendingParkingFinalization(reason: "GPS speed \(String(format: "%.1f", currentSpeed)) m/s during finalization hold (no walking evidence)")
        return
      }

      if let pending = self.pendingParkingLocation, let current = self.locationManager.location {
        let drift = current.distance(from: pending)
        if drift > self.parkingFinalizationMaxDriftMeters {
          self.cancelPendingParkingFinalization(reason: "Moved \(String(format: "%.0f", drift))m during finalization hold")
          return
        }
      }

      self.finalizeParkingConfirmation(body: confirmationBody, source: source)
    }
  }

  // MARK: - Helpers

  private func queueParkingCandidateForRetry(body: [String: Any], source: String, reason: String) {
    queuedParkingBody = body
    queuedParkingSource = source
    queuedParkingAt = Date()
    decision("parking_candidate_queued", [
      "source": source,
      "reason": reason,
      "graceSec": queuedParkingGraceSec,
      "locationSource": body["locationSource"] as? String ?? "unknown",
    ])
  }

  private func evaluateQueuedParkingCandidate() {
    guard let queuedAt = queuedParkingAt, let body = queuedParkingBody, let source = queuedParkingSource else { return }
    let age = Date().timeIntervalSince(queuedAt)
    if age > queuedParkingGraceSec {
      decision("parking_candidate_queue_expired", [
        "source": source,
        "ageSec": age,
      ])
      queuedParkingAt = nil
      queuedParkingBody = nil
      queuedParkingSource = nil
      return
    }
    guard isDriving && !parkingFinalizationPending else { return }
    guard !coreMotionSaysAutomotive else { return }

    let walkingEvidenceSec = coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
    let hasWalkingEvidence = walkingEvidenceSec >= minWalkingEvidenceSec
    let currentSpeed = locationManager.location?.speed ?? -1
    guard hasWalkingEvidence && currentSpeed >= 0 && currentSpeed < 1.3 else { return }

    decision("parking_candidate_queue_recovered", [
      "source": source,
      "ageSec": age,
      "walkingEvidenceSec": walkingEvidenceSec,
      "currentSpeed": currentSpeed,
    ])
    queuedParkingAt = nil
    queuedParkingBody = nil
    queuedParkingSource = nil
    finalizeParkingConfirmation(body: body, source: "\(source)_queued_retry")
  }

  private func updateStopLocationCandidate(_ candidate: CLLocation, reason: String) {
    guard isDriving else { return }
    guard candidate.horizontalAccuracy > 0 && candidate.horizontalAccuracy <= 100 else { return }

    if let existing = locationAtStopStart {
      let movedMeters = existing.distance(from: candidate)
      let isNewer = candidate.timestamp.timeIntervalSince(existing.timestamp) >= 1
      let isMeaningfullyMoreAccurate = candidate.horizontalAccuracy < (existing.horizontalAccuracy - 10)
      if !isNewer && !isMeaningfullyMoreAccurate && movedMeters < 8 {
        return
      }
      self.log("Stop candidate refined (\(reason)): moved \(String(format: "%.0f", movedMeters))m, acc \(String(format: "%.0f", existing.horizontalAccuracy))→\(String(format: "%.0f", candidate.horizontalAccuracy))m")
      decision("stop_candidate_refined", [
        "reason": reason,
        "movedMeters": movedMeters,
        "prevAcc": existing.horizontalAccuracy,
        "newAcc": candidate.horizontalAccuracy,
      ])
    } else {
      self.log("Stop candidate captured (\(reason)): \(candidate.coordinate.latitude), \(candidate.coordinate.longitude) ±\(candidate.horizontalAccuracy)m")
      decision("stop_candidate_captured", [
        "reason": reason,
        "lat": candidate.coordinate.latitude,
        "lng": candidate.coordinate.longitude,
        "acc": candidate.horizontalAccuracy,
      ])
    }

    locationAtStopStart = candidate
  }

  private func cancelPendingParkingFinalization(reason: String) {
    guard parkingFinalizationPending || parkingFinalizationTimer != nil else { return }
    self.log("Parking finalization cancelled: \(reason)")
    decision("parking_finalization_cancelled", ["reason": reason])
    parkingFinalizationTimer?.invalidate()
    parkingFinalizationTimer = nil
    parkingFinalizationPending = false
    pendingParkingLocation = nil
  }

  private func finalizeParkingConfirmation(body: [String: Any], source: String) {
    let finalizedLocation = pendingParkingLocation ?? locationManager.location
    parkingFinalizationPending = false
    pendingParkingLocation = nil
    self.log("PARKING CONFIRMED (source: \(source))")
    decision("parking_confirmed", [
      "source": source,
      "locationSource": body["locationSource"] as? String ?? "unknown",
      "accuracy": body["accuracy"] as? Double ?? -1,
      "drivingDurationSec": body["drivingDurationSec"] as? Double ?? -1,
      "timestamp": body["timestamp"] as? Double ?? -1,
    ])

    // After first confirmed parking, require GPS confirmation to restart driving
    // (prevents CoreMotion flicker from immediately re-entering driving state).
    hasConfirmedParkingThisSession = true
    lastConfirmedParkingLocation = finalizedLocation
    persistParkingState()  // Survive app kills (Clybourn bug fix)

    var payload = body
    payload["detectionSource"] = source
    sendEvent(withName: "onParkingDetected", body: payload)

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
    coreMotionWalkingSince = nil
    coreMotionStationarySince = nil
    queuedParkingBody = nil
    queuedParkingSource = nil
    queuedParkingAt = nil
    // Reset recovery flag so the NEXT drive can be recovered if app is suspended.
    // Without this, the first significantLocationChange wake-up sets this true
    // and all subsequent recovery checks are permanently blocked.
    hasCheckedForMissedParking = false
    // lastDrivingLocation intentionally kept after parking - it's the parking spot reference.
    // It gets cleared when the NEXT drive starts (see isDriving=true transitions).

    // Stop continuous GPS to save battery - back to significantChanges only
    stopContinuousGps()
    // Stop accelerometer recording (not needed while parked)
    stopAccelerometerRecording()

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

  private func confidenceString(_ confidence: CMMotionActivityConfidence) -> String {
    switch confidence {
    case .low: return "low"
    case .medium: return "medium"
    case .high: return "high"
    @unknown default: return "unknown"
    }
  }
}
