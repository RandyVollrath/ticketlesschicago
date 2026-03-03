import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Initialize Firebase
    FirebaseApp.configure()

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "TicketlessChicagoMobile",
      in: window,
      launchOptions: launchOptions
    )

    // Detect background relaunch by iOS location services.
    // When iOS kills the app (Jetsam) and then a significantLocationChange or
    // CLVisit fires, iOS relaunches the app with the .location key in launchOptions.
    // The React Native bridge starts, but HomeScreen never mounts (app is in background),
    // so autoStartMonitoring() in JS never runs. We need to restart monitoring natively.
    let isBackgroundLocationLaunch = launchOptions?[.location] != nil
    let wasMonitoring = UserDefaults.standard.bool(forKey: "bg_wasMonitoring")

    if isBackgroundLocationLaunch && wasMonitoring {
      NSLog("[AppDelegate] Background location relaunch detected — will restart monitoring")
      // The BackgroundLocationModule is instantiated by React Native's bridge.
      // We need to wait for it to be created. Poll briefly until shared is set.
      scheduleBackgroundMonitoringRestart()
    } else if isBackgroundLocationLaunch {
      NSLog("[AppDelegate] Background location relaunch but monitoring was not active — skipping")
    }

    return true
  }

  /// Poll for BackgroundLocationModule.shared to become available, then restart monitoring.
  /// The RN bridge creates native modules asynchronously. We give it up to 10 seconds.
  private func scheduleBackgroundMonitoringRestart() {
    var attempts = 0
    let maxAttempts = 20 // 20 x 0.5s = 10s max wait

    func tryRestart() {
      attempts += 1
      if let module = BackgroundLocationModule.shared {
        NSLog("[AppDelegate] BackgroundLocationModule available (attempt \(attempts)) — calling startMonitoringFromBackground()")
        module.startMonitoringFromBackground()
      } else if attempts < maxAttempts {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          tryRestart()
        }
      } else {
        NSLog("[AppDelegate] BackgroundLocationModule NOT available after \(maxAttempts) attempts — background restart failed")
      }
    }

    // Start first attempt after 0.5s to give the bridge time to initialize
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      tryRestart()
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
