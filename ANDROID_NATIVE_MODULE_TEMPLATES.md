# Android Native Module Templates
## For Ticketless Chicago React Native App

All new native code should follow these exact patterns to integrate properly with the existing React Native setup.

---

## TEMPLATE 1: Custom Service

Create file: `android/app/src/main/java/fyi/ticketless/app/MyCustomService.kt`

```kotlin
package fyi.ticketless.app

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log

class MyCustomService : Service() {
    companion object {
        private const val TAG = "MyCustomService"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service started")
        // Do your work here
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
```

Then add to AndroidManifest.xml inside `<application>` tag:
```xml
<service
    android:name=".MyCustomService"
    android:exported="false"
    android:foregroundServiceType="location" />
```

---

## TEMPLATE 2: Broadcast Receiver

Create file: `android/app/src/main/java/fyi/ticketless/app/MyBootReceiver.kt`

```kotlin
package fyi.ticketless.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class MyBootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "MyBootReceiver"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d(TAG, "Device booted, starting service")
            context?.startService(Intent(context, MyCustomService::class.java))
        }
    }
}
```

Then add to AndroidManifest.xml inside `<application>` tag:
```xml
<receiver
    android:name=".MyBootReceiver"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
    </intent-filter>
</receiver>
```

---

## TEMPLATE 3: React Native Module (Kotlin)

Create file: `android/app/src/main/java/fyi/ticketless/app/MyReactModule.kt`

```kotlin
package fyi.ticketless.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class MyReactModule(reactContext: ReactApplicationContext) : 
    ReactContextBaseJavaModule(reactContext) {
    
    companion object {
        private const val MODULE_NAME = "MyReactModule"
    }

    override fun getName(): String = MODULE_NAME

    @ReactMethod
    fun doSomething(value: String, promise: Promise) {
        try {
            val result = value.uppercase()
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERROR", e)
        }
    }

    @ReactMethod
    fun doSomethingAsync(delay: Int, promise: Promise) {
        Thread {
            Thread.sleep(delay.toLong())
            promise.resolve("Done after $delay ms")
        }.start()
    }
}
```

Create Package file: `android/app/src/main/java/fyi/ticketless/app/MyReactPackage.kt`

```kotlin
package fyi.ticketless.app

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class MyReactPackage : TurboReactPackage() {
    override fun getModule(
        name: String,
        reactContext: ReactApplicationContext
    ): NativeModule? {
        return when (name) {
            "MyReactModule" -> MyReactModule(reactContext)
            else -> null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                "MyReactModule" to ReactModuleInfo(
                    name = "MyReactModule",
                    className = MyReactModule::class.java.name,
                    canOverrideExistingModule = true,
                    needsEagerInit = false,
                    hasConstants = false,
                    isCxxModule = false
                )
            )
        }
    }
}
```

Then update MainApplication.kt:
```kotlin
override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Add custom packages here
          add(MyReactPackage())  // Add this line
        },
    )
  }
```

---

## TEMPLATE 4: Foreground Service (Location)

Create file: `android/app/src/main/java/fyi/ticketless/app/LocationForegroundService.kt`

```kotlin
package fyi.ticketless.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

class LocationForegroundService : Service() {
    companion object {
        private const val TAG = "LocationForegroundService"
        private const val CHANNEL_ID = "location_service_channel"
        private const val NOTIFICATION_ID = 1
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, createNotification())
        Log.d(TAG, "Foreground service started")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Foreground service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Location Service",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Ticketless Chicago")
            .setContentText("Tracking location...")
            .setSmallIcon(android.R.drawable.ic_dialog_map)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
```

Then add to AndroidManifest.xml:
```xml
<service
    android:name=".LocationForegroundService"
    android:exported="false"
    android:foregroundServiceType="location">
</service>
```

---

## INTEGRATION CHECKLIST

When adding new native code:

1. **File Placement:**
   - All files go in: `/android/app/src/main/java/fyi/ticketless/app/`
   - Package declaration: `package fyi.ticketless.app`

2. **AndroidManifest.xml Updates:**
   - Add service/receiver declarations inside `<application>` tag
   - Ensure `android:exported` is set appropriately
   - Add required permissions to manifest if needed

3. **MainApplication.kt Updates (if adding React modules):**
   - Import your new Package class
   - Add to PackageList in onCreate()

4. **Testing:**
   - Rebuild: `npm run build:android` or `cd android && ./gradlew assembleDebug`
   - Test on device/emulator

5. **Common Imports:**
```kotlin
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.os.IBinder
import com.facebook.react.bridge.*
```

---

## EXAMPLE: Adding React Method to Access Location

This shows how to create a bridge between JavaScript and native Android code.

**Kotlin Module:**
```kotlin
package fyi.ticketless.app

import android.content.Context
import android.location.LocationManager
import com.facebook.react.bridge.*

class LocationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "LocationModule"

    @ReactMethod
    fun getLastKnownLocation(promise: Promise) {
        try {
            val context = reactApplicationContext
            val locationManager = context.getSystemService(
                Context.LOCATION_SERVICE
            ) as LocationManager
            
            // Would need proper permission handling here
            val location = locationManager.getLastKnownLocation(
                LocationManager.GPS_PROVIDER
            )
            
            if (location != null) {
                val map = Arguments.createMap()
                map.putDouble("latitude", location.latitude)
                map.putDouble("longitude", location.longitude)
                promise.resolve(map)
            } else {
                promise.reject("NO_LOCATION", "Location not available")
            }
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }
}
```

**JavaScript Usage:**
```javascript
import { NativeModules } from 'react-native';

const { LocationModule } = NativeModules;

LocationModule.getLastKnownLocation()
  .then(location => console.log(location))
  .catch(error => console.error(error));
```

---

## IMPORTANT NOTES

1. **Always use `fyi.ticketless.app` as the package name** - This is consistent with all existing code
2. **Use Kotlin** - The project uses Kotlin, not Java
3. **React Native Version:** The app uses the latest React Native with autolink support
4. **Target SDK 36** - Ensure code is compatible with Android 15
5. **Min SDK 24** - Code must support Android 7.0+
6. **Permissions:** Declare all needed permissions in AndroidManifest.xml
7. **Foreground Services:** For location/background work, use foreground services with proper notifications

