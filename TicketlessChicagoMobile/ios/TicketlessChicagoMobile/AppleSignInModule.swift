import Foundation
import AuthenticationServices
import UIKit
import React
import CommonCrypto

@objc(AppleSignInModule)
class AppleSignInModule: RCTEventEmitter {

  @objc override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  override func supportedEvents() -> [String]! {
    return []  // No events emitted, but RCTEventEmitter requires this override
  }

  // Strong reference to keep the delegate alive during the auth flow
  private var authDelegate: AppleSignInDelegate?

  @objc
  func performSignIn(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {

    NSLog("AppleSignInModule: performSignIn called")

    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        reject("E_DEALLOCATED", "Module was deallocated", nil)
        return
      }

      // Log environment info for debugging
      let bundleId = Bundle.main.bundleIdentifier ?? "nil"
      NSLog("AppleSignInModule: Bundle ID=%@", bundleId)

      // Log provisioning profile info
      if let provisionPath = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") {
        NSLog("AppleSignInModule: Has embedded.mobileprovision at %@", provisionPath)
      } else {
        NSLog("AppleSignInModule: No embedded.mobileprovision found (debug build with automatic signing)")
      }

      // Generate a raw nonce for Supabase verification
      let rawNonce = self.randomNonceString(length: 32)
      let hashedNonce = self.sha256(rawNonce)
      NSLog("AppleSignInModule: Generated nonce (length=%d), hashed for Apple", rawNonce.count)

      // Create the Apple ID request — ONLY Apple ID, no password provider
      let appleIDProvider = ASAuthorizationAppleIDProvider()
      let request = appleIDProvider.createRequest()
      request.requestedScopes = [.fullName, .email]
      request.nonce = hashedNonce
      NSLog("AppleSignInModule: Created ASAuthorizationAppleIDRequest with scopes [fullName, email]")

      // Create the authorization controller with ONLY the Apple ID request
      let authorizationController = ASAuthorizationController(authorizationRequests: [request])
      NSLog("AppleSignInModule: Created ASAuthorizationController")

      // Create a delegate that holds the resolve/reject callbacks
      let delegate = AppleSignInDelegate(rawNonce: rawNonce, resolve: resolve, reject: reject)
      self.authDelegate = delegate

      authorizationController.delegate = delegate
      authorizationController.presentationContextProvider = delegate
      NSLog("AppleSignInModule: Set delegate and presentationContextProvider")

      // Log the window we'll present on
      let window = delegate.presentationAnchor(for: authorizationController)
      NSLog("AppleSignInModule: Presentation anchor: %@, frame=%@, isKeyWindow=%d",
            String(describing: type(of: window)),
            NSCoder.string(for: window.frame),
            window.isKeyWindow ? 1 : 0)
      if let scene = window.windowScene {
        NSLog("AppleSignInModule: Window scene state: %d", scene.activationState.rawValue)
      } else {
        NSLog("AppleSignInModule: WARNING - window has no windowScene!")
      }

      // Perform the request
      NSLog("AppleSignInModule: Calling performRequests...")
      authorizationController.performRequests()
      NSLog("AppleSignInModule: performRequests called (async, waiting for delegate callback)")
    }
  }

  // MARK: - Nonce Utilities

  private func randomNonceString(length: Int = 32) -> String {
    precondition(length > 0)
    var randomBytes = [UInt8](repeating: 0, count: length)
    let errorCode = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
    if errorCode != errSecSuccess {
      fatalError("Unable to generate nonce. SecRandomCopyBytes failed with OSStatus \(errorCode)")
    }
    let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    let nonce = randomBytes.map { byte in
      charset[Int(byte) % charset.count]
    }
    return String(nonce)
  }

  private func sha256(_ input: String) -> String {
    let inputData = Data(input.utf8)
    var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    inputData.withUnsafeBytes {
      _ = CC_SHA256($0.baseAddress, CC_LONG(inputData.count), &hash)
    }
    return hash.map { String(format: "%02x", $0) }.joined()
  }
}

// MARK: - AppleSignInDelegate

private class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {

  private let rawNonce: String
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?

  init(rawNonce: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    self.rawNonce = rawNonce
    self.resolve = resolve
    self.reject = reject
    super.init()
  }

  // MARK: - Presentation Context

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    NSLog("AppleSignInDelegate: presentationAnchor called")

    // Try foreground-active window scene first
    let connectedScenes = UIApplication.shared.connectedScenes
    NSLog("AppleSignInDelegate: %d connected scenes", connectedScenes.count)

