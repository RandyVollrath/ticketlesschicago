# Claude Code Instructions

## iOS Deployment

Whenever a `git pull` is requested, always build and deploy to the attached iPhone afterward if one is connected.

- Device: Randy's iPhone (UDID: `00008110-001239311461801E`)
- Build command: `npx react-native run-ios --udid "00008110-001239311461801E"`
- If the build fails due to entitlements, clean first: `xcodebuild clean -workspace TicketlessChicagoMobile.xcworkspace -scheme TicketlessChicagoMobile -quiet`
- The Associated Domains entitlement must be removed from `ios/TicketlessChicagoMobile/TicketlessChicagoMobile.entitlements` for local debug builds (provisioning profile doesn't support it yet)
- If `package.json` changed, run `npm install` and `cd ios && pod install` before building
- Skip `xcodebuild clean` unless the build fails (incremental builds are much faster)

## iPhone Log Collection

**Try the remote path first. `devicectl` only works on locally-installed builds — it returns `ContainerLookupErrorDomain error 3` for App Store / TestFlight installs.**

### Primary: remote debug report (works on App Store / TestFlight / local)

Shipped in `8da84295` (iOS version ≥ 2.0.7 once that tag is cut). If the user's build has it, the workflow is:

1. User taps **Settings → Send Debug Report** in the app. This POSTs native logs + state to `/api/mobile/submit-debug-report` and returns a report ID.
2. From repo root (not `TicketlessChicagoMobile/`): `node scripts/fetch-debug-report.js` pulls the most recent report and unpacks it to `TicketlessChicagoMobile/logs/remote_<id>/` (`parking_detection.log`, `parking_decisions.ndjson`, plus `metadata.json`, `history.json`, `queue.json`, `summary.txt`).
3. Useful flags: `--list 10` (show recent reports), `--user <email>`, `--id <uuid>`.
4. The unpacked `.log` / `.ndjson` are the same format as the `devicectl`-pulled versions, so `scripts/analyze-parking-decisions.js` and `scripts/replay-parking-camera-log.js` work without changes.
5. Commit the output if debugging a specific incident: `git add -f TicketlessChicagoMobile/logs/remote_<id>/ && git commit && git push origin main`.

If `--list` returns `(no reports)`, the App Store build is older than the feature — ask the user whether they want to cut a new iOS build before burning time on the device-cable fallback.

### Fallback: cable + devicectl (only for locally-installed debug builds)

When a dev build is installed via `npx react-native run-ios`, the app container is accessible. Not usable for App Store installs — don't retry `devicectl` if it errored once.

1. Capture syslog: `idevicesyslog --udid 00008110-001239311461801E` (run in background, kill after 15-30s)
2. Filter for app entries: `grep -iE 'Autopilot|ticketless|CoreMotion|CLLocation|BackgroundLocation|BluetoothMonitor|locationd.*fyi|CMMotionActivity'`
3. Pull crash reports: `idevicecrashreport --udid 00008110-001239311461801E logs/crash_reports_YYYYMMDD/`
4. Export parking logs from the app container:
   ```
   xcrun devicectl device copy from \
     --device 00008110-001239311461801E \
     --domain-type appDataContainer \
     --domain-identifier fyi.ticketless.app \
     --source Documents/parking_detection.log \
     --destination logs/parking_detection.log
   xcrun devicectl device copy from \
     --device 00008110-001239311461801E \
     --domain-type appDataContainer \
     --domain-identifier fyi.ticketless.app \
     --source Documents/parking_decisions.ndjson \
     --destination logs/parking_decisions.ndjson
   ```
   Also pull `.prev` variants (same command, append `.prev` to source/destination).
5. Save to `logs/` and `git add -f && git commit && git push origin main`.
6. React Native `console.log` does NOT appear in iOS syslog. For JS-level logs, use the debug overlay (long-press hero card on iOS) or the remote report's `recent_js_logs.json`.

## Parking/Camera Reliability Workflow

After changing iOS parking or camera detection logic:

1. Export both logs from the app (`parking_detection.log` and `parking_decisions.ndjson`) — via the remote debug report (primary) or devicectl (dev builds only) — and commit them when troubleshooting.
2. Run `node scripts/analyze-parking-decisions.js <path-to-ndjson>` to inspect trip summaries, guard cancellations, unknown fallback usage, and camera alert outcomes.
3. Replay real-world parking/camera logs with `node scripts/replay-parking-camera-log.js TicketlessChicagoMobile/logs/parking_detection.log --strict` before/after tuning thresholds.
4. Validate that `native_camera_alert_fired` and (if applicable) `native_camera_candidate_rejected` events appear with clear reasons.
5. Keep the one-tap correction loop active in-app (`Not parked` / `I parked here`) so repeated false-positive spots are suppressed.

## Commit/Deploy Discipline

1. Do not leave uncommitted local edits after a coding pass.
2. For production-impacting web changes: `git pull --rebase` → `git push origin main` → `npm run deploy`.
3. Confirm production deploy URL in command output and verify `https://autopilotamerica.com` responds after deploy.
