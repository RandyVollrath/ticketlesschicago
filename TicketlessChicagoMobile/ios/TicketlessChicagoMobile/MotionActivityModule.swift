import Foundation
import CoreMotion
import React

@objc(MotionActivityModule)
class MotionActivityModule: RCTEventEmitter {

  private let activityManager = CMMotionActivityManager()
  private var isMonitoring = false
  private var lastActivity: String = "unknown"

  override init() {
    super.init()
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onActivityChange"]
  }

  /// Check if motion activity is available on this device
  @objc func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(CMMotionActivityManager.isActivityAvailable())
  }

  /// Start monitoring motion activity changes
  @objc func startMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CMMotionActivityManager.isActivityAvailable() else {
      reject("UNAVAILABLE", "Motion activity is not available on this device", nil)
      return
    }

    guard !isMonitoring else {
      resolve(true)
      return
    }

    activityManager.startActivityUpdates(to: .main) { [weak self] activity in
      guard let self = self, let activity = activity else { return }

      let activityType = self.getActivityType(activity)

      // Only emit if activity changed
      if activityType != self.lastActivity {
        let previousActivity = self.lastActivity
        self.lastActivity = activityType

        self.sendEvent(withName: "onActivityChange", body: [
          "activity": activityType,
          "previousActivity": previousActivity,
          "confidence": self.getConfidenceString(activity.confidence),
          "timestamp": activity.startDate.timeIntervalSince1970 * 1000
        ])
      }
    }

    isMonitoring = true
    resolve(true)
  }

  /// Stop monitoring motion activity
  @objc func stopMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    activityManager.stopActivityUpdates()
    isMonitoring = false
    lastActivity = "unknown"
    resolve(true)
  }

  /// Get current activity (one-time query)
  @objc func getCurrentActivity(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CMMotionActivityManager.isActivityAvailable() else {
      reject("UNAVAILABLE", "Motion activity is not available on this device", nil)
      return
    }

    // Query activities from the last 10 seconds
    let now = Date()
    let past = now.addingTimeInterval(-10)

    activityManager.queryActivityStarting(from: past, to: now, to: .main) { [weak self] activities, error in
      guard let self = self else { return }

      if let error = error {
        reject("QUERY_ERROR", error.localizedDescription, error)
        return
      }

      guard let activities = activities, let lastActivity = activities.last else {
        resolve(["activity": "unknown", "confidence": "low"])
        return
      }

      resolve([
        "activity": self.getActivityType(lastActivity),
        "confidence": self.getConfidenceString(lastActivity.confidence),
        "timestamp": lastActivity.startDate.timeIntervalSince1970 * 1000
      ])
    }
  }

  /// Get CoreMotion authorization status
  /// Returns: "authorized", "denied", "restricted", "notDetermined"
  @objc func getAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let status = CMMotionActivityManager.authorizationStatus()
    switch status {
    case .authorized:
      resolve("authorized")
    case .denied:
      resolve("denied")
    case .restricted:
      resolve("restricted")
    case .notDetermined:
      resolve("notDetermined")
    @unknown default:
      resolve("unknown")
    }
  }

  /// Get monitoring status
  @objc func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let authStatus = CMMotionActivityManager.authorizationStatus()
    let authString: String
    switch authStatus {
    case .authorized: authString = "authorized"
    case .denied: authString = "denied"
    case .restricted: authString = "restricted"
    case .notDetermined: authString = "notDetermined"
    @unknown default: authString = "unknown"
    }

    resolve([
      "isMonitoring": isMonitoring,
      "lastActivity": lastActivity,
      "isAvailable": CMMotionActivityManager.isActivityAvailable(),
      "authorizationStatus": authString,
    ])
  }

  // MARK: - Private helpers

  private func getActivityType(_ activity: CMMotionActivity) -> String {
    // Priority order matters - automotive is most specific
    if activity.automotive {
      return "automotive"
    } else if activity.cycling {
      return "cycling"
    } else if activity.running {
      return "running"
    } else if activity.walking {
      return "walking"
    } else if activity.stationary {
      return "stationary"
    } else {
      return "unknown"
    }
  }

  private func getConfidenceString(_ confidence: CMMotionActivityConfidence) -> String {
    switch confidence {
    case .low:
      return "low"
    case .medium:
      return "medium"
    case .high:
      return "high"
    @unknown default:
      return "unknown"
    }
  }
}
