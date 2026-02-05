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
