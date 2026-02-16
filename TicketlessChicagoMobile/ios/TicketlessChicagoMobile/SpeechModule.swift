import Foundation
import AVFoundation
import React

@objc(SpeechModule)
class SpeechModule: RCTEventEmitter, AVSpeechSynthesizerDelegate {

  private let synthesizer = AVSpeechSynthesizer()
  private var isSpeaking = false
  private var audioSessionConfigured = false

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  /// Configure audio session lazily — only when speech is actually needed.
  /// Avoids ducking the user's music/podcast at app startup.
  private func configureAudioSessionIfNeeded() {
    guard !audioSessionConfigured else { return }
    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playback,
        mode: .voicePrompt,
        options: []
      )
      audioSessionConfigured = true
      NSLog("[SpeechModule] Audio session configured (interrupt mode, on first speak)")
    } catch {
      NSLog("[SpeechModule] Failed to configure audio session: \(error)")
    }
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onSpeechFinished"]
  }

  /// Speak a text string using iOS AVSpeechSynthesizer
  @objc func speak(_ text: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }

      // Stop any current speech
      if self.synthesizer.isSpeaking {
        self.synthesizer.stopSpeaking(at: .immediate)
      }

      // Configure audio session lazily on first speak
      self.configureAudioSessionIfNeeded()

      // Activate audio session
      do {
        try AVAudioSession.sharedInstance().setActive(true)
      } catch {
        NSLog("[SpeechModule] Failed to activate audio session: \(error)")
      }

      let utterance = AVSpeechUtterance(string: text)
      utterance.rate = 0.52  // Slightly fast but clear for driving
      utterance.pitchMultiplier = 1.0
      utterance.volume = 1.0

      // Use a clear voice
      if let voice = AVSpeechSynthesisVoice(language: "en-US") {
        utterance.voice = voice
      }

      self.synthesizer.speak(utterance)
      self.isSpeaking = true
      resolve(true)
    }
  }

  /// Stop any current speech
  @objc func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      self?.synthesizer.stopSpeaking(at: .immediate)
      self?.isSpeaking = false
      resolve(true)
    }
  }

  /// Check if TTS is available (always true on iOS)
  @objc func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(true)
  }

  /// Warm up AVAudioSession + synthesizer path without audible speech.
  /// Helps avoid first-alert latency/failure right after driving starts.
  @objc func warmup(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        resolve(false)
        return
      }

      self.configureAudioSessionIfNeeded()
      do {
        try AVAudioSession.sharedInstance().setActive(true)
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        resolve(true)
      } catch {
        NSLog("[SpeechModule] Warmup failed: \(error)")
        resolve(false)
      }
    }
  }

  // MARK: - AVSpeechSynthesizerDelegate

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    isSpeaking = false
    sendEvent(withName: "onSpeechFinished", body: nil)

    // Deactivate audio session to restore other audio
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    } catch {
      NSLog("[SpeechModule] Failed to deactivate audio session: \(error)")
    }
  }
}
