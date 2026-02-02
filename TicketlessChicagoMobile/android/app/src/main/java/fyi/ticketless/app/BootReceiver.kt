package fyi.ticketless.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * BootReceiver
 *
 * Restarts the BluetoothMonitorService after the phone reboots.
 * The service stores the target car device in SharedPreferences,
 * so we just restart it and it picks up where it left off.
 *
 * Without this, a phone reboot would silently stop all BT monitoring
 * until the user manually opens the app.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
        private const val PREFS_NAME = "bt_monitor_prefs"
        private const val KEY_TARGET_ADDRESS = "target_bt_address"
        private const val KEY_TARGET_NAME = "target_bt_name"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.i(TAG, "BOOT_COMPLETED received - checking if BT monitor should restart")

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val address = prefs.getString(KEY_TARGET_ADDRESS, null)
        val name = prefs.getString(KEY_TARGET_NAME, null)

        if (address != null) {
            Log.i(TAG, "Found saved car: $name ($address) - restarting BT monitor service")

            val serviceIntent = Intent(context, BluetoothMonitorService::class.java).apply {
                action = BluetoothMonitorService.ACTION_START
                putExtra(BluetoothMonitorService.EXTRA_DEVICE_ADDRESS, address)
                putExtra(BluetoothMonitorService.EXTRA_DEVICE_NAME, name ?: "Car")
            }

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                Log.i(TAG, "BT monitor service restarted after boot")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to restart BT monitor service after boot: ${e.message}", e)
            }
        } else {
            Log.i(TAG, "No saved car device found - BT monitor not needed")
        }
    }
}
