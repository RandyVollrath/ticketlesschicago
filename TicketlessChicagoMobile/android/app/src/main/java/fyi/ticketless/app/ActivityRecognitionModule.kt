package fyi.ticketless.app

import android.Manifest
import android.app.PendingIntent
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
 * ActivityRecognitionModule
 *
 * React Native native module that bridges the Google Activity Recognition
 * Transition API to the JS layer. Provides methods to:
 *
 * - startMonitoring(): Register for activity transition updates
 * - stopMonitoring(): Unregister from activity transition updates
 * - checkPendingEvents(): Check for events that fired while JS was inactive
 * - isDriving(): Check current driving state from SharedPreferences
 * - hasPermission(): Check if ACTIVITY_RECOGNITION permission is granted
 *
 * Emits events to JS:
 * - "ActivityDrivingStarted": User started driving (IN_VEHICLE ENTER)
 * - "ActivityDrivingStopped": User stopped driving (IN_VEHICLE EXIT / STILL ENTER / WALKING ENTER)
 */
class ActivityRecognitionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "ActivityRecognitionMod"
        const val EVENT_DRIVING_STARTED = "ActivityDrivingStarted"
        const val EVENT_DRIVING_STOPPED = "ActivityDrivingStopped"
        private const val PENDING_INTENT_REQUEST_CODE = 1001
    }

    private var pendingIntent: PendingIntent? = null

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "ActivityRecognitionModule"

    /**
     * Check if ACTIVITY_RECOGNITION permission is granted.
     * On Android 10+ (API 29+), this requires runtime permission.
     * On Android 9 and below, it's automatically granted via manifest.
     */
    @ReactMethod
    fun hasPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val granted = ContextCompat.checkSelfPermission(
                    reactApplicationContext,
                    Manifest.permission.ACTIVITY_RECOGNITION
                ) == PackageManager.PERMISSION_GRANTED
                promise.resolve(granted)
            } else {
                // Pre-Android 10: manifest permission is sufficient
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("CHECK_FAILED", e.message, e)
        }
    }

    /**
     * Start monitoring activity transitions.
     * Registers for IN_VEHICLE enter/exit, STILL enter, and WALKING enter.
     */
    @ReactMethod
    fun startMonitoring(promise: Promise) {
        try {
            // Check permission first
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val granted = ContextCompat.checkSelfPermission(
                    reactApplicationContext,
                    Manifest.permission.ACTIVITY_RECOGNITION
                ) == PackageManager.PERMISSION_GRANTED
                if (!granted) {
                    promise.reject("PERMISSION_DENIED", "ACTIVITY_RECOGNITION permission not granted")
                    return
                }
            }

            val transitions = mutableListOf<ActivityTransition>()

            // IN_VEHICLE: detect driving start and stop
            transitions.add(
                ActivityTransition.Builder()
                    .setActivityType(DetectedActivity.IN_VEHICLE)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                    .build()
            )
            transitions.add(
                ActivityTransition.Builder()
                    .setActivityType(DetectedActivity.IN_VEHICLE)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
                    .build()
            )

            // STILL: secondary signal for parking (user stopped moving)
            transitions.add(
                ActivityTransition.Builder()
                    .setActivityType(DetectedActivity.STILL)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                    .build()
            )

            // WALKING: secondary signal for parking (user walked away from car)
            transitions.add(
                ActivityTransition.Builder()
                    .setActivityType(DetectedActivity.WALKING)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                    .build()
            )

            val request = ActivityTransitionRequest(transitions)

            // Create PendingIntent for the BroadcastReceiver
            val intent = Intent(reactApplicationContext, ActivityRecognitionReceiver::class.java)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext,
                PENDING_INTENT_REQUEST_CODE,
                intent,
                flags
            )

            // Set up the event listener for real-time delivery to JS
            ActivityRecognitionReceiver.eventListener = object : ActivityRecognitionReceiver.Companion.ActivityEventListener {
                override fun onDrivingStarted(activityType: String, elapsedRealtimeNanos: Long) {
                    Log.i(TAG, "Emitting driving started event to JS: $activityType")
                    emitEvent(EVENT_DRIVING_STARTED, activityType, elapsedRealtimeNanos)
                }

                override fun onDrivingStopped(activityType: String, elapsedRealtimeNanos: Long) {
                    Log.i(TAG, "Emitting driving stopped event to JS: $activityType")
                    emitEvent(EVENT_DRIVING_STOPPED, activityType, elapsedRealtimeNanos)
                }
            }

            // Register for updates
            val task = ActivityRecognition.getClient(reactApplicationContext)
                .requestActivityTransitionUpdates(request, pendingIntent!!)

            task.addOnSuccessListener {
                Log.i(TAG, "Activity Recognition monitoring started successfully")
                promise.resolve(true)
            }

            task.addOnFailureListener { e ->
                Log.e(TAG, "Failed to start Activity Recognition monitoring", e)
                promise.reject("START_FAILED", "Failed to start Activity Recognition: ${e.message}", e)
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error starting Activity Recognition monitoring", e)
            promise.reject("START_FAILED", e.message, e)
        }
    }

    /**
     * Stop monitoring activity transitions.
     */
    @ReactMethod
    fun stopMonitoring(promise: Promise) {
        try {
            pendingIntent?.let { pi ->
                val task = ActivityRecognition.getClient(reactApplicationContext)
                    .removeActivityTransitionUpdates(pi)

                task.addOnSuccessListener {
                    pi.cancel()
                    pendingIntent = null
                    ActivityRecognitionReceiver.eventListener = null
                    Log.i(TAG, "Activity Recognition monitoring stopped")
                    promise.resolve(true)
                }

                task.addOnFailureListener { e ->
                    Log.e(TAG, "Failed to stop Activity Recognition monitoring", e)
                    promise.reject("STOP_FAILED", e.message, e)
                }
            } ?: run {
                Log.d(TAG, "No pending intent to cancel — monitoring was not active")
                promise.resolve(false)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping Activity Recognition", e)
            promise.reject("STOP_FAILED", e.message, e)
        }
    }

    /**
     * Check for pending events that fired while JS was inactive.
     * Returns an object with { pendingDrivingStart: boolean, pendingDrivingStop: boolean }
     */
    @ReactMethod
    fun checkPendingEvents(promise: Promise) {
        try {
            val drivingStart = ActivityRecognitionReceiver.consumePendingDrivingStart(reactApplicationContext)
            val drivingStop = ActivityRecognitionReceiver.consumePendingDrivingStop(reactApplicationContext)

            Log.i(TAG, "Pending AR events check: drivingStart=$drivingStart, drivingStop=$drivingStop")

            val result = Arguments.createMap().apply {
                putBoolean("pendingDrivingStart", drivingStart)
                putBoolean("pendingDrivingStop", drivingStop)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to check pending AR events", e)
            promise.reject("CHECK_FAILED", e.message, e)
        }
    }

    /**
     * Check current driving state from SharedPreferences.
     */
    @ReactMethod
    fun isDriving(promise: Promise) {
        try {
            val driving = ActivityRecognitionReceiver.isDriving(reactApplicationContext)
            promise.resolve(driving)
        } catch (e: Exception) {
            promise.reject("CHECK_FAILED", e.message, e)
        }
    }

    /**
     * Emit an event to JS.
     */
    private fun emitEvent(eventName: String, activityType: String, elapsedRealtimeNanos: Long) {
        val params = Arguments.createMap().apply {
            putString("activityType", activityType)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
            putDouble("elapsedRealtimeNanos", elapsedRealtimeNanos.toDouble())
        }

        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
            Log.d(TAG, "Event emitted: $eventName ($activityType)")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit event $eventName: ${e.message}")
        }
    }

    // -------------------------------------------------------------------------
    // LifecycleEventListener
    // -------------------------------------------------------------------------

    override fun onHostResume() {
        Log.d(TAG, "onHostResume: re-attaching event listener and checking pending events")

        // Re-attach the event listener
        ActivityRecognitionReceiver.eventListener = object : ActivityRecognitionReceiver.Companion.ActivityEventListener {
            override fun onDrivingStarted(activityType: String, elapsedRealtimeNanos: Long) {
                Log.i(TAG, "Emitting driving started event to JS (resumed): $activityType")
                emitEvent(EVENT_DRIVING_STARTED, activityType, elapsedRealtimeNanos)
            }

            override fun onDrivingStopped(activityType: String, elapsedRealtimeNanos: Long) {
                Log.i(TAG, "Emitting driving stopped event to JS (resumed): $activityType")
                emitEvent(EVENT_DRIVING_STOPPED, activityType, elapsedRealtimeNanos)
            }
        }

        // Check for pending events
        val drivingStart = ActivityRecognitionReceiver.consumePendingDrivingStart(reactApplicationContext)
        val drivingStop = ActivityRecognitionReceiver.consumePendingDrivingStop(reactApplicationContext)

        if (drivingStart) {
            try {
                Log.i(TAG, "Found pending driving start on resume - emitting")
                emitEvent(EVENT_DRIVING_STARTED, "IN_VEHICLE", 0)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to emit pending driving start on resume: ${e.message}")
            }
        }
        if (drivingStop) {
            try {
                Log.i(TAG, "Found pending driving stop on resume - emitting")
                emitEvent(EVENT_DRIVING_STOPPED, "STILL", 0)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to emit pending driving stop on resume: ${e.message}")
            }
        }
    }

    override fun onHostPause() {
        Log.d(TAG, "onHostPause: Activity Recognition continues in background via PendingIntent")
    }

    override fun onHostDestroy() {
        Log.d(TAG, "onHostDestroy: clearing JS listener (AR continues via PendingIntent)")
        ActivityRecognitionReceiver.eventListener = null
    }
}
