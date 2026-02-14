# Android Documentation - Table of Contents

This directory contains comprehensive Android native code documentation for the Ticketless Chicago mobile app.

## Quick Navigation

### For First-Time Setup
1. Start with: **ANDROID_DOCUMENTATION_INDEX.md** - Overview and orientation
2. Then read: **ANDROID_QUICK_REFERENCE.md** - Key facts and quick lookup

### For Exact Configuration Reference
- **ANDROID_STRUCTURE_GUIDE.md** - Full source code and configuration

### For Adding New Code
- **ANDROID_NATIVE_MODULE_TEMPLATES.md** - Copy-paste templates for:
  - Services
  - Broadcast Receivers
  - React Native Modules
  - Foreground Services

## Documentation Files

| File | Lines | Purpose |
|------|-------|---------|
| ANDROID_DOCUMENTATION_INDEX.md | 379 | Overview, scenarios, patterns |
| ANDROID_STRUCTURE_GUIDE.md | 428 | Complete technical reference |
| ANDROID_NATIVE_MODULE_TEMPLATES.md | 370 | Copy-paste code templates |
| ANDROID_QUICK_REFERENCE.md | 322 | Lookup tables, how-tos, commands |

## Key Information At A Glance

**Package Name:** `fyi.ticketless.app`
**Min SDK:** 24 (Android 7.0)
**Target SDK:** 36 (Android 15)
**Language:** Kotlin
**React Native:** Latest with Fabric

**Source Directory:** `/android/app/src/main/java/fyi/ticketless/app/`

**Key Files:**
- `/android/app/src/main/java/fyi/ticketless/app/MainActivity.kt`
- `/android/app/src/main/java/fyi/ticketless/app/MainApplication.kt`
- `/android/app/src/main/AndroidManifest.xml`

## Quick Start Examples

### Adding a Service
1. Read: ANDROID_QUICK_REFERENCE.md → "HOW TO ADD A NEW SERVICE"
2. Use: ANDROID_NATIVE_MODULE_TEMPLATES.md → "TEMPLATE 1: Custom Service"
3. Create file in: `/android/app/src/main/java/fyi/ticketless/app/YourService.kt`
4. Package: `fyi.ticketless.app`

### Adding a React Native Module
1. Read: ANDROID_QUICK_REFERENCE.md → "HOW TO ADD A REACT NATIVE MODULE"
2. Use: ANDROID_NATIVE_MODULE_TEMPLATES.md → "TEMPLATE 3: React Native Module"
3. Create Module and Package files
4. Update: `MainApplication.kt`

### Boot Receiver
1. Read: ANDROID_QUICK_REFERENCE.md → "HOW TO ADD A BROADCAST RECEIVER"
2. Use: ANDROID_NATIVE_MODULE_TEMPLATES.md → "TEMPLATE 2: Broadcast Receiver"

## All Permissions Declared

```
INTERNET
ACCESS_FINE_LOCATION
ACCESS_BACKGROUND_LOCATION
BLUETOOTH + ADMIN + CONNECT + SCAN
POST_NOTIFICATIONS
USE_BIOMETRIC
USE_FINGERPRINT
VIBRATE
RECEIVE_BOOT_COMPLETED
FOREGROUND_SERVICE
FOREGROUND_SERVICE_LOCATION
```

## Build Commands

```bash
# Debug build
npm run build:android
# Or
cd android && ./gradlew assembleDebug

# Release build
cd android && ./gradlew assembleRelease
```

## File Locations (Absolute Paths)

```
/home/randy-vollrath/ticketless-chicago/ANDROID_DOCUMENTATION_INDEX.md
/home/randy-vollrath/ticketless-chicago/ANDROID_STRUCTURE_GUIDE.md
/home/randy-vollrath/ticketless-chicago/ANDROID_NATIVE_MODULE_TEMPLATES.md
/home/randy-vollrath/ticketless-chicago/ANDROID_QUICK_REFERENCE.md
```

## Common Patterns

### Pattern 1: Service that starts on boot
1. Create Service (TEMPLATE 1)
2. Create BootReceiver (TEMPLATE 2)
3. Register both in AndroidManifest.xml

### Pattern 2: Bridge between JavaScript and native code
1. Create Module class (TEMPLATE 3 part 1)
2. Create Package class (TEMPLATE 3 part 2)
3. Register in MainApplication.kt
4. Call from JS: `NativeModules.ModuleName.methodName()`

### Pattern 3: Location tracking with foreground service
1. Use TEMPLATE 4: Foreground Service
2. Declare with `foregroundServiceType="location"`
3. Show notification while running

## Integration Checklist

Before committing new native code:

- [ ] Files in `/android/app/src/main/java/fyi/ticketless/app/`
- [ ] Package: `package fyi.ticketless.app`
- [ ] AndroidManifest.xml updated
- [ ] MainApplication.kt updated (if React module)
- [ ] Build succeeds: `./gradlew assembleDebug`
- [ ] Tested on device/emulator

## Documentation Generated

Created: 2026-02-01
Total: 1,120 lines, ~43 KB
Format: Markdown

All files are self-contained and include:
- Full source code
- Import statements
- Configuration examples
- Step-by-step instructions
- Common debugging tips

## Need Help?

1. **Quick lookup?** → ANDROID_QUICK_REFERENCE.md
2. **Need exact code?** → ANDROID_STRUCTURE_GUIDE.md
3. **Creating new feature?** → ANDROID_NATIVE_MODULE_TEMPLATES.md
4. **Orientation?** → ANDROID_DOCUMENTATION_INDEX.md

## Project Details

- **App Name:** TicketlessChicagoMobile
- **App ID:** fyi.ticketless.app
- **Version:** 1.0.1 (Build 2)
- **React Native:** Latest with Fabric
- **Build Tools:** 36.0.0
- **Kotlin:** 2.1.20
- **NDK:** 29.0.14206865

