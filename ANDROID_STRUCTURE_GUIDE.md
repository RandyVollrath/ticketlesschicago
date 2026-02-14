# Android Native Code Structure Report
## Ticketless Chicago Mobile App

### 1. PACKAGE NAME
**Primary Package:** `fyi.ticketless.app`

**Application ID (build.gradle):** `fyi.ticketless.app`

---

### 2. DIRECTORY STRUCTURE
```
android/app/src/main/
├── java/
│   └── fyi/
│       └── ticketless/
│           └── app/
│               ├── MainActivity.kt
│               └── MainApplication.kt
├── res/
│   └── (resource files - drawables, values, layouts, etc.)
└── AndroidManifest.xml
```

---

### 3. AndroidManifest.xml (FULL CONTENTS)
Location: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
   <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
   <uses-permission android:name="android.permission.BLUETOOTH" />
   <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
   <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
   <uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
   <uses-permission android:name="android.permission.USE_BIOMETRIC" />
   <uses-permission android:name="android.permission.USE_FINGERPRINT" />
   <uses-permission android:name="android.permission.VIBRATE" />
   <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />

   <application
     android:name=".MainApplication"
     android:label="@string/app_name"
     android:icon="@mipmap/ic_launcher"
     android:roundIcon="@mipmap/ic_launcher_round"
     android:allowBackup="false"
     android:theme="@style/AppTheme"
     android:usesCleartextTraffic="${usesCleartextTraffic}"
     android:supportsRtl="true">
     <activity
       android:name=".MainActivity"
       android:label="@string/app_name"
       android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode"
       android:launchMode="singleTask"
       android:windowSoftInputMode="adjustResize"
       android:exported="true">
       <intent-filter>
           <action android:name="android.intent.action.MAIN" />
           <category android:name="android.intent.category.LAUNCHER" />
       </intent-filter>
       <!-- Deep link for custom scheme -->
       <intent-filter>
           <action android:name="android.intent.action.VIEW" />
           <category android:name="android.intent.category.DEFAULT" />
           <category android:name="android.intent.category.BROWSABLE" />
           <data android:scheme="ticketlesschicago" />
       </intent-filter>
       <!-- Deep link for https://ticketless.fyi/auth -->
       <intent-filter android:autoVerify="true">
           <action android:name="android.intent.action.VIEW" />
           <category android:name="android.intent.category.DEFAULT" />
           <category android:name="android.intent.category.BROWSABLE" />
           <data android:scheme="https" android:host="autopilotamerica.com" android:pathPrefix="/auth" />
       </intent-filter>
     </activity>
   </application>
</manifest>
```

---

### 4. MainActivity.kt (FULL CONTENTS)
Location: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/java/fyi/ticketless/app/MainActivity.kt`

```kotlin
package fyi.ticketless.app

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "TicketlessChicagoMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
```

---

### 5. MainApplication.kt (FULL CONTENTS)
Location: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/src/main/java/fyi/ticketless/app/MainApplication.kt`

```kotlin
package fyi.ticketless.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
```

---

### 6. build.gradle (App-Level) - FULL CONTENTS
Location: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/build.gradle`

```gradle
apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

/**
 * This is the configuration block to customize your React Native Android app.
 * By default you don't need to apply any configuration, just uncomment the lines you need.
 */
react {
    /* Folders */
    //   The root of your project, i.e. where "package.json" lives. Default is '../..'
    // root = file("../../")
    //   The folder where the react-native NPM package is. Default is ../../node_modules/react-native
    // reactNativeDir = file("../../node_modules/react-native")
    //   The folder where the react-native Codegen package is. Default is ../../node_modules/@react-native/codegen
    // codegenDir = file("../../node_modules/@react-native/codegen")
    //   The cli.js file which is the React Native CLI entrypoint. Default is ../../node_modules/react-native/cli.js
    // cliFile = file("../../node_modules/react-native/cli.js")

    /* Variants */
    //   The list of variants to that are debuggable. For those we're going to
    //   skip the bundling of the JS bundle and the assets. By default is just 'debug'.
    //   If you add flavors like lite, prod, etc. you'll have to list your debuggableVariants.
    // debuggableVariants = ["liteDebug", "prodDebug"]

    /* Bundling */
    //   A list containing the node command and its flags. Default is just 'node'.
    // nodeExecutableAndArgs = ["node"]
    //
    //   The command to run when bundling. By default is 'bundle'
    // bundleCommand = "ram-bundle"
    //
    //   The path to the CLI configuration file. Default is empty.
    // bundleConfig = file(../rn-cli.config.js)
    //
    //   The name of the generated asset file containing your JS bundle
    // bundleAssetName = "MyApplication.android.bundle"
    //
    //   The entry file for bundle generation. Default is 'index.android.js' or 'index.js'
    // entryFile = file("../js/MyApplication.android.js")
    //
    //   A list of extra flags to pass to the 'bundle' commands.
    //   See https://github.com/react-native-community/cli/blob/main/docs/commands.md#bundle
    // extraPackagerArgs = []

    /* Hermes Commands */
    //   The hermes compiler command to run. By default it is 'hermesc'
    // hermesCommand = "$rootDir/my-custom-hermesc/bin/hermesc"
    //
    //   The list of flags to pass to the Hermes compiler. By default is "-O", "-output-source-map"
    // hermesFlags = ["-O", "-output-source-map"]

    /* Autolinking */
    autolinkLibrariesWithApp()
}

/**
 * Set this to true to Run Proguard on Release builds to minify the Java bytecode.
 */
def enableProguardInReleaseBuilds = false

/**
 * The preferred build flavor of JavaScriptCore (JSC)
 *
 * For example, to use the international variant, you can use:
 * `def jscFlavor = io.github.react-native-community:jsc-android-intl:2026004.+`
 *
 * The international variant includes ICU i18n library and necessary data
 * allowing to use e.g. `Date.toLocaleString` and `String.localeCompare` that
 * give correct results when using with locales other than en-US. Note that
 * this variant is about 6MiB larger per architecture than default.
 */
def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'

android {
    ndkVersion rootProject.ext.ndkVersion
    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace "fyi.ticketless.app"
    defaultConfig {
        applicationId "fyi.ticketless.app"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 2
        versionName "1.0.1"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file('ticketless-release.keystore')
            storePassword 'ticketless2024'
            keyAlias 'ticketless'
            keyPassword 'ticketless2024'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
            shrinkResources false
        }
    }
    bundle {
        language {
            enableSplit = true
        }
        density {
            enableSplit = true
        }
        abi {
            enableSplit = true
        }
    }
}

dependencies {
    // The version of react-native is set by the React Native Gradle Plugin
    implementation("com.facebook.react:react-android")

    // Force compatible Google Play Services Location version for react-native-geolocation-service
    // This fixes IncompatibleClassChangeError crash on Map screen
    implementation("com.google.android.gms:play-services-location:21.3.0")

    if (hermesEnabled.toBoolean()) {
        implementation("com.facebook.react:hermes-android")
    } else {
        implementation jscFlavor
    }
}
```

