# Ticketless Chicago Mobile App

Never get a parking ticket in Chicago again. Auto-detect when you park and get instant alerts about parking restrictions.

---

## SETUP REQUIRED: Push Notifications (Firebase)

**Before releasing the app, complete these steps:**

### Step 1: Create Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click "Create a project" or "Add project"
3. Name it "Ticketless Chicago" (or similar)
4. Disable Google Analytics (optional) and create

### Step 2: Add iOS App

1. In Firebase Console, click "Add app" → iOS
2. **Bundle ID**: `com.ticketlesschicago.app` (must match `app.json`)
3. **App nickname**: Ticketless Chicago iOS
4. Click "Register app"
5. Download `GoogleService-Info.plist`
6. Place it in: `ios/TicketlessChicagoMobile/GoogleService-Info.plist`
7. In Xcode, drag the file into the project (check "Copy items if needed")

### Step 3: Add Android App

1. In Firebase Console, click "Add app" → Android
2. **Package name**: `com.ticketlesschicago.app` (must match `app.json`)
3. **App nickname**: Ticketless Chicago Android
4. Click "Register app"
5. Download `google-services.json`
6. Place it in: `android/app/google-services.json`

### Step 4: Install Firebase Packages

```bash
cd TicketlessChicagoMobile
npm install @react-native-firebase/app @react-native-firebase/messaging
```

### Step 5: iOS Additional Setup

1. Open `ios/Podfile` and add at the top:
   ```ruby
   $RNFirebaseAsStaticFramework = true
   ```

2. Install pods:
   ```bash
   cd ios && pod install && cd ..
   ```

3. In Xcode, enable "Push Notifications" capability:
   - Select project → Signing & Capabilities → + Capability → Push Notifications

4. Enable "Background Modes" → Remote notifications

### Step 6: Android Additional Setup

1. Open `android/build.gradle`, add to `dependencies`:
   ```gradle
   classpath 'com.google.gms:google-services:4.4.0'
   ```

2. Open `android/app/build.gradle`, add at bottom:
   ```gradle
   apply plugin: 'com.google.gms.google-services'
   ```

### Step 7: Add Push Token Registration (App.tsx)

Add this import and code to `App.tsx`:

```typescript
import messaging from '@react-native-firebase/messaging';

// Inside App component, add this useEffect:
useEffect(() => {
  const setupPushNotifications = async () => {
    // Request permission
    const authStatus = await messaging().requestPermission();
    const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED;

    if (enabled) {
      // Get FCM token
      const token = await messaging().getToken();
      console.log('FCM Token:', token);

      // Send token to your backend
      if (authState?.isAuthenticated) {
        await fetch('https://ticketless.fyi/api/push/register-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authState.session?.access_token}`
          },
          body: JSON.stringify({
            token,
            platform: Platform.OS,
            user_id: authState.user?.id
          }),
        });
      }
    }
  };

  setupPushNotifications();

  // Listen for token refresh
  return messaging().onTokenRefresh(token => {
    // Re-register with backend
  });
}, [authState?.isAuthenticated]);
```

### Step 8: Test Push Notifications

1. Build and run on a real device (simulators don't support push)
2. Check console for "FCM Token: ..."
3. Use Firebase Console → Cloud Messaging → Send test message
4. Enter your FCM token and send

### Troubleshooting Firebase

- **iOS "No APNS token"**: You need to run on a real device, not simulator
- **Android build fails**: Run `cd android && ./gradlew clean`
- **Token not appearing**: Check that permissions were granted in device settings

---

## Features

- **Bluetooth Car Detection** - Automatically detects when you disconnect from your car's Bluetooth
- **GPS Location Tracking** - Gets your exact parking location
- **Real-time Parking Rules** - Checks street cleaning, snow routes, winter bans, and permit zones
- **Push Notifications** - Instant alerts when you park in a restricted area
- **Background Monitoring** - Works even when the app is closed
- **Parking History** - Review past parking locations and any violations found
- **Interactive Map** - View your parked car location with directions
- **Onboarding Flow** - Easy setup for new users

## Screens

1. **Home** - Main dashboard with quick parking check, monitoring status, and tips
2. **Map** - View last parked location with directions to your car
3. **History** - Chronological list of all parking checks with restriction details
4. **Settings** - Configure notifications, view stats, manage paired vehicles

## How It Works

1. **Pair Your Car** - Connect your phone to your car's Bluetooth once
2. **Enable Monitoring** - Turn on auto-detection in the app
3. **Park & Forget** - When you disconnect from your car, we automatically:
   - Get your GPS coordinates
   - Check all parking restrictions at that location
   - Send you a notification if there are any issues
   - Save the check to your history

## Requirements

- React Native 0.82+
- Node.js 20+
- iOS 13+ or Android 8+
- Backend API at `ticketless.fyi`

## Installation

### 1. Install Dependencies

```bash
cd TicketlessChicagoMobile
npm install
```

### 2. Install Pods (iOS only)

```bash
cd ios
pod install
cd ..
```

### 3. Configure Backend URL

The app is configured to use `https://ticketless.fyi` in production.

