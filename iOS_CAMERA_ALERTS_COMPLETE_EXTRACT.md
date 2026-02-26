# iOS BackgroundLocationModule.swift — Camera Alert Logic (Complete Extract)

## 1. Struct Definition

### NativeCameraDef (Line 2772-2778)
```swift
private struct NativeCameraDef {
  let type: String   // "speed" | "redlight"
  let address: String
  let lat: Double
  let lng: Double
  let approaches: [String]
}
```

## 2. State Variables & Persistence Keys

### Camera Settings State (Line 762-779)
```swift
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
```

### Related State (Line 672, 695)
```swift
private var speedSaysMoving = false            // True when GPS speed > threshold
private var cameraPrewarmUntil: Date? = nil
```

## 3. Camera Alert Tuning Constants (Line 879-905)

```swift
private let cameraPrewarmSec: TimeInterval = 180
private let cameraPrewarmStrongSec: TimeInterval = 300

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
```

### Key Tuning Constants Explained:
- **camBaseAlertRadiusMeters (150m)**: Minimum alert radius (used when GPS speed unavailable)
- **camMaxAlertRadiusMeters (250m)**: Cap on speed-adaptive alert radius
- **camTargetWarningSec (10s)**: Target lookahead time = speed × 10s determines dynamic radius
- **camCooldownRadiusMeters (400m)**: Radius at which per-camera dedupe is cleared
- **camMinSpeedSpeedCamMps (3.2 m/s)**: ~7.2 mph — minimum speed to trigger speed camera alert
- **camMinSpeedRedlightMps (1.0 m/s)**: ~2.2 mph — minimum speed to trigger red-light camera alert
- **camAnnounceMinIntervalSec (5s)**: Global minimum 5s between ANY camera announcement
- **camAlertDedupeSec (180s)**: Per-camera dedupe cooldown — same camera won't alert again for 3 minutes
- **camBBoxDegrees (0.0025)**: Bounding box size in degrees (~280m at Chicago latitudes)
- **camHeadingToleranceDeg (45°)**: Heading tolerance for approach direction matching
- **camMaxBearingOffHeadingDeg (30°)**: Max angle between user heading and camera bearing
- **speedCamEnforceStartHour (6)**: Speed cameras active 6:00 AM
- **speedCamEnforceEndHour (23)**: Speed cameras disabled at 11:00 PM

## 4. Camera Data (Line 2780-3492)

### Static Cameras Array
```swift
private static let chicagoCameras: [NativeCameraDef] = [
  // Generated from TicketlessChicagoMobile/src/data/chicago-cameras.ts (510 cameras)
  NativeCameraDef(type: "speed", address: "3450 W 71st St", lat: 41.7644, lng: -87.7097, approaches: ["WB", "EB"]),
  NativeCameraDef(type: "speed", address: "6247 W Fullerton Ave", lat: 41.9236, lng: -87.7825, approaches: ["EB"]),
  // ... (508 more cameras)
]
```

## 5. Settings Configuration (Received from JS)

### setSameraAlertSettings Method (Line 967-982)
```swift
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
```

### Restore Persisted Camera Settings (Line 944-956)
```swift
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
```

### Persist Camera Settings (Line 961-964)
```swift
let d = UserDefaults.standard
d.set(cameraAlertsEnabled, forKey: kCameraAlertsEnabledKey)
d.set(cameraSpeedEnabled, forKey: kCameraSpeedEnabledKey)
d.set(cameraRedlightEnabled, forKey: kCameraRedlightEnabledKey)
d.set(cameraAlertVolume, forKey: kCameraAlertVolumeKey)
```

## 6. Proximity & Filtering Logic

### Main Camera Proximity Check (Line 3301-3453)

This is the CORE function that runs on every location update while driving.

