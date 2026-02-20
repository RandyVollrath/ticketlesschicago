import Foundation
import CoreLocation
import CoreMotion
import AVFoundation
import UIKit
import UserNotifications
import React

@objc(BackgroundLocationModule)
class BackgroundLocationModule: RCTEventEmitter, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {

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
  private var logWritesSinceRotateCheck = 0
  private var decisionWritesSinceRotateCheck = 0
  private let logRotateCheckEveryWrites = 200
  private let logMaxBytes: Int64 = 8 * 1024 * 1024
  private let decisionLogMaxBytes: Int64 = 12 * 1024 * 1024
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
      maybeRotateDebugLog()
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

  private func maybeRotateDebugLog() {
    logWritesSinceRotateCheck += 1
    if logWritesSinceRotateCheck < logRotateCheckEveryWrites { return }
    logWritesSinceRotateCheck = 0
    guard let logURL = logFileURL else { return }
    guard FileManager.default.fileExists(atPath: logURL.path) else { return }
    guard
      let attrs = try? FileManager.default.attributesOfItem(atPath: logURL.path),
      let size = attrs[.size] as? NSNumber,
      size.int64Value > logMaxBytes
    else { return }

    let backupURL = logURL.deletingLastPathComponent().appendingPathComponent("\(logFileName).prev")
    do {
      logFileHandle?.closeFile()
      if FileManager.default.fileExists(atPath: backupURL.path) {
        try FileManager.default.removeItem(at: backupURL)
      }
      try FileManager.default.moveItem(at: logURL, to: backupURL)
      FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: nil)
      logFileHandle = try? FileHandle(forWritingTo: logURL)
      logFileHandle?.seekToEndOfFile()
      let ts = dateFormatter.string(from: Date())
      let line = "[\(ts)] LOG_ROTATED previous=\(backupURL.lastPathComponent) maxBytes=\(logMaxBytes)\n"
      if let data = line.data(using: .utf8) {
        logFileHandle?.write(data)
        logFileHandle?.synchronizeFile()
      }
      NSLog("[BackgroundLocation] Debug log rotated (%lld bytes max)", logMaxBytes)
    } catch {
      NSLog("[BackgroundLocation] Debug log rotation failed: %@", error.localizedDescription)
    }
  }

  private func maybeRotateDecisionLog() {
    decisionWritesSinceRotateCheck += 1
    if decisionWritesSinceRotateCheck < logRotateCheckEveryWrites { return }
    decisionWritesSinceRotateCheck = 0
    guard let decisionURL = decisionLogFileURL else { return }
    guard FileManager.default.fileExists(atPath: decisionURL.path) else { return }
    guard
      let attrs = try? FileManager.default.attributesOfItem(atPath: decisionURL.path),
      let size = attrs[.size] as? NSNumber,
      size.int64Value > decisionLogMaxBytes
    else { return }

    let backupURL = decisionURL.deletingLastPathComponent().appendingPathComponent("\(decisionLogFileName).prev")
    do {
      decisionLogFileHandle?.closeFile()
      if FileManager.default.fileExists(atPath: backupURL.path) {
        try FileManager.default.removeItem(at: backupURL)
      }
      try FileManager.default.moveItem(at: decisionURL, to: backupURL)
      FileManager.default.createFile(atPath: decisionURL.path, contents: nil, attributes: nil)
      decisionLogFileHandle = try? FileHandle(forWritingTo: decisionURL)
      decisionLogFileHandle?.seekToEndOfFile()
      let evt = "{\"event\":\"decision_log_rotated\",\"ts\":\(Date().timeIntervalSince1970 * 1000),\"previous\":\"\(backupURL.lastPathComponent)\",\"maxBytes\":\(decisionLogMaxBytes)}\n"
      if let data = evt.data(using: .utf8) {
        decisionLogFileHandle?.write(data)
        decisionLogFileHandle?.synchronizeFile()
      }
      NSLog("[BackgroundLocation] Decision log rotated (%lld bytes max)", decisionLogMaxBytes)
    } catch {
      NSLog("[BackgroundLocation] Decision log rotation failed: %@", error.localizedDescription)
    }
  }

  private func appendDecisionLogLine(_ line: String) {
    guard let data = (line + "\n").data(using: .utf8) else { return }
    decisionLogFileHandle?.write(data)
    decisionLogFileHandle?.synchronizeFile()
    maybeRotateDecisionLog()
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

  private func beginTripSummary(source: String, departureTimestampMs: Double) {
    if tripSummaryId != nil {
      emitTripSummary(outcome: "park_missed_possible")
    }
    let now = Date()
    tripSummaryId = UUID().uuidString
    tripSummaryStart = now
    tripSummaryDepartureMs = departureTimestampMs
    tripSummaryStartSource = source
    tripSummaryAutomotiveUpdates = 0
    tripSummaryNonAutomotiveUpdates = 0
    tripSummaryUnknownUpdates = 0
    tripSummaryAutomotiveDurationSec = 0
    tripSummaryNonAutomotiveDurationSec = 0
    tripSummaryUnknownDurationSec = 0
    tripSummaryGateWaitCount = 0
    tripSummaryGatePassCount = 0
    tripSummaryUnknownFallbackPassCount = 0
    tripSummaryGpsZeroSamples = 0
    tripSummaryGpsMovingSamples = 0
    tripSummaryMaxSpeedMps = 0
    tripSummaryFinalizationCancelledCount = 0
    tripSummaryCameraAlertCount = 0
    tripSummaryWatchdogRecoveries = 0
    tripSummaryFinalizationCancelledAutomotive = 0
    tripSummaryFinalizationCancelledSpeed = 0
    tripSummaryFinalizationCancelledDrift = 0
    tripSummaryHotspotBlockedCount = 0
    tripSummaryLockoutBlockedCount = 0
    tripSummaryCameraRejectSpeedLow = 0
    tripSummaryCameraRejectRadius = 0
    tripSummaryCameraRejectHeading = 0
    tripSummaryCameraRejectAhead = 0
    tripSummaryCameraRejectDedupe = 0
    tripSummaryLowConfidenceBlockedCount = 0
    tripSummaryStaleLocationBlockedCount = 0
    tripLastMotionState = nil
    tripLastMotionAt = nil
    decision("trip_summary_started", [
      "tripId": tripSummaryId ?? "",
      "source": source,
      "departureTs": departureTimestampMs,
      "carAudioConnected": carAudioConnected,
    ])
  }

  private func trackTripMotionState(_ state: String, countUpdate: Bool = true) {
    guard tripSummaryId != nil else { return }
    let now = Date()

    if let prevState = tripLastMotionState, let prevAt = tripLastMotionAt {
      let elapsed = max(0, min(120, now.timeIntervalSince(prevAt)))
      if prevState == "automotive" {
        tripSummaryAutomotiveDurationSec += elapsed
      } else if prevState == "non_automotive" {
        tripSummaryNonAutomotiveDurationSec += elapsed
      } else if prevState == "unknown" {
        tripSummaryUnknownDurationSec += elapsed
      }
    }

    if countUpdate {
      if state == "automotive" {
        tripSummaryAutomotiveUpdates += 1
      } else if state == "non_automotive" {
        tripSummaryNonAutomotiveUpdates += 1
      } else if state == "unknown" {
        tripSummaryUnknownUpdates += 1
      }
    }

    tripLastMotionState = state
    tripLastMotionAt = now
  }

  private func emitTripSummary(outcome: String, parkingSource: String? = nil) {
    guard let tripId = tripSummaryId else { return }

    // Flush trailing motion-state segment into the summary before emitting.
    if let state = tripLastMotionState {
      trackTripMotionState(state, countUpdate: false)
    }

    let now = Date()
    let durationSec = tripSummaryStart.map { now.timeIntervalSince($0) } ?? 0
    let cameraAlertOutcome: String = {
      if tripSummaryCameraAlertCount > 0 { return "camera_alert_fired" }
      if tripSummaryGpsMovingSamples >= 25 { return "camera_alert_missed_possible" }
      return "camera_not_expected"
    }()
    let parkingGuardOutcome: String = tripSummaryFinalizationCancelledCount > 0 ? "false_positive_guarded" : "no_guard_cancellations"
    let cameraMissTopReason: String = {
      let reasons: [(String, Int)] = [
        ("speed_below_min", tripSummaryCameraRejectSpeedLow),
        ("outside_radius", tripSummaryCameraRejectRadius),
        ("heading_mismatch", tripSummaryCameraRejectHeading),
        ("camera_not_ahead", tripSummaryCameraRejectAhead),
        ("per_camera_dedupe", tripSummaryCameraRejectDedupe),
      ]
      let top = reasons.max(by: { $0.1 < $1.1 })
      guard let t = top, t.1 > 0 else { return "none" }
      return t.0
    }()
    let parkingMissTopReason: String = {
      let reasons: [(String, Int)] = [
        ("lockout_after_false_positive", tripSummaryLockoutBlockedCount),
        ("low_confidence_guard", tripSummaryLowConfidenceBlockedCount),
        ("stale_location_block", tripSummaryStaleLocationBlockedCount),
        ("hotspot_block", tripSummaryHotspotBlockedCount),
        ("finalization_cancelled_automotive", tripSummaryFinalizationCancelledAutomotive),
        ("finalization_cancelled_speed", tripSummaryFinalizationCancelledSpeed),
        ("finalization_cancelled_drift", tripSummaryFinalizationCancelledDrift),
      ]
      let top = reasons.max(by: { $0.1 < $1.1 })
      guard let t = top, t.1 > 0 else { return "none" }
      return t.0
    }()
    decision("trip_summary", [
      "tripId": tripId,
      "outcome": outcome,
      "parkingSource": parkingSource ?? "",
      "startSource": tripSummaryStartSource ?? "",
      "departureTs": tripSummaryDepartureMs ?? -1,
      "durationSec": durationSec,
      "motionAutomotiveUpdates": tripSummaryAutomotiveUpdates,
      "motionNonAutomotiveUpdates": tripSummaryNonAutomotiveUpdates,
      "motionUnknownUpdates": tripSummaryUnknownUpdates,
      "motionAutomotiveDurationSec": tripSummaryAutomotiveDurationSec,
      "motionNonAutomotiveDurationSec": tripSummaryNonAutomotiveDurationSec,
      "motionUnknownDurationSec": tripSummaryUnknownDurationSec,
      "gateWaitCount": tripSummaryGateWaitCount,
      "gatePassCount": tripSummaryGatePassCount,
      "unknownFallbackPassCount": tripSummaryUnknownFallbackPassCount,
      "gpsZeroSamples": tripSummaryGpsZeroSamples,
      "gpsMovingSamples": tripSummaryGpsMovingSamples,
      "maxSpeedMps": tripSummaryMaxSpeedMps,
      "carAudioConnects": tripSummaryCarAudioConnects,
      "carAudioDisconnects": tripSummaryCarAudioDisconnects,
      "carAudioConnectedAtEnd": carAudioConnected,
      "stopWindowMaxSpeedMps": stopWindowMaxSpeedMps,
      "finalizationCancelledCount": tripSummaryFinalizationCancelledCount,
      "cameraAlertCount": tripSummaryCameraAlertCount,
      "watchdogRecoveries": tripSummaryWatchdogRecoveries,
      "cameraAlertOutcome": cameraAlertOutcome,
      "parkingGuardOutcome": parkingGuardOutcome,
      "cameraMissTopReason": cameraMissTopReason,
      "parkingMissTopReason": parkingMissTopReason,
      "cameraRejectSpeedLowCount": tripSummaryCameraRejectSpeedLow,
      "cameraRejectRadiusCount": tripSummaryCameraRejectRadius,
      "cameraRejectHeadingCount": tripSummaryCameraRejectHeading,
      "cameraRejectAheadCount": tripSummaryCameraRejectAhead,
      "cameraRejectDedupeCount": tripSummaryCameraRejectDedupe,
      "parkingCancelledAutomotiveCount": tripSummaryFinalizationCancelledAutomotive,
      "parkingCancelledSpeedCount": tripSummaryFinalizationCancelledSpeed,
      "parkingCancelledDriftCount": tripSummaryFinalizationCancelledDrift,
      "parkingHotspotBlockedCount": tripSummaryHotspotBlockedCount,
      "parkingLockoutBlockedCount": tripSummaryLockoutBlockedCount,
      "parkingLowConfidenceBlockedCount": tripSummaryLowConfidenceBlockedCount,
      "parkingStaleLocationBlockedCount": tripSummaryStaleLocationBlockedCount,
    ])

    tripSummaryId = nil
    tripSummaryStart = nil
    tripSummaryDepartureMs = nil
    tripSummaryStartSource = nil
    tripSummaryAutomotiveUpdates = 0
    tripSummaryNonAutomotiveUpdates = 0
    tripSummaryUnknownUpdates = 0
    tripSummaryAutomotiveDurationSec = 0
    tripSummaryNonAutomotiveDurationSec = 0
    tripSummaryUnknownDurationSec = 0
    tripSummaryGateWaitCount = 0
    tripSummaryGatePassCount = 0
    tripSummaryUnknownFallbackPassCount = 0
    tripSummaryGpsZeroSamples = 0
    tripSummaryGpsMovingSamples = 0
    tripSummaryMaxSpeedMps = 0
    tripSummaryCarAudioConnects = 0
    tripSummaryCarAudioDisconnects = 0
    tripSummaryFinalizationCancelledCount = 0
    tripSummaryCameraAlertCount = 0
    tripSummaryWatchdogRecoveries = 0
    tripSummaryFinalizationCancelledAutomotive = 0
    tripSummaryFinalizationCancelledSpeed = 0
    tripSummaryFinalizationCancelledDrift = 0
    tripSummaryHotspotBlockedCount = 0
    tripSummaryLockoutBlockedCount = 0
    tripSummaryCameraRejectSpeedLow = 0
    tripSummaryCameraRejectRadius = 0
    tripSummaryCameraRejectHeading = 0
    tripSummaryCameraRejectAhead = 0
    tripSummaryCameraRejectDedupe = 0
    tripSummaryLowConfidenceBlockedCount = 0
    tripSummaryStaleLocationBlockedCount = 0
    tripLastMotionState = nil
    tripLastMotionAt = nil
  }

  private func startVehicleSignalMonitoring() {
    guard !vehicleSignalMonitoringActive else { return }
    vehicleSignalMonitoringActive = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAudioRouteChanged),
      name: AVAudioSession.routeChangeNotification,
      object: nil
    )
    pollVehicleSignal(reason: "start_monitoring")
    decision("vehicle_signal_monitoring_started")
  }

  private func stopVehicleSignalMonitoring() {
    guard vehicleSignalMonitoringActive else { return }
    vehicleSignalMonitoringActive = false
    NotificationCenter.default.removeObserver(self, name: AVAudioSession.routeChangeNotification, object: nil)
    decision("vehicle_signal_monitoring_stopped")
  }

  @objc private func handleAudioRouteChanged(_ notification: Notification) {
    let reasonRaw = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.intValue
    pollVehicleSignal(reason: "route_change_\(reasonRaw ?? -1)")
  }

  private func pollVehicleSignal(reason: String) {
    let now = Date()
    if let lastPoll = lastVehicleSignalPollAt, now.timeIntervalSince(lastPoll) < 2 {
      return
    }
    lastVehicleSignalPollAt = now

    let route = AVAudioSession.sharedInstance().currentRoute
    let outputTypes = route.outputs.map { $0.portType.rawValue }
    let hasVehicleRoute = route.outputs.contains { output in
      output.portType == .carAudio ||
      output.portType == .bluetoothA2DP ||
      output.portType == .bluetoothHFP ||
      output.portType == .bluetoothLE
    }
    if hasVehicleRoute != carAudioConnected {
      carAudioConnected = hasVehicleRoute
      if hasVehicleRoute {
        lastCarAudioConnectedAt = now
        tripSummaryCarAudioConnects += 1
        decision("vehicle_signal_connected", [
          "reason": reason,
          "outputs": outputTypes.joined(separator: ","),
        ])
        log("Vehicle audio signal connected (\(outputTypes.joined(separator: ",")))")
        extendCameraPrewarm(reason: "vehicle_signal_connected", seconds: cameraPrewarmStrongSec)
        if isMonitoring && !continuousGpsActive {
          startBootstrapGpsWindow(reason: "vehicle_signal_connected")
        }
      } else {
        lastCarAudioDisconnectedAt = now
        tripSummaryCarAudioDisconnects += 1
        decision("vehicle_signal_disconnected", [
          "reason": reason,
          "outputs": outputTypes.joined(separator: ","),
        ])
        log("Vehicle audio signal disconnected")
        extendCameraPrewarm(reason: "vehicle_signal_disconnected", seconds: cameraPrewarmSec)
      }
    }
  }

  private func hasRecentVehicleSignal(_ windowSec: TimeInterval = 180) -> Bool {
    if carAudioConnected { return true }
    if let connectedAt = lastCarAudioConnectedAt {
      let age = Date().timeIntervalSince(connectedAt)
      if age >= 0 && age <= windowSec { return true }
    }
    if let disconnectedAt = lastCarAudioDisconnectedAt {
      let age = Date().timeIntervalSince(disconnectedAt)
      if age >= 0 && age <= windowSec { return true }
    }
    return false
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

  private func startMonitoringHeartbeat() {
    monitoringHeartbeatTimer?.invalidate()
    let timer = Timer.scheduledTimer(withTimeInterval: monitoringHeartbeatIntervalSec, repeats: true) { [weak self] _ in
      self?.emitMonitoringHeartbeat(reason: "interval")
    }
    RunLoop.main.add(timer, forMode: .common)
    monitoringHeartbeatTimer = timer
    emitMonitoringHeartbeat(reason: "started")
    self.log("Monitoring heartbeat started (\(Int(monitoringHeartbeatIntervalSec))s)")
  }

  private func stopMonitoringHeartbeat() {
    monitoringHeartbeatTimer?.invalidate()
    monitoringHeartbeatTimer = nil
  }

  private func emitMonitoringHeartbeat(reason: String) {
    guard isMonitoring else { return }

    let now = Date()
    let currentLoc = locationManager.location
    let currentLocAgeSec = currentLoc.map { now.timeIntervalSince($0.timestamp) } ?? -1
    let callbackAgeSec = lastLocationCallbackTime.map { now.timeIntervalSince($0) } ?? -1
    let speedZeroAgeSec = speedZeroStartTime.map { now.timeIntervalSince($0) } ?? -1
    let nonAutoAgeSec = coreMotionNotAutomotiveSince.map { now.timeIntervalSince($0) } ?? -1
    let unknownAgeSec = coreMotionUnknownSince.map { now.timeIntervalSince($0) } ?? -1
    let queuedAgeSec = queuedParkingAt.map { now.timeIntervalSince($0) } ?? -1
    let lockoutRemainingSec = falsePositiveParkingLockoutUntil.map { max(0, $0.timeIntervalSinceNow) } ?? 0
    let bgRefreshString: String = {
      switch UIApplication.shared.backgroundRefreshStatus {
      case .available: return "available"
      case .denied: return "denied"
      case .restricted: return "restricted"
      @unknown default: return "unknown"
      }
    }()
    let locationAuthRaw = locationManager.authorizationStatus.rawValue

    decision("monitoring_heartbeat", [
      "reason": reason,
      "isDriving": isDriving,
      "coreMotionAutomotive": coreMotionSaysAutomotive,
      "speedSaysMoving": speedSaysMoving,
      "coreMotionState": coreMotionStateLabel,
      "hasConfirmedParkingThisSession": hasConfirmedParkingThisSession,
      "continuousGpsActive": continuousGpsActive,
      "coreMotionActive": coreMotionActive,
      "gpsOnlyMode": gpsOnlyMode,
      "parkingFinalizationPending": parkingFinalizationPending,
      "speedZeroTimerActive": speedZeroTimer != nil,
      "parkingConfirmationTimerActive": parkingConfirmationTimer != nil,
      "queueActive": queuedParkingAt != nil,
      "queueAgeSec": queuedAgeSec,
      "speedZeroAgeSec": speedZeroAgeSec,
      "nonAutomotiveAgeSec": nonAutoAgeSec,
      "unknownAgeSec": unknownAgeSec,
      "lastLocationCallbackAgeSec": callbackAgeSec,
      "currentLocationAgeSec": currentLocAgeSec,
      "currentSpeed": currentLoc?.speed ?? -1,
      "currentAccuracy": currentLoc?.horizontalAccuracy ?? -1,
      "carAudioConnected": carAudioConnected,
      "recentVehicleSignal": hasRecentVehicleSignal(180),
      "cameraPrewarmRemainingSec": cameraPrewarmUntil.map { max(0, $0.timeIntervalSinceNow) } ?? 0,
      "lockoutRemainingSec": lockoutRemainingSec,
      "hotspotCount": falsePositiveHotspots.count,
      "healthRecoveryCount": healthRecoveryCount,
      "lastParkingDecisionConfidence": lastParkingDecisionConfidence,
      "lastParkingDecisionSource": lastParkingDecisionSource,
      "lastParkingDecisionHoldReason": lastParkingDecisionHoldReason,
      "tripActive": tripSummaryId != nil,
      "tripId": tripSummaryId ?? "",
      "locationAuthRaw": locationAuthRaw,
      "backgroundRefreshStatus": bgRefreshString,
      "lowPowerModeEnabled": ProcessInfo.processInfo.isLowPowerModeEnabled,
    ])
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
    recordHealthRecovery(reason: "stale_callbacks", staleForSec: staleFor)

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

  private func recordHealthRecovery(reason: String, staleForSec: TimeInterval) {
    let now = Date()
    if let windowStart = healthRecoveryWindowStart {
      if now.timeIntervalSince(windowStart) > healthRecoveryWarnWindowSec {
        healthRecoveryWindowStart = now
        healthRecoveryCount = 0
      }
    } else {
      healthRecoveryWindowStart = now
    }
    healthRecoveryCount += 1
    tripSummaryWatchdogRecoveries += 1
    decision("health_recovered", [
      "reason": reason,
      "staleForSec": staleForSec,
      "recoveryCount": healthRecoveryCount,
      "windowSec": healthRecoveryWarnWindowSec,
    ])

    let canWarn: Bool = {
      guard healthRecoveryCount >= healthRecoveryWarnThreshold else { return false }
      guard let lastWarn = lastHealthWarningAt else { return true }
      return now.timeIntervalSince(lastWarn) >= healthWarnCooldownSec
    }()
    if canWarn {
      lastHealthWarningAt = now
      sendHealthWarningNotification(
        title: "Background monitoring needs attention",
        body: "We recovered from repeated background interruptions. Open the app to verify Location Always, Motion, and notifications are enabled."
      )
    }
  }

  private func sendHealthWarningNotification(title: String, body: String) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let allowed = settings.authorizationStatus == .authorized ||
                    settings.authorizationStatus == .provisional ||
                    settings.authorizationStatus == .ephemeral
      guard allowed else {
        self.log("Health notification skipped: notifications not authorized (status=\(settings.authorizationStatus.rawValue))")
        return
      }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = UNNotificationSound.default
      let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
      let req = UNNotificationRequest(
        identifier: "health-\(Int(Date().timeIntervalSince1970))",
        content: content,
        trigger: trigger
      )
      UNUserNotificationCenter.current().add(req) { err in
        if let err = err {
          self.log("Health notification add failed: \(err.localizedDescription)")
        }
      }
    }
  }

  // CLVisit tracking — iOS provides coordinates for places where the user dwells,
  // even when the app is killed. Used to enrich historical recovery with GPS coordinates.
  private var recentVisits: [(visit: CLVisit, receivedAt: Date)] = []  // Ring buffer of recent visits (max 20)
  private let maxRecentVisits = 20
  private let kVisitHistoryKey = "com.ticketless.visitHistory"  // UserDefaults key for persisting visits across app kills

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
  private var gpsOnlyMode = false                       // True when CoreMotion is denied/restricted — GPS speed is primary driving signal
  private var automotiveSessionStart: Date? = nil       // When current automotive session began (for flicker filtering)
  private var lastConfirmedParkingLocation: CLLocation? = nil  // Where we last confirmed parking (for distance-based flicker check)
  private var lastLocationCallbackTime: Date? = nil
  private var locationWatchdogTimer: Timer?
  private var monitoringHeartbeatTimer: Timer?
  private var lastWatchdogRecoveryTime: Date? = nil
  private var lastMotionDecisionSignature: String? = nil
  private var lastSpeedBucket: String? = nil
  private var coreMotionWalkingSince: Date? = nil
  private var coreMotionStationarySince: Date? = nil
  private var gpsFallbackDrivingSince: Date? = nil
  private var gpsFallbackStartLocation: CLLocation? = nil
  private var gpsFallbackPossibleDrivingEmitted = false
  private var bootstrapGpsTimer: Timer? = nil
  private var cameraPrewarmUntil: Date? = nil
  private var vehicleSignalMonitoringActive = false
  private var carAudioConnected = false
  private var lastCarAudioConnectedAt: Date? = nil
  private var lastCarAudioDisconnectedAt: Date? = nil
  private var lastVehicleSignalPollAt: Date? = nil
  private var falsePositiveHotspots: [[String: Any]] = []
  private var healthRecoveryCount = 0
  private var healthRecoveryWindowStart: Date? = nil
  private var lastHealthWarningAt: Date? = nil
  private var tripSummaryId: String? = nil
  private var tripSummaryStart: Date? = nil
  private var tripSummaryDepartureMs: Double? = nil
  private var tripSummaryStartSource: String? = nil
  private var tripSummaryAutomotiveUpdates = 0
  private var tripSummaryNonAutomotiveUpdates = 0
  private var tripSummaryUnknownUpdates = 0
  private var tripSummaryAutomotiveDurationSec: TimeInterval = 0
  private var tripSummaryNonAutomotiveDurationSec: TimeInterval = 0
  private var tripSummaryUnknownDurationSec: TimeInterval = 0
  private var tripSummaryGateWaitCount = 0
  private var tripSummaryGatePassCount = 0
  private var tripSummaryUnknownFallbackPassCount = 0
  private var tripSummaryGpsZeroSamples = 0
  private var tripSummaryGpsMovingSamples = 0
  private var tripSummaryMaxSpeedMps: Double = 0
  private var tripSummaryCarAudioConnects = 0
  private var tripSummaryCarAudioDisconnects = 0
  private var tripSummaryFinalizationCancelledCount = 0
  private var tripSummaryCameraAlertCount = 0
  private var tripSummaryWatchdogRecoveries = 0
  private var tripSummaryFinalizationCancelledAutomotive = 0
  private var tripSummaryFinalizationCancelledSpeed = 0
  private var tripSummaryFinalizationCancelledDrift = 0
  private var tripSummaryHotspotBlockedCount = 0
  private var tripSummaryLockoutBlockedCount = 0
  private var tripSummaryCameraRejectSpeedLow = 0
  private var tripSummaryCameraRejectRadius = 0
  private var tripSummaryCameraRejectHeading = 0
  private var tripSummaryCameraRejectAhead = 0
  private var tripSummaryCameraRejectDedupe = 0
  private var tripSummaryLowConfidenceBlockedCount = 0
  private var tripSummaryStaleLocationBlockedCount = 0
  private var tripLastMotionState: String? = nil
  private var tripLastMotionAt: Date? = nil
  private var falsePositiveParkingLockoutUntil: Date? = nil
  private var lastParkingDecisionConfidence: Int = -1
  private var lastParkingDecisionHoldReason: String = ""
  private var lastParkingDecisionSource: String = ""
  private var lastParkingDecisionTs: Double = 0
  private var intersectionDwellStartAt: Date? = nil
  private var intersectionDwellLocation: CLLocation? = nil
  private var pendingParkingConfidenceScore: Int = -1
  private var pendingParkingNearIntersectionRisk = false
  private var pendingParkingWalkingEvidenceSec: TimeInterval = 0
  private var lastConfirmedParkingAt: Date? = nil
  private var lastConfirmedParkingConfidence: Int = -1
  private var lastConfirmedParkingNearIntersectionRisk = false

  // Camera alerts (native iOS fallback for when JS is suspended in background)
  private var cameraAlertsEnabled = false
  private var cameraSpeedEnabled = false
  private var cameraRedlightEnabled = false
  private var cameraAlertVolume: Float = 1.0
  private var alertedCameraAtByIndex: [Int: Date] = [:]
  private var lastCameraAlertAt: Date? = nil
  private var lastCameraRejectLogAt: Date? = nil

  // Native TTS for background camera alerts (AVSpeechSynthesizer runs natively,
  // unlike JS SpeechModule which is suspended when the app is backgrounded)
  private let speechSynthesizer = AVSpeechSynthesizer()
  private var speechAudioSessionConfigured = false
  private var backgroundSpeechTaskId: UIBackgroundTaskIdentifier = .invalid

  private let kCameraAlertsEnabledKey = "bg_camera_alerts_enabled"
  private let kCameraSpeedEnabledKey = "bg_camera_alerts_speed_enabled"
  private let kCameraRedlightEnabledKey = "bg_camera_alerts_redlight_enabled"
  private let kCameraAlertVolumeKey = "bg_camera_alert_volume"

  // UserDefaults keys for persisting critical state across app kills.
  // Without persistence, iOS can kill the app, significantLocationChange wakes it
  // with a fresh instance where all guards are nil/false, and cell-tower GPS
  // creates false parking at wrong addresses (the Clybourn bug).
  private let kLastParkingLatKey = "bg_lastConfirmedParkingLat"
  private let kLastParkingLngKey = "bg_lastConfirmedParkingLng"
  private let kLastParkingAccKey = "bg_lastConfirmedParkingAcc"
  private let kLastParkingTimeKey = "bg_lastConfirmedParkingTime"
  private let kHasConfirmedParkingKey = "bg_hasConfirmedParking"
  private let kFalsePositiveHotspotsKey = "bg_false_positive_hotspots_v1"

  // Pending parking event queue — survives stopMonitoring/startMonitoring cycles.
  // When JS is suspended by iOS, sendEvent("onParkingDetected") is silently lost.
  // This queue persists the full event payload so JS can pick it up on next startup.
  // Only cleared by explicit JS acknowledgment (acknowledgeParkingEvent).
  private let kPendingParkingEventKey = "bg_pending_parking_event_v1"

  // Configuration
  private let minDrivingDurationSec: TimeInterval = 10   // 10 sec of driving before we care about stops (was 120→60→30→10; covers moving car one block for street cleaning)
  private let exitDebounceSec: TimeInterval = 5          // 5 sec debounce after CoreMotion confirms exit
  private let minDrivingSpeedMps: Double = 2.5           // ~5.6 mph - threshold to START driving state via speed
  private let gpsFallbackDrivingSpeedMps: Double = 4.2   // ~9.4 mph fallback when CoreMotion misses automotive
  private let gpsFallbackDrivingDurationSec: TimeInterval = 8
  private let gpsFallbackMinDistanceMeters: Double = 90
  private let gpsFallbackWithVehicleSpeedMps: Double = 2.8   // ~6.3 mph when recent car signal is present
  private let gpsFallbackWithVehicleDurationSec: TimeInterval = 5
  private let gpsFallbackWithVehicleMinDistanceMeters: Double = 45
  private let gpsFallbackMaxAccuracyMeters: Double = 80
  // CoreMotion can occasionally stay "not automotive" even while GPS speed is clearly driving.
  // This hard override is intentionally conservative (high speed + sustained duration + real
  // displacement) and is only used when CoreMotion is NOT automotive, so it won't create
  // red-light false positives (speed is ~0 at red lights).
  private let gpsHardDrivingSpeedMps: Double = 8.0          // ~18 mph
  private let gpsHardDrivingDurationSec: TimeInterval = 6
  private let gpsHardMinDistanceMeters: Double = 160
  private let gpsHardMaxAccuracyMeters: Double = 300
  private let speedCheckIntervalSec: TimeInterval = 3    // Re-check parking every 3s while speed≈0
  private let stationaryRadiusMeters: Double = 50        // Consider "same location" if within 50m
  private let stationaryDurationSec: TimeInterval = 120  // 2 minutes in same spot = definitely parked

  // Debounce timer for parking confirmation
  private var parkingConfirmationTimer: Timer?
  private var speedZeroTimer: Timer?  // GPS speed-based parking trigger (repeating, checks every 3s)
  private var speedZeroStartTime: Date?  // When GPS speed first dropped to ≈0 during this driving session
  private var stationaryLocation: CLLocation?  // Location when we first stopped moving
  private var stationaryStartTime: Date?  // When we first stopped at stationaryLocation
  private var speedMovingConsecutiveCount: Int = 0  // Count of consecutive GPS readings showing speed > driving threshold
  private let speedMovingConsecutiveRequired: Int = 2  // Must see N consecutive above-threshold readings to cancel parking timer (GPS noise filter)
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
  private var coreMotionUnknownSince: Date? = nil
  private var coreMotionStateLabel: String = "unknown"
  private let coreMotionStabilitySec: TimeInterval = 6  // CoreMotion must stay non-automotive for 6s
  private let minZeroSpeedForAgreeSec: TimeInterval = 10  // GPS speed≈0 for 10s before gps_coremotion_agree can fire
  private let minWalkingEvidenceSec: TimeInterval = 4
  private let minZeroSpeedNoWalkingSec: TimeInterval = 20
  private let unknownFallbackZeroSpeedSec: TimeInterval = 45
  private let unknownFallbackMaxSpeedMps: Double = 0.9
  private let unknownFallbackMinDrivingSec: TimeInterval = 20
  private let unknownFallbackWithCarSignalSec: TimeInterval = 25
  private let unknownFallbackWithCarSignalMaxSpeedMps: Double = 1.2
  private let carDisconnectEvidenceWindowSec: TimeInterval = 180
  private let finalizationCancelSpeedMps: Double = 2.2
  private let queuedParkingGraceSec: TimeInterval = 25
  private let parkingFinalizationHoldSec: TimeInterval = 7
  private let parkingFinalizationHoldFastSec: TimeInterval = 5
  private let parkingFinalizationHoldStrongSec: TimeInterval = 11
  private let parkingFinalizationMaxDriftMeters: Double = 35
  private let falsePositiveParkingLockoutSec: TimeInterval = 1800  // 30 min — prevents re-detection while user is still at the false positive location
  private let gpsZeroSpeedHardTimeoutSec: TimeInterval = 45  // Hard override: 45s of GPS speed≈0 = parked, even if CoreMotion still says automotive
  private let intersectionRiskRadiusMeters: Double = 95
  private let intersectionDwellAbortWindowSec: TimeInterval = 90
  private let intersectionDwellMinStopSec: TimeInterval = 18
  private let postConfirmUnwindWindowSec: TimeInterval = 120
  private let postConfirmUnwindMinDistanceMeters: Double = 85
  private let postConfirmUnwindMinSpeedMps: Double = 3.0
  private let postConfirmUnwindMaxConfidence = 65
  private let locationCallbackStaleSec: TimeInterval = 90
  private let locationWatchdogIntervalSec: TimeInterval = 20
  private let monitoringHeartbeatIntervalSec: TimeInterval = 20
  private let watchdogRecoveryCooldownSec: TimeInterval = 60
  private let healthRecoveryWarnThreshold = 3
  private let healthRecoveryWarnWindowSec: TimeInterval = 15 * 60
  private let healthWarnCooldownSec: TimeInterval = 30 * 60
  private let bootstrapGpsWindowSec: TimeInterval = 75
  private let cameraPrewarmSec: TimeInterval = 180
  private let cameraPrewarmStrongSec: TimeInterval = 300
  private var stopWindowMaxSpeedMps: Double = 0
  private let hotspotMergeRadiusMeters: Double = 80
  private let hotspotBlockRadiusMeters: Double = 90
  private let hotspotBlockMinReports: Int = 1
  private let parkingCandidateMaxAgeSec: TimeInterval = 40
  private let parkingCandidateHardStaleSec: TimeInterval = 75
  private let parkingCandidateFreshReplacementAgeSec: TimeInterval = 12
  private let parkingCandidatePreferredAccuracyMeters: Double = 70
  private let parkingCandidateHardMaxAccuracyMeters: Double = 120

  // Camera alert tuning: match JS defaults
  private let camBaseAlertRadiusMeters: Double = 150
  private let camMaxAlertRadiusMeters: Double = 250
  private let camTargetWarningSec: Double = 10
  private let camCooldownRadiusMeters: Double = 400
  private let camMinSpeedSpeedCamMps: Double = 3.2
  private let camMinSpeedRedlightMps: Double = 1.0
  private let camAnnounceMinIntervalSec: TimeInterval = 5
  private let camAlertDedupeSec: TimeInterval = 3 * 60
  private let camBBoxDegrees: Double = 0.0025
  private let camHeadingToleranceDeg: Double = 45
  private let camMaxBearingOffHeadingDeg: Double = 30
  private let camRejectLogCooldownSec: TimeInterval = 10
  private let speedCamEnforceStartHour = 6
  private let speedCamEnforceEndHour = 23


  override init() {
    super.init()
    setupLogFile()
    setupDecisionLogFile()
    restorePersistedCameraSettings()
    locationManager.delegate = self
    speechSynthesizer.delegate = self
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
    loadFalsePositiveHotspots()

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

  private func restorePersistedCameraSettings() {
    let d = UserDefaults.standard
    if d.object(forKey: kCameraAlertsEnabledKey) != nil {
      cameraAlertsEnabled = d.bool(forKey: kCameraAlertsEnabledKey)
    }
    if d.object(forKey: kCameraSpeedEnabledKey) != nil {
      cameraSpeedEnabled = d.bool(forKey: kCameraSpeedEnabledKey)
    }
    if d.object(forKey: kCameraRedlightEnabledKey) != nil {
      cameraRedlightEnabled = d.bool(forKey: kCameraRedlightEnabledKey)
    }
    if d.object(forKey: kCameraAlertVolumeKey) != nil {
      cameraAlertVolume = d.float(forKey: kCameraAlertVolumeKey)
    }
    log("Restored camera settings: enabled=\(cameraAlertsEnabled) speed=\(cameraSpeedEnabled) redlight=\(cameraRedlightEnabled) volume=\(cameraAlertVolume)")
  }

  private func persistCameraSettings() {
    let d = UserDefaults.standard
    d.set(cameraAlertsEnabled, forKey: kCameraAlertsEnabledKey)
    d.set(cameraSpeedEnabled, forKey: kCameraSpeedEnabledKey)
    d.set(cameraRedlightEnabled, forKey: kCameraRedlightEnabledKey)
    d.set(cameraAlertVolume, forKey: kCameraAlertVolumeKey)
  }

  @objc func setCameraAlertSettings(_ enabled: Bool, speedEnabled: Bool, redlightEnabled: Bool,
                                    volume: Double,
                                    resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    cameraAlertsEnabled = enabled
    cameraSpeedEnabled = speedEnabled
    cameraRedlightEnabled = redlightEnabled
    cameraAlertVolume = Float(max(0.0, min(1.0, volume)))
    persistCameraSettings()
    decision("camera_settings_updated", [
      "enabled": enabled,
      "speedEnabled": speedEnabled,
      "redlightEnabled": redlightEnabled,
    ])
    log("Camera settings updated: enabled=\(enabled) speed=\(speedEnabled) redlight=\(redlightEnabled)")
    resolve(true)
  }

  @objc func reportParkingFalsePositive(_ latitude: Double, longitude: Double,
                                        resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    addFalsePositiveHotspot(lat: latitude, lng: longitude, source: "user_report")
    falsePositiveParkingLockoutUntil = Date().addingTimeInterval(falsePositiveParkingLockoutSec)
    decision("parking_false_positive_reported", [
      "lat": latitude,
      "lng": longitude,
      "lockoutSec": falsePositiveParkingLockoutSec,
      "lockoutUntilTs": falsePositiveParkingLockoutUntil?.timeIntervalSince1970 ?? 0,
    ])
    resolve(true)
  }

  @objc func reportParkingConfirmed(_ latitude: Double, longitude: Double,
                                    resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    reduceFalsePositiveHotspot(lat: latitude, lng: longitude, source: "user_confirm")
    resolve(true)
  }

  /// Returns any pending parking event that JS may have missed due to iOS suspension.
  /// Returns null if no pending event.
  @objc func getPendingParkingEvent(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let event = readPendingParkingEvent() {
      let ageSec = event["_persistedAt"].flatMap { $0 as? Double }.map { Date().timeIntervalSince1970 - $0 } ?? -1
      self.log("Returning pending parking event to JS (age: \(String(format: "%.0f", ageSec))s)")
      resolve(event)
    } else {
      resolve(NSNull())
    }
  }

  /// JS calls this after successfully processing a pending parking event.
  @objc func acknowledgeParkingEvent(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    clearPendingParkingEvent()
    resolve(true)
  }

  @objc private func appDidBecomeActive() {
    guard isMonitoring else { return }
    if !isDriving && !coreMotionSaysAutomotive {
      startBootstrapGpsWindow(reason: "app_resume")
    }
    guard !isDriving && !coreMotionSaysAutomotive else { return }

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

  // MARK: - Pending Parking Event Queue (survives stop/start monitoring)

  /// Persist the full parking event payload so JS can pick it up even if
  /// sendEvent was lost due to iOS suspending JS.
  private func persistPendingParkingEvent(_ payload: [String: Any]) {
    // Convert to a plist-safe dictionary (no NSNull, etc.)
    var safePayload: [String: Any] = [:]
    for (key, value) in payload {
      if value is NSNull { continue }
      safePayload[key] = value
    }
    safePayload["_persistedAt"] = Date().timeIntervalSince1970
    UserDefaults.standard.set(safePayload, forKey: kPendingParkingEventKey)
    self.log("Persisted pending parking event to UserDefaults queue")
  }

  /// Read the pending parking event (if any). Returns nil if none queued.
  private func readPendingParkingEvent() -> [String: Any]? {
    guard let event = UserDefaults.standard.dictionary(forKey: kPendingParkingEventKey) else {
      return nil
    }
    // Expire events older than 24 hours — stale events are not useful
    if let persistedAt = event["_persistedAt"] as? Double {
      let ageHours = (Date().timeIntervalSince1970 - persistedAt) / 3600
      if ageHours > 24 {
        self.log("Pending parking event expired (age: \(String(format: "%.1f", ageHours))h) — clearing")
        clearPendingParkingEvent()
        return nil
      }
    }
    return event
  }

  /// Clear the pending parking event after JS has acknowledged it.
  private func clearPendingParkingEvent() {
    UserDefaults.standard.removeObject(forKey: kPendingParkingEventKey)
    self.log("Cleared pending parking event from UserDefaults queue")
  }

  private func loadFalsePositiveHotspots() {
    let defaults = UserDefaults.standard
    guard let arr = defaults.array(forKey: kFalsePositiveHotspotsKey) as? [[String: Any]] else { return }
    falsePositiveHotspots = arr
    decision("hotspots_loaded", ["count": arr.count])
  }

  private func saveFalsePositiveHotspots() {
    UserDefaults.standard.set(falsePositiveHotspots, forKey: kFalsePositiveHotspotsKey)
  }

  private func addFalsePositiveHotspot(lat: Double, lng: Double, source: String) {
    let nowMs = Date().timeIntervalSince1970 * 1000
    let newLoc = CLLocation(latitude: lat, longitude: lng)
    var merged = false
    for i in 0..<falsePositiveHotspots.count {
      guard
        let existingLat = falsePositiveHotspots[i]["lat"] as? Double,
        let existingLng = falsePositiveHotspots[i]["lng"] as? Double
      else { continue }
      let dist = newLoc.distance(from: CLLocation(latitude: existingLat, longitude: existingLng))
      if dist <= hotspotMergeRadiusMeters {
        let prevCount = falsePositiveHotspots[i]["count"] as? Int ?? 1
        falsePositiveHotspots[i]["count"] = min(prevCount + 1, 20)
        falsePositiveHotspots[i]["lastTs"] = nowMs
        merged = true
        decision("hotspot_updated", [
          "source": source,
          "count": min(prevCount + 1, 20),
          "distanceMeters": dist,
        ])
        break
      }
    }
    if !merged {
      falsePositiveHotspots.append([
        "lat": lat,
        "lng": lng,
        "count": 1,
        "firstTs": nowMs,
        "lastTs": nowMs,
      ])
      decision("hotspot_added", [
        "source": source,
        "count": 1,
      ])
    }
    if falsePositiveHotspots.count > 30 {
      falsePositiveHotspots = Array(falsePositiveHotspots.suffix(30))
    }
    saveFalsePositiveHotspots()
  }

  private func reduceFalsePositiveHotspot(lat: Double, lng: Double, source: String) {
    let loc = CLLocation(latitude: lat, longitude: lng)
    for i in stride(from: falsePositiveHotspots.count - 1, through: 0, by: -1) {
      guard
        let hLat = falsePositiveHotspots[i]["lat"] as? Double,
        let hLng = falsePositiveHotspots[i]["lng"] as? Double
      else { continue }
      let dist = loc.distance(from: CLLocation(latitude: hLat, longitude: hLng))
      if dist <= hotspotMergeRadiusMeters {
        let prevCount = falsePositiveHotspots[i]["count"] as? Int ?? 1
        let next = max(0, prevCount - 1)
        if next == 0 {
          falsePositiveHotspots.remove(at: i)
        } else {
          falsePositiveHotspots[i]["count"] = next
          falsePositiveHotspots[i]["lastTs"] = Date().timeIntervalSince1970 * 1000
        }
        decision("hotspot_reduced", [
          "source": source,
          "prevCount": prevCount,
          "nextCount": next,
          "distanceMeters": dist,
        ])
        saveFalsePositiveHotspots()
        return
      }
    }
  }

  private func hotspotInfo(near location: CLLocation?) -> (count: Int, distance: Double)? {
    guard let location = location else { return nil }
    var best: (count: Int, distance: Double)? = nil
    for item in falsePositiveHotspots {
      guard let lat = item["lat"] as? Double, let lng = item["lng"] as? Double else { continue }
      let dist = location.distance(from: CLLocation(latitude: lat, longitude: lng))
      if dist > hotspotBlockRadiusMeters { continue }
      let count = item["count"] as? Int ?? 1
      if let cur = best {
        if dist < cur.distance { best = (count, dist) }
      } else {
        best = (count, dist)
      }
    }
    return best
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

    // CLVisit monitoring — iOS tracks places where the user dwells and delivers
    // CLVisit objects with coordinates + arrival/departure times, even if the app
    // was killed. These visits enrich historical recovery with GPS coordinates,
    // allowing parking rule checks for missed stops.
    locationManager.startMonitoringVisits()
    loadPersistedVisits()
    self.log("CLVisit monitoring started")

    // Start CoreMotion - this is the primary driving detection.
    // Runs on the M-series coprocessor, nearly zero battery.
    let coreMotionAvailable = CMMotionActivityManager.isActivityAvailable()
    let coreMotionAuthStatus = CMMotionActivityManager.authorizationStatus()
    self.log("CoreMotion available: \(coreMotionAvailable), authStatus: \(coreMotionAuthStatus.rawValue)")

    if coreMotionAvailable && (coreMotionAuthStatus == .authorized || coreMotionAuthStatus == .notDetermined) {
      startMotionActivityMonitoring()
      gpsOnlyMode = false
      self.log("CoreMotion activity monitoring started")
      // Start ultra-low-frequency GPS keepalive to prevent iOS from killing the app.
      // CoreMotion handles driving detection; GPS just keeps the process alive.
      if !continuousGpsActive {
        locationManager.distanceFilter = 200
        locationManager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
        locationManager.startUpdatingLocation()
        continuousGpsActive = true
        self.log("Keepalive GPS started (distanceFilter=200m, accuracy=3km)")
      }
    } else {
      gpsOnlyMode = true
      if coreMotionAuthStatus == .denied {
        self.log("WARNING: CoreMotion permission DENIED by user — entering GPS-only mode")
      } else if coreMotionAuthStatus == .restricted {
        self.log("WARNING: CoreMotion RESTRICTED (parental controls?) — entering GPS-only mode")
      } else {
        self.log("WARNING: CoreMotion NOT available on this device — entering GPS-only mode")
      }
      // In GPS-only mode, we run continuous GPS at low frequency so the
      // speed-based fallback can detect driving. This uses more battery
      // than CoreMotion but is the only option when CoreMotion is denied.
      self.log("Starting low-frequency continuous GPS for GPS-only driving detection")
      locationManager.distanceFilter = 20  // 20m between updates (saves battery vs kCLDistanceFilterNone)
      locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      locationManager.startUpdatingLocation()
      continuousGpsActive = true
    }

    startVehicleSignalMonitoring()
    isMonitoring = true
    decision("start_monitoring_success", [
      "authStatusRaw": locationManager.authorizationStatus.rawValue,
      "coreMotionAvailable": coreMotionAvailable,
      "coreMotionAuthStatus": coreMotionAuthStatus.rawValue,
      "gpsOnlyMode": gpsOnlyMode,
    ])
    lastLocationCallbackTime = Date()
    startLocationWatchdog()
    startMonitoringHeartbeat()
    startBootstrapGpsWindow(reason: "start_monitoring")
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
    self.log("Monitoring started (significantChanges + \(gpsOnlyMode ? "GPS-ONLY" : "CoreMotion"), auth=\(authString), coreMotion=\(coreMotionAvailable), gpsOnlyMode=\(gpsOnlyMode))")
    resolve(true)

    // Check for missed parking events from when the app was killed/suspended.
    // This MUST run after startMonitoring() because it needs CoreMotion to be active.
    // Use a short delay to let CoreMotion provide initial activity state first.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
      guard let self = self, self.isMonitoring else { return }
      // Only run recovery if we're not already driving (CoreMotion just told us)
      guard !self.isDriving else {
        self.log("Startup recovery: skipping — already driving")
        return
      }
      if let currentLoc = self.locationManager.location {
        self.log("Startup recovery: checking CoreMotion history for missed parking (location available: \(currentLoc.coordinate.latitude), \(currentLoc.coordinate.longitude) ±\(currentLoc.horizontalAccuracy)m, age: \(String(format: "%.0f", Date().timeIntervalSince(currentLoc.timestamp)))s)")
        self.checkForMissedParking(currentLocation: currentLoc)
      } else {
        self.log("Startup recovery: no location available — will check on first location update")
      }
    }
  }

  /// Stop all monitoring
  @objc func stopMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    decision("stop_monitoring_called")
    emitMonitoringHeartbeat(reason: "stopping")
    emitTripSummary(outcome: "monitoring_stopped")
    locationManager.stopMonitoringSignificantLocationChanges()
    locationManager.stopMonitoringVisits()
    stopVehicleSignalMonitoring()
    // Fully stop GPS when monitoring is disabled (not just keepalive mode)
    locationManager.stopUpdatingLocation()
    continuousGpsActive = false
    stopMotionActivityMonitoring()
    stopAccelerometerRecording()
    stopLocationWatchdog()
    stopMonitoringHeartbeat()
    bootstrapGpsTimer?.invalidate()
    bootstrapGpsTimer = nil

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
    speedMovingConsecutiveCount = 0
    drivingStartTime = nil
    lastDrivingLocation = nil
    locationAtStopStart = nil
    lastStationaryTime = nil
    speedZeroStartTime = nil
    stopWindowMaxSpeedMps = 0
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
    coreMotionUnknownSince = nil
    coreMotionStateLabel = "unknown"
    coreMotionWalkingSince = nil
    coreMotionStationarySince = nil
    carAudioConnected = false
    lastCarAudioConnectedAt = nil
    lastCarAudioDisconnectedAt = nil
    lastVehicleSignalPollAt = nil
    cameraPrewarmUntil = nil
    healthRecoveryCount = 0
    healthRecoveryWindowStart = nil
    lastHealthWarningAt = nil
    lastLocationCallbackTime = nil
    lastWatchdogRecoveryTime = nil
    lastMotionDecisionSignature = nil
    lastSpeedBucket = nil
    gpsFallbackDrivingSince = nil
    gpsFallbackStartLocation = nil
    gpsFallbackPossibleDrivingEmitted = false
    alertedCameraAtByIndex.removeAll()
    lastCameraAlertAt = nil
    lastCameraRejectLogAt = nil
    falsePositiveParkingLockoutUntil = nil
    lastParkingDecisionConfidence = -1
    lastParkingDecisionHoldReason = ""
    lastParkingDecisionSource = ""
    lastParkingDecisionTs = 0
    intersectionDwellStartAt = nil
    intersectionDwellLocation = nil
    pendingParkingConfidenceScore = -1
    pendingParkingNearIntersectionRisk = false
    pendingParkingWalkingEvidenceSec = 0
    lastConfirmedParkingAt = nil
    lastConfirmedParkingConfidence = -1
    lastConfirmedParkingNearIntersectionRisk = false
    gpsOnlyMode = false
    clearPersistedParkingState()

    self.log("Monitoring stopped")
    resolve(true)
  }

  /// Get current monitoring status
  @objc func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let motionAuthStatus = CMMotionActivityManager.authorizationStatus()
    let motionAuthString: String
    switch motionAuthStatus {
    case .authorized: motionAuthString = "authorized"
    case .denied: motionAuthString = "denied"
    case .restricted: motionAuthString = "restricted"
    case .notDetermined: motionAuthString = "notDetermined"
    @unknown default: motionAuthString = "unknown"
    }

    let bgRefreshStatus = UIApplication.shared.backgroundRefreshStatus
    let bgRefreshString: String
    switch bgRefreshStatus {
    case .available: bgRefreshString = "available"
    case .denied: bgRefreshString = "denied"
    case .restricted: bgRefreshString = "restricted"
    @unknown default: bgRefreshString = "unknown"
    }

    var result: [String: Any] = [
      "isMonitoring": isMonitoring,
      "isDriving": isDriving,
      "coreMotionAutomotive": coreMotionSaysAutomotive,
      "continuousGpsActive": continuousGpsActive,
      "coreMotionActive": coreMotionActive,
      "hasAlwaysPermission": locationManager.authorizationStatus == .authorizedAlways,
      "motionAvailable": CMMotionActivityManager.isActivityAvailable(),
      "motionAuthStatus": motionAuthString,
      "gpsOnlyMode": gpsOnlyMode,
      "backgroundRefreshStatus": bgRefreshString,
      "lowPowerModeEnabled": ProcessInfo.processInfo.isLowPowerModeEnabled,
      "vehicleSignalConnected": carAudioConnected,
      "recentVehicleSignal": hasRecentVehicleSignal(180),
      "parkingFinalizationPending": parkingFinalizationPending,
      "queueActive": queuedParkingAt != nil,
      "queueAgeSec": queuedParkingAt.map { Date().timeIntervalSince($0) } ?? NSNull(),
      "speedZeroAgeSec": speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? NSNull(),
      "coreMotionUnknownAgeSec": coreMotionUnknownSince.map { Date().timeIntervalSince($0) } ?? NSNull(),
      "coreMotionNonAutoAgeSec": coreMotionNotAutomotiveSince.map { Date().timeIntervalSince($0) } ?? NSNull(),
      "heartbeatActive": monitoringHeartbeatTimer != nil,
      "healthRecoveryCount": healthRecoveryCount,
      "lastParkingDecisionConfidence": lastParkingDecisionConfidence,
      "lastParkingDecisionHoldReason": lastParkingDecisionHoldReason,
      "lastParkingDecisionSource": lastParkingDecisionSource,
      "lastParkingDecisionTs": lastParkingDecisionTs,
    ]

    UNUserNotificationCenter.current().getNotificationSettings { settings in
      result["notificationsAuthorized"] =
        settings.authorizationStatus == .authorized ||
        settings.authorizationStatus == .provisional ||
        settings.authorizationStatus == .ephemeral
      if let drivingStart = self.drivingStartTime {
        result["drivingDurationSec"] = Date().timeIntervalSince(drivingStart)
      }

      if let lastLoc = self.lastDrivingLocation {
        result["lastDrivingLat"] = lastLoc.coordinate.latitude
        result["lastDrivingLng"] = lastLoc.coordinate.longitude
      }

      if let lastCb = self.lastLocationCallbackTime {
        result["lastLocationCallbackAgeSec"] = Date().timeIntervalSince(lastCb)
      } else {
        result["lastLocationCallbackAgeSec"] = NSNull()
      }

      resolve(result)
    }
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
  /// If GPS is already in keepalive mode, ramp up to full accuracy.
  private func startContinuousGps() {
    // Remove distance filter during driving so we get GPS updates even when
    // stationary. Without this, distanceFilter=10 means no updates arrive
    // when the car stops, so the speed-zero parking detection never triggers.
    let wasActive = continuousGpsActive
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    if !continuousGpsActive {
      locationManager.startUpdatingLocation()
    }
    continuousGpsActive = true
    if wasActive {
      self.log("Continuous GPS ramped up from keepalive → full accuracy (driving detected)")
    } else {
      self.log("Continuous GPS ON (driving detected, distanceFilter=none)")
    }
  }

  /// Stop continuous GPS (called after parking confirmed)
  /// NEVER fully stop GPS — doing so lets iOS kill the app process, losing
  /// CoreMotion callbacks and making the next drive undetectable. Instead,
  /// drop to ultra-low-frequency updates that keep the process alive at
  /// minimal battery cost (~1-2% per hour).
  private func stopContinuousGps() {
    guard continuousGpsActive else { return }
    if gpsOnlyMode {
      // GPS-only mode: need slightly more frequent updates for driving detection
      locationManager.distanceFilter = 20
      locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      self.log("Continuous GPS → low-frequency (GPS-only mode, distanceFilter=20m, accuracy=100m)")
      // Keep continuousGpsActive = true so location callbacks keep flowing
    } else {
      // Normal mode (CoreMotion available): drop to ultra-low-frequency GPS
      // to keep the app process alive. CoreMotion handles driving detection;
      // GPS just needs to prevent iOS from killing us.
      locationManager.distanceFilter = 200  // Only update every 200m of movement
      locationManager.desiredAccuracy = kCLLocationAccuracyThreeKilometers  // Lowest power GPS
      self.log("Continuous GPS → keepalive mode (distanceFilter=200m, accuracy=3km) — preventing iOS process kill")
      // Keep continuousGpsActive = true so the process stays alive
    }
  }

  /// Briefly run high-frequency GPS after monitor start/resume to avoid a blind
  /// window where CoreMotion is quiet and no speed/heading callbacks arrive.
  /// This improves first-drive detection and camera alert arming reliability.
  private func startBootstrapGpsWindow(reason: String) {
    guard isMonitoring else { return }
    if isDriving || coreMotionSaysAutomotive { return }

    bootstrapGpsTimer?.invalidate()

    // Always ramp up to full accuracy (startContinuousGps handles keepalive→active transition)
    startContinuousGps()
    decision("bootstrap_gps_started", [
      "reason": reason,
      "windowSec": bootstrapGpsWindowSec,
    ])
    self.log("Bootstrap GPS started (\(reason)) for \(String(format: "%.0f", bootstrapGpsWindowSec))s")

    let timer = Timer.scheduledTimer(withTimeInterval: bootstrapGpsWindowSec, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      self.bootstrapGpsTimer = nil
      let shouldKeepGps =
        self.isDriving ||
        self.coreMotionSaysAutomotive ||
        self.speedSaysMoving ||
        self.parkingFinalizationPending ||
        self.speedZeroTimer != nil

      if shouldKeepGps {
        self.log("Bootstrap GPS window elapsed but keeping GPS ON (driving pipeline active)")
        self.decision("bootstrap_gps_kept_active", [
          "isDriving": self.isDriving,
          "coreMotionAutomotive": self.coreMotionSaysAutomotive,
          "speedSaysMoving": self.speedSaysMoving,
          "parkingFinalizationPending": self.parkingFinalizationPending,
          "speedZeroTimerActive": self.speedZeroTimer != nil,
        ])
        return
      }

      if self.continuousGpsActive {
        self.stopContinuousGps()
      }
      self.decision("bootstrap_gps_stopped", ["reason": "window_elapsed_idle"])
      self.log("Bootstrap GPS window elapsed — stopped GPS (still idle)")
    }
    RunLoop.main.add(timer, forMode: .common)
    bootstrapGpsTimer = timer
  }

  private func extendCameraPrewarm(reason: String, seconds: TimeInterval? = nil) {
    let duration = seconds ?? cameraPrewarmSec
    let newUntil = Date().addingTimeInterval(duration)
    if let existing = cameraPrewarmUntil, existing > newUntil {
      return
    }
    cameraPrewarmUntil = newUntil
    decision("camera_prewarm_extended", [
      "reason": reason,
      "durationSec": duration,
      "untilTs": newUntil.timeIntervalSince1970 * 1000,
    ])
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
      let tripMotionState: String = {
        if activity.automotive { return "automotive" }
        if activity.stationary || activity.walking { return "non_automotive" }
        return "unknown"
      }()
      self.trackTripMotionState(tripMotionState)
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
        self.coreMotionStateLabel = "automotive"
        self.coreMotionSaysAutomotive = true
        self.coreMotionUnknownSince = nil
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
          self.stopWindowMaxSpeedMps = 0
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
                self.extendCameraPrewarm(reason: "possible_driving_coremotion", seconds: self.cameraPrewarmStrongSec)
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
          // Warm up audio session for background TTS camera alerts
          self.configureSpeechAudioSession()

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
          self.beginTripSummary(source: departureSource, departureTimestampMs: departureTimestamp)
          self.sendEvent(withName: "onDrivingStarted", body: [
            "timestamp": departureTimestamp,
            "source": departureSource,
          ])
          self.extendCameraPrewarm(reason: "driving_started_coremotion", seconds: self.cameraPrewarmStrongSec)
        }

      } else if (activity.stationary || activity.walking) && (activity.confidence != .low || !self.speedSaysMoving) {
        // ---- NOT IN CAR ----
        // CoreMotion says user is NOT in a vehicle.
        // Accept medium/high confidence always. Also accept LOW confidence
        // when GPS speed corroborates (speed ≈ 0). This fixes the case where
        // CoreMotion takes 30-60s to reach medium confidence after parking,
        // while GPS immediately shows speed=0.
        let wasAutomotive = self.coreMotionSaysAutomotive
        self.coreMotionStateLabel = activity.walking ? "walking" : "stationary"
        self.coreMotionSaysAutomotive = false
        self.coreMotionUnknownSince = nil
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
            self.speedMovingConsecutiveCount = 0
            self.speedZeroStartTime = nil
            self.stopWindowMaxSpeedMps = 0
          }
        }
      } else if !activity.automotive && !activity.stationary && !activity.walking {
        self.coreMotionStateLabel = "unknown"
        if self.coreMotionUnknownSince == nil {
          self.coreMotionUnknownSince = Date()
          self.decision("coremotion_unknown_started", [
            "confidence": self.confidenceString(activity.confidence),
            "isDriving": self.isDriving,
            "speedSaysMoving": self.speedSaysMoving,
          ])
          self.log("CoreMotion entered unknown state; waiting for stronger evidence")
        } else if self.isDriving && !self.speedSaysMoving {
          let zeroDuration = self.speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
          let unknownDuration = self.coreMotionUnknownSince.map { Date().timeIntervalSince($0) } ?? 0
          let currentSpeed = self.locationManager.location?.speed ?? -1
          self.decision("coremotion_unknown_waiting", [
            "unknownDurationSec": unknownDuration,
            "zeroDurationSec": zeroDuration,
            "gpsSpeed": currentSpeed,
            "maxSpeedDuringStop": self.stopWindowMaxSpeedMps,
          ])
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
    if vehicleSignalMonitoringActive {
      pollVehicleSignal(reason: "location_tick")
    }
    lastLocationCallbackTime = Date()
    let speed = location.speed  // m/s, -1 if unknown
    if tripSummaryId != nil {
      if speed >= 0 {
        tripSummaryMaxSpeedMps = max(tripSummaryMaxSpeedMps, speed)
      }
      if speed > minDrivingSpeedMps {
        tripSummaryGpsMovingSamples += 1
      } else if speed >= 0 && speed <= 0.5 {
        tripSummaryGpsZeroSamples += 1
      }
    }
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

    if isDriving && (gpsFallbackDrivingSince != nil || gpsFallbackStartLocation != nil) {
      decision("gps_fallback_reset", ["reason": "driving_already_active"])
      gpsFallbackDrivingSince = nil
      gpsFallbackStartLocation = nil
      gpsFallbackPossibleDrivingEmitted = false
    }

    // --- Update driving location continuously while in driving state ---
    // Save at ANY speed while CoreMotion says automotive (captures 1 mph creep into spot)
    if isDriving || coreMotionSaysAutomotive {
      lastDrivingLocation = location
    }

    // --- Speed-based driving detection (backup if CoreMotion is slow) ---
    if speed > minDrivingSpeedMps {
      maybeUnwindRecentParkingConfirmation(location, speed: speed)
      maybeHandleIntersectionDwellResume(location, speed: speed)

      // GPS noise filter: require N consecutive above-threshold readings before
      // declaring "definitely moving" and cancelling parking timers. A single
      // noisy GPS reading (multipath off buildings, GPS drift while parked in a
      // store) used to kill the parking timer — the CVS bug.
      speedMovingConsecutiveCount += 1

      if speedMovingConsecutiveCount >= speedMovingConsecutiveRequired {
        speedSaysMoving = true
        cancelPendingParkingFinalization(reason: "GPS speed resumed above driving threshold")
        if queuedParkingAt != nil {
          decision("parking_candidate_queue_cleared", ["reason": "driving_resumed"])
          queuedParkingAt = nil
          queuedParkingBody = nil
          queuedParkingSource = nil
        }

        // Cancel speed-based parking timer - confirmed moving (red light ended)
        speedZeroTimer?.invalidate()
        speedZeroTimer = nil
        speedZeroStartTime = nil
        stopWindowMaxSpeedMps = 0
        stationaryLocation = nil   // Reset so next stop captures fresh location
        stationaryStartTime = nil
        locationAtStopStart = nil  // Reset stop location - wasn't a real stop
      } else {
        self.log("GPS speed \(String(format: "%.1f", speed)) m/s above threshold but only \(speedMovingConsecutiveCount)/\(speedMovingConsecutiveRequired) consecutive — not cancelling parking timer yet (noise filter)")
      }

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
        configureSpeechAudioSession()
        self.log("Driving started (GPS speed \(String(format: "%.1f", speed)) m/s confirmed CoreMotion automotive)")

        var departureTimestamp = Date().timeIntervalSince1970 * 1000
        if location.speed > minDrivingSpeedMps && Date().timeIntervalSince(location.timestamp) < 60 {
          departureTimestamp = location.timestamp.timeIntervalSince1970 * 1000
        }

        sendEvent(withName: "onDrivingStarted", body: [
          "timestamp": departureTimestamp,
          "source": "gps_speed_confirmed",
        ])
        extendCameraPrewarm(reason: "driving_started_gps_confirmed", seconds: cameraPrewarmStrongSec)
        beginTripSummary(source: "gps_speed_confirmed", departureTimestampMs: departureTimestamp)
        gpsFallbackDrivingSince = nil
        gpsFallbackStartLocation = nil
        gpsFallbackPossibleDrivingEmitted = false
      } else if !isDriving && !coreMotionSaysAutomotive {
        // GPS fallback for missed CoreMotion automotive transitions.
        // We require sustained higher speed + decent accuracy + real displacement
        // so this path does not trigger on short red-light movement noise.
        let accuracy = location.horizontalAccuracy
        let hasVehicleSignalBoost = hasRecentVehicleSignal(150)
        let fallbackSpeedThreshold = hasVehicleSignalBoost ? gpsFallbackWithVehicleSpeedMps : gpsFallbackDrivingSpeedMps
        let fallbackDurationThreshold = hasVehicleSignalBoost ? gpsFallbackWithVehicleDurationSec : gpsFallbackDrivingDurationSec
        let fallbackDistanceThreshold = hasVehicleSignalBoost ? gpsFallbackWithVehicleMinDistanceMeters : gpsFallbackMinDistanceMeters
        let hardMode = speed >= gpsHardDrivingSpeedMps
        let effectiveSpeedThreshold = hardMode ? gpsHardDrivingSpeedMps : fallbackSpeedThreshold
        let effectiveDurationThreshold = hardMode ? gpsHardDrivingDurationSec : fallbackDurationThreshold
        let effectiveDistanceThreshold = hardMode ? gpsHardMinDistanceMeters : fallbackDistanceThreshold
        let effectiveMaxAccuracy = hardMode ? gpsHardMaxAccuracyMeters : gpsFallbackMaxAccuracyMeters

        if accuracy > 0 && accuracy <= effectiveMaxAccuracy && speed >= effectiveSpeedThreshold {
          if gpsFallbackDrivingSince == nil {
            gpsFallbackDrivingSince = location.timestamp
            gpsFallbackStartLocation = location
            gpsFallbackPossibleDrivingEmitted = false
            decision("gps_fallback_started", [
              "speed": speed,
              "accuracy": accuracy,
              "hasVehicleSignalBoost": hasVehicleSignalBoost,
              "mode": hardMode ? "hard" : "strict",
              "speedThreshold": effectiveSpeedThreshold,
              "durationThreshold": effectiveDurationThreshold,
              "distanceThreshold": effectiveDistanceThreshold,
              "maxAccuracyMeters": effectiveMaxAccuracy,
            ])
            self.log("GPS fallback tracking started (mode=\(hardMode ? "hard" : "strict"), speed \(String(format: "%.1f", speed)) m/s, acc \(String(format: "%.0f", accuracy))m, vehicleBoost=\(hasVehicleSignalBoost))")
          }

          let fallbackStart = gpsFallbackDrivingSince ?? location.timestamp
          let fallbackDuration = location.timestamp.timeIntervalSince(fallbackStart)
          let fallbackDistance: Double = {
            guard let startLoc = gpsFallbackStartLocation else { return 0 }
            return location.distance(from: startLoc)
          }()

          if !gpsFallbackPossibleDrivingEmitted && fallbackDuration >= 3 {
            gpsFallbackPossibleDrivingEmitted = true
            sendEvent(withName: "onPossibleDriving", body: [
              "timestamp": Date().timeIntervalSince1970 * 1000,
              "source": "gps_speed_fallback_preconfirm",
            ])
            extendCameraPrewarm(reason: "possible_driving_gps_fallback", seconds: cameraPrewarmStrongSec)
            self.log("Emitted onPossibleDriving from GPS fallback preconfirm")
          }

          if fallbackDuration >= effectiveDurationThreshold &&
             fallbackDistance >= effectiveDistanceThreshold {
            isDriving = true
            drivingStartTime = fallbackStart
            lastDrivingLocation = nil
            locationAtStopStart = nil
            startContinuousGps()
            startAccelerometerRecording()
            configureSpeechAudioSession()
            decision("gps_fallback_promoted_to_driving", [
              "durationSec": fallbackDuration,
              "distanceMeters": fallbackDistance,
              "speed": speed,
              "accuracy": accuracy,
              "hasVehicleSignalBoost": hasVehicleSignalBoost,
              "mode": hardMode ? "hard" : "strict",
              "speedThreshold": effectiveSpeedThreshold,
              "durationThreshold": effectiveDurationThreshold,
              "distanceThreshold": effectiveDistanceThreshold,
              "maxAccuracyMeters": effectiveMaxAccuracy,
            ])
            self.log("Driving started (GPS fallback: duration \(String(format: "%.0f", fallbackDuration))s, distance \(String(format: "%.0f", fallbackDistance))m, speed \(String(format: "%.1f", speed)) m/s)")
            sendEvent(withName: "onDrivingStarted", body: [
              "timestamp": fallbackStart.timeIntervalSince1970 * 1000,
              "source": "gps_speed_fallback",
            ])
            extendCameraPrewarm(reason: "driving_started_gps_fallback", seconds: cameraPrewarmStrongSec)
            beginTripSummary(source: "gps_speed_fallback", departureTimestampMs: fallbackStart.timeIntervalSince1970 * 1000)
            gpsFallbackDrivingSince = nil
            gpsFallbackStartLocation = nil
            gpsFallbackPossibleDrivingEmitted = false
          } else {
            self.log("GPS fallback waiting (mode=\(hardMode ? "hard" : "strict")): duration \(String(format: "%.0f", fallbackDuration))s/\(String(format: "%.0f", effectiveDurationThreshold))s, distance \(String(format: "%.0f", fallbackDistance))m/\(String(format: "%.0f", effectiveDistanceThreshold))m, acc \(String(format: "%.0f", accuracy))m/\(String(format: "%.0f", effectiveMaxAccuracy))m, vehicleBoost=\(hasVehicleSignalBoost)")
          }
        } else if gpsFallbackDrivingSince != nil || gpsFallbackStartLocation != nil {
          decision("gps_fallback_reset", [
            "reason": "accuracy_or_speed_failed",
            "speed": speed,
            "accuracy": accuracy,
            "vehicleSignalRecent": hasRecentVehicleSignal(150),
            "mode": (speed >= gpsHardDrivingSpeedMps) ? "hard" : "strict",
          ])
          self.log("GPS fallback reset (speed \(String(format: "%.1f", speed)) m/s, acc \(String(format: "%.0f", accuracy))m)")
          gpsFallbackDrivingSince = nil
          gpsFallbackStartLocation = nil
          gpsFallbackPossibleDrivingEmitted = false
        }
        self.log("GPS speed > threshold (\(String(format: "%.1f", speed)) m/s) but CoreMotion not automotive — fallback mode=\(hardMode ? "hard" : "strict") (acc \(String(format: "%.0f", accuracy))m, maxAcc \(String(format: "%.0f", effectiveMaxAccuracy))m)")
      }
    } else if speed >= 0 && speed <= 0.5 {
      speedSaysMoving = false
      speedMovingConsecutiveCount = 0  // Reset GPS noise filter — speed dropped, not consecutively moving
      if gpsFallbackDrivingSince != nil || gpsFallbackStartLocation != nil {
        let elapsed = gpsFallbackDrivingSince.map { location.timestamp.timeIntervalSince($0) } ?? 0
        decision("gps_fallback_reset", [
          "reason": "speed_dropped",
          "elapsedSec": elapsed,
        ])
        self.log("GPS fallback reset: speed dropped to \(String(format: "%.1f", speed)) m/s after \(String(format: "%.0f", elapsed))s")
        gpsFallbackDrivingSince = nil
        gpsFallbackStartLocation = nil
        gpsFallbackPossibleDrivingEmitted = false
      }

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
          stopWindowMaxSpeedMps = max(0, speed)
        }
        // Record location when we first stopped
        if stationaryLocation == nil {
          stationaryLocation = location
          stationaryStartTime = Date()
          self.log("Stationary location captured: \(location.coordinate.latitude), \(location.coordinate.longitude)")
        }

        self.log("GPS speed≈0 after \(String(format: "%.0f", Date().timeIntervalSince(drivingStart)))s driving. Starting parking check (every \(speedCheckIntervalSec)s).")
        maybeRecordIntersectionDwellCandidate(lastDrivingLocation ?? location)
        speedZeroTimer = Timer.scheduledTimer(withTimeInterval: speedCheckIntervalSec, repeats: true) { [weak self] timer in
          guard let self = self else { timer.invalidate(); return }

          // Check current GPS speed — the 2-min location check only applies if phone is truly stationary
          // (not walking away from car). Walking is ~1.4 m/s.
          let currentSpeed = self.locationManager.location?.speed ?? -1
          if currentSpeed >= 0 {
            self.stopWindowMaxSpeedMps = max(self.stopWindowMaxSpeedMps, currentSpeed)
          }
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
            self.stopWindowMaxSpeedMps = 0
            self.stationaryLocation = nil
            self.stationaryStartTime = nil
            return
          }

          let zeroDuration = self.speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
          let stationaryDuration = self.stationaryStartTime.map { Date().timeIntervalSince($0) } ?? 0
          let unknownDuration = self.coreMotionUnknownSince.map { Date().timeIntervalSince($0) } ?? 0

          if !self.coreMotionSaysAutomotive {
            // CoreMotion agrees user is not in a vehicle.
            // Require sustained zero speed + stable non-automotive state to
            // reduce red-light false positives while still confirming quickly.
            let coreMotionStableDuration = self.coreMotionNotAutomotiveSince.map { Date().timeIntervalSince($0) } ?? zeroDuration
            let walkingEvidenceSec = self.coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
            let hasWalkingEvidence = walkingEvidenceSec >= self.minWalkingEvidenceSec
            let longNoWalkingStop = zeroDuration >= self.minZeroSpeedNoWalkingSec
            let hasCarDisconnectEvidence: Bool = {
              guard let disconnectedAt = self.lastCarAudioDisconnectedAt else { return false }
              let age = Date().timeIntervalSince(disconnectedAt)
              return age >= 0 && age <= self.carDisconnectEvidenceWindowSec
            }()
            let currentSpeedCheck = self.locationManager.location?.speed ?? -1
            let gpsSpeedOk = currentSpeedCheck >= 0 && currentSpeedCheck < 1.0

            if zeroDuration >= self.minZeroSpeedForAgreeSec &&
               coreMotionStableDuration >= self.coreMotionStabilitySec &&
               gpsSpeedOk &&
               (hasWalkingEvidence || longNoWalkingStop || hasCarDisconnectEvidence) {
              self.log("Parking confirmed: GPS speed≈0 for \(String(format: "%.0f", zeroDuration))s + CoreMotion non-automotive for \(String(format: "%.0f", coreMotionStableDuration))s + GPS speed \(String(format: "%.1f", currentSpeedCheck)) m/s")
              self.tripSummaryGatePassCount += 1
              self.decision("gps_coremotion_gate_passed", [
                "zeroDurationSec": zeroDuration,
                "coreMotionStableSec": coreMotionStableDuration,
                "gpsSpeed": currentSpeedCheck,
                "coreMotionState": self.coreMotionStateLabel,
                "unknownDurationSec": unknownDuration,
                "maxSpeedDuringStop": self.stopWindowMaxSpeedMps,
                "walkingEvidenceSec": walkingEvidenceSec,
                "hasWalkingEvidence": hasWalkingEvidence,
                "longNoWalkingStop": longNoWalkingStop,
                "hasCarDisconnectEvidence": hasCarDisconnectEvidence,
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
              if !hasWalkingEvidence && !longNoWalkingStop && !hasCarDisconnectEvidence {
                waitReasons.append("no walk/car-disconnect evidence and stop<\(String(format: "%.0f", self.minZeroSpeedNoWalkingSec))s")
              }
              self.log("CoreMotion agrees (not automotive) but guards not met: \(waitReasons.joined(separator: ", "))")
              self.tripSummaryGateWaitCount += 1
              self.decision("gps_coremotion_gate_wait", [
                "zeroDurationSec": zeroDuration,
                "coreMotionStableSec": coreMotionStableDuration,
                "gpsSpeed": currentSpeedCheck,
                "coreMotionState": self.coreMotionStateLabel,
                "unknownDurationSec": unknownDuration,
                "maxSpeedDuringStop": self.stopWindowMaxSpeedMps,
                "walkingEvidenceSec": walkingEvidenceSec,
                "hasWalkingEvidence": hasWalkingEvidence,
                "longNoWalkingStop": longNoWalkingStop,
                "hasCarDisconnectEvidence": hasCarDisconnectEvidence,
                "reasons": waitReasons.joined(separator: "; "),
              ])
            }
          } else if self.coreMotionStateLabel == "unknown" &&
                    unknownDuration >= {
                      guard let disconnectedAt = self.lastCarAudioDisconnectedAt else { return self.unknownFallbackZeroSpeedSec }
                      let age = Date().timeIntervalSince(disconnectedAt)
                      return (age >= 0 && age <= self.carDisconnectEvidenceWindowSec) ? self.unknownFallbackWithCarSignalSec : self.unknownFallbackZeroSpeedSec
                    }() &&
                    zeroDuration >= {
                      guard let disconnectedAt = self.lastCarAudioDisconnectedAt else { return self.unknownFallbackZeroSpeedSec }
                      let age = Date().timeIntervalSince(disconnectedAt)
                      return (age >= 0 && age <= self.carDisconnectEvidenceWindowSec) ? self.unknownFallbackWithCarSignalSec : self.unknownFallbackZeroSpeedSec
                    }() &&
                    self.stopWindowMaxSpeedMps <= {
                      guard let disconnectedAt = self.lastCarAudioDisconnectedAt else { return self.unknownFallbackMaxSpeedMps }
                      let age = Date().timeIntervalSince(disconnectedAt)
                      return (age >= 0 && age <= self.carDisconnectEvidenceWindowSec) ? self.unknownFallbackWithCarSignalMaxSpeedMps : self.unknownFallbackMaxSpeedMps
                    }() &&
                    (self.drivingStartTime.map { Date().timeIntervalSince($0) } ?? 0) >= self.unknownFallbackMinDrivingSec {
            // Conservative fallback for devices that linger in CoreMotion "unknown":
            // require a long sustained stop and no meaningful speed spikes.
            self.log("Parking confirmed via unknown fallback: unknown \(String(format: "%.0f", unknownDuration))s, zero \(String(format: "%.0f", zeroDuration))s, max stop speed \(String(format: "%.1f", self.stopWindowMaxSpeedMps)) m/s")
            self.tripSummaryUnknownFallbackPassCount += 1
            self.decision("gps_unknown_fallback_passed", [
              "unknownDurationSec": unknownDuration,
              "zeroDurationSec": zeroDuration,
              "maxSpeedDuringStop": self.stopWindowMaxSpeedMps,
              "gpsSpeed": currentSpeed,
              "coreMotionState": self.coreMotionStateLabel,
              "hasCarDisconnectEvidence": {
                guard let disconnectedAt = self.lastCarAudioDisconnectedAt else { return false }
                let age = Date().timeIntervalSince(disconnectedAt)
                return age >= 0 && age <= self.carDisconnectEvidenceWindowSec
              }(),
            ])
            timer.invalidate()
            self.speedZeroTimer = nil
            self.confirmParking(source: "gps_unknown_fallback")
          } else if phoneIsStationary && withinStationaryRadius && stationaryDuration >= self.stationaryDurationSec {
            // Phone hasn't moved (speed < 0.5 m/s) AND still within 50m of parking spot for 2+ min.
            // This means the user is sitting in their parked car (not walking away).
            // You don't sit in one spot for 2 minutes at a red light — definitely parked.
            self.log("Parking confirmed: phone stationary within \(self.stationaryRadiusMeters)m for \(String(format: "%.0f", stationaryDuration))s (location-based override)")
            timer.invalidate()
            self.speedZeroTimer = nil
            self.confirmParking(source: "location_stationary")
          } else if zeroDuration >= self.gpsZeroSpeedHardTimeoutSec {
            // HARD TIMEOUT: GPS speed has been ≈0 for 45+ seconds. No red light lasts
            // this long. CoreMotion is wrong — confirm parking regardless.
            // This catches the common case where CoreMotion stays "automotive" after
            // the engine stops (phone vibration, slow M-series transition, etc.)
            self.log("Parking confirmed via GPS hard timeout: speed≈0 for \(String(format: "%.0f", zeroDuration))s (CoreMotion: \(self.coreMotionStateLabel), phone moving: \(!phoneIsStationary), walked away: \(!withinStationaryRadius))")
            self.decision("gps_speed_zero_hard_timeout", [
              "zeroDurationSec": zeroDuration,
              "stationaryDurationSec": stationaryDuration,
              "coreMotionState": self.coreMotionStateLabel,
              "phoneIsStationary": phoneIsStationary,
              "withinStationaryRadius": withinStationaryRadius,
              "maxSpeedDuringStop": self.stopWindowMaxSpeedMps,
              "gpsSpeed": currentSpeed,
            ])
            timer.invalidate()
            self.speedZeroTimer = nil
            self.confirmParking(source: "gps_speed_zero_timeout")
          } else {
            var reason = "CoreMotion still automotive"
            if self.coreMotionStateLabel == "unknown" {
              reason = "CoreMotion unknown"
            }
            if !phoneIsStationary { reason += ", phone moving (speed: \(String(format: "%.1f", currentSpeed)) m/s)" }
            if !withinStationaryRadius { reason += ", user walked away from parking spot" }
            reason += ", timeout in \(String(format: "%.0f", self.gpsZeroSpeedHardTimeoutSec - zeroDuration))s"
            if self.coreMotionStateLabel == "unknown" {
              let hasCarDisconnectEvidence: Bool = {
                guard let disconnectedAt = self.lastCarAudioDisconnectedAt else { return false }
                let age = Date().timeIntervalSince(disconnectedAt)
                return age >= 0 && age <= self.carDisconnectEvidenceWindowSec
              }()
              let reqUnknown = hasCarDisconnectEvidence ? self.unknownFallbackWithCarSignalSec : self.unknownFallbackZeroSpeedSec
              reason += ", unknown=\(String(format: "%.0f", unknownDuration))s/\(String(format: "%.0f", reqUnknown))s, maxStopSpeed=\(String(format: "%.1f", self.stopWindowMaxSpeedMps))m/s, carDisconnectEvidence=\(hasCarDisconnectEvidence)"
            }
            self.log("Speed≈0 for \(String(format: "%.0f", zeroDuration))s, stationary for \(String(format: "%.0f", stationaryDuration))s. Waiting... (\(reason))")
          }
        }
      }
    }
    if speed >= 0 && speed < minDrivingSpeedMps && (gpsFallbackDrivingSince != nil || gpsFallbackStartLocation != nil) {
      let elapsed = gpsFallbackDrivingSince.map { location.timestamp.timeIntervalSince($0) } ?? 0
      decision("gps_fallback_reset", [
        "reason": "below_driving_threshold",
        "speed": speed,
        "elapsedSec": elapsed,
      ])
      self.log("GPS fallback reset: speed \(String(format: "%.1f", speed)) m/s below driving threshold")
      gpsFallbackDrivingSince = nil
      gpsFallbackStartLocation = nil
      gpsFallbackPossibleDrivingEmitted = false
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

    // Native camera alerts: only when backgrounded (JS often suspended)
    // and only while we believe the user is driving/automotive.
    let appState = UIApplication.shared.applicationState
    let cameraPrewarmed = cameraPrewarmUntil.map { Date() <= $0 } ?? false
    let cameraArmed = isDriving || coreMotionSaysAutomotive || speedSaysMoving || hasRecentVehicleSignal(120) || cameraPrewarmed
    if appState != .active && cameraArmed {
      maybeSendNativeCameraAlert(location)
    }
  }

  // MARK: - Native Camera Alerts (Background)

  private struct NativeCameraDef {
    let type: String   // "speed" | "redlight"
    let address: String
    let lat: Double
    let lng: Double
    let approaches: [String]
  }

  // CAMERA_DATA_BEGIN (generated)
  private static let chicagoCameras: [NativeCameraDef] = [
    // CAMERA_ENTRIES_BEGIN
    // Generated from TicketlessChicagoMobile/src/data/chicago-cameras.ts (510 cameras)
    NativeCameraDef(type: "speed", address: "3450 W 71st St", lat: 41.7644, lng: -87.7097, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "6247 W Fullerton Ave", lat: 41.9236, lng: -87.7825, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "6250 W Fullerton Ave", lat: 41.9238, lng: -87.7826, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "5509 W Fullerton Ave", lat: 41.9239, lng: -87.7639, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "5446 W Fullerton Ave", lat: 41.9241, lng: -87.763, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "4843 W Fullerton Ave", lat: 41.9241, lng: -87.748, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3843 W 111th St", lat: 41.6912, lng: -87.7172, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "6523 N Western Ave", lat: 42.0003, lng: -87.6898, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "4433 N Western Ave", lat: 41.9623, lng: -87.6886, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "7739 S Western Ave", lat: 41.7526, lng: -87.6828, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "7738 S Western Ave", lat: 41.75269, lng: -87.6831, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "2550 W 79th St", lat: 41.7502, lng: -87.6874, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "5529 S Western Ave", lat: 41.79249, lng: -87.6839, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "7833 S Pulaski Rd", lat: 41.7504, lng: -87.7218, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "7826 S Pulaski Rd", lat: 41.7505, lng: -87.7221, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "3832 W 79th St", lat: 41.74969, lng: -87.7196, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "115 N Ogden Ave", lat: 41.8832, lng: -87.6641, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "2721 W Montrose Ave", lat: 41.9611, lng: -87.697, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "2705 W Irving Park Ave", lat: 41.9539, lng: -87.6962, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "2712 W Irving Park Ave", lat: 41.9541, lng: -87.6966, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "5520 S Western Ave", lat: 41.7928, lng: -87.6842, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "2115 S Western Ave", lat: 41.8534, lng: -87.6855, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "2108 S Western Ave", lat: 41.8536, lng: -87.6858, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "346 W 76th St", lat: 41.7564, lng: -87.6338, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "3542 E 95th St", lat: 41.723, lng: -87.537, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "1110 S Pulaski Rd", lat: 41.8676, lng: -87.7254, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "3212 W 55th St", lat: 41.7936, lng: -87.7042, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "8345 S Ashland Ave", lat: 41.7417, lng: -87.6631, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "3111 N Ashland Ave", lat: 41.9383, lng: -87.6685, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "5006 S Western Blvd", lat: 41.8028, lng: -87.6837, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "7157 S South Chicago Ave", lat: 41.7647, lng: -87.6037, approaches: ["NWB"]),
    NativeCameraDef(type: "speed", address: "8043 W Addison St", lat: 41.945, lng: -87.8282, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "5885 N Ridge Ave", lat: 41.98891, lng: -87.66856, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "2443 N Ashland", lat: 41.92642, lng: -87.66806, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "1732 W 99th St", lat: 41.71398, lng: -87.66672, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "2700 W 103rd St", lat: 41.7065, lng: -87.6892, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "10540 S Western Ave", lat: 41.70148, lng: -87.68162, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "515 S Central Ave", lat: 41.8733, lng: -87.7645, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "4041 W Chicago Ave", lat: 41.8952, lng: -87.7277, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "1901 E 75th St", lat: 41.75869, lng: -87.5785, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "1117 S Pulaski Rd", lat: 41.8674, lng: -87.7251, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "8318 S Ashland Ave", lat: 41.7425, lng: -87.6634, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "6020 W Foster Ave", lat: 41.9758, lng: -87.7786, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "8006 W Addison St", lat: 41.945, lng: -87.8271, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "2900 W Ogden Ave", lat: 41.8604, lng: -87.6987, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "3534 N Western Ave", lat: 41.946, lng: -87.6884, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "4429 N Broadway Ave", lat: 41.9626, lng: -87.6555, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "3137 W Peterson Ave", lat: 41.9903, lng: -87.7095, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3115 N Narragansett Ave", lat: 41.93699, lng: -87.7857, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "3911 W Diversey Ave", lat: 41.9318, lng: -87.7254, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "6226 W Irving Park Rd", lat: 41.9531, lng: -87.7828, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "1306 W 76th St", lat: 41.756, lng: -87.657, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "450 N Columbus Dr", lat: 41.89009, lng: -87.6204, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "2917 W Roosevelt Rd", lat: 41.8664, lng: -87.6991, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "901 N Clark St", lat: 41.8988, lng: -87.6313, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "4432 N Lincoln Ave", lat: 41.9623, lng: -87.6846, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "1444 W Division St", lat: 41.9035, lng: -87.6644, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "3314 W 16th St", lat: 41.8591, lng: -87.7083, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3230 N Milwaukee Ave", lat: 41.9397, lng: -87.7251, approaches: ["SB", "WB"]),
    NativeCameraDef(type: "speed", address: "19 E Chicago Ave", lat: 41.8966, lng: -87.629, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "3100 W Augusta Blvd", lat: 41.89929, lng: -87.7045, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "8020 W Forest Preserve Ave", lat: 41.9442, lng: -87.8275, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "732 N Pulaski Rd", lat: 41.8945, lng: -87.7262, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "7122 S South Chicago Ave", lat: 41.7652, lng: -87.6048, approaches: ["SEB"]),
    NativeCameraDef(type: "speed", address: "3130 N Ashland Ave", lat: 41.9388, lng: -87.6688, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "1226 S Western Ave", lat: 41.90379, lng: -87.6872, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "6935 W Addison St", lat: 41.94543, lng: -87.80021, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "4124 W Foster Ave", lat: 41.9755, lng: -87.7317, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "6125 N Cicero Ave", lat: 41.9921, lng: -87.7485, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "4925 S Archer Ave", lat: 41.8036, lng: -87.721, approaches: ["NEB", "SWB"]),
    NativeCameraDef(type: "speed", address: "4350 W 79th St", lat: 41.74949, lng: -87.7289, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "10318 S Indianapolis Ave", lat: 41.7076, lng: -87.5298, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "445 W 127th St", lat: 41.6632, lng: -87.6337, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "2928 S Halsted St", lat: 41.8408, lng: -87.6463, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "5433 S Pulaski Ave", lat: 41.79399, lng: -87.723, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "4246 W 47th St", lat: 41.8078, lng: -87.7301, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "4516 W Marquette Rd", lat: 41.77129, lng: -87.7358, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "14 W Chicago Ave", lat: 41.8968, lng: -87.6288, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "2638 W Fullerton Ave", lat: 41.9249, lng: -87.6941, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "1635 N Ashland Ave", lat: 41.9117, lng: -87.6676, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "1229 N Western Ave", lat: 41.9039, lng: -87.6869, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "2329 W Division St", lat: 41.9029, lng: -87.6858, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "2109 E 87th St", lat: 41.737, lng: -87.5729, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "6510 W Bryn Mawr Ave", lat: 41.983, lng: -87.7908, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "3217 W 55th St", lat: 41.7934, lng: -87.7043, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "1507 W 83rd St", lat: 41.743, lng: -87.6611, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3655 W Jackson Blvd", lat: 41.8771, lng: -87.7182, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "630 S State St", lat: 41.8738, lng: -87.6277, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "4436 N Western Ave", lat: 41.9624, lng: -87.6889, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "4446 N Broadway Ave", lat: 41.9629, lng: -87.656, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "7508 W Touhy Ave", lat: 42.0116, lng: -87.8142, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "7518 S Vincennes Ave", lat: 41.7571, lng: -87.6318, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "4707 W Peterson Ave", lat: 41.9898, lng: -87.7462, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "4674 W Peterson Ave", lat: 41.99, lng: -87.7453, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "2501 W Irving Park Rd", lat: 41.9539, lng: -87.6913, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "655 W. Root St.", lat: 41.8189, lng: -87.6425, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "6330 S Dr Martin Luther King Jr Dr", lat: 41.7793, lng: -87.6161, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "3601 N Milwaukee Ave", lat: 41.9466, lng: -87.736, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "5432 W Lawrence Ave", lat: 41.9678, lng: -87.7639, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "4909 N Cicero Ave", lat: 41.9701, lng: -87.7477, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "4123 N Central Ave", lat: 41.9557, lng: -87.7669, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "5428 S Pulaski S Rd", lat: 41.79419, lng: -87.7233, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "3851 W 79th St", lat: 41.7494, lng: -87.7191, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "5454 W Irving Park", lat: 41.9533, lng: -87.7643, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "1142 W Irving Park Rd", lat: 41.9545, lng: -87.6589, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "11153 S Vincennes Ave", lat: 41.6907, lng: -87.6641, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "536 E Morgan Dr", lat: 41.7935, lng: -87.6119, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "6514 W Belmont Ave", lat: 41.9384, lng: -87.7891, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "4040 W Chicago Ave", lat: 41.8954, lng: -87.7277, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "1638 N Ashland Ave", lat: 41.9118, lng: -87.6679, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "506 S Central Ave", lat: 41.8736, lng: -87.7648, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "341 W 76th St", lat: 41.7561, lng: -87.6336, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "3535 E 95th St", lat: 41.7228, lng: -87.5376, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "4042 W North Ave", lat: 41.90999, lng: -87.7281, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "1111 N Humboldt Blvd", lat: 41.9014, lng: -87.7021, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "3521 N Western Ave", lat: 41.9456, lng: -87.6881, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "4929 S Pulaski Rd", lat: 41.8033, lng: -87.7233, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "5030 S Pulaski Rd", lat: 41.8014, lng: -87.7235, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "629 S State St", lat: 41.8738, lng: -87.6274, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "2445 W 51st St", lat: 41.801, lng: -87.6861, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "1455 W Division St", lat: 41.9033, lng: -87.6649, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "3034 W Foster Ave", lat: 41.9759, lng: -87.7048, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "5330 S Cottage Grove Ave", lat: 41.7977, lng: -87.6064, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "1215 E 83RD ST", lat: 41.7442, lng: -87.5933, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "5816 W Jackson Blvd", lat: 41.8772, lng: -87.7704, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "3809 W Belmont Ave", lat: 41.939, lng: -87.7226, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "4319 W 47th St", lat: 41.8076, lng: -87.7318, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "449 N Columbus Dr", lat: 41.89, lng: -87.6202, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "2432 N Ashland Ave", lat: 41.9262, lng: -87.6683, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "2080 W Pershing Rd", lat: 41.8232, lng: -87.678, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "4949 W Lawrence Ave", lat: 41.9679, lng: -87.7523, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "1754 N Pulaski Rd", lat: 41.9134, lng: -87.7266, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "5120 N Pulaski Rd", lat: 41.9743, lng: -87.7282, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "3536 S Wallace St", lat: 41.8297, lng: -87.6413, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "5471 W Higgins Rd", lat: 41.9692, lng: -87.764, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "6443 W Belmont Ave", lat: 41.9382, lng: -87.7877, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "1334 W Garfield Blvd", lat: 41.79419, lng: -87.6587, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "1315 W Garfield Blvd", lat: 41.7936, lng: -87.6579, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "324 S Kedzie Ave", lat: 41.8766, lng: -87.7061, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "324 E Illinois St", lat: 41.8909, lng: -87.6193, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "6909 S Kedzie Ave", lat: 41.7677, lng: -87.7027, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "6818 S Kedzie Ave", lat: 41.7691, lng: -87.703, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "2912 W Roosevelt Rd", lat: 41.8666, lng: -87.699, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "2549 W Addison St", lat: 41.9466, lng: -87.6905, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "57 E 95th St", lat: 41.7216, lng: -87.6215, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "62 E 95th St", lat: 41.7219, lng: -87.6214, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "2440 W 51st St", lat: 41.8012, lng: -87.6859, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "3646 W Madison St", lat: 41.88089, lng: -87.7179, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "2223 N Kedzie Blvd", lat: 41.92199, lng: -87.707, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "4620 W Belmont Ave", lat: 41.939, lng: -87.7431, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "5440 W Grand Ave", lat: 41.9182, lng: -87.7623, approaches: ["WB", "EB"]),
    NativeCameraDef(type: "speed", address: "2513 W 55th St", lat: 41.7937, lng: -87.6872, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3810 W Belmont Ave", lat: 41.9393, lng: -87.7228, approaches: ["WB"]),
    NativeCameraDef(type: "speed", address: "3047 W Jackson Blvd", lat: 41.8772, lng: -87.7029, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3116 N Narragansett Ave", lat: 41.93699, lng: -87.786, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "215 E 63rd St", lat: 41.78, lng: -87.6198, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "4053 W North Ave", lat: 41.9097, lng: -87.7286, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "5532 S Kedzie Ave", lat: 41.79249, lng: -87.7037, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "819 E 71st St", lat: 41.7658, lng: -87.6036, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "1817 N Clark St", lat: 41.9159, lng: -87.6344, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "8740 S Vincennes St", lat: 41.73469, lng: -87.6459, approaches: ["SWB", "NEB"]),
    NativeCameraDef(type: "speed", address: "1455 W Grand Ave", lat: 41.891, lng: -87.6646, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "2310 E 103rd St", lat: 41.7081, lng: -87.5676, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "4118 N Ashland Ave", lat: 41.9568, lng: -87.669, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "3510 W 55th St", lat: 41.7935, lng: -87.7121, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "7115 N Sheridan Rd", lat: 42.0122, lng: -87.663, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "2716 W Logan Blvd", lat: 41.9286, lng: -87.6958, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "1341 W Jackson Blvd", lat: 41.8778, lng: -87.6611, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "4716 N Ashland", lat: 41.9676, lng: -87.6695, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "3665 N Austin Ave", lat: 41.9473, lng: -87.7765, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "5059 N Damen Ave", lat: 41.974, lng: -87.6793, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "6824 W Foster Ave", lat: 41.9756, lng: -87.7986, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "220 W Fullerton Ave", lat: 41.9258, lng: -87.6349, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "5432 N Central Ave", lat: 41.98, lng: -87.7683, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "5857 N Broadway", lat: 41.9887, lng: -87.6601, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "6151 N Sheridan Rd", lat: 41.9938, lng: -87.6554, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "7732 S Cottage Grove Ave", lat: 41.75372, lng: -87.60533, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "2650 W Peterson Ave", lat: 41.9906, lng: -87.6962, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3358 S Ashland Ave", lat: 41.83244, lng: -87.66575, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "6616 N Central Ave", lat: 42.0014, lng: -87.7625, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "441 E 71st St", lat: 41.76569, lng: -87.61362, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "8590 S Martin Luther King Dr", lat: 41.7386, lng: -87.6147, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "1635 N LaSalle", lat: 41.9122, lng: -87.633, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "49 W 85th St", lat: 41.73991, lng: -87.62662, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "5941 N Nagle", lat: 41.99002, lng: -87.78753, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "614 W 47th Street", lat: 41.80901, lng: -87.6416, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "1477 W. Cermak Rd", lat: 41.8523, lng: -87.6631, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "147 S Desplaines St", lat: 41.8799, lng: -87.644, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "6201 S Pulaski Rd", lat: 41.78033, lng: -87.72263, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "4021 W Belmont Ave", lat: 41.939, lng: -87.72888, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "6198 S Pulaski Rd", lat: 41.78037, lng: -87.72297, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "812 S Racine Ave", lat: 41.87141, lng: -87.6569, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "216 S Jefferson St", lat: 41.87876, lng: -87.64267, approaches: ["NB"]),
    NativeCameraDef(type: "speed", address: "2948 W 47th St", lat: 41.80827, lng: -87.69862, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "4298 w 59th St", lat: 41.78593, lng: -87.7301, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "2718 S Kedzie Ave", lat: 41.84211, lng: -87.7051, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "851 W 103rd St", lat: 41.70684, lng: -87.6448, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "3624 S Western Ave", lat: 41.8278, lng: -87.6851, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "200 S Michigan Ave", lat: 41.87944, lng: -87.62452, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "2711 N Pulaski", lat: 41.9307, lng: -87.7269, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "451 E Grand Ave", lat: 41.89179, lng: -87.61597, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "5050 W Fullerton Ave", lat: 41.9242, lng: -87.7534, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "2622 N. Laramie Ave", lat: 41.92859, lng: -87.75641, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "4424 W Diversey Ave", lat: 41.93172, lng: -87.73789, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "8134 S Yates Blvd", lat: 41.74709, lng: -87.56623, approaches: ["NB", "SB"]),
    NativeCameraDef(type: "speed", address: "2740 S Archer Ave", lat: 41.8442, lng: -87.653, approaches: ["SEB", "NWB"]),
    NativeCameraDef(type: "speed", address: "504 W 69th Ave", lat: 41.76901, lng: -87.63818, approaches: ["EB", "WB"]),
    NativeCameraDef(type: "speed", address: "8550 S Lafayette Ave", lat: 41.7388, lng: -87.6256, approaches: ["SB"]),
    NativeCameraDef(type: "speed", address: "4451 W 79th St", lat: 41.74931, lng: -87.73281, approaches: ["EB"]),
    NativeCameraDef(type: "speed", address: "2448 Clybourn", lat: 41.9262, lng: -87.6709, approaches: ["SEB", "NWB"]),
    NativeCameraDef(type: "speed", address: "9618 S. Ewing", lat: 41.7207, lng: -87.5354, approaches: ["SB", "NB"]),
    NativeCameraDef(type: "speed", address: "385 Michigan Ave", lat: 41.87744, lng: -87.62408, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Central Avenue", lat: 41.92431, lng: -87.7661, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "800 North Western Ave", lat: 41.89543, lng: -87.6867, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "6400 West Fullerton Avenue", lat: 41.92356, lng: -87.78583, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "5600 West Diversey Avenue", lat: 41.93136, lng: -87.76588, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Addison", lat: 41.94665, lng: -87.6887, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Foster Ave", lat: 41.97598, lng: -87.6887, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3200 North Pulaski Rd", lat: 41.93935, lng: -87.72729, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "6000 W Addison Street", lat: 41.94574, lng: -87.77688, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "11900 South Halsted", lat: 41.67812, lng: -87.64206, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 West Diversey Avenue", lat: 41.93154, lng: -87.74614, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "6400 West Fullerton Avenue", lat: 41.92381, lng: -87.7847, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "7600 South Stony Island Avenue", lat: 41.75671, lng: -87.58561, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Ashland Avenue", lat: 41.92528, lng: -87.66819, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1 East 79th Street", lat: 41.75105, lng: -87.62419, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1300 W Irving Park Road", lat: 41.95432, lng: -87.66262, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Ashland Avenue", lat: 41.92499, lng: -87.66808, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "6300 South Kedzie Ave", lat: 41.77869, lng: -87.70305, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 North Kedzie Avenue", lat: 41.93878, lng: -87.70765, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "600 South Cicero Avenue", lat: 41.8735, lng: -87.74513, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "?200 N. Upper Wacker Dr", lat: 41.88547, lng: -87.63681, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 West 55th Street", lat: 41.79345, lng: -87.70393, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "5500 S. Pulaski", lat: 41.7937, lng: -87.72329, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5075 West Montrose Avenue", lat: 41.96066, lng: -87.75406, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "400 West Belmont Ave", lat: 41.94017, lng: -87.6389, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "7100 South Cottage Grove Avenue", lat: 41.76515, lng: -87.60543, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "150 North Sacramento Boulevard", lat: 41.89529, lng: -87.70209, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3700 West Irving Park Road", lat: 41.95376, lng: -87.719, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "8700 South Vincennes", lat: 41.73643, lng: -87.6451, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Diversey Avenue", lat: 41.93177, lng: -87.72741, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3600 North Harlem Avenue", lat: 41.94493, lng: -87.80688, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4400 North Western Avenue", lat: 41.961, lng: -87.68862, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4700 S. Western Avenue", lat: 41.80813, lng: -87.6843, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 North Lakeshore Drive", lat: 41.94035, lng: -87.63887, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5500 South Kedzie Avenue", lat: 41.79373, lng: -87.70362, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1200 West Devon Ave", lat: 41.99813, lng: -87.66099, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4000 N Clark Street", lat: 41.95417, lng: -87.66199, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "848 West 87th Street", lat: 41.73602, lng: -87.64556, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4800 West Chicago Avenue", lat: 41.89494, lng: -87.74609, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "6300 South Pulaski Rd", lat: 41.77891, lng: -87.72291, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4400 West Ogden Avenue", lat: 41.84747, lng: -87.73476, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4800 North Western Avenue", lat: 41.96898, lng: -87.68897, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4440 West Lawrence Avenue", lat: 41.96817, lng: -87.73976, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1600 East 79th St", lat: 41.75155, lng: -87.58502, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "0 N. Ashland Ave", lat: 41.88122, lng: -87.66663, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "7100 S. Ashland", lat: 41.76456, lng: -87.66366, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2000 West Division", lat: 41.90316, lng: -87.67749, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "800 West 79th Street", lat: 41.75059, lng: -87.64443, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "800 West Fullerton Avenue", lat: 41.92549, lng: -87.64842, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4000 W. 55th St", lat: 41.79326, lng: -87.72274, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "5930 N Clark Street", lat: 41.98922, lng: -87.66979, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1600 West 87th St", lat: 41.73582, lng: -87.66262, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2000 East 95th St", lat: 41.72249, lng: -87.57581, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Foster Ave", lat: 41.97559, lng: -87.72792, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1200 North Pulaski Road", lat: 41.9025, lng: -87.72621, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "800 West North Avenue", lat: 41.91095, lng: -87.64784, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2800 N Western Avenue", lat: 41.93182, lng: -87.6878, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "800 North Central Avenue", lat: 41.89513, lng: -87.7655, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2400 West North Ave", lat: 41.91026, lng: -87.68769, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3200 West Armitage Avenue", lat: 41.91744, lng: -87.70668, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1200 South Canal Street", lat: 41.86693, lng: -87.63912, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Armitage Avenue", lat: 41.9172, lng: -87.72625, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "7900 S. South Chicago Ave", lat: 41.75126, lng: -87.5851, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "100 West Chicago Avenue", lat: 41.89659, lng: -87.63142, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "5600 West Fullerton Avenue", lat: 41.92414, lng: -87.7656, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3200 W. Belmont", lat: 41.93968, lng: -87.70771, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Western Avenue", lat: 41.92459, lng: -87.68757, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 West 47th ST", lat: 41.80821, lng: -87.70362, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3200 N. Kedzie Ave", lat: 41.93945, lng: -87.7078, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "6400 North California Avenue", lat: 41.9973, lng: -87.69958, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2348 South Kostner Avenue", lat: 41.84804, lng: -87.73451, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4000 W Lawrence Avenue", lat: 41.96819, lng: -87.72843, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "1600 N. Kostner", lat: 41.90956, lng: -87.73627, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1600 West Lawrence Avenue", lat: 41.96882, lng: -87.66992, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4800 West Peterson Avenue", lat: 41.99, lng: -87.74784, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2800 North Central Avenue", lat: 41.93157, lng: -87.76635, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "7200 West Addison", lat: 41.9452, lng: -87.8075, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3000 West Chicago Avenue", lat: 41.89564, lng: -87.70195, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4400 W. North", lat: 41.90973, lng: -87.73652, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "9900 South Halsted St", lat: 41.71402, lng: -87.6428, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1600 North Western Ave", lat: 41.91014, lng: -87.68715, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "6400 North Western Avenue", lat: 41.99745, lng: -87.6898, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "30 West 87th Street", lat: 41.7362, lng: -87.62583, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2800 West Diversey", lat: 41.92331, lng: -87.69719, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1900 North Ashland Ave", lat: 41.9159, lng: -87.66777, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 West 63rd St", lat: 41.77921, lng: -87.68403, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2000 W Diversey Parkway", lat: 41.9323, lng: -87.67803, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2000 North Kedzie Avenue", lat: 41.91757, lng: -87.70707, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "7200 North Western Avenue", lat: 42.01199, lng: -87.69015, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2800 West Devon Avenue", lat: 41.99752, lng: -87.69997, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2800 North Cicero Avenue", lat: 41.93127, lng: -87.74651, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4200 South Cicero Avenue", lat: 41.81709, lng: -87.74322, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "5200 North Broadway St", lat: 41.97605, lng: -87.65979, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 W Diversey Avenue", lat: 41.93229, lng: -87.68739, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Belmont Ave", lat: 41.93901, lng: -87.72757, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Cermak Road", lat: 41.85196, lng: -87.68613, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "6000 North Cicero Avenue", lat: 41.9903, lng: -87.74836, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Montrose Avenue", lat: 41.96135, lng: -87.6883, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "8700 South Lafayette Avenue", lat: 41.73666, lng: -87.62552, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2600 South Kedzie Avenue", lat: 41.84478, lng: -87.70512, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 West Harrison Street", lat: 41.87305, lng: -87.74539, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3200 North Harlem Ave", lat: 41.93766, lng: -87.80668, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1000 West Foster Ave", lat: 41.97645, lng: -87.65452, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3600 North Cicero Avenue", lat: 41.94579, lng: -87.74696, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1 East 75th Street", lat: 41.75823, lng: -87.62424, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "800 West Roosevelt Road", lat: 41.86703, lng: -87.64739, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "5600 West Belmont Avenue", lat: 41.93868, lng: -87.76606, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4000 N Central Avenue", lat: 41.95348, lng: -87.76704, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1600 North Homan Avenue", lat: 41.90982, lng: -87.71185, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "800 North Sacramento Avenue", lat: 41.88375, lng: -87.70118, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3216 West Addison St", lat: 41.94653, lng: -87.70919, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4700 South Cicero Ave", lat: 41.80796, lng: -87.74333, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5000 South Archer Ave", lat: 41.80194, lng: -87.72385, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Clark St", lat: 41.92504, lng: -87.64018, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "5930 N Clark Street", lat: 41.99019, lng: -87.67017, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2400 West 79th St", lat: 41.75014, lng: -87.6824, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3600 North Elston Ave", lat: 41.94686, lng: -87.70926, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "6400 North Sheridan Road", lat: 41.99852, lng: -87.66062, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "?628 N. Michigan Ave", lat: 41.89368, lng: -87.62433, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2400 N Laramie Avenue", lat: 41.92385, lng: -87.75611, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4800 North Elston Avenue", lat: 41.9679, lng: -87.73976, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5200 West Madison Street", lat: 41.88026, lng: -87.75554, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1200 South Pulaski Road", lat: 41.86586, lng: -87.72508, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4000 North Pulaski Road", lat: 41.95398, lng: -87.72769, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1 S. Western Ave", lat: 41.88092, lng: -87.68626, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "?300 S. Michigan Ave", lat: 41.87795, lng: -87.62412, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1600 West Cortland St", lat: 41.91607, lng: -87.66832, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "9500 South Jeffery Ave", lat: 41.72281, lng: -87.57541, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "3500 S. Western", lat: 41.83059, lng: -87.68515, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "500 North Columbus Drive", lat: 41.89073, lng: -87.62014, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "500 West Roosevelt Road", lat: 41.86737, lng: -87.6387, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "500 North Columbus Drive", lat: 41.89121, lng: -87.62023, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3600 North Western Avenue", lat: 41.94652, lng: -87.68803, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "100 North Cicero Avenue", lat: 41.88216, lng: -87.74545, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "6700 South Western Avenue", lat: 41.77225, lng: -87.68358, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1200 S. Kostner", lat: 41.86578, lng: -87.73486, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "5200 West Irving Park Road", lat: 41.95338, lng: -87.75672, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2000 West Division", lat: 41.90323, lng: -87.67686, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "6400 North Western Avenue", lat: 41.99803, lng: -87.68997, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5200 South Cicero Ave", lat: 41.79817, lng: -87.74373, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 West 63rd St", lat: 41.77903, lng: -87.70277, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "800 West 111th St", lat: 41.69254, lng: -87.64193, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3100 S Dr Martin L King", lat: 41.83813, lng: -87.61723, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4800 N Pulaski Road", lat: 41.96852, lng: -87.72811, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "6300 South Damen Avenue", lat: 41.77954, lng: -87.67397, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4400 W. Roosevelt", lat: 41.86595, lng: -87.73539, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "7200 North Western Avenue", lat: 42.0126, lng: -87.69031, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2200 S. Pulaski", lat: 41.85195, lng: -87.72489, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "100 West Chicago Avenue", lat: 41.89667, lng: -87.63101, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Pulaski Rd", lat: 41.92416, lng: -87.72677, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Chicago Ave", lat: 41.8957, lng: -87.68737, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "1 North Halsted Street", lat: 41.88207, lng: -87.64748, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5200 North Sheridan Road", lat: 41.97666, lng: -87.65504, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "300 North Hamlin Avenue", lat: 41.88494, lng: -87.72081, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1000 West Hollywood Ave", lat: 41.98561, lng: -87.65477, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4700 West Irving Park Road", lat: 41.95356, lng: -87.74428, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "6300 South Damen Avenue", lat: 41.77903, lng: -87.67381, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Van Buren Street", lat: 41.87617, lng: -87.68575, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2400 W. Madison", lat: 41.88125, lng: -87.68591, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "800 West Roosevelt Road", lat: 41.86728, lng: -87.64644, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "6000 North California Avenue", lat: 41.99013, lng: -87.69936, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1200 North Ashland Avenue", lat: 41.90305, lng: -87.66736, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3400 West North Ave", lat: 41.91002, lng: -87.7121, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "7600 South Stony Island Avenue", lat: 41.75717, lng: -87.58617, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "3200 West 79th St", lat: 41.74964, lng: -87.70275, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Lawrence Avenue", lat: 41.96856, lng: -87.68937, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Irving Park Rd", lat: 41.95372, lng: -87.72724, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1000 West Hollywood Ave", lat: 41.98548, lng: -87.65564, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "7432 West Touhy Avenue", lat: 42.01161, lng: -87.81185, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "5500 South Wentworth Avenue", lat: 41.79383, lng: -87.63034, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 North Central Avenue", lat: 41.93893, lng: -87.76666, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Armitage Avenue", lat: 41.91713, lng: -87.72678, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4000 West 63rd St", lat: 41.7786, lng: -87.72325, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "7100 South Cottage Grove Avenue", lat: 41.76633, lng: -87.60571, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Roosevelt Road", lat: 41.86627, lng: -87.72473, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "5200 N. Nagle", lat: 41.97543, lng: -87.7877, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1600 N Pulaski Avenue", lat: 41.90967, lng: -87.72636, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5400 South Archer Ave", lat: 41.79887, lng: -87.74237, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "150 North Sacramento Boulevard", lat: 41.8844, lng: -87.7014, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "7900 South Western Ave", lat: 41.74973, lng: -87.6827, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "7900 South Kedzie Ave", lat: 41.75017, lng: -87.70255, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4000 N Austin Avenue", lat: 41.95277, lng: -87.77671, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "?5200 N. Northwest Hwy", lat: 41.97592, lng: -87.76981, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2800 West Irving Park Road", lat: 41.95387, lng: -87.69863, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "1600 W. Madison", lat: 41.88156, lng: -87.6664, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "200 West Garfield Blvd", lat: 41.79446, lng: -87.63011, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "6700 South Stony Island Ave", lat: 41.77319, lng: -87.58617, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1600 West Division Street", lat: 41.90332, lng: -87.66781, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 W. Peterson", lat: 41.99099, lng: -87.68974, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "7100 South Kedzie Avenue", lat: 41.76468, lng: -87.7029, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Halsted Street", lat: 41.9251, lng: -87.64868, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "7500 South State Street", lat: 41.75788, lng: -87.62489, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "7900 South Stony Island Ave", lat: 41.75203, lng: -87.5859, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 W North Avenue", lat: 41.9095, lng: -87.74644, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3800 West Madison Street", lat: 41.88071, lng: -87.72117, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2800 West Peterson Avenue", lat: 41.99039, lng: -87.69978, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2000 North Cicero Avenue", lat: 41.91675, lng: -87.74604, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "1 South Halsted Street", lat: 41.8815, lng: -87.64725, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "6000 N. Western Ave", lat: 41.99057, lng: -87.68892, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "9500 South Halsted Street", lat: 41.72211, lng: -87.64359, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "6300 South State St", lat: 41.78026, lng: -87.6254, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 West Fullerton Ave", lat: 41.92431, lng: -87.74588, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "5600 W Irving Park Road", lat: 41.95313, lng: -87.76743, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "5200 West Madison Street", lat: 41.8805, lng: -87.75465, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Western Avenue", lat: 41.92524, lng: -87.6878, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1200 West Foster Ave", lat: 41.97626, lng: -87.66029, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3600 North Central Avenue", lat: 41.94606, lng: -87.76672, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 West 47th St", lat: 41.80774, lng: -87.74265, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4000 W North Avenue", lat: 41.9099, lng: -87.726, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2800 North Kimball Avenue", lat: 41.93172, lng: -87.71224, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4000 West 79th Street", lat: 41.74961, lng: -87.72139, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "6000 W Irving Park Road", lat: 41.95299, lng: -87.77715, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "1600 North Halsted Street", lat: 41.91061, lng: -87.6482, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2800 North California Ave", lat: 41.93188, lng: -87.69745, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "6000 W Diversey Avenue", lat: 41.93103, lng: -87.77638, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "7900 South State Street", lat: 41.75069, lng: -87.62512, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "5600 West Lake Street", lat: 41.88771, lng: -87.76539, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "6700 South Cornell Drive", lat: 41.77311, lng: -87.58586, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "?100 E. Ontario St", lat: 41.89335, lng: -87.6237, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "5500 S Western Ave", lat: 41.79419, lng: -87.68421, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "7900 South Pulaski Road", lat: 41.74985, lng: -87.72204, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2000 West Fullerton Ave", lat: 41.92494, lng: -87.67859, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "6400 North Milwaukee Avenue", lat: 41.99763, lng: -87.78822, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2800 North Pulaski Road", lat: 41.93207, lng: -87.72703, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "800 W. DIVISION", lat: 41.90368, lng: -87.6477, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "5200 North Pulaski Rd", lat: 41.97583, lng: -87.72831, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 North Cicero Ave", lat: 41.9676, lng: -87.74766, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 West 71st Street", lat: 41.76445, lng: -87.70238, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1600 W. 71st", lat: 41.76495, lng: -87.66336, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "?5232 N. Central Ave", lat: 41.97706, lng: -87.7685, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5600 West Chicago Avenue", lat: 41.89479, lng: -87.76558, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "6000 W Diversey Avenue", lat: 41.93119, lng: -87.77562, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3100 South Kedzie Avenue", lat: 41.83753, lng: -87.70493, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4400 West Grand Ave", lat: 41.9101, lng: -87.73653, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1600 West 95th Street", lat: 41.72109, lng: -87.66314, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2426 North Damen Ave", lat: 41.9261, lng: -87.67801, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "3400 West Diversey Avenue", lat: 41.93192, lng: -87.71264, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "7432 West Touhy Avenue", lat: 42.01151, lng: -87.81262, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "5200 West Irving Park Road", lat: 41.95322, lng: -87.75741, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4700 S. Western Avenue", lat: 41.80873, lng: -87.68457, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "300 North Hamlin Avenue", lat: 41.8855, lng: -87.72103, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "?340 W. Upper?Wacker Dr", lat: 41.88597, lng: -87.63743, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "6400 W. Irving Pk", lat: 41.95289, lng: -87.78691, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Cicero Ave", lat: 41.92458, lng: -87.74644, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Fullerton Ave", lat: 41.92461, lng: -87.72642, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "3600 North Cicero Avenue", lat: 41.94636, lng: -87.74715, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4000 West Chicago Avenue", lat: 41.89532, lng: -87.72632, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "5200 North Western Ave", lat: 41.97613, lng: -87.68922, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 North Cicero Avenue", lat: 41.96832, lng: -87.74765, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5000 South Archer Ave", lat: 41.80269, lng: -87.72302, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "2600 South Kedzie Avenue", lat: 41.84408, lng: -87.70494, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 West Marquette Road", lat: 41.77203, lng: -87.68299, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1200 N. HALSTED", lat: 41.90335, lng: -87.64802, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "6400 W. Irving Pk", lat: 41.95301, lng: -87.78627, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "?5616 W. Foster Ave", lat: 41.97561, lng: -87.76988, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "9500 South Halsted Street", lat: 41.72126, lng: -87.64299, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "400 North Central Avenue", lat: 41.88794, lng: -87.76513, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "1200 North Pulaski Road", lat: 41.9029, lng: -87.72635, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2200 South Western Avenue", lat: 41.85273, lng: -87.68579, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "6400 W. Foster", lat: 41.9757, lng: -87.78743, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "7200 West Belmont Ave", lat: 41.93807, lng: -87.80636, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4700 West Irving Park Road", lat: 41.95334, lng: -87.7451, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "2800 West Diversey", lat: 41.93207, lng: -87.698, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "6400 West Devon Avenue", lat: 41.99739, lng: -87.78737, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4700 South Kedzie Ave", lat: 41.80782, lng: -87.70386, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "100 North Cicero Avenue", lat: 41.88148, lng: -87.74521, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "?100 E. Jackson Blvd", lat: 41.87823, lng: -87.62485, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3500 S. Western", lat: 41.83, lng: -87.6849, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "3200 West 31st Street", lat: 41.83732, lng: -87.70445, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1600 West Irving Park Road", lat: 41.95419, lng: -87.6695, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4000 W. Cermak", lat: 41.85172, lng: -87.72434, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4400 North Milwaukee Avenue", lat: 41.96043, lng: -87.75419, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "5600 West Addison Street", lat: 41.94582, lng: -87.76717, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "4000 North Ashland Avenue", lat: 41.95401, lng: -87.66889, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "11100 South Halsted St", lat: 41.69259, lng: -87.64251, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "800 North Pulaski Road", lat: 41.89562, lng: -87.7261, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4800 West Armitage Avenue", lat: 41.91687, lng: -87.74654, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "6300 South Western Ave", lat: 41.77893, lng: -87.68351, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4800 W North Avenue", lat: 41.90972, lng: -87.74573, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "800 West 99th St", lat: 41.714, lng: -87.64329, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "800 West 119th Street", lat: 41.67786, lng: -87.64154, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "0 North Hamlin Boulevard", lat: 41.8805, lng: -87.72058, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2800 West Irving Park Road", lat: 41.95409, lng: -87.69779, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "1 East 63rd St", lat: 41.78008, lng: -87.62507, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "7900 South Halsted Street", lat: 41.75044, lng: -87.64395, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "400 East 31st Street", lat: 41.83835, lng: -87.61806, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "5200 W Fullerton Avenue", lat: 41.92421, lng: -87.75571, approaches: ["WB"]),
    NativeCameraDef(type: "redlight", address: "4800 North Ashland Avenue", lat: 41.96914, lng: -87.66957, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2400 W 55th Street", lat: 41.79378, lng: -87.68451, approaches: ["EB"]),
    NativeCameraDef(type: "redlight", address: "3600 N Austin Avenue", lat: 41.94599, lng: -87.77642, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "4000 North Elston Avenue", lat: 41.95405, lng: -87.71979, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "8700 South Ashland Ave", lat: 41.73609, lng: -87.66307, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "9500 South Ashland Avenue", lat: 41.72157, lng: -87.66285, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "800 North Cicero Avenue", lat: 41.89484, lng: -87.74573, approaches: ["NB"]),
    NativeCameraDef(type: "redlight", address: "2400 North Clark St", lat: 41.92575, lng: -87.64063, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "2800 N Damen Avenue", lat: 41.93248, lng: -87.67814, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "?5232 N. Milwaukee Ave", lat: 41.97672, lng: -87.76878, approaches: ["SEB"]),
    NativeCameraDef(type: "redlight", address: "400 South Western Avenue", lat: 41.87651, lng: -87.68647, approaches: ["SB"]),
    NativeCameraDef(type: "redlight", address: "4200 South Cicero Avenue", lat: 41.81737, lng: -87.7436, approaches: ["SB"]),
    // CAMERA_ENTRIES_END
  ]
  // CAMERA_DATA_END (generated)

  private func maybeSendNativeCameraAlert(_ location: CLLocation) {
    guard cameraAlertsEnabled else { return }
    let speed = location.speed
    let heading = location.course  // -1 if invalid
    let lat = location.coordinate.latitude
    let lng = location.coordinate.longitude
    let acc = location.horizontalAccuracy

    // Require at least somewhat-credible GPS in background before alerting
    if acc <= 0 || acc > 120 { return }

    // Dedupe overall announcements
    if let last = lastCameraAlertAt, Date().timeIntervalSince(last) < camAnnounceMinIntervalSec {
      return
    }

    // Clear cooldowns for cameras we've moved far away from
    for (idx, _) in alertedCameraAtByIndex {
      let cam = Self.chicagoCameras[idx]
      let dist = haversineMeters(lat1: lat, lon1: lng, lat2: cam.lat, lon2: cam.lng)
      if dist > camCooldownRadiusMeters {
        alertedCameraAtByIndex.removeValue(forKey: idx)
      }
    }

    let alertRadius = cameraAlertRadiusMeters(speedMps: speed)

    // Bounding box filter
    let latMin = lat - camBBoxDegrees
    let latMax = lat + camBBoxDegrees
    let lngMin = lng - camBBoxDegrees
    let lngMax = lng + camBBoxDegrees

    var bestIdx: Int? = nil
    var bestDist: Double = Double.greatestFiniteMagnitude
    var nearestRejectedIdx: Int? = nil
    var nearestRejectedDist: Double = Double.greatestFiniteMagnitude
    var nearestRejectedReason: String? = nil
    let rejectDebugRadius = max(alertRadius * 1.4, 220)

    for i in 0..<Self.chicagoCameras.count {
      let cam = Self.chicagoCameras[i]

      // Type + schedule filters
      if cam.type == "speed" {
        guard cameraSpeedEnabled else { continue }
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < speedCamEnforceStartHour || hour >= speedCamEnforceEndHour { continue }
      } else {
        guard cameraRedlightEnabled else { continue }
      }

      // Fast bbox
      if cam.lat < latMin || cam.lat > latMax { continue }
      if cam.lng < lngMin || cam.lng > lngMax { continue }

      let dist = haversineMeters(lat1: lat, lon1: lng, lat2: cam.lat, lon2: cam.lng)
      let minSpeed = (cam.type == "speed") ? camMinSpeedSpeedCamMps : camMinSpeedRedlightMps
      let perCameraDeduped = alertedCameraAtByIndex[i].map { Date().timeIntervalSince($0) < camAlertDedupeSec } ?? false
      let headingOk = isHeadingMatch(headingDeg: heading, approaches: cam.approaches)
      let aheadOk = isCameraAhead(userLat: lat, userLng: lng, camLat: cam.lat, camLng: cam.lng, headingDeg: heading)

      var rejectReason: String? = nil
      if speed >= 0 && speed < minSpeed {
        rejectReason = "speed_below_min"
      } else if dist > alertRadius {
        rejectReason = "outside_radius"
      } else if perCameraDeduped {
        rejectReason = "per_camera_dedupe"
      } else if !headingOk {
        rejectReason = "heading_mismatch"
      } else if !aheadOk {
        rejectReason = "camera_not_ahead"
      }

      if let reason = rejectReason {
        if dist <= rejectDebugRadius && dist < nearestRejectedDist {
          nearestRejectedIdx = i
          nearestRejectedDist = dist
          nearestRejectedReason = reason
        }
        continue
      }

      if dist < bestDist {
        bestDist = dist
        bestIdx = i
      }
    }

    guard let idx = bestIdx else {
      if let rIdx = nearestRejectedIdx,
         let reason = nearestRejectedReason {
        if reason == "speed_below_min" {
          tripSummaryCameraRejectSpeedLow += 1
        } else if reason == "outside_radius" {
          tripSummaryCameraRejectRadius += 1
        } else if reason == "heading_mismatch" {
          tripSummaryCameraRejectHeading += 1
        } else if reason == "camera_not_ahead" {
          tripSummaryCameraRejectAhead += 1
        } else if reason == "per_camera_dedupe" {
          tripSummaryCameraRejectDedupe += 1
        }
        let shouldLog = lastCameraRejectLogAt.map { Date().timeIntervalSince($0) >= camRejectLogCooldownSec } ?? true
        if shouldLog {
          lastCameraRejectLogAt = Date()
          let cam = Self.chicagoCameras[rIdx]
          decision("native_camera_candidate_rejected", [
            "idx": rIdx,
            "type": cam.type,
            "address": cam.address,
            "reason": reason,
            "distanceMeters": nearestRejectedDist,
            "alertRadiusMeters": alertRadius,
            "speedMps": speed,
            "heading": heading,
            "accuracy": acc,
          ])
        }
      }
      return
    }
    let cam = Self.chicagoCameras[idx]

    // Local notification + spoken TTS alert
    let title = cam.type == "redlight" ? "Red-light camera ahead" : "Speed camera ahead"
    let body = cam.address
    scheduleCameraLocalNotification(title: title, body: body, id: "cam-\(idx)")
    speakCameraAlert(title)

    // For red light cameras: capture evidence (accelerometer + GPS) natively.
    // JS may be suspended in background, so save to UserDefaults for JS to retrieve later.
    if cam.type == "redlight" {
      captureRedLightEvidenceNatively(cam: cam, speed: speed, heading: heading, accuracy: acc, distance: bestDist)
    }

    alertedCameraAtByIndex[idx] = Date()
    lastCameraAlertAt = Date()
    tripSummaryCameraAlertCount += 1
    decision("native_camera_alert_fired", [
      "idx": idx,
      "type": cam.type,
      "address": cam.address,
      "distanceMeters": bestDist,
      "alertRadiusMeters": alertRadius,
      "speedMps": speed,
      "heading": heading,
      "accuracy": acc,
    ])
    log("NATIVE CAMERA ALERT: \(title) @ \(cam.address) (dist=\(Int(bestDist))m, radius=\(Int(alertRadius))m)")
  }

  private func cameraAlertRadiusMeters(speedMps: Double) -> Double {
    if speedMps < 0 { return camBaseAlertRadiusMeters }
    let dynamic = speedMps * camTargetWarningSec
    return max(camBaseAlertRadiusMeters, min(dynamic, camMaxAlertRadiusMeters))
  }

  private func scheduleCameraLocalNotification(title: String, body: String, id: String) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let allowed = settings.authorizationStatus == .authorized ||
                    settings.authorizationStatus == .provisional ||
                    settings.authorizationStatus == .ephemeral
      if !allowed {
        self.log("Camera notification skipped: notifications not authorized (status=\(settings.authorizationStatus.rawValue))")
        return
      }

      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      // Only play notification sound if app is in foreground (where native TTS doesn't speak).
      // In background, native TTS speaks the alert — the notification chime would overlap
      // and be redundant. The visual banner is still delivered without sound.
      let appState = UIApplication.shared.applicationState
      if appState == .active {
        content.sound = UNNotificationSound.default
      }

      // Fire immediately (short delay to avoid iOS dropping same-tick notifications)
      let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
      let req = UNNotificationRequest(identifier: id + "-" + String(Int(Date().timeIntervalSince1970)), content: content, trigger: trigger)
      UNUserNotificationCenter.current().add(req) { err in
        if let err = err {
          self.log("Camera notification add failed: \(err.localizedDescription)")
        }
      }
    }
  }

  /// Configure the audio session for background TTS playback.
  /// Called eagerly when driving starts so the audio pipeline is ready before the first alert.
  /// Calling this lazily on the first alert adds ~200ms latency and risks iOS refusing
  /// the session change mid-background.
  private func configureSpeechAudioSession() {
    guard !speechAudioSessionConfigured else { return }
    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playback,
        mode: .voicePrompt,
        options: [.duckOthers]  // Lower music volume briefly instead of pausing it
      )
      speechAudioSessionConfigured = true
      log("Speech audio session configured for background TTS (.playback, .duckOthers)")

      // Listen for audio interruptions (phone calls, Siri, etc.)
      // After an interruption ends, re-configure so the next TTS alert works.
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(handleAudioInterruption),
        name: AVAudioSession.interruptionNotification,
        object: nil
      )
    } catch {
      log("Failed to configure speech audio session: \(error.localizedDescription)")
    }
  }

  @objc private func handleAudioInterruption(_ notification: Notification) {
    guard let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

    if type == .began {
      log("Native TTS: audio interrupted (phone call, Siri, etc.)")
      if speechSynthesizer.isSpeaking {
        speechSynthesizer.stopSpeaking(at: .immediate)
      }
    } else if type == .ended {
      log("Native TTS: audio interruption ended — reconfiguring session")
      // Reset flag so next speakCameraAlert re-configures if needed
      speechAudioSessionConfigured = false
      configureSpeechAudioSession()
    }
  }

  /// Speak a camera alert using native AVSpeechSynthesizer.
  /// This runs entirely in native Swift — it does NOT depend on JS (which iOS suspends
  /// in background). Combined with UIBackgroundModes "audio" and .playback audio session,
  /// this allows spoken alerts even when the app is backgrounded.
  ///
  /// Only speaks when the app is backgrounded or inactive. In foreground, JS
  /// CameraAlertService handles TTS via SpeechModule to avoid double-speak.
  private func speakCameraAlert(_ message: String) {
    // Only speak natively when app is NOT in foreground.
    // In foreground, JS CameraAlertService handles TTS via SpeechModule.
    // Without this check, the user hears the same alert twice.
    let appState = UIApplication.shared.applicationState
    if appState == .active {
      log("Native TTS: skipping — app is in foreground (JS handles TTS)")
      return
    }

    // Configure audio session if not already done (safety net — should have been
    // done at driving start, but handle the case where driving detection was via
    // GPS fallback or app was killed and re-launched by significantLocationChange)
    configureSpeechAudioSession()
    guard speechAudioSessionConfigured else {
      log("Native TTS: cannot speak — audio session not configured")
      return
    }

    // Request a background task to prevent iOS from suspending us mid-speech.
    // AVSpeechSynthesizer takes 1-3 seconds; without this, iOS can suspend the
    // process between the speak() call and the didFinish delegate callback.
    if backgroundSpeechTaskId != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundSpeechTaskId)
    }
    backgroundSpeechTaskId = UIApplication.shared.beginBackgroundTask(withName: "CameraAlertSpeech") { [weak self] in
      // Expiration handler — iOS is about to suspend us
      self?.speechSynthesizer.stopSpeaking(at: .immediate)
      if let taskId = self?.backgroundSpeechTaskId, taskId != .invalid {
        UIApplication.shared.endBackgroundTask(taskId)
        self?.backgroundSpeechTaskId = .invalid
      }
      self?.log("Native TTS: background task expired — speech stopped")
    }

    // AVSpeechSynthesizer must be used from the main thread for reliable background playback
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }

      // Activate audio session
      do {
        try AVAudioSession.sharedInstance().setActive(true)
      } catch {
        self.log("Native TTS: failed to activate audio session: \(error.localizedDescription)")
        self.endBackgroundSpeechTask()
        return
      }

      // Stop any in-progress speech
      if self.speechSynthesizer.isSpeaking {
        self.speechSynthesizer.stopSpeaking(at: .immediate)
      }

      let utterance = AVSpeechUtterance(string: message)
      utterance.rate = 0.52  // Match JS SpeechModule rate — slightly fast but clear
      utterance.pitchMultiplier = 1.0
      utterance.volume = self.cameraAlertVolume
      if let voice = AVSpeechSynthesisVoice(language: "en-US") {
        utterance.voice = voice
      }

      self.speechSynthesizer.speak(utterance)
      self.log("Native TTS: speaking '\(message)' (appState=\(appState == .background ? "background" : "inactive"))")
    }
  }

  private func endBackgroundSpeechTask() {
    if backgroundSpeechTaskId != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundSpeechTaskId)
      backgroundSpeechTaskId = .invalid
    }
  }

  // MARK: - AVSpeechSynthesizerDelegate

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    // Deactivate audio session to restore user's music/podcast
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      log("Native TTS: speech finished, audio session deactivated")
    } catch {
      log("Native TTS: failed to deactivate audio session: \(error.localizedDescription)")
    }
    // End the background task now that speech is complete
    endBackgroundSpeechTask()
  }

  // MARK: - Native Red-Light Evidence Capture (background-safe)
  //
  // When JS is suspended in background, CameraAlertService.recordRedLightReceipt()
  // never runs. This native method captures accelerometer + GPS evidence and queues
  // it in UserDefaults. JS retrieves it on next wake via getPendingRedLightEvidence().

  private let kPendingRedLightEvidenceKey = "bg_pending_redlight_evidence_v1"

  private func captureRedLightEvidenceNatively(cam: NativeCameraDef, speed: Double, heading: Double, accuracy: Double, distance: Double) {
    let now = Date()
    let ts = now.timeIntervalSince1970 * 1000  // ms for JS compatibility

    // 1. Snapshot accelerometer buffer (last 30 seconds)
    accelBufferLock.lock()
    let rawBuffer = self.accelBuffer
    accelBufferLock.unlock()

    let accelCutoff = (rawBuffer.last?.timestamp ?? 0) - 30.0
    let recentAccel = rawBuffer.filter { $0.timestamp >= accelCutoff }

    // Build accelerometer trace as array of dictionaries (matches JS AccelerometerDataPoint)
    let accelTrace: [[String: Any]] = recentAccel.map { entry in
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

    // 2. Calculate peak deceleration (same logic as JS calculatePeakDeceleration)
    var peakG: Double = 0
    for entry in recentAccel {
      let horizontalG = sqrt(entry.x * entry.x + entry.y * entry.y)
      if horizontalG > abs(peakG) {
        peakG = entry.y < 0 ? -horizontalG : horizontalG
      }
    }

    // 3. Build GPS trace point from current location
    let speedMps = max(speed, 0)
    let speedMph = speedMps * 2.2369362920544
    let loc = locationManager.location
    let gpsTrace: [[String: Any]] = [
      [
        "timestamp": ts,
        "latitude": loc?.coordinate.latitude ?? cam.lat,
        "longitude": loc?.coordinate.longitude ?? cam.lng,
        "speedMps": speedMps,
        "speedMph": round(speedMph * 10) / 10,
        "heading": heading,
        "horizontalAccuracyMeters": accuracy,
      ]
    ]

    // 4. Build receipt-compatible payload
    let receiptId = "\(Int(ts))-\(String(format: "%.5f", cam.lat))-\(String(format: "%.5f", cam.lng))"
    let intersectionId = "\(String(format: "%.4f", cam.lat)),\(String(format: "%.4f", cam.lng))"
    let postedSpeedMph = 30  // Chicago street default
    let expectedYellowSec = postedSpeedMph <= 30 ? 3.0 : 4.0

    let receipt: [String: Any] = [
      "id": receiptId,
      "deviceTimestamp": ts,
      "cameraAddress": cam.address,
      "cameraLatitude": cam.lat,
      "cameraLongitude": cam.lng,
      "intersectionId": intersectionId,
      "heading": heading,
      "approachSpeedMph": round(speedMph * 10) / 10,
      "minSpeedMph": round(speedMph * 10) / 10,  // single point, same as approach
      "speedDeltaMph": 0,
      "fullStopDetected": false,  // can't detect from single GPS point
      "trace": gpsTrace,
      "accelerometerTrace": accelTrace,
      "peakDecelerationG": round(peakG * 1000) / 1000,
      "expectedYellowDurationSec": expectedYellowSec,
      "postedSpeedLimitMph": postedSpeedMph,
      "distanceMeters": distance,
      "_capturedNatively": true,
      "_persistedAt": now.timeIntervalSince1970,
    ]

    // 5. Append to pending queue (array — multiple cameras can be passed in one drive)
    var queue = UserDefaults.standard.array(forKey: kPendingRedLightEvidenceKey) as? [[String: Any]] ?? []
    queue.append(receipt)
    // Cap at 20 to avoid unbounded growth
    if queue.count > 20 {
      queue = Array(queue.suffix(20))
    }
    UserDefaults.standard.set(queue, forKey: kPendingRedLightEvidenceKey)

    log("Native red-light evidence captured: \(cam.address) (\(accelTrace.count) accel samples, speed=\(String(format: "%.1f", speedMph))mph, peakG=\(String(format: "%.3f", peakG)))")
  }

  /// JS bridge: retrieve all pending red-light evidence captured natively while JS was suspended.
  @objc func getPendingRedLightEvidence(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let queue = UserDefaults.standard.array(forKey: kPendingRedLightEvidenceKey) as? [[String: Any]] ?? []
    if queue.isEmpty {
      resolve([])
    } else {
      // Expire entries older than 24 hours
      let now = Date().timeIntervalSince1970
      let fresh = queue.filter { entry in
        guard let persistedAt = entry["_persistedAt"] as? Double else { return false }
        return (now - persistedAt) < 86400  // 24 hours
      }
      if fresh.count != queue.count {
        UserDefaults.standard.set(fresh, forKey: kPendingRedLightEvidenceKey)
        log("Expired \(queue.count - fresh.count) stale red-light evidence entries")
      }
      log("Returning \(fresh.count) pending native red-light evidence entries to JS")
      resolve(fresh)
    }
  }

  /// JS bridge: acknowledge that pending red-light evidence has been processed.
  @objc func acknowledgeRedLightEvidence(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    UserDefaults.standard.removeObject(forKey: kPendingRedLightEvidenceKey)
    log("Cleared pending red-light evidence from UserDefaults")
    resolve(true)
  }

  /// JS bridge: test background TTS for App Store review.
  /// Schedules a spoken alert after `delaySec` seconds so the reviewer can
  /// background the app and hear it speak.  Also fires a local notification.
  @objc func testBackgroundTTS(_ delaySec: Double, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let delay = max(delaySec, 1)
    log("testBackgroundTTS: will speak in \(delay)s")

    // Configure audio session eagerly (same as driving start)
    configureSpeechAudioSession()

    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
      guard let self = self else { return }

      // Fire a local notification (visible even if app is backgrounded)
      let content = UNMutableNotificationContent()
      content.title = "Red-light camera ahead"
      content.body = "W Fullerton Ave & N Milwaukee Ave — this is a test alert"
      content.sound = nil  // TTS provides the audio
      let request = UNNotificationRequest(identifier: "test-bg-tts", content: content, trigger: nil)
      UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)

      // Speak using forceSpeak (bypasses foreground check — the reviewer may
      // still be transitioning to background when the timer fires)
      self.forceSpeakCameraAlert("Red-light camera ahead. W Fullerton Ave and N Milwaukee Ave.")
      self.log("testBackgroundTTS: fired test alert (appState=\(UIApplication.shared.applicationState == .active ? "active" : UIApplication.shared.applicationState == .background ? "background" : "inactive"))")
    }

    resolve(true)
  }

  /// Speak a camera alert regardless of foreground/background state.
  /// Used only for the App Store test flow.
  private func forceSpeakCameraAlert(_ message: String) {
    configureSpeechAudioSession()
    guard speechAudioSessionConfigured else {
      log("forceSpeakCameraAlert: audio session not configured")
      return
    }

    if backgroundSpeechTaskId != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundSpeechTaskId)
    }
    backgroundSpeechTaskId = UIApplication.shared.beginBackgroundTask(withName: "TestCameraAlertSpeech") { [weak self] in
      self?.speechSynthesizer.stopSpeaking(at: .immediate)
      if let taskId = self?.backgroundSpeechTaskId, taskId != .invalid {
        UIApplication.shared.endBackgroundTask(taskId)
      }
      self?.backgroundSpeechTaskId = .invalid
    }

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }

      if self.speechSynthesizer.isSpeaking {
        self.speechSynthesizer.stopSpeaking(at: .immediate)
      }

      do {
        try AVAudioSession.sharedInstance().setActive(true)
      } catch {
        self.log("forceSpeakCameraAlert: failed to activate audio session: \(error)")
      }

      let utterance = AVSpeechUtterance(string: message)
      utterance.rate = 0.52
      utterance.pitchMultiplier = 1.0
      utterance.volume = self.cameraAlertVolume
      if let voice = AVSpeechSynthesisVoice(language: "en-US") {
        utterance.voice = voice
      }

      self.speechSynthesizer.speak(utterance)
      self.log("forceSpeakCameraAlert: speaking '\(message)' at volume \(self.cameraAlertVolume)")
    }
  }

  private func haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
    let r = 6371000.0
    let dLat = (lat2 - lat1) * Double.pi / 180.0
    let dLon = (lon2 - lon1) * Double.pi / 180.0
    let a = sin(dLat/2) * sin(dLat/2) +
            cos(lat1 * Double.pi / 180.0) * cos(lat2 * Double.pi / 180.0) *
            sin(dLon/2) * sin(dLon/2)
    let c = 2 * atan2(sqrt(a), sqrt(1-a))
    return r * c
  }

  private func bearingTo(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
    let dLon = (lon2 - lon1) * Double.pi / 180.0
    let lat1R = lat1 * Double.pi / 180.0
    let lat2R = lat2 * Double.pi / 180.0
    let y = sin(dLon) * cos(lat2R)
    let x = cos(lat1R) * sin(lat2R) - sin(lat1R) * cos(lat2R) * cos(dLon)
    let brng = atan2(y, x) * 180.0 / Double.pi
    return fmod((brng + 360.0), 360.0)
  }

  private func isCameraAhead(userLat: Double, userLng: Double, camLat: Double, camLng: Double, headingDeg: Double) -> Bool {
    if headingDeg < 0 { return true }  // fail-open
    let bearing = bearingTo(lat1: userLat, lon1: userLng, lat2: camLat, lon2: camLng)
    var diff = abs(headingDeg - bearing)
    if diff > 180 { diff = 360 - diff }
    return diff <= camMaxBearingOffHeadingDeg
  }

  private func isHeadingMatch(headingDeg: Double, approaches: [String]) -> Bool {
    if headingDeg < 0 { return true }      // fail-open
    if approaches.isEmpty { return true }  // fail-open

    let mapping: [String: Double] = [
      "NB": 0,
      "NEB": 45,
      "EB": 90,
      "SEB": 135,
      "SB": 180,
      "SWB": 225,
      "WB": 270,
      "NWB": 315,
    ]

    for a in approaches {
      guard let target = mapping[a] else { return true } // unknown approach => fail-open
      var diff = abs(headingDeg - target)
      if diff > 180 { diff = 360 - diff }
      if diff <= camHeadingToleranceDeg { return true }
    }
    return false
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
    let lookback = now.addingTimeInterval(-6 * 60 * 60) // Check last 6 hours (app may have been killed for a long time)

    activityManager.queryActivityStarting(from: lookback, to: now, to: .main) { [weak self] activities, error in
      guard let self = self, let activities = activities, activities.count > 1 else { return }

      // ── Build a list of ALL drive→park trips from CoreMotion history ──
      // Each trip = (driveStart, driveEnd/parkTime, driveDuration)
      struct RecoveredTrip {
        let driveStart: Date
        let parkTime: Date       // When automotive ended (= parking started)
        let driveDuration: TimeInterval
      }
      var trips: [RecoveredTrip] = []
      var inAutomotiveSegment = false
      var segmentStart: Date? = nil

      for i in 0..<activities.count {
        let activity = activities[i]
        if activity.automotive {
          if !inAutomotiveSegment {
            inAutomotiveSegment = true
            segmentStart = activity.startDate
          }
        } else if inAutomotiveSegment {
          // Automotive segment just ended — this is a park event
          if let start = segmentStart {
            let parkTime = activity.startDate
            let duration = parkTime.timeIntervalSince(start)
            // Only count trips with meaningful driving (>10s to filter noise)
            if duration > 10 {
              trips.append(RecoveredTrip(driveStart: start, parkTime: parkTime, driveDuration: duration))
            }
          }
          inAutomotiveSegment = false
          segmentStart = nil
        }
      }

      // Check if the most recent activity is stationary/walking
      guard let lastActivity = activities.last else { return }
      let currentlyStationary = lastActivity.stationary || lastActivity.walking

      self.log("RECOVERY: Found \(trips.count) drive→park trips in last 6 hours. Currently: \(lastActivity.stationary ? "stationary" : lastActivity.walking ? "walking" : lastActivity.automotive ? "automotive" : "other")")
      for (idx, trip) in trips.enumerated() {
        self.log("RECOVERY:   Trip \(idx + 1): drive \(trip.driveStart) → parked \(trip.parkTime) (\(String(format: "%.0f", trip.driveDuration))s)")
      }

      guard !trips.isEmpty && currentlyStationary else {
        self.log("Recovery check: no missed parking (trips: \(trips.count), stationary: \(currentlyStationary))")
        // Force-restart CoreMotion
        if self.coreMotionActive {
          self.activityManager.stopActivityUpdates()
          self.coreMotionActive = false
        }
        self.startMotionActivityMonitoring()
        return
      }

      // ── Emit events for ALL trips ──
      // For intermediate trips: try to match with CLVisit coordinates (iOS
      // tracks dwell locations even when the app is killed). If a CLVisit match
      // is found, the parking event gets real coordinates and JS can check rules.
      // For the LAST trip: use accurate GPS for the current parking location.

      // Emit intermediate trips — try to enrich with CLVisit coordinates
      if trips.count > 1 {
        self.log("RECOVERY: Emitting \(trips.count - 1) intermediate parking events (checking CLVisit history for coordinates)")
        for i in 0..<(trips.count - 1) {
          let trip = trips[i]
          let departureTimestamp = trip.driveStart.timeIntervalSince1970 * 1000
          let parkTimestamp = trip.parkTime.timeIntervalSince1970 * 1000

          // Emit departure (from previous parking spot)
          self.sendEvent(withName: "onDrivingStarted", body: [
            "timestamp": departureTimestamp,
            "source": "recovery_historical",
          ])
          self.log("RECOVERY: Trip \(i + 1) — onDrivingStarted at \(trip.driveStart)")

          // Try to match this parking time with a CLVisit for coordinates
          let visitMatch = self.findVisitForTimestamp(trip.parkTime, toleranceSec: 600)

          var body: [String: Any] = [
            "timestamp": parkTimestamp,
            "drivingDurationSec": trip.driveDuration,
            "isHistorical": true,
          ]

          if let visit = visitMatch {
            // CLVisit provided coordinates — check hotspot before emitting
            let recoveryLoc = CLLocation(latitude: visit.latitude, longitude: visit.longitude)
            if let h = self.hotspotInfo(near: recoveryLoc), h.count >= self.hotspotBlockMinReports {
              self.log("RECOVERY: Trip \(i + 1) — blocked by false positive hotspot (reports=\(h.count), dist=\(String(format: "%.0f", h.distance))m)")
              self.decision("recovery_blocked_hotspot", [
                "tripIndex": i + 1,
                "latitude": visit.latitude,
                "longitude": visit.longitude,
                "hotspotReports": h.count,
                "hotspotDistanceMeters": h.distance,
              ])
              continue  // Skip this trip entirely
            }
            // CLVisit provided coordinates — JS CAN check parking rules!
            body["latitude"] = visit.latitude
            body["longitude"] = visit.longitude
            body["accuracy"] = visit.accuracy
            body["locationSource"] = "recovery_clvisit"
            body["isFromVisit"] = true
            self.log("RECOVERY: Trip \(i + 1) — CLVisit match! (\(visit.latitude), \(visit.longitude)) ±\(String(format: "%.0f", visit.accuracy))m — parking rules CAN be checked")
          } else {
            // No CLVisit match — emit with no coordinates
            body["latitude"] = 0
            body["longitude"] = 0
            body["accuracy"] = -1  // Signals "no GPS" to JS
            body["locationSource"] = "recovery_historical"
            self.log("RECOVERY: Trip \(i + 1) — no CLVisit match — emitting without coordinates")
          }

          self.sendEvent(withName: "onParkingDetected", body: body)
          self.persistPendingParkingEvent(body)

          // If we have coordinates, also send a local notification
          if visitMatch != nil {
            self.sendParkingVisitNotification(
              latitude: visitMatch!.latitude,
              longitude: visitMatch!.longitude,
              arrivalDate: trip.parkTime
            )
          }
        }
      }

      // ── Handle the LAST trip with accurate GPS ──
      let lastTrip = trips.last!
      self.log("RECOVERY: Processing last trip (current location) — drove \(String(format: "%.0f", lastTrip.driveDuration))s. Requesting accurate GPS.")

      // Emit onDrivingStarted for the last trip's departure
      let departureTimestamp = lastTrip.driveStart.timeIntervalSince1970 * 1000
      self.sendEvent(withName: "onDrivingStarted", body: [
        "timestamp": departureTimestamp,
        "source": "recovery_coremotion_history",
      ])
      self.extendCameraPrewarm(reason: "driving_started_recovery", seconds: self.cameraPrewarmStrongSec)
      self.log("RECOVERY: onDrivingStarted fired for last trip (departure)")

      // DON'T use the significantLocationChange cell-tower fix as the parking
      // location. That's how the Clybourn bug happens — 300-500m off.
      // Instead, start high-accuracy GPS and wait for a real satellite fix.
      self.recoveryDrivingDuration = lastTrip.driveDuration
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
    persistPendingParkingEvent(body)  // Survive JS suspension
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    self.log("Location error: \(error.localizedDescription)")
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    self.log("Auth changed: \(status.rawValue)")
    let bgRefreshString: String = {
      switch UIApplication.shared.backgroundRefreshStatus {
      case .available: return "available"
      case .denied: return "denied"
      case .restricted: return "restricted"
      @unknown default: return "unknown"
      }
    }()
    decision("location_auth_changed", [
      "authRaw": status.rawValue,
      "hasAlwaysPermission": status == .authorizedAlways,
      "backgroundRefreshStatus": bgRefreshString,
      "lowPowerModeEnabled": ProcessInfo.processInfo.isLowPowerModeEnabled,
    ])
    if status == .authorizedWhenInUse {
      manager.requestAlwaysAuthorization()
    }
  }

  // MARK: - CLVisit Monitoring
  //
  // iOS tracks places where the user dwells ("visits") and delivers CLVisit objects
  // with coordinates and arrival/departure times. Crucially, iOS delivers these visits
  // even if the app was killed — they're queued and delivered on next launch.
  //
  // We persist visits to UserDefaults so the recovery function can match CoreMotion
  // timestamps to visit coordinates, enabling parking rule checks for missed stops.

  func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    let arrivalStr = visit.arrivalDate == Date.distantPast ? "unknown" : "\(visit.arrivalDate)"
    let departureStr = visit.departureDate == Date.distantFuture ? "ongoing" : "\(visit.departureDate)"
    self.log("CLVisit: (\(visit.coordinate.latitude), \(visit.coordinate.longitude)) ±\(String(format: "%.0f", visit.horizontalAccuracy))m, arrived: \(arrivalStr), departed: \(departureStr)")

    decision("clvisit_received", [
      "latitude": visit.coordinate.latitude,
      "longitude": visit.coordinate.longitude,
      "accuracy": visit.horizontalAccuracy,
      "arrivalDate": visit.arrivalDate.timeIntervalSince1970,
      "departureDate": visit.departureDate == Date.distantFuture ? -1 : visit.departureDate.timeIntervalSince1970,
    ])

    // Store in ring buffer + persist to UserDefaults
    recentVisits.append((visit: visit, receivedAt: Date()))
    if recentVisits.count > maxRecentVisits {
      recentVisits.removeFirst()
    }
    persistVisits()

    // CLVisit should only independently emit parking events when the normal
    // CoreMotion+GPS pipeline could NOT have caught the stop — i.e., the app was
    // just launched and monitoring hasn't started yet (visits queued by iOS during
    // app-kill are delivered on relaunch). When isMonitoring is true, the normal
    // pipeline is responsible for parking detection; CLVisit just stores visits
    // in the ring buffer for findVisitForTimestamp() coordinate enrichment.
    //
    // Only process if:
    // 1. Monitoring is NOT active (normal pipeline wasn't running)
    // 2. We're not currently driving (would be a false visit)
    // 3. The visit has valid arrival time (not distantPast)
    // 4. The visit has reasonable accuracy (<200m)
    if isMonitoring {
      self.log("CLVisit: monitoring active — stored for coordinate enrichment only (not emitting parking event)")
      return
    }

    if !isDriving &&
       visit.arrivalDate != Date.distantPast &&
       visit.horizontalAccuracy > 0 && visit.horizontalAccuracy < 200 {

      // Check if this visit already matches a recent parking event we detected.
      // If we already confirmed parking at this location recently, skip.
      if let lastParking = lastConfirmedParkingLocation {
        let distance = CLLocation(latitude: visit.coordinate.latitude, longitude: visit.coordinate.longitude)
          .distance(from: lastParking)
        if distance < 150 {
          self.log("CLVisit: matches recent confirmed parking (\(String(format: "%.0f", distance))m away) — skipping duplicate")
          return
        }
      }

      // Check false positive hotspots — user previously marked "Not parked" near here.
      let visitLoc = CLLocation(latitude: visit.coordinate.latitude, longitude: visit.coordinate.longitude)
      if let h = hotspotInfo(near: visitLoc), h.count >= hotspotBlockMinReports {
        self.log("CLVisit: blocked by false positive hotspot (reports=\(h.count), dist=\(String(format: "%.0f", h.distance))m)")
        decision("clvisit_blocked_hotspot", [
          "latitude": visit.coordinate.latitude,
          "longitude": visit.coordinate.longitude,
          "hotspotReports": h.count,
          "hotspotDistanceMeters": h.distance,
        ])
        return
      }

      // Check lockout window — user recently reported a false positive (any location)
      if let lockout = falsePositiveParkingLockoutUntil, Date() < lockout {
        self.log("CLVisit: blocked by false positive lockout (until \(lockout))")
        return
      }

      // This visit is at a location we didn't detect parking for.
      // Emit a parking event so JS can check rules and notify the user.
      let visitLocation = CLLocation(
        coordinate: visit.coordinate,
        altitude: 0,
        horizontalAccuracy: visit.horizontalAccuracy,
        verticalAccuracy: -1,
        timestamp: visit.arrivalDate
      )

      self.log("CLVisit: emitting parking event for undetected visit at (\(visit.coordinate.latitude), \(visit.coordinate.longitude))")

      let body: [String: Any] = [
        "timestamp": visit.arrivalDate.timeIntervalSince1970 * 1000,
        "latitude": visit.coordinate.latitude,
        "longitude": visit.coordinate.longitude,
        "accuracy": visit.horizontalAccuracy,
        "locationSource": "clvisit_realtime",
        "drivingDurationSec": 0,  // Unknown from visit data alone
        "isFromVisit": true,
      ]

      lastConfirmedParkingLocation = visitLocation
      hasConfirmedParkingThisSession = true

      sendEvent(withName: "onParkingDetected", body: body)
      persistPendingParkingEvent(body)  // Survive JS suspension

      // Also send a local notification since the user may not have the app open
      sendParkingVisitNotification(
        latitude: visit.coordinate.latitude,
        longitude: visit.coordinate.longitude,
        arrivalDate: visit.arrivalDate
      )
    }
  }

  /// Send a local notification when a CLVisit-based parking event is detected.
  /// This is the "delayed notification" for stops the normal pipeline missed.
  private func sendParkingVisitNotification(latitude: Double, longitude: Double, arrivalDate: Date) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let allowed = settings.authorizationStatus == .authorized ||
                    settings.authorizationStatus == .provisional ||
                    settings.authorizationStatus == .ephemeral
      guard allowed else {
        self.log("Visit parking notification skipped: notifications not authorized")
        return
      }
      let content = UNMutableNotificationContent()
      content.title = "Parking detected"
      content.body = "We detected you parked. Checking parking rules..."
      content.sound = UNNotificationSound.default
      content.categoryIdentifier = "parking_detected"
      let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
      let req = UNNotificationRequest(
        identifier: "visit-parking-\(Int(arrivalDate.timeIntervalSince1970))",
        content: content,
        trigger: trigger
      )
      UNUserNotificationCenter.current().add(req) { err in
        if let err = err {
          self.log("Visit parking notification failed: \(err.localizedDescription)")
        } else {
          self.log("Visit parking notification sent")
        }
      }
    }
  }

  /// Persist recent visits to UserDefaults so they survive app kills.
  /// We store as array of dictionaries with lat, lng, accuracy, arrival, departure.
  private func persistVisits() {
    let visitDicts: [[String: Any]] = recentVisits.map { item in
      [
        "latitude": item.visit.coordinate.latitude,
        "longitude": item.visit.coordinate.longitude,
        "accuracy": item.visit.horizontalAccuracy,
        "arrivalDate": item.visit.arrivalDate.timeIntervalSince1970,
        "departureDate": item.visit.departureDate == Date.distantFuture ? -1 : item.visit.departureDate.timeIntervalSince1970,
        "receivedAt": item.receivedAt.timeIntervalSince1970,
      ]
    }
    UserDefaults.standard.set(visitDicts, forKey: kVisitHistoryKey)
  }

  /// Load persisted visits from UserDefaults on startup.
  /// Prunes visits older than 24 hours and logs what's available for recovery matching.
  private func loadPersistedVisits() {
    guard let dicts = UserDefaults.standard.array(forKey: kVisitHistoryKey) as? [[String: Any]] else {
      self.log("No persisted CLVisit history found")
      return
    }
    let now = Date()
    // Prune old visits (>24h) and keep the rest
    let validDicts = dicts.filter { dict in
      guard let arrivalTs = dict["arrivalDate"] as? Double else { return false }
      return now.timeIntervalSince1970 - arrivalTs <= 24 * 3600
    }
    if validDicts.count < dicts.count {
      UserDefaults.standard.set(validDicts, forKey: kVisitHistoryKey)
    }
    self.log("Loaded \(validDicts.count) persisted CLVisits (pruned \(dicts.count - validDicts.count) stale)")
    for dict in validDicts {
      if let lat = dict["latitude"] as? Double,
         let lng = dict["longitude"] as? Double,
         let arrivalTs = dict["arrivalDate"] as? Double {
        let age = now.timeIntervalSince1970 - arrivalTs
        self.log("  Visit: (\(lat), \(lng)) arrived \(String(format: "%.0f", age / 60))min ago")
      }
    }
  }

  /// Find the best CLVisit match for a given timestamp (within tolerance).
  /// Returns (latitude, longitude, accuracy) or nil if no match.
  func findVisitForTimestamp(_ timestamp: Date, toleranceSec: TimeInterval = 600) -> (latitude: Double, longitude: Double, accuracy: Double)? {
    // Also check persisted visits from UserDefaults
    let allVisitDicts = UserDefaults.standard.array(forKey: kVisitHistoryKey) as? [[String: Any]] ?? []

    var bestMatch: (latitude: Double, longitude: Double, accuracy: Double)? = nil
    var bestTimeDiff: TimeInterval = toleranceSec

    for dict in allVisitDicts {
      guard let lat = dict["latitude"] as? Double,
            let lng = dict["longitude"] as? Double,
            let acc = dict["accuracy"] as? Double,
            let arrivalTs = dict["arrivalDate"] as? Double else { continue }

      let arrivalDate = Date(timeIntervalSince1970: arrivalTs)
      let timeDiff = abs(timestamp.timeIntervalSince(arrivalDate))

      // Visit arrival should be close to the CoreMotion parking timestamp
      if timeDiff < bestTimeDiff && acc < 200 {
        bestTimeDiff = timeDiff
        bestMatch = (latitude: lat, longitude: lng, accuracy: acc)
      }
    }

    // Also check in-memory visits
    for item in recentVisits {
      let timeDiff = abs(timestamp.timeIntervalSince(item.visit.arrivalDate))
      if timeDiff < bestTimeDiff && item.visit.horizontalAccuracy < 200 {
        bestTimeDiff = timeDiff
        bestMatch = (
          latitude: item.visit.coordinate.latitude,
          longitude: item.visit.coordinate.longitude,
          accuracy: item.visit.horizontalAccuracy
        )
      }
    }

    if let match = bestMatch {
      self.log("CLVisit match for \(timestamp): (\(match.latitude), \(match.longitude)) ±\(String(format: "%.0f", match.accuracy))m (time diff: \(String(format: "%.0f", bestTimeDiff))s)")
    }
    return bestMatch
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
    if let lockoutUntil = falsePositiveParkingLockoutUntil, Date() < lockoutUntil {
      let remaining = lockoutUntil.timeIntervalSinceNow
      self.log("confirmParking(\(source)) blocked by false-positive lockout (\(String(format: "%.0f", remaining))s remaining)")
      tripSummaryLockoutBlockedCount += 1
      decision("confirm_parking_blocked_lockout", [
        "source": source,
        "remainingSec": remaining,
      ])
      lastStationaryTime = nil
      locationAtStopStart = nil
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
    if coreMotionSaysAutomotive &&
       source != "location_stationary" &&
       source != "gps_unknown_fallback" {
      self.log("CoreMotion still says automotive — aborting parking confirmation (source: \(source))")
      decision("confirm_parking_aborted_automotive", ["source": source])
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }

    // Location priority:
    // 1. locationAtStopStart - captured when CoreMotion first said non-automotive (best)
    // 2. lastDrivingLocation - last GPS while in driving state (very good - includes slow creep)
    // 3. locationManager.location - current GPS (last resort - user may have walked)
    var parkingLocation = locationAtStopStart ?? lastDrivingLocation
    var parkingLocationSource = locationAtStopStart != nil ? "stop_start" : "last_driving"
    let currentLocation = locationManager.location
    if let candidate = parkingLocation {
      let candidateAgeSec = Date().timeIntervalSince(candidate.timestamp)
      let candidateAcc = candidate.horizontalAccuracy
      let candidateWeak = candidateAgeSec > parkingCandidateMaxAgeSec ||
        (candidateAcc > 0 && candidateAcc > parkingCandidatePreferredAccuracyMeters)

      if candidateWeak, let current = currentLocation {
        let currentAgeSec = Date().timeIntervalSince(current.timestamp)
        let currentAcc = current.horizontalAccuracy
        let currentSpeed = current.speed
        let currentUsable =
          currentAgeSec >= 0 &&
          currentAgeSec <= parkingCandidateFreshReplacementAgeSec &&
          currentAcc > 0 &&
          currentAcc <= parkingCandidatePreferredAccuracyMeters &&
          currentSpeed >= 0 &&
          currentSpeed < 1.4

        if currentUsable {
          parkingLocation = current
          parkingLocationSource = "current_refined"
          self.log("Parking location refined to fresh current GPS (age \(String(format: "%.0f", candidateAgeSec))s→\(String(format: "%.0f", currentAgeSec))s, acc \(String(format: "%.0f", candidateAcc))→\(String(format: "%.0f", currentAcc))m)")
          decision("parking_location_refined_to_current", [
            "source": source,
            "candidateAgeSec": candidateAgeSec,
            "candidateAccuracy": candidateAcc,
            "currentAgeSec": currentAgeSec,
            "currentAccuracy": currentAcc,
            "currentSpeed": currentSpeed,
          ])
        }
      }

      let selectedAgeSec = Date().timeIntervalSince(parkingLocation?.timestamp ?? candidate.timestamp)
      let selectedAcc = parkingLocation?.horizontalAccuracy ?? candidateAcc
      let walkingEvidenceSecEarly = coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
      let hasRecentDisconnectEvidenceEarly: Bool = {
        guard let disconnectedAt = lastCarAudioDisconnectedAt else { return false }
        let age = Date().timeIntervalSince(disconnectedAt)
        return age >= 0 && age <= carDisconnectEvidenceWindowSec
      }()
      if source != "location_stationary" &&
         selectedAgeSec > parkingCandidateHardStaleSec &&
         selectedAcc > 0 &&
         selectedAcc > parkingCandidateHardMaxAccuracyMeters &&
         !hasRecentDisconnectEvidenceEarly &&
         walkingEvidenceSecEarly < minWalkingEvidenceSec {
        self.log("Parking candidate blocked by stale/low-quality location (age=\(String(format: "%.0f", selectedAgeSec))s, acc=\(String(format: "%.0f", selectedAcc))m)")
        decision("confirm_parking_blocked_stale_location", [
          "source": source,
          "ageSec": selectedAgeSec,
          "accuracy": selectedAcc,
          "hasRecentDisconnectEvidence": hasRecentDisconnectEvidenceEarly,
          "walkingEvidenceSec": walkingEvidenceSecEarly,
        ])
        tripSummaryStaleLocationBlockedCount += 1
        var retryBody: [String: Any] = [
          "timestamp": Date().timeIntervalSince1970 * 1000,
        ]
        if let retryLoc = parkingLocation ?? currentLocation {
          retryBody["latitude"] = retryLoc.coordinate.latitude
          retryBody["longitude"] = retryLoc.coordinate.longitude
          retryBody["accuracy"] = retryLoc.horizontalAccuracy
          retryBody["locationSource"] = "stale_retry_candidate"
        }
        if let drivingStart = drivingStartTime {
          retryBody["drivingDurationSec"] = Date().timeIntervalSince(drivingStart)
        }
        queueParkingCandidateForRetry(
          body: retryBody,
          source: source,
          reason: "stale_location_waiting_for_fresh_fix"
        )
        return
      }
    }
    let hotspotCandidate = parkingLocation ?? currentLocation
    let hotspot = hotspotInfo(near: hotspotCandidate)
    let walkingEvidenceSec = coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
    let zeroDurationSec = speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
    let hasRecentDisconnectEvidence: Bool = {
      guard let disconnectedAt = lastCarAudioDisconnectedAt else { return false }
      let age = Date().timeIntervalSince(disconnectedAt)
      return age >= 0 && age <= carDisconnectEvidenceWindowSec
    }()
    if source != "location_stationary",
       let h = hotspot,
       h.count >= hotspotBlockMinReports,
       walkingEvidenceSec < minWalkingEvidenceSec,
       !hasRecentDisconnectEvidence,
       zeroDurationSec < 25 {
      self.log("Parking candidate blocked by hotspot guard (reports=\(h.count), dist=\(String(format: "%.0f", h.distance))m, zero=\(String(format: "%.0f", zeroDurationSec))s)")
      decision("confirm_parking_blocked_hotspot", [
        "source": source,
        "hotspotReports": h.count,
        "hotspotDistanceMeters": h.distance,
        "zeroDurationSec": zeroDurationSec,
        "walkingEvidenceSec": walkingEvidenceSec,
      ])
      tripSummaryHotspotBlockedCount += 1
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }
    let nearIntersectionRisk = self.isNearSignalizedIntersection(hotspotCandidate)
    if nearIntersectionRisk &&
       source != "location_stationary" &&
       walkingEvidenceSec < minWalkingEvidenceSec &&
       !hasRecentDisconnectEvidence &&
       zeroDurationSec < intersectionDwellMinStopSec {
      self.log("Parking candidate blocked by intersection dwell guard (zero=\(String(format: "%.0f", zeroDurationSec))s)")
      decision("confirm_parking_blocked_intersection_dwell", [
        "source": source,
        "zeroDurationSec": zeroDurationSec,
        "walkingEvidenceSec": walkingEvidenceSec,
        "hasRecentDisconnectEvidence": hasRecentDisconnectEvidence,
        "nearIntersectionRisk": nearIntersectionRisk,
      ])
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }
    let confidenceScore = self.parkingDecisionConfidenceScore(
      source: source,
      zeroDurationSec: zeroDurationSec,
      walkingEvidenceSec: walkingEvidenceSec,
      hasRecentDisconnectEvidence: hasRecentDisconnectEvidence,
      nearIntersectionRisk: nearIntersectionRisk,
      hotspot: hotspot
    )
    if confidenceScore < 35 && walkingEvidenceSec < minWalkingEvidenceSec && !hasRecentDisconnectEvidence {
      self.log("Parking candidate blocked by low-confidence guard (score=\(confidenceScore), nearIntersection=\(nearIntersectionRisk))")
      tripSummaryLowConfidenceBlockedCount += 1
      decision("confirm_parking_blocked_low_confidence", [
        "source": source,
        "confidenceScore": confidenceScore,
        "zeroDurationSec": zeroDurationSec,
        "walkingEvidenceSec": walkingEvidenceSec,
        "hasRecentDisconnectEvidence": hasRecentDisconnectEvidence,
        "nearIntersectionRisk": nearIntersectionRisk,
      ])
      lastStationaryTime = nil
      locationAtStopStart = nil
      return
    }
    let adaptiveHold = self.adaptiveParkingFinalizationHold(
      source: source,
      zeroDurationSec: zeroDurationSec,
      walkingEvidenceSec: walkingEvidenceSec,
      hotspot: hotspot,
      nearIntersectionRisk: nearIntersectionRisk,
      confidenceScore: confidenceScore
    )
    let adaptiveHoldSec = adaptiveHold.seconds
    let holdReason = adaptiveHold.reason
    lastParkingDecisionConfidence = confidenceScore
    lastParkingDecisionHoldReason = holdReason
    lastParkingDecisionSource = source
    lastParkingDecisionTs = Date().timeIntervalSince1970 * 1000
    self.log("PARKING CANDIDATE READY (source: \(source), confidence=\(confidenceScore), holdReason=\(holdReason)) — holding \(String(format: "%.0f", adaptiveHoldSec))s for stability")

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
      body["locationSource"] = parkingLocationSource
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
    pendingParkingConfidenceScore = confidenceScore
    pendingParkingNearIntersectionRisk = nearIntersectionRisk
    pendingParkingWalkingEvidenceSec = walkingEvidenceSec
    decision("parking_candidate_ready", [
      "source": source,
      "holdSec": adaptiveHoldSec,
      "locationSource": body["locationSource"] as? String ?? "unknown",
      "accuracy": body["accuracy"] as? Double ?? -1,
      "drivingDurationSec": body["drivingDurationSec"] as? Double ?? -1,
      "walkingEvidenceSec": self.coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0,
      "confidenceScore": confidenceScore,
      "holdReason": holdReason,
      "nearIntersectionRisk": nearIntersectionRisk,
    ])
    parkingFinalizationTimer?.invalidate()
    parkingFinalizationTimer = Timer.scheduledTimer(withTimeInterval: adaptiveHoldSec, repeats: false) { [weak self] _ in
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

  private func adaptiveParkingFinalizationHold(
    source: String,
    zeroDurationSec: TimeInterval,
    walkingEvidenceSec: TimeInterval,
    hotspot: (count: Int, distance: Double)?,
    nearIntersectionRisk: Bool,
    confidenceScore: Int
  ) -> (seconds: TimeInterval, reason: String) {
    // Strong hold near known false-positive hotspots and weak no-walking candidates.
    if let h = hotspot, h.count >= hotspotBlockMinReports {
      return (parkingFinalizationHoldStrongSec, "hotspot_high_reports")
    }
    if nearIntersectionRisk && walkingEvidenceSec < minWalkingEvidenceSec {
      return (parkingFinalizationHoldStrongSec, "intersection_no_walking")
    }
    if confidenceScore >= 75 && walkingEvidenceSec >= minWalkingEvidenceSec && zeroDurationSec >= minZeroSpeedForAgreeSec {
      return (parkingFinalizationHoldFastSec, "high_confidence_with_walking")
    }
    if source == "gps_unknown_fallback" || source == "location_stationary" {
      return (parkingFinalizationHoldFastSec, "fallback_source_confirm")
    }
    if zeroDurationSec < 12 && walkingEvidenceSec < minWalkingEvidenceSec {
      return (parkingFinalizationHoldStrongSec, "short_zero_no_walking")
    }
    return (parkingFinalizationHoldSec, "balanced_default")
  }

  private func parkingDecisionConfidenceScore(
    source: String,
    zeroDurationSec: TimeInterval,
    walkingEvidenceSec: TimeInterval,
    hasRecentDisconnectEvidence: Bool,
    nearIntersectionRisk: Bool,
    hotspot: (count: Int, distance: Double)?
  ) -> Int {
    var score = 0

    if walkingEvidenceSec >= minWalkingEvidenceSec { score += 35 }
    if zeroDurationSec >= 20 { score += 25 }
    else if zeroDurationSec >= 12 { score += 15 }

    let nonAutoStableSec = coreMotionNotAutomotiveSince.map { Date().timeIntervalSince($0) } ?? 0
    if nonAutoStableSec >= coreMotionStabilitySec { score += 20 }

    if hasRecentDisconnectEvidence { score += 15 }
    if source == "location_stationary" || source == "gps_unknown_fallback" { score += 10 }

    if nearIntersectionRisk && walkingEvidenceSec < minWalkingEvidenceSec { score -= 20 }
    if let h = hotspot, h.count >= hotspotBlockMinReports { score -= 15 }

    return max(0, min(100, score))
  }

  private func isNearSignalizedIntersection(_ location: CLLocation?) -> Bool {
    guard let loc = location else { return false }
    let lat = loc.coordinate.latitude
    let lng = loc.coordinate.longitude
    for cam in Self.chicagoCameras {
      if cam.type != "redlight" { continue }
      let dist = haversineMeters(lat1: lat, lon1: lng, lat2: cam.lat, lon2: cam.lng)
      if dist <= intersectionRiskRadiusMeters {
        return true
      }
    }
    return false
  }

  private func maybeRecordIntersectionDwellCandidate(_ location: CLLocation) {
    guard isDriving else { return }
    guard speedZeroStartTime != nil else { return }
    guard intersectionDwellStartAt == nil else { return }
    guard isNearSignalizedIntersection(location) else { return }

    intersectionDwellStartAt = Date()
    intersectionDwellLocation = location
    decision("intersection_dwell_started", [
      "lat": location.coordinate.latitude,
      "lng": location.coordinate.longitude,
      "accuracy": location.horizontalAccuracy,
      "radiusMeters": intersectionRiskRadiusMeters,
    ])
  }

  private func maybeHandleIntersectionDwellResume(_ location: CLLocation, speed: Double) {
    guard let dwellStart = intersectionDwellStartAt else { return }
    let dwellSec = Date().timeIntervalSince(dwellStart)
    defer {
      intersectionDwellStartAt = nil
      intersectionDwellLocation = nil
    }
    guard dwellSec <= intersectionDwellAbortWindowSec else { return }
    guard speed >= postConfirmUnwindMinSpeedMps else { return }

    let stopLoc = intersectionDwellLocation ?? location
    let movedMeters = location.distance(from: stopLoc)
    if movedMeters < 18 { return }

    let extended = Date().addingTimeInterval(falsePositiveParkingLockoutSec)
    if let existing = falsePositiveParkingLockoutUntil, existing > extended {
      // Keep the longer lockout if one already exists.
    } else {
      falsePositiveParkingLockoutUntil = extended
    }
    addFalsePositiveHotspot(lat: stopLoc.coordinate.latitude, lng: stopLoc.coordinate.longitude, source: "intersection_dwell_resume")
    decision("intersection_dwell_resumed_non_parking", [
      "dwellSec": dwellSec,
      "movedMeters": movedMeters,
      "speed": speed,
      "lockoutUntilTs": falsePositiveParkingLockoutUntil?.timeIntervalSince1970 ?? 0,
    ])
  }

  private func maybeUnwindRecentParkingConfirmation(_ location: CLLocation, speed: Double) {
    guard !isDriving else { return }
    guard let confirmedAt = lastConfirmedParkingAt, let confirmedLoc = lastConfirmedParkingLocation else { return }
    let ageSec = Date().timeIntervalSince(confirmedAt)
    guard ageSec >= 0 && ageSec <= postConfirmUnwindWindowSec else { return }
    guard speed >= postConfirmUnwindMinSpeedMps else { return }

    let movedMeters = location.distance(from: confirmedLoc)
    guard movedMeters >= postConfirmUnwindMinDistanceMeters else { return }

    let likelyFalsePositive =
      lastConfirmedParkingNearIntersectionRisk ||
      lastConfirmedParkingConfidence < postConfirmUnwindMaxConfidence ||
      lastParkingDecisionHoldReason.contains("no_walking")
    guard likelyFalsePositive else { return }

    addFalsePositiveHotspot(lat: confirmedLoc.coordinate.latitude, lng: confirmedLoc.coordinate.longitude, source: "post_confirm_unwind")
    let extended = Date().addingTimeInterval(falsePositiveParkingLockoutSec)
    if let existing = falsePositiveParkingLockoutUntil, existing > extended {
      // Keep existing if already longer.
    } else {
      falsePositiveParkingLockoutUntil = extended
    }

    // Undo parking-state assumptions so the drive pipeline can continue normally.
    hasConfirmedParkingThisSession = false
    lastConfirmedParkingLocation = nil
    clearPersistedParkingState()
    lastConfirmedParkingAt = nil
    lastConfirmedParkingConfidence = -1
    lastConfirmedParkingNearIntersectionRisk = false

    decision("parking_post_confirm_unwound", [
      "ageSec": ageSec,
      "movedMeters": movedMeters,
      "speed": speed,
      "confidence": lastParkingDecisionConfidence,
      "holdReason": lastParkingDecisionHoldReason,
    ])
    self.log("Post-confirm unwind: movement \(String(format: "%.0f", movedMeters))m at \(String(format: "%.1f", speed)) m/s within \(String(format: "%.0f", ageSec))s of parking confirm")
  }

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
    let nonAutomotiveStableSec = coreMotionNotAutomotiveSince.map { Date().timeIntervalSince($0) } ?? 0
    let zeroDurationSec = speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
    let hasRecentDisconnectEvidence: Bool = {
      guard let disconnectedAt = lastCarAudioDisconnectedAt else { return false }
      let age = Date().timeIntervalSince(disconnectedAt)
      return age >= 0 && age <= carDisconnectEvidenceWindowSec
    }()
    let currentSpeed = locationManager.location?.speed ?? -1
    let hasLongStillEvidence =
      currentSpeed >= 0 &&
      currentSpeed < 1.0 &&
      zeroDurationSec >= minZeroSpeedNoWalkingSec &&
      nonAutomotiveStableSec >= coreMotionStabilitySec
    let hasUnknownSpeedStillEvidence: Bool = {
      guard currentSpeed < 0 else { return false }
      guard let cur = locationManager.location else { return false }
      let ageSec = Date().timeIntervalSince(cur.timestamp)
      return ageSec >= 0 &&
        ageSec <= 8 &&
        cur.horizontalAccuracy > 0 &&
        cur.horizontalAccuracy <= 35 &&
        zeroDurationSec >= minZeroSpeedNoWalkingSec &&
        nonAutomotiveStableSec >= coreMotionStabilitySec &&
        (hasWalkingEvidence || hasRecentDisconnectEvidence)
    }()
    guard (currentSpeed >= 0 && currentSpeed < 1.3) || hasUnknownSpeedStillEvidence else { return }
    guard hasWalkingEvidence || hasLongStillEvidence || hasRecentDisconnectEvidence || hasUnknownSpeedStillEvidence else { return }

    decision("parking_candidate_queue_recovered", [
      "source": source,
      "ageSec": age,
      "walkingEvidenceSec": walkingEvidenceSec,
      "currentSpeed": currentSpeed,
      "hasLongStillEvidence": hasLongStillEvidence,
      "hasUnknownSpeedStillEvidence": hasUnknownSpeedStillEvidence,
      "zeroDurationSec": zeroDurationSec,
      "nonAutomotiveStableSec": nonAutomotiveStableSec,
      "hasRecentDisconnectEvidence": hasRecentDisconnectEvidence,
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
    tripSummaryFinalizationCancelledCount += 1
    if reason.contains("automotive") {
      tripSummaryFinalizationCancelledAutomotive += 1
    } else if reason.contains("GPS speed") || reason.contains("speed") {
      tripSummaryFinalizationCancelledSpeed += 1
    } else if reason.contains("Moved ") || reason.contains("drift") {
      tripSummaryFinalizationCancelledDrift += 1
    }
    decision("parking_finalization_cancelled", ["reason": reason])
    parkingFinalizationTimer?.invalidate()
    parkingFinalizationTimer = nil
    parkingFinalizationPending = false
    pendingParkingLocation = nil
    pendingParkingConfidenceScore = -1
    pendingParkingNearIntersectionRisk = false
    pendingParkingWalkingEvidenceSec = 0
  }

  private func finalizeParkingConfirmation(body: [String: Any], source: String) {
    let finalizedLocation = pendingParkingLocation ?? locationManager.location
    let finalizedConfidence = pendingParkingConfidenceScore
    let finalizedNearIntersectionRisk = pendingParkingNearIntersectionRisk
    let finalizedWalkingEvidenceSec = pendingParkingWalkingEvidenceSec
    parkingFinalizationPending = false
    pendingParkingLocation = nil
    pendingParkingConfidenceScore = -1
    pendingParkingNearIntersectionRisk = false
    pendingParkingWalkingEvidenceSec = 0
    self.log("PARKING CONFIRMED (source: \(source))")
    decision("parking_confirmed", [
      "source": source,
      "locationSource": body["locationSource"] as? String ?? "unknown",
      "accuracy": body["accuracy"] as? Double ?? -1,
      "drivingDurationSec": body["drivingDurationSec"] as? Double ?? -1,
      "timestamp": body["timestamp"] as? Double ?? -1,
      "confidenceScore": finalizedConfidence,
      "nearIntersectionRisk": finalizedNearIntersectionRisk,
      "walkingEvidenceSec": finalizedWalkingEvidenceSec,
    ])
    emitTripSummary(outcome: "parked", parkingSource: source)

    // After first confirmed parking, require GPS confirmation to restart driving
    // (prevents CoreMotion flicker from immediately re-entering driving state).
    hasConfirmedParkingThisSession = true
    lastConfirmedParkingLocation = finalizedLocation
    lastConfirmedParkingAt = Date()
    lastConfirmedParkingConfidence = finalizedConfidence
    lastConfirmedParkingNearIntersectionRisk = finalizedNearIntersectionRisk
    persistParkingState()  // Survive app kills (Clybourn bug fix)

    var payload = body
    payload["detectionSource"] = source
    sendEvent(withName: "onParkingDetected", body: payload)

    // Also persist the event to the pending queue so JS can pick it up
    // if sendEvent was lost (JS suspended by iOS in background).
    // JS calls acknowledgeParkingEvent() after processing to clear this.
    persistPendingParkingEvent(payload)

    // Reset driving state
    isDriving = false
    coreMotionSaysAutomotive = false
    speedSaysMoving = false
    speedMovingConsecutiveCount = 0
    drivingStartTime = nil
    lastStationaryTime = nil
    locationAtStopStart = nil
    speedZeroStartTime = nil
    stopWindowMaxSpeedMps = 0
    intersectionDwellStartAt = nil
    intersectionDwellLocation = nil
    stationaryLocation = nil
    stationaryStartTime = nil
    coreMotionNotAutomotiveSince = nil
    coreMotionUnknownSince = nil
    coreMotionStateLabel = "unknown"
    coreMotionWalkingSince = nil
    coreMotionStationarySince = nil
    gpsFallbackDrivingSince = nil
    gpsFallbackStartLocation = nil
    gpsFallbackPossibleDrivingEmitted = false
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
