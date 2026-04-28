package fyi.ticketless.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity

/**
 * ActivityTransitionModule
 *
 * React Native native module that bridges Google's Activity Transition API
 * (ActivityRecognitionClient) to the JS layer. Provides:
 *
 * - startMonitoring(): Subscribe to IN_VEHICLE ENTER/EXIT and STILL ENTER
 * - stopMonitoring(): Unsubscribe
 * - checkPendingEvents(): Check for events that fired while JS was inactive
 * - hasPermission() / requestPermission(): Permission helpers
 * - isCurrentlyDriving(): Last known IN_VEHICLE state from receiver
 *
 * Emits events to JS:
 * - "ActivityDrivingStarted":  IN_VEHICLE ENTER (user started driving)
 * - "ActivityParkingDetected": IN_VEHICLE EXIT (user stopped driving — candidate parking)
 *
 * Why this exists:
 * On Android our only motion-based parking signal is Bluetooth ACL. Users
 * without car BT, or with flaky pairing, have no fallback. Activity Recognition
 * runs on a low-power sensor hub (similar to iOS CoreMotion) and gives an
 * independent IN_VEHICLE → STILL signal that supplements BT.
 */
class ActivityTransitionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "ActivityTransitionMod"
        const val EVENT_DRIVING_STARTED = "ActivityDrivingStarted"
        const val EVENT_PARKING_DETECTED = "ActivityParkingDetected"

        // Static listener used by the BroadcastReceiver to deliver events when
        // the JS bridge is alive. When null, the receiver persists a pending flag.
        @Volatile
        var eventListener: ActivityEventListener? = null

        private const val PENDING_INTENT_REQUEST_CODE = 7321
    }

    interface ActivityEventListener {
        fun onDrivingStarted(timestamp: Long)
        fun onParkingDetected(timestamp: Long)
    }

    @Volatile
    private var lifecycleListenerRegistered = false

    @Volatile
    private var monitoring = false

    init {
        // Constructor stays side-effect free.
    }

    private fun ensureLifecycleListener() {
        if (!lifecycleListenerRegistered) {
            lifecycleListenerRegistered = true
            reactApplicationContext.addLifecycleEventListener(this)
        }
    }

    override fun getName(): String = "ActivityTransitionModule"

    private fun buildPendingIntent(): PendingIntent {
        val intent = Intent(reactApplicationContext, ActivityTransitionReceiver::class.java).apply {
            action = ActivityTransitionReceiver.ACTION_TRANSITION
        }
        // FLAG_MUTABLE is required: ActivityTransitionResult is attached to the
        // intent at delivery time. FLAG_IMMUTABLE would prevent the system from
        // adding extras and silently break event delivery.
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        return PendingIntent.getBroadcast(
            reactApplicationContext,
            PENDING_INTENT_REQUEST_CODE,
            intent,
            flags
        )
    }

    private fun buildTransitionRequest(): ActivityTransitionRequest {
        val transitions = listOf(
            ActivityTransition.Builder()
                .setActivityType(DetectedActivity.IN_VEHICLE)
                .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                .build(),
            ActivityTransition.Builder()
                .setActivityType(DetectedActivity.IN_VEHICLE)
                .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
                .build(),
            ActivityTransition.Builder()
                .setActivityType(DetectedActivity.STILL)
                .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                .build(),
        )
        return ActivityTransitionRequest(transitions)
    }

    /**
     * Check whether the runtime ACTIVITY_RECOGNITION permission is granted.
     * Required on API 29+. On older API levels, the manifest-declared
     * com.google.android.gms.permission.ACTIVITY_RECOGNITION is sufficient.
     */
    @ReactMethod
    fun hasPermission(promise: Promise) {
        ensureLifecycleListener()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val granted = ContextCompat.checkSelfPermission(
                    reactApplicationContext,
                    "android.permission.ACTIVITY_RECOGNITION"
                ) == PackageManager.PERMISSION_GRANTED
                promise.resolve(granted)
            } else {
                // Pre-Q: granted at install time via manifest declaration.
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("PERMISSION_CHECK_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun startMonitoring(promise: Promise) {
        ensureLifecycleListener()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val granted = ContextCompat.checkSelfPermission(
                    reactApplicationContext,
                    "android.permission.ACTIVITY_RECOGNITION"
                ) == PackageManager.PERMISSION_GRANTED
                if (!granted) {
                    promise.reject(
                        "PERMISSION_DENIED",
                        "ACTIVITY_RECOGNITION runtime permission not granted"
                    )
                    return
                }
            }

            val client = ActivityRecognition.getClient(reactApplicationContext)
            val request = buildTransitionRequest()
            val pendingIntent = buildPendingIntent()

            client.requestActivityTransitionUpdates(request, pendingIntent)
                .addOnSuccessListener {
                    Log.i(TAG, "Activity transition updates registered")
                    monitoring = true
                    promise.resolve(true)
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "Failed to register activity transition updates", e)
                    promise.reject("REGISTER_FAILED", e.message, e)
                }
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException starting activity transition monitor", e)
            promise.reject("PERMISSION_DENIED", e.message, e)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start activity transition monitor", e)
            promise.reject("START_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopMonitoring(promise: Promise) {
        ensureLifecycleListener()
        try {
            val client = ActivityRecognition.getClient(reactApplicationContext)
            val pendingIntent = buildPendingIntent()
            client.removeActivityTransitionUpdates(pendingIntent)
                .addOnSuccessListener {
                    Log.i(TAG, "Activity transition updates removed")
                    monitoring = false
                    pendingIntent.cancel()
                    promise.resolve(true)
                }
                .addOnFailureListener { e ->
                    Log.w(TAG, "Failed to remove activity transition updates: ${e.message}")
                    // Best-effort: cancel the pending intent so it can't deliver more.
                    try { pendingIntent.cancel() } catch (_: Exception) { /* ignore */ }
                    monitoring = false
                    // Resolve true so the JS side doesn't fail loudly on cleanup.
                    promise.resolve(true)
                }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop activity transition monitor", e)
            promise.reject("STOP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun checkPendingEvents(promise: Promise) {
        ensureLifecycleListener()
        try {
            val pendingDriving = ActivityTransitionReceiver
                .consumePendingDrivingStarted(reactApplicationContext)
            val pendingParking = ActivityTransitionReceiver
                .consumePendingParkingDetected(reactApplicationContext)
            Log.i(TAG, "Pending events: driving=$pendingDriving parking=$pendingParking")
            val result = Arguments.createMap().apply {
                putBoolean("pendingDrivingStarted", pendingDriving)
                putBoolean("pendingParkingDetected", pendingParking)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CHECK_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isCurrentlyDriving(promise: Promise) {
        ensureLifecycleListener()
        try {
            val driving = ActivityTransitionReceiver.isCurrentlyDriving(reactApplicationContext)
            promise.resolve(driving)
        } catch (e: Exception) {
            promise.reject("CHECK_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isMonitoring(promise: Promise) {
        ensureLifecycleListener()
        promise.resolve(monitoring)
    }

    private fun emitEvent(eventName: String, timestamp: Long) {
        val params = Arguments.createMap().apply {
            putDouble("timestamp", timestamp.toDouble())
        }
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
        Log.d(TAG, "Event emitted: $eventName @ $timestamp")
    }

    // -------------------------------------------------------------------------
    // LifecycleEventListener
    // -------------------------------------------------------------------------

    override fun onHostResume() {
        Log.d(TAG, "onHostResume: re-attaching listener and consuming pending events")
        eventListener = object : ActivityEventListener {
            override fun onDrivingStarted(timestamp: Long) {
                emitEvent(EVENT_DRIVING_STARTED, timestamp)
            }
            override fun onParkingDetected(timestamp: Long) {
                emitEvent(EVENT_PARKING_DETECTED, timestamp)
            }
        }

        // Drain any events the receiver stored while JS was paused.
        val pendingDriving = ActivityTransitionReceiver
            .consumePendingDrivingStarted(reactApplicationContext)
        val pendingParking = ActivityTransitionReceiver
            .consumePendingParkingDetected(reactApplicationContext)
        val now = System.currentTimeMillis()
        if (pendingDriving) {
            try { emitEvent(EVENT_DRIVING_STARTED, now) }
            catch (e: Exception) { Log.e(TAG, "Failed to emit pending driving started: ${e.message}") }
        }
        if (pendingParking) {
            try { emitEvent(EVENT_PARKING_DETECTED, now) }
            catch (e: Exception) { Log.e(TAG, "Failed to emit pending parking detected: ${e.message}") }
        }
    }

    override fun onHostPause() {
        // Keep the receiver path alive — events will be persisted as pending.
        Log.d(TAG, "onHostPause: receiver continues delivering to SharedPreferences")
    }

    override fun onHostDestroy() {
        Log.d(TAG, "onHostDestroy: clearing JS listener (receiver continues)")
        eventListener = null
    }
}