---

### 7. build.gradle (Root-Level) - CONFIGURATION
Location: `/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/build.gradle`

```gradle
buildscript {
    ext {
        buildToolsVersion = "36.0.0"
        minSdkVersion = 24
        compileSdkVersion = 36
        targetSdkVersion = 36
        ndkVersion = "29.0.14206865"
        kotlinVersion = "2.1.20"
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle")
        classpath("com.facebook.react:react-native-gradle-plugin")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin")
    }
}

apply plugin: "com.facebook.react.rootproject"
```

---

### 8. NATIVE MODULES & SERVICES DECLARED
Currently declared in AndroidManifest.xml:
- **NO additional native services or receivers beyond the main Activity**
- Only MainActivity (the React Activity entry point) is declared

**Permissions declared for future services:**
- RECEIVE_BOOT_COMPLETED (for starting services on boot)
- FOREGROUND_SERVICE (for foreground services)
- FOREGROUND_SERVICE_LOCATION (for location foreground services)
- Bluetooth, Location, Biometric, Notification, Vibration permissions

---

### 9. BUILD CONFIGURATION SUMMARY
- **Build Tools Version:** 36.0.0
- **Min SDK:** 24 (Android 7.0)
- **Target SDK:** 36 (Android 15)
- **Compile SDK:** 36 (Android 15)
- **NDK Version:** 29.0.14206865
- **Kotlin Version:** 2.1.20
- **App Version Code:** 2
- **App Version Name:** 1.0.1

**Dependencies:**
- React Native Android framework (automatic via gradle plugin)
- Google Play Services Location 21.3.0
- JSC or Hermes JavaScript engine

---

### 10. DIRECTORY STRUCTURE - EXACT PATHS

```
/home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/
├── android/
│   ├── build.gradle                        (root build config)
│   ├── settings.gradle
│   ├── app/
│   │   ├── build.gradle                    (app-level build config)
│   │   ├── build/                          (compiled outputs)
│   │   ├── src/
│   │   │   └── main/
│   │   │       ├── AndroidManifest.xml
│   │   │       ├── java/
│   │   │       │   └── fyi/
│   │   │       │       └── ticketless/
│   │   │       │           └── app/
│   │   │       │               ├── MainActivity.kt
│   │   │       │               └── MainApplication.kt
│   │   │       ├── res/
│   │   │       │   ├── drawable/
│   │   │       │   ├── mipmap/
│   │   │       │   └── values/
│   │   │       │       ├── strings.xml
│   │   │       │       └── styles.xml
│   │   │       └── ...
│   │   └── debug.keystore
```

---

### 11. KEY INFORMATION FOR NATIVE CODE INTEGRATION

**Package Structure:**
- Root package: `fyi.ticketless.app`
- Files should be placed in: `/fyi/ticketless/app/` subdirectory structure

**Import Statements to Use:**
```kotlin
package fyi.ticketless.app

import android.app.Application
import android.content.Context
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
// ... other imports as needed
```

**Activity/Service Parent Classes:**
- Activities should extend: `com.facebook.react.ReactActivity`
- Services should extend: `android.app.Service`
- Broadcast Receivers should extend: `android.content.BroadcastReceiver`

**Application Entry Point:**
- MainApplication extends Application and ReactApplication
- Use MainApplication.onCreate() to initialize custom services
- PackageList in MainApplication handles autolinked React Native packages

**To Add Custom Native Modules:**
1. Create new Kotlin/Java file in `fyi/ticketless/app/` package
2. Update MainApplication to manually add via:
   ```kotlin
   PackageList(this).packages.apply {
       add(MyCustomPackage())
   }
   ```
3. Add corresponding service/receiver declarations in AndroidManifest.xml

