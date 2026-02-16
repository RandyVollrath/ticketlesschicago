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

Every time the iPhone is connected (or on each `git pull`), capture and push logs so Ubuntu Claude can debug:

1. Capture syslog: `idevicesyslog --udid 00008110-001239311461801E` (run in background, kill after 15-30s)
2. Filter for app entries: `grep -iE 'Autopilot|ticketless|CoreMotion|CLLocation|BackgroundLocation|BluetoothMonitor|locationd.*fyi|CMMotionActivity'`
3. Pull crash reports: `idevicecrashreport --udid 00008110-001239311461801E logs/crash_reports_YYYYMMDD/`
4. Save to `logs/` directory and `git add && git commit && git push origin main`
5. Note: React Native `console.log` does NOT appear in iOS syslog. For JS-level logs, use the debug overlay (long-press hero card on iOS)

## Parking/Camera Reliability Workflow

After changing iOS parking or camera detection logic:

1. Export both logs from the app (`parking_detection.log` and `parking_decisions.ndjson`) and commit them when troubleshooting.
2. Run `node scripts/analyze-parking-decisions.js <path-to-ndjson>` to inspect trip summaries, guard cancellations, unknown fallback usage, and camera alert outcomes.
3. Validate that `native_camera_alert_fired` and (if applicable) `native_camera_candidate_rejected` events appear with clear reasons.
4. Keep the one-tap correction loop active in-app (`Not parked` / `I parked here`) so repeated false-positive spots are suppressed.

## Commit/Deploy Discipline

1. Do not leave uncommitted local edits after a coding pass.
2. For production-impacting web changes: `git pull --rebase` → `git push origin main` → `npm run deploy`.
3. Confirm production deploy URL in command output and verify `https://autopilotamerica.com` responds after deploy.
