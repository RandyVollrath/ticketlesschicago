# Android Native Code Documentation Index
## Ticketless Chicago Mobile App

This index provides links to all Android-related documentation for native code development.

---

## Documentation Files

### 1. ANDROID_STRUCTURE_GUIDE.md
**Purpose:** Complete technical reference of the Android native code structure
**Contains:**
- Exact package name: `fyi.ticketless.app`
- Full AndroidManifest.xml contents
- Complete MainActivity.kt source code
- Complete MainApplication.kt source code
- Full build.gradle (app-level) configuration
- Full build.gradle (root-level) configuration
- All directory structure details
- Integration guidelines

**When to use:** When you need the EXACT content of any config file or to understand the complete setup

---

### 2. ANDROID_NATIVE_MODULE_TEMPLATES.md
**Purpose:** Copy-paste ready templates for adding new native code
**Contains:**
- Template 1: Custom Service
- Template 2: Broadcast Receiver
- Template 3: React Native Module (Kotlin)
- Template 4: Foreground Service (Location)
- Integration checklist
- JavaScript/Kotlin bridge example
- Important notes and best practices

**When to use:** When adding new Services, Receivers, or React modules - just copy and adapt

---

### 3. ANDROID_QUICK_REFERENCE.md
**Purpose:** Quick lookup table and command reference
**Contains:**
- Key facts table (package name, SDK versions, etc.)
- Files at a glance
- Current permissions list
- File structure diagram
- Step-by-step how-to guides:
  - How to add a Service
  - How to add a Broadcast Receiver
  - How to add a React Native Module
- Common import statements
- Build commands
- Debugging tips

**When to use:** Quick lookup during development, command reference, refresher on procedure

---

## Quick Start: Adding a New Feature

### Scenario 1: Add a background service to track location
1. Read: ANDROID_QUICK_REFERENCE.md - "HOW TO ADD A NEW SERVICE"
2. Reference: ANDROID_NATIVE_MODULE_TEMPLATES.md - "TEMPLATE 4: Foreground Service"
3. Place file in: `/android/app/src/main/java/fyi/ticketless/app/`
4. Package: `fyi.ticketless.app`
5. Update: `AndroidManifest.xml` in `android/app/src/main/`

### Scenario 2: Add a native module for React to call
1. Read: ANDROID_QUICK_REFERENCE.md - "HOW TO ADD A REACT NATIVE MODULE"
2. Reference: ANDROID_NATIVE_MODULE_TEMPLATES.md - "TEMPLATE 3: React Native Module"
3. Create: Module Kotlin file + Package Kotlin file
4. Update: `MainApplication.kt` to register package
5. Call from: JavaScript using `NativeModules`

### Scenario 3: Need to reference exact package name or imports
1. Check: ANDROID_STRUCTURE_GUIDE.md - Section 1, 11
2. Or: ANDROID_QUICK_REFERENCE.md - "Common Import Statements"

### Scenario 4: Boot-completion handler
1. Read: ANDROID_QUICK_REFERENCE.md - "HOW TO ADD A BROADCAST RECEIVER"
2. Reference: ANDROID_NATIVE_MODULE_TEMPLATES.md - "TEMPLATE 2: Broadcast Receiver"

---

## Key Information Summary

### Package Structure
```
Package: fyi.ticketless.app
Path: android/app/src/main/java/fyi/ticketless/app/
Files:
  - MainActivity.kt (React Activity entry point)
  - MainApplication.kt (App initialization)
  - [Your new native modules here]
```

### SDK Versions
- Min: 24 (Android 7.0)
- Target: 36 (Android 15)
- Compile: 36 (Android 15)

### Build Configuration
- Language: Kotlin 2.1.20
- React Native: Latest with autolink support
- Build tools: 36.0.0
- NDK: 29.0.14206865

### Current Permissions (All Declared)
```
INTERNET
ACCESS_FINE_LOCATION
ACCESS_BACKGROUND_LOCATION
BLUETOOTH (+ ADMIN, CONNECT, SCAN)
POST_NOTIFICATIONS
USE_BIOMETRIC
USE_FINGERPRINT
VIBRATE
RECEIVE_BOOT_COMPLETED
FOREGROUND_SERVICE
FOREGROUND_SERVICE_LOCATION
```

