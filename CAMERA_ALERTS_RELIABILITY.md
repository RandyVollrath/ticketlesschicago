# Camera Alerts Reliability Tracker

This document tracks every camera alert failure, root cause, fix, and the long-term strategy for making this feature reliable. Updated after every investigation.

## Current State (Mar 14, 2026)

**Status: BROKEN — multiple silent failure modes discovered and fixed**

### Architecture

Camera alerts have 3 layers that must ALL be working:

| Layer | Platform | What it does | Can fail silently? |
|-------|----------|--------------|--------------------|
| **JS CameraAlertService** | Both | Pass tracking, ground truth, diagnostics, feeds GPS to native | YES |
| **Native iOS (BackgroundLocationModule.swift)** | iOS | Proximity detection + local notifications in `didUpdateLocations` | YES |
| **Native Android (CameraAlertModule.kt)** | Android | Proximity detection + TTS + notifications in `onLocationUpdate` | YES |

On iOS, the native layer is the PRIMARY detection mechanism (JS is suspended in background).
On Android, both JS and native run — native handles background TTS, JS handles foreground + diagnostics.

---

## Failure Log

### Failure #1: Mar 14, 2026 — Zero alerts on iOS (3 cameras passed)

**Symptoms:** User drove past 3 cameras on iOS. Zero notifications, zero alerts, zero history entries.

**Root causes found (4 compounding issues):**

1. **JS pipeline completely disabled on iOS** (`BackgroundTaskService.ts:1229`)
   - `if (Platform.OS === 'ios') return;` — hard early return in `startCameraAlerts()`
   - Added for "App Store 2.5.4 compliance" but this killed the JS pipeline entirely
   - JS pipeline is needed for pass tracking, diagnostics, and feeding GPS to CameraAlertService
   - **Fix:** Removed the early return. JS pipeline now runs on both platforms.

2. **Native iOS `cameraAlertsEnabled` defaults to `false`** (`BackgroundLocationModule.swift:798`)
   - Variable declaration: `private var cameraAlertsEnabled = false`
   - `restorePersistedCameraSettings()` only restores if UserDefaults keys exist
   - Fresh install or cleared data → keys don't exist → stays `false`
   - Every GPS update hits guard at line 3007 → silently skipped
   - **Fix:** Default changed to `true`. Restore function now defaults to `true` when keys missing.

3. **JS CameraAlertService defaults to disabled on Android** (`CameraAlertService.ts:472`)
   - `const defaultEnabled = isNewInstall && Platform.OS === 'ios';`
   - Android fresh installs got `defaultEnabled = false` → camera alerts OFF
   - Native Android module also had `isEnabled = false` default
   - **Fix:** Changed to `const defaultEnabled = isNewInstall;` (both platforms). Android native default changed to `true`.

4. **No self-test or warning when alerts are disabled**
   - All these failures were completely silent — no notifications, no logs visible to user
   - Only discoverable by reading decision logs (which require device export)
   - **Fix:** Added startup self-test notification. Shows "CAMERA ALERTS DISABLED" warning or "Camera Alerts Armed" confirmation on every app launch.

**Why this wasn't caught earlier:**
- The comment said "TEMPORARILY DISABLED on iOS for App Store compliance" — sounded intentional
- Native was supposed to handle iOS independently, but native also had disabled defaults
- No end-to-end test exists that validates "did an alert actually fire when driving past a camera?"
- Previous "fixes" claimed to work but never had a validation mechanism

---

## Long-Term Strategy

### Problem Statement
Camera alerts have been "fixed" multiple times and still don't work. The fundamental issue is that **there is no feedback loop between making a code change and confirming it works in the real world.** Changes are made, commits are pushed, and the next test happens days later when the user happens to drive past a camera — by which time the context of what changed is lost.

### Strategy: Defense in Depth + Observable Failure

#### Principle 1: Default to ON, require explicit OFF
Every flag, variable, and setting related to camera alerts must default to **enabled**. The only way to disable is an explicit user action in Settings. No code path should default to disabled.

Checklist:
- [x] JS `CameraAlertService.loadPersistedSettings()` — defaults to enabled on fresh install
- [x] iOS `BackgroundLocationModule.swift` — `cameraAlertsEnabled = true` default
- [x] iOS `restorePersistedCameraSettings()` — defaults to `true` when keys missing
- [x] Android `CameraAlertModule.kt` — `isEnabled = true` default

#### Principle 2: Fail loudly, never silently
Every guard condition that blocks a camera alert must produce a visible signal.

Checklist:
- [x] Startup self-test notification ("Camera Alerts Armed" or "CAMERA ALERTS DISABLED")
- [x] iOS native decision log: `camera_check_skipped_disabled` (every 30s when blocked)
- [x] iOS native decision log: `camera_settings_updated` (when JS syncs settings)
- [ ] TODO: Add "Camera Alerts Started" notification on iOS when driving starts (currently only on Android)
- [ ] TODO: Periodic heartbeat notification while driving ("Camera monitoring active, X cameras scanned, Y alerts fired")

#### Principle 3: Redundant detection
Both JS and native should independently detect cameras. If either fails, the other catches it.

Current state:
- iOS: Native is primary (runs in background). JS is secondary (runs in foreground, does pass tracking).
- Android: Both run. Native handles background TTS. JS handles foreground + all tracking.

Gaps:
- [ ] TODO: iOS JS pipeline was disabled — now re-enabled, but needs verification
- [ ] TODO: Confirm JS `onLocationUpdate` actually receives GPS on iOS when driving

#### Principle 4: End-to-end validation
After every code change to camera alerts, there must be a way to validate without driving past a real camera.

