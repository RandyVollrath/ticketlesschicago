package fyi.ticketless.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * BluetoothMonitorService
 *
 * A foreground service that persistently monitors Bluetooth ACL events
 * (connect/disconnect) even when the React Native app is in the background
 * or the process is paused.
 *
 * Why this is needed:
 * react-native-bluetooth-classic's RNBluetoothClassicModule unregisters its
 * BroadcastReceivers in onHostPause(), so BT disconnect events are completely
 * lost when the app is backgrounded. This foreground service maintains its own
 * BroadcastReceiver that never gets unregistered, ensuring we always catch
 * when the car's Bluetooth disconnects.
 *
 * The service communicates events back to JS via:
 * 1. A static listener (when JS bridge is active)
 * 2. Sticky storage in SharedPreferences (when JS bridge is dead, checked on resume)
 */
class BluetoothMonitorService : Service() {

    companion object {
        private const val TAG = "BTMonitorService"
        private const val CHANNEL_ID = "bt_monitor_channel"
        private const val NOTIFICATION_ID = 9001
        private const val PREFS_NAME = "bt_monitor_prefs"
        private const val KEY_TARGET_ADDRESS = "target_bt_address"
        private const val KEY_TARGET_NAME = "target_bt_name"
        private const val KEY_PENDING_DISCONNECT = "pending_disconnect"
        private const val KEY_PENDING_CONNECT = "pending_connect"
        private const val KEY_LAST_EVENT_TIME = "last_event_time"
        private const val KEY_IS_CONNECTED = "is_connected"

        // Actions for starting/configuring the service
        const val ACTION_START = "fyi.ticketless.app.BT_MONITOR_START"
        const val ACTION_STOP = "fyi.ticketless.app.BT_MONITOR_STOP"
        const val EXTRA_DEVICE_ADDRESS = "device_address"
        const val EXTRA_DEVICE_NAME = "device_name"

        // Static listener for when JS bridge is active
        var eventListener: BluetoothEventListener? = null

        /**
         * Check if there's a pending disconnect event that wasn't delivered to JS.
         * Call this from the native module when JS bridge resumes.
         */
        fun consumePendingDisconnect(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getBoolean(KEY_PENDING_DISCONNECT, false)
            if (pending) {
                prefs.edit().putBoolean(KEY_PENDING_DISCONNECT, false).apply()
                Log.d(TAG, "Consumed pending disconnect event")
            }
            return pending
        }

        /**
         * Check if there's a pending connect event that wasn't delivered to JS.
         */
        fun consumePendingConnect(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getBoolean(KEY_PENDING_CONNECT, false)
            if (pending) {
                prefs.edit().putBoolean(KEY_PENDING_CONNECT, false).apply()
                Log.d(TAG, "Consumed pending connect event")
            }
            return pending
        }

        /**
         * Get the last known connection state from SharedPreferences.
         */
        fun isDeviceConnected(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(KEY_IS_CONNECTED, false)
        }
    }

    interface BluetoothEventListener {
        fun onCarDisconnected(deviceName: String, deviceAddress: String)
        fun onCarConnected(deviceName: String, deviceAddress: String)
    }

    private var aclReceiver: BroadcastReceiver? = null
    private var targetAddress: String? = null
    private var targetName: String? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action

