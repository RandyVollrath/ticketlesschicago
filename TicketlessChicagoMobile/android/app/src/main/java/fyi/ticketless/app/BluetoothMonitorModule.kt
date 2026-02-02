package fyi.ticketless.app

import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * BluetoothMonitorModule
 *
 * React Native native module that bridges the BluetoothMonitorService
 * (foreground service) to the JS layer. Provides methods to:
 *
 * - startMonitoring(address, name): Start the foreground service
 * - stopMonitoring(): Stop the foreground service
 * - checkPendingEvents(): Check for events that fired while JS was inactive
 * - isServiceRunning(): Check if the service is currently running
 *
 * Emits events to JS:
 * - "BtMonitorCarDisconnected": Car Bluetooth disconnected
 * - "BtMonitorCarConnected": Car Bluetooth connected
 */
class BluetoothMonitorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "BluetoothMonitorModule"
        const val EVENT_CAR_DISCONNECTED = "BtMonitorCarDisconnected"
        const val EVENT_CAR_CONNECTED = "BtMonitorCarConnected"
    }

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "BluetoothMonitorModule"

    /**
     * Start the Bluetooth monitoring foreground service.
     *
     * @param address The Bluetooth MAC address of the car to monitor
     * @param name The display name of the car device
     */
    @ReactMethod
    fun startMonitoring(address: String, name: String, promise: Promise) {
        try {
            Log.i(TAG, "Starting BT monitor service for: $name ($address)")

            // Set up the event listener so service can communicate back to JS
            BluetoothMonitorService.eventListener = object : BluetoothMonitorService.BluetoothEventListener {
                override fun onCarDisconnected(deviceName: String, deviceAddress: String) {
                    Log.i(TAG, "Emitting disconnect event to JS: $deviceName")
                    emitEvent(EVENT_CAR_DISCONNECTED, deviceName, deviceAddress)
                }

                override fun onCarConnected(deviceName: String, deviceAddress: String) {
                    Log.i(TAG, "Emitting connect event to JS: $deviceName")
                    emitEvent(EVENT_CAR_CONNECTED, deviceName, deviceAddress)
                }
            }

            // Start the foreground service
            val intent = Intent(reactApplicationContext, BluetoothMonitorService::class.java).apply {
                action = BluetoothMonitorService.ACTION_START
                putExtra(BluetoothMonitorService.EXTRA_DEVICE_ADDRESS, address)
                putExtra(BluetoothMonitorService.EXTRA_DEVICE_NAME, name)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }

            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start BT monitor service", e)
            promise.reject("START_FAILED", "Failed to start BT monitor: ${e.message}", e)
        }
    }

    /**
     * Stop the Bluetooth monitoring foreground service.
     */
    @ReactMethod
    fun stopMonitoring(promise: Promise) {
        try {
            Log.i(TAG, "Stopping BT monitor service")

            BluetoothMonitorService.eventListener = null

            val intent = Intent(reactApplicationContext, BluetoothMonitorService::class.java).apply {
                action = BluetoothMonitorService.ACTION_STOP
            }
            reactApplicationContext.startService(intent)

            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop BT monitor service", e)
            promise.reject("STOP_FAILED", "Failed to stop BT monitor: ${e.message}", e)
        }
    }

    /**
     * Check for pending events that fired while JS was inactive.
     * Returns an object with { pendingDisconnect: boolean, pendingConnect: boolean }
     */
    @ReactMethod
    fun checkPendingEvents(promise: Promise) {
        try {
            val disconnect = BluetoothMonitorService.consumePendingDisconnect(reactApplicationContext)
            val connect = BluetoothMonitorService.consumePendingConnect(reactApplicationContext)

            Log.i(TAG, "Pending events check: disconnect=$disconnect, connect=$connect")

            val result = Arguments.createMap().apply {
                putBoolean("pendingDisconnect", disconnect)
                putBoolean("pendingConnect", connect)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to check pending events", e)
            promise.reject("CHECK_FAILED", e.message, e)
        }
    }

    /**
     * Check if the car is currently connected (from service's perspective).
     */
    @ReactMethod
    fun isCarConnected(promise: Promise) {
        try {
            val connected = BluetoothMonitorService.isDeviceConnected(reactApplicationContext)
            promise.resolve(connected)
        } catch (e: Exception) {
            promise.reject("CHECK_FAILED", e.message, e)
        }
    }

    /**
     * Emit an event to JS.
     */
    private fun emitEvent(eventName: String, deviceName: String, deviceAddress: String) {
        try {
            val params = Arguments.createMap().apply {
                putString("deviceName", deviceName)
                putString("deviceAddress", deviceAddress)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }

            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)

            Log.d(TAG, "Event emitted: $eventName")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to emit event $eventName: ${e.message}")
            // If JS bridge is dead, the event was already stored as pending
            // by the service's handleDisconnect/handleConnect methods
        }
    }

    // -------------------------------------------------------------------------
    // LifecycleEventListener
    // -------------------------------------------------------------------------

    override fun onHostResume() {
        Log.d(TAG, "onHostResume: re-attaching event listener and checking pending events")

        // Re-attach the event listener (it may have been GC'd or nulled)
        BluetoothMonitorService.eventListener = object : BluetoothMonitorService.BluetoothEventListener {
            override fun onCarDisconnected(deviceName: String, deviceAddress: String) {
                Log.i(TAG, "Emitting disconnect event to JS (resumed): $deviceName")
                emitEvent(EVENT_CAR_DISCONNECTED, deviceName, deviceAddress)
            }

            override fun onCarConnected(deviceName: String, deviceAddress: String) {
                Log.i(TAG, "Emitting connect event to JS (resumed): $deviceName")
                emitEvent(EVENT_CAR_CONNECTED, deviceName, deviceAddress)
            }
        }

        // Check for any pending events that fired while we were paused
        val disconnect = BluetoothMonitorService.consumePendingDisconnect(reactApplicationContext)
        val connect = BluetoothMonitorService.consumePendingConnect(reactApplicationContext)

        if (disconnect) {
            Log.i(TAG, "Found pending disconnect on resume - emitting")
            emitEvent(EVENT_CAR_DISCONNECTED, "Car", "")
        }
        if (connect) {
            Log.i(TAG, "Found pending connect on resume - emitting")
            emitEvent(EVENT_CAR_CONNECTED, "Car", "")
        }
    }

    override fun onHostPause() {
        // Don't remove the listener! The service should keep delivering events.
        // We just log that we're pausing.
        Log.d(TAG, "onHostPause: service continues monitoring in background")
    }

    override fun onHostDestroy() {
        Log.d(TAG, "onHostDestroy: clearing JS listener (service continues)")
        // Clear the direct JS listener since the bridge is being torn down.
        // The service will store events as pending instead.
        BluetoothMonitorService.eventListener = null
    }
}