```swift
// Called from locationManager(_ manager:, didUpdateLocations locations:)
// Only when isDriving==true or speedSaysMoving==true or coreMotionSaysAutomotive==true

let heading = location.course  // -1 if invalid
let lat = location.coordinate.latitude
let lng = location.coordinate.longitude
let acc = location.horizontalAccuracy

// Require at least somewhat-credible GPS in background before alerting
if acc <= 0 || acc > 120 { return }

// Dedupe overall announcements (global 5-second cooldown between ANY camera alerts)
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

// Calculate speed-adaptive alert radius
let alertRadius = cameraAlertRadiusMeters(speedMps: speed)

// Bounding box filter (fast pre-filter before distance calc)
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

// LOOP THROUGH ALL 510 CAMERAS
for i in 0..<Self.chicagoCameras.count {
  let cam = Self.chicagoCameras[i]

  // TYPE + SCHEDULE FILTERS
  if cam.type == "speed" {
    guard cameraSpeedEnabled else { continue }
    let hour = Calendar.current.component(.hour, from: Date())
    if hour < speedCamEnforceStartHour || hour >= speedCamEnforceEndHour { continue }
  } else {
    guard cameraRedlightEnabled else { continue }
  }

  // FAST BOUNDING BOX FILTER
  if cam.lat < latMin || cam.lat > latMax { continue }
  if cam.lng < lngMin || cam.lng > lngMax { continue }

  // DISTANCE CALCULATION
  let dist = haversineMeters(lat1: lat, lon1: lng, lat2: cam.lat, lon2: cam.lng)
  let minSpeed = (cam.type == "speed") ? camMinSpeedSpeedCamMps : camMinSpeedRedlightMps
  let perCameraDeduped = alertedCameraAtByIndex[i].map { Date().timeIntervalSince($0) < camAlertDedupeSec } ?? false
  let headingOk = isHeadingMatch(headingDeg: heading, approaches: cam.approaches)
  let aheadOk = isCameraAhead(userLat: lat, userLng: lng, camLat: cam.lat, camLng: cam.lng, headingDeg: heading)

  // REJECTION TESTS (in order)
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

  // PICK NEAREST CAMERA THAT PASSED ALL FILTERS
  if dist < bestDist {
    bestDist = dist
    bestIdx = i
  }
}

// LOGGING (nearest rejected camera for debugging)
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

// FIRE ALERT
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
```

## 7. Speed-Adaptive Alert Radius Calculation

### cameraAlertRadiusMeters Method (Line 3455-3459)

```swift
private func cameraAlertRadiusMeters(speedMps: Double) -> Double {
  if speedMps < 0 { return camBaseAlertRadiusMeters }
  let dynamic = speedMps * camTargetWarningSec
  return max(camBaseAlertRadiusMeters, min(dynamic, camMaxAlertRadiusMeters))
}
```

**Explanation:**
- If speed unavailable (< 0): return 150m (base radius)
- Otherwise: dynamic = speed × 10 seconds
  - At 5 m/s (11 mph): 50m, clamped to 150m min → **150m**
  - At 15 m/s (33 mph): 150m → **150m**
  - At 20 m/s (45 mph): 200m → **200m**
  - At 25 m/s (56 mph): 250m, clamped to max → **250m**
  - At 30 m/s+ (67+ mph): clamped to 250m → **250m**

## 8. Heading & Direction Logic

### isCameraAhead Method (Line 3859-3865)

Tests if camera is within 30° of the user's heading direction (accounting for 180° wrap-around).

```swift
private func isCameraAhead(userLat: Double, userLng: Double, camLat: Double, camLng: Double, headingDeg: Double) -> Bool {
  if headingDeg < 0 { return true }  // fail-open (heading unavailable)
  let bearing = bearingTo(lat1: userLat, lon1: userLng, lat2: camLat, lon2: camLng)
  var diff = abs(headingDeg - bearing)
  if diff > 180 { diff = 360 - diff }
  return diff <= camMaxBearingOffHeadingDeg  // 30° tolerance
}
```

**Key Point:**
- `headingDeg` is the user's actual heading (0-360°, -1 if unavailable)
- `bearing` is the compass direction FROM user TO camera
- If they differ by more than 30°, camera is not "ahead" (user is turning away from it)
- If heading is unavailable (-1), returns `true` (fail-open, alert anyway)

### isHeadingMatch Method (Line 3867-3889)

Tests if user's heading matches any of the camera's approach directions (within 45° tolerance).

```swift
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
    if diff <= camHeadingToleranceDeg { return true }  // 45° tolerance
  }
  return false
}
```

**Example:**
- Camera approaches: `["WB"]` (West-Bound, 270°)
- User heading: 275°
- Diff: |275 - 270| = 5° ≤ 45° → **MATCH**

- User heading: 310° (heading NW)
- Diff: |310 - 270| = 40° ≤ 45° → **MATCH**

- User heading: 90° (heading E, away from camera)
- Diff: |90 - 270| = 180° → normalized = 180°
- 180° > 45° → **NO MATCH**

### bearingTo Method (Line 3849-3857)

Calculates compass bearing FROM user TO camera using Haversine formula.

```swift
private func bearingTo(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
  let dLon = (lon2 - lon1) * Double.pi / 180.0
  let lat1R = lat1 * Double.pi / 180.0
  let lat2R = lat2 * Double.pi / 180.0
  let y = sin(dLon) * cos(lat2R)
  let x = cos(lat1R) * sin(lat2R) - sin(lat1R) * cos(lat2R) * cos(dLon)
  let brng = atan2(y, x) * 180.0 / Double.pi
  return fmod((brng + 360.0), 360.0)
}
```