    for scene in connectedScenes {
      if scene.activationState == .foregroundActive,
         let windowScene = scene as? UIWindowScene {
        NSLog("AppleSignInDelegate: Found foreground-active UIWindowScene with %d windows", windowScene.windows.count)
        if let keyWindow = windowScene.windows.first(where: { $0.isKeyWindow }) {
          NSLog("AppleSignInDelegate: Returning key window")
          return keyWindow
        }
        if let firstWindow = windowScene.windows.first {
          NSLog("AppleSignInDelegate: No key window, returning first window")
          return firstWindow
        }
      }
    }

    // Fallback: any connected UIWindowScene
    NSLog("AppleSignInDelegate: No foreground-active scene, trying fallback")
    for scene in connectedScenes {
      if let windowScene = scene as? UIWindowScene,
         let window = windowScene.windows.first {
        NSLog("AppleSignInDelegate: Fallback - returning window from scene state=%d", scene.activationState.rawValue)
        return window
      }
    }

    // Last resort: create a new window (should never happen)
    NSLog("AppleSignInDelegate: CRITICAL - No window found anywhere! Creating emergency window")
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.makeKeyAndVisible()
    return window
  }

  // MARK: - ASAuthorizationControllerDelegate

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    NSLog("AppleSignInDelegate: didCompleteWithAuthorization - credential type: %@",
          String(describing: type(of: authorization.credential)))

    guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential else {
      // Could be ASPasswordCredential if we added password provider — handle gracefully
      NSLog("AppleSignInDelegate: Credential is not ASAuthorizationAppleIDCredential, type=%@",
            String(describing: type(of: authorization.credential)))
      reject?("E_UNEXPECTED_CREDENTIAL", "Unexpected credential type: \(type(of: authorization.credential))", nil)
      cleanup()
      return
    }

    guard let identityTokenData = appleIDCredential.identityToken,
          let identityToken = String(data: identityTokenData, encoding: .utf8) else {
      NSLog("AppleSignInDelegate: No identity token in credential")
      reject?("E_NO_TOKEN", "No identity token received from Apple", nil)
      cleanup()
      return
    }

    var authorizationCode: String? = nil
    if let codeData = appleIDCredential.authorizationCode {
      authorizationCode = String(data: codeData, encoding: .utf8)
    }

    var fullName: [String: Any] = [:]
    if let name = appleIDCredential.fullName {
      fullName = [
        "givenName": name.givenName as Any,
        "familyName": name.familyName as Any,
        "middleName": name.middleName as Any,
        "namePrefix": name.namePrefix as Any,
        "nameSuffix": name.nameSuffix as Any,
        "nickname": name.nickname as Any,
      ]
    }

    let result: [String: Any] = [
      "identityToken": identityToken,
      "nonce": rawNonce,
      "user": appleIDCredential.user,
      "email": appleIDCredential.email as Any,
      "fullName": fullName,
      "authorizationCode": authorizationCode as Any,
      "realUserStatus": appleIDCredential.realUserStatus.rawValue,
    ]

    NSLog("AppleSignInDelegate: Success - user=%@, email=%@",
          appleIDCredential.user,
          appleIDCredential.email ?? "nil")

    resolve?(result)
    cleanup()
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    let nsError = error as NSError
    NSLog("AppleSignInDelegate: didCompleteWithError - code=%d, domain=%@, description=%@",
          nsError.code, nsError.domain, nsError.localizedDescription)
    NSLog("AppleSignInDelegate: Full userInfo: %@", nsError.userInfo.description)

    if let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
      NSLog("AppleSignInDelegate: Underlying error - code=%d, domain=%@, description=%@",
            underlyingError.code, underlyingError.domain, underlyingError.localizedDescription)
      NSLog("AppleSignInDelegate: Underlying userInfo: %@", underlyingError.userInfo.description)
    }

    // Build a detailed error message for JS-side diagnosis
    var detailedMessage = "code=\(nsError.code) domain=\(nsError.domain) desc=\(nsError.localizedDescription)"
    if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
      detailedMessage += " | underlying: code=\(underlying.code) domain=\(underlying.domain) desc=\(underlying.localizedDescription)"
    }
    // Include all userInfo keys for debugging
    let userInfoKeys = nsError.userInfo.keys.map { String(describing: $0) }.joined(separator: ", ")
    detailedMessage += " | userInfoKeys=[\(userInfoKeys)]"

    reject?(String(nsError.code), detailedMessage, error)
    cleanup()
  }

  private func cleanup() {
    resolve = nil
    reject = nil
  }
}