        // For STOP actions sent via regular startService(), we do NOT need to
        // call startForeground(). Calling it and then immediately stopSelf()
        // creates a race condition when a START (via startForegroundService)
        // arrives in the same message loop — the STOP tears down the service
        // before the START can fulfill its startForeground() contract, causing
        // ForegroundServiceDidNotStartInTimeException crashes.
        if (action == ACTION_STOP) {
            Log.i(TAG, "Stopping BT monitor service")
            unregisterAclReceiver()
            // Clear connection state so stale "connected" doesn't persist
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putBoolean(KEY_IS_CONNECTED, false)
                .apply()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        // For START actions (or null/restart): call startForeground() IMMEDIATELY.
        // Android requires this within ~5 seconds of startForegroundService().
        try {
            startForeground(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to call startForeground: ${e.message}", e)
        }

        // Extract target device info from intent or SharedPreferences
        targetAddress = intent?.getStringExtra(EXTRA_DEVICE_ADDRESS)
            ?: getStoredTargetAddress()
        targetName = intent?.getStringExtra(EXTRA_DEVICE_NAME)
            ?: getStoredTargetName()

        if (targetAddress != null) {
            // Store for persistence across process restarts
            storeTargetDevice(targetAddress!!, targetName ?: "Car")

            // Update notification with car name now that we know it
            updateNotification("Monitoring ${targetName ?: "your car"}")

            // Register our own ACL BroadcastReceiver
            registerAclReceiver()

            // Check if the target device is ALREADY connected right now.
            // ACL events only fire on transitions — if the phone was already
            // connected before monitoring started, no event will ever come.
            checkInitialConnectionState()

            Log.i(TAG, "BT monitor started for: $targetName ($targetAddress)")
        } else {
            Log.w(TAG, "No target device address provided, stopping service")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        // START_STICKY: if the system kills us, restart the service
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.i(TAG, "Service destroyed")
        unregisterAclReceiver()
        super.onDestroy()
    }

    // -------------------------------------------------------------------------
    // BroadcastReceiver for ACL events
    // -------------------------------------------------------------------------

    private fun registerAclReceiver() {
        // Always unregister first so we get a clean receiver if target device changed
        unregisterAclReceiver()

        aclReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val action = intent.action ?: return
                val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                }

                val deviceAddress = try { device?.address } catch (e: SecurityException) { null }
                val deviceName = try { device?.name } catch (e: SecurityException) { null }

                Log.d(TAG, "ACL event: $action device=$deviceName ($deviceAddress) target=$targetName ($targetAddress)")

                // Check if this is our target car
                val isTargetDevice = (deviceAddress != null && deviceAddress == targetAddress) ||
                    (targetName != null && deviceName != null && deviceName == targetName)

                if (!isTargetDevice) {
                    Log.d(TAG, "Ignoring event from non-target device")
                    return
                }

                when (action) {
                    BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                        Log.i(TAG, "TARGET CAR DISCONNECTED: $deviceName ($deviceAddress)")
                        handleDisconnect(deviceName ?: targetName ?: "Car", deviceAddress ?: targetAddress ?: "")
                    }
                    BluetoothDevice.ACTION_ACL_CONNECTED -> {
                        Log.i(TAG, "TARGET CAR CONNECTED: $deviceName ($deviceAddress)")
                        handleConnect(deviceName ?: targetName ?: "Car", deviceAddress ?: targetAddress ?: "")
                    }
                    BluetoothDevice.ACTION_ACL_DISCONNECT_REQUESTED -> {
                        Log.i(TAG, "TARGET CAR DISCONNECT REQUESTED: $deviceName ($deviceAddress)")
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECT_REQUESTED)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(aclReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(aclReceiver, filter)
        }

        Log.i(TAG, "ACL BroadcastReceiver registered (persistent)")
    }

    private fun unregisterAclReceiver() {
        aclReceiver?.let {
            try {
                unregisterReceiver(it)
                Log.d(TAG, "ACL BroadcastReceiver unregistered")
            } catch (e: Exception) {
                Log.w(TAG, "Error unregistering ACL receiver: ${e.message}")
            }
            aclReceiver = null
        }
    }

    /**
     * Proactively check if the target device is already connected via A2DP
     * or Headset Bluetooth profiles. ACL BroadcastReceiver events only fire
     * on transitions, so if the car was connected BEFORE monitoring started
     * we'd never get an event and the app would be stuck on "Waiting for..."
     */
    private fun checkInitialConnectionState() {
        try {
            val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = bluetoothManager?.adapter
            if (adapter == null) {
                Log.w(TAG, "No BluetoothAdapter for initial connection check")
                return
            }

            // Check A2DP (media audio) and Headset (phone calls) profiles.
            // Cars typically use one or both of these.
            val profilesToCheck = listOf(BluetoothProfile.A2DP, BluetoothProfile.HEADSET)

            for (profileType in profilesToCheck) {
                adapter.getProfileProxy(this, object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                        try {
                            val connectedDevices = proxy.connectedDevices
                            Log.d(TAG, "Profile $profile has ${connectedDevices.size} connected device(s)")

                            val targetDevice = connectedDevices.find { device ->
                                try {
                                    val addr = device.address
                                    val name = device.name
                                    (addr != null && addr == targetAddress) ||
                                        (targetName != null && name != null && name == targetName)
                                } catch (e: SecurityException) {
                                    false
                                }
                            }

                            if (targetDevice != null) {
                                val name = try { targetDevice.name } catch (e: SecurityException) { null }
                                val addr = try { targetDevice.address } catch (e: SecurityException) { null }
                                Log.i(TAG, "Target device ALREADY CONNECTED on profile $profile: $name ($addr)")
                                handleConnect(name ?: targetName ?: "Car", addr ?: targetAddress ?: "")
                            }
                        } catch (e: SecurityException) {
                            Log.w(TAG, "SecurityException checking profile $profile: ${e.message}")
                        } finally {
                            adapter.closeProfileProxy(profile, proxy)
                        }
                    }

                    override fun onServiceDisconnected(profile: Int) {
                        // No action needed
                    }
                }, profileType)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to check initial connection state: ${e.message}")
        }
    }