Returns bearing in range [0, 360) degrees.

## 9. Notification & TTS

### Local Notification (Line 3461-3486)

```swift
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
    // No notification sound — native TTS speaks the alert in both foreground and background.
    // The visual banner is delivered without sound to avoid overlapping the voice alert.

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
```

### Configure Speech Audio Session (Line 3492-3514)

Called eagerly when driving starts so the audio pipeline is ready BEFORE the first alert.

```swift
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
```

### Handle Audio Interruption (Line 3516-3531)

```swift
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
```

### Speak Camera Alert (Line 3540-3601)

Core TTS function that runs on EVERY camera alert, both foreground and background.

```swift
private func speakCameraAlert(_ message: String) {
  // Speak natively in BOTH foreground and background.
  // Previously only spoke when backgrounded, relying on JS CameraAlertService for
  // foreground TTS. But JS camera alerts had persistent settings sync issues causing
  // zero alerts. Native is now the sole TTS path for camera alerts on iOS.

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
    let currentAppState = UIApplication.shared.applicationState
    self.log("Native TTS: speaking '\(message)' (appState=\(currentAppState == .background ? "background" : currentAppState == .active ? "active" : "inactive"))")
  }
}
```

### Speech Finished Callback (Line 3612-3622)

```swift
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
```

## 10. Red-Light Evidence Capture (Native, for JS Retrieval)

### captureRedLightEvidenceNatively (Line 3632-3720)

Called when a red-light camera alert fires. Captures accelerometer + GPS data natively and stores in UserDefaults for JS to retrieve later (since JS may be suspended in background).

```swift
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
```

### getPendingRedLightEvidence (Line 3723-3741)

JS bridge to retrieve evidence captured natively.

```swift
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
```

### acknowledgeRedLightEvidence (Line 3744-3748)

JS bridge to acknowledge receipt and clear from UserDefaults.

```swift
@objc func acknowledgeRedLightEvidence(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  UserDefaults.standard.removeObject(forKey: kPendingRedLightEvidenceKey)
  log("Cleared pending red-light evidence from UserDefaults")
  resolve(true)
}
```

## 11. Summary of Rejection Reasons

Logged in decision() as `native_camera_candidate_rejected`:

| Reason | Meaning | Guard |
|--------|---------|-------|
| `speed_below_min` | GPS speed below camera threshold (3.2 m/s for speed, 1.0 m/s for redlight) | `if speed >= 0 && speed < minSpeed` |
| `outside_radius` | Distance exceeds speed-adaptive alert radius | `else if dist > alertRadius` |
| `per_camera_dedupe` | Same camera alerted within 3 minutes | `else if perCameraDeduped` |
| `heading_mismatch` | User heading doesn't match any approach direction (within 45°) | `else if !headingOk` |
| `camera_not_ahead` | Camera bearing differs from user heading by > 30° | `else if !aheadOk` |

## 12. Edge Cases & Fail-Safes

1. **Heading unavailable (-1)**: All heading checks return `true` (fail-open). Alert fires without directional validation.
2. **GPS accuracy poor (> 120m)**: Function returns early, no alerting. Protects against false positives from cell-tower GPS.
3. **GPS accuracy unavailable (≤ 0)**: Function returns early.
4. **Empty approaches array**: `isHeadingMatch` returns `true` (fail-open).
5. **Unknown approach string**: `isHeadingMatch` returns `true` (fail-open).
6. **Notification permission denied**: Local notification skipped, but TTS still plays.
7. **Audio session configuration fails**: Log error, skip TTS (degraded but safe).
8. **Speed unavailable (< 0)**: Alert radius defaults to 150m (base radius).

## 13. Key Integration Points

1. **Called from**: `locationManager(_ manager:, didUpdateLocations:)` when `isDriving || coreMotionSaysAutomotive || speedSaysMoving || hasRecentVehicleSignal(120) || cameraPrewarmed`
2. **Driven by**: GPS location updates (typically 10-30 Hz when `allowsBackgroundLocationUpdates = true` and `pausesLocationUpdatesAutomatically = false`)
3. **Settings from JS**: `setCameraAlertSettings(enabled, speedEnabled, redlightEnabled, volume)` via React Native bridge
4. **Evidence to JS**: Red-light evidence stored in UserDefaults, retrieved via `getPendingRedLightEvidence()` on next JS wake
5. **Trip Summary**: Metrics tracked in `tripSummaryCameraAlertCount`, `tripSummaryCameraRejectSpeedLow`, etc.
6. **Decision Log**: All alerts/rejections logged to `.ndjson` file via `decision()` function

