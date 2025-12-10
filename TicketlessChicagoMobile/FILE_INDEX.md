# TicketlessChicagoMobile - Complete File Index

## Project Root
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/`

## Configuration Files (Root Level)

| File | Purpose | Status |
|------|---------|--------|
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/app.json` | Expo app configuration | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/package.json` | NPM dependencies & scripts | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/tsconfig.json` | TypeScript configuration | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/babel.config.js` | Babel transpiler config | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/metro.config.js` | Metro bundler config | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/jest.config.js` | Jest test framework config | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/.eslintrc.js` | ESLint configuration | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/.prettierrc.js` | Prettier code formatter | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/.watchmanconfig` | File watcher configuration | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/.gitignore` | Git ignore rules | ✓ Complete |

## Documentation Files

| File | Purpose | Status |
|------|---------|--------|
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/MOBILE_APP_README.md` | Comprehensive setup guide | ✓ Complete (814 lines) |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/PRODUCTION_READINESS_ASSESSMENT.md` | Production assessment report | ✓ Complete (814 lines) |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/QUICK_REFERENCE.txt` | Quick start reference | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/assets/README.md` | Asset generation guide | ✓ Complete |
| `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/README.md` | Main readme (if exists) | ? Check if exists |

## Source Code Structure

### App Root
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/App.tsx` - Main app component
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/index.ts` - Entry point

### Configuration (`src/config/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/config/config.ts` - Main app config
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/config/env.ts` - Environment config (duplicate)

### Constants (`src/constants/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/constants/index.ts`
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/constants/StorageKeys.ts` - Centralized storage keys

### Components (`src/components/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/Button.tsx` - Reusable button component
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/Card.tsx` - Reusable card component
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/ErrorBoundary.tsx` - React error boundary
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/LoadingSkeleton.tsx` - Skeleton loader
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/RuleCard.tsx` - Parking rule display
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/StatusBadge.tsx` - Status indicator
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/components/index.ts` - Component exports

### Screens (`src/screens/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HomeScreen.tsx` - Main dashboard (16KB)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/MapScreen.tsx` - Location map view (15KB)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/HistoryScreen.tsx` - Parking history (13KB)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/ProfileScreen.tsx` - User profile (18KB)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/SettingsScreen.tsx` - Bluetooth settings (12KB)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/LoginScreen.tsx` - Authentication (15KB)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/OnboardingScreen.tsx` - First-time setup (8KB)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/screens/index.ts` - Screen exports

### Services (`src/services/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/AuthService.ts` - Supabase authentication
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/LocationService.ts` - GPS & parking rules
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BluetoothService.ts` - Car pairing
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/PushNotificationService.ts` - Firebase push notifications
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` - Background monitoring
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/CrashReportingService.ts` - Firebase Crashlytics
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/DeepLinkingService.ts` - Universal deep links
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/BiometricService.ts` - Face/Touch ID
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/services/index.ts` - Service exports

### Navigation (`src/navigation/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/navigation/TabBar.tsx` - Custom bottom tab bar

### Theme (`src/theme/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/theme/index.ts` - Design system (colors, typography, spacing)

### Utilities (`src/utils/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/ApiClient.ts` - HTTP client with retry logic (350 lines)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/errorHandler.ts` - Global error handling (128 lines)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/Logger.ts` - Structured logging
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/NetworkStatus.ts` - Network connectivity
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/RateLimiter.ts` - API rate limiting
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/storage.ts` - Type-safe AsyncStorage
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/utils/validation.ts` - Input validation

### Types (`src/types/`)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/src/types/modules.d.ts` - TypeScript definitions

## iOS Platform Files

### Configuration
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/Podfile` - CocoaPods configuration
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/.xcode.env` - Xcode environment setup
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/Info.plist` - iOS app config (XML)

### Required but Missing
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile/GoogleService-Info.plist` - MISSING (Firebase config)

### Project
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/ios/TicketlessChicagoMobile.xcodeproj/` - Xcode project directory

## Android Platform Files

### Configuration & Build
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/build.gradle` - Root Gradle config
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/gradle.properties` - Gradle properties
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/settings.gradle` - Gradle settings

### App Configuration
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/build.gradle` - App Gradle config
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/AndroidManifest.xml` - Android manifest

### Required but Missing
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/google-services.json` - MISSING (Firebase config)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/key.jks` - MISSING (Release keystore)

### Gradle Wrappers
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/gradlew` - Gradle wrapper script
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/gradlew.bat` - Gradle wrapper (Windows)

## Assets Directory

- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/assets/` - Assets folder (mostly empty)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/assets/README.md` - Guide for generating assets

### Required Assets (Missing)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/assets/icon.png` - MISSING (1024x1024px)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/assets/splash.png` - MISSING (1242x2436px)
- `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/assets/adaptive-icon.png` - MISSING (Android)

## File Size Statistics

| Directory | Estimated Size | File Count |
|-----------|-----------------|------------|
| src/ | ~500KB | 40+ files |
| ios/ | ~50MB | (includes Xcode project) |
| android/ | ~100MB | (includes gradle cache) |
| node_modules/ | ~500MB | (dependencies) |

## Key File Relationships

```
App.tsx (Root)
  ├── App.tsx imports
  │   ├── src/services/AuthService.ts
  │   ├── src/services/PushNotificationService.ts
  │   ├── src/services/DeepLinkingService.ts
  │   ├── src/navigation/screens (8 files)
  │   └── src/utils/errorHandler.ts
  │
  ├── Navigation setup
  │   ├── Stack Navigator
  │   │   ├── Onboarding
  │   │   ├── Login
  │   │   ├── MainTabs
  │   │   └── BluetoothSettings
  │   └── Tab Navigator
  │       ├── Home
  │       ├── Map
  │       ├── History
  │       └── Profile
  │
  └── Services initialization
      ├── AuthService.initialize()
      ├── PushNotificationService.initialize()
      └── DeepLinkingService.initialize()
```

## Configuration Dependency Chain

```
app.json (main config)
  ├── Bundle ID: fyi.ticketless.app
  ├── Version: 1.0.0
  ├── iOS settings (permissions, background modes)
  ├── Android settings (permissions, intent filters)
  └── Expo configuration

src/config/config.ts (app runtime config)
  ├── API_BASE_URL: https://ticketless.fyi
  ├── Supabase URL & keys
  ├── Feature flags
  ├── Parking rules config
  ├── Bluetooth settings
  └── Timeout values

src/constants/StorageKeys.ts (local storage)
  ├── Auth tokens
  ├── Parking history
  ├── App settings
  ├── Notification preferences
  └── Cache data
```

## Important Code Counts

- Total source lines: ~8,800
- Service code: ~2,000 lines
- Utility code: ~1,500 lines
- Screen code: ~3,500 lines
- Component code: ~800 lines
- Configuration: ~300 lines

## Build Outputs (Not in repo)

| Directory | Purpose | Status |
|-----------|---------|--------|
| `android/app/build/` | Android build artifacts | Generated |
| `ios/build/` | iOS build artifacts | Generated |
| `dist/` | Distribution bundles | Generated |
| `.gradle/` | Gradle cache | Generated |
| `node_modules/` | NPM dependencies | Downloaded |

