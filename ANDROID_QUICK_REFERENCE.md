# Android Quick Reference
## Ticketless Chicago Mobile

Quick lookup for key information needed to add Android native code.

---

## KEY FACTS

| Item | Value |
|------|-------|
| **Package Name** | `fyi.ticketless.app` |
| **Application ID** | `fyi.ticketless.app` |
| **Main Component** | `TicketlessChicagoMobile` |
| **Min SDK** | 24 (Android 7.0) |
| **Target SDK** | 36 (Android 15) |
| **Compile SDK** | 36 (Android 15) |
| **Kotlin Version** | 2.1.20 |
| **App Version** | 1.0.1 (Code: 2) |
| **NDK Version** | 29.0.14206865 |

---

## FILES AT A GLANCE

| File | Path | Purpose |
|------|------|---------|
| **AndroidManifest.xml** | `android/app/src/main/` | Permissions, activities, services, receivers |
| **MainActivity.kt** | `android/app/src/main/java/fyi/ticketless/app/` | React entry point |
| **MainApplication.kt** | `android/app/src/main/java/fyi/ticketless/app/` | App initialization & packages |
| **build.gradle (app)** | `android/app/` | App build config & dependencies |
| **build.gradle (root)** | `android/` | Global build settings & versions |

---

## CURRENT PERMISSIONS

```
INTERNET
ACCESS_FINE_LOCATION
ACCESS_BACKGROUND_LOCATION
BLUETOOTH
BLUETOOTH_ADMIN
BLUETOOTH_CONNECT
BLUETOOTH_SCAN
POST_NOTIFICATIONS
USE_BIOMETRIC
USE_FINGERPRINT
VIBRATE
RECEIVE_BOOT_COMPLETED
FOREGROUND_SERVICE
FOREGROUND_SERVICE_LOCATION
```

---

## ACTIVE SERVICES/RECEIVERS

**Currently declared:** None beyond MainActivity

**Available permissions suggest support for:**
- Boot completion listeners
- Foreground services
- Location-based services

---

## FILE STRUCTURE

```
android/
├── app/
│   ├── build.gradle
│   ├── src/
│   │   └── main/
│   │       ├── java/fyi/ticketless/app/
│   │       │   ├── MainActivity.kt
│   │       │   └── MainApplication.kt
│   │       ├── res/
│   │       └── AndroidManifest.xml
│   └── debug.keystore
├── build.gradle
└── settings.gradle
```

---

## HOW TO ADD A NEW SERVICE

### Step 1: Create Kotlin file
Path: `android/app/src/main/java/fyi/ticketless/app/MyService.kt`

```kotlin
package fyi.ticketless.app

import android.app.Service
import android.content.Intent
import android.os.IBinder

class MyService : Service() {
    override fun onCreate() {
        super.onCreate()
        // Initialize
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Do work
        return START_STICKY
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
}
```

### Step 2: Declare in AndroidManifest.xml
Inside `<application>` tag, add:
```xml
<service
    android:name=".MyService"
    android:exported="false" />
```

### Step 3: Start the service
From MainApplication or another component:
```kotlin
context.startService(Intent(context, MyService::class.java))
```

---

## HOW TO ADD A BROADCAST RECEIVER

### Step 1: Create receiver class
Path: `android/app/src/main/java/fyi/ticketless/app/MyReceiver.kt`

```kotlin
package fyi.ticketless.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class MyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            // Handle boot
        }
    }
}
```

### Step 2: Register in AndroidManifest.xml
Inside `<application>` tag:
```xml
<receiver
    android:name=".MyReceiver"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
    </intent-filter>
</receiver>
```

---

## HOW TO ADD A REACT NATIVE MODULE

### Step 1: Create the module
Path: `android/app/src/main/java/fyi/ticketless/app/MyModule.kt`

```kotlin
package fyi.ticketless.app

import com.facebook.react.bridge.*

class MyModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
    
    override fun getName() = "MyModule"
    
    @ReactMethod
    fun myMethod(message: String, promise: Promise) {
        promise.resolve("Hello: $message")
    }
}
```

### Step 2: Create the package
Path: `android/app/src/main/java/fyi/ticketless/app/MyPackage.kt`

```kotlin
package fyi.ticketless.app

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext

class MyPackage : TurboReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == "MyModule") MyModule(reactContext) else null
    }
    
    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            "MyModule" to ReactModuleInfo(
                "MyModule",
                MyModule::class.java.name,
                true, false, false, false
            )
        )
    }
}
```

### Step 3: Register in MainApplication.kt
```kotlin
PackageList(this).packages.apply {
    add(MyPackage())
}
```

### Step 4: Call from JavaScript
```javascript
import { NativeModules } from 'react-native';
const { MyModule } = NativeModules;
MyModule.myMethod("test").then(console.log);
```

---

## COMMON IMPORT STATEMENTS

```kotlin
// Android framework
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log

// React Native
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule

// Notification
import android.app.NotificationManager
import android.app.NotificationChannel
import androidx.core.app.NotificationCompat

// Location
import android.location.LocationManager
```

---

## BUILD COMMANDS

```bash
# Debug build
cd android
./gradlew assembleDebug

# Release build
./gradlew assembleRelease

# Clean build
./gradlew clean

# Run on device
./gradlew installDebug
```

Or from project root:
```bash
npm run build:android
```

---

## DEBUGGING TIPS

View logs:
```bash
adb logcat | grep "ticketless\|MyService\|MyModule"
```

Check running services:
```bash
adb shell pm dump com.example.app | grep -A5 "Service"
```

View permissions:
```bash
adb shell pm dump fyi.ticketless.app | grep -A50 "android.permission"
```

---

## NOTES

- Always use package `fyi.ticketless.app` for new files
- Use Kotlin (not Java) for consistency
- Set `android:exported="false"` unless broadcasting/receiving intents
- Min SDK 24 means no features beyond API level 24
- Target SDK 36 should be maintained
- All new code should follow existing patterns

---

## USEFUL DOCS

- React Native Modules: https://reactnative.dev/docs/native-modules-android
- Android Services: https://developer.android.com/guide/components/services
- Foreground Services: https://developer.android.com/develop/background-work/services/foreground-services
- Broadcast Receivers: https://developer.android.com/guide/components/broadcasts

