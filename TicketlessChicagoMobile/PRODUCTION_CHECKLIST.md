# Ticketless Chicago Mobile - Production Checklist

## What's Done (Code Complete)

- [x] Full app architecture with 9 screens
- [x] Authentication (email, magic link, password reset, biometrics)
- [x] Bluetooth car detection and monitoring
- [x] GPS location tracking with background support
- [x] Push notification service (Firebase + Notifee)
- [x] Crash reporting service (Firebase Crashlytics)
- [x] Deep linking support
- [x] Error handling and logging
- [x] Rate limiting and request deduplication
- [x] EAS Build configuration (`eas.json`)
- [x] App Store metadata templates
- [x] Icon generation script
- [x] iOS Info.plist (permissions, Face ID, background modes)
- [x] Android manifest (permissions, biometrics)
- [x] Dependencies added (biometrics, crashlytics)

## What YOU Need To Do (Manual Steps)

### Step 1: Create Developer Accounts (if not done)
- [ ] Apple Developer Program ($99/year): https://developer.apple.com
- [ ] Google Play Console ($25): https://play.google.com/console

### Step 2: Set Up Firebase (30 minutes)
1. [ ] Create project at https://console.firebase.google.com
2. [ ] Add iOS app (bundle ID: `fyi.ticketless.app`)
3. [ ] Download `GoogleService-Info.plist` -> place in `ios/TicketlessChicagoMobile/`
4. [ ] Add Android app (package: `fyi.ticketless.app`)
5. [ ] Download `google-services.json` -> place in `android/app/`
6. [ ] Enable Cloud Messaging
7. [ ] Upload APNs key for iOS push notifications

### Step 3: Generate App Icons (15 minutes)
```bash
cd TicketlessChicagoMobile
npm install
node scripts/generate-icons.js
```
Or design custom icons using https://icon.kitchen/

### Step 4: Install Dependencies
```bash
cd TicketlessChicagoMobile
npm install
cd ios && pod install && cd ..
```

### Step 5: Test on Real Device
Push notifications and background location require a real device.
```bash
# iOS
npx react-native run-ios --device

# Android
npx react-native run-android
```

### Step 6: Build for Production
```bash
# Install EAS CLI
npm install -g eas-cli
eas login

# Build
eas build --platform all --profile production
```

### Step 7: Submit to Stores
- [ ] App Store Connect: Upload via Xcode/Transporter
- [ ] Google Play Console: Upload AAB file

## Quick Reference

| Item | Location |
|------|----------|
| Bundle ID | `fyi.ticketless.app` |
| App Version | `1.0.0` |
| Build Config | `eas.json` |
| Store Metadata | `store/app-store-metadata.json` |
| Setup Guide | `PRODUCTION_SETUP.md` |
| Icon Generator | `scripts/generate-icons.js` |

## Estimated Timeline

| Task | Time |
|------|------|
| Firebase setup | 30 min |
| Icon design | 1-2 hours |
| Device testing | 2-3 hours |
| Build & submit | 1-2 hours |
| App review | 1-7 days |

**Total: 1-2 days of work + review time**

## Files Created/Updated

```
TicketlessChicagoMobile/
├── eas.json                    # NEW - EAS Build config
├── PRODUCTION_SETUP.md         # NEW - Full setup guide
├── PRODUCTION_CHECKLIST.md     # NEW - This file
├── scripts/
│   └── generate-icons.js       # NEW - Icon generator
├── store/
│   ├── app-store-metadata.json # NEW - Store listings
│   └── privacy-policy-summary.md # NEW - Privacy docs
├── package.json                # UPDATED - Added biometrics, crashlytics, sharp
├── ios/TicketlessChicagoMobile/
│   └── Info.plist              # UPDATED - Face ID, background modes
└── android/app/src/main/
    └── AndroidManifest.xml     # UPDATED - Biometric permissions
```

## Need Help?

- Documentation: See `PRODUCTION_SETUP.md` for detailed instructions
- Firebase Setup: https://rnfirebase.io/
- EAS Build: https://docs.expo.dev/build/introduction/