For development, edit `src/config/config.ts`:

```typescript
export default {
  API_BASE_URL: __DEV__
    ? 'http://localhost:3000'  // Development
    : 'https://ticketless.fyi', // Production
};
```

## Running the App

### iOS

```bash
npm run ios
# or
npx react-native run-ios
```

Or open `ios/TicketlessChicagoMobile.xcworkspace` in Xcode.

### Android

```bash
npm run android
# or
npx react-native run-android
```

## Project Structure

```
TicketlessChicagoMobile/
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── RuleCard.tsx
│   │   ├── StatusBadge.tsx
│   │   └── index.ts
│   ├── navigation/           # Navigation components
│   │   └── TabBar.tsx
│   ├── screens/              # App screens
│   │   ├── HomeScreen.tsx    # Main dashboard
│   │   ├── MapScreen.tsx     # Parking location map
│   │   ├── HistoryScreen.tsx # Parking check history
│   │   ├── ProfileScreen.tsx # Settings & account
│   │   ├── SettingsScreen.tsx# Bluetooth pairing
│   │   ├── OnboardingScreen.tsx
│   │   ├── LoginScreen.tsx   # Auth (login/signup/forgot)
│   │   └── index.ts
│   ├── services/             # Business logic
│   │   ├── LocationService.ts    # GPS & parking rules
│   │   ├── BluetoothService.ts   # Bluetooth detection
│   │   └── AuthService.ts        # User authentication
│   ├── theme/                # Design system
│   │   └── index.ts          # Colors, typography, styles
│   └── config/
│       └── config.ts         # API configuration
├── assets/                   # App icons and splash screen
├── android/                  # Android native code
├── ios/                      # iOS native code
├── App.tsx                   # Root component
├── app.json                  # App configuration
└── package.json
```

## Key Services

### LocationService
- Manages GPS permissions and tracking
- Checks parking rules via API (`/api/check-parking-location-enhanced`)
- Sends push notifications for violations
- Saves parking history to local storage

### BluetoothService
- Scans for nearby Bluetooth devices
- Monitors car connection status
- Detects disconnect events to trigger parking checks
- Persists paired car information

### AuthService
- Uses Supabase Auth (same as web app - shared user accounts)
- Email/password sign in and sign up
- Magic link authentication
- Persistent session with auto-refresh
- Password reset functionality

## Permissions

### Android
- `ACCESS_FINE_LOCATION` - Precise GPS coordinates
- `ACCESS_BACKGROUND_LOCATION` - Track when app is closed
- `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` - Detect car connection
- `POST_NOTIFICATIONS` - Send parking alerts

### iOS
- Location When In Use / Always
- Bluetooth
- Critical Alerts (optional, bypasses DND)

## Backend API

The app calls `/api/check-parking-location-enhanced` which returns:

```json
{
  "streetCleaning": {
    "hasRestriction": true,
    "message": "Street cleaning: Mon 9am-12pm",
    "timing": "SOON"
  },
  "winterOvernightBan": {
    "active": false
  },
  "twoInchSnowBan": {
    "active": false
  },
  "permitZone": {
    "inPermitZone": true,
    "message": "Zone 123 permit required"
  }
}
```

## Testing

### Manual Location Check
Use the "Check My Parking" button on the home screen to test without Bluetooth.

### Test API
```bash
curl "https://ticketless.fyi/api/check-parking-location-enhanced?lat=41.8781&lng=-87.6298"
```

## Building for Release

### iOS
1. Open Xcode workspace
2. Select "Product" > "Archive"
3. Upload to App Store Connect

### Android
```bash
cd android
./gradlew assembleRelease
```

APK will be at `android/app/build/outputs/apk/release/`

## Troubleshooting

### Location Issues
- Check permissions in Settings > Privacy > Location
- Enable "Always Allow" for background tracking
- On Android, enable "Precise Location"

