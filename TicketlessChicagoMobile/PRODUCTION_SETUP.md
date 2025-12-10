# Ticketless Chicago Mobile - Production Setup Guide

This guide covers everything needed to prepare the app for App Store and Play Store submission.

## Prerequisites

- macOS with Xcode 15+ (for iOS builds)
- Node.js 20+
- Apple Developer Account ($99/year)
- Google Play Developer Account ($25 one-time)
- Firebase Project (free)

## Step 1: Install Dependencies

```bash
cd TicketlessChicagoMobile
npm install
cd ios && pod install && cd ..
```

## Step 2: Generate App Icons

### Option A: Use the Generator Script
```bash
# Install sharp first
npm install

# Generate placeholder icons
node scripts/generate-icons.js
```

### Option B: Use Online Tools (Recommended for Custom Icons)
1. Create a 1024x1024px icon design
2. Upload to https://appicon.co/ or https://icon.kitchen/
3. Download and place icons:
   - `assets/icon.png` (1024x1024)
   - `assets/adaptive-icon.png` (1024x1024)
   - `assets/splash.png` (1242x2436)

## Step 3: Firebase Setup (Required for Push Notifications)

### 3.1 Create Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create new project: "Ticketless Chicago"
3. Disable Google Analytics (optional)

### 3.2 Add iOS App
1. Click "Add app" -> iOS
2. Bundle ID: `fyi.ticketless.app`
3. Download `GoogleService-Info.plist`
4. Place in: `ios/TicketlessChicagoMobile/GoogleService-Info.plist`

In Xcode:
1. Open `ios/TicketlessChicagoMobile.xcworkspace`
2. Drag `GoogleService-Info.plist` into the project (check "Copy items if needed")
3. Add capability: Push Notifications
4. Add capability: Background Modes -> Remote notifications

### 3.3 Add Android App
1. Click "Add app" -> Android
2. Package name: `fyi.ticketless.app`
3. Download `google-services.json`
4. Place in: `android/app/google-services.json`

### 3.4 Enable Cloud Messaging
1. In Firebase Console -> Cloud Messaging
2. Enable Cloud Messaging API (Legacy)
3. For iOS: Upload APNs Authentication Key or Certificate

## Step 4: Code Signing

### iOS Code Signing

#### Development
```bash
# Using EAS Build (recommended)
npx eas-cli build --profile development --platform ios
```

#### Production
1. In Apple Developer Portal:
   - Create App ID: `fyi.ticketless.app`
   - Create Distribution Certificate
   - Create App Store Provisioning Profile

2. In Xcode:
   - Select your team
   - Enable automatic signing (or manual if preferred)

### Android Code Signing

1. Generate keystore (if not exists):
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore android/app/release.keystore -alias ticketless -keyalg RSA -keysize 2048 -validity 10000
```

2. Create `android/gradle.properties`:
```properties
MYAPP_UPLOAD_STORE_FILE=release.keystore
MYAPP_UPLOAD_KEY_ALIAS=ticketless
MYAPP_UPLOAD_STORE_PASSWORD=your_password
MYAPP_UPLOAD_KEY_PASSWORD=your_password
```

3. Update `android/app/build.gradle` to use signing config.

## Step 5: Update eas.json

Edit `eas.json` and replace placeholders:

```json
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "1234567890",
        "appleTeamId": "XXXXXXXXXX"
      }
    }
  }
}
```

## Step 6: Build for Production

### Using EAS Build (Recommended)
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build for iOS
eas build --platform ios --profile production

# Build for Android
eas build --platform android --profile production
```

### Using Local Builds

#### iOS
1. Open Xcode workspace: `ios/TicketlessChicagoMobile.xcworkspace`
2. Select "Generic iOS Device"
3. Product -> Archive
4. Distribute App -> App Store Connect

#### Android
```bash
cd android
./gradlew bundleRelease
```
Output: `android/app/build/outputs/bundle/release/app-release.aab`

## Step 7: App Store Submission

### App Store Connect (iOS)

1. Create new app at [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. Fill in metadata from `store/app-store-metadata.json`
3. Upload screenshots (see sizes in metadata file)
4. Upload build via Xcode or Transporter
5. Submit for review

### Google Play Console (Android)

1. Create new app at [play.google.com/console](https://play.google.com/console)
2. Fill in metadata from `store/app-store-metadata.json` (use playStore section)
3. Upload screenshots
4. Upload AAB file
5. Complete content rating questionnaire
6. Submit for review

## Step 8: Post-Launch

### Set Up Crash Monitoring
1. Firebase Console -> Crashlytics -> Enable
2. Crashes will appear after users download from stores

### Monitor Analytics
- Firebase Analytics for app usage
- Play Console / App Store Connect for downloads and ratings

## Checklist

### Before Building
- [ ] App icons created and placed
- [ ] Splash screen created
- [ ] Firebase project created
- [ ] `GoogleService-Info.plist` added (iOS)
- [ ] `google-services.json` added (Android)
- [ ] Push notification capability added (Xcode)
- [ ] App ID created in Apple Developer Portal
- [ ] Bundle ID matches: `fyi.ticketless.app`
- [ ] Version numbers updated in `app.json`

### Before Submitting
- [ ] Privacy policy URL accessible
- [ ] Support URL accessible
- [ ] App tested on real devices
- [ ] Push notifications tested
- [ ] Background location tested
- [ ] Bluetooth pairing tested
- [ ] Screenshots captured
- [ ] App description finalized
- [ ] Keywords optimized

### After Submission
- [ ] Monitor review status
- [ ] Respond to any reviewer questions
- [ ] Set up release notes for future updates

## Troubleshooting

### iOS Build Fails
```bash
cd ios
pod deintegrate
pod install
cd ..
```

### Android Build Fails
```bash
cd android
./gradlew clean
cd ..
```

### Push Notifications Not Working
1. Check Firebase configuration files are in correct locations
2. Verify APNs certificate uploaded to Firebase
3. Test on real device (simulators don't support push)
4. Check notification permissions granted

### Location Not Working in Background
- iOS: Verify Background Modes -> Location enabled in Xcode
- Android: Check `ACCESS_BACKGROUND_LOCATION` permission

## Support

- Documentation: https://ticketless.fyi/docs
- Support Email: support@ticketless.fyi
