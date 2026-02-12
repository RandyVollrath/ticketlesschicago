# Autopilot Mobile App - Release v1.0.1

## Release Artifacts

### Android (Google Play Store)
- **AAB File**: `autopilot-v1.0.1-release.aab` (49MB)
- **Version Code**: 2
- **Version Name**: 1.0.1
- **Package ID**: `com.ticketlesschicagomobile`
- **Min SDK**: 24 (Android 7.0)
- **Target SDK**: 36

### iOS (App Store)
- **Bundle ID**: `fyi.ticketless.app`
- **Version**: 1.0.1
- **Build Number**: 2
- **Min iOS**: 15.1
- **Development Team**: V22BMBQJ67

---

## Google Play Store Upload Instructions

### 1. Access Google Play Console
1. Go to https://play.google.com/console
2. Sign in with your developer account
3. Select your app or create a new app

### 2. If Creating New App
1. Click "Create app"
2. Fill in:
   - App name: **Autopilot**
   - Default language: English (United States)
   - App or game: App
   - Free or paid: Free (or Paid)
3. Accept the Developer Program Policies

### 3. Complete Store Listing
Required information:
- **App name**: Autopilot
- **Short description** (80 chars): Peace of Mind Parking in Chicago. Smart parking alerts & violation detection.
- **Full description** (4000 chars):
  ```
  Autopilot is your smart parking assistant for Chicago. Peace of Mind Parking with automatic detection of:

  - Street cleaning schedules
  - Snow emergency routes
  - Tow zones
  - Permit parking zones
  - Time-limited parking

  Features:
  - Automatic parking detection via Bluetooth car pairing
  - Real-time parking violation alerts
  - Background location monitoring
  - Push notifications before violations
  - Map view of parking restrictions
  - Google Sign-In for easy account setup

  Stay ahead of Chicago's parking rules and save money on tickets!
  ```

### 4. Required Graphics
- **App icon**: 512x512 PNG (already in project)
- **Feature graphic**: 1024x500 PNG
- **Screenshots**:
  - Phone: 2-8 screenshots (16:9 or 9:16)
  - Tablet: 2-8 screenshots (optional but recommended)

### 5. App Content
- **Privacy Policy URL**: https://autopilotamerica.com/privacy
- **App access**: Provide test credentials if needed
- **Ads**: Declare if app contains ads
- **Content rating**: Complete the questionnaire
- **Target audience**: 18+
- **News apps**: Not a news app

### 6. Upload AAB
1. Go to "Release" > "Production" (or "Internal testing" first)
2. Click "Create new release"
3. Upload the AAB file: `autopilot-v1.0.1-release.aab`
4. Add release notes:
   ```
   Version 1.0.1
   - Initial release
   - Automatic parking detection with Bluetooth car pairing
   - Real-time parking violation alerts
   - Street cleaning and snow route notifications
   - Google Sign-In integration
   ```
5. Review and roll out

### 7. Required Declarations (for permissions)
Your app uses these permissions that require declarations:
- **Location (background)**: Required for parking detection
- **Bluetooth**: Required for car detection
- **Notifications**: Required for parking alerts

---

## iOS App Store Upload Instructions

### Prerequisites
- Mac with Xcode 15+
- Apple Developer Program membership ($99/year)
- App Store Connect access

### 1. Build iOS Release on Mac
```bash
cd TicketlessChicagoMobile/ios

# Install CocoaPods dependencies
pod install

# Open workspace in Xcode
open TicketlessChicagoMobile.xcworkspace
```

### 2. Configure Signing in Xcode
1. Select the project in navigator
2. Select "TicketlessChicagoMobile" target
3. Go to "Signing & Capabilities"
4. Ensure "Automatically manage signing" is checked
5. Select your Team (V22BMBQJ67)

### 3. Archive for Distribution
1. Select "Any iOS Device (arm64)" as build target
2. Product > Archive
3. Wait for build to complete
4. Organizer will open automatically

### 4. Distribute to App Store
1. In Organizer, select the archive
2. Click "Distribute App"
3. Select "App Store Connect"
4. Click "Upload"
5. Wait for processing

### 5. App Store Connect Setup
1. Go to https://appstoreconnect.apple.com
2. Create new app or select existing
3. Fill in required information:
   - **Name**: Autopilot
   - **Subtitle**: Smart Parking for Chicago
   - **Bundle ID**: fyi.ticketless.app
   - **SKU**: autopilot-chicago-1
   - **Primary Language**: English (US)

### 6. Required App Store Information
- **Description**: Same as Android
- **Keywords**: parking, chicago, tickets, alerts, street cleaning, tow, parking meter
- **Support URL**: https://autopilotamerica.com/support
- **Marketing URL**: https://autopilotamerica.com
- **Privacy Policy URL**: https://autopilotamerica.com/privacy

### 7. Required Screenshots (iOS)
- 6.7" (iPhone 14 Pro Max): 1290 x 2796 or 2796 x 1290
- 6.5" (iPhone 11 Pro Max): 1284 x 2778 or 2778 x 1284
- 5.5" (iPhone 8 Plus): 1242 x 2208 or 2208 x 1242
- iPad Pro 12.9": 2048 x 2732 or 2732 x 2048

### 8. App Privacy
Declare data types collected:
- **Location**: Used for parking detection (Required, linked to user)
- **Identifiers**: Device ID for notifications
- **Usage Data**: App analytics

---

## Testing Recommendations

### Before Production Release
1. **Internal Testing** (Google Play):
   - Create internal test track
   - Upload AAB
   - Add test emails
   - Test on multiple devices

2. **TestFlight** (iOS):
   - Upload to App Store Connect
   - Invite internal testers
   - Test on multiple iOS versions

### Test Checklist
- [ ] App launches successfully
- [ ] Google Sign-In works
- [ ] Location permissions request properly
- [ ] Bluetooth car pairing works
- [ ] Push notifications arrive
- [ ] Map loads correctly
- [ ] Parking detection triggers
- [ ] Background location works
- [ ] App doesn't crash under normal use

---

## Version History

| Version | Code | Date | Notes |
|---------|------|------|-------|
| 1.0.1 | 2 | 2025-01-26 | Initial release build |
| 1.0.0 | 1 | - | Development |

---

## Support Contacts
- **Developer**: Autopilot America
- **Email**: support@autopilotamerica.com
- **Website**: https://autopilotamerica.com