### Bluetooth Issues
- Ensure car Bluetooth is discoverable
- Pair phone to car in system Settings first
- Re-scan in app if car doesn't appear

### Notifications Not Working
- Grant notification permissions
- On iOS, enable Critical Alerts
- Check Do Not Disturb settings

### Android Build Errors
```bash
cd android && ./gradlew clean && cd ..
npx react-native run-android
```

## Production Readiness Checklist

### Critical (Must Complete Before Release)

- [ ] **Firebase Setup**
  - [ ] Create Firebase project
  - [ ] Add `GoogleService-Info.plist` (iOS)
  - [ ] Add `google-services.json` (Android)
  - [ ] Enable Cloud Messaging
  - [ ] Test push notifications on real device

- [ ] **App Store Setup**
  - [ ] Create app icons (1024x1024)
  - [ ] Create splash screen
  - [ ] Add screenshots for all device sizes (iPhone/iPad/Android)
  - [ ] Write App Store description
  - [ ] Configure Apple Developer account
  - [ ] Configure Google Play Console
  - [ ] Add privacy policy URL
  - [ ] Add terms of service URL

- [ ] **Code Signing**
  - [ ] iOS provisioning profiles (development & distribution)
  - [ ] iOS certificates (push notification certificate)
  - [ ] Android keystore file
  - [ ] Store credentials securely

### High Priority (Recommended Before Release)

- [ ] **Testing**
  - [ ] Test on real iOS device (not simulator)
  - [ ] Test on real Android device
  - [ ] Test Bluetooth car detection
  - [ ] Test push notifications
  - [ ] Test background location tracking
  - [ ] Test biometric authentication
  - [ ] Test offline mode
  - [ ] Run unit tests: `npm test`

- [ ] **Dependencies**
  - [ ] Install react-native-biometrics: `npm install react-native-biometrics`
  - [ ] Install Firebase Crashlytics: `npm install @react-native-firebase/crashlytics`
  - [ ] Update iOS pods: `cd ios && pod install`

- [ ] **Security Review**
  - [ ] Review Supabase RLS policies
  - [ ] Ensure API endpoints require authentication
  - [ ] Review stored data encryption
  - [ ] Test token refresh flow

### Features Implemented

The app includes these production-ready features:

1. **Authentication**
   - Email/password login
   - Magic link sign-in
   - Password reset
   - Token auto-refresh
   - 401 error handling with automatic retry
   - Biometric authentication (Face ID/Touch ID/Fingerprint)

2. **Parking Detection**
   - Bluetooth car pairing
   - Car disconnection monitoring
   - Background task service for monitoring
   - GPS location tracking
   - Parking rules API integration
   - Rate limiting and request deduplication
   - Input validation for coordinates

3. **Notifications**
   - Push notifications via Firebase
   - Local notifications via Notifee
   - Critical alerts for urgent violations
   - Notification channels (Android)

4. **User Experience**
   - Onboarding flow
   - Loading skeletons
   - Pull-to-refresh
   - Offline detection banner
   - Error boundaries
   - Global error handling

5. **Data Management**
   - Centralized storage keys
   - Proper logout data clearing
   - Parking history with 50-item limit
   - Response caching

6. **Error Handling & Reporting**
   - Global error handler
   - Promise rejection tracking
   - Firebase Crashlytics integration
   - Detailed logging

### New Services Added

| Service | Purpose |
|---------|---------|
| `BackgroundTaskService` | Monitors car connection in background, triggers parking checks |
| `BiometricService` | Face ID / Touch ID / Fingerprint authentication |
| `CrashReportingService` | Firebase Crashlytics integration |

### New Utilities Added

| Utility | Purpose |
|---------|---------|
| `validation.ts` | Input validation for coordinates, emails, passwords |
| `RateLimiter.ts` | API rate limiting and request deduplication |
| `storage.ts` | Typed storage access with proper data clearing |
| `StorageKeys.ts` | Centralized storage key constants |
| `LoadingSkeleton.tsx` | Skeleton loading components |

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/api/mobile/check-parking` | Check parking rules at location |
| `/api/push/register-token` | Register FCM token |
| `/api/push/unregister-token` | Unregister FCM token |

### Environment Configuration

Edit `src/config/config.ts` for:

- `API_BASE_URL` - Backend API URL
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon key
- `ENABLE_ANALYTICS` - Enable/disable analytics
- `ENABLE_CRASH_REPORTING` - Enable/disable crash reporting

## Support

- Website: https://ticketless.fyi
- Email: support@ticketless.fyi

---

Version 1.0.0 | Ticketless Chicago
