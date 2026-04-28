import Foundation
import CoreLocation
import CoreMotion
import AVFoundation
import UIKit
import UserNotifications
import React

@objc(BackgroundLocationModule)
class BackgroundLocationModule: RCTEventEmitter, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate, UNUserNotificationCenterDelegate {

  /// Shared reference for AppDelegate to call startMonitoringFromBackground().
  /// Weak to avoid retain cycles — React Native owns the module's lifecycle.
  static weak var shared: BackgroundLocationModule?

  private let locationManager = CLLocationManager()
  private let activityManager = CMMotionActivityManager()
  private let motionManager = CMMotionManager()  // Accelerometer/gyro for evidence
  private var isMonitoring = false
  private let kWasMonitoringKey = "bg_wasMonitoring"

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
    carPlayWasActiveThisDrive = carPlayConnected
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
    tripSummaryCameraRejectLateral = 0
    tripSummaryCameraRejectDedupe = 0
    tripSummaryCameraScanCount = 0
    tripSummaryCameraSkippedDisabledCount = 0
    tripSummaryCameraSkippedNotArmedCount = 0
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
        ("lateral_offset", tripSummaryCameraRejectLateral),
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
      "cameraRejectLateralCount": tripSummaryCameraRejectLateral,
      "cameraRejectDedupeCount": tripSummaryCameraRejectDedupe,
      "cameraScanCount": tripSummaryCameraScanCount,
      "cameraSkippedDisabledCount": tripSummaryCameraSkippedDisabledCount,
      "cameraSkippedNotArmedCount": tripSummaryCameraSkippedNotArmedCount,
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
    tripSummaryCameraRejectLateral = 0
    tripSummaryCameraRejectDedupe = 0
    tripSummaryCameraScanCount = 0
    tripSummaryCameraSkippedDisabledCount = 0
    tripSummaryCameraSkippedNotArmedCount = 0
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
    let hasCarPlayRoute = route.outputs.contains { $0.portType == .carAudio }

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
        // Only extend camera prewarm from BT if not already confirmed parked.
        // Connecting to BT audio while sitting indoors (AirPods, speaker) was
        // re-arming cameras and causing false alerts hours after parking.
        if !hasConfirmedParkingThisSession || isDriving {
          extendCameraPrewarm(reason: "vehicle_signal_connected", seconds: cameraPrewarmStrongSec)
        }
        if isMonitoring && (!continuousGpsActive || gpsInKeepaliveMode) {
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
        if !hasConfirmedParkingThisSession || isDriving {
          extendCameraPrewarm(reason: "vehicle_signal_disconnected", seconds: cameraPrewarmSec)
        }
      }
    }

    if hasCarPlayRoute != carPlayConnected {
      carPlayConnected = hasCarPlayRoute
      if hasCarPlayRoute {
        lastCarPlayConnectedAt = now
        carPlayWasActiveThisDrive = true
        // Fresh CarPlay session — clear stale fixes from any previous drive.
        recentCarPlayInVehicleLocations.removeAll()
        // Capture the head unit's stable identity from the audio port. uid is
        // typically a deterministic per-car string (Apple does not document the
        // exact format); portName is the user-visible label set by the car.
        // Both come for free from AVAudioSession — no entitlement required.
        if let carPlayPort = route.outputs.first(where: { $0.portType == .carAudio }) {
          lastCarPlayPortUid = carPlayPort.uid
          lastCarPlayPortName = carPlayPort.portName
          log("CarPlay port: name=\"\(carPlayPort.portName)\" uid=\(carPlayPort.uid)")
        }
        decision("carplay_connected", [
          "reason": reason,
          "isMonitoring": isMonitoring,
          "isDriving": isDriving,
          "hasConfirmedParking": hasConfirmedParkingThisSession,
          "portName": lastCarPlayPortName ?? "",
        ])
        log("CarPlay connected — phone paired to car head unit")
        if isMonitoring && !isDriving {
          markDrivingStartedFromCarPlay(reason: reason)
        }
      } else {
        lastCarPlayDisconnectedAt = now
        decision("carplay_disconnected", [
          "reason": reason,
          "isMonitoring": isMonitoring,
          "isDriving": isDriving,
        ])
        log("CarPlay disconnected — phone unpaired from car head unit")
        if isMonitoring && isDriving {
          let stopCandidate = lastDrivingLocation ?? locationManager.location
          // Prefer median of recent in-vehicle fixes over the single
          // lastDrivingLocation. The single-fix path picks the most recent
          // fix, which is often the worst-accuracy one (GPS quality drops as
          // the car slows and stops). Median across 3+ recent good fixes is
          // robust to per-fix accuracy variance and pulls the anchor toward
          // the true parking-moment position.
          let goodFixes = recentCarPlayInVehicleLocations.filter {
            $0.horizontalAccuracy > 0 && $0.horizontalAccuracy <= 20
          }
          if goodFixes.count >= 3 {
            let lats = goodFixes.map { $0.coordinate.latitude }.sorted()
            let lngs = goodFixes.map { $0.coordinate.longitude }.sorted()
            let medLat = lats[lats.count / 2]
            let medLng = lngs[lngs.count / 2]
            lastCarPlayDisconnectLatitude = medLat
            lastCarPlayDisconnectLongitude = medLng
            log("CarPlay disconnect anchor: median of \(goodFixes.count) in-vehicle fixes → (\(String(format: "%.6f", medLat)), \(String(format: "%.6f", medLng)))")
          } else if let loc = stopCandidate {
            lastCarPlayDisconnectLatitude = loc.coordinate.latitude
            lastCarPlayDisconnectLongitude = loc.coordinate.longitude
            log("CarPlay disconnect anchor: only \(goodFixes.count) good in-vehicle fixes, falling back to lastDrivingLocation")
          }
          if let loc = stopCandidate {
            updateStopLocationCandidate(loc, reason: "carplay_disconnect")
          }
          handlePotentialParking(userIsWalking: false)
        }
      }
    }
  }

  /// Fast-path drive start triggered by CarPlay pairing. CarPlay (`.carAudio` port)
  /// only fires for actual head-unit pairing — wired or wireless — so it is a
  /// near-certain "user is in their car" signal. We mirror the CoreMotion automotive
  /// drive-start path so camera alerts arm immediately instead of waiting 5–30s for
  /// CoreMotion to settle on automotive.
  private func markDrivingStartedFromCarPlay(reason: String) {
    guard isMonitoring, !isDriving else { return }
    isDriving = true
    drivingStartTime = Date()
    automotiveSessionStart = Date()
    lastDrivingLocation = nil
    locationAtStopStart = nil
    recentLowSpeedLocations.removeAll()
    recentDrivingLocations.removeAll()
    startContinuousGps()
    startAccelerometerRecording()

    let departureTimestamp = Date().timeIntervalSince1970 * 1000
    log("Driving started (CarPlay connected, source: carplay_connected, reason: \(reason))")
    beginTripSummary(source: "carplay_connected", departureTimestampMs: departureTimestamp)
    sendEvent(withName: "onDrivingStarted", body: [
      "timestamp": departureTimestamp,
      "source": "carplay_connected",
    ])
    extendCameraPrewarm(reason: "driving_started_carplay", seconds: cameraPrewarmStrongSec)
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
    let lockoutRemainingSec: TimeInterval = 0  // Lockout + hotspot systems removed Mar 2026
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
      "gpsInKeepaliveMode": gpsInKeepaliveMode,
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
      "carPlayConnected": carPlayConnected,
      "cameraPrewarmRemainingSec": cameraPrewarmUntil.map { max(0, $0.timeIntervalSinceNow) } ?? 0,
      "lockoutRemainingSec": lockoutRemainingSec,
      "hotspotCount": 0,  // Hotspot system removed Mar 2026
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
      if (!continuousGpsActive || gpsInKeepaliveMode) && (isDriving || coreMotionSaysAutomotive) {
        self.log("WATCHDOG: no location callbacks yet while driving/automotive — \(gpsInKeepaliveMode ? "ramping up from keepalive" : "starting") GPS")
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
      // NOTE: Do NOT reset hasCheckedForMissedParking here.
      // The flag is reset by confirmParking() (for the next drive) and
      // appDidBecomeActive() (for app resume). Resetting it here causes
      // the watchdog to re-emit the same parking event every 60-90s,
      // spamming the user with duplicate "All Clear" notifications.
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
  private var lastDrivingHeading: Double = -1          // Last valid GPS heading while driving (for street disambiguation at parking)
  private var locationAtStopStart: CLLocation? = nil   // Snapshot GPS at exact moment car stops
  private var lastStationaryTime: Date? = nil
  private var continuousGpsActive = false              // Whether high-frequency GPS is running
  private var gpsInKeepaliveMode = false               // Whether GPS is in low-power keepalive (not full accuracy)
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
  // CarPlay-specific signal: AVAudioSession.Port.carAudio fires for both wired and
  // wireless CarPlay. This is far higher-confidence than generic BT audio (A2DP/HFP),
  // which also fires for AirPods, home speakers, etc. We use CarPlay connect to
  // fast-start driving (camera alerts arm before CoreMotion can confirm automotive)
  // and CarPlay disconnect to eagerly kick parking detection through the standard
  // handlePotentialParking() path (minDriving + GPS zero-speed guards still apply).
  private var carPlayConnected = false
  private var lastCarPlayConnectedAt: Date? = nil
  private var lastCarPlayDisconnectedAt: Date? = nil
  // Snapshot of where the car was when CarPlay disconnected. Used by the
  // address-resolution pipeline as the canonical "parking moment" coordinate
  // — sharper than the eventual finalizedLocation which can drift during the
  // 10-20s parking confirmation window if the user starts walking.
  private var lastCarPlayDisconnectLatitude: Double? = nil
  private var lastCarPlayDisconnectLongitude: Double? = nil
  // Ring buffer of GPS fixes captured during the current CarPlay session,
  // regardless of speed. The trajectory buffer (recentDrivingLocations) gates
  // on speed >= 0.3 m/s so it can't help with the final 1-3 seconds of slow-
  // creep into a parking spot. CarPlay-on is an in-vehicle guarantee, so we
  // can safely capture sub-threshold fixes here without walking contamination.
  // On disconnect, we take the median of recent good-accuracy fixes to set
  // lastCarPlayDisconnectLatitude/Longitude — more robust than a single fix.
  private var recentCarPlayInVehicleLocations: [CLLocation] = []
  private let maxCarPlayInVehicleLocations = 8
  // Per-drive latch so a drive still counts as "CarPlay active" even when the
  // initial connect predated drivingStartTime or disconnect happened before emit.
  private var carPlayWasActiveThisDrive = false
  // Identity of the connected CarPlay head unit, captured from
  // AVAudioSessionPortDescription. Apple's third-party CarPlay APIs do NOT
  // expose VIN, speed, or fuel — but `port.uid` is a stable per-head-unit
  // identifier and `portName` is the user-visible name (e.g. "Honda Civic").
  // Sent to the server so future analytics can do "this same car parked at
  // this same GPS on N prior Tuesdays" pattern matching for confidence.
  private var lastCarPlayPortUid: String? = nil
  private var lastCarPlayPortName: String? = nil
  // falsePositiveHotspots removed Mar 2026 — hotspot system had a fundamental flaw:
  // blocking prevents the very parking event that would let the user "Correct" an incorrect hotspot.
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
  private var tripSummaryCameraRejectLateral = 0
  private var tripSummaryCameraRejectDedupe = 0
  private var tripSummaryCameraScanCount = 0
  private var tripSummaryCameraSkippedDisabledCount = 0
  private var tripSummaryCameraSkippedNotArmedCount = 0
  private var tripSummaryLowConfidenceBlockedCount = 0
  private var tripSummaryStaleLocationBlockedCount = 0
  private var tripLastMotionState: String? = nil
  private var tripLastMotionAt: Date? = nil
  // Lockout removed Mar 2026 — caused cascading false positive problem where a false
  // parking event blocked all real parking for 30 minutes. The hotspot system (1-tap
  // permanent block) plus existing CoreMotion+GPS guards are sufficient.
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

  // GPS averaging: ring buffer of recent low-speed GPS fixes (< 3 m/s) for parking location accuracy.
  // When the car is approaching its parking spot or creeping to a stop, these fixes are collected.
  // At parking confirmation, they're averaged to reduce urban canyon noise (10-30m).
  private var recentLowSpeedLocations: [CLLocation] = []
  private let maxRecentLowSpeedLocations = 10  // Keep last 10 fixes (~10 seconds)
  private let lowSpeedThresholdMps = 3.0  // Collect when speed < 3 m/s (~7 mph)

  // Ring buffer of recent GPS fixes while the car is moving (any speed above
  // ~0.3 m/s). Sent with the parking event as `driveTrajectory` so the server
  // can run turn-aware street disambiguation (see pages/api/mobile/check-parking.ts
  // trajectory vote). Context: at a corner park (e.g. drove east on Lawrence,
  // turned south onto Wolcott, parked 2 seconds later), the single GPS heading
  // at park time is STALE from before the turn. But the last 2-3 fixes in this
  // buffer show the car actually moved south on Wolcott's longitude, which lets
  // the server pick Wolcott over Lawrence despite the snap distances saying
  // otherwise. Before this buffer existed, iOS parks had no turn-detection signal
  // to send to the server — only Android did.
  private var recentDrivingLocations: [CLLocation] = []
  // 90 fixes ≈ 60-90 seconds of trajectory at 1 Hz GPS, enough for Mapbox
  // map-matching to identify the actual road from a real driving path
  // (vs. snapping a stationary parked-car cluster, which fails at 0
  // confidence). Bumped from 10 on 2026-04-25 after Webster→Fremont
  // failure: 10 fixes was only ~10s, so the south turn off Webster onto
  // Fremont wasn't in the trajectory the server received.
  private let maxRecentDrivingLocations = 90
  private let drivingBufferMinSpeedMps = 0.3  // Match Android: capture slow-creep before stop

  // Apple's reverse geocoder. Independent address signal at park time using
  // Apple's own address DB (different source than OSM/Nominatim and Mapbox
  // used server-side). Attached to the parking event as appleGeocode so the
  // server can record it as a 4th vote in disambiguation diagnostics.
  // Apple rate-limits to ~1 req/min; that's fine for parking events.
  private let appleGeocoder = CLGeocoder()

  // GPS trace ring buffer for camera evidence capture.
  // Keeps last 60 seconds of driving GPS fixes so evidence has a multi-point
  // trace showing approach path, speed changes, and deceleration — not just a single snapshot.
  private struct GpsTracePoint {
    let timestamp: TimeInterval  // Unix ms
    let latitude: Double
    let longitude: Double
    let speedMps: Double
    let heading: Double
    let accuracy: Double
  }
  private var gpsTraceBuffer: [GpsTracePoint] = []
  private let gpsTraceMaxAgeSec: TimeInterval = 60  // Keep 60 seconds of history
  private let gpsTraceMaxPoints = 120  // Cap at 120 points (~2/sec at full GPS rate)

  // Camera alerts (native iOS — handles ALL camera proximity detection + notifications).
  // Default to TRUE so alerts work immediately, even before JS syncs settings.
  // JS will override via setCameraAlertSettings() if the user explicitly disabled them.
  private var cameraAlertsEnabled = true
  private var cameraSpeedEnabled = true
  private var cameraRedlightEnabled = true
  private var cameraAlertVolume: Float = 1.0
  private var alertedCameraAtByIndex: [Int: Date] = [:]
  private var lastCameraAlertAt: Date? = nil
  private var lastCameraRejectLogAt: Date? = nil
  private var lastCameraDisabledLogAt: Date? = nil
  private var lastCameraScanLogAt: Date? = nil

  // Ephemeral suppression set by JS when trajectory analysis says
  // "this is a train, not a car." Reset on every parking confirmation /
  // departure so it never persists past a single trip. Distinct from
  // cameraAlertsEnabled (the user's persisted preference).
  private var railTripActive: Bool = false
  private var railTripActiveSince: Date? = nil
  private var railTripReason: String = ""
  private var lastRailSuppressionLogAt: Date? = nil

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
  private let kConfirmedParkingTimesKey = "bg_confirmedParkingTimes_v1"  // Ring buffer of recent confirmed parking timestamps+coords for recovery dedup
  // kFalsePositiveHotspotsKey removed Mar 2026 — hotspot system removed

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

  // Compass heading collection at park time — magnetometer works at zero speed
  // unlike GPS heading which requires movement. Eliminates stale-heading-after-turn.
  private var compassHeadingSamples: [Double] = []
  private let compassTargetSamples = 10
  private var compassCollectionTimer: Timer? = nil

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
  private let minZeroSpeedNoWalkingSec: TimeInterval = 75  // Raised from 45s to 75s — Chicago arterial red phases commonly run 45-75s (e.g. 3239 S Ashland); 75s exceeds nearly all single-approach red phases
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
  private let parkingFinalizationHoldWeakSec: TimeInterval = 15  // No walking, no BT disconnect — weakest evidence, give extra time for light to change
  private let parkingFinalizationMaxDriftMeters: Double = 35
  // falsePositiveParkingLockoutSec and falsePositiveParkingLockoutRadiusMeters removed Mar 2026
  private let gpsZeroSpeedHardTimeoutSec: TimeInterval = 120  // Hard override: 120s of GPS speed≈0 = parked, even if CoreMotion still says automotive (raised from 90s — 90s can still overlap long red phases at 6-way intersections; location_stationary at 2min is a parallel backstop)
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
  // hotspotMergeRadiusMeters, hotspotBlockRadiusMeters, hotspotBlockMinReports removed Mar 2026
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
  private let camHeadingToleranceDeg: Double = 35  // Standard tolerance at normal driving speeds (tightened from 45 for diagonal street rejection)
  private let camMaxBearingOffHeadingDeg: Double = 30  // Standard forward cone at normal driving speeds
  private let camMaxLateralOffsetMeters: Double = 50  // Max perpendicular distance from camera approach axis
  private let camRejectLogCooldownSec: TimeInterval = 10
  private let speedCamEnforceStartHour = 6
  private let speedCamEnforceEndHour = 23
  private let camHeadingBufferSize = 5  // Circular mean of last N headings for noise reduction

  /// Heading smoothing buffer for GPS noise reduction at low speeds
  private var camHeadingBuffer: [Double] = []

  /// Speed-adaptive heading tolerance: widen at low speeds where GPS heading is noisy.
  /// `isAutomotive`: true when CoreMotion says automotive or isDriving is set. When false,
  /// the user is likely a pedestrian — use tighter tolerance to avoid false alerts.
  /// Bug fix: Mar 24, 2026 — 75° tolerance at walking speed (1.87 m/s) let heading 230°
  /// match WB camera (270°) while user was walking past 800 W Fullerton.
  private func camGetHeadingTolerance(speedMps: Double, isAutomotive: Bool = true) -> Double {
    if speedMps < 0 { return camHeadingToleranceDeg }
    // When not automotive (likely pedestrian), use standard tolerance even at low speeds.
    // GPS heading is noisy at low speed, but widening to 75° for a pedestrian creates
    // false alerts for cameras in the opposite direction.
    if !isAutomotive {
      // Without automotive confirmation, GPS heading noise is expected but the risk
      // of false alerts outweighs the risk of missing a real one. A pedestrian or
      // slow cyclist doesn't get tickets from red-light cameras.
      if speedMps < 5.0 { return 40 }  // Tight: only 5° wider than standard 35° for GPS noise
      return camHeadingToleranceDeg
    }
    if speedMps < 5.0 { return 75 }  // <11 mph — very noisy heading (vehicle)
    if speedMps < 8.0 { return 60 }  // <18 mph — moderately noisy
    return camHeadingToleranceDeg     // ≥18 mph — standard 35°
  }

  /// Speed-adaptive bearing tolerance: widen forward cone at low speeds
  private func camGetBearingTolerance(speedMps: Double, isAutomotive: Bool = true) -> Double {
    if speedMps < 0 { return camMaxBearingOffHeadingDeg }
    if !isAutomotive {
      if speedMps < 5.0 { return 35 }  // Tighter than vehicle 50° but wider than standard 30°
      return camMaxBearingOffHeadingDeg
    }
    if speedMps < 5.0 { return 50 }  // <11 mph — widen forward cone (vehicle)
    if speedMps < 8.0 { return 40 }  // <18 mph — slightly wider
    return camMaxBearingOffHeadingDeg // ≥18 mph — standard 30°
  }

  /// Smooth GPS heading using circular mean of recent headings.
  /// Reduces GPS heading noise at low speeds where position delta is small.
  private func camSmoothHeading(_ rawHeading: Double) -> Double {
    if rawHeading < 0 { return rawHeading } // -1 = unavailable
    camHeadingBuffer.append(rawHeading)
    if camHeadingBuffer.count > camHeadingBufferSize {
      camHeadingBuffer.removeFirst()
    }
    if camHeadingBuffer.count < 2 { return rawHeading }
    var sinSum = 0.0
    var cosSum = 0.0
    for h in camHeadingBuffer {
      sinSum += sin(h * Double.pi / 180.0)
      cosSum += cos(h * Double.pi / 180.0)
    }
    let n = Double(camHeadingBuffer.count)
    let mean = atan2(sinSum / n, cosSum / n) * 180.0 / Double.pi
    return fmod(mean + 360.0, 360.0)
  }


  override init() {
    super.init()
    BackgroundLocationModule.shared = self
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
    registerParkingNotificationCategory()

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

  deinit {
    // Defense-in-depth: clean up observers and timers if module is deallocated.
    // In practice this rarely fires (RN modules live for the bridge lifetime),
    // but prevents leaks if the bridge is torn down.
    NotificationCenter.default.removeObserver(self)
    locationWatchdogTimer?.invalidate()
    monitoringHeartbeatTimer?.invalidate()
    bootstrapGpsTimer?.invalidate()
    parkingConfirmationTimer?.invalidate()
    speedZeroTimer?.invalidate()
    parkingFinalizationTimer?.invalidate()
    recoveryGpsTimer?.invalidate()
    logFileHandle?.closeFile()
    decisionLogFileHandle?.closeFile()
  }

  // MARK: - Notification Category + Action Buttons

  /// Register "parking_detected" notification category with Correct/Wrong actions.
  /// This lets the user give instant ground-truth feedback from the lock screen.
  private func registerParkingNotificationCategory() {
    let correctAction = UNNotificationAction(
      identifier: "PARKING_CORRECT",
      title: "Correct",
      options: []  // No destructive, no authenticationRequired, no foreground
    )
    let wrongAction = UNNotificationAction(
      identifier: "PARKING_WRONG",
      title: "Not Parked",
      options: [.destructive]  // Red text, no foreground launch needed
    )

    let parkingCategory = UNNotificationCategory(
      identifier: "parking_detected",
      actions: [correctAction, wrongAction],
      intentIdentifiers: [],
      options: []
    )

    UNUserNotificationCenter.current().setNotificationCategories([parkingCategory])
    UNUserNotificationCenter.current().delegate = self
    log("Registered parking_detected notification category with Correct/Wrong actions")
  }

  /// Handle notification action taps — emit ground truth events to JS.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let actionId = response.actionIdentifier
    let userInfo = response.notification.request.content.userInfo

    let lat = userInfo["latitude"] as? Double ?? 0
    let lng = userInfo["longitude"] as? Double ?? 0
    let parkTs = userInfo["parkTimestamp"] as? Double ?? 0
    let source = userInfo["source"] as? String ?? "unknown"

    if actionId == "PARKING_CORRECT" {
      log("Notification action: user confirmed parking (lat=\(lat), lng=\(lng), source=\(source))")
      sendEvent(withName: "onParkingGroundTruth", body: [
        "type": "parking_confirmed",
        "latitude": lat,
        "longitude": lng,
        "parkTimestamp": parkTs,
        "source": source,
      ])
    } else if actionId == "PARKING_WRONG" {
      log("Notification action: user reported NOT parked (lat=\(lat), lng=\(lng), source=\(source))")
      sendEvent(withName: "onParkingGroundTruth", body: [
        "type": "parking_false_positive",
        "latitude": lat,
        "longitude": lng,
        "parkTimestamp": parkTs,
        "source": source,
      ])
    }

    completionHandler()
  }

  /// Show notifications in foreground (when app is active)
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    // Show banner + sound even when app is in foreground
    completionHandler([.banner, .sound])
  }

  private func restorePersistedCameraSettings() {
    let d = UserDefaults.standard
    // Default to TRUE when keys don't exist (fresh install).
    // Camera alerts are a core safety feature — default ON, let user disable.
    if d.object(forKey: kCameraAlertsEnabledKey) != nil {
      cameraAlertsEnabled = d.bool(forKey: kCameraAlertsEnabledKey)
    } else {
      cameraAlertsEnabled = true  // Fresh install default
    }
    if d.object(forKey: kCameraSpeedEnabledKey) != nil {
      cameraSpeedEnabled = d.bool(forKey: kCameraSpeedEnabledKey)
    } else {
      cameraSpeedEnabled = true  // Fresh install default
    }
    if d.object(forKey: kCameraRedlightEnabledKey) != nil {
      cameraRedlightEnabled = d.bool(forKey: kCameraRedlightEnabledKey)
    } else {
      cameraRedlightEnabled = true  // Fresh install default
    }
    if d.object(forKey: kCameraAlertVolumeKey) != nil {
      cameraAlertVolume = d.float(forKey: kCameraAlertVolumeKey)
    }
    // Restore persisted camera prewarm timer (survives cold start / app kill)
    let prewarmTs = d.double(forKey: "com.ticketless.cameraPrewarmUntil")
    if prewarmTs > 0 {
      let prewarmDate = Date(timeIntervalSince1970: prewarmTs)
      if prewarmDate > Date() {
        cameraPrewarmUntil = prewarmDate
        let remainingSec = prewarmDate.timeIntervalSince(Date())
        log("Restored camera prewarm: \(String(format: "%.0f", remainingSec))s remaining — camera alerts armed on cold start")
      } else {
        log("Persisted camera prewarm expired (\(String(format: "%.0f", Date().timeIntervalSince(prewarmDate)))s ago) — not restoring")
      }
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
    decision("parking_false_positive_reported", [
      "lat": latitude,
      "lng": longitude,
    ])
    resolve(true)
  }

  @objc func reportParkingConfirmed(_ latitude: Double, longitude: Double,
                                    resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Hotspot system removed — "Correct" tap is now a no-op natively (JS still tracks it for analytics)
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

  // MARK: - Confirmed Parking Times Ring Buffer (for recovery deduplication)
  // Stores the last N confirmed parking timestamps+coords so that checkForMissedParking
  // can deduplicate ALL intermediate trips, not just the most recent one.

  /// Record a confirmed parking event in the ring buffer for recovery dedup.
  /// Called from confirmParking() and handleRecoveryGpsFix().
  private func recordConfirmedParkingTime(timestamp: Date, latitude: Double, longitude: Double) {
    let defaults = UserDefaults.standard
    var entries = defaults.array(forKey: kConfirmedParkingTimesKey) as? [[String: Any]] ?? []

    let entry: [String: Any] = [
      "timestamp": timestamp.timeIntervalSince1970,
      "latitude": latitude,
      "longitude": longitude,
    ]
    entries.append(entry)

    // Keep max 20 entries, prune entries older than 24 hours
    let cutoff = Date().timeIntervalSince1970 - 24 * 3600
    entries = entries.filter { ($0["timestamp"] as? Double ?? 0) > cutoff }
    if entries.count > 20 { entries = Array(entries.suffix(20)) }

    defaults.set(entries, forKey: kConfirmedParkingTimesKey)
  }

  /// Check if a given parking time matches any recently confirmed parking event.
  /// Returns true if the parkTime is within `timeTolerance` seconds of a confirmed event
  /// AND (if coords are provided) within `distanceTolerance` meters.
  private func isAlreadyConfirmedParking(parkTime: Date, coords: (lat: Double, lng: Double)?, timeTolerance: TimeInterval = 300, distanceTolerance: Double = 50) -> Bool {
    let defaults = UserDefaults.standard
    let entries = defaults.array(forKey: kConfirmedParkingTimesKey) as? [[String: Any]] ?? []

    for entry in entries {
      guard let ts = entry["timestamp"] as? Double else { continue }
      let entryDate = Date(timeIntervalSince1970: ts)
      let timeDiff = abs(parkTime.timeIntervalSince(entryDate))

      if timeDiff < timeTolerance {
        // Time matches. If we have coords for both, also check distance.
        if let c = coords,
           let entryLat = entry["latitude"] as? Double,
           let entryLng = entry["longitude"] as? Double {
          let entryLoc = CLLocation(latitude: entryLat, longitude: entryLng)
          let tripLoc = CLLocation(latitude: c.lat, longitude: c.lng)
          let dist = tripLoc.distance(from: entryLoc)
          if dist < distanceTolerance {
            self.log("RECOVERY DEDUP: parkTime \(parkTime) matches confirmed parking at \(entryDate) (timeDiff=\(String(format: "%.0f", timeDiff))s, dist=\(String(format: "%.0f", dist))m)")
            return true
          }
          // Time matches but location is far — different parking event
        } else {
          // No coords to compare — time match alone is sufficient
          self.log("RECOVERY DEDUP: parkTime \(parkTime) matches confirmed parking at \(entryDate) (timeDiff=\(String(format: "%.0f", timeDiff))s, no coords to compare)")
          return true
        }
      }
    }
    return false
  }

  // MARK: - Single Point of Emission for Parking Events
  //
  // ALL parking event emissions MUST go through this gateway.
  // It centralizes: ring buffer dedup, zero-coord rejection,
  // ring buffer recording, event emission, and pending queue persistence.
  //
  // Callers: finalizeParkingConfirmation, recovery intermediate, recovery last trip, CLVisit.
  // Returns true if the event was emitted, false if deduped/blocked.

  /// Timestamp + location of the last event emitted through the gateway,
  /// used to suppress rapid-fire duplicate emissions (<200m within 5 min).
  private var lastEmittedParkingAt: Date? = nil
  private var lastEmittedParkingCoord: CLLocation? = nil

  /// Synchronous Apple reverse-geocode with a short timeout. Returns nil if
  /// timed out, errored, or called from main thread (where blocking would
  /// risk deadlock with CLGeocoder's main-queue completion handler).
  /// Used only at parking-event emit time — never on a hot loop.
  private func reverseGeocodeWithApple(
    latitude: Double,
    longitude: Double,
    timeoutSeconds: TimeInterval = 1.5
  ) -> [String: Any]? {
    guard latitude != 0 || longitude != 0 else { return nil }
    if Thread.isMainThread {
      self.log("Apple geocode skipped — called on main thread")
      return nil
    }
    let location = CLLocation(latitude: latitude, longitude: longitude)
    var result: [String: Any]?
    let semaphore = DispatchSemaphore(value: 0)
    appleGeocoder.reverseGeocodeLocation(location) { placemarks, error in
      defer { semaphore.signal() }
      if let error = error {
        self.log("Apple reverseGeocode error: \(error.localizedDescription)")
        return
      }
      guard let p = placemarks?.first else { return }
      var dict: [String: Any] = [:]
      if let s = p.thoroughfare { dict["thoroughfare"] = s }
      if let n = p.subThoroughfare { dict["subThoroughfare"] = n }
      if let l = p.subLocality { dict["subLocality"] = l }
      if let n = p.name { dict["name"] = n }
      if let pc = p.postalCode { dict["postalCode"] = pc }
      result = dict
    }
    let waitResult = semaphore.wait(timeout: .now() + timeoutSeconds)
    if waitResult == .timedOut {
      self.log("Apple geocode timed out after \(timeoutSeconds)s")
      // Cancel the in-flight request so the next call isn't queued behind it.
      appleGeocoder.cancelGeocode()
      return nil
    }
    return result
  }

  @discardableResult
  private func emitParkingEventIfNew(
    body: [String: Any],
    source: String,
    parkTimestamp: Date,
    latitude: Double,
    longitude: Double,
    accuracy: Double
  ) -> Bool {
    let hasCoords = (latitude != 0 || longitude != 0) && accuracy >= 0

    // ── Gate 1: Zero-coordinate rejection ──
    // Recovery events with no CLVisit match send lat=0, lng=0, accuracy=-1.
    // Previously only caught in JS — now blocked at native level.
    if !hasCoords && source.starts(with: "recovery_") {
      self.log("EMIT GATE [\(source)]: blocked — no valid coordinates (lat=\(latitude), lng=\(longitude), acc=\(accuracy))")
      self.decision("emit_gate_no_coords", [
        "source": source,
        "latitude": latitude,
        "longitude": longitude,
        "accuracy": accuracy,
        "parkTimestamp": parkTimestamp.timeIntervalSince1970 * 1000,
      ])
      return false
    }

    // ── Gate 2: Ring buffer dedup ──
    // Check if this parking time+location was already emitted (by any pipeline).
    // Tolerances: 50m / 300s. Recovery/CLVisit duplicates re-discover the same
    // physical stop, so coords are within GPS jitter (~10-30m). Legitimate
    // re-parks after driving will always be further apart than 50m.
    // History: 500m/3600s blocked Kenmore→Montana (476m, 5 min) on Mar 21 2026.
    let coords: (lat: Double, lng: Double)? = hasCoords ? (lat: latitude, lng: longitude) : nil
    if isAlreadyConfirmedParking(parkTime: parkTimestamp, coords: coords, timeTolerance: 300, distanceTolerance: 50) {
      self.log("EMIT GATE [\(source)]: blocked — already in ring buffer")
      self.decision("emit_gate_ring_buffer_dedup", [
        "source": source,
        "parkTimestamp": parkTimestamp.timeIntervalSince1970 * 1000,
        "latitude": latitude,
        "longitude": longitude,
      ])
      return false
    }

    // ── Gate 3: Recent-emission dedup ──
    // If we emitted a parking event very recently at nearly the same location,
    // this is a duplicate from another pipeline racing (e.g. CLVisit fires
    // moments after real-time pipeline already emitted for the same stop).
    // Same 50m tolerance as Gate 2 — duplicate pipelines target the same stop.
    if hasCoords, let lastAt = lastEmittedParkingAt, let lastCoord = lastEmittedParkingCoord {
      let timeSinceLastEmit = Date().timeIntervalSince(lastAt)
      let distFromLastEmit = CLLocation(latitude: latitude, longitude: longitude).distance(from: lastCoord)
      if timeSinceLastEmit < 300 && distFromLastEmit < 50 {
        self.log("EMIT GATE [\(source)]: blocked — recent emission \(String(format: "%.0f", timeSinceLastEmit))s ago, \(String(format: "%.0f", distFromLastEmit))m away")
        self.decision("emit_gate_recent_emission_dedup", [
          "source": source,
          "parkTimestamp": parkTimestamp.timeIntervalSince1970 * 1000,
          "timeSinceLastEmitSec": timeSinceLastEmit,
          "distFromLastEmitMeters": distFromLastEmit,
        ])
        return false
      }
    }

    // ── Gates 4 & 5 removed Mar 2026 ──
    // Gate 4 (hotspot) removed: blocking prevented the "Correct" tap from ever appearing.
    // Gate 5 (lockout) removed: caused cascading false positives.
    // Signal processing guards (CoreMotion+GPS multi-gate) handle false positive prevention.

    // ── All gates passed — record, emit, persist ──

    // Record in ring buffer FIRST (before emit) to prevent race conditions
    // where another pipeline queries the buffer between emit and record.
    recordConfirmedParkingTime(timestamp: parkTimestamp, latitude: latitude, longitude: longitude)

    // Track for recent-emission dedup
    lastEmittedParkingAt = Date()
    if hasCoords {
      lastEmittedParkingCoord = CLLocation(latitude: latitude, longitude: longitude)
    }

    // Attach the driving GPS trajectory (last ~10 fixes at speed > 0.3 m/s) so
    // the server has the car's real path to work with for street disambiguation.
    // Format matches what BackgroundTaskService.ts expects from the Android path:
    // array of {latitude, longitude, heading, speed} objects (LocationService.ts
    // compresses to [lat, lng, heading, speed] tuples before sending to server).
    var emitBody = body
    if !recentDrivingLocations.isEmpty {
      // timestamp is per-fix wall-clock ms — server uses it to truncate the
      // trajectory at carPlay.disconnectAt so post-disconnect walking samples
      // can't contaminate the trajectory vote during street disambiguation.
      let trajectory: [[String: Any]] = recentDrivingLocations.map { loc in
        return [
          "latitude": loc.coordinate.latitude,
          "longitude": loc.coordinate.longitude,
          "heading": loc.course >= 0 ? loc.course : -1,
          "speed": max(0, loc.speed),
          "timestamp": loc.timestamp.timeIntervalSince1970 * 1000,
        ]
      }
      emitBody["driveTrajectory"] = trajectory
      self.log("EMIT GATE [\(source)]: attaching driveTrajectory with \(trajectory.count) fixes")
    }

    // CarPlay context — gated so we only emit timestamps/coords from THIS
    // drive. Without gating, a stale lastCarPlayDisconnectedAt from a previous
    // CarPlay drive (e.g. the user later parked via CoreMotion without
    // CarPlay) would feed the server obsolete coords from yesterday's park.
    if let driveStart = drivingStartTime {
      let connectedDuringDrive = lastCarPlayConnectedAt.map { $0 >= driveStart } ?? false
      let disconnectedDuringDrive = lastCarPlayDisconnectedAt.map { $0 >= driveStart } ?? false
      let carPlayInvolvedThisDrive = connectedDuringDrive || disconnectedDuringDrive || carPlayConnected || carPlayWasActiveThisDrive
      if carPlayInvolvedThisDrive {
        var carPlayContext: [String: Any] = [:]
        if connectedDuringDrive, let connAt = lastCarPlayConnectedAt {
          carPlayContext["connectedAt"] = connAt.timeIntervalSince1970 * 1000
        }
        if disconnectedDuringDrive, let discAt = lastCarPlayDisconnectedAt {
          carPlayContext["disconnectedAt"] = discAt.timeIntervalSince1970 * 1000
          if let lat = lastCarPlayDisconnectLatitude, let lng = lastCarPlayDisconnectLongitude {
            carPlayContext["disconnectLatitude"] = lat
            carPlayContext["disconnectLongitude"] = lng
          }
        }
        carPlayContext["activeDuringDrive"] = carPlayInvolvedThisDrive
        // Head unit identity — only emit when CarPlay was actually involved in
        // this drive. Stale uid from a previous CarPlay drive doesn't belong on
        // a CoreMotion-only park event.
        if carPlayInvolvedThisDrive {
          if let uid = lastCarPlayPortUid, !uid.isEmpty {
            carPlayContext["portUid"] = uid
          }
          if let name = lastCarPlayPortName, !name.isEmpty {
            carPlayContext["portName"] = name
          }
        }
        emitBody["carPlay"] = carPlayContext
      }
    }

    // Apple reverse-geocode — independent address signal using Apple's DB.
    // Server logs it as a 4th vote against PostGIS snap / OSM Nominatim /
    // Mapbox map-matching. Up to 1.5s blocking wait; nil on timeout.
    if hasCoords {
      if let apple = reverseGeocodeWithApple(latitude: latitude, longitude: longitude) {
        emitBody["appleGeocode"] = apple
        self.log("EMIT GATE [\(source)]: Apple geocode: \(apple)")
      }
    }

    // Emit to JS
    sendEvent(withName: "onParkingDetected", body: emitBody)

    // Persist to pending queue (survives JS suspension)
    persistPendingParkingEvent(emitBody)

    self.log("EMIT GATE [\(source)]: EMITTED parking event (lat=\(String(format: "%.6f", latitude)), lng=\(String(format: "%.6f", longitude)), acc=\(String(format: "%.0f", accuracy)))")

    // Send local notification with Correct/Wrong action buttons for ground truth
    if hasCoords {
      sendParkingDetectedNotification(latitude: latitude, longitude: longitude, parkTimestamp: parkTimestamp, source: source)
    }

    return true
  }

  /// Send a local notification with "Correct" / "Not Parked" action buttons.
  /// Attached to the "parking_detected" category so iOS shows the actions on long-press.
  private func sendParkingDetectedNotification(latitude: Double, longitude: Double, parkTimestamp: Date, source: String) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let allowed = settings.authorizationStatus == .authorized ||
                    settings.authorizationStatus == .provisional ||
                    settings.authorizationStatus == .ephemeral
      guard allowed else { return }

      let content = UNMutableNotificationContent()
      content.title = "Parking detected"
      content.body = "Checking parking rules for this location..."
      content.sound = UNNotificationSound.default
      content.categoryIdentifier = "parking_detected"
      content.userInfo = [
        "latitude": latitude,
        "longitude": longitude,
        "parkTimestamp": parkTimestamp.timeIntervalSince1970 * 1000,
        "source": source,
      ]

      let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
      let req = UNNotificationRequest(
        identifier: "parking-\(Int(parkTimestamp.timeIntervalSince1970))",
        content: content,
        trigger: trigger
      )
      UNUserNotificationCenter.current().add(req) { err in
        if let err = err {
          self.log("Parking notification failed: \(err.localizedDescription)")
        }
      }
    }
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

  // Hotspot functions removed Mar 2026:
  // loadFalsePositiveHotspots, saveFalsePositiveHotspots, addFalsePositiveHotspot,
  // reduceFalsePositiveHotspot, hotspotInfo — all removed. The hotspot system had a
  // fundamental flaw: blocking parking detection prevented the "Correct" tap from
  // ever appearing, creating permanent dead zones.

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onParkingDetected", "onDrivingStarted", "onLocationUpdate", "onPossibleDriving", "onPossibleParking", "onParkingCheckCancelled", "onParkingGroundTruth"]
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
      // Start low-frequency GPS keepalive to prevent iOS from killing the app
      // AND catch short drives that CoreMotion misses. 50m/100m uses WiFi+cell
      // positioning (not GPS chip) so battery impact is minimal, but ensures we
      // get location updates frequently enough for speed-based driving detection.
      if !continuousGpsActive {
        locationManager.distanceFilter = 50
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.startUpdatingLocation()
        continuousGpsActive = true
        gpsInKeepaliveMode = true
        self.log("Keepalive GPS started (distanceFilter=50m, accuracy=100m)")
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
    UserDefaults.standard.set(true, forKey: kWasMonitoringKey)
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

  /// Called from AppDelegate when iOS relaunches the app in the background
  /// (e.g. via significantLocationChange). This is a native-only entry point
  /// that doesn't require the React Native bridge to be ready.
  /// It restarts the same monitoring that startMonitoring() sets up.
  func startMonitoringFromBackground() {
    guard CLLocationManager.locationServicesEnabled() else {
      self.log("Background relaunch: location services disabled — cannot restart monitoring")
      return
    }

    let status = locationManager.authorizationStatus
    guard status == .authorizedAlways else {
      self.log("Background relaunch: location permission is \(status.rawValue), need authorizedAlways — cannot restart monitoring")
      return
    }

    guard !isMonitoring else {
      self.log("Background relaunch: already monitoring — skipping")
      return
    }

    self.log("=== BACKGROUND RELAUNCH: restarting monitoring ===")
    decision("background_relaunch_start_monitoring")

    // Always-on: significantLocationChange is low-power (~0% battery impact)
    locationManager.startMonitoringSignificantLocationChanges()

    // CLVisit monitoring for dwell-based parking recovery
    locationManager.startMonitoringVisits()
    loadPersistedVisits()
    self.log("Background relaunch: CLVisit monitoring started")

    // Start CoreMotion
    let coreMotionAvailable = CMMotionActivityManager.isActivityAvailable()
    let coreMotionAuthStatus = CMMotionActivityManager.authorizationStatus()
    self.log("Background relaunch: CoreMotion available=\(coreMotionAvailable), auth=\(coreMotionAuthStatus.rawValue)")

    if coreMotionAvailable && (coreMotionAuthStatus == .authorized || coreMotionAuthStatus == .notDetermined) {
      startMotionActivityMonitoring()
      gpsOnlyMode = false
      self.log("Background relaunch: CoreMotion activity monitoring started")
      if !continuousGpsActive {
        locationManager.distanceFilter = 50
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.startUpdatingLocation()
        continuousGpsActive = true
        gpsInKeepaliveMode = true
        self.log("Background relaunch: Keepalive GPS started (50m, 100m)")
      }
    } else {
      gpsOnlyMode = true
      self.log("Background relaunch: CoreMotion unavailable/denied — GPS-only mode")
      locationManager.distanceFilter = 20
      locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      locationManager.startUpdatingLocation()
      continuousGpsActive = true
    }

    startVehicleSignalMonitoring()
    isMonitoring = true
    UserDefaults.standard.set(true, forKey: kWasMonitoringKey)
    // Only extend camera prewarm on background relaunch if NOT already parked.
    // significantLocationChange fires on cell tower handoffs even while stationary,
    // and unconditionally prewarm'ing here re-armed cameras repeatedly for hours
    // after parking — causing false alerts (e.g. Fullerton camera alert 2+ hours
    // after the user stopped driving, Mar 21 2026).
    // When already parked (hasConfirmedParkingThisSession && !isDriving), the
    // existing CoreMotion/GPS pipelines will arm cameras if driving actually starts.
    if !hasConfirmedParkingThisSession || isDriving {
      extendCameraPrewarm(reason: "background_relaunch", seconds: cameraPrewarmStrongSec)
    } else {
      self.log("Background relaunch: skipping camera prewarm — already parked")
    }
    decision("background_relaunch_monitoring_started", [
      "coreMotionAvailable": coreMotionAvailable,
      "coreMotionAuthStatus": coreMotionAuthStatus.rawValue,
      "gpsOnlyMode": gpsOnlyMode,
    ])
    lastLocationCallbackTime = Date()
    startLocationWatchdog()
    startMonitoringHeartbeat()
    startBootstrapGpsWindow(reason: "background_relaunch")
    self.log("Background relaunch: monitoring fully restarted (gpsOnly=\(gpsOnlyMode))")

    // Check for missed parking after 2s delay (same as regular startMonitoring)
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
      guard let self = self, self.isMonitoring else { return }
      guard !self.isDriving else {
        self.log("Background relaunch recovery: skipping — already driving")
        return
      }
      if let currentLoc = self.locationManager.location {
        self.log("Background relaunch recovery: checking CoreMotion history (loc: \(currentLoc.coordinate.latitude), \(currentLoc.coordinate.longitude) ±\(currentLoc.horizontalAccuracy)m)")
        self.checkForMissedParking(currentLocation: currentLoc)
      } else {
        self.log("Background relaunch recovery: no location — will check on first update")
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
    gpsInKeepaliveMode = false
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
    UserDefaults.standard.set(false, forKey: kWasMonitoringKey)
    isDriving = false
    coreMotionSaysAutomotive = false
    speedSaysMoving = false
    speedMovingConsecutiveCount = 0
    drivingStartTime = nil
    lastDrivingLocation = nil
    lastDrivingHeading = -1
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
    carPlayConnected = false
    lastCarPlayConnectedAt = nil
    lastCarPlayDisconnectedAt = nil
    lastCarPlayDisconnectLatitude = nil
    lastCarPlayDisconnectLongitude = nil
    carPlayWasActiveThisDrive = false
    recentCarPlayInVehicleLocations.removeAll()
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
      "gpsInKeepaliveMode": gpsInKeepaliveMode,
      "coreMotionActive": coreMotionActive,
      "hasAlwaysPermission": locationManager.authorizationStatus == .authorizedAlways,
      "motionAvailable": CMMotionActivityManager.isActivityAvailable(),
      "motionAuthStatus": motionAuthString,
      "gpsOnlyMode": gpsOnlyMode,
      "backgroundRefreshStatus": bgRefreshString,
      "lowPowerModeEnabled": ProcessInfo.processInfo.isLowPowerModeEnabled,
      "vehicleSignalConnected": carAudioConnected,
      "recentVehicleSignal": hasRecentVehicleSignal(180),
      "carPlayConnected": carPlayConnected,
      "lastCarPlayConnectedAt": lastCarPlayConnectedAt?.timeIntervalSince1970 ?? NSNull(),
      "lastCarPlayDisconnectedAt": lastCarPlayDisconnectedAt?.timeIntervalSince1970 ?? NSNull(),
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

  /// Get ALL debug log files (detection + decisions, current + .prev) as a single dict.
  /// Used by the "Send Debug Report" feature so JS can POST everything to the server
  /// without needing a cable. Each value is the raw file contents as a String.
  @objc func getDebugLogBundle(_ maxBytesPerFile: NSNumber, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
    guard let documentsDirectory = paths.first else {
      resolve([String: String]())
      return
    }

    let maxBytes = maxBytesPerFile.intValue > 0 ? maxBytesPerFile.intValue : 2_000_000 // 2MB default
    let fileNames = [
      "parking_detection.log",
      "parking_detection.log.prev",
      "parking_decisions.ndjson",
      "parking_decisions.ndjson.prev",
    ]

    var result: [String: String] = [:]
    for name in fileNames {
      let url = documentsDirectory.appendingPathComponent(name)
      guard FileManager.default.fileExists(atPath: url.path) else {
        result[name] = ""
        continue
      }
      // Read and truncate from the END (most recent data) to keep under maxBytes
      if let data = try? Data(contentsOf: url) {
        let truncated: Data
        if data.count > maxBytes {
          truncated = data.suffix(maxBytes)
        } else {
          truncated = data
        }
        result[name] = String(data: truncated, encoding: .utf8) ?? ""
      } else {
        result[name] = ""
      }
    }

    resolve(result)
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

  /// Returns the recent driving GPS trajectory (last ~10 fixes captured while
  /// the vehicle was moving). JS uses this with RailCorridorGuard to detect
  /// passenger rail trips during driving so we can suppress camera alerts.
  @objc func getRecentDrivingTrajectory(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let trajectory: [[String: Any]] = recentDrivingLocations.map { loc in
      [
        "latitude": loc.coordinate.latitude,
        "longitude": loc.coordinate.longitude,
        "speed": loc.speed,
        "heading": loc.course,
        "accuracy": loc.horizontalAccuracy,
        "timestamp": loc.timestamp.timeIntervalSince1970 * 1000,
      ]
    }
    resolve([
      "trajectory": trajectory,
      "isDriving": isDriving,
      "coreMotionAutomotive": coreMotionSaysAutomotive,
    ])
  }

  /// Set the ephemeral rail-trip flag. When true, native camera alerts are
  /// suppressed for the rest of this trip. Reset automatically on parking
  /// confirmation / departure; JS may also clear it explicitly.
  /// `active` is NSNumber because RN's bridge encodes Bool that way.
  @objc func setRailTripActive(_ active: NSNumber, reason: NSString) {
    let on = active.boolValue
    let wasActive = railTripActive
    railTripActive = on
    railTripReason = reason as String
    if on && !wasActive {
      railTripActiveSince = Date()
      log("Rail trip detected — suppressing camera alerts. reason=\(reason)")
      decision("rail_trip_suppression_on", ["reason": reason])
    } else if !on && wasActive {
      let durationSec = railTripActiveSince.map { Date().timeIntervalSince($0) } ?? 0
      railTripActiveSince = nil
      log("Rail trip cleared after \(Int(durationSec))s. reason=\(reason)")
      decision("rail_trip_suppression_off", ["reason": reason, "durationSec": durationSec])
    }
  }

  // MARK: - Battery Management: GPS on-demand

  /// Start continuous GPS (called when CoreMotion detects driving)
  /// If GPS is already in keepalive mode, ramp up to full accuracy.
  private func startContinuousGps() {
    // Remove distance filter during driving so we get GPS updates even when
    // stationary. Without this, distanceFilter=10 means no updates arrive
    // when the car stops, so the speed-zero parking detection never triggers.
    let wasActive = continuousGpsActive
    let wasKeepalive = gpsInKeepaliveMode
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    if !continuousGpsActive {
      locationManager.startUpdatingLocation()
    }
    continuousGpsActive = true
    gpsInKeepaliveMode = false
    if wasKeepalive {
      self.log("Continuous GPS ramped up from keepalive → full accuracy (driving detected)")
    } else if !wasActive {
      self.log("Continuous GPS ON (driving detected, distanceFilter=none)")
    } else {
      self.log("Continuous GPS already at full accuracy")
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
      gpsInKeepaliveMode = true
    } else {
      // Normal mode: low-frequency GPS that keeps the process alive AND provides
      // enough updates to detect short drives via speed when CoreMotion misses them.
      // 50m/100m uses WiFi+cell (not GPS chip) — minimal battery, but catches
      // trips CoreMotion's M-series coprocessor doesn't classify as automotive.
      locationManager.distanceFilter = 50   // Update every 50m of movement
      locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters  // WiFi+cell positioning
      self.log("Continuous GPS → keepalive mode (distanceFilter=50m, accuracy=100m)")
      // Keep continuousGpsActive = true so the process stays alive
      gpsInKeepaliveMode = true
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
    // Persist to UserDefaults so prewarm survives cold starts (app killed → relaunched
    // via significantLocationChange). Without this, there's a 5-20s arming gap where
    // camera alerts won't fire because all 5 arming conditions start as false.
    UserDefaults.standard.set(newUntil.timeIntervalSince1970, forKey: "com.ticketless.cameraPrewarmUntil")
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
              // Start/ramp-up GPS to GET speed updates. Otherwise we're stuck:
              // - GPS in keepalive mode (200m/3km after parking) — too infrequent for speed
              // - speedSaysMoving stays false forever (keepalive GPS = rare, inaccurate updates)
              // - Driving never detected, departure never recorded, camera alerts never fire
              if !self.continuousGpsActive || self.gpsInKeepaliveMode {
                self.log("CoreMotion says automotive but GPS speed unknown — \(self.gpsInKeepaliveMode ? "ramping up from keepalive" : "starting") GPS to verify")
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
          // Clear GPS averaging buffer — stale fixes from previous parking
          // spot would contaminate the next parking location average.
          self.recentLowSpeedLocations.removeAll()
          // Clear driving trajectory buffer — new drive starts with empty
          // trajectory so the next parking event's driveTrajectory reflects
          // only this drive's path, not leftover fixes from the last trip.
          self.recentDrivingLocations.removeAll()
          // Spin up precise GPS now that we know user is driving
          self.startContinuousGps()
          // Start recording accelerometer data for red light evidence
          self.startAccelerometerRecording()
          // Warm up audio session for background TTS camera alerts
          // TEMPORARILY DISABLED for App Store compliance (guideline 2.5.4)
          // self.configureSpeechAudioSession()

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


  // MARK: - Compass Heading Collection

  /// Start collecting magnetometer heading samples for side-of-street determination.
  private func startCompassCollection() {
    compassHeadingSamples.removeAll()
    locationManager.headingFilter = 1.0
    locationManager.startUpdatingHeading()
    compassCollectionTimer?.invalidate()
    compassCollectionTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { [weak self] _ in
      self?.stopCompassCollection()
    }
    self.log("Compass: started heading collection (target \(compassTargetSamples) samples)")
  }

  private func stopCompassCollection() {
    compassCollectionTimer?.invalidate()
    compassCollectionTimer = nil
    locationManager.stopUpdatingHeading()
    if compassHeadingSamples.count > 0 {
      self.log("Compass: stopped collection with \(compassHeadingSamples.count) samples")
    }
  }

  /// Compute circular mean and standard deviation of collected heading samples.
  private func computeCircularMeanHeading() -> (heading: Double, confidence: Double)? {
    guard compassHeadingSamples.count >= 3 else { return nil }
    var sumSin = 0.0
    var sumCos = 0.0
    for h in compassHeadingSamples {
      let rad = h * .pi / 180.0
      sumSin += sin(rad)
      sumCos += cos(rad)
    }
    let n = Double(compassHeadingSamples.count)
    let avgSin = sumSin / n
    let avgCos = sumCos / n
    let R = sqrt(avgSin * avgSin + avgCos * avgCos)
    var meanRad = atan2(avgSin, avgCos)
    if meanRad < 0 { meanRad += 2 * .pi }
    let meanDeg = meanRad * 180.0 / .pi
    let circularStdDeg = R > 0 ? sqrt(-2.0 * Darwin.log(R)) * 180.0 / .pi : 180.0
    self.log("Compass: circular mean = \(String(format: "%.1f", meanDeg))° ±\(String(format: "%.1f", circularStdDeg))° from \(compassHeadingSamples.count) samples (R=\(String(format: "%.3f", R)))")
    return (heading: meanDeg, confidence: circularStdDeg)
  }

  // MARK: - CLLocationManagerDelegate


  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    guard parkingFinalizationPending else { return }
    guard newHeading.trueHeading >= 0 else { return }
    compassHeadingSamples.append(newHeading.trueHeading)
    if compassHeadingSamples.count >= compassTargetSamples {
      stopCompassCollection()
    }
  }
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    if vehicleSignalMonitoringActive {
      pollVehicleSignal(reason: "location_tick")
    }
    lastLocationCallbackTime = Date()
    let speed = location.speed  // m/s, -1 if unknown

    // Append to GPS trace ring buffer (for camera evidence capture).
    // Only record when driving/moving to avoid filling with parked-state noise.
    if isDriving || coreMotionSaysAutomotive || speedSaysMoving {
      let nowMs = Date().timeIntervalSince1970 * 1000
      gpsTraceBuffer.append(GpsTracePoint(
        timestamp: nowMs,
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude,
        speedMps: max(speed, 0),
        heading: location.course,
        accuracy: location.horizontalAccuracy
      ))
      // Prune old entries (>60s) and cap size
      let cutoffMs = nowMs - (gpsTraceMaxAgeSec * 1000)
      gpsTraceBuffer = gpsTraceBuffer.filter { $0.timestamp >= cutoffMs }
      if gpsTraceBuffer.count > gpsTraceMaxPoints {
        gpsTraceBuffer = Array(gpsTraceBuffer.suffix(gpsTraceMaxPoints))
      }
    }

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

    // CarPlay-on in-vehicle ring buffer — captures fixes regardless of speed
    // for use as a robust median-based parking anchor at disconnect time.
    // Gated on carPlayConnected so walking samples can never enter; bounded
    // accuracy gate prevents trash fixes from polluting the median.
    if carPlayConnected && location.horizontalAccuracy > 0 && location.horizontalAccuracy <= 30 {
      recentCarPlayInVehicleLocations.append(location)
      if recentCarPlayInVehicleLocations.count > maxCarPlayInVehicleLocations {
        recentCarPlayInVehicleLocations.removeFirst()
      }
    }

    // --- Update driving location continuously while in driving state ---
    // Save at ANY speed while CoreMotion says automotive (captures 1 mph creep into spot)
    if isDriving || coreMotionSaysAutomotive {
      lastDrivingLocation = location
      // Capture heading while driving. CLLocation.course is only valid (>=0) when
      // moving; at speed ≈ 0 it becomes -1. We save the last valid heading so we
      // can send it with the parking event for street disambiguation at intersections
      // (e.g. Wolcott vs Lawrence). The stopped-location's .course is usually -1.
      if location.course >= 0 && speed > 1.0 {
        lastDrivingHeading = location.course
      }
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
        recentLowSpeedLocations.removeAll()
        recentDrivingLocations.removeAll()
        // TEMPORARILY DISABLED for App Store compliance (guideline 2.5.4)
        // configureSpeechAudioSession()
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
            recentLowSpeedLocations.removeAll()
            recentDrivingLocations.removeAll()
            startContinuousGps()
            startAccelerometerRecording()
            // TEMPORARILY DISABLED for App Store compliance (guideline 2.5.4)
            // configureSpeechAudioSession()
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
        // Fire onPossibleParking so JS can show "Detecting parking..." UI
        // during the ~13s debounce window. Keeps the user from thinking
        // nothing is happening and manual-checking before auto fires.
        sendEvent(withName: "onPossibleParking", body: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "latitude": location.coordinate.latitude,
          "longitude": location.coordinate.longitude,
          "source": "speed_zero_timer_started",
        ])
        self.log("Emitted onPossibleParking — JS UI should show debounce state")
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
            // Let JS clear the "Detecting parking..." UI state.
            self.sendEvent(withName: "onParkingCheckCancelled", body: [
              "timestamp": Date().timeIntervalSince1970 * 1000,
              "reason": "speed_resumed",
            ])
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

            // Accelerometer engine-idle detection: if the accel buffer shows ongoing
            // vibration consistent with engine idling, block the longNoWalkingStop path.
            // Walking evidence and BT disconnect are unaffected — those are strong signals.
            let accelAnalysis = self.analyzeAccelForEngineIdle(lastSeconds: 10)
            let engineIdleDetected = accelAnalysis.idleLikelihood >= 0.5

            if zeroDuration >= self.minZeroSpeedForAgreeSec &&
               coreMotionStableDuration >= self.coreMotionStabilitySec &&
               gpsSpeedOk &&
               (hasWalkingEvidence || (longNoWalkingStop && !engineIdleDetected) || hasCarDisconnectEvidence) {
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
                "accelIdleLikelihood": accelAnalysis.idleLikelihood,
                "accelStddev": accelAnalysis.stddev,
                "accelSampleCount": accelAnalysis.sampleCount,
                "engineIdleDetected": engineIdleDetected,
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
              if longNoWalkingStop && engineIdleDetected {
                waitReasons.append("engine idle detected (accel stddev=\(String(format: "%.4f", accelAnalysis.stddev)), likelihood=\(String(format: "%.1f", accelAnalysis.idleLikelihood)))")
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
                "accelIdleLikelihood": accelAnalysis.idleLikelihood,
                "accelStddev": accelAnalysis.stddev,
                "accelSampleCount": accelAnalysis.sampleCount,
                "engineIdleDetected": engineIdleDetected,
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
            // HARD TIMEOUT: GPS speed has been ≈0 for 90+ seconds. Even Chicago's
            // longest red lights (6-way intersections like Lincoln/Belmont/Ashland)
            // don't last this long. CoreMotion is wrong — confirm parking regardless.
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

    // GPS averaging: collect low-speed GPS fixes for parking location accuracy.
    // When speed drops below threshold, we're approaching the parking spot.
    // Ring buffer keeps the last N fixes for averaging at confirmation time.
    if isDriving && location.speed >= 0 && location.speed < lowSpeedThresholdMps && location.horizontalAccuracy > 0 && location.horizontalAccuracy <= 50 {
      recentLowSpeedLocations.append(location)
      if recentLowSpeedLocations.count > maxRecentLowSpeedLocations {
        recentLowSpeedLocations.removeFirst()
      }
    } else if location.speed >= 0 && location.speed >= lowSpeedThresholdMps {
      // Still driving fast — clear the buffer, we haven't started stopping yet
      recentLowSpeedLocations.removeAll()
    }

    // Driving-speed trajectory buffer: capture fixes at any non-trivial speed
    // (> 0.3 m/s) so the server can reconstruct the car's path for turn-aware
    // street disambiguation. Lower bound matches Android — the slow-creep fixes
    // right before a stop are exactly the ones that reveal the post-turn street
    // (the 1-2 fixes between turning onto Wolcott and stopping).
    // Accuracy gate (<= 50m) prevents trash fixes from polluting the trajectory.
    if isDriving && location.speed >= drivingBufferMinSpeedMps
       && location.horizontalAccuracy > 0 && location.horizontalAccuracy <= 50 {
      recentDrivingLocations.append(location)
      if recentDrivingLocations.count > maxRecentDrivingLocations {
        recentDrivingLocations.removeFirst()
      }
    }

    // Camera-aware GPS boost: if GPS speed shows movement but CoreMotion hasn't
    // confirmed driving yet, boost GPS from keepalive to full accuracy so camera
    // alerts have precise position data. This closes the 5-30s transition gap at
    // the start of a drive where keepalive mode (50m filter, 100m accuracy) would
    // miss cameras or provide inaccurate positions.
    if cameraAlertsEnabled && gpsInKeepaliveMode && !isDriving && !coreMotionSaysAutomotive
       && location.speed >= 2.5 {
      startBootstrapGpsWindow(reason: "camera_speed_detected")
    }

    // Native camera alerts: fire in BOTH foreground and background.
    // Previously only fired when backgrounded, but JS camera alerts were also
    // failing to fire (settings sync issues), leaving zero camera alerts in any mode.
    // Native now handles all camera alerts. When foregrounded, native sends local
    // notifications only (no TTS for App Store 2.5.4 compliance).
    let appState = UIApplication.shared.applicationState
    let cameraPrewarmed = cameraPrewarmUntil.map { Date() <= $0 } ?? false
    // Speed-triggered scanning: if GPS shows driving speed (≥2.5 m/s ≈ 5.5 mph),
    // scan for cameras immediately — don't wait for CoreMotion/BT to confirm driving.
    // This eliminates the cold start gap. Per-camera speed filters prevent false alerts.
    let speedTriggeredScan = cameraAlertsEnabled && location.speed >= 2.5
    // Only use hasRecentVehicleSignal when NOT already confirmed parked. BT audio
    // events while sitting indoors (connecting AirPods, etc.) were arming cameras
    // and causing false alerts hours after parking (Mar 21, 2026).
    let vehicleSignalArms = !hasConfirmedParkingThisSession && hasRecentVehicleSignal(120)
    let cameraArmed = isDriving || coreMotionSaysAutomotive || speedSaysMoving || vehicleSignalArms || cameraPrewarmed || speedTriggeredScan
    if cameraArmed {
      if cameraAlertsEnabled {
        tripSummaryCameraScanCount += 1
        maybeSendNativeCameraAlert(location, isBackgrounded: appState != .active)
      } else {
        tripSummaryCameraSkippedDisabledCount += 1
        // Log periodically (every 30s) so we can see this in decision logs
        if lastCameraDisabledLogAt.map({ Date().timeIntervalSince($0) >= 30 }) ?? true {
          lastCameraDisabledLogAt = Date()
          decision("camera_check_skipped_disabled", [
            "reason": "cameraAlertsEnabled is false",
            "speedMps": location.speed,
            "heading": location.course,
            "accuracy": location.horizontalAccuracy,
            "isDriving": isDriving,
            "coreMotionAutomotive": coreMotionSaysAutomotive,
            "speedSaysMoving": speedSaysMoving,
            "appState": appState == .active ? "active" : (appState == .background ? "background" : "inactive"),
          ])
        }
      }
    } else {
      tripSummaryCameraSkippedNotArmedCount += 1
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

  private func maybeSendNativeCameraAlert(_ location: CLLocation, isBackgrounded: Bool = true) {
    guard cameraAlertsEnabled else { return }
    if railTripActive {
      // 90-minute auto-expiry: covers the longest Metra ride (BNSF Aurora is
      // ~70 min) with margin. Protects against the flag getting stuck if JS
      // crashes mid-trip without clearing it.
      let activeSec = railTripActiveSince.map { Date().timeIntervalSince($0) } ?? 0
      if activeSec > 5400 {
        railTripActive = false
        railTripActiveSince = nil
        decision("rail_trip_suppression_off", ["reason": "auto_expire_90min", "activeSec": activeSec])
      } else {
        // JS rail-corridor analysis classified this trip as passenger rail.
        // Skip alerts to avoid beeping at trackside cameras on Metra/CTA L.
        // Log periodically so the suppression is visible in decision logs
        // without spamming on every GPS fix.
        let shouldLog = lastRailSuppressionLogAt.map { Date().timeIntervalSince($0) >= 30 } ?? true
        if shouldLog {
          lastRailSuppressionLogAt = Date()
          decision("camera_alert_rail_suppressed", [
            "reason": railTripReason,
            "lat": location.coordinate.latitude,
            "lng": location.coordinate.longitude,
            "speed": location.speed,
            "activeSinceSec": activeSec,
          ])
        }
        return
      }
    }
    let speed = location.speed
    let rawHeading = location.course  // -1 if invalid
    let heading = camSmoothHeading(rawHeading)  // Circular mean of recent headings
    let lat = location.coordinate.latitude
    let lng = location.coordinate.longitude
    let acc = location.horizontalAccuracy

    // Periodic scan heartbeat log (every 15s) — shows the pipeline is alive
    let shouldLogScan = lastCameraScanLogAt.map { Date().timeIntervalSince($0) >= 15 } ?? true
    if shouldLogScan {
      lastCameraScanLogAt = Date()
      decision("camera_scan_heartbeat", [
        "speedMps": speed,
        "heading": heading,
        "accuracy": acc,
        "lat": lat,
        "lng": lng,
        "alertedCameraCount": alertedCameraAtByIndex.count,
        "isBackgrounded": isBackgrounded,
        "speedEnabled": cameraSpeedEnabled,
        "redlightEnabled": cameraRedlightEnabled,
        "totalCameras": Self.chicagoCameras.count,
      ])
    }

    // Require at least somewhat-credible GPS in background before alerting
    if acc <= 0 || acc > 120 {
      decision("camera_gps_accuracy_rejected", [
        "accuracy": acc,
        "threshold": 120,
        "reason": acc <= 0 ? "invalid_accuracy" : "too_inaccurate",
      ])
      return
    }

    // Require valid GPS speed — if speed is negative (iOS reports -1 when speed is
    // unavailable), we have no evidence of movement. Without this check, the per-camera
    // speed filter (`speed >= 0 && speed < minSpeed`) treats invalid speed as "unknown,
    // pass through" and heading/bearing filters also fail-open on heading=-1. Together
    // these let alerts fire while the user is stationary indoors.
    // Bug: Mar 21, 2026 — user received "Red-light camera ahead" at 800 W Fullerton
    // while sitting in a restaurant, because prewarm was still active and speed=-1
    // bypassed all per-camera speed/heading filters.
    if speed < 0 {
      return
    }

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

    // Accuracy compensation: when GPS is imprecise, the user could be closer
    // to a camera than reported. Expand search radius by GPS accuracy (capped
    // at 100m) so we don't miss cameras at the edge of the alert zone.
    let accuracyBonus = (acc > 0) ? min(acc, 100.0) : 0.0
    let effectiveRadius = alertRadius + accuracyBonus

    // Bounding box filter (expanded by accuracy compensation)
    let bboxExtra = accuracyBonus / 111000.0
    let latMin = lat - camBBoxDegrees - bboxExtra
    let latMax = lat + camBBoxDegrees + bboxExtra
    let lngMin = lng - camBBoxDegrees - bboxExtra
    let lngMax = lng + camBBoxDegrees + bboxExtra

    var bestIdx: Int? = nil
    var bestDist: Double = Double.greatestFiniteMagnitude
    var nearestRejectedIdx: Int? = nil
    var nearestRejectedDist: Double = Double.greatestFiniteMagnitude
    var nearestRejectedReason: String? = nil
    let rejectDebugRadius = max(effectiveRadius * 1.4, 220)
    // Speed-adaptive tolerances: widen at low speeds where GPS heading is noisy.
    // Pass automotive state so pedestrians get tighter tolerance (prevents false alerts
    // like 800 W Fullerton at heading 230° matching WB camera at walking speed).
    let isAutomotiveForTolerance = isDriving || coreMotionSaysAutomotive
    let headingTol = camGetHeadingTolerance(speedMps: speed, isAutomotive: isAutomotiveForTolerance)
    let bearingTol = camGetBearingTolerance(speedMps: speed, isAutomotive: isAutomotiveForTolerance)
    var bboxCandidateCount = 0
    var typeFilteredCount = 0
    var speedFilteredCount = 0
    var distanceFilteredCount = 0
    var headingFilteredCount = 0
    var bearingFilteredCount = 0
    var lateralFilteredCount = 0
    var dedupeFilteredCount = 0

    // Compute enforcement hour in Chicago timezone (not device timezone)
    let chicagoTZ = TimeZone(identifier: "America/Chicago") ?? TimeZone.current
    var chicagoCal = Calendar.current
    chicagoCal.timeZone = chicagoTZ
    let chicagoHour = chicagoCal.component(.hour, from: Date())

    for i in 0..<Self.chicagoCameras.count {
      let cam = Self.chicagoCameras[i]

      // Type + schedule filters
      if cam.type == "speed" {
        guard cameraSpeedEnabled else { typeFilteredCount += 1; continue }
        if chicagoHour < speedCamEnforceStartHour || chicagoHour >= speedCamEnforceEndHour { typeFilteredCount += 1; continue }
      } else {
        guard cameraRedlightEnabled else { typeFilteredCount += 1; continue }
      }

      // Fast bbox
      if cam.lat < latMin || cam.lat > latMax { continue }
      if cam.lng < lngMin || cam.lng > lngMax { continue }
      bboxCandidateCount += 1

      let dist = haversineMeters(lat1: lat, lon1: lng, lat2: cam.lat, lon2: cam.lng)
      // When not automotive (likely pedestrian), raise the minimum speed threshold
      // to reject walking-speed GPS. Red-light min of 1.0 m/s is walking pace and
      // caused false alerts at 1.87 m/s (800 W Fullerton, Mar 21 2026).
      let baseMinSpeed = (cam.type == "speed") ? camMinSpeedSpeedCamMps : camMinSpeedRedlightMps
      let minSpeed = (!isAutomotiveForTolerance && baseMinSpeed < 2.5) ? 2.5 : baseMinSpeed
      let perCameraDeduped = alertedCameraAtByIndex[i].map { Date().timeIntervalSince($0) < camAlertDedupeSec } ?? false
      let headingOk = isHeadingMatch(headingDeg: heading, approaches: cam.approaches, tolerance: headingTol)
      let aheadOk = isCameraAhead(userLat: lat, userLng: lng, camLat: cam.lat, camLng: cam.lng, headingDeg: heading, bearingTolerance: bearingTol)
      let lateralOffset = getLateralOffset(userLat: lat, userLng: lng, camLat: cam.lat, camLng: cam.lng, approaches: cam.approaches)
      let lateralOk = lateralOffset == nil || lateralOffset! <= camMaxLateralOffsetMeters

      var rejectReason: String? = nil
      if speed >= 0 && speed < minSpeed {
        rejectReason = "speed_below_min"
        speedFilteredCount += 1
      } else if dist > effectiveRadius {
        rejectReason = "outside_radius"
        distanceFilteredCount += 1
      } else if perCameraDeduped {
        rejectReason = "per_camera_dedupe"
        dedupeFilteredCount += 1
      } else if !headingOk {
        rejectReason = "heading_mismatch"
        headingFilteredCount += 1
      } else if !aheadOk {
        rejectReason = "camera_not_ahead"
        bearingFilteredCount += 1
      } else if !lateralOk {
        rejectReason = "lateral_offset"
        lateralFilteredCount += 1
        log("LATERAL_REJECT: \(cam.address) offset=\(Int(lateralOffset!))m (max \(Int(camMaxLateralOffsetMeters))m) dist=\(Int(dist))m")
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
        } else if reason == "lateral_offset" {
          tripSummaryCameraRejectLateral += 1
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
            "bboxCandidates": bboxCandidateCount,
            "filterCounts": [
              "type": typeFilteredCount,
              "speed": speedFilteredCount,
              "distance": distanceFilteredCount,
              "heading": headingFilteredCount,
              "bearing": bearingFilteredCount,
              "lateral": lateralFilteredCount,
              "dedupe": dedupeFilteredCount,
            ],
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
    // TTS: always speak natively. In foreground, JS CameraAlertService MAY also speak,
    // but since JS camera alerts have been unreliable (settings sync issues), native
    // TTS is now the primary path for both foreground and background. The JS side
    // will be disabled from speaking to avoid double-speak (see startCameraAlerts).
    speakCameraAlert(title)

    // Capture evidence natively for BOTH camera types.
    // JS may be suspended in background, so save to UserDefaults for JS to retrieve later.
    if cam.type == "redlight" {
      captureRedLightEvidenceNatively(cam: cam, speed: speed, heading: heading, accuracy: acc, distance: bestDist)
    } else {
      captureSpeedCameraEvidenceNatively(cam: cam, speed: speed, heading: heading, accuracy: acc, distance: bestDist)
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
      "bboxCandidates": bboxCandidateCount,
      "isBackgrounded": isBackgrounded,
      "notificationOnly": isBackgrounded,  // TTS speaks in foreground; background = notification only (no audio bg mode)
      "isAutomotive": isAutomotiveForTolerance,
      "headingTolerance": headingTol,
      "bearingTolerance": bearingTol,
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
      // Custom spoken alert sounds — iOS plays these as part of the notification (no audio background mode needed)
      if title.lowercased().contains("red") {
        content.sound = UNNotificationSound(named: UNNotificationSoundName("red_light_camera.caf"))
      } else {
        content.sound = UNNotificationSound(named: UNNotificationSoundName("speed_camera.caf"))
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

  /// Configure the audio session for TTS playback.
  /// Called eagerly when driving starts so the audio pipeline is ready before the first alert.
  /// Calling this lazily on the first alert adds ~200ms latency and risks iOS refusing
  /// the session change mid-background.
  /// Note: background TTS requires UIBackgroundModes "audio" which is removed for App Store
  /// compliance (2.5.4). Foreground TTS works without it — audio session is configured as
  /// .playback with .duckOthers so the user's music lowers briefly during the 1-second alert.
  private func configureSpeechAudioSession() {
    guard !speechAudioSessionConfigured else { return }
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, options: [.duckOthers])
      speechAudioSessionConfigured = true
      log("Speech audio session configured (.playback, .duckOthers)")
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
  /// in background).
  ///
  /// FOREGROUND: speaks via AVSpeechSynthesizer. Does NOT need UIBackgroundModes "audio".
  /// BACKGROUND: skips TTS (no audio background mode for App Store 2.5.4 compliance).
  ///   Local notifications still fire and provide the alert.
  ///
  /// Native is the sole TTS path for camera alerts — JS CameraAlertService TTS is disabled
  /// to avoid double-speak.
  private func speakCameraAlert(_ message: String) {
    // Check app state — only speak when in foreground. Background TTS requires the
    // "audio" UIBackgroundMode which was removed for App Store compliance (2.5.4).
    // In background, the local notification (fired separately) is the user's alert.
    let appState = UIApplication.shared.applicationState
    guard appState == .active else {
      log("Native TTS: app backgrounded — skipping speech, notification will alert (appState=\(appState == .background ? "background" : "inactive"))")
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

    // Request a background task to prevent iOS from suspending us mid-speech
    // if the user switches apps during the 1-3 second utterance.
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

    // AVSpeechSynthesizer must be used from the main thread
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
      self.log("Native TTS: speaking '\(message)' (foreground)")
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

    // 3. Build GPS trace from ring buffer (multi-point, up to 60 seconds of approach data)
    let speedMps = max(speed, 0)
    let speedMph = speedMps * 2.2369362920544
    let loc = locationManager.location

    var gpsTrace: [[String: Any]]
    var minSpeedMph: Double = speedMph
    var maxSpeedMph: Double = speedMph
    var fullStopDetected = false

    if gpsTraceBuffer.count >= 2 {
      // Use multi-point trace from ring buffer
      gpsTrace = gpsTraceBuffer.map { pt in
        let ptSpeedMph = pt.speedMps * 2.2369362920544
        return [
          "timestamp": pt.timestamp,
          "latitude": pt.latitude,
          "longitude": pt.longitude,
          "speedMps": pt.speedMps,
          "speedMph": round(ptSpeedMph * 10) / 10,
          "heading": pt.heading,
          "horizontalAccuracyMeters": pt.accuracy,
        ] as [String: Any]
      }
      // Calculate min/max speed from trace
      for pt in gpsTraceBuffer {
        let ptMph = pt.speedMps * 2.2369362920544
        if ptMph < minSpeedMph { minSpeedMph = ptMph }
        if ptMph > maxSpeedMph { maxSpeedMph = ptMph }
        if pt.speedMps < 0.5 { fullStopDetected = true }  // <1.1 mph = essentially stopped
      }
    } else {
      // Fallback: single point (buffer empty or just started driving)
      gpsTrace = [
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
    }

    let speedDeltaMph = maxSpeedMph - minSpeedMph

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
      "minSpeedMph": round(minSpeedMph * 10) / 10,
      "speedDeltaMph": round(speedDeltaMph * 10) / 10,
      "fullStopDetected": fullStopDetected,
      "trace": gpsTrace,
      "tracePointCount": gpsTrace.count,
      "traceDurationSec": gpsTraceBuffer.count >= 2 ? round((gpsTraceBuffer.last!.timestamp - gpsTraceBuffer.first!.timestamp) / 1000 * 10) / 10 : 0,
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

    log("Native red-light evidence captured: \(cam.address) (\(gpsTrace.count) GPS points, \(accelTrace.count) accel samples, speed=\(String(format: "%.1f", speedMph))mph, min=\(String(format: "%.1f", minSpeedMph))mph, delta=\(String(format: "%.1f", speedDeltaMph))mph, fullStop=\(fullStopDetected), peakG=\(String(format: "%.3f", peakG)))")
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

  // MARK: - Native Speed Camera Evidence Capture (background-safe)
  //
  // Same pattern as red-light evidence: when JS is suspended in background,
  // this captures GPS trace + speed data and queues it in UserDefaults.
  // JS retrieves it on next wake via getPendingSpeedCameraEvidence().

  private let kPendingSpeedCameraEvidenceKey = "bg_pending_speed_camera_evidence_v1"

  private func captureSpeedCameraEvidenceNatively(cam: NativeCameraDef, speed: Double, heading: Double, accuracy: Double, distance: Double) {
    let now = Date()
    let ts = now.timeIntervalSince1970 * 1000  // ms for JS compatibility

    // 1. Build GPS trace from ring buffer (multi-point approach data)
    let speedMps = max(speed, 0)
    let speedMph = speedMps * 2.2369362920544
    let loc = locationManager.location

    var gpsTrace: [[String: Any]]
    var minSpeedMph: Double = speedMph
    var maxSpeedMph: Double = speedMph
    var avgSpeedMph: Double = speedMph
    var speedAboveLimit = false

    // Chicago speed cameras ticket at >10 mph over in school zones (20 mph limit)
    // and >6 mph over in park/playground zones.
    // Default speed limit near cameras is 30 mph, school zones 20 mph.
    let postedSpeedMph = 30  // Chicago default; school zones are 20
    let speedCameraThresholdMph = Double(postedSpeedMph) + 6.0  // Trigger threshold

    if gpsTraceBuffer.count >= 2 {
      gpsTrace = gpsTraceBuffer.map { pt in
        let ptSpeedMph = pt.speedMps * 2.2369362920544
        return [
          "timestamp": pt.timestamp,
          "latitude": pt.latitude,
          "longitude": pt.longitude,
          "speedMps": pt.speedMps,
          "speedMph": round(ptSpeedMph * 10) / 10,
          "heading": pt.heading,
          "horizontalAccuracyMeters": pt.accuracy,
        ] as [String: Any]
      }
      // Calculate speed statistics from trace
      var totalSpeedMph: Double = 0
      for pt in gpsTraceBuffer {
        let ptMph = pt.speedMps * 2.2369362920544
        if ptMph < minSpeedMph { minSpeedMph = ptMph }
        if ptMph > maxSpeedMph { maxSpeedMph = ptMph }
        totalSpeedMph += ptMph
        if ptMph > speedCameraThresholdMph { speedAboveLimit = true }
      }
      avgSpeedMph = totalSpeedMph / Double(gpsTraceBuffer.count)
    } else {
      // Fallback: single point
      gpsTrace = [
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
      speedAboveLimit = speedMph > speedCameraThresholdMph
    }

    let speedDeltaMph = maxSpeedMph - minSpeedMph

    // 2. Build speed camera receipt payload
    let receiptId = "spd-\(Int(ts))-\(String(format: "%.5f", cam.lat))-\(String(format: "%.5f", cam.lng))"
    let intersectionId = "\(String(format: "%.4f", cam.lat)),\(String(format: "%.4f", cam.lng))"

    let receipt: [String: Any] = [
      "id": receiptId,
      "type": "speed_camera",
      "deviceTimestamp": ts,
      "cameraAddress": cam.address,
      "cameraLatitude": cam.lat,
      "cameraLongitude": cam.lng,
      "intersectionId": intersectionId,
      "heading": heading,
      "approachSpeedMph": round(speedMph * 10) / 10,
      "minSpeedMph": round(minSpeedMph * 10) / 10,
      "maxSpeedMph": round(maxSpeedMph * 10) / 10,
      "avgSpeedMph": round(avgSpeedMph * 10) / 10,
      "speedDeltaMph": round(speedDeltaMph * 10) / 10,
      "speedAboveLimit": speedAboveLimit,
      "postedSpeedLimitMph": postedSpeedMph,
      "speedCameraThresholdMph": speedCameraThresholdMph,
      "trace": gpsTrace,
      "tracePointCount": gpsTrace.count,
      "traceDurationSec": gpsTraceBuffer.count >= 2 ? round((gpsTraceBuffer.last!.timestamp - gpsTraceBuffer.first!.timestamp) / 1000 * 10) / 10 : 0,
      "distanceMeters": distance,
      "_capturedNatively": true,
      "_persistedAt": now.timeIntervalSince1970,
    ]

    // 3. Append to pending queue
    var queue = UserDefaults.standard.array(forKey: kPendingSpeedCameraEvidenceKey) as? [[String: Any]] ?? []
    queue.append(receipt)
    if queue.count > 20 {
      queue = Array(queue.suffix(20))
    }
    UserDefaults.standard.set(queue, forKey: kPendingSpeedCameraEvidenceKey)

    log("Native speed camera evidence captured: \(cam.address) (\(gpsTrace.count) GPS points, speed=\(String(format: "%.1f", speedMph))mph, min=\(String(format: "%.1f", minSpeedMph))mph, max=\(String(format: "%.1f", maxSpeedMph))mph, avg=\(String(format: "%.1f", avgSpeedMph))mph, aboveLimit=\(speedAboveLimit))")
  }

  /// JS bridge: retrieve all pending speed camera evidence captured natively while JS was suspended.
  @objc func getPendingSpeedCameraEvidence(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let queue = UserDefaults.standard.array(forKey: kPendingSpeedCameraEvidenceKey) as? [[String: Any]] ?? []
    if queue.isEmpty {
      resolve([])
    } else {
      // Expire entries older than 24 hours
      let now = Date().timeIntervalSince1970
      let fresh = queue.filter { entry in
        guard let persistedAt = entry["_persistedAt"] as? Double else { return false }
        return (now - persistedAt) < 86400
      }
      if fresh.count != queue.count {
        UserDefaults.standard.set(fresh, forKey: kPendingSpeedCameraEvidenceKey)
        log("Expired \(queue.count - fresh.count) stale speed camera evidence entries")
      }
      log("Returning \(fresh.count) pending native speed camera evidence entries to JS")
      resolve(fresh)
    }
  }

  /// JS bridge: acknowledge that pending speed camera evidence has been processed.
  @objc func acknowledgeSpeedCameraEvidence(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    UserDefaults.standard.removeObject(forKey: kPendingSpeedCameraEvidenceKey)
    log("Cleared pending speed camera evidence from UserDefaults")
    resolve(true)
  }

  /// Append a JSON line from JS to the native decision log (parking_decisions.ndjson).
  /// This allows JS-side decisions (state machine transitions, departure matching, rejections)
  /// to be captured in the same log file that gets uploaded to the server.
  @objc func appendToDecisionLog(_ jsonLine: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard !jsonLine.isEmpty else {
      resolve(false)
      return
    }
    appendDecisionLogLine(jsonLine)
    resolve(true)
  }

  /// JS bridge: test background TTS for App Store review.
  /// Schedules a spoken alert after `delaySec` seconds so the reviewer can
  /// background the app and hear it speak.  Also fires a local notification.
  /// DISABLED for App Store compliance (guideline 2.5.4 — "audio" background mode removed).
  @objc func testBackgroundTTS(_ delaySec: Double, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    log("testBackgroundTTS: disabled for App Store compliance (2.5.4)")
    resolve(false)
  }

  /// Speak a camera alert regardless of foreground/background state.
  /// Used only for the App Store test flow.
  /// TEMPORARILY DISABLED for App Store compliance (guideline 2.5.4).
  private func forceSpeakCameraAlert(_ message: String) {
    log("Native TTS: disabled for App Store compliance (2.5.4) — skipping forced speech")
    return
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

  private func isCameraAhead(userLat: Double, userLng: Double, camLat: Double, camLng: Double, headingDeg: Double, bearingTolerance: Double? = nil) -> Bool {
    if headingDeg < 0 { return true }  // fail-open
    let bearing = bearingTo(lat1: userLat, lon1: userLng, lat2: camLat, lon2: camLng)
    var diff = abs(headingDeg - bearing)
    if diff > 180 { diff = 360 - diff }
    return diff <= (bearingTolerance ?? camMaxBearingOffHeadingDeg)
  }

  /// Calculate the lateral (cross-track) offset from the user to the camera's approach axis.
  /// Returns the minimum perpendicular distance in meters across all approach directions,
  /// or nil if approach data is missing (fail-open).
  private func getLateralOffset(userLat: Double, userLng: Double, camLat: Double, camLng: Double, approaches: [String]) -> Double? {
    if approaches.isEmpty { return nil }

    let mapping: [String: Double] = [
      "NB": 0, "NEB": 45, "EB": 90, "SEB": 135,
      "SB": 180, "SWB": 225, "WB": 270, "NWB": 315,
    ]

    let dLatMeters = (userLat - camLat) * 111320.0
    let dLngMeters = (userLng - camLng) * 111320.0 * cos(camLat * Double.pi / 180.0)

    var minOffset = Double.greatestFiniteMagnitude

    for approach in approaches {
      guard let approachHeading = mapping[approach] else { return nil } // Unknown — fail open

      let axisX = sin(approachHeading * Double.pi / 180.0) // East component
      let axisY = cos(approachHeading * Double.pi / 180.0) // North component

      let crossTrack = abs(dLngMeters * axisY - dLatMeters * axisX)
      if crossTrack < minOffset {
        minOffset = crossTrack
      }
    }

    return minOffset < Double.greatestFiniteMagnitude ? minOffset : nil
  }

  private func isHeadingMatch(headingDeg: Double, approaches: [String], tolerance: Double? = nil) -> Bool {
    if headingDeg < 0 { return true }      // fail-open
    if approaches.isEmpty { return true }  // fail-open

    let tol = tolerance ?? camHeadingToleranceDeg

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
      if diff <= tol { return true }
    }
    return false
  }

  /// Recovery check: query CoreMotion history to see if we missed a parking event
  /// while the app was killed. Called when significantLocationChange wakes us.
  private var hasCheckedForMissedParking = false
  private var waitingForAccurateGpsForRecovery = false  // true while we spin up GPS for an accurate fix
  private var recoveryDrivingDuration: TimeInterval = 0 // stash the driving duration from CoreMotion query
  private var recoveryParkTime: Date? = nil // stash the CoreMotion parkTime for accurate timestamp
  private var recoveryGpsTimer: Timer? = nil             // timeout for GPS acquisition

  private func checkForMissedParking(currentLocation: CLLocation) {
    // Only check once per app wake to avoid repeated queries
    guard !hasCheckedForMissedParking else { return }
    guard CMMotionActivityManager.isActivityAvailable() else { return }

    hasCheckedForMissedParking = true

    // GUARD: On first install / fresh reinstall, lastConfirmedParkingLocation is nil
    // because the app has never confirmed any parking. CoreMotion's system-wide buffer
    // may contain automotive activities from BEFORE the app was installed (the user was
    // riding in a car, taking an Uber, etc.). Emitting "recovery" events for those trips
    // creates false parking records at the user's current location.
    guard lastConfirmedParkingLocation != nil else {
      self.log("Recovery check: skipping — no prior confirmed parking (first install or fresh reinstall). CoreMotion history may predate app usage.")
      decision("recovery_skipped_first_install")
      return
    }

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

      // ── Deduplication: skip if we already confirmed parking for the last trip ──
      // If lastConfirmedParkingLocation exists and its timestamp is close to the
      // last trip's parkTime, the normal pipeline already caught this stop.
      // Re-emitting would create a duplicate parking record with the wrong timestamp.
      if let lastParking = self.lastConfirmedParkingLocation {
        let lastTrip = trips.last!
        let timeDiff = abs(lastTrip.parkTime.timeIntervalSince(lastParking.timestamp))
        if timeDiff < 3600 {
          // Within 1 hour — same parking event. Also check distance if we have current GPS.
          let distance = currentLocation.distance(from: lastParking)
          if distance < 300 {
            self.log("RECOVERY: skipping — lastConfirmedParkingLocation matches (timeDiff=\(String(format: "%.0f", timeDiff))s, dist=\(String(format: "%.0f", distance))m). Already recorded.")
            // Still restart CoreMotion to ensure fresh callbacks
            if self.coreMotionActive {
              self.activityManager.stopActivityUpdates()
              self.coreMotionActive = false
            }
            self.startMotionActivityMonitoring()
            return
          }
        }
      }

      // ── Emit events for ALL trips ──
      // For intermediate trips: try to match with CLVisit coordinates (iOS
      // tracks dwell locations even when the app is killed). If a CLVisit match
      // is found, the parking event gets real coordinates and JS can check rules.
      // For the LAST trip: use accurate GPS for the current parking location.

      // Emit intermediate trips — try to enrich with CLVisit coordinates
      // IMPORTANT: Each intermediate trip is individually deduplicated against the
      // confirmed parking ring buffer. Without this, recovery re-emits parking events
      // that the normal pipeline already caught (e.g. Byron parking at 7:03 PM was
      // re-emitted at 9:22 PM with drifted CLVisit coords → "3857 N Lincoln Ave").
      //
      // Mar 14 2026 fix: THREE additional guards prevent false intermediate emissions:
      // 1. DWELL TIME: Require 120s+ dwell before next drive starts. A 7-second stop
      //    at a red light is NOT parking. CoreMotion splits drives at ANY brief non-automotive
      //    moment, creating fake "trips" from traffic stops.
      // 2. RING BUFFER RECORD: After emitting, record in ring buffer so subsequent
      //    recovery runs (app resume, significantLocationChange) don't re-emit.
      // 3. SAME-LOCATION DEDUP: If two intermediate trips resolve to the same CLVisit
      //    (within 100m), only emit the first one.
      if trips.count > 1 {
        self.log("RECOVERY: Checking \(trips.count - 1) intermediate trips for deduplication + emission")
        var emittedVisitLocations: [(lat: Double, lng: Double)] = []  // Track emitted locations for same-location dedup

        for i in 0..<(trips.count - 1) {
          let trip = trips[i]
          let nextTrip = trips[i + 1]

          // ── Guard 1: Dwell time filter ──
          // Dwell = time between this trip's park and the next trip's drive start.
          // Red lights, traffic pauses, and pickup/dropoff stops are typically < 2 min.
          // Real parking is almost always > 2 min.
          let dwellSec = nextTrip.driveStart.timeIntervalSince(trip.parkTime)
          if dwellSec < 120 {
            self.log("RECOVERY: Trip \(i + 1) — SKIPPING (dwell only \(String(format: "%.0f", dwellSec))s < 120s minimum, likely red light or brief stop)")
            self.decision("recovery_intermediate_short_dwell", [
              "tripIndex": i + 1,
              "parkTime": trip.parkTime.timeIntervalSince1970 * 1000,
              "dwellSec": dwellSec,
              "driveDurationSec": trip.driveDuration,
            ])
            continue
          }

          // Try to match this parking time with a CLVisit for coordinates FIRST
          // (needed for dedup distance check AND for emission if not a duplicate)
          let visitMatch = self.findVisitForTimestamp(trip.parkTime, toleranceSec: 600)

          // ── Guard 2: Per-trip deduplication (ring buffer) ──
          // Check if this intermediate trip was already confirmed by the normal
          // parking pipeline OR by a previous recovery run.
          let visitCoords: (lat: Double, lng: Double)? = visitMatch.map { (lat: $0.latitude, lng: $0.longitude) }
          if self.isAlreadyConfirmedParking(parkTime: trip.parkTime, coords: visitCoords) {
            self.log("RECOVERY: Trip \(i + 1) — SKIPPING (already confirmed, parkTime=\(trip.parkTime))")
            self.decision("recovery_intermediate_deduped", [
              "tripIndex": i + 1,
              "parkTime": trip.parkTime.timeIntervalSince1970 * 1000,
              "hasVisitCoords": visitMatch != nil,
              "visitLat": visitMatch?.latitude ?? 0,
              "visitLng": visitMatch?.longitude ?? 0,
            ])
            continue  // Skip — already recorded
          }

          // ── Guard 3: Same-location dedup ──
          // Multiple intermediate trips can resolve to the same CLVisit (e.g. two
          // red lights 1 block apart both match the same iOS dwell location).
          // Only emit the first one.
          if let visit = visitMatch {
            let visitLoc = CLLocation(latitude: visit.latitude, longitude: visit.longitude)
            var isDuplicate = false
            for emitted in emittedVisitLocations {
              let emittedLoc = CLLocation(latitude: emitted.lat, longitude: emitted.lng)
              if visitLoc.distance(from: emittedLoc) < 100 {
                isDuplicate = true
                break
              }
            }
            if isDuplicate {
              self.log("RECOVERY: Trip \(i + 1) — SKIPPING (same CLVisit location as already-emitted trip, <100m)")
              self.decision("recovery_intermediate_same_location", [
                "tripIndex": i + 1,
                "parkTime": trip.parkTime.timeIntervalSince1970 * 1000,
                "visitLat": visit.latitude,
                "visitLng": visit.longitude,
              ])
              continue
            }
          }

          let departureTimestamp = trip.driveStart.timeIntervalSince1970 * 1000
          let parkTimestamp = trip.parkTime.timeIntervalSince1970 * 1000

          // Emit departure (from previous parking spot)
          self.sendEvent(withName: "onDrivingStarted", body: [
            "timestamp": departureTimestamp,
            "source": "recovery_historical",
          ])
          self.log("RECOVERY: Trip \(i + 1) — onDrivingStarted at \(trip.driveStart)")

          var body: [String: Any] = [
            "timestamp": parkTimestamp,
            "drivingDurationSec": trip.driveDuration,
            "isHistorical": true,
          ]

          if let visit = visitMatch {
            // CLVisit provided coordinates — JS CAN check parking rules!
            body["latitude"] = visit.latitude
            body["longitude"] = visit.longitude
            body["accuracy"] = visit.accuracy
            body["locationSource"] = "recovery_clvisit"
            body["isFromVisit"] = true
            self.log("RECOVERY: Trip \(i + 1) — CLVisit match! (\(visit.latitude), \(visit.longitude)) ±\(String(format: "%.0f", visit.accuracy))m — parking rules CAN be checked (dwellSec=\(String(format: "%.0f", dwellSec)))")

            // Track for same-location dedup
            emittedVisitLocations.append((lat: visit.latitude, lng: visit.longitude))
          } else {
            // No CLVisit match — emit with no coordinates
            body["latitude"] = 0
            body["longitude"] = 0
            body["accuracy"] = -1  // Signals "no GPS" to JS
            body["locationSource"] = "recovery_historical"
            self.log("RECOVERY: Trip \(i + 1) — no CLVisit match — emitting without coordinates (dwellSec=\(String(format: "%.0f", dwellSec)))")
          }

          // Emit through single gateway — handles ring buffer, dedup, persist.
          let emitLat = body["latitude"] as? Double ?? 0
          let emitLng = body["longitude"] as? Double ?? 0
          let emitAcc = body["accuracy"] as? Double ?? -1
          let emitted = self.emitParkingEventIfNew(
            body: body,
            source: body["locationSource"] as? String ?? "recovery_intermediate",
            parkTimestamp: trip.parkTime,
            latitude: emitLat,
            longitude: emitLng,
            accuracy: emitAcc
          )

          // If we have coordinates and the event was emitted, also send a local notification
          if emitted, visitMatch != nil {
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

      // Dedup the last trip against the ring buffer too (belt + suspenders with
      // the existing lastConfirmedParkingLocation check above).
      if self.isAlreadyConfirmedParking(parkTime: lastTrip.parkTime, coords: nil) {
        self.log("RECOVERY: Last trip — SKIPPING (already confirmed, parkTime=\(lastTrip.parkTime))")
        self.decision("recovery_last_trip_deduped", [
          "parkTime": lastTrip.parkTime.timeIntervalSince1970 * 1000,
          "driveDuration": lastTrip.driveDuration,
        ])
        // Still restart CoreMotion
        if self.coreMotionActive {
          self.activityManager.stopActivityUpdates()
          self.coreMotionActive = false
        }
        self.startMotionActivityMonitoring()
        return
      }

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
      self.recoveryParkTime = lastTrip.parkTime
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

    // Use the CoreMotion parkTime (when driving actually ended) not Date() (current time).
    // Date() would be hours off if the app was suspended/killed between parking and recovery.
    let parkTimestamp = (recoveryParkTime ?? Date()).timeIntervalSince1970 * 1000
    self.log("RECOVERY: Accurate GPS fix: \(location.coordinate.latitude), \(location.coordinate.longitude) ±\(location.horizontalAccuracy)m — emitting parking event (parkTime: \(recoveryParkTime?.description ?? "now"))")

    let body: [String: Any] = [
      "timestamp": parkTimestamp,
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "accuracy": location.horizontalAccuracy,
      "locationSource": "recovery_accurate_gps",
      "drivingDurationSec": recoveryDrivingDuration,
    ]

    lastConfirmedParkingLocation = location
    hasConfirmedParkingThisSession = true
    // NOTE: Do NOT reset hasCheckedForMissedParking here. It gets reset by
    // confirmParking() when the NEXT drive ends. Resetting it here allows
    // the watchdog + checkForMissedParking to re-emit the same parking
    // event repeatedly while the user is still parked.
    persistParkingState()

    // Emit through single gateway — handles ring buffer, dedup, persist.
    let recoveryTimestamp = recoveryParkTime ?? Date()
    emitParkingEventIfNew(
      body: body,
      source: "recovery_accurate_gps",
      parkTimestamp: recoveryTimestamp,
      latitude: location.coordinate.latitude,
      longitude: location.coordinate.longitude,
      accuracy: location.horizontalAccuracy
    )
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
      // When the user DEPARTS a visit location, temporarily boost GPS to catch
      // short trips that CoreMotion might miss (e.g., 5-min drive from Costco to
      // home). In keepalive mode (200m, 3km), GPS doesn't update fast enough for
      // the speed-based driving fallback. Boosting GPS on CLVisit departure gives
      // the speed pipeline a chance to detect the trip.
      let isDeparture = visit.departureDate != Date.distantFuture
      let departureAge = isDeparture ? Date().timeIntervalSince(visit.departureDate) : Double.greatestFiniteMagnitude
      if isDeparture && !isDriving && departureAge < 600 && gpsInKeepaliveMode {
        self.log("CLVisit DEPARTURE while monitoring — boosting GPS to detect possible short trip (departed \(String(format: "%.0f", departureAge))s ago)")
        decision("clvisit_departure_gps_boost", [
          "latitude": visit.coordinate.latitude,
          "longitude": visit.coordinate.longitude,
          "departureAge": departureAge,
          "dwellDuration": visit.departureDate.timeIntervalSince(visit.arrivalDate),
        ])
        startBootstrapGpsWindow(reason: "clvisit_departure")
      } else {
        self.log("CLVisit: monitoring active — stored for coordinate enrichment only (not emitting parking event)")
      }
      return
    }

    if !isDriving &&
       visit.arrivalDate != Date.distantPast &&
       visit.horizontalAccuracy > 0 && visit.horizontalAccuracy < 200 {

      // ── Additional guards for CLVisit-only parking detection ──
      // CLVisit bypasses ALL normal guards (speed, CoreMotion, intersection,
      // confidence scoring). These extra checks reduce false positives from
      // brief slowdowns, passing-through, or stale visits delivered on app wake.

      // Guard 1: Require departure to have occurred (visit is "complete").
      // Arrival-only visits (departure == distantFuture) mean iOS hasn't confirmed
      // the user actually stayed — could be a brief slowdown while driving through.
      if visit.departureDate == Date.distantFuture {
        self.log("CLVisit: skipping — departure not yet confirmed (arrival-only visit, user may still be in transit)")
        decision("clvisit_skipped_no_departure", [
          "latitude": visit.coordinate.latitude,
          "longitude": visit.coordinate.longitude,
          "arrivalDate": visit.arrivalDate.timeIntervalSince1970,
        ])
        return
      }

      // Guard 2: Require minimum dwell duration of 3 minutes.
      // iOS CLVisit can fire for stops as short as ~2 minutes, which includes
      // traffic slowdowns, picking someone up, or waiting at a complex intersection.
      // Real parking is almost always 3+ minutes.
      let dwellDuration = visit.departureDate.timeIntervalSince(visit.arrivalDate)
      if dwellDuration < 180 {
        self.log("CLVisit: skipping — dwell too short (\(String(format: "%.0f", dwellDuration))s < 180s minimum)")
        decision("clvisit_skipped_short_dwell", [
          "latitude": visit.coordinate.latitude,
          "longitude": visit.coordinate.longitude,
          "dwellDurationSec": dwellDuration,
        ])
        return
      }

      // Guard 3: Reject stale visits (arrival > 2 hours ago).
      // After a Jetsam kill, iOS can deliver queued visits from hours ago.
      // These are better handled by checkForMissedParking (which validates
      // against CoreMotion history) rather than blindly emitting here.
      let visitAge = Date().timeIntervalSince(visit.arrivalDate)
      if visitAge > 7200 {
        self.log("CLVisit: skipping — visit too old (arrived \(String(format: "%.0f", visitAge / 60)) min ago > 120 min max)")
        decision("clvisit_skipped_stale", [
          "latitude": visit.coordinate.latitude,
          "longitude": visit.coordinate.longitude,
          "visitAgeSec": visitAge,
        ])
        return
      }

      // Guard 4: GPS speed sanity check — if we have a recent GPS fix showing
      // the user is moving, this visit is likely stale or for a different time.
      if let currentLoc = locationManager.location {
        let gpsAge = Date().timeIntervalSince(currentLoc.timestamp)
        if gpsAge < 30 && currentLoc.speed > minDrivingSpeedMps {
          self.log("CLVisit: skipping — current GPS shows movement (speed=\(String(format: "%.1f", currentLoc.speed)) m/s, GPS age=\(String(format: "%.0f", gpsAge))s)")
          decision("clvisit_skipped_moving", [
            "latitude": visit.coordinate.latitude,
            "longitude": visit.coordinate.longitude,
            "currentSpeed": currentLoc.speed,
            "gpsAgeSec": gpsAge,
          ])
          return
        }
      }

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

      // This visit is at a location we didn't detect parking for.
      // Emit through the single gateway — handles ring buffer dedup, zero-coord rejection, persist.
      self.log("CLVisit: emitting parking event for undetected visit at (\(visit.coordinate.latitude), \(visit.coordinate.longitude)), dwell=\(String(format: "%.0f", dwellDuration))s, age=\(String(format: "%.0f", visitAge / 60))min")

      let body: [String: Any] = [
        "timestamp": visit.arrivalDate.timeIntervalSince1970 * 1000,
        "latitude": visit.coordinate.latitude,
        "longitude": visit.coordinate.longitude,
        "accuracy": visit.horizontalAccuracy,
        "locationSource": "clvisit_realtime",
        "drivingDurationSec": 0,  // Unknown from visit data alone
        "isFromVisit": true,
        "dwellDurationSec": dwellDuration,
      ]

      let emitted = emitParkingEventIfNew(
        body: body,
        source: "clvisit_realtime",
        parkTimestamp: visit.arrivalDate,
        latitude: visit.coordinate.latitude,
        longitude: visit.coordinate.longitude,
        accuracy: visit.horizontalAccuracy
      )

      if emitted {
        let visitLocation = CLLocation(
          coordinate: visit.coordinate,
          altitude: 0,
          horizontalAccuracy: visit.horizontalAccuracy,
          verticalAccuracy: -1,
          timestamp: visit.arrivalDate
        )
        lastConfirmedParkingLocation = visitLocation
        hasConfirmedParkingThisSession = true
        // Notification sent by gateway's sendParkingDetectedNotification (with action buttons)
      }
    }
  }

  /// Legacy: Send a local notification when a CLVisit-based parking event is detected.
  /// Now mostly superseded by sendParkingDetectedNotification in the gateway,
  /// but kept for recovery intermediate trips that call it directly.
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

    // GUARD: Reject stops that happen before minDrivingDurationSec (10s) of driving.
    // A 3-4 second alley slowdown or brief stop at a yield is NOT parking. CoreMotion
    // can misclassify phone jostling as "walking" during slow turns, which would
    // otherwise bypass all GPS guards via the coremotion_walking path.
    // Bug: Mar 18 2026 — Sheffield 2300 block alley false positive. User stopped 3-4s
    // in alley before turning, CoreMotion detected walking, confirmed parking immediately.
    if drivingDuration < minDrivingDurationSec {
      self.log("handlePotentialParking: driving duration \(String(format: "%.0f", drivingDuration))s < \(minDrivingDurationSec)s minimum — ignoring")
      decision("parking_rejected_short_drive", [
        "drivingDurationSec": drivingDuration,
        "minDrivingDurationSec": minDrivingDurationSec,
        "userIsWalking": userIsWalking,
      ])
      return
    }

    if lastStationaryTime == nil {
      lastStationaryTime = Date()
    }

    // CoreMotion-path parking confirmation: requires BOTH CoreMotion non-automotive
    // AND GPS speed ≈ 0 for a sustained period. Previously, this path only waited
    // 8s for CoreMotion debounce with no GPS check — causing false positives at red
    // lights (e.g. Grace & Lincoln, Mar 2026) where CoreMotion stays non-automotive
    // for 30-90s while the car idles at a long red light.
    //
    // Now: 8s debounce (unchanged), then hand off to the speedZeroTimer which
    // already checks GPS speed + CoreMotion stability + walking evidence via the
    // gps_coremotion_agree path. Walking evidence bypasses the GPS wait (walking
    // = user exited the car, definitely parked). Without walking, the
    // gps_coremotion_agree path requires 10s of GPS speed ≈ 0 + 6s CoreMotion
    // stability + either 45s of zero speed OR car disconnect evidence.
    //
    // The parking location is captured at the moment CoreMotion exits automotive
    // (locationAtStopStart) — NOT where the user is when confirmation fires.
    // So even if confirmation takes 20-45s (user walking away), the location
    // is where the car stopped.
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

      // Walking evidence = user exited car. BUT still require GPS speed ≈ 0 for at
      // least 8 seconds. CoreMotion can misclassify phone jostling during slow alley
      // turns as "walking" — a 3-4 second stop is NOT parking even if CoreMotion
      // thinks you're walking.
      // Bug: Mar 18 2026 — Sheffield 2300 block alley. User stopped 3-4s in alley,
      // CoreMotion detected walking from phone jostle, confirmed parking immediately
      // with zero GPS validation. Walking evidence should REDUCE the GPS wait (from
      // 45s to 8s), not ELIMINATE it.
      let walkingEvidenceSec = self.coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
      let zeroDurationForWalking = self.speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
      let minZeroSpeedWithWalkingSec: TimeInterval = 8  // Reduced from 10s (no-walking) but NOT zero
      if userIsWalking || walkingEvidenceSec >= self.minWalkingEvidenceSec {
        if zeroDurationForWalking >= minZeroSpeedWithWalkingSec {
          self.log("handlePotentialParking: walking detected (\(String(format: "%.0f", walkingEvidenceSec))s) + GPS zero for \(String(format: "%.0f", zeroDurationForWalking))s — confirming via coremotion_walking")
          self.confirmParking(source: "coremotion_walking")
          return
        } else {
          // Walking evidence present but GPS hasn't been zero long enough.
          // Defer to the speedZeroTimer which will confirm once GPS catches up.
          self.log("handlePotentialParking: walking detected (\(String(format: "%.0f", walkingEvidenceSec))s) but GPS zero only \(String(format: "%.0f", zeroDurationForWalking))s < \(minZeroSpeedWithWalkingSec)s — deferring to GPS speed path")
          self.decision("coremotion_walking_deferred_to_gps", [
            "walkingEvidenceSec": walkingEvidenceSec,
            "zeroDurationSec": zeroDurationForWalking,
            "minZeroSpeedWithWalkingSec": minZeroSpeedWithWalkingSec,
            "speedSaysMoving": self.speedSaysMoving,
          ])
          // Fall through to the no-walking-evidence GPS deferral path below.
          // locationAtStopStart is preserved for when the speedZeroTimer confirms.
        }
      }

      // No walking evidence. DO NOT confirm from CoreMotion alone — a red light
      // can hold CoreMotion in non-automotive for 60-90s. Instead, rely on the
      // speedZeroTimer (already running in parallel) which uses the stricter
      // gps_coremotion_agree path: GPS speed ≈ 0 for 10s + CoreMotion stable
      // for 6s + either walking/45s-zero-speed/car-disconnect evidence.
      // The speedZeroTimer fires every 3s and will confirm parking once those
      // conditions are met. If the user drives off (red light ends), speedSaysMoving
      // cancels the timer.
      let zeroDuration = self.speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
      self.log("handlePotentialParking: no walking evidence — deferring to GPS speed path (zeroDuration=\(String(format: "%.0f", zeroDuration))s, speedSaysMoving=\(self.speedSaysMoving))")
      self.decision("coremotion_deferred_to_gps", [
        "walkingEvidenceSec": walkingEvidenceSec,
        "zeroDurationSec": zeroDuration,
        "speedSaysMoving": self.speedSaysMoving,
        "coreMotionState": self.coreMotionStateLabel,
      ])
      // Note: locationAtStopStart is preserved — when the speedZeroTimer eventually
      // calls confirmParking(), it will use this location (where the car stopped),
      // not the user's current location.
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
    // Trip is ending — clear the rail-trip flag so the next trip starts
    // with camera alerts unsuppressed. JS also clears this explicitly,
    // but resetting here protects against JS crashes mid-trip.
    if railTripActive {
      railTripActive = false
      railTripActiveSince = nil
      decision("rail_trip_suppression_off", ["reason": "parking_confirmation"])
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
    // Lockout + hotspot checks removed Mar 2026

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

    // Location priority (best → worst):
    // 1. locationAtStopStart    - captured when CoreMotion first said non-automotive (best)
    // 2. lastDrivingLocation    - last GPS while in driving state (very good - includes slow creep)
    // 3. recentLowSpeedLocations.last - GPS captured while the car was slow/stopped
    //                                   approaching the parking spot (still car-side data)
    // 4. locationManager.location - current GPS (last resort - user may have walked away)
    //
    // The recent-low-speed fallback was added because current_fallback events
    // occasionally fire when CoreMotion missed the stop transition and no
    // last_driving fix is cached — using the phone's current GPS in that state
    // is the #1 source of wrong-street misdetects. Low-speed fixes are from
    // ≥ a few seconds ago while the car was still coasting, so they're much
    // closer to the actual rest spot than a fresh GPS sample.
    var parkingLocation = locationAtStopStart ?? lastDrivingLocation
    var parkingLocationSource = locationAtStopStart != nil ? "stop_start" : "last_driving"
    if parkingLocation == nil, let recent = recentLowSpeedLocations.last {
      parkingLocation = recent
      parkingLocationSource = "recent_low_speed"
      self.log("Using recentLowSpeedLocations.last as parking location (stop_start + last_driving both nil): (\(recent.coordinate.latitude), \(recent.coordinate.longitude)) ±\(recent.horizontalAccuracy)m, age=\(String(format: "%.0f", Date().timeIntervalSince(recent.timestamp)))s")
    }
    let currentLocation = locationManager.location
    let isWalking = coreMotionWalkingSince != nil
    if let candidate = parkingLocation {
      let candidateAgeSec = Date().timeIntervalSince(candidate.timestamp)
      let candidateAcc = candidate.horizontalAccuracy
      // A stop candidate is "weak" only if it's genuinely too old/inaccurate
      // AND the user is NOT walking. If walking, the candidate is the best we have
      // because the car hasn't moved — only the phone has.
      let candidateWeak = !isWalking && (
        candidateAgeSec > parkingCandidateMaxAgeSec ||
        (candidateAcc > 0 && candidateAcc > parkingCandidatePreferredAccuracyMeters)
      )

      if candidateWeak, let current = currentLocation {
        let currentAgeSec = Date().timeIntervalSince(current.timestamp)
        let currentAcc = current.horizontalAccuracy
        let currentSpeed = current.speed
        // Proximity guard: only refine if current GPS is within 20m of the candidate.
        // If it's farther, the user has likely walked away.
        let distFromCandidate = current.distance(from: candidate)
        // WALK-AWAY GUARD: If CoreMotion says user is walking, NEVER replace the
        // stop candidate with currentLocation. The car is where we stopped,
        // not where the user walked to. This is the #1 cause of wrong-street errors.
        let currentUsable = !isWalking &&
          distFromCandidate <= 20.0 &&  // Must be within 20m of stop candidate
          currentAgeSec >= 0 &&
          currentAgeSec <= parkingCandidateFreshReplacementAgeSec &&
          currentAcc > 0 &&
          currentAcc <= parkingCandidatePreferredAccuracyMeters &&
          currentSpeed >= 0 &&
          currentSpeed < 1.0  // Tightened from 1.4: filter slow walking

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
        if isWalking && candidateWeak {
          self.log("Walk-away guard: NOT refining to current GPS — user is walking. Keeping \(parkingLocationSource) candidate.")
          decision("parking_location_walkaway_blocked", [
            "source": source,
            "candidateAgeSec": candidateAgeSec,
            "candidateAccuracy": candidateAcc,
            "isWalking": true,
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
    // Hotspot guard removed Mar 2026 — blocking prevented "Correct" tap from ever appearing
    let locationCandidate = parkingLocation ?? currentLocation
    let walkingEvidenceSec = coreMotionWalkingSince.map { Date().timeIntervalSince($0) } ?? 0
    let zeroDurationSec = speedZeroStartTime.map { Date().timeIntervalSince($0) } ?? 0
    let hasRecentDisconnectEvidence: Bool = {
      guard let disconnectedAt = lastCarAudioDisconnectedAt else { return false }
      let age = Date().timeIntervalSince(disconnectedAt)
      return age >= 0 && age <= carDisconnectEvidenceWindowSec
    }()
    let nearIntersectionRisk = self.isNearSignalizedIntersection(locationCandidate)
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
      nearIntersectionRisk: nearIntersectionRisk
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
      nearIntersectionRisk: nearIntersectionRisk,
      confidenceScore: confidenceScore,
      hasRecentDisconnectEvidence: hasRecentDisconnectEvidence
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
      // Include heading (course) for street disambiguation at intersections.
      // CLLocation.course: 0-360 degrees clockwise from true north, -1 if invalid.
      // At stop time, .course is usually -1 (speed too low for valid heading).
      // Fall back to lastDrivingHeading — the last heading captured while the car
      // was still moving (speed > 1 m/s). This is the direction the car was
      // traveling just before it parked, which tells us which street it's on.
      let effectiveHeading: Double
      if loc.course >= 0 {
        effectiveHeading = loc.course
      } else if lastDrivingHeading >= 0 {
        effectiveHeading = lastDrivingHeading
      } else {
        effectiveHeading = -1
      }
      if effectiveHeading >= 0 {
        body["heading"] = effectiveHeading
      }
      let headingLabel = effectiveHeading >= 0
        ? String(format: "%.0f°%@", effectiveHeading, loc.course < 0 ? " (from lastDriving)" : "")
        : "n/a"
      self.log("Parking at (\(body["locationSource"]!)): \(loc.coordinate.latitude), \(loc.coordinate.longitude) ±\(loc.horizontalAccuracy)m heading=\(headingLabel)")
    } else if let loc = currentLocation {
      body["latitude"] = loc.coordinate.latitude
      body["longitude"] = loc.coordinate.longitude
      body["accuracy"] = loc.horizontalAccuracy
      body["locationSource"] = "current_fallback"
      // Same lastDrivingHeading fallback as primary path
      let fallbackHeading = loc.course >= 0 ? loc.course : lastDrivingHeading
      if fallbackHeading >= 0 {
        body["heading"] = fallbackHeading
      }
      self.log("WARNING: Using current location as fallback")
    }

    // GPS averaging: use recent low-speed GPS fixes to improve parking location accuracy.
    // During the last seconds before parking, the car is moving slowly or stopped —
    // averaging multiple fixes reduces urban canyon noise.
    // Filter: only use fixes from the last 60 seconds to prevent stale contamination.
    if !recentLowSpeedLocations.isEmpty {
      let now = Date()
      let recentFixes = recentLowSpeedLocations.filter { now.timeIntervalSince($0.timestamp) <= 60 }

      if recentFixes.count >= 2 {
        // Spatial coherence check: all fixes must be within 100m of the median.
        // If they span too wide an area, the buffer is contaminated with fixes
        // from a different location (e.g. previous parking spot).
        let medianLat = recentFixes.map { $0.coordinate.latitude }.sorted()[recentFixes.count / 2]
        let medianLng = recentFixes.map { $0.coordinate.longitude }.sorted()[recentFixes.count / 2]
        let medianLoc = CLLocation(latitude: medianLat, longitude: medianLng)
        let coherentFixes = recentFixes.filter { $0.distance(from: medianLoc) <= 100 }

        if coherentFixes.count >= 2 {
          // Inverse-variance weighted averaging: a 5m-accuracy fix gets 25x more
          // weight than a 25m fix. Dramatically improves position in urban canyons.
          var avgLat = 0.0
          var avgLng = 0.0
          var totalWeight = 0.0
          for fix in coherentFixes {
            let acc = max(fix.horizontalAccuracy, 1.0)
            let weight = 1.0 / (acc * acc)
            totalWeight += weight
            avgLat += fix.coordinate.latitude * weight
            avgLng += fix.coordinate.longitude * weight
          }
          avgLat /= totalWeight
          avgLng /= totalWeight
          let avgAcc = 1.0 / sqrt(totalWeight)
          body["averagedLatitude"] = avgLat
          body["averagedLongitude"] = avgLng
          body["averagedAccuracy"] = avgAcc
          body["averagedFixCount"] = coherentFixes.count
          self.log("GPS averaging (inverse-variance): \(coherentFixes.count)/\(recentLowSpeedLocations.count) coherent fixes → (\(String(format: "%.6f", avgLat)), \(String(format: "%.6f", avgLng))) ±\(String(format: "%.1f", avgAcc))m")
        } else {
          self.log("GPS averaging: skipped — only \(coherentFixes.count) spatially coherent fixes (need 2+)")
        }
      } else {
        self.log("GPS averaging: skipped — only \(recentFixes.count) recent fixes within 60s (need 2+)")
      }
      // Clear buffer after use — prevents stale fixes leaking into next parking
      recentLowSpeedLocations.removeAll()
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
    startCompassCollection() // Capture magnetometer heading while car is freshly stopped
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
    nearIntersectionRisk: Bool,
    confidenceScore: Int,
    hasRecentDisconnectEvidence: Bool
  ) -> (seconds: TimeInterval, reason: String) {
    // Hotspot hold removed Mar 2026
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
    // No walking evidence AND no BT disconnect — weakest confirmation signal.
    // Use a longer hold (15s) to give one more chance for the light to turn green.
    // Combined with the 75s zero-speed threshold, total wall-clock time is ~98s.
    if walkingEvidenceSec < minWalkingEvidenceSec && !hasRecentDisconnectEvidence {
      return (parkingFinalizationHoldWeakSec, "no_walking_no_disconnect")
    }
    return (parkingFinalizationHoldSec, "balanced_default")
  }

  private func parkingDecisionConfidenceScore(
    source: String,
    zeroDurationSec: TimeInterval,
    walkingEvidenceSec: TimeInterval,
    hasRecentDisconnectEvidence: Bool,
    nearIntersectionRisk: Bool
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
    // Hotspot penalty removed Mar 2026

    return max(0, min(100, score))
  }

  /// Analyze recent accelerometer data for engine idle vibration.
  /// Returns likelihood (0.0-1.0) that the engine is running, plus stddev and sample count.
  /// Engine idle produces continuous low-amplitude vibration (stddev 0.005-0.03g).
  /// A parked car with engine off has near-zero accelerometer variance (stddev < 0.002g).
  /// Uses CMDeviceMotion userAcceleration (gravity already removed).
  private func analyzeAccelForEngineIdle(lastSeconds: TimeInterval = 10) -> (idleLikelihood: Double, stddev: Double, sampleCount: Int) {
    accelBufferLock.lock()
    let buffer = self.accelBuffer
    accelBufferLock.unlock()

    guard buffer.count >= 20 else {
      return (0.0, 0.0, 0)
    }

    let cutoff = buffer.last!.timestamp - lastSeconds
    let recent = buffer.filter { $0.timestamp >= cutoff }

    guard recent.count >= 20 else {
      return (0.0, 0.0, recent.count)
    }

    // Compute magnitude of userAcceleration (gravity already removed by CMDeviceMotion)
    let magnitudes = recent.map { sqrt($0.x * $0.x + $0.y * $0.y + $0.z * $0.z) }

    let mean = magnitudes.reduce(0, +) / Double(magnitudes.count)
    let variance = magnitudes.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(magnitudes.count)
    let stddev = sqrt(variance)

    // Classification:
    // stddev < 0.002  → engine off (parked, very still)         → idleLikelihood = 0.0
    // stddev 0.002-0.005 → ambiguous (could be either)          → idleLikelihood = 0.3
    // stddev 0.005-0.015 → likely engine idle                   → idleLikelihood = 0.7
    // stddev > 0.015 → strong engine idle or road vibration     → idleLikelihood = 0.9
    let idleLikelihood: Double
    if stddev < 0.002 {
      idleLikelihood = 0.0
    } else if stddev < 0.005 {
      idleLikelihood = 0.3
    } else if stddev < 0.015 {
      idleLikelihood = 0.7
    } else {
      idleLikelihood = 0.9
    }

    return (idleLikelihood, stddev, recent.count)
  }

  private func isNearSignalizedIntersection(_ location: CLLocation?) -> Bool {
    guard let loc = location else { return false }
    let lat = loc.coordinate.latitude
    let lng = loc.coordinate.longitude
    // Include BOTH redlight and speed cameras — speed cameras in Chicago are also
    // at signalized intersections (triggered by signal violations). Previously only
    // checking redlight cameras missed locations like Lincoln/Belmont/Ashland which
    // has speed cameras but no redlight camera, causing false positive parking detections.
    for cam in Self.chicagoCameras {
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

    // Hotspot system removed Mar 2026
    decision("intersection_dwell_resumed_non_parking", [
      "dwellSec": dwellSec,
      "movedMeters": movedMeters,
      "speed": speed,
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

    // Mar 2026: Removed the "likelyFalsePositive" confidence gate. If the user
    // is driving 85m+ at 3+ m/s within 120s of parking confirmation, it was
    // ALWAYS a false positive — regardless of confidence score, intersection
    // risk flag, or walking evidence. The previous gate required one of:
    //   - nearIntersectionRisk (missed at Grace & Lincoln, no camera there)
    //   - confidence < 65 (GPS path can produce high confidence at long lights)
    //   - "no_walking" hold reason
    // This caused the Grace & Lincoln incident to NOT unwind because none of
    // those conditions were true, leaving isDriving = false and blocking the
    // real Byron St parking detection entirely.

    // Hotspot system removed Mar 2026

    // Undo parking-state assumptions so the drive pipeline can continue normally.
    hasConfirmedParkingThisSession = false
    lastConfirmedParkingLocation = nil
    clearPersistedParkingState()
    lastConfirmedParkingAt = nil
    lastConfirmedParkingConfidence = -1
    lastConfirmedParkingNearIntersectionRisk = false

    // CRITICAL (Mar 2026 fix): Restart the driving pipeline immediately.
    // Previously, unwind cleared parking state but did NOT set isDriving = true.
    // This caused a cascade failure: false parking at a red light (e.g. Grace & Lincoln)
    // → unwind fires when user resumes driving → isDriving stays false → user parks
    // at real destination → normal parking detection blocked (drivingStartTime is nil)
    // → real parking only caught hours later by checkForMissedParking recovery.
    //
    // The user is clearly driving (speed >= 3.0 m/s, moved >= 85m). Set isDriving = true
    // so the next parking is detected normally with accurate GPS coordinates.
    isDriving = true
    drivingStartTime = Date()
    lastDrivingLocation = nil
    locationAtStopStart = nil
    recentLowSpeedLocations.removeAll()
    speedZeroStartTime = nil
    stopWindowMaxSpeedMps = 0
    speedSaysMoving = true  // We know speed >= 3.0 m/s from the guard above
    speedMovingConsecutiveCount = speedMovingConsecutiveRequired  // Already confirmed moving
    startContinuousGps()
    startAccelerometerRecording()

    decision("parking_post_confirm_unwound", [
      "ageSec": ageSec,
      "movedMeters": movedMeters,
      "speed": speed,
      "confidence": lastParkingDecisionConfidence,
      "holdReason": lastParkingDecisionHoldReason,
      "isDrivingRestarted": true,
    ])
    self.log("Post-confirm unwind: movement \(String(format: "%.0f", movedMeters))m at \(String(format: "%.1f", speed)) m/s within \(String(format: "%.0f", ageSec))s of parking confirm — isDriving RESTARTED")
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
    stopCompassCollection()
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

    // Inject compass heading into payload if collected during finalization hold.
    stopCompassCollection()
    if let compass = computeCircularMeanHeading(), compass.confidence < 40.0 {
      self.log("Compass heading injected: \(String(format: "%.1f", compass.heading))° ±\(String(format: "%.1f", compass.confidence))°")
    }

    // Emit through the single gateway — handles ring buffer, dedup, persist.
    var payload = body
    payload["detectionSource"] = source
    // Add compass heading to payload for server-side street disambiguation
    if let compass = computeCircularMeanHeading(), compass.confidence < 40.0 {
      payload["compassHeading"] = compass.heading
      payload["compassConfidence"] = compass.confidence
    }
    let lat = finalizedLocation?.coordinate.latitude ?? 0
    let lng = finalizedLocation?.coordinate.longitude ?? 0
    let acc = body["accuracy"] as? Double ?? -1
    let parkTs: Date = {
      if let ts = body["timestamp"] as? Double, ts > 0 {
        return Date(timeIntervalSince1970: ts / 1000)
      }
      return Date()
    }()
    emitParkingEventIfNew(
      body: payload,
      source: source,
      parkTimestamp: parkTs,
      latitude: lat,
      longitude: lng,
      accuracy: acc
    )

    // Reset driving state
    isDriving = false
    coreMotionSaysAutomotive = false
    speedSaysMoving = false
    speedMovingConsecutiveCount = 0
    drivingStartTime = nil
    lastStationaryTime = nil
    locationAtStopStart = nil
    // Invalidate speedZeroTimer BEFORE resetting speedZeroStartTime.
    // Between confirmParking() (which invalidates speedZeroTimer) and this
    // finalizeParkingConfirmation() call (5-11s later), a new GPS update with
    // speed ≤ 0.5 can re-create speedZeroTimer (because isDriving is still true
    // and speedZeroTimer is nil). Without this invalidation, the recreated timer
    // fires every 3 seconds for hours generating thousands of spurious
    // gps_coremotion_gate_wait events and wasting battery.
    speedZeroTimer?.invalidate()
    speedZeroTimer = nil
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
    carPlayWasActiveThisDrive = false
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
