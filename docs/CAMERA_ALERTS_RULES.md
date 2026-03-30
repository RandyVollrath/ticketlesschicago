# Camera Alert Reliability — Critical Rules

> Extracted from CLAUDE.md. Covers the rules for keeping camera alerts reliable across both platforms.

See **[CAMERA_ALERTS_RELIABILITY.md](../CAMERA_ALERTS_RELIABILITY.md)** for the full failure log, guard condition reference, and testing checklist.

## The #1 Rule: Default to ON
Every camera alert flag, on every layer, must default to **enabled**. The user explicitly disabling in Settings is the ONLY way to turn them off. History: multiple overlapping disabled-by-default flags caused zero alerts across both platforms (Mar 14, 2026).

## Rules for Any Camera Alert Code Change
1. **NEVER add a `Platform.OS` guard that disables camera alerts on either platform.** If App Store compliance requires removing TTS audio, disable TTS only — not the entire detection pipeline.
2. **NEVER default any camera enable flag to `false`.** This includes: JS `isEnabled`, iOS `cameraAlertsEnabled`, Android `isEnabled`, and per-type flags.
3. **NEVER add an early return to `startCameraAlerts()`** that skips an entire platform. Both platforms need the JS pipeline for diagnostics and pass tracking.
4. **After any camera code change, check the startup notification.** It must say "Camera Alerts Armed" — if it says "CAMERA ALERTS DISABLED", the change broke something.
5. **Test on BOTH platforms.** iOS and Android have independent native modules with independent bugs.
6. **Check the decision log** (`parking_decisions.ndjson`) for `camera_check_skipped_disabled` entries — these mean alerts are silently blocked.
7. **Update CAMERA_ALERTS_RELIABILITY.md** with what was changed, what broke, and what was learned. Every failure is a lesson that must be documented.

## The Settings Sync Chain (must all be true)
```
AsyncStorage (JS) → CameraAlertService.isEnabled → syncNativeSettings() → Native module flag
```
If any link is false, alerts are dead. The startup self-test notification validates the JS side. The native decision log validates the native side.