    // -------------------------------------------------------------------------
    // Event handlers
    // -------------------------------------------------------------------------

    private fun handleDisconnect(name: String, address: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(KEY_IS_CONNECTED, false)
            .putLong(KEY_LAST_EVENT_TIME, System.currentTimeMillis())
            .apply()

        // Try to notify JS directly. If the listener throws (JS bridge died,
        // race condition, etc.), fall through to store as pending so the event
        // is never lost. Without this try/catch, the service would crash and
        // the pending flag would never be set.
        val listener = eventListener
        if (listener != null) {
            try {
                Log.d(TAG, "Delivering disconnect to JS listener directly")
                listener.onCarDisconnected(name, address)
            } catch (e: Exception) {
                Log.e(TAG, "Listener threw on disconnect, storing as pending: ${e.message}")
                prefs.edit().putBoolean(KEY_PENDING_DISCONNECT, true).apply()
            }
        } else {
            // JS bridge not active — store as pending event
            Log.d(TAG, "JS bridge not active, storing pending disconnect")
            prefs.edit().putBoolean(KEY_PENDING_DISCONNECT, true).apply()
        }

        // Update notification
        updateNotification("Parked - checking rules...")
    }

    private fun handleConnect(name: String, address: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(KEY_IS_CONNECTED, true)
            .putBoolean(KEY_PENDING_DISCONNECT, false) // Clear any pending disconnect
            .putLong(KEY_LAST_EVENT_TIME, System.currentTimeMillis())
            .apply()

        // Try to notify JS directly. If the listener throws, fall through to
        // store as pending so the event is recovered on next app resume.
        val listener = eventListener
        if (listener != null) {
            try {
                Log.d(TAG, "Delivering connect to JS listener directly")
                listener.onCarConnected(name, address)
            } catch (e: Exception) {
                Log.e(TAG, "Listener threw on connect, storing as pending: ${e.message}")
                prefs.edit().putBoolean(KEY_PENDING_CONNECT, true).apply()
            }
        } else {
            Log.d(TAG, "JS bridge not active, storing pending connect")
            prefs.edit().putBoolean(KEY_PENDING_CONNECT, true).apply()
        }

        // Update notification
        updateNotification("Driving - monitoring ${targetName ?: "your car"}")
    }

    // -------------------------------------------------------------------------
    // Notification
    // -------------------------------------------------------------------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Bluetooth Monitoring",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitors your car's Bluetooth connection for parking detection"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(subtitle: String? = null): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Autopilot Active")
            .setContentText(subtitle ?: "Monitoring ${targetName ?: "your car"}")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    // -------------------------------------------------------------------------
    // SharedPreferences helpers
    // -------------------------------------------------------------------------

    private fun storeTargetDevice(address: String, name: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_TARGET_ADDRESS, address)
            .putString(KEY_TARGET_NAME, name)
            .apply()
    }

    private fun getStoredTargetAddress(): String? {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_TARGET_ADDRESS, null)
    }

    private fun getStoredTargetName(): String? {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_TARGET_NAME, null)
    }
}
