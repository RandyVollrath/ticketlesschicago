package fyi.ticketless.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * ActivityRecognitionReceiver
 *
 * BroadcastReceiver that handles Activity Recognition Transition API callbacks.
 * This receiver fires even when the app is in background/killed, because it's
 * registered via PendingIntent (not a runtime listener).
 *
 * When a transition is detected (e.g., IN_VEHICLE ENTER or EXIT), it:
 * 1. Stores the event in SharedPreferences (for JS to poll on next wake)
 * 2. Notifies the ActivityRecognitionModule's event listener (if JS bridge is active)
 *
 * This is the same pattern as BluetoothMonitorService's pending event mechanism:
 * if JS isn't running, events are stored; when JS resumes, it checks for pending events.
 */
class ActivityRecognitionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ActivityRecognition"
        const val PREFS_NAME = "activity_recognition_prefs"
        const val KEY_LAST_ACTIVITY = "last_activity"         // "IN_VEHICLE", "STILL", "WALKING", etc.
        const val KEY_LAST_TRANSITION = "last_transition"     // "ENTER" or "EXIT"
        const val KEY_LAST_EVENT_TIME = "last_event_time"     // timestamp millis
        const val KEY_PENDING_DRIVING_START = "pending_driving_start"
        const val KEY_PENDING_DRIVING_STOP = "pending_driving_stop"
        const val KEY_IS_DRIVING = "is_driving"               // current driving state

        /**
         * Listener interface for real-time event delivery to JS bridge.
         * Set by ActivityRecognitionModule when JS is active.
         */
        var eventListener: ActivityEventListener? = null

        interface ActivityEventListener {
            fun onDrivingStarted(activityType: String, elapsedRealtimeNanos: Long)
            fun onDrivingStopped(activityType: String, elapsedRealtimeNanos: Long)
        }

        /**
         * Check and consume pending driving start event.
         */
        fun consumePendingDrivingStart(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getBoolean(KEY_PENDING_DRIVING_START, false)
            if (pending) {
                prefs.edit().putBoolean(KEY_PENDING_DRIVING_START, false).apply()
            }
            return pending
        }

        /**
         * Check and consume pending driving stop event.
         */
        fun consumePendingDrivingStop(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getBoolean(KEY_PENDING_DRIVING_STOP, false)
            if (pending) {
                prefs.edit().putBoolean(KEY_PENDING_DRIVING_STOP, false).apply()
            }
            return pending
        }

        /**
         * Check current driving state from SharedPreferences.
         */
        fun isDriving(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(KEY_IS_DRIVING, false)
        }

        /**
         * Get human-readable activity name from DetectedActivity type.
         */
        fun activityName(type: Int): String = when (type) {
            DetectedActivity.IN_VEHICLE -> "IN_VEHICLE"
            DetectedActivity.ON_BICYCLE -> "ON_BICYCLE"
            DetectedActivity.RUNNING -> "RUNNING"
            DetectedActivity.STILL -> "STILL"
            DetectedActivity.WALKING -> "WALKING"
            DetectedActivity.ON_FOOT -> "ON_FOOT"
            DetectedActivity.TILTING -> "TILTING"
            DetectedActivity.UNKNOWN -> "UNKNOWN"
            else -> "UNKNOWN($type)"
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (!ActivityTransitionResult.hasResult(intent)) {
            Log.w(TAG, "Received intent without ActivityTransitionResult")
            return
        }

        val result = ActivityTransitionResult.extractResult(intent) ?: return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        for (event in result.transitionEvents) {
            val activityType = activityName(event.activityType)
            val transitionType = if (event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) "ENTER" else "EXIT"
            val timestamp = System.currentTimeMillis()

            Log.i(TAG, "Activity transition: $activityType $transitionType (elapsed: ${event.elapsedRealTimeNanos})")

            // Store in SharedPreferences
            prefs.edit()
                .putString(KEY_LAST_ACTIVITY, activityType)
                .putString(KEY_LAST_TRANSITION, transitionType)
                .putLong(KEY_LAST_EVENT_TIME, timestamp)
                .apply()

            // Determine if this is a driving start or stop
            val isDrivingStart = event.activityType == DetectedActivity.IN_VEHICLE &&
                    event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER

            val isDrivingStop = (event.activityType == DetectedActivity.IN_VEHICLE &&
                    event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_EXIT) ||
                    (event.activityType == DetectedActivity.STILL &&
                            event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) ||
                    (event.activityType == DetectedActivity.WALKING &&
                            event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER)

            if (isDrivingStart) {
                Log.i(TAG, "DRIVING STARTED (Activity Recognition)")
                prefs.edit().putBoolean(KEY_IS_DRIVING, true).apply()

                // Try to deliver to JS bridge immediately
                try {
                    eventListener?.onDrivingStarted(activityType, event.elapsedRealTimeNanos)
                    Log.d(TAG, "Delivered driving start to JS bridge")
                } catch (e: Exception) {
                    Log.w(TAG, "Could not deliver to JS bridge, storing as pending: ${e.message}")
                    prefs.edit().putBoolean(KEY_PENDING_DRIVING_START, true).apply()
                }

                // If listener is null, store as pending
                if (eventListener == null) {
                    Log.d(TAG, "No JS listener, storing driving start as pending")
                    prefs.edit().putBoolean(KEY_PENDING_DRIVING_START, true).apply()
                }
            }

            if (isDrivingStop) {
                Log.i(TAG, "DRIVING STOPPED (Activity Recognition): $activityType $transitionType")
                prefs.edit().putBoolean(KEY_IS_DRIVING, false).apply()

                // Try to deliver to JS bridge immediately
                try {
                    eventListener?.onDrivingStopped(activityType, event.elapsedRealTimeNanos)
                    Log.d(TAG, "Delivered driving stop to JS bridge")
                } catch (e: Exception) {
                    Log.w(TAG, "Could not deliver to JS bridge, storing as pending: ${e.message}")
                    prefs.edit().putBoolean(KEY_PENDING_DRIVING_STOP, true).apply()
                }

                // If listener is null, store as pending
                if (eventListener == null) {
                    Log.d(TAG, "No JS listener, storing driving stop as pending")
                    prefs.edit().putBoolean(KEY_PENDING_DRIVING_STOP, true).apply()
                }
            }
        }
    }
}
