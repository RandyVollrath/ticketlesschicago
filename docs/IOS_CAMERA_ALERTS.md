# iOS Camera Alerts — Background Reality (Critical)

> Extracted from CLAUDE.md. Covers the native iOS camera alert pipeline, background TTS architecture, data generation, and testing checklist.

**Problem:** On iOS, JavaScript can be suspended while the app is in the background even if native location/motion continues. This means a JS-based camera alert pipeline (e.g. `CameraAlertService.onLocationUpdate`) can miss alerts even when departure/parking detection later looks correct.

**Rule:** Camera alerts in background MUST use native Swift code, not JS. Two mechanisms:
1. Local notifications (always work, even when process is briefly suspended)
2. Native TTS via `AVSpeechSynthesizer` (speaks audibly when app is backgrounded)

## Current Implementation (Feb 18, 2026)
- Native implementation: `TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`
  - Fires local notifications AND speaks TTS for nearby cameras when app is backgrounded.
  - In foreground, only fires local notifications (JS `CameraAlertService` handles TTS via `SpeechModule.swift`).
  - Only runs when driving/automotive is true (or GPS speed indicates movement).
  - Camera dataset is embedded in Swift for guaranteed compilation.
- JS settings sync:
  - `TicketlessChicagoMobile/src/services/BackgroundLocationService.ts` exposes `setCameraAlertSettings(...)`.
  - `TicketlessChicagoMobile/src/services/CameraAlertService.ts` calls it whenever camera settings change.
  - `TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` also pushes settings at startup for safety.

## Background TTS Architecture (Critical — App Store 2.5.4)
The `audio` UIBackgroundMode MUST be justified by actual background audio playback. Here's how it works:

1. **JS TTS is foreground-only**: `SpeechModule.swift` (called from JS `CameraAlertService`) uses `AVSpeechSynthesizer` but JS is suspended in background. This does NOT justify the `audio` background mode.

2. **Native TTS is background-capable**: `BackgroundLocationModule.swift` has its own `AVSpeechSynthesizer` that speaks directly from native location callbacks. This DOES justify the `audio` background mode because:
   - `UIBackgroundModes` includes `audio`
   - Audio session category is `.playback` with `.duckOthers`
   - `AVSpeechSynthesizer.speak()` is called from native code (not JS)
   - `beginBackgroundTask` prevents iOS from suspending mid-speech

3. **Double-speak prevention**: Native TTS checks `UIApplication.shared.applicationState`. If `.active` (foreground), it skips — JS handles it. If `.background` or `.inactive`, native speaks.

4. **Audio session lifecycle**:
   - Configured eagerly at driving start (`configureSpeechAudioSession()` called at all 3 `isDriving = true` transitions)
   - Activated just before each speech
   - Deactivated in `speechSynthesizer(_:didFinish:)` delegate with `.notifyOthersOnDeactivation` to restore user's music
   - Re-configured after audio interruptions (phone calls, Siri) via `AVAudioSession.interruptionNotification`

## Rules for Background TTS
1. **NEVER remove the `audio` UIBackgroundMode** — it's required for `AVSpeechSynthesizer` to work in background. Without it, Apple's audio framework silently fails to produce sound.
2. **NEVER rely on JS for background audio** — iOS suspends JS. Any audio that must work in background MUST be invoked from native Swift/ObjC.
3. **Always use `beginBackgroundTask`** before speaking — iOS gives ~30 seconds, but speech only needs 1-3s. Without it, iOS can suspend between `speak()` and `didFinish`.
4. **Always dispatch to main thread** — `AVSpeechSynthesizer` is more reliable on the main thread for background playback.
5. **Configure audio session BEFORE the app goes to background** — iOS may refuse `.setCategory()` changes in background. That's why `configureSpeechAudioSession()` runs at driving start.
6. **Use `.duckOthers`** instead of no options — this lowers the user's music briefly instead of pausing it, which is less jarring for a 1-second alert.

## Data Generation
- Script: `scripts/generate_ios_camera_data.ts`
- Inserts 510 Chicago camera entries into the Swift file between `// CAMERA_ENTRIES_BEGIN` and `// CAMERA_ENTRIES_END`.

## Testing Checklist (iOS)
- Install a build that includes the native camera code (pulling JS is not enough).
- Ensure iOS notification permission is enabled for the app.
- Enable camera alerts in app settings (this must sync native settings).
- Background the app and drive past a known red-light camera.
- Expect a banner local notification ("Red-light camera ahead") AND a spoken TTS alert even if JS is suspended.
- Verify user's music/podcast resumes (at full volume) after the spoken alert finishes.
