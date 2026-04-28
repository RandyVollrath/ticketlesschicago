package fyi.ticketless.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * BroadcastReceiver for Google's Activity Transition API.
 *
 * Receives IN_VEHICLE / STILL ENTER and EXIT transitions delivered by the
 * activity recognition sensor hub. Designed to behave like the BT pending-event
 * pattern: if the JS bridge is alive and a listener is registered, deliver the
 * event directly. Otherwise, persist a flag in SharedPreferences so JS can
 * consume it on next app resume.
 *
 * Why a BroadcastReceiver (not a foreground service):
 * Unlike Bluetooth ACL events which require a long-lived service to stay
 * registered, Activity Transitions are delivered by the system to a
 * PendingIntent. The receiver is auto-launched even when the app is killed.
 *
 * Companion:
 *  - ActivityTransitionModule: starts/stops transition updates and provides
 *    the static eventListener that this receiver delivers events to.
 */
class ActivityTransitionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ActivityTransitionRx"
        const val ACTION_TRANSITION = "fyi.ticketless.app.ACTIVITY_TRANSITION"

        const val PREFS_NAME = "activity_transition_prefs"
        const val KEY_PENDING_DRIVING_STARTED = "pending_driving_started"
        const val KEY_PENDING_PARKING_DETECTED = "pending_parking_detected"
        const val KEY_LAST_EVENT_TIME = "last_event_time"
        const val KEY_LAST_DRIVING_STARTED_TIME = "last_driving_started_time"
        const val KEY_LAST_PARKING_DETECTED_TIME = "last_parking_detected_time"
        const val KEY_IS_DRIVING = "is_driving"

        fun consumePendingDrivingStarted(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getBoolean(KEY_PENDING_DRIVING_STARTED, false)
            if (pending) {
                prefs.edit().putBoolean(KEY_PENDING_DRIVING_STARTED, false).apply()
            }
            return pending
        }

        fun consumePendingParkingDetected(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getBoolean(KEY_PENDING_PARKING_DETECTED, false)
            if (pending) {
                prefs.edit().putBoolean(KEY_PENDING_PARKING_DETECTED, false).apply()
            }
            return pending
        }

        fun isCurrentlyDriving(context: Context): Boolean {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean(KEY_IS_DRIVING, false)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_TRANSITION) {
            // Some OEMs deliver via the implicit ActivityRecognitionResult action;
            // accept that path too.
            if (!ActivityRecognitionResult.hasResult(intent) &&
                !ActivityTransitionResult.hasResult(intent)) {
                Log.d(TAG, "Ignoring intent with action=${intent.action}")
                return
            }
        }

        if (!ActivityTransitionResult.hasResult(intent)) {
            Log.d(TAG, "Intent has no ActivityTransitionResult — ignoring")
            return
        }

        val result = ActivityTransitionResult.extractResult(intent) ?: return
        val now = System.currentTimeMillis()
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        for (event in result.transitionEvents) {
            val activityName = activityName(event.activityType)
            val transitionName = transitionName(event.transitionType)
            Log.i(TAG, "Activity transition: $activityName $transitionName")

            when {
                // IN_VEHICLE ENTER: user started driving
                event.activityType == DetectedActivity.IN_VEHICLE &&
                    event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER -> {
                    onDrivingStarted(context, prefs, now)
                }

                // IN_VEHICLE EXIT: user stopped driving — candidate parking event.
                // We treat IN_VEHICLE EXIT as the parking signal rather than STILL ENTER
                // because EXIT fires immediately on the transition, while STILL ENTER
                // requires the system to confirm sustained stillness (often 30-60s+).
                // EXIT gives us a timely signal; the JS pipeline confirms with GPS.
                event.activityType == DetectedActivity.IN_VEHICLE &&
                    event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_EXIT -> {
                    onParkingDetected(context, prefs, now)
                }

                // STILL ENTER (while not driving) is informational. It fires on any
                // sustained still period (sitting at a desk, watching TV). We do NOT
                // emit a parking event from STILL alone — only from IN_VEHICLE EXIT.
                // Logged for diagnostics.
                event.activityType == DetectedActivity.STILL &&
                    event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER -> {
                    Log.d(TAG, "STILL ENTER (informational only)")
                }
            }
        }

        prefs.edit().putLong(KEY_LAST_EVENT_TIME, now).apply()
    }

    private fun onDrivingStarted(context: Context, prefs: SharedPreferences, now: Long) {
        prefs.edit()
            .putBoolean(KEY_IS_DRIVING, true)
            .putLong(KEY_LAST_DRIVING_STARTED_TIME, now)
            // Driving started → cancel any pending parking flag, it's stale.
            .putBoolean(KEY_PENDING_PARKING_DETECTED, false)
            .apply()

        val listener = ActivityTransitionModule.eventListener
        if (listener != null) {
            try {
                Log.d(TAG, "Delivering DrivingStarted to JS listener directly")
                listener.onDrivingStarted(now)
            } catch (e: Exception) {
                Log.e(TAG, "Listener threw on driving started, storing as pending: ${e.message}")
                prefs.edit().putBoolean(KEY_PENDING_DRIVING_STARTED, true).apply()
            }
        } else {
            Log.d(TAG, "JS bridge not active, storing pending driving started")
            prefs.edit().putBoolean(KEY_PENDING_DRIVING_STARTED, true).apply()
        }
    }

    private fun onParkingDetected(context: Context, prefs: SharedPreferences, now: Long) {
        prefs.edit()
            .putBoolean(KEY_IS_DRIVING, false)
            .putLong(KEY_LAST_PARKING_DETECTED_TIME, now)
            .putBoolean(KEY_PENDING_DRIVING_STARTED, false)
            .apply()

        val listener = ActivityTransitionModule.eventListener
        if (listener != null) {
            try {
                Log.d(TAG, "Delivering ParkingDetected to JS listener directly")
                listener.onParkingDetected(now)
            } catch (e: Exception) {
                Log.e(TAG, "Listener threw on parking detected, storing as pending: ${e.message}")
                prefs.edit().putBoolean(KEY_PENDING_PARKING_DETECTED, true).apply()
            }
        } else {
            Log.d(TAG, "JS bridge not active, storing pending parking detected")
            prefs.edit().putBoolean(KEY_PENDING_PARKING_DETECTED, true).apply()
        }
    }

    private fun activityName(type: Int): String = when (type) {
        DetectedActivity.IN_VEHICLE -> "IN_VEHICLE"
        DetectedActivity.ON_BICYCLE -> "ON_BICYCLE"
        DetectedActivity.ON_FOOT -> "ON_FOOT"
        DetectedActivity.RUNNING -> "RUNNING"
        DetectedActivity.STILL -> "STILL"
        DetectedActivity.TILTING -> "TILTING"
        DetectedActivity.WALKING -> "WALKING"
        else -> "UNKNOWN($type)"
    }

    private fun transitionName(type: Int): String = when (type) {
        ActivityTransition.ACTIVITY_TRANSITION_ENTER -> "ENTER"
        ActivityTransition.ACTIVITY_TRANSITION_EXIT -> "EXIT"
        else -> "UNKNOWN($type)"
    }
}