### Currently Registered Components
- Only MainActivity (React entry point)
- No other services or receivers currently declared
- Ready to add new components

---

## File Locations for Reference

| File | Full Path |
|------|-----------|
| AndroidManifest.xml | `/android/app/src/main/AndroidManifest.xml` |
| MainActivity.kt | `/android/app/src/main/java/fyi/ticketless/app/MainActivity.kt` |
| MainApplication.kt | `/android/app/src/main/java/fyi/ticketless/app/MainApplication.kt` |
| App build.gradle | `/android/app/build.gradle` |
| Root build.gradle | `/android/build.gradle` |

---

## Development Workflow

### 1. Create New Native Code
- Use templates from ANDROID_NATIVE_MODULE_TEMPLATES.md
- Place in `/android/app/src/main/java/fyi/ticketless/app/`
- Use package `fyi.ticketless.app`

### 2. Register in AndroidManifest.xml
- For Services: Add `<service>` tag
- For Receivers: Add `<receiver>` tag
- For Modules: Add to MainApplication.kt instead

### 3. Update MainApplication.kt (if React module)
- Import your package class
- Add to `PackageList(this).packages.apply { add(YourPackage()) }`

### 4. Build & Test
```bash
# From android directory
./gradlew assembleDebug

# Or from project root
npm run build:android
```

### 5. Debug
```bash
adb logcat | grep ticketless
```

---

## Common Patterns

### Pattern 1: Service + Broadcast Receiver Combo
Create a service that starts on boot:
1. Create Service class (TEMPLATE 1)
2. Create BootReceiver class (TEMPLATE 2)
3. Register both in AndroidManifest.xml
4. BootReceiver calls startService() on boot

### Pattern 2: React Native Bridge
Create JavaScript-callable native function:
1. Create Module class (TEMPLATE 3 - part 1)
2. Create Package class (TEMPLATE 3 - part 2)
3. Register in MainApplication.kt
4. Call from JS: `NativeModules.ModuleName.methodName()`

### Pattern 3: Location Tracking Service
For background location tracking:
1. Use TEMPLATE 4: Foreground Service (Location)
2. Declare in AndroidManifest.xml with `foregroundServiceType="location"`
3. Create notification channel in onCreate()
4. Start with `startForeground()`

---

## Integration Checklist

Before committing new native code:

- [ ] File created in `/android/app/src/main/java/fyi/ticketless/app/`
- [ ] Package declaration is `package fyi.ticketless.app`
- [ ] All imports are correct and from standard libraries
- [ ] AndroidManifest.xml updated with service/receiver/permission declarations
- [ ] MainApplication.kt updated if adding React module
- [ ] Build succeeds: `./gradlew assembleDebug`
- [ ] Naming follows existing patterns (CamelCase for classes)
- [ ] Uses Kotlin (not Java)
- [ ] Follows existing code style and patterns
- [ ] Tested on device/emulator

---

## Useful Resources

### Official Documentation
- React Native Android Modules: https://reactnative.dev/docs/native-modules-android
- Android Services: https://developer.android.com/guide/components/services
- Foreground Services: https://developer.android.com/develop/background-work/services/foreground-services
- Broadcast Receivers: https://developer.android.com/guide/components/broadcasts
- Kotlin & Android: https://developer.android.com/kotlin

### Project Context
The Ticketless Chicago app already uses:
- React Native with latest architecture
- Kotlin for native code
- Google Play Services (Location)
- Autolinking for packages
- Bluetooth connectivity
- Location services
- Biometric authentication
- Deep linking (custom scheme + https)

---

## Support Files in Project

All of these files are available in the project root:
- `ANDROID_STRUCTURE_GUIDE.md` - Complete technical reference
- `ANDROID_NATIVE_MODULE_TEMPLATES.md` - Copy-paste templates
- `ANDROID_QUICK_REFERENCE.md` - Quick lookup table
- `ANDROID_DOCUMENTATION_INDEX.md` - This file

---

## Version History

- **Created:** 2026-02-01
- **App Version:** 1.0.1 (Build 2)
- **React Native:** Latest with Fabric
- **Target SDK:** 36 (Android 15)
- **Min SDK:** 24 (Android 7.0)