Options:
1. **Simulated drive test**: Script that feeds fake GPS coordinates past a known camera location
2. **Decision log replay**: Feed recorded GPS traces through the detection pipeline
3. **In-app test mode**: Button that simulates approaching a camera at current location

- [ ] TODO: Implement at least one of these validation methods

#### Principle 5: Post-deploy log check
After every deploy that touches camera code, immediately export and check logs for:
1. `camera_settings_updated` with `enabled: true`
2. `module_initialized` (native module loaded)
3. No `camera_check_skipped_disabled` entries
4. At least one `camera_scan_heartbeat` entry during a drive

---

## Guard Conditions Reference

Every condition that can block a camera alert, in execution order:

### iOS Native (BackgroundLocationModule.swift)
| # | Guard | Line | Default | When it blocks |
|---|-------|------|---------|----------------|
| 1 | `cameraArmed` | 3005 | false (until driving detected) | Not driving/no CoreMotion/no speed/no prewarm |
| 2 | `cameraAlertsEnabled` | 3007 | **true** (fixed) | User explicitly disabled |
| 3 | GPS accuracy ≤ 120m | 3587 | - | Poor GPS fix |
| 4 | Announce debounce (10s) | 3590 | - | Alert fired <10s ago |
| 5 | Camera type enabled | per-camera | **true** (fixed) | Speed cameras outside 6am-11pm |
| 6 | Speed threshold | per-camera | - | <3.2 m/s (speed cam) or <1.0 m/s (red-light) |
| 7 | Heading match (±60deg) | per-camera | fail-open | User heading opposite direction |
| 8 | Bearing ahead (±50deg) | per-camera | fail-open | Camera not ahead of user |
| 9 | Distance ≤ alert radius | per-camera | 150-250m | Too far from camera |
| 10 | Per-camera debounce | per-camera | 3 min | Same camera alerted recently |
| 11 | Notification permission | OS | user-dependent | User denied notifications |

### JS CameraAlertService
| # | Guard | Line | Default | When it blocks |
|---|-------|------|---------|----------------|
| 1 | `isActive` | 860 | false | `start()` not called (not driving) |
| 2 | `isEnabled` | 860 | **true** (fixed) | User explicitly disabled |
| 3 | Camera type enabled | per-camera | **true** (fixed) | Speed disabled or red-light disabled |
| 4 | Speed threshold | 1276 | - | Below minimum speed |
| 5 | Bounding box | 1283 | - | No cameras within ~280m lat/lng |
| 6 | Distance ≤ alert radius | 1296 | 150-250m | Beyond speed-adaptive range |
| 7 | Heading match (±60deg) | 1299 | fail-open | Wrong direction |
| 8 | Bearing ahead (±50deg) | 1315 | fail-open | Camera not ahead |
| 9 | Confidence ≥ 55 | 1331 | - | Low confidence → suppressed |
| 10 | Per-camera debounce | 930 | <400m | Already alerted, still nearby |
| 11 | Global 5s debounce | 927 | - | Alert fired <5s ago |

### Android Native (CameraAlertModule.kt)
| # | Guard | Line | Default | When it blocks |
|---|-------|------|---------|----------------|
| 1 | `isEnabled` | 678 | **true** (fixed) | User explicitly disabled |
| 2 | GPS accuracy ≤ 120m | 684 | - | Poor GPS fix |
| 3 | Camera type enabled | per-camera | true | Speed outside 6am-11pm |
| 4 | Speed threshold | per-camera | - | Below minimum |
| 5 | Bounding box | per-camera | - | No cameras nearby |
| 6 | Distance ≤ alert radius | per-camera | 150-250m | Too far |
| 7 | Heading match (±45deg) | per-camera | fail-open | Wrong direction |
| 8 | Bearing ahead (±30deg) | per-camera | fail-open | Not ahead |
| 9 | Per-camera debounce (3 min) | per-camera | - | Same camera recently |
| 10 | Global debounce (5s) | global | - | Alert fired <5s ago |

---

## Testing Checklist (Run After Every Camera Code Change)

### Startup Verification
- [ ] App launches → "Camera Alerts Armed" notification appears (not "DISABLED")
- [ ] Settings screen shows camera toggle ON, speed ON, red-light ON
- [ ] Decision log contains `camera_settings_updated` with `enabled: true`

### Driving Verification
- [ ] When driving starts (BT connect on Android, CoreMotion on iOS):
  - [ ] "Camera Alerts Started" notification appears
  - [ ] Decision log shows `camera_scan_heartbeat` entries
- [ ] When driving near a known camera:
  - [ ] Local notification appears
  - [ ] (Android only) TTS speaks alert
  - [ ] Camera pass recorded in History → Camera tab

### Background Verification (iOS)
- [ ] Background the app → drive past camera → notification fires
- [ ] Kill app → drive near camera → app wakes via significantLocationChange → check if prewarm fires

---

## Files Involved

| File | Role |
|------|------|
| `TicketlessChicagoMobile/src/services/CameraAlertService.ts` | JS orchestrator, settings, pass tracking |
| `TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` | Startup sync, driving detection → camera start/stop |
| `TicketlessChicagoMobile/src/services/BackgroundLocationService.ts` | Bridge to native modules |
| `TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` | iOS native camera detection |
| `TicketlessChicagoMobile/android/app/src/main/java/fyi/ticketless/app/CameraAlertModule.kt` | Android native camera detection |
| `TicketlessChicagoMobile/src/screens/ProfileScreen.tsx` | Settings UI for camera toggles |
| `TicketlessChicagoMobile/src/data/chicago-cameras.ts` | Camera location dataset (510 cameras) |
| `scripts/generate_ios_camera_data.ts` | Generates Swift camera data from TS dataset |
